import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS } from '@/lib/db/migrations';
import type { AuthContext } from '@/lib/db/repo';
import {
  MAX_TRAVERSAL_DEPTH,
  createEdge,
  deleteEdge,
  edgesForMap,
  isEdgeType,
  neighboursOf,
  traverse,
} from './edges';

/**
 * Typed relationships.
 *
 * The important tests here are the negative ones. This is the first structure
 * in the codebase that can contain a CYCLE — the tree could not, because
 * `parent_id` walks strictly toward the root and terminates — and cycles on a
 * synchronous database driver do not produce a slow request, they produce a
 * hung process.
 */

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS) db.exec(migration.sql);
  return db;
}

const OWNER: AuthContext = { userId: 'u_owner', isStaff: false };
const STRANGER: AuthContext = { userId: 'u_stranger', isStaff: false };

let db: Database.Database;

function seedUser(id: string) {
  // `created_at` has no default on these tables — the application always
  // supplies it — so the seed must too.
  db.prepare(
    `INSERT INTO users
       (id, email, email_lower, display_name, handle, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, 'x', datetime('now'))`,
  ).run(id, `${id}@example.com`, `${id}@example.com`, id, id);
}

function seedMap(mapId: string, ownerId: string, visibility = 'private') {
  db.prepare(
    `INSERT INTO maps
       (id, owner_id, title, family, visibility, root_id, created_at, updated_at)
     VALUES (?, ?, ?, 'create', ?, ?, datetime('now'), datetime('now'))`,
  ).run(mapId, ownerId, mapId, visibility, `${mapId}_root`);
}

function seedNode(nodeId: string, mapId: string, parentId: string | null = null) {
  db.prepare(
    `INSERT INTO map_nodes (id, map_id, parent_id, slot, title, family, type, status, visibility)
     VALUES (?, ?, ?, 0, ?, 'create', 'topic', 'active', 'inherit')`,
  ).run(nodeId, mapId, parentId, nodeId);
}

beforeEach(() => {
  db = freshDb();
  seedUser('u_owner');
  seedUser('u_stranger');

  seedMap('m1', 'u_owner');
  seedNode('m1_root', 'm1');
  seedNode('a', 'm1', 'm1_root');
  seedNode('b', 'm1', 'm1_root');
  seedNode('c', 'm1', 'm1_root');
});

describe('edge vocabulary', () => {
  it('accepts known types and rejects anything else', () => {
    expect(isEdgeType('depends_on')).toBe(true);
    expect(isEdgeType('invented_by_a_client')).toBe(false);
  });
});

describe('createEdge', () => {
  it('links two nodes in a map the caller can edit', () => {
    const result = createEdge(
      OWNER,
      { fromNodeId: 'a', toNodeId: 'b', type: 'depends_on' },
      db,
    );

    expect(result.ok).toBe(true);
    expect(result.edge?.type).toBe('depends_on');
    // The SOURCE map owns the edge, so it is deleted with the map it was drawn
    // from and listed among that map's relationships.
    expect(result.edge?.mapId).toBe('m1');
  });

  it('refuses a self-link', () => {
    // A self-edge is a one-node cycle and would be the first thing to hit
    // every traversal guard.
    expect(createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'a' }, db).ok).toBe(
      false,
    );
  });

  it('refuses an unknown relationship type', () => {
    expect(
      createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b', type: 'nonsense' }, db)
        .ok,
    ).toBe(false);
  });

  it('refuses a duplicate of the same type', () => {
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b', type: 'blocks' }, db);
    const again = createEdge(
      OWNER,
      { fromNodeId: 'a', toNodeId: 'b', type: 'blocks' },
      db,
    );

    expect(again.ok).toBe(false);
    // Enforced by the unique index rather than a prior SELECT, so two
    // concurrent requests cannot both pass the check.
    expect(again.error).toContain('already linked');
  });

  it('allows the same pair with a different type', () => {
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b', type: 'blocks' }, db);
    expect(
      createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b', type: 'references' }, db)
        .ok,
    ).toBe(true);
  });

  /**
   * A stranger must not be able to link nodes in someone else's private map,
   * and the refusal must not confirm that the nodes exist.
   */
  it('refuses a stranger, without revealing whether the nodes exist', () => {
    const real = createEdge(STRANGER, { fromNodeId: 'a', toNodeId: 'b' }, db);
    const fake = createEdge(
      STRANGER,
      { fromNodeId: 'no_such_node', toNodeId: 'also_missing' },
      db,
    );

    expect(real.ok).toBe(false);
    expect(fake.ok).toBe(false);
    // Identical messages: distinguishing them turns this into an oracle for
    // which node ids exist.
    expect(real.error).toBe(fake.error);
  });
});

describe('cross-map links', () => {
  beforeEach(() => {
    seedMap('m2', 'u_stranger', 'private');
    seedNode('m2_root', 'm2');
    seedNode('x', 'm2', 'm2_root');
  });

  /**
   * The two ends authorise differently: you must be able to EDIT the map you
   * draw from, and to VIEW the map you draw to. Without the second check a link
   * is a probe — draw at a guessed id and read the title back.
   */
  it('refuses a link into a private map the caller cannot view', () => {
    expect(createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'x' }, db).ok).toBe(
      false,
    );
  });

  it('allows a link into a public map', () => {
    db.prepare(`UPDATE maps SET visibility = 'public' WHERE id = 'm2'`).run();
    expect(createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'x' }, db).ok).toBe(true);
  });

  it('hides edges pointing into maps the caller cannot see', () => {
    db.prepare(`UPDATE maps SET visibility = 'public' WHERE id = 'm2'`).run();
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'x' }, db);

    // m1 is private, so a stranger sees none of its edges at all.
    expect(edgesForMap(STRANGER, 'm1', db)).toHaveLength(0);
    expect(edgesForMap(OWNER, 'm1', db)).toHaveLength(1);
  });
});

describe('deleteEdge', () => {
  it('removes an edge for someone who may edit the owning map', () => {
    const created = createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b' }, db);
    expect(deleteEdge(OWNER, created.edge!.id, db)).toBe(true);
    expect(edgesForMap(OWNER, 'm1', db)).toHaveLength(0);
  });

  it('refuses a stranger', () => {
    const created = createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b' }, db);
    expect(deleteEdge(STRANGER, created.edge!.id, db)).toBe(false);
  });
});

describe('neighboursOf', () => {
  it('follows edges in both directions', () => {
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b' }, db);
    createEdge(OWNER, { fromNodeId: 'c', toNodeId: 'a' }, db);

    const neighbours = neighboursOf(OWNER, 'a', db);
    const byId = new Map(neighbours.map((n) => [n.nodeId, n.direction]));

    expect(byId.get('b')).toBe('out');
    // Inbound too — this is what makes backlinks possible.
    expect(byId.get('c')).toBe('in');
  });

  /**
   * Containment is deliberately not included. `parent_id` answers that
   * question, and mixing the two would make "neighbours" mean different things
   * depending on which the caller cared about.
   */
  it('does not treat a parent as a neighbour', () => {
    expect(neighboursOf(OWNER, 'a', db)).toHaveLength(0);
  });
});

describe('traverse', () => {
  it('walks outward to the requested depth', () => {
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b' }, db);
    createEdge(OWNER, { fromNodeId: 'b', toNodeId: 'c' }, db);

    expect(traverse(OWNER, 'a', { depth: 1 }, db).map((s) => s.nodeId)).toEqual([
      'b',
    ]);

    const deep = traverse(OWNER, 'a', { depth: 2 }, db);
    expect(deep.map((s) => s.nodeId).sort()).toEqual(['b', 'c']);
    expect(deep.find((s) => s.nodeId === 'c')?.depth).toBe(2);
  });

  /**
   * The test this module exists for.
   *
   * A→B→C→A is a cycle. Without the visited set this call never returns, and
   * because `better-sqlite3` is synchronous that is a hung Node process serving
   * nobody — not a slow request.
   */
  it('terminates on a cycle', () => {
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b' }, db);
    createEdge(OWNER, { fromNodeId: 'b', toNodeId: 'c' }, db);
    createEdge(OWNER, { fromNodeId: 'c', toNodeId: 'a' }, db);

    const walked = traverse(OWNER, 'a', { depth: 6 }, db);

    // Each node once, and the start is never revisited.
    expect(walked.map((s) => s.nodeId).sort()).toEqual(['b', 'c']);
  });

  it('clamps a caller-supplied depth to the hard maximum', () => {
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b' }, db);

    // A request for depth 9999 must not become a whole-graph scan.
    expect(() => traverse(OWNER, 'a', { depth: 9999 }, db)).not.toThrow();
    expect(MAX_TRAVERSAL_DEPTH).toBeLessThanOrEqual(6);
  });

  it('filters by relationship type', () => {
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b', type: 'blocks' }, db);
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'c', type: 'references' }, db);

    const blocked = traverse(OWNER, 'a', { depth: 2, types: ['blocks'] }, db);
    expect(blocked.map((s) => s.nodeId)).toEqual(['b']);
  });

  it('returns nothing for a node the caller cannot see', () => {
    createEdge(OWNER, { fromNodeId: 'a', toNodeId: 'b' }, db);
    expect(traverse(STRANGER, 'a', { depth: 2 }, db)).toHaveLength(0);
  });
});
