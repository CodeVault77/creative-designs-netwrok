import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AuthContext } from '@/lib/db/repo';
import {
  getMap,
  listOwnedMaps,
  listSharedMaps,
  saveMap,
  VersionConflictError,
  NotWritableError,
} from '@/lib/db/repo';
import { validatePayload } from '@/lib/nodes/registry';

/**
 * The shapes the public API returns.
 *
 * ── A published shape is a promise ──────────────────────────────────────────
 *
 * These functions exist so that no route serialises a database row. A row's
 * column names are ours to change; a documented API field is not. Returning
 * rows directly would publish the schema by accident and turn every future
 * rename into somebody's outage — and would eventually publish a column added
 * without anyone thinking about who receives it.
 *
 * So the mapping is explicit and boring, and adding a field to the API is a
 * deliberate edit here rather than a side effect somewhere else.
 */

export interface ApiNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string | null;
  type: string;
  family: string;
  status: string;
  visibility: string;
  icon: string | null;
  href: string | null;
  payload: Record<string, unknown>;
  weight: number;
}

/**
 * A map in a list.
 *
 * Deliberately NOT the same shape as the detail response. A summary carries no
 * `version`, because a version is only meaningful alongside the nodes it
 * describes — handing one out in a list invites a client to write against a
 * version it read before someone else's edit, which is the conflict check
 * defeating itself.
 */
export interface ApiMap {
  id: string;
  title: string;
  family: string;
  visibility: string;
  updatedAt: string;
  ownerHandle: string;
  nodeCount: number;
  relation: 'owner' | 'member';
}

export interface ApiMapDetail {
  id: string;
  title: string;
  family: string;
  visibility: string;
  rootId: string;
  version: number;
  updatedAt: string;
  ownerHandle: string;
  nodeCount: number;
  nodes: ApiNode[];
}

/** The stored node shape, which is snake_case because the columns are. */
interface StoredNode {
  id: string;
  parent_id: string | null;
  title: string;
  description?: string;
  type: string;
  family: string;
  status: string;
  visibility: string;
  icon?: string;
  href?: string;
  payload?: Record<string, unknown>;
  weight: number;
}

/**
 * Stored node to published node.
 *
 * This is the rename that matters: columns are snake_case and the API is
 * camelCase, and the translation happens HERE rather than in each route. A
 * route that forgot would publish `parent_id` alongside everyone else's
 * `parentId`, and both spellings would then be somebody's integration.
 */
function toApiNode(node: StoredNode): ApiNode {
  return {
    id: node.id,
    parentId: node.parent_id ?? null,
    title: node.title,
    description: node.description ?? null,
    type: node.type,
    family: node.family,
    status: node.status,
    visibility: node.visibility,
    icon: node.icon ?? null,
    href: node.href ?? null,
    payload: node.payload ?? {},
    weight: node.weight,
  };
}

/** Maps the key's owner can see. Owned and shared, in one list. */
export function apiListMaps(ctx: AuthContext, db: Database): ApiMap[] {
  const summaries = [...listOwnedMaps(ctx, db), ...listSharedMaps(ctx, db)];

  return summaries.map((summary) => ({
    id: summary.id,
    title: summary.title,
    family: summary.family,
    visibility: summary.visibility,
    updatedAt: summary.updatedAt,
    ownerHandle: summary.ownerHandle,
    nodeCount: summary.nodeCount,
    relation: summary.relation,
  }));
}

export function apiGetMap(
  ctx: AuthContext,
  mapId: string,
  db: Database,
): ApiMapDetail | null {
  const map = getMap(ctx, mapId, db);
  if (!map) return null;

  const nodes = Object.values(map.nodes) as unknown as StoredNode[];

  return {
    id: map.id,
    title: map.title,
    family: map.family,
    visibility: map.visibility,
    rootId: map.rootId,
    version: map.version,
    updatedAt: map.updatedAt,
    ownerHandle: map.ownerHandle,
    nodeCount: nodes.length,
    nodes: nodes.map(toApiNode),
  };
}

export type WriteFailure = 'not_found' | 'conflict' | 'invalid_payload';

export interface WriteResult {
  ok: boolean;
  map?: ApiMapDetail;
  failure?: WriteFailure;
  detail?: string;
  /** Present on a conflict, so a client can re-read and retry. */
  currentVersion?: number;
}

export interface NodeInput {
  id?: string;
  parentId?: string | null;
  title?: string;
  description?: string | null;
  type?: string;
  icon?: string | null;
  href?: string | null;
  payload?: Record<string, unknown>;
  weight?: number;
}

/**
 * Create or update one node through the API.
 *
 * ── Optimistic concurrency is mandatory, not optional ───────────────────────
 *
 * The caller sends the version it read. A write without one would let an
 * integration polling every thirty seconds silently overwrite whatever a
 * person did in the editor in between — the precise failure `saveMap`'s
 * version check exists to prevent, reintroduced by an API that skipped it.
 */
export function apiWriteNode(
  ctx: AuthContext,
  mapId: string,
  expectedVersion: number,
  input: NodeInput,
  db: Database,
): WriteResult {
  const map = getMap(ctx, mapId, db);
  if (!map) return { ok: false, failure: 'not_found' };

  const nodeId = input.id ?? `nod_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const existing = map.nodes[nodeId];
  const type = input.type ?? existing?.type ?? 'topic';

  /*
   * The payload is validated against the type that owns it, using the same
   * registry the editor uses. An API that skipped this would be the one way
   * into the database that could store a payload no renderer can read.
   */
  const payload = input.payload ?? existing?.payload ?? {};
  const validated = validatePayload(type, payload);

  if (!validated.ok) {
    return { ok: false, failure: 'invalid_payload', detail: validated.error };
  }

  const nodes = { ...map.nodes };

  /*
   * `slot` is preserved on an update and assigned on a create.
   *
   * ADR-0002: a node's angular position is fixed once and persisted, because
   * the stability of position is what makes a map learnable. An API that
   * re-slotted on every write would rearrange somebody's map from under them
   * each time an integration touched a title.
   */
  const siblings = Object.values(map.nodes).filter(
    (candidate) => candidate.parent_id === (input.parentId ?? map.rootId),
  );

  const base: (typeof map.nodes)[string] = existing ?? {
    id: nodeId,
    map_id: mapId,
    parent_id: input.parentId ?? map.rootId,
    slot: siblings.length,
    title: '',
    family: map.family,
    type: 'topic',
    status: 'active',
    visibility: 'public',
    weight: 0.5,
  };

  nodes[nodeId] = {
    ...base,
    id: nodeId,
    parent_id: input.parentId !== undefined ? input.parentId : base.parent_id,
    title: (input.title ?? base.title).slice(0, 60),
    description: input.description ?? base.description ?? undefined,
    type: type as typeof base.type,
    icon: input.icon ?? base.icon ?? undefined,
    href: input.href ?? base.href ?? undefined,
    payload: validated.value ?? {},
    // Clamped: weight drives size and glow, and a value outside 0-1 draws a
    // node the renderer was never asked to size.
    weight: Math.min(1, Math.max(0, input.weight ?? base.weight)),
  };

  try {
    saveMap(ctx, mapId, expectedVersion, { nodes }, db);
  } catch (cause) {
    if (cause instanceof VersionConflictError) {
      return {
        ok: false,
        failure: 'conflict',
        currentVersion: cause.currentVersion,
      };
    }
    if (cause instanceof NotWritableError) {
      return { ok: false, failure: 'not_found' };
    }
    throw cause;
  }

  return { ok: true, map: apiGetMap(ctx, mapId, db) ?? undefined };
}

/** Update a map's own fields. Nodes are written through `apiWriteNode`. */
export function apiUpdateMap(
  ctx: AuthContext,
  mapId: string,
  expectedVersion: number,
  patch: { title?: string; visibility?: string },
  db: Database,
): WriteResult {
  try {
    saveMap(ctx, mapId, expectedVersion, patch, db);
  } catch (cause) {
    if (cause instanceof VersionConflictError) {
      return {
        ok: false,
        failure: 'conflict',
        currentVersion: cause.currentVersion,
      };
    }
    if (cause instanceof NotWritableError) {
      return { ok: false, failure: 'not_found' };
    }
    throw cause;
  }

  return { ok: true, map: apiGetMap(ctx, mapId, db) ?? undefined };
}
