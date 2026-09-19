import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser, type AuthContext } from '@/lib/db/repo';
import { createDraft } from '@/lib/editor/draft';
import {
  ensureSeeded,
  feed,
  getInterests,
  getItem,
  listInterests,
  saveItem,
  setInterests,
} from './repo';
import { INTEREST_TAGS, SEED_ITEMS, seededTagCoverage } from './seed';

/**
 * §20 rates this phase's risk as "cold-start emptiness".
 *
 * That is not a risk a unit test can catch by asserting a function returns
 * something — it is a content risk. So the first block below tests the SEED
 * itself, which is the mitigation §13 names: enough items, spread across every
 * interest, so that no single selection lands on an empty feed.
 */

let db: Database;
let alice: AuthContext;
let bob: AuthContext;

beforeEach(() => {
  db = createTestDb();
  const a = createUser(
    {
      id: 'u_alice',
      email: 'a@example.com',
      passwordHash: 'x',
      handle: 'alice',
      displayName: 'Alice',
    },
    db,
  );
  const b = createUser(
    {
      id: 'u_bob',
      email: 'b@example.com',
      passwordHash: 'x',
      handle: 'bob',
      displayName: 'Bob',
    },
    db,
  );
  alice = { userId: a.id, isStaff: false };
  bob = { userId: b.id, isStaff: false };
  ensureSeeded(db);
});

// ------------------------------------------------------------- the cold start

describe('the seed, which is the cold-start mitigation', () => {
  // §13: "seed 60–100 pages ... before launch".
  it('has between 60 and 100 items', () => {
    expect(SEED_ITEMS.length).toBeGreaterThanOrEqual(60);
    expect(SEED_ITEMS.length).toBeLessThanOrEqual(100);
  });

  /**
   * The specific way cold start bites: a user picks the one interest they care
   * about and the feed is empty. Every tag in the picker must carry content.
   */
  it('leaves NO interest without content', () => {
    const coverage = seededTagCoverage();
    const empty = INTEREST_TAGS.filter((tag) => !coverage.get(tag.tag));
    expect(empty.map((t) => t.tag)).toEqual([]);
  });

  it('gives every interest enough content to look alive', () => {
    const coverage = seededTagCoverage();
    const thin = INTEREST_TAGS.filter((tag) => (coverage.get(tag.tag) ?? 0) < 3);
    expect(thin.map((t) => t.tag)).toEqual([]);
  });

  /** The picker teaches the colour system, so it needs all six families. */
  it('spans every family', () => {
    expect(new Set(INTEREST_TAGS.map((t) => t.family)).size).toBe(6);
  });

  it('has no duplicate ids or tags', () => {
    expect(new Set(SEED_ITEMS.map((i) => i.id)).size).toBe(SEED_ITEMS.length);
    expect(new Set(INTEREST_TAGS.map((t) => t.tag)).size).toBe(
      INTEREST_TAGS.length,
    );
  });

  it('only uses tags that exist in the vocabulary', () => {
    const known = new Set(INTEREST_TAGS.map((t) => t.tag));
    const unknown = SEED_ITEMS.flatMap((i) => i.tags).filter((t) => !known.has(t));
    expect(unknown).toEqual([]);
  });

  it('writes real copy, not placeholders', () => {
    for (const seed of SEED_ITEMS) {
      expect(seed.title.length).toBeGreaterThan(10);
      expect(seed.excerpt.length).toBeGreaterThan(20);
      expect(seed.source.length).toBeGreaterThan(1);
      expect(seed.title.toLowerCase()).not.toContain('lorem');
    }
  });

  it('is idempotent — seeding twice does not double the feed', () => {
    const before = feed(alice, { tags: [], limit: 50 }, db).total;
    ensureSeeded(db);
    ensureSeeded(db);
    expect(feed(alice, { tags: [], limit: 50 }, db).total).toBe(before);
  });

  /**
   * §13's honesty rule. Seeded content is ours, not the community's, and the
   * card says so. Passing seeds off as activity is hard to walk back.
   */
  it('marks seeded items as seeded', () => {
    const page = feed(alice, { tags: [], limit: 5 }, db);
    expect(page.items.every((item) => item.seeded)).toBe(true);
  });
});

// -------------------------------------------------------------- the interests

describe('the interest picker', () => {
  it('offers every tag with a live count', () => {
    const options = listInterests(alice, db);
    expect(options).toHaveLength(INTEREST_TAGS.length);
    expect(options.every((option) => option.count > 0)).toBe(true);
  });

  it('remembers a selection', () => {
    setInterests(alice, ['design', 'research'], db);
    expect(getInterests(alice, db)).toEqual(['design', 'research']);

    const options = listInterests(alice, db);
    expect(
      options
        .filter((o) => o.selected)
        .map((o) => o.tag)
        .sort(),
    ).toEqual(['design', 'research']);
  });

  it('replaces rather than appends, so deselecting works', () => {
    setInterests(alice, ['design', 'research'], db);
    setInterests(alice, ['design'], db);
    expect(getInterests(alice, db)).toEqual(['design']);
  });

  it("keeps one user out of another user's interests", () => {
    setInterests(alice, ['design'], db);
    expect(getInterests(bob, db)).toEqual([]);
  });

  /**
   * The vocabulary is fixed. Without the foreign key a caller could store
   * arbitrary strings against a user, and from then on nothing validates that
   * column.
   */
  it('refuses a tag outside the vocabulary', () => {
    expect(() => setInterests(alice, ['not-a-real-tag'], db)).toThrow();
  });
});

// -------------------------------------------------------------------- ranking

describe('the feed', () => {
  it('returns items when nothing is selected', () => {
    const page = feed(alice, { tags: [], limit: 10 }, db);
    expect(page.items).toHaveLength(10);
    expect(page.total).toBe(SEED_ITEMS.length);
  });

  /**
   * §20 asks for "simple relevance ranking". Simple means explainable: more
   * matched interests ranks higher, then newer.
   */
  it('ranks items matching more interests first', () => {
    const page = feed(alice, { tags: ['design', 'process'], limit: 20 }, db);
    const matchCounts = page.items.map((item) => item.matchedTags.length);
    const sorted = [...matchCounts].sort((a, b) => b - a);
    expect(matchCounts).toEqual(sorted);
    expect(matchCounts[0]).toBeGreaterThanOrEqual(2);
  });

  it('breaks ties by recency', () => {
    const page = feed(alice, { tags: ['design'], limit: 20 }, db);
    const singles = page.items.filter((i) => i.matchedTags.length === 1);
    const dates = singles.map((i) => i.publishedAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  /**
   * A filter that quietly includes what you did not ask for is not a filter,
   * and the user has no way to tell the two apart on screen.
   */
  it('excludes items matching none of the selected interests', () => {
    const page = feed(alice, { tags: ['design'], limit: 50 }, db);
    expect(page.items.every((item) => item.tags.includes('design'))).toBe(true);
  });

  it('tells the user why each card appeared', () => {
    const page = feed(alice, { tags: ['design', 'branding'], limit: 5 }, db);
    for (const item of page.items) {
      expect(item.matchedTags.length).toBeGreaterThan(0);
      expect(
        item.matchedTags.every((t) => ['design', 'branding'].includes(t)),
      ).toBe(true);
    }
  });

  it('finds content for every single interest on its own', () => {
    for (const tag of INTEREST_TAGS) {
      const page = feed(alice, { tags: [tag.tag], limit: 5 }, db);
      expect(page.items.length, `no content for ${tag.tag}`).toBeGreaterThan(0);
    }
  });
});

// ----------------------------------------------------------------- pagination

describe('keyset pagination', () => {
  /**
   * OFFSET pagination on an infinite list re-scans what it already returned
   * and shifts by one whenever a row is inserted above — which the user sees
   * as a card appearing twice, or vanishing, halfway down the feed.
   */
  it('walks the whole feed without repeating or skipping an item', () => {
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 40; page++) {
      const result = feed(alice, { tags: [], limit: 7, cursor }, db);
      seen.push(...result.items.map((i) => i.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(SEED_ITEMS.length);
    expect(new Set(seen).size).toBe(SEED_ITEMS.length);
  });

  it('paginates a filtered feed the same way', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    const total = feed(alice, { tags: ['design'], limit: 3 }, db).total;

    for (let page = 0; page < 40; page++) {
      const result = feed(alice, { tags: ['design'], limit: 3, cursor }, db);
      seen.push(...result.items.map((i) => i.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(new Set(seen).size).toBe(total);
  });

  it('clamps an absurd page size rather than serving it', () => {
    // A client asking for 500 rows per scroll is a client that will ask for
    // 50,000 next. The cap is the server's, not the caller's.
    const page = feed(alice, { tags: [], limit: 500 }, db);
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });

  it('reports no next cursor on the final page', () => {
    let cursor: string | null = null;
    let last = feed(alice, { tags: [], limit: 50 }, db);
    cursor = last.nextCursor;

    while (cursor) {
      last = feed(alice, { tags: [], limit: 50, cursor }, db);
      cursor = last.nextCursor;
    }

    expect(last.nextCursor).toBeNull();
    expect(last.items.length).toBeGreaterThan(0);
  });

  it('restarts rather than failing on a malformed cursor', () => {
    const page = feed(alice, { tags: [], limit: 5, cursor: 'not-a-cursor' }, db);
    expect(page.items).toHaveLength(5);
  });
});

// -------------------------------------------------------------- saving, roles

describe('saving', () => {
  it('saves and unsaves', () => {
    const first = feed(alice, { tags: [], limit: 1 }, db).items[0]!;

    expect(saveItem(alice, first.id, true, db)).toBe(true);
    expect(
      feed(alice, { tags: [], limit: 1, savedOnly: true }, db).items[0]?.id,
    ).toBe(first.id);

    saveItem(alice, first.id, false, db);
    expect(
      feed(alice, { tags: [], limit: 5, savedOnly: true }, db).items,
    ).toHaveLength(0);
  });

  it('is idempotent', () => {
    const first = feed(alice, { tags: [], limit: 1 }, db).items[0]!;
    saveItem(alice, first.id, true, db);
    saveItem(alice, first.id, true, db);
    expect(feed(alice, { tags: [], limit: 5, savedOnly: true }, db).total).toBe(1);
  });

  it("keeps one user out of another user's saves", () => {
    const first = feed(alice, { tags: [], limit: 1 }, db).items[0]!;
    saveItem(alice, first.id, true, db);
    expect(
      feed(bob, { tags: [], limit: 5, savedOnly: true }, db).items,
    ).toHaveLength(0);
  });

  /** A save against an unknown id must not become a way to probe for ids. */
  it('refuses to save something that is not visible', () => {
    expect(saveItem(alice, 'c_does_not_exist', true, db)).toBe(false);
  });
});

// ----------------------------------------------------------------- visibility

describe('visibility', () => {
  /**
   * `content_items` is a denormalised index. Trusting it on its own is the
   * same mistake the search index would have been — unpublish a map and its
   * card sits in the feed until something sweeps it.
   */
  it('drops an item whose map stops being public', () => {
    const draft = createDraft('m_pub', 'A public map', 'create');
    draft.visibility = 'public';
    createMap(alice, draft, db);

    db.prepare(
      `INSERT INTO content_items (id, kind, href, title, excerpt, source, family, map_id, owner_id)
       VALUES ('c_map', 'map', '/maps/m_pub', 'A public map', 'excerpt here', 'Alice', 'create', 'm_pub', 'u_alice')`,
    ).run();
    db.prepare(
      `INSERT INTO content_tags (item_id, tag) VALUES ('c_map', 'design')`,
    ).run();

    expect(getItem(bob, 'c_map', db)).not.toBeNull();

    db.prepare(`UPDATE maps SET visibility = 'private' WHERE id = 'm_pub'`).run();

    expect(getItem(bob, 'c_map', db)).toBeNull();
    expect(
      feed(bob, { tags: ['design'], limit: 50 }, db).items.some(
        (i) => i.id === 'c_map',
      ),
    ).toBe(false);
  });

  it('keeps counting only what is visible', () => {
    const before = listInterests(alice, db).find((o) => o.tag === 'design')!.count;

    const draft = createDraft('m_pub2', 'Another public map', 'create');
    draft.visibility = 'public';
    createMap(alice, draft, db);
    db.prepare(
      `INSERT INTO content_items (id, kind, href, title, excerpt, source, family, map_id, owner_id)
       VALUES ('c_map2', 'map', '/maps/m_pub2', 'Another', 'excerpt here', 'Alice', 'create', 'm_pub2', 'u_alice')`,
    ).run();
    db.prepare(
      `INSERT INTO content_tags (item_id, tag) VALUES ('c_map2', 'design')`,
    ).run();

    expect(listInterests(alice, db).find((o) => o.tag === 'design')!.count).toBe(
      before + 1,
    );

    db.prepare(`UPDATE maps SET visibility = 'private' WHERE id = 'm_pub2'`).run();
    expect(listInterests(alice, db).find((o) => o.tag === 'design')!.count).toBe(
      before,
    );
  });

  it('returns null for an item that does not exist', () => {
    expect(getItem(alice, 'c_nope', db)).toBeNull();
  });
});
