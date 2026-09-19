import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import type { FamilyName } from '@/lib/styles/tokens.generated';
import { INTEREST_TAGS, SEED_ITEMS } from './seed';

/**
 * Page Watcher's data layer.
 *
 * Like `search/query.ts`, this is a PEER of `repo.ts` rather than a consumer:
 * the feed ranks across every item at once and cannot be expressed as a series
 * of calls to `getMap`. It is held to the same standard — an AuthContext first
 * argument, and permission expressed as a SQL predicate rather than a filter
 * applied after the rows come back.
 *
 * The permission surface here is smaller than search's, because community
 * content is public by definition. The one thing that must not leak is a map
 * that has been unpublished since it was indexed, which is why every read
 * joins back to `maps` rather than trusting `content_items`.
 */

export interface FeedItem {
  id: string;
  kind: 'map' | 'service' | 'project' | 'page';
  title: string;
  excerpt: string;
  source: string;
  family: FamilyName;
  href: string;
  thumbnail: string | null;
  mapId: string | null;
  publishedAt: string;
  tags: string[];
  saved: boolean;
  /** Why this appeared. Surfaced in the UI — see the note on ranking. */
  matchedTags: string[];
  /** True for content we seeded rather than the community producing. */
  seeded: boolean;
}

export interface InterestOption {
  tag: string;
  label: string;
  family: FamilyName;
  /** §13 step 2: "each with a live content count". */
  count: number;
  selected: boolean;
}

/**
 * An item is visible when it is not attached to a map, or its map is still
 * public.
 *
 * The second half is the one that matters. `content_items` is a denormalised
 * index, and an index that is trusted on its own is the same mistake the
 * search index would have been: unpublish a map and its rows sit in the feed
 * until something sweeps them.
 */
const VISIBLE = `(
  content_items.map_id IS NULL
  OR EXISTS (
    SELECT 1 FROM maps
    WHERE maps.id = content_items.map_id
      AND maps.visibility = 'public'
  )
)`;

/**
 * Seed the content tables if they are empty.
 *
 * Idempotent and safe to call on every boot: it is a no-op the moment there is
 * a single row. Runs at first read rather than in a migration because the seed
 * is product content that will change more often than the schema, and a
 * migration that changes is not a migration.
 */
export function ensureSeeded(db: Database = getDb()): void {
  const tagCount = (
    db.prepare('SELECT COUNT(*) AS n FROM interest_tags').get() as { n: number }
  ).n;

  if (tagCount === 0) {
    const insertTag = db.prepare(
      'INSERT INTO interest_tags (tag, label, family, sort_order) VALUES (?, ?, ?, ?)',
    );
    db.transaction(() => {
      INTEREST_TAGS.forEach((tag, index) => {
        insertTag.run(tag.tag, tag.label, tag.family, index);
      });
    })();
  }

  const itemCount = (
    db.prepare('SELECT COUNT(*) AS n FROM content_items').get() as { n: number }
  ).n;

  if (itemCount > 0) return;

  const insertItem = db.prepare(
    `INSERT INTO content_items
       (id, kind, href, title, excerpt, source, family, thumbnail, map_id, owner_id, published_at)
     VALUES (@id, @kind, @href, @title, @excerpt, @source, @family, NULL, NULL, NULL,
             datetime('now', @age))`,
  );
  const insertTagLink = db.prepare(
    'INSERT INTO content_tags (item_id, tag) VALUES (?, ?)',
  );

  db.transaction(() => {
    for (const seed of SEED_ITEMS) {
      insertItem.run({
        id: seed.id,
        kind: seed.kind,
        href: seed.href,
        title: seed.title,
        excerpt: seed.excerpt,
        source: seed.source,
        family: seed.family,
        age: `-${seed.age} days`,
      });
      for (const tag of seed.tags) insertTagLink.run(seed.id, tag);
    }
  })();
}

/** The interest picker: every tag, its live count, and what this user picked. */
export function listInterests(
  ctx: AuthContext,
  db: Database = getDb(),
): InterestOption[] {
  ensureSeeded(db);

  const rows = db
    .prepare(
      `SELECT interest_tags.tag,
              interest_tags.label,
              interest_tags.family,
              (
                SELECT COUNT(*)
                FROM content_tags
                JOIN content_items ON content_items.id = content_tags.item_id
                WHERE content_tags.tag = interest_tags.tag AND ${VISIBLE}
              ) AS count,
              EXISTS (
                SELECT 1 FROM user_interests
                WHERE user_interests.tag = interest_tags.tag
                  AND user_interests.user_id = @userId
              ) AS selected
         FROM interest_tags
        ORDER BY interest_tags.sort_order`,
    )
    .all({ userId: ctx.userId }) as {
    tag: string;
    label: string;
    family: string;
    count: number;
    selected: number;
  }[];

  return rows.map((row) => ({
    tag: row.tag,
    label: row.label,
    family: row.family as FamilyName,
    count: row.count,
    selected: row.selected === 1,
  }));
}

/** §13 step 2: "Selections persist to the profile and are editable later." */
export function setInterests(
  ctx: AuthContext,
  tags: readonly string[],
  db: Database = getDb(),
): void {
  if (!ctx.userId) return;

  db.transaction(() => {
    db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(ctx.userId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO user_interests (user_id, tag) VALUES (?, ?)',
    );
    // Only tags that exist in the vocabulary. Without this a caller could
    // store arbitrary strings against a user, which is a free-text column
    // nobody validates from then on.
    for (const tag of tags) insert.run(ctx.userId, tag);
  })();
}

export function getInterests(ctx: AuthContext, db: Database = getDb()): string[] {
  if (!ctx.userId) return [];
  return (
    db
      .prepare('SELECT tag FROM user_interests WHERE user_id = ? ORDER BY tag')
      .all(ctx.userId) as { tag: string }[]
  ).map((row) => row.tag);
}

export interface FeedQuery {
  /** Interests to rank by. Empty means "show me everything". */
  tags: readonly string[];
  limit: number;
  /** Keyset cursor: the last item's rank tuple. See the note below. */
  cursor?: string | null;
  savedOnly?: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  /** Opaque; pass back to continue. Null when the feed is exhausted. */
  nextCursor: string | null;
  total: number;
}

/**
 * The feed.
 *
 * §20 asks for "simple relevance ranking", and simple is the operative word.
 * The score is:
 *
 *     matched tags  (how many of your interests this item carries)
 *     then recency
 *
 * That is deliberately not a learned ranker. With eighty items and a fixed
 * vocabulary, tag overlap IS the signal, and anything cleverer would be
 * unexplainable — which matters, because the UI tells the user WHY each card
 * appeared. A ranking you cannot explain in a chip is a ranking that feels
 * arbitrary at this size.
 *
 * Pagination is keyset, not OFFSET. An infinite list on an OFFSET query
 * re-scans everything it has already returned on every page, and shifts by one
 * whenever a row is inserted above — which shows up as a duplicated or skipped
 * card halfway down the feed.
 */
export function feed(
  ctx: AuthContext,
  query: FeedQuery,
  db: Database = getDb(),
): FeedPage {
  ensureSeeded(db);

  const tags = [...new Set(query.tags)].slice(0, 40);
  const limit = Math.min(Math.max(query.limit, 1), 50);

  // A parameter per tag, named so the SQL stays readable.
  const tagParams: Record<string, string> = {};
  tags.forEach((tag, index) => {
    tagParams[`t${index}`] = tag;
  });
  const tagList = tags.length
    ? tags.map((_, index) => `@t${index}`).join(', ')
    : `''`;

  const MATCHES = `(
    SELECT COUNT(*) FROM content_tags
     WHERE content_tags.item_id = content_items.id
       AND content_tags.tag IN (${tagList})
  )`;

  const cursor = decodeCursor(query.cursor ?? null);

  /**
   * The keyset predicate. Ordering is (matches DESC, published_at DESC, id
   * DESC), so "after" means strictly lower in that tuple. Written out in full
   * rather than with a row-value comparison, because SQLite's support for
   * those is newer than the versions this may run against.
   */
  const AFTER = cursor
    ? `AND (
         ${MATCHES} < @curMatches
         OR (${MATCHES} = @curMatches AND content_items.published_at < @curPublished)
         OR (${MATCHES} = @curMatches AND content_items.published_at = @curPublished
             AND content_items.id < @curId)
       )`
    : '';

  const SAVED_JOIN = query.savedOnly
    ? `JOIN saved_items ON saved_items.item_id = content_items.id
         AND saved_items.user_id = @userId`
    : '';

  /**
   * When interests are selected, items matching NONE of them are excluded
   * rather than ranked last. §13's feed is "pick interests, press Go" — a feed
   * that quietly includes everything you did not ask for is not a filter, and
   * the user has no way to tell which is which.
   */
  const MATCH_FILTER = tags.length ? `AND ${MATCHES} > 0` : '';

  const params = {
    ...tagParams,
    userId: ctx.userId,
    limit: limit + 1, // one extra, to know whether there is a next page
    curMatches: cursor?.matches ?? 0,
    curPublished: cursor?.publishedAt ?? '',
    curId: cursor?.id ?? '',
  };

  const rows = db
    .prepare(
      `SELECT content_items.*,
              ${MATCHES} AS matches,
              EXISTS (
                SELECT 1 FROM saved_items
                 WHERE saved_items.item_id = content_items.id
                   AND saved_items.user_id = @userId
              ) AS saved
         FROM content_items
         ${SAVED_JOIN}
        WHERE ${VISIBLE} ${MATCH_FILTER} ${AFTER}
        ORDER BY matches DESC, content_items.published_at DESC, content_items.id DESC
        LIMIT @limit`,
    )
    .all(params) as RawItem[];

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM content_items ${SAVED_JOIN}
          WHERE ${VISIBLE} ${MATCH_FILTER}`,
      )
      .get(params) as { n: number }
  ).n;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items = page.map((row) => toFeedItem(row, tags, db));
  const last = page[page.length - 1];

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            matches: last.matches,
            publishedAt: last.published_at,
            id: last.id,
          })
        : null,
    total,
  };
}

/** One item, for the in-app reader (§13 step 5). */
export function getItem(
  ctx: AuthContext,
  id: string,
  db: Database = getDb(),
): FeedItem | null {
  ensureSeeded(db);

  const row = db
    .prepare(
      `SELECT content_items.*, 0 AS matches,
              EXISTS (
                SELECT 1 FROM saved_items
                 WHERE saved_items.item_id = content_items.id
                   AND saved_items.user_id = @userId
              ) AS saved
         FROM content_items
        WHERE content_items.id = @id AND ${VISIBLE}`,
    )
    .get({ id, userId: ctx.userId }) as RawItem | undefined;

  return row ? toFeedItem(row, [], db) : null;
}

/** §13 step 4: Save. Idempotent — pressing it twice is not an error. */
export function saveItem(
  ctx: AuthContext,
  itemId: string,
  saved: boolean,
  db: Database = getDb(),
): boolean {
  if (!ctx.userId) return false;

  // Confirm the item is visible before recording anything against it, so a
  // saved list cannot be used to probe for ids that exist.
  const exists = db
    .prepare(`SELECT 1 FROM content_items WHERE id = ? AND ${VISIBLE}`)
    .get(itemId);
  if (!exists) return false;

  if (saved) {
    db.prepare(
      'INSERT OR IGNORE INTO saved_items (user_id, item_id) VALUES (?, ?)',
    ).run(ctx.userId, itemId);
  } else {
    db.prepare('DELETE FROM saved_items WHERE user_id = ? AND item_id = ?').run(
      ctx.userId,
      itemId,
    );
  }
  return true;
}

interface RawItem {
  id: string;
  kind: string;
  href: string;
  title: string;
  excerpt: string;
  source: string;
  family: string;
  thumbnail: string | null;
  map_id: string | null;
  owner_id: string | null;
  published_at: string;
  matches: number;
  saved: number;
}

function toFeedItem(
  row: RawItem,
  selectedTags: readonly string[],
  db: Database,
): FeedItem {
  const tags = (
    db
      .prepare('SELECT tag FROM content_tags WHERE item_id = ? ORDER BY tag')
      .all(row.id) as { tag: string }[]
  ).map((t) => t.tag);

  return {
    id: row.id,
    kind: row.kind as FeedItem['kind'],
    title: row.title,
    excerpt: row.excerpt,
    source: row.source,
    family: row.family as FamilyName,
    href: row.href,
    thumbnail: row.thumbnail,
    mapId: row.map_id,
    publishedAt: row.published_at,
    tags,
    saved: row.saved === 1,
    matchedTags: tags.filter((tag) => selectedTags.includes(tag)),
    // §13's honesty rule: seeded content is not community activity, and the
    // card says so rather than implying a busier network than exists.
    seeded: row.owner_id === null,
  };
}

interface Cursor {
  matches: number;
  publishedAt: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    `${cursor.matches}|${cursor.publishedAt}|${cursor.id}`,
    'utf8',
  ).toString('base64url');
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const [matches, publishedAt, id] = Buffer.from(raw, 'base64url')
      .toString('utf8')
      .split('|');
    if (matches === undefined || publishedAt === undefined || id === undefined) {
      return null;
    }
    return { matches: Number(matches), publishedAt, id };
  } catch {
    // A malformed cursor restarts the feed rather than erroring. It is a
    // scroll position, and losing one is not worth a failed request.
    return null;
  }
}
