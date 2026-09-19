import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { validatePayload } from './registry';
import { COMMERCE_TYPES, CRM_TYPES, PROJECT_TYPES } from './packages';

/**
 * Cross-map collections of one package's node types.
 *
 * ── Why this is not a tasks app ─────────────────────────────────────────────
 *
 * The roadmap is explicit that commerce, CRM and project management are "node
 * type packages, not separate applications", and Phase 7 delivered exactly
 * that: `task`, `product`, `invoice` and the rest are creatable on any map
 * today. What was missing was somewhere to STAND — a person with tasks spread
 * across six maps had no way to see them together, and so the capability was
 * real and unusable at the same time.
 *
 * The answer is a LENS, not an application. There is no tasks table, no
 * separate permission model and no second place where work lives. This reads
 * the same `map_nodes` rows the map draws, filtered by type, and every row it
 * returns is one the caller could already open by navigating to its map. It
 * adds a view, not a system.
 *
 * That is also why one file serves all three packages. A tasks screen and an
 * orders screen differ in which type strings they select and nothing else;
 * writing them separately would be writing the same query three times and
 * fixing the visibility rule in two of them.
 *
 * ── The scope is narrower than `getMap`'s, deliberately ─────────────────────
 *
 * `repo.ts`'s `visible` predicate admits public maps and has a staff bypass,
 * which is right for "may I read this map" and wrong here. This is somebody's
 * own working list: a public map belonging to a stranger is not my work, and a
 * staff bypass would silently fill an operator's task list with other people's
 * — both a privacy leak and useless as a list.
 *
 * So the rule is: maps I own, or maps shared with me. Nothing else, staff
 * included.
 */

/** The three packages, as the destinations that present them. */
export const COLLECTIONS = {
  work: {
    slug: 'work',
    title: 'Work',
    blurb: 'Every task and milestone across your maps, soonest first.',
    types: PROJECT_TYPES,
  },
  commerce: {
    slug: 'commerce',
    title: 'Commerce',
    blurb: 'Products, orders and invoices you are tracking across your maps.',
    types: COMMERCE_TYPES,
  },
  contacts: {
    slug: 'contacts',
    title: 'Contacts',
    blurb: 'People, companies and the deals attached to them.',
    types: CRM_TYPES,
  },
} as const;

export type CollectionSlug = keyof typeof COLLECTIONS;

export function isCollectionSlug(value: string): value is CollectionSlug {
  return Object.prototype.hasOwnProperty.call(COLLECTIONS, value);
}

export interface CollectionItem {
  id: string;
  mapId: string;
  mapTitle: string;
  title: string;
  description: string | null;
  type: string;
  family: string;
  status: string;
  /** Validated through the ordinary registry, so a screen can trust its shape. */
  payload: Record<string, unknown>;
}

interface ItemRow {
  id: string;
  map_id: string;
  map_title: string;
  title: string;
  description: string | null;
  type: string;
  family: string;
  status: string;
  payload: string | null;
}

/**
 * Mine, or shared with me. No public maps, no staff bypass.
 *
 * Written out here rather than imported from `repo.ts` because it is a
 * different rule, not a copy of that one — see the header. Sharing the name
 * would invite someone to "simplify" by pointing this at `PREDICATE.visible`,
 * which is precisely the change that would break it.
 */
const MINE = `(
  maps.owner_id = @userId
  OR EXISTS (
    SELECT 1 FROM map_members mm
     WHERE mm.map_id = maps.id AND mm.user_id = @userId
  )
)`;

function hydrate(row: ItemRow): CollectionItem {
  let raw: unknown = {};

  try {
    raw = row.payload ? JSON.parse(row.payload) : {};
  } catch {
    // A payload that will not parse is treated as empty rather than dropping
    // the row: the node still exists and its title is still worth showing.
    raw = {};
  }

  /*
   * Validated through the SAME registry the editor and the API use.
   *
   * Not for safety — the row came from our own database — but so a screen can
   * rely on `payload.status` being one of the values the type declares. A view
   * that reads unvalidated JSON ends up with its own quiet notion of what a
   * status is, and then two parts of the product disagree about whether a task
   * is done.
   */
  const checked = validatePayload(row.type, raw);

  return {
    id: row.id,
    mapId: row.map_id,
    mapTitle: row.map_title,
    title: row.title,
    description: row.description,
    type: row.type,
    family: row.family,
    status: row.status,
    payload: checked.value ?? {},
  };
}

export interface CollectionOptions {
  /** Restrict to one type within the package, e.g. only `invoice`. */
  type?: string;
  limit?: number;
}

/**
 * Every node of the given types, across the caller's maps.
 *
 * Ordered by the map it lives on and then by title, which is stable and
 * boring. Sorting by a payload field — a due date, an amount — is left to the
 * screen, because SQLite cannot index into JSON without a generated column and
 * the volumes here do not justify one.
 */
export function collectionFor(
  ctx: AuthContext,
  types: readonly string[],
  options: CollectionOptions = {},
  db: Database = getDb(),
): CollectionItem[] {
  if (!ctx.userId) return [];

  const wanted = options.type
    ? types.filter((type) => type === options.type)
    : types;

  /*
   * An empty type list must produce NOTHING, not everything.
   *
   * `IN ()` is a syntax error in SQLite and an always-false condition in some
   * other engines, so the early return makes the behaviour explicit rather
   * than dependent on the driver. A filter that silently widens to "all nodes"
   * would return the caller's entire graph on a screen labelled "Invoices".
   */
  if (wanted.length === 0) return [];

  const placeholders = wanted.map((_, index) => `@type${index}`).join(', ');
  const params: Record<string, string | number> = {
    userId: ctx.userId,
    limit: Math.min(500, Math.max(1, options.limit ?? 300)),
  };

  wanted.forEach((type, index) => {
    params[`type${index}`] = type;
  });

  const rows = db
    .prepare(
      `SELECT map_nodes.id, map_nodes.map_id, map_nodes.title,
              map_nodes.description, map_nodes.type, map_nodes.family,
              map_nodes.status, map_nodes.payload,
              maps.title AS map_title
         FROM map_nodes
         JOIN maps ON maps.id = map_nodes.map_id
        WHERE map_nodes.type IN (${placeholders})
          AND ${MINE}
        ORDER BY maps.title, map_nodes.title
        LIMIT @limit`,
    )
    .all(params) as ItemRow[];

  return rows.map(hydrate);
}

export interface CollectionCount {
  type: string;
  count: number;
}

/** How many of each type the caller has. Drives the tabs above the list. */
export function collectionCounts(
  ctx: AuthContext,
  types: readonly string[],
  db: Database = getDb(),
): CollectionCount[] {
  if (!ctx.userId || types.length === 0) {
    return types.map((type) => ({ type, count: 0 }));
  }

  const placeholders = types.map((_, index) => `@type${index}`).join(', ');
  const params: Record<string, string> = { userId: ctx.userId };

  types.forEach((type, index) => {
    params[`type${index}`] = type;
  });

  const rows = db
    .prepare(
      `SELECT map_nodes.type AS type, COUNT(*) AS n
         FROM map_nodes
         JOIN maps ON maps.id = map_nodes.map_id
        WHERE map_nodes.type IN (${placeholders})
          AND ${MINE}
        GROUP BY map_nodes.type`,
    )
    .all(params) as { type: string; n: number }[];

  const byType = new Map(rows.map((row) => [row.type, row.n]));

  // Every requested type appears, including the empty ones — a tab strip with
  // tabs missing reads as data still loading rather than as a count of zero.
  return types.map((type) => ({ type, count: byType.get(type) ?? 0 }));
}

export interface CollectionTotals {
  /** Summed from payload amounts, in integer cents. Commerce only. */
  valueCents: number;
  /** Items whose payload names a date that has passed. Work only. */
  overdue: number;
  items: number;
}

/**
 * Headline numbers for a collection.
 *
 * Computed in JavaScript over the already-fetched rows rather than in SQL,
 * because the values live inside a JSON payload. Extracting them in SQLite
 * would mean `json_extract` on an unindexed column — the same full scan, but
 * expressed twice and in a second language.
 *
 * Only amounts that are actually present are summed. There is deliberately no
 * estimate, no projection and no defaulting a missing price to zero and
 * calling the total complete.
 */
export function totalsFor(items: readonly CollectionItem[]): CollectionTotals {
  const now = Date.now();
  let valueCents = 0;
  let overdue = 0;

  for (const item of items) {
    for (const key of ['totalCents', 'amountCents', 'valueCents', 'priceCents']) {
      const value = item.payload[key];
      if (typeof value === 'number' && Number.isFinite(value)) valueCents += value;
    }

    const due = item.payload.dueAt;
    const done =
      item.payload.status === 'done' ||
      item.payload.status === 'paid' ||
      item.payload.status === 'met';

    if (!done && typeof due === 'string' && due) {
      const at = new Date(due).getTime();
      if (Number.isFinite(at) && at <= now) overdue += 1;
    }
  }

  return { valueCents, overdue, items: items.length };
}
