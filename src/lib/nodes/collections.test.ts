import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser } from '@/lib/db/repo';
import {
  COLLECTIONS,
  collectionCounts,
  collectionFor,
  isCollectionSlug,
  totalsFor,
} from './collections';

/**
 * Collection tests.
 *
 * This is a CROSS-MAP query, which is the shape of query that leaks. It reads
 * `map_nodes` across every map at once with its own predicate rather than
 * going through `getMap`, so most of what follows tries to make it return a
 * row it should not: a stranger's node, a public map's node, and — the one a
 * copied predicate would get wrong — a node on a map that is public but not
 * mine.
 */

let db: Database;
let owner: { userId: string; isStaff: boolean };
let member: { userId: string; isStaff: boolean };
let stranger: { userId: string; isStaff: boolean };
let staff: { userId: string; isStaff: boolean };

function seedMap(
  ctx: { userId: string; isStaff: boolean },
  id: string,
  visibility: 'private' | 'public',
  nodes: { id: string; type: string; title: string; payload?: unknown }[],
) {
  createMap(
    ctx,
    {
      id,
      title: `Map ${id}`,
      family: 'create',
      visibility,
      rootId: `${id}-root`,
      version: 1,
      updatedAt: new Date().toISOString(),
      dirty: [],
      metaDirty: false,
      nodes: {
        [`${id}-root`]: {
          id: `${id}-root`,
          map_id: id,
          parent_id: null,
          slot: 0,
          title: 'Root',
          family: 'create',
          type: 'topic',
          status: 'active',
          visibility: 'public',
          weight: 0.5,
        },
        ...Object.fromEntries(
          nodes.map((node) => [
            node.id,
            {
              id: node.id,
              map_id: id,
              parent_id: `${id}-root`,
              slot: 0,
              title: node.title,
              family: 'create',
              type: node.type,
              status: 'active',
              visibility: 'public',
              weight: 0.5,
              payload: node.payload,
            },
          ]),
        ),
      },
    } as Parameters<typeof createMap>[1],
    db,
  );
}

beforeEach(() => {
  db = createTestDb();

  for (const [id, handle] of [
    ['u_owner', 'owner'],
    ['u_member', 'member'],
    ['u_stranger', 'stranger'],
    ['u_staff', 'staffer'],
  ] as const) {
    createUser(
      {
        id,
        email: `${handle}@example.com`,
        passwordHash: 'x',
        handle,
        displayName: handle,
      },
      db,
    );
  }

  owner = { userId: 'u_owner', isStaff: false };
  member = { userId: 'u_member', isStaff: false };
  stranger = { userId: 'u_stranger', isStaff: false };
  staff = { userId: 'u_staff', isStaff: true };
});

const WORK = COLLECTIONS.work.types;
const COMMERCE = COLLECTIONS.commerce.types;

// ------------------------------------------------------------------- exposure

describe('a collection shows only your own work', () => {
  it('returns nodes from a map you own', () => {
    seedMap(owner, 'map_mine', 'private', [
      { id: 'n_task', type: 'task', title: 'Write the brief' },
    ]);

    expect(collectionFor(owner, WORK, {}, db).map((i) => i.id)).toEqual(['n_task']);
  });

  it('returns nothing to a stranger', () => {
    seedMap(owner, 'map_mine', 'private', [
      { id: 'n_task', type: 'task', title: 'Write the brief' },
    ]);

    expect(collectionFor(stranger, WORK, {}, db)).toEqual([]);
  });

  it('does not put a PUBLIC map’s tasks in a stranger’s list', () => {
    /*
     * The mistake a copied predicate makes. `repo.ts`'s `visible` admits
     * public maps, which is right for "may I read this" and wrong here: a
     * public map belonging to somebody else is not my work, and a working list
     * full of strangers' tasks is both a surprise and useless.
     */
    seedMap(owner, 'map_open', 'public', [
      { id: 'n_task', type: 'task', title: 'Public task' },
    ]);

    expect(collectionFor(stranger, WORK, {}, db)).toEqual([]);
  });

  it('gives staff no bypass', () => {
    // Moderation reaches across ownership elsewhere. It must not reach into an
    // operator's own to-do list, which is what this screen is.
    seedMap(owner, 'map_mine', 'private', [
      { id: 'n_task', type: 'task', title: 'Write the brief' },
    ]);

    expect(collectionFor(staff, WORK, {}, db)).toEqual([]);
  });

  it('includes a map shared with you', () => {
    seedMap(owner, 'map_shared', 'private', [
      { id: 'n_task', type: 'task', title: 'Shared task' },
    ]);

    db.prepare(
      `INSERT INTO map_members (map_id, user_id, role, added_at)
       VALUES ('map_shared', 'u_member', 'editor', datetime('now'))`,
    ).run();

    expect(collectionFor(member, WORK, {}, db).map((i) => i.id)).toEqual([
      'n_task',
    ]);
  });

  it('returns nothing to a signed-out caller', () => {
    seedMap(owner, 'map_mine', 'private', [
      { id: 'n_task', type: 'task', title: 'A task' },
    ]);

    expect(collectionFor({ userId: '', isStaff: false }, WORK, {}, db)).toEqual([]);
  });
});

// ---------------------------------------------------------------- filtering

describe('filtering by type', () => {
  beforeEach(() => {
    seedMap(owner, 'map_mine', 'private', [
      { id: 'n_task', type: 'task', title: 'A task' },
      { id: 'n_milestone', type: 'milestone', title: 'A milestone' },
      { id: 'n_product', type: 'product', title: 'A product' },
      { id: 'n_note', type: 'note', title: 'Just a note' },
    ]);
  });

  it('returns only the package’s types', () => {
    const ids = collectionFor(owner, WORK, {}, db)
      .map((i) => i.id)
      .sort();

    // The note and the product are not project management.
    expect(ids).toEqual(['n_milestone', 'n_task']);
  });

  it('narrows to one type when asked', () => {
    expect(
      collectionFor(owner, WORK, { type: 'task' }, db).map((i) => i.id),
    ).toEqual(['n_task']);
  });

  it('returns nothing for a type outside the package', () => {
    /*
     * The dangerous case: a screen labelled "Work" being handed `note` and
     * widening rather than refusing. An empty type set must mean nothing, not
     * everything.
     */
    expect(collectionFor(owner, WORK, { type: 'note' }, db)).toEqual([]);
    expect(collectionFor(owner, [], {}, db)).toEqual([]);
  });

  it('counts every requested type, including the empty ones', () => {
    const counts = collectionCounts(owner, COMMERCE, db);

    expect(counts.map((c) => c.type)).toEqual([...COMMERCE]);
    expect(counts.find((c) => c.type === 'product')?.count).toBe(1);
    expect(counts.find((c) => c.type === 'invoice')?.count).toBe(0);
  });

  it('counts nothing for a stranger', () => {
    expect(
      collectionCounts(stranger, COMMERCE, db).every((c) => c.count === 0),
    ).toBe(true);
  });
});

// ------------------------------------------------------------------ payloads

describe('payloads', () => {
  it('come back validated through the ordinary registry', () => {
    seedMap(owner, 'map_mine', 'private', [
      {
        id: 'n_task',
        type: 'task',
        title: 'A task',
        payload: { status: 'doing', priority: 'high' },
      },
    ]);

    const item = collectionFor(owner, WORK, {}, db)[0];

    expect(item?.payload.status).toBe('doing');
    expect(item?.payload.priority).toBe('high');
  });

  it('keep a node whose payload will not parse', () => {
    // The row still exists and its title is still worth showing. Dropping it
    // would make a task vanish from someone's list because of a bad byte.
    seedMap(owner, 'map_mine', 'private', [
      { id: 'n_task', type: 'task', title: 'A task' },
    ]);

    db.prepare(
      "UPDATE map_nodes SET payload = '{not json' WHERE id = 'n_task'",
    ).run();

    const items = collectionFor(owner, WORK, {}, db);

    expect(items).toHaveLength(1);
    expect(items[0]?.payload).toEqual({});
  });

  it('names the map each item came from', () => {
    // The whole point of a cross-map view: knowing where to go to change it.
    seedMap(owner, 'map_mine', 'private', [
      { id: 'n_task', type: 'task', title: 'A task' },
    ]);

    expect(collectionFor(owner, WORK, {}, db)[0]?.mapTitle).toBe('Map map_mine');
  });
});

// -------------------------------------------------------------------- totals

describe('totals', () => {
  it('sum only amounts that are actually there', () => {
    const totals = totalsFor([
      { payload: { totalCents: 2500 } },
      { payload: { amountCents: 1000 } },
      { payload: {} },
    ] as never);

    // No estimate, no defaulting a missing price to zero and calling the total
    // complete — 3500 is what was recorded, and that is all it claims.
    expect(totals.valueCents).toBe(3500);
    expect(totals.items).toBe(3);
  });

  it('count an overdue item', () => {
    const totals = totalsFor([
      { payload: { dueAt: '2020-01-01', status: 'doing' } },
    ] as never);

    expect(totals.overdue).toBe(1);
  });

  it('do not call a finished item overdue', () => {
    const totals = totalsFor([
      { payload: { dueAt: '2020-01-01', status: 'done' } },
      { payload: { dueAt: '2020-01-01', status: 'paid' } },
      { payload: { dueAt: '2020-01-01', status: 'met' } },
    ] as never);

    expect(totals.overdue).toBe(0);
  });

  it('do not call a future item overdue', () => {
    expect(
      totalsFor([{ payload: { dueAt: '2999-01-01', status: 'doing' } }] as never)
        .overdue,
    ).toBe(0);
  });
});

describe('the collection registry', () => {
  it('names the three packages', () => {
    expect(Object.keys(COLLECTIONS).sort()).toEqual([
      'commerce',
      'contacts',
      'work',
    ]);
  });

  it('recognises its own slugs and nothing else', () => {
    expect(isCollectionSlug('work')).toBe(true);
    expect(isCollectionSlug('everything')).toBe(false);
  });
});
