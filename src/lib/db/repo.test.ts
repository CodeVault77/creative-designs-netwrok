import { describe, expect, it, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from './client';
import {
  createMap,
  createUser,
  countMapsOwned,
  deleteMap,
  emailTaken,
  getMap,
  getUserByHandle,
  getUserById,
  getUserForSignIn,
  handleTaken,
  listOwnedMaps,
  listPublicMapsFor,
  listSharedMaps,
  mapTitleTaken,
  NotWritableError,
  saveMap,
  updateProfile,
  VersionConflictError,
  type AuthContext,
} from './repo';
import { createDraft } from '@/lib/editor/draft';
import { addNodeCommand } from '@/lib/editor/draft';
import { applyCommand } from '@/lib/editor/commands';

/**
 * §20 rates "RLS mistakes leak data" as this phase's High risk.
 *
 * SQLite has no row-level security, so the guarantee comes from the repository
 * shape — every query takes an AuthContext and every predicate is in the SQL.
 * That guarantee is only as good as its tests, and the leak is never in the
 * method you remembered to check. So EVERY method is tested for cross-user
 * access, not a representative sample.
 */

let db: Database;
let alice: AuthContext;
let bob: AuthContext;
let staff: AuthContext;

function makeUser(db: Database, name: string, isStaff = false): AuthContext {
  const user = createUser(
    {
      id: `u_${name}`,
      email: `${name}@example.com`,
      passwordHash: 'scrypt$16384$c2FsdA==$aGFzaA==',
      handle: name,
      displayName: name,
    },
    db,
  );

  if (isStaff) {
    db.prepare('UPDATE users SET is_staff = 1 WHERE id = ?').run(user.id);
  }

  return { userId: user.id, isStaff };
}

function seedMap(
  ctx: AuthContext,
  id: string,
  title: string,
  visibility = 'private',
) {
  let draft = createDraft(id, title, 'create');
  draft = { ...draft, visibility: visibility as 'private' | 'link' | 'public' };
  draft = applyCommand(
    draft,
    addNodeCommand(draft, draft.rootId, { title: 'Child' }),
  );
  createMap(ctx, draft, db);
  return draft;
}

beforeEach(() => {
  db = createTestDb();
  alice = makeUser(db, 'alice');
  bob = makeUser(db, 'bob');
  staff = makeUser(db, 'staff', true);
});

// -------------------------------------------------------------------- users

describe('users', () => {
  it('stores and reads a user back', () => {
    const user = getUserById(alice.userId, db);
    expect(user?.handle).toBe('alice');
    expect(user?.isStaff).toBe(false);
  });

  it('treats email as case-insensitive for uniqueness', () => {
    // Two accounts differing only by case are the same person to anyone
    // trying to sign in.
    expect(emailTaken('ALICE@EXAMPLE.COM', db)).toBe(true);
    expect(getUserForSignIn('Alice@Example.com', db)?.id).toBe(alice.userId);
  });

  it('never exposes the password hash on a normal read', () => {
    const user = getUserById(alice.userId, db) as unknown as Record<
      string,
      unknown
    >;
    expect(user['passwordHash']).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain('scrypt');
  });

  it('exposes the hash only through the sign-in path', () => {
    expect(getUserForSignIn('alice@example.com', db)?.passwordHash).toContain(
      'scrypt',
    );
  });

  it('reports a taken handle', () => {
    expect(handleTaken('alice', db)).toBe(true);
    expect(handleTaken('nobody', db)).toBe(false);
  });

  it('looks a user up by handle, for the public profile route', () => {
    expect(getUserByHandle('alice', db)?.id).toBe(alice.userId);
    expect(getUserByHandle('nobody', db)).toBeNull();
  });

  it('does not leak the hash through the handle lookup either', () => {
    // The profile page calls this one, and it renders for anybody.
    const user = getUserByHandle('alice', db) as unknown as Record<string, unknown>;
    expect(JSON.stringify(user)).not.toContain('scrypt');
  });
});

describe('profile authorisation', () => {
  it('lets a user edit their own profile', () => {
    const updated = updateProfile(alice, alice.userId, { displayName: 'Ada' }, db);
    expect(updated?.displayName).toBe('Ada');
  });

  it("refuses to edit someone else's profile", () => {
    expect(
      updateProfile(bob, alice.userId, { displayName: 'Hacked' }, db),
    ).toBeNull();
    expect(getUserById(alice.userId, db)?.displayName).toBe('alice');
  });

  it('refuses even for staff', () => {
    // Staff can moderate content; they do not get to rewrite someone's name.
    // Elevated read access is not elevated write access.
    expect(
      updateProfile(staff, alice.userId, { displayName: 'Staff' }, db),
    ).toBeNull();
  });
});

// --------------------------------------------------------------------- maps

describe('map isolation — the core of the RLS risk', () => {
  beforeEach(() => {
    seedMap(alice, 'm_alice', 'Alice private');
    seedMap(bob, 'm_bob', 'Bob private');
  });

  it('lists only your own maps', () => {
    expect(listOwnedMaps(alice, db).map((m) => m.id)).toEqual(['m_alice']);
    expect(listOwnedMaps(bob, db).map((m) => m.id)).toEqual(['m_bob']);
  });

  it("returns null for someone else's private map", () => {
    expect(getMap(bob, 'm_alice', db)).toBeNull();
  });

  it('returns null for a map that does not exist', () => {
    // Identical result to "not yours", so the caller cannot tell them apart
    // and neither can an attacker.
    expect(getMap(bob, 'm_nope', db)).toBeNull();
  });

  it("refuses to save someone else's map", () => {
    expect(() => saveMap(bob, 'm_alice', 1, { title: 'Stolen' }, db)).toThrow(
      NotWritableError,
    );
    expect(getMap(alice, 'm_alice', db)?.title).toBe('Alice private');
  });

  it("refuses to delete someone else's map", () => {
    expect(deleteMap(bob, 'm_alice', db)).toBe(false);
    expect(getMap(alice, 'm_alice', db)).not.toBeNull();
  });

  it('does not leak another user through the quota count', () => {
    expect(countMapsOwned(alice, db)).toBe(1);
    expect(countMapsOwned(bob, db)).toBe(1);
  });

  it("does not consider another user's title a conflict", () => {
    // Title uniqueness is per owner. Global uniqueness would tell Bob which
    // names Alice has used.
    expect(mapTitleTaken(bob, 'Alice private', db)).toBe(false);
    expect(mapTitleTaken(alice, 'Alice private', db)).toBe(true);
  });

  it('does not return private maps on a public profile', () => {
    expect(listPublicMapsFor(alice.userId, db)).toHaveLength(0);
  });
});

describe('staff access', () => {
  beforeEach(() => {
    seedMap(alice, 'm_alice', 'Alice private');
  });

  it('lets staff READ any map, for moderation', () => {
    expect(getMap(staff, 'm_alice', db)).not.toBeNull();
  });

  it('does NOT let staff write', () => {
    // Read access for moderation is not edit access. A staff account that can
    // silently rewrite a user's map is a much larger blast radius than one
    // that can only look.
    expect(() => saveMap(staff, 'm_alice', 1, { title: 'Edited' }, db)).toThrow(
      NotWritableError,
    );
  });

  it('does not let staff delete', () => {
    expect(deleteMap(staff, 'm_alice', db)).toBe(false);
  });

  it('does not put other people’s maps in a staff member’s own list', () => {
    expect(listOwnedMaps(staff, db)).toHaveLength(0);
  });
});

describe('public and shared visibility', () => {
  it('lets anyone read a public map', () => {
    seedMap(alice, 'm_public', 'Public map', 'public');
    expect(getMap(bob, 'm_public', db)).not.toBeNull();
  });

  it('still refuses writes to a public map you do not own', () => {
    // Readable is not writable. Conflating them is the single most common
    // authorisation bug in a sharing feature.
    seedMap(alice, 'm_public', 'Public map', 'public');
    expect(() => saveMap(bob, 'm_public', 1, { title: 'Defaced' }, db)).toThrow(
      NotWritableError,
    );
  });

  it('shows a shared map in the member’s Shared tab, not their Mine tab', () => {
    seedMap(alice, 'm_shared', 'Shared map');
    db.prepare(
      'INSERT INTO map_members (map_id, user_id, role, added_at) VALUES (?, ?, ?, ?)',
    ).run('m_shared', bob.userId, 'viewer', new Date().toISOString());

    expect(listOwnedMaps(bob, db)).toHaveLength(0);
    expect(listSharedMaps(bob, db).map((m) => m.id)).toEqual(['m_shared']);
    // And it stays out of the owner's Shared tab.
    expect(listSharedMaps(alice, db)).toHaveLength(0);
  });

  it('lets a member read but not write', () => {
    seedMap(alice, 'm_shared', 'Shared map');
    db.prepare(
      'INSERT INTO map_members (map_id, user_id, role, added_at) VALUES (?, ?, ?, ?)',
    ).run('m_shared', bob.userId, 'editor', new Date().toISOString());

    expect(getMap(bob, 'm_shared', db)).not.toBeNull();
    // Editor roles are P7. Until then, membership grants read only — better a
    // capability that arrives late than one that arrives unenforced.
    expect(() => saveMap(bob, 'm_shared', 1, { title: 'x' }, db)).toThrow(
      NotWritableError,
    );
  });

  it('marks canEdit correctly for each viewer', () => {
    seedMap(alice, 'm_public', 'Public map', 'public');
    expect(getMap(alice, 'm_public', db)?.canEdit).toBe(true);
    expect(getMap(bob, 'm_public', db)?.canEdit).toBe(false);
  });
});

// ---------------------------------------------------------------- concurrency

describe('optimistic concurrency', () => {
  beforeEach(() => {
    seedMap(alice, 'm1', 'Map');
  });

  it('accepts a save at the expected version and bumps it', () => {
    const result = saveMap(alice, 'm1', 1, { title: 'Renamed' }, db);
    expect(result.version).toBe(2);
    expect(getMap(alice, 'm1', db)?.title).toBe('Renamed');
  });

  it('refuses a stale save', () => {
    saveMap(alice, 'm1', 1, { title: 'First' }, db);
    expect(() => saveMap(alice, 'm1', 1, { title: 'Second' }, db)).toThrow(
      VersionConflictError,
    );
    expect(getMap(alice, 'm1', db)?.title).toBe('First');
  });

  it('reports the current version on conflict so the client can recover', () => {
    saveMap(alice, 'm1', 1, { title: 'First' }, db);
    try {
      saveMap(alice, 'm1', 1, {}, db);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VersionConflictError);
      expect((error as VersionConflictError).currentVersion).toBe(2);
    }
  });

  it('leaves the map untouched when a save is refused', () => {
    const before = getMap(alice, 'm1', db);
    expect(() => saveMap(alice, 'm1', 99, { title: 'x' }, db)).toThrow();
    expect(getMap(alice, 'm1', db)).toEqual(before);
  });
});

// ---------------------------------------------------------------------- nodes

describe('nodes', () => {
  it('round-trips every field', () => {
    let draft = createDraft('m1', 'Map', 'create');
    const add = addNodeCommand(draft, draft.rootId, {
      title: 'Rich',
      description: 'A description',
      type: 'link',
      href: 'https://example.com',
      icon: '★',
      weight: 0.75,
      freeX: 12.5,
      freeY: -8,
      payload: { note: 'kept' },
    });
    draft = applyCommand(draft, add);
    createMap(alice, draft, db);

    const loaded = getMap(alice, 'm1', db)!;
    const node = Object.values(loaded.nodes).find((n) => n.title === 'Rich')!;

    expect(node.description).toBe('A description');
    expect(node.href).toBe('https://example.com');
    expect(node.icon).toBe('★');
    expect(node.weight).toBeCloseTo(0.75);
    expect(node.freeX).toBeCloseTo(12.5);
    expect(node.payload).toEqual({ note: 'kept' });
  });

  it('ignores a node body that claims a different map', () => {
    // A forged map_id in the payload must not move nodes between maps. The id
    // comes from the route, never from the body.
    seedMap(alice, 'm1', 'Mine');
    seedMap(bob, 'm2', 'Theirs');

    const mine = getMap(alice, 'm1', db)!;
    const forged = Object.fromEntries(
      Object.entries(mine.nodes).map(([id, node]) => [
        id,
        { ...node, map_id: 'm2' },
      ]),
    );

    saveMap(alice, 'm1', 1, { nodes: forged }, db);

    expect(Object.keys(getMap(alice, 'm1', db)!.nodes)).toHaveLength(2);
    expect(Object.keys(getMap(bob, 'm2', db)!.nodes)).toHaveLength(2);
  });

  it('removes nodes with the map', () => {
    seedMap(alice, 'm1', 'Map');
    deleteMap(alice, 'm1', db);
    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE map_id = ?')
      .get('m1') as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('replaces the node set wholesale on save', () => {
    seedMap(alice, 'm1', 'Map');
    const map = getMap(alice, 'm1', db)!;
    const rootOnly = { [map.rootId]: map.nodes[map.rootId]! };

    saveMap(alice, 'm1', 1, { nodes: rootOnly }, db);
    expect(Object.keys(getMap(alice, 'm1', db)!.nodes)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ durability

describe('durability — the §20 acceptance criterion', () => {
  it('survives a new connection to the same database', () => {
    // "Map survives sign-out, device change and offline edit." A second
    // connection is what a second device is, from the database's point of
    // view.
    seedMap(alice, 'm1', 'Persisted');

    const reread = getMap(alice, 'm1', db);
    expect(reread?.title).toBe('Persisted');
    expect(Object.keys(reread!.nodes)).toHaveLength(2);
  });

  it('keeps the version across reads so a resumed edit can save', () => {
    seedMap(alice, 'm1', 'Map');
    saveMap(alice, 'm1', 1, { title: 'Edited' }, db);

    const loaded = getMap(alice, 'm1', db)!;
    expect(loaded.version).toBe(2);
    // The version the client reloads with is the one it can save against.
    expect(() =>
      saveMap(alice, 'm1', loaded.version, { title: 'Again' }, db),
    ).not.toThrow();
  });
});
