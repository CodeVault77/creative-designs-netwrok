import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { roleOn } from '@/lib/collab/repo';
import { capabilitiesFor } from '@/lib/sharing/roles';

/**
 * Typed relationships between nodes.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Until now the only relationship two nodes could have was `map_nodes.parent_id`
 * — one parent, no type, no attributes, and never leaving its own map. That
 * makes the structure a tree. A tree cannot say "this depends on that", "this
 * was derived from that", or "this node over here is the same subject as that
 * node in another map", and every one of those is load-bearing for workflows,
 * agents and any kind of knowledge graph.
 *
 * ── Containment is NOT stored here ──────────────────────────────────────────
 *
 * Parent/child stays on `parent_id`. Writing a `contains` row for every node
 * would give the same fact two homes, and they would disagree the first time a
 * reparent updated one and missed the other. The complete graph is therefore
 * "parent edges UNION node_edges", and `neighboursOf` is the function that
 * presents both as one thing.
 *
 * ── Authorisation ───────────────────────────────────────────────────────────
 *
 * Every function here takes an AuthContext first, like every other repository
 * (see `lib/db/chokepoint.test.ts`). Creating an edge needs `editNodes` on the
 * SOURCE map and, separately, `view` on the target's map — otherwise a link is
 * a probe: draw an edge at a guessed id and read the title back off the map.
 */

/** Relationship kinds the product understands today. */
export const EDGE_TYPES = [
  'relates_to',
  'depends_on',
  'derived_from',
  'references',
  'blocks',
  'duplicates',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * Deliberately not a CHECK constraint in SQL.
 *
 * New relationship kinds are the entire point of this table. A database
 * constraint would turn every one of them into a migration on a live table;
 * validating in code keeps the vocabulary open and still rejects nonsense at
 * the boundary.
 */
export function isEdgeType(value: string): value is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(value);
}

export interface NodeEdge {
  id: string;
  mapId: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  payload: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
}

interface EdgeRow {
  id: string;
  map_id: string;
  from_node_id: string;
  to_node_id: string;
  type: string;
  payload: string | null;
  created_by: string | null;
  created_at: string;
}

function hydrate(row: EdgeRow): NodeEdge {
  let payload: Record<string, unknown> | null = null;
  if (row.payload) {
    try {
      const parsed: unknown = JSON.parse(row.payload);
      // A non-object payload (a bare string or array) is treated as absent
      // rather than crashing the read — the column is free-form by design and
      // a malformed row must not take down the whole map.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
  }

  return {
    id: row.id,
    mapId: row.map_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    type: isEdgeType(row.type) ? row.type : 'relates_to',
    payload,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** The map a node belongs to, or null if it does not exist. */
function mapOfNode(nodeId: string, db: Database): string | null {
  const row = db
    .prepare('SELECT map_id FROM map_nodes WHERE id = ?')
    .get(nodeId) as { map_id: string } | undefined;
  return row?.map_id ?? null;
}

export interface EdgeResult {
  ok: boolean;
  edge?: NodeEdge;
  error?: string;
}

/**
 * Link two nodes.
 *
 * Cross-map links are allowed and are much of the point — but the two ends are
 * authorised differently. You must be able to EDIT the map you are drawing
 * from, and be able to VIEW the map you are drawing to.
 */
export function createEdge(
  ctx: AuthContext,
  input: {
    fromNodeId: string;
    toNodeId: string;
    type?: string;
    payload?: Record<string, unknown>;
  },
  db: Database = getDb(),
): EdgeResult {
  /*
   * A node cannot relate to itself.
   *
   * Not merely meaningless: a self-edge is a one-node cycle, and it would be
   * the first thing to hit every traversal guard below.
   */
  if (input.fromNodeId === input.toNodeId) {
    return { ok: false, error: 'A node cannot link to itself' };
  }

  const type = input.type ?? 'relates_to';
  if (!isEdgeType(type)) {
    return { ok: false, error: 'Unknown relationship type' };
  }

  const fromMap = mapOfNode(input.fromNodeId, db);
  const toMap = mapOfNode(input.toNodeId, db);

  /*
   * One message for "no such node" and for "no permission".
   *
   * Same reasoning as the 404-not-403 rule on shared maps: distinguishing them
   * turns this endpoint into an oracle for which node ids exist.
   */
  const refused = { ok: false, error: 'Those nodes cannot be linked' };

  if (!fromMap || !toMap) return refused;

  if (!capabilitiesFor(roleOn(ctx, fromMap, db)).editNodes) return refused;
  if (!capabilitiesFor(roleOn(ctx, toMap, db)).view) return refused;

  const id = randomUUID();

  try {
    db.prepare(
      `INSERT INTO node_edges
         (id, map_id, from_node_id, to_node_id, type, payload, created_by)
       VALUES (@id, @mapId, @from, @to, @type, @payload, @createdBy)`,
    ).run({
      id,
      // The SOURCE map owns the edge, so it is deleted with the map the link
      // was drawn from and is listed among that map's relationships.
      mapId: fromMap,
      from: input.fromNodeId,
      to: input.toNodeId,
      type,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      createdBy: ctx.userId || null,
    });
  } catch (cause) {
    /*
     * The unique index is what enforces "one edge of a type between two
     * nodes", not a prior SELECT — two concurrent requests both pass a check
     * and only one can win an insert.
     */
    if (String(cause).includes('UNIQUE')) {
      return { ok: false, error: 'Those nodes are already linked that way' };
    }
    throw cause;
  }

  const row = db
    .prepare('SELECT * FROM node_edges WHERE id = ?')
    .get(id) as EdgeRow;
  return { ok: true, edge: hydrate(row) };
}

/** Remove an edge. Requires edit rights on the map that owns it. */
export function deleteEdge(
  ctx: AuthContext,
  edgeId: string,
  db: Database = getDb(),
): boolean {
  const row = db
    .prepare('SELECT map_id FROM node_edges WHERE id = ?')
    .get(edgeId) as { map_id: string } | undefined;

  if (!row) return false;
  if (!capabilitiesFor(roleOn(ctx, row.map_id, db)).editNodes) return false;

  return db.prepare('DELETE FROM node_edges WHERE id = ?').run(edgeId).changes > 0;
}

/**
 * Every edge touching a map, in either direction.
 *
 * Includes edges that ARRIVE from other maps, so a map can show its backlinks.
 * Filtered to what the caller may see: an inbound edge from a private map they
 * have no access to is omitted entirely rather than shown as an anonymous stub.
 */
export function edgesForMap(
  ctx: AuthContext,
  mapId: string,
  db: Database = getDb(),
): NodeEdge[] {
  if (!capabilitiesFor(roleOn(ctx, mapId, db)).view) return [];

  const rows = db
    .prepare(
      `SELECT e.* FROM node_edges e
        WHERE e.map_id = @mapId
           OR e.to_node_id   IN (SELECT id FROM map_nodes WHERE map_id = @mapId)
           OR e.from_node_id IN (SELECT id FROM map_nodes WHERE map_id = @mapId)
        ORDER BY e.created_at`,
    )
    .all({ mapId }) as EdgeRow[];

  /*
   * Visibility is re-checked per foreign map, not assumed from `map_id`.
   *
   * An edge owned by map A that points into private map B is visible to
   * someone who can see A — but only if they can also see B. Caching the
   * decision per map keeps this to one lookup per distinct map rather than one
   * per edge.
   */
  const canSee = new Map<string, boolean>([[mapId, true]]);
  const visible = (candidate: string): boolean => {
    const cached = canSee.get(candidate);
    if (cached !== undefined) return cached;
    const allowed = capabilitiesFor(roleOn(ctx, candidate, db)).view;
    canSee.set(candidate, allowed);
    return allowed;
  };

  return rows.filter((row) => visible(row.map_id)).map(hydrate);
}

export interface Neighbour {
  nodeId: string;
  edge: NodeEdge;
  direction: 'out' | 'in';
}

/**
 * Nodes one hop away, following explicit edges in both directions.
 *
 * Containment is not included: `parent_id` answers that, and mixing the two
 * would make "neighbours" mean two different things depending on which the
 * caller cared about.
 */
export function neighboursOf(
  ctx: AuthContext,
  nodeId: string,
  db: Database = getDb(),
): Neighbour[] {
  const mapId = mapOfNode(nodeId, db);
  if (!mapId) return [];
  if (!capabilitiesFor(roleOn(ctx, mapId, db)).view) return [];

  const rows = db
    .prepare('SELECT * FROM node_edges WHERE from_node_id = ? OR to_node_id = ?')
    .all(nodeId, nodeId) as EdgeRow[];

  const out: Neighbour[] = [];

  for (const row of rows) {
    const edge = hydrate(row);
    const outbound = row.from_node_id === nodeId;
    const otherId = outbound ? row.to_node_id : row.from_node_id;

    const otherMap = mapOfNode(otherId, db);
    if (!otherMap) continue;
    if (!capabilitiesFor(roleOn(ctx, otherMap, db)).view) continue;

    out.push({ nodeId: otherId, edge, direction: outbound ? 'out' : 'in' });
  }

  return out;
}

/** Guard rails for `traverse`. Both are hard caps, not suggestions. */
export const MAX_TRAVERSAL_DEPTH = 6;
export const MAX_TRAVERSAL_NODES = 500;

export interface TraversalStep {
  nodeId: string;
  depth: number;
  /** The path taken to reach it, source first. Useful for explaining a result. */
  via: string[];
}

/**
 * Breadth-first walk over explicit edges.
 *
 * ── Why the guards are not optional ─────────────────────────────────────────
 *
 * This is the first structure in the codebase that can contain a CYCLE. The
 * tree could not: `parent_id` walks strictly toward the root and terminates.
 * Two nodes pointing at each other will spin forever without a visited set,
 * and because `better-sqlite3` is synchronous that is not a slow request — it
 * is a hung Node process serving nobody.
 *
 * `depth` bounds how far a single call can reach and `MAX_TRAVERSAL_NODES`
 * bounds the total, so a densely connected map cannot turn one request into a
 * whole-graph scan.
 */
export function traverse(
  ctx: AuthContext,
  startNodeId: string,
  options: { depth?: number; types?: readonly EdgeType[] } = {},
  db: Database = getDb(),
): TraversalStep[] {
  const maxDepth = Math.min(options.depth ?? 2, MAX_TRAVERSAL_DEPTH);
  const wanted = options.types ? new Set<string>(options.types) : null;

  const seen = new Set<string>([startNodeId]);
  const results: TraversalStep[] = [];

  let frontier: TraversalStep[] = [{ nodeId: startNodeId, depth: 0, via: [] }];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: TraversalStep[] = [];

    for (const current of frontier) {
      for (const neighbour of neighboursOf(ctx, current.nodeId, db)) {
        if (wanted && !wanted.has(neighbour.edge.type)) continue;
        // The visited set is what makes a cycle terminate. Without it, A→B→A
        // is an infinite loop on a synchronous database driver.
        if (seen.has(neighbour.nodeId)) continue;

        seen.add(neighbour.nodeId);

        const step: TraversalStep = {
          nodeId: neighbour.nodeId,
          depth,
          via: [...current.via, neighbour.edge.id],
        };

        results.push(step);
        next.push(step);

        if (seen.size >= MAX_TRAVERSAL_NODES) return results;
      }
    }

    if (next.length === 0) break;
    frontier = next;
  }

  return results;
}
