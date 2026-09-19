import { describe, expect, it, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser, saveMap, type AuthContext } from '@/lib/db/repo';
import { createDraft } from '@/lib/editor/draft';
import { search, snippetFor, toMatchExpression } from './query';
import { EMPTY_FILTERS, MIN_QUERY_LENGTH } from './types';
import type { DraftNode } from '@/lib/editor/types';

/**
 * §20 rates "permission leakage via search" as this phase's High risk.
 *
 * Search is where authorisation bugs hide best: the map, the editor and the
 * share route each read ONE map, so a mistake is visible. Search reads EVERY
 * map at once — a missing predicate returns a stranger's private notes ranked
 * by relevance, and nobody notices until it is quoted back at them.
 *
 * So the tests below are mostly negative: they assert that things do NOT come
 * back. Every secret is a unique marker, so a leak is unambiguous.
 */

let db: Database;
let alice: AuthContext;
let bob: AuthContext;
let staff: AuthContext;

const SECRET = 'ZEBRAFISH';

function makeUser(name: string, isStaff = false): AuthContext {
  const user = createUser(
    {
      id: `u_${name}`,
      email: `${name}@example.com`,
      passwordHash: 'scrypt$16384$c2FsdA==$aGFzaA==',
      handle: name,
      displayName: `${name} person`,
    },
    db,
  );
  if (isStaff)
    db.prepare('UPDATE users SET is_staff = 1 WHERE id = ?').run(user.id);
  return { userId: user.id, isStaff };
}

/** Creates a map with a node whose title and description are controllable. */
function seedMap(
  ctx: AuthContext,
  id: string,
  title: string,
  node: Partial<DraftNode>,
  visibility: 'private' | 'link' | 'public' = 'private',
  nodeViewable = true,
) {
  let draft = createDraft(id, title, 'create');
  draft = { ...draft, visibility };

  const child: DraftNode = {
    id: `${id}-n1`,
    map_id: id,
    parent_id: draft.rootId,
    slot: 0,
    title: 'Child node',
    family: 'create',
    type: 'topic',
    status: 'active',
    visibility: 'inherit',
    weight: 0.5,
    ...node,
  };

  draft = { ...draft, nodes: { ...draft.nodes, [child.id]: child } };
  createMap(ctx, draft, db);
  db.prepare('UPDATE maps SET node_viewable = ? WHERE id = ?').run(
    nodeViewable ? 1 : 0,
    id,
  );
  return child;
}

function run(ctx: AuthContext, query: string, filters = EMPTY_FILTERS) {
  return search(ctx, query, filters, db);
}

beforeEach(() => {
  db = createTestDb();
  alice = makeUser('alice');
  bob = makeUser('bob');
  staff = makeUser('staff', true);
});

// ------------------------------------------------------- the leakage risk

describe('permission leakage — the High risk', () => {
  beforeEach(() => {
    seedMap(alice, 'm_alice', 'Alice map', {
      title: `${SECRET} in a title`,
      description: `${SECRET} in a description`,
    });
  });

  it("does not return another user's private node", () => {
    const results = run(bob, SECRET).results;
    expect(results).toHaveLength(0);
  });

  it('leaves no trace of it in the response at all', () => {
    // §08 screen 06: "Private results excluded silently, never teased." No
    // count, no placeholder, no "3 results you cannot see".
    //
    // Asserted on the RESULTS rather than the whole response, because the
    // response echoes the query back — and the query is the searcher's own
    // input, not data leaked to them.
    const response = run(bob, SECRET);
    expect(JSON.stringify(response.results)).not.toContain(SECRET);
    expect(JSON.stringify(response.grouped)).not.toContain(SECRET);
    expect(response.total).toBe(0);
  });

  it('returns it to the owner', () => {
    expect(run(alice, SECRET).results.length).toBeGreaterThan(0);
  });

  it('does not return it to a signed-out visitor', () => {
    const anon = { userId: '', isStaff: false };
    expect(run(anon, SECRET).results).toHaveLength(0);
  });

  it('returns it to a member once they are invited', () => {
    db.prepare(
      'INSERT INTO map_members (map_id, user_id, role, added_at) VALUES (?, ?, ?, ?)',
    ).run('m_alice', bob.userId, 'viewer', new Date().toISOString());

    expect(run(bob, SECRET).results.length).toBeGreaterThan(0);
  });

  it('returns it to staff, for moderation', () => {
    expect(run(staff, SECRET).results.length).toBeGreaterThan(0);
  });

  it('finds a public map for anyone', () => {
    seedMap(
      alice,
      'm_public',
      'Public map',
      { title: 'PUBLICWORD here' },
      'public',
    );
    expect(run(bob, 'PUBLICWORD').results.length).toBeGreaterThan(0);
  });

  it('does NOT surface a link-only map to someone without the link', () => {
    // A link-viewable map is reachable only with the token. Surfacing it in
    // search would make "link" mean "public".
    seedMap(alice, 'm_link', 'Link map', { title: 'LINKWORD here' }, 'link');
    expect(run(bob, 'LINKWORD').results).toHaveLength(0);
  });
});

describe('private nodes inside a visible map', () => {
  beforeEach(() => {
    seedMap(
      alice,
      'm_shared',
      'Shared map',
      { title: `${SECRET} private node`, visibility: 'private' },
      'public',
    );
  });

  it('never matches a private node, even in a public map', () => {
    // The map is readable; the node is not. P7 excludes it from the payload,
    // and search must agree — otherwise search finds what the payload hides.
    expect(run(bob, SECRET).results).toHaveLength(0);
  });

  it('still matches the rest of the map', () => {
    expect(run(bob, 'Shared').results.length).toBeGreaterThan(0);
  });

  it('excludes descendants of a private node', () => {
    const map = db
      .prepare('SELECT root_id FROM maps WHERE id = ?')
      .get('m_shared') as {
      root_id: string;
    };
    expect(map.root_id).toBeTruthy();

    db.prepare(
      `INSERT INTO map_nodes (id, map_id, parent_id, slot, title, family, type, status, visibility, weight)
       VALUES (?, ?, ?, 0, ?, 'create', 'topic', 'active', 'inherit', 0.5)`,
    ).run('m_shared-child', 'm_shared', 'm_shared-n1', `${SECRET}CHILD deeper`);

    expect(run(bob, `${SECRET}CHILD`).results).toHaveLength(0);
    // The owner still sees it.
    expect(run(alice, `${SECRET}CHILD`).results.length).toBeGreaterThan(0);
  });
});

describe('node-viewable OFF — search must not become an oracle', () => {
  beforeEach(() => {
    seedMap(
      alice,
      'm_shape',
      'Shape map',
      { title: 'Visible title', description: `${SECRET} hidden body` },
      'public',
      false,
    );
  });

  it('does not match on a description an outsider may not read', () => {
    /*
     * The subtle one. §15 says those viewers never receive descriptions. If a
     * description could still produce a hit, search answers the question the
     * payload refuses: type a guess, see whether a result appears, and the
     * text is confirmed without ever being sent.
     */
    expect(run(bob, SECRET).results).toHaveLength(0);
  });

  it('still matches on the title', () => {
    expect(run(bob, 'Visible').results.length).toBeGreaterThan(0);
  });

  it('returns no snippet for an outsider, since a snippet IS the body', () => {
    const hit = run(bob, 'Visible').results.find((r) => r.group === 'nodes');
    expect(hit?.snippet).toBeUndefined();
  });

  it('matches the description for the owner', () => {
    expect(run(alice, SECRET).results.length).toBeGreaterThan(0);
  });

  it('matches the description for a member', () => {
    db.prepare(
      'INSERT INTO map_members (map_id, user_id, role, added_at) VALUES (?, ?, ?, ?)',
    ).run('m_shape', bob.userId, 'viewer', new Date().toISOString());

    expect(run(bob, SECRET).results.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ index

describe('the index stays in step with the data', () => {
  it('indexes a node as soon as its map is created', () => {
    seedMap(alice, 'm1', 'Map', { title: 'FINDME now' });
    expect(run(alice, 'FINDME').results.length).toBeGreaterThan(0);
  });

  it('drops a node from the index when it is deleted', () => {
    // P5 replaces the whole node set on every save, so the delete path is
    // exercised constantly. A stale index would keep returning ghosts.
    seedMap(alice, 'm1', 'Map', { title: 'GHOSTWORD here' });
    expect(run(alice, 'GHOSTWORD').results.length).toBeGreaterThan(0);

    const map = db
      .prepare('SELECT root_id, version FROM maps WHERE id = ?')
      .get('m1') as {
      root_id: string;
      version: number;
    };
    const rootRow = db
      .prepare('SELECT * FROM map_nodes WHERE id = ?')
      .get(map.root_id) as Record<string, unknown>;

    saveMap(
      alice,
      'm1',
      map.version,
      {
        nodes: {
          [map.root_id]: {
            id: map.root_id,
            map_id: 'm1',
            parent_id: null,
            slot: 0,
            title: String(rootRow['title']),
            family: 'create',
            type: 'topic',
            status: 'active',
            visibility: 'inherit',
            weight: 1,
          },
        },
      },
      db,
    );

    expect(run(alice, 'GHOSTWORD').results).toHaveLength(0);
  });

  it('follows a map rename', () => {
    seedMap(alice, 'm1', 'BEFOREWORD map', { title: 'plain child' });
    expect(run(alice, 'BEFOREWORD').results.some((r) => r.group === 'maps')).toBe(
      true,
    );

    db.prepare('UPDATE maps SET title = ? WHERE id = ?').run('AFTERWORD map', 'm1');

    expect(run(alice, 'BEFOREWORD').results.some((r) => r.group === 'maps')).toBe(
      false,
    );
    expect(run(alice, 'AFTERWORD').results.some((r) => r.group === 'maps')).toBe(
      true,
    );
  });

  it('follows a node rename', () => {
    // Separate from the map rename on purpose: `createDraft` gives the ROOT
    // NODE the map's title, and renaming the map does not rename that node.
    // The two indexes move independently, and conflating them hid that.
    seedMap(alice, 'm2', 'Map two', { title: 'NODEBEFORE text' });
    expect(run(alice, 'NODEBEFORE').results.length).toBeGreaterThan(0);

    db.prepare('UPDATE map_nodes SET title = ? WHERE id = ?').run(
      'NODEAFTER text',
      'm2-n1',
    );

    expect(run(alice, 'NODEBEFORE').results).toHaveLength(0);
    expect(run(alice, 'NODEAFTER').results.length).toBeGreaterThan(0);
  });

  it('drops everything when a map is deleted', () => {
    seedMap(alice, 'm1', 'Map', { title: 'VANISHWORD here' });
    db.prepare('DELETE FROM maps WHERE id = ?').run('m1');
    expect(run(alice, 'VANISHWORD').results).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ query

describe('query parsing', () => {
  it('requires every term, not any', () => {
    // OR would return anything sharing one common word, which reads as the
    // search being broken. Every term is also prefix-wildcarded so
    // suggestions match while the last word is still being typed.
    expect(toMatchExpression('alpha beta')).toBe('"alpha"* AND "beta"*');
  });

  it('adds a prefix wildcard so suggestions match while typing', () => {
    expect(toMatchExpression('map')).toBe('"map"*');
  });

  it('strips FTS5 syntax from user input', () => {
    // Unescaped, `"` and `*` are at best a syntax error the user cannot
    // understand, and at worst a way to query columns we did not intend.
    const expression = toMatchExpression('a"b* NEAR(x) ^col:');
    expect(expression).not.toContain('^');
    expect(expression).not.toContain(':');
    expect(expression?.split('"').length).toBeGreaterThan(1);
  });

  it('returns null for an empty or punctuation-only query', () => {
    expect(toMatchExpression('')).toBeNull();
    expect(toMatchExpression('   ')).toBeNull();
    expect(toMatchExpression('***')).toBeNull();
  });

  it('does not run below the minimum length', () => {
    seedMap(alice, 'm1', 'Map', { title: 'aa bb' });
    expect(run(alice, 'a').results).toHaveLength(0);
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it('does not crash on a very long query', () => {
    expect(() => run(alice, 'x'.repeat(2000))).not.toThrow();
  });

  it('does not crash on SQL-ish input', () => {
    expect(() => run(alice, "'; DROP TABLE maps; --")).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM maps').get()).toBeTruthy();
  });
});

describe('snippets', () => {
  it('centres on the first matched term', () => {
    const text = `${'a'.repeat(200)} ${SECRET} ${'b'.repeat(200)}`;
    expect(snippetFor(text, SECRET)).toContain(SECRET);
  });

  it('falls back to the opening when the match was in the title', () => {
    expect(snippetFor('Some description here', 'nothing')).toContain('Some');
  });

  it('returns empty for empty text', () => {
    expect(snippetFor('', 'x')).toBe('');
  });
});

// ---------------------------------------------------------------- filters

describe('filters', () => {
  beforeEach(() => {
    seedMap(alice, 'm1', 'Filter map', {
      title: 'FILTERWORD alpha',
      family: 'commerce',
    });
  });

  it('filters by family', () => {
    expect(
      run(alice, 'FILTERWORD', { ...EMPTY_FILTERS, families: ['commerce'] }).results
        .length,
    ).toBeGreaterThan(0);
    expect(
      run(alice, 'FILTERWORD', { ...EMPTY_FILTERS, families: ['people'] }).results,
    ).toHaveLength(0);
  });

  it('excludes Coming Soon under Live only', () => {
    /*
     * §11: several ring-one nodes are still dark (ADR-0001 and its
     * amendments), so without this filter a search for almost anything is
     * partly things that do not exist yet.
     *
     * The query is "ideas" because it matches BOTH a dark node
     * (Ideas & Innovation) and a live one (Mind Mapping, whose description
     * opens "Map ideas, projects and everything"). It used to be "commerce",
     * which stopped exercising anything the moment Commerce & Payments went
     * live — the assertion still read as passing while testing nothing.
     */
    const all = run(alice, 'ideas').results;
    const live = run(alice, 'ideas', {
      ...EMPTY_FILTERS,
      liveOnly: true,
    }).results;

    expect(all.some((r) => r.status === 'coming_soon')).toBe(true);
    expect(live.every((r) => r.status === 'active')).toBe(true);
    // Non-empty, so `every` above cannot pass by having nothing to check.
    expect(live.length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------- community

describe('the Community Map', () => {
  it('is searchable without an account', () => {
    // §24 measures arrival for people who do not have one.
    const anon = { userId: '', isStaff: false };
    expect(run(anon, 'Mind Mapping').results.length).toBeGreaterThan(0);
  });

  it('ranks a title match above a body match', () => {
    const results = run({ userId: '', isStaff: false }, 'Page Watcher').results;
    expect(results[0]?.title).toContain('Page Watcher');
  });

  it('carries a path so a result is placeable', () => {
    // §11: "path is what makes a result trustworthy in a spatial product."
    const hit = run({ userId: '', isStaff: false }, 'Mind Mapping').results[0];
    expect(hit?.path.length).toBeGreaterThan(0);
  });

  it('sends Coming Soon results to their Coming Soon page', () => {
    const hit = run({ userId: '', isStaff: false }, 'AI Tools').results.find(
      (r) => r.status === 'coming_soon',
    );
    expect(hit?.href).toContain('/soon/');
  });
});

describe('people', () => {
  it('finds a person by display name', () => {
    expect(run(bob, 'alice person').results.some((r) => r.group === 'people')).toBe(
      true,
    );
  });

  it('never matches on email', () => {
    // Otherwise the search box is an address-confirmation oracle: type an
    // address, see whether a person comes back.
    //
    // Checked on the results, not the whole response — the response echoes
    // the query, which is the searcher's own input.
    const response = run(bob, 'alice@example.com');
    expect(response.results.filter((r) => r.group === 'people')).toHaveLength(0);
    expect(JSON.stringify(response.results)).not.toContain('@example.com');
  });
});

describe('grouping and shape', () => {
  it('caps suggestions per group', () => {
    for (let i = 0; i < 10; i++) {
      seedMap(alice, `m${i}`, `Capped map ${i}`, { title: 'CAPWORD' });
    }
    const response = run(alice, 'CAPWORD');
    expect(response.grouped.nodes.length).toBeLessThanOrEqual(4);
    expect(response.grouped.maps.length).toBeLessThanOrEqual(4);
  });

  it('reports its own timing so the budget can be measured', () => {
    expect(run(alice, 'anything').ms).toBeGreaterThanOrEqual(0);
  });
});
