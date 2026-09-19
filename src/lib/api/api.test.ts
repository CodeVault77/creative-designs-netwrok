import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser, createMap, getMap } from '@/lib/db/repo';
import {
  authenticate,
  issueKey,
  listKeys,
  MAX_KEYS_PER_USER,
  recordRequest,
  requestsInWindow,
  revokeKey,
  revokeInstallationKeys,
} from './keys';
import {
  ALL_SCOPES,
  covers,
  formatScopes,
  isMutating,
  isScope,
  narrow,
  parseScopes,
} from './scopes';
import { apiGetMap, apiListMaps, apiWriteNode } from './resources';

/**
 * Public API tests.
 *
 * The properties worth most here are all negative, and all the same shape:
 * **a key cannot do more than its owner.** A public API is the largest attack
 * surface this codebase has — long-lived credentials, called by machines, with
 * nobody watching — so most of what follows tries to get more than was given.
 */

let db: Database;
let owner: { userId: string; isStaff: boolean };
let stranger: { userId: string; isStaff: boolean };

function makeMap(ctx: { userId: string; isStaff: boolean }, id: string) {
  createMap(
    ctx,
    {
      id,
      title: 'A map',
      family: 'create',
      visibility: 'private',
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
      },
    },
    db,
  );
}

beforeEach(() => {
  db = createTestDb();

  createUser(
    {
      id: 'u_owner',
      email: 'owner@example.com',
      passwordHash: 'x',
      handle: 'owner',
      displayName: 'Owner',
    },
    db,
  );

  createUser(
    {
      id: 'u_stranger',
      email: 'stranger@example.com',
      passwordHash: 'x',
      handle: 'stranger',
      displayName: 'Stranger',
    },
    db,
  );

  owner = { userId: 'u_owner', isStaff: false };
  stranger = { userId: 'u_stranger', isStaff: false };
});

// -------------------------------------------------------------------- scopes

describe('scopes', () => {
  it('recognises exactly the published set', () => {
    expect(isScope('maps:read')).toBe(true);
    expect(isScope('maps:destroy')).toBe(false);
    expect(ALL_SCOPES.length).toBeGreaterThan(5);
  });

  it('knows that agents:run mutates despite not ending in write', () => {
    // The reason MUTATING_SCOPES is data rather than a `.endsWith(':write')`
    // convention: the convention is wrong for this one, and a convention that
    // is wrong once cannot be relied on anywhere.
    expect(isMutating('agents:run')).toBe(true);
    expect(isMutating('maps:read')).toBe(false);
  });

  it('drops an unknown scope rather than keeping or throwing on it', () => {
    // Rows outlive code. A scope removed in a later release leaves stored
    // strings naming it; dropping fails closed and stays usable.
    expect(parseScopes('maps:read retired:scope maps:write')).toEqual([
      'maps:read',
      'maps:write',
    ]);
  });

  it('serialises in a stable order so two equal sets compare equal', () => {
    expect(formatScopes(['maps:write', 'maps:read'])).toBe(
      formatScopes(['maps:read', 'maps:write']),
    );
  });

  it('never widens through narrow()', () => {
    expect(narrow(['maps:read', 'maps:write'], ['maps:read'])).toEqual([
      'maps:read',
    ]);
    expect(narrow(['agents:run'], [])).toEqual([]);
  });

  it('covers only when everything required is held', () => {
    expect(covers(['maps:read', 'maps:write'], ['maps:read'])).toBe(true);
    expect(covers(['maps:read'], ['maps:read', 'maps:write'])).toBe(false);
  });
});

// ----------------------------------------------------------------------- keys

describe('issuing a key', () => {
  it('returns the secret exactly once and never stores it', () => {
    const issued = issueKey(owner, { name: 'CI', scopes: ['maps:read'] }, db);

    expect(issued.ok).toBe(true);
    expect(issued.issued?.secret).toMatch(/^cdn_live_[0-9a-f]{8}_/);

    const stored = db
      .prepare('SELECT secret_hash FROM api_keys WHERE id = ?')
      .get(issued.issued!.key.id) as { secret_hash: string };

    // The stored value must be a digest, not the secret. A leaked database
    // must not yield working credentials.
    expect(stored.secret_hash).not.toContain(issued.issued!.secret);
    expect(stored.secret_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the secret again from a listing', () => {
    issueKey(owner, { name: 'CI', scopes: ['maps:read'] }, db);

    const listed = listKeys(owner, db);

    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toMatch(/cdn_live_[0-9a-f]{8}_/);
  });

  it('refuses a key with no permissions', () => {
    // A credential in circulation that looks like access and is not.
    expect(issueKey(owner, { name: 'Empty', scopes: [] }, db).ok).toBe(false);
  });

  it('caps how many live keys one account may hold', () => {
    for (let index = 0; index < MAX_KEYS_PER_USER; index += 1) {
      expect(
        issueKey(owner, { name: `k${index}`, scopes: ['maps:read'] }, db).ok,
      ).toBe(true);
    }

    expect(
      issueKey(owner, { name: 'one more', scopes: ['maps:read'] }, db).ok,
    ).toBe(false);
  });

  it('lets a revoked key free up its slot', () => {
    const first = issueKey(owner, { name: 'a', scopes: ['maps:read'] }, db);
    revokeKey(owner, first.issued!.key.id, db);

    // Revoked keys are kept for the request log but must not count as live.
    for (let index = 0; index < MAX_KEYS_PER_USER; index += 1) {
      expect(
        issueKey(owner, { name: `k${index}`, scopes: ['maps:read'] }, db).ok,
      ).toBe(true);
    }
  });
});

describe('authenticating a key', () => {
  it('accepts the key it issued', () => {
    const issued = issueKey(owner, { name: 'CI', scopes: ['maps:read'] }, db);

    const result = authenticate(issued.issued!.secret, db);

    expect(result.ok).toBe(true);
    expect(result.authed?.actor.userId).toBe('u_owner');
    expect(result.authed?.key.scopes).toEqual(['maps:read']);
  });

  it('never grants staff, whoever owns the key', () => {
    /*
     * The most important assertion in this file.
     *
     * Staff authority reads across ownership. A long-lived automated
     * credential holding it would read every map in the system if it leaked,
     * and there is no reason for a key to need it.
     */
    db.prepare('UPDATE users SET is_staff = 1 WHERE id = ?').run('u_owner');

    const issued = issueKey(
      { userId: 'u_owner', isStaff: true },
      { name: 'staff key', scopes: ['maps:read'] },
      db,
    );

    expect(authenticate(issued.issued!.secret, db).authed?.actor.isStaff).toBe(
      false,
    );
  });

  it('refuses a malformed key', () => {
    expect(authenticate('not-a-key', db).failure).toBe('malformed');
    expect(authenticate('', db).failure).toBe('malformed');
  });

  it('refuses a key with a real prefix and a wrong secret', () => {
    const issued = issueKey(owner, { name: 'CI', scopes: ['maps:read'] }, db);
    const prefix = issued.issued!.key.prefix;

    const forged = `cdn_live_${prefix}_${'A'.repeat(43)}`;

    expect(authenticate(forged, db).ok).toBe(false);
    // The same failure an unknown prefix gives, so a guessed prefix that
    // exists is indistinguishable from one that does not.
    expect(authenticate(forged, db).failure).toBe('unknown');
  });

  it('refuses a revoked key', () => {
    const issued = issueKey(owner, { name: 'CI', scopes: ['maps:read'] }, db);
    revokeKey(owner, issued.issued!.key.id, db);

    expect(authenticate(issued.issued!.secret, db).failure).toBe('revoked');
  });

  it('refuses an expired key', () => {
    const issued = issueKey(
      owner,
      { name: 'CI', scopes: ['maps:read'], expiresAt: '2020-01-01 00:00:00' },
      db,
    );

    expect(authenticate(issued.issued!.secret, db).failure).toBe('expired');
  });

  it('accepts a key expiring in the future', () => {
    /*
     * The timezone regression, guarded.
     *
     * SQLite writes UTC with a space separator, which `new Date()` parses as
     * LOCAL time — so comparing expiry in JavaScript shifts it by the server's
     * offset and a fresh key reads as expired west of UTC. Expiry is compared
     * in SQL for exactly this reason; this test fails if anyone moves it back.
     */
    const issued = issueKey(
      owner,
      { name: 'CI', scopes: ['maps:read'], expiresAt: '2999-01-01 00:00:00' },
      db,
    );

    expect(authenticate(issued.issued!.secret, db).ok).toBe(true);
  });

  it('will not let one person revoke another person’s key', () => {
    const issued = issueKey(owner, { name: 'CI', scopes: ['maps:read'] }, db);

    expect(revokeKey(stranger, issued.issued!.key.id, db).ok).toBe(false);
    expect(authenticate(issued.issued!.secret, db).ok).toBe(true);
  });

  it('revokes every key an installation owns, in one call', () => {
    const a = issueKey(
      owner,
      { name: 'plugin a', scopes: ['maps:read'], installationId: 'pin_1' },
      db,
    );
    const b = issueKey(
      owner,
      { name: 'plugin b', scopes: ['maps:read'], installationId: 'pin_1' },
      db,
    );
    const unrelated = issueKey(owner, { name: 'mine', scopes: ['maps:read'] }, db);

    expect(revokeInstallationKeys('pin_1', db)).toBe(2);

    expect(authenticate(a.issued!.secret, db).ok).toBe(false);
    expect(authenticate(b.issued!.secret, db).ok).toBe(false);
    expect(authenticate(unrelated.issued!.secret, db).ok).toBe(true);
  });
});

describe('the request log', () => {
  it('counts requests inside the window', () => {
    recordRequest('key_1', 'GET', '/api/v1/maps', 200, db);
    recordRequest('key_1', 'GET', '/api/v1/maps', 200, db);
    recordRequest('key_2', 'GET', '/api/v1/maps', 200, db);

    expect(requestsInWindow('key_1', 60, db)).toBe(2);
    expect(requestsInWindow('key_2', 60, db)).toBe(1);
    expect(requestsInWindow('key_3', 60, db)).toBe(0);
  });
});

// ------------------------------------------------------------------ resources

describe('what a key can reach', () => {
  beforeEach(() => {
    makeMap(owner, 'map_owned');
    makeMap(stranger, 'map_theirs');
  });

  it('lists only the owner’s maps', () => {
    const listed = apiListMaps(owner, db).map((map) => map.id);

    expect(listed).toContain('map_owned');
    expect(listed).not.toContain('map_theirs');
  });

  it('returns null for a map the owner cannot see', () => {
    // Not a filtered version of it, and not an error that confirms it exists.
    expect(apiGetMap(owner, 'map_theirs', db)).toBeNull();
  });

  it('refuses a write to a map the owner cannot write', () => {
    const result = apiWriteNode(owner, 'map_theirs', 1, { title: 'injected' }, db);

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('not_found');
  });

  it('publishes camelCase, never the column names', () => {
    const map = apiGetMap(owner, 'map_owned', db);
    const serialised = JSON.stringify(map);

    /*
     * The API shape is a promise. Publishing `parent_id` would make the
     * column name part of somebody's integration and unrenameable forever.
     */
    expect(serialised).not.toContain('parent_id');
    expect(serialised).not.toContain('map_id');
    expect(map?.nodes[0]?.parentId).toBeDefined();
  });
});

describe('writing through the API', () => {
  beforeEach(() => {
    makeMap(owner, 'map_owned');
  });

  it('creates a node and bumps the version', () => {
    const result = apiWriteNode(
      owner,
      'map_owned',
      1,
      { title: 'New node', parentId: 'map_owned-root' },
      db,
    );

    expect(result.ok).toBe(true);
    expect(result.map?.version).toBe(2);
    expect(result.map?.nodes.some((node) => node.title === 'New node')).toBe(true);
  });

  it('refuses a stale version instead of overwriting', () => {
    apiWriteNode(owner, 'map_owned', 1, { title: 'First' }, db);

    const stale = apiWriteNode(owner, 'map_owned', 1, { title: 'Second' }, db);

    expect(stale.ok).toBe(false);
    expect(stale.failure).toBe('conflict');
    // The current version comes back so a client can re-read rather than guess.
    expect(stale.currentVersion).toBe(2);
  });

  it('validates a payload against the type that owns it', () => {
    const result = apiWriteNode(
      owner,
      'map_owned',
      1,
      { title: 'Bad link', type: 'link', payload: { url: 'not a url' } },
      db,
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('invalid_payload');
  });

  it('accepts a payload for a package type', () => {
    // Proves the commerce/CRM/project packages are actually registered, not
    // merely written — an unregistered type would validate as unknown.
    const result = apiWriteNode(
      owner,
      'map_owned',
      1,
      {
        title: 'Widget',
        type: 'product',
        payload: { priceCents: 1999, sku: 'W-1' },
      },
      db,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects a fractional price on a product', () => {
    const result = apiWriteNode(
      owner,
      'map_owned',
      1,
      { title: 'Widget', type: 'product', payload: { priceCents: 19.99 } },
      db,
    );

    // priceCents is an integer number of cents. A float here is the rounding
    // error the whole convention exists to prevent.
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('invalid_payload');
  });

  it('keeps a node’s slot across an update', () => {
    /*
     * ADR-0002: angular position is assigned once and persisted, because the
     * stability of position is what makes a map learnable. An API that
     * re-slotted on every write would rearrange somebody's map whenever an
     * integration touched a title.
     */
    const created = apiWriteNode(
      owner,
      'map_owned',
      1,
      { id: 'nod_fixed', title: 'A', parentId: 'map_owned-root' },
      db,
    );

    const before = db
      .prepare('SELECT slot FROM map_nodes WHERE id = ?')
      .get('nod_fixed') as { slot: number };

    apiWriteNode(
      owner,
      'map_owned',
      created.map!.version,
      {
        id: 'nod_fixed',
        title: 'B',
      },
      db,
    );

    const after = db
      .prepare('SELECT slot FROM map_nodes WHERE id = ?')
      .get('nod_fixed') as { slot: number };

    expect(after.slot).toBe(before.slot);
  });

  it('clamps weight into the range the renderer can draw', () => {
    const result = apiWriteNode(
      owner,
      'map_owned',
      1,
      { title: 'Heavy', weight: 99 },
      db,
    );

    const node = result.map?.nodes.find((candidate) => candidate.title === 'Heavy');
    expect(node?.weight).toBe(1);
  });

  it('leaves the map untouched when the write is refused', () => {
    const before = getMap(owner, 'map_owned', db)!.version;

    apiWriteNode(
      owner,
      'map_owned',
      1,
      {
        title: 'Bad',
        type: 'link',
        payload: { url: 'nope' },
      },
      db,
    );

    expect(getMap(owner, 'map_owned', db)!.version).toBe(before);
  });
});
