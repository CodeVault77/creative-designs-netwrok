import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { communityMap } from '@/lib/map/seed';
import { ancestorsOf } from '@/lib/map/geometry';
import { buildRoute } from '@/lib/routes';
import type { AuthContext } from '@/lib/db/repo';
import type { FamilyName } from '@/lib/styles/tokens.generated';
import {
  MAX_RESULTS,
  MIN_QUERY_LENGTH,
  SUGGESTIONS_PER_GROUP,
  type ResultGroup,
  type SearchFilters,
  type SearchResponse,
  type SearchResult,
} from './types';

/**
 * Permission-aware search.
 *
 * §20 rates "permission leakage via search" as this phase's High risk, and
 * search is where authorisation bugs hide best: the map, the editor and the
 * share route each read ONE map, so a mistake is visible. Search reads
 * EVERY map at once, so a missing predicate returns a stranger's private
 * notes ranked by relevance and nobody notices until it is quoted back.
 *
 * §08 screen 06 states the requirement precisely: "Private results excluded
 * silently, never teased." No "3 results you cannot see" — that leaks the
 * existence and the count.
 *
 * Four rules hold the line:
 *
 * 1. **The index authorises nothing.** FTS5 holds ids and text; every hit is
 *    joined back to the real rows, where the predicate is applied. Ranking
 *    happens before filtering, so filtering can never be skipped for speed.
 *
 * 2. **The predicate is the SAME one `repo.ts` uses.** Restating it here
 *    would create a second copy to drift, and the drift would be silent.
 *
 * 3. **Private nodes never match**, exactly as in the share payload — a node
 *    the owner hid must not be findable by its text.
 *
 * 4. **On a node-viewable-off map, only titles match for outsiders.** This is
 *    the subtle one. §15 says those viewers never receive descriptions; if a
 *    description could still produce a hit, search becomes an oracle for the
 *    text it refuses to show — type a guess, see whether it matches.
 */

/** Mirrors `PREDICATE.visible` in repo.ts. */
const VISIBLE_MAP = `(
  maps.owner_id = @userId
  OR maps.visibility = 'public'
  OR EXISTS (SELECT 1 FROM map_members mm WHERE mm.map_id = maps.id AND mm.user_id = @userId)
  OR @isStaff = 1
)`;

/** True when the viewer is inside the map rather than looking at it. */
const IS_INSIDER = `(
  maps.owner_id = @userId
  OR @isStaff = 1
  OR EXISTS (SELECT 1 FROM map_members mm2 WHERE mm2.map_id = maps.id AND mm2.user_id = @userId)
)`;

/**
 * Escapes a user query for FTS5 MATCH.
 *
 * FTS5 has its own syntax — `"`, `*`, `NEAR`, `OR`, column filters. An
 * unescaped query is at best a syntax error the user cannot understand and at
 * worst a way to query columns the caller did not intend. Every term is
 * quoted and a prefix wildcard is added so suggestions match as you type.
 */
export function toMatchExpression(query: string): string | null {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/["*()^:]/g, '').trim())
    .filter((term) => term.length > 0);

  if (terms.length === 0) return null;

  // Every term must be present. OR would return anything sharing one common
  // word, which reads as the search being broken.
  return terms.map((term) => `"${term}"*`).join(' AND ');
}

/** Marks matched terms so the UI can emphasise them without re-searching. */
export function snippetFor(text: string, query: string, length = 120): string {
  if (!text) return '';

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();

  let at = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }

  // No match in the body — the hit came from the title. Show the opening.
  if (at < 0) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, start + length);

  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function bind(ctx: AuthContext) {
  return { userId: ctx.userId, isStaff: ctx.isStaff ? 1 : 0 };
}

interface RawNodeHit {
  node_id: string;
  map_id: string;
  map_title: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  family: string;
  type: string;
  status: string;
  node_viewable: number;
  insider: number;
  rank: number;
}

export function search(
  ctx: AuthContext,
  query: string,
  filters: SearchFilters,
  db: Database = getDb(),
): SearchResponse {
  const started = performance.now();
  const trimmed = query.trim();

  if (trimmed.length < MIN_QUERY_LENGTH) {
    return emptyResponse(trimmed, started);
  }

  const match = toMatchExpression(trimmed);
  if (!match) return emptyResponse(trimmed, started);

  const results: SearchResult[] = [
    ...searchNodes(ctx, trimmed, match, db),
    ...searchMaps(ctx, match, db),
    ...searchPeople(trimmed, db),
    ...searchCommunity(trimmed),
  ];

  const filtered = results
    .filter((result) => matchesFilters(result, filters))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_RESULTS);

  const grouped: Record<ResultGroup, SearchResult[]> = {
    nodes: [],
    maps: [],
    people: [],
    pages: [],
  };
  for (const result of filtered) {
    if (grouped[result.group].length < SUGGESTIONS_PER_GROUP) {
      grouped[result.group].push(result);
    }
  }

  return {
    query: trimmed,
    results: filtered,
    grouped,
    total: filtered.length,
    ms: Math.round(performance.now() - started),
  };
}

// -------------------------------------------------------------------- nodes

function searchNodes(
  ctx: AuthContext,
  query: string,
  match: string,
  db: Database,
): SearchResult[] {
  const rows = db
    .prepare(
      `SELECT
         ns.node_id, ns.map_id,
         maps.title AS map_title, maps.node_viewable,
         n.parent_id, n.title, n.description, n.family, n.type, n.status,
         ${IS_INSIDER} AS insider,
         rank
       FROM node_search ns
       JOIN map_nodes n ON n.id = ns.node_id
       JOIN maps ON maps.id = ns.map_id
       WHERE node_search MATCH @match
         -- (2) the same predicate repo.ts uses
         AND ${VISIBLE_MAP}
         -- (3) a private node is never findable by its text
         AND n.visibility <> 'private'
         -- (3b) nor is anything beneath one. A recursive walk per hit would
         -- be expensive, so the ancestry is checked with a CTE.
         AND NOT EXISTS (
           WITH RECURSIVE ancestors(id, parent_id) AS (
             SELECT n.id, n.parent_id
             UNION ALL
             SELECT p.id, p.parent_id
             FROM map_nodes p JOIN ancestors a ON p.id = a.parent_id
           )
           SELECT 1 FROM ancestors a
           JOIN map_nodes anc ON anc.id = a.id
           WHERE anc.visibility = 'private' AND ${IS_INSIDER} = 0
         )
       ORDER BY rank
       LIMIT 200`,
    )
    .all({ ...bind(ctx), match }) as RawNodeHit[];

  return rows
    .filter((row) => {
      /*
       * (4) On a node-viewable-off map, an outsider may only match the TITLE.
       *
       * Otherwise search answers a question the share payload refuses to:
       * type a guess at the description, see whether a result appears, and
       * you have confirmed the text without ever being sent it.
       */
      if (row.insider === 1) return true;
      if (row.node_viewable === 1) return true;

      return row.title
        .toLowerCase()
        .includes(query.toLowerCase().split(/\s+/)[0] ?? '');
    })
    .map((row) => {
      const outsiderNoDetail = row.insider === 0 && row.node_viewable === 0;

      return {
        group: 'nodes' as const,
        id: row.node_id,
        title: row.title,
        // No snippet when the viewer may not see the body — a snippet IS the
        // body, in miniature.
        ...(outsiderNoDetail || !row.description
          ? {}
          : { snippet: snippetFor(row.description, query) }),
        path: [row.map_title],
        family: row.family as FamilyName,
        status: row.status as SearchResult['status'],
        type: row.type as SearchResult['type'],
        href: buildRoute.mapEditorNode(row.map_id, row.node_id),
        mapId: row.map_id,
        parentId: row.parent_id,
        rank: row.rank,
      };
    });
}

// --------------------------------------------------------------------- maps

function searchMaps(ctx: AuthContext, match: string, db: Database): SearchResult[] {
  const rows = db
    .prepare(
      `SELECT ms.map_id, maps.title, maps.family, users.handle, rank
       FROM map_search ms
       JOIN maps ON maps.id = ms.map_id
       JOIN users ON users.id = maps.owner_id
       WHERE map_search MATCH @match AND ${VISIBLE_MAP}
       ORDER BY rank
       LIMIT 40`,
    )
    .all({ ...bind(ctx), match }) as {
    map_id: string;
    title: string;
    family: string;
    handle: string;
    rank: number;
  }[];

  return rows.map((row) => ({
    group: 'maps' as const,
    id: row.map_id,
    title: row.title,
    path: [`@${row.handle}`],
    family: row.family as FamilyName,
    status: 'active' as const,
    href: buildRoute.mapEditor(row.map_id),
    mapId: row.map_id,
    // Maps rank slightly behind nodes: someone searching a phrase usually
    // wants the thing, not the container.
    rank: row.rank + 0.5,
  }));
}

// ------------------------------------------------------------------- people

function searchPeople(query: string, db: Database): SearchResult[] {
  // Profiles are public, so there is no predicate to apply — but only public
  // fields are selected. Email is never searchable: it would turn the search
  // box into an address-confirmation oracle.
  const like = `%${query.toLowerCase()}%`;

  const rows = db
    .prepare(
      `SELECT id, handle, display_name, bio
       FROM users
       WHERE LOWER(display_name) LIKE ? OR LOWER(handle) LIKE ?
       ORDER BY LENGTH(display_name)
       LIMIT 20`,
    )
    .all(like, like) as {
    id: string;
    handle: string;
    display_name: string;
    bio: string | null;
  }[];

  return rows.map((row, index) => ({
    group: 'people' as const,
    id: row.id,
    title: row.display_name,
    ...(row.bio ? { snippet: snippetFor(row.bio, query) } : {}),
    path: [`@${row.handle}`],
    family: 'people' as FamilyName,
    status: 'active' as const,
    href: buildRoute.profile(row.handle),
    rank: 2 + index * 0.01,
  }));
}

// ------------------------------------------------------------ community map

/**
 * The Community Map lives in code (`seed.ts`), not in the database, so it is
 * searched separately. Everything in it is public — there is nothing to
 * authorise, which is why this function takes no context.
 */
function searchCommunity(query: string): SearchResult[] {
  const graph = communityMap();
  const needle = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const node of graph.nodes.values()) {
    const haystack = `${node.title} ${node.description ?? ''}`.toLowerCase();
    if (!haystack.includes(needle)) continue;

    const path = ancestorsOf(graph, node.id)
      .slice(0, -1)
      .map((n) => n.title);

    results.push({
      group: 'pages',
      id: node.id,
      title: node.title,
      ...(node.description ? { snippet: snippetFor(node.description, query) } : {}),
      path: path.length > 0 ? path : ['Community Map'],
      family: node.family,
      status: node.status,
      type: node.type,
      href:
        node.status === 'coming_soon'
          ? buildRoute.comingSoon(node.id)
          : buildRoute.mapNode(node.id),
      mapId: graph.id,
      parentId: node.parent_id,
      // Community results lead: a first-time searcher is far more likely to
      // want a ring-one destination than someone's private note.
      rank: node.title.toLowerCase().includes(needle) ? -1 : 0.5,
    });
  }

  return results;
}

// ------------------------------------------------------------------ filters

function matchesFilters(result: SearchResult, filters: SearchFilters): boolean {
  if (filters.group && filters.group !== 'all' && result.group !== filters.group) {
    return false;
  }
  if (filters.families.length > 0 && !filters.families.includes(result.family)) {
    return false;
  }
  if (
    filters.types.length > 0 &&
    (!result.type || !filters.types.includes(result.type))
  ) {
    return false;
  }
  // §11: "Live only is important — it lets a user exclude Coming Soon
  // results, which will otherwise pollute early search badly."
  if (filters.liveOnly && result.status !== 'active') return false;

  return true;
}

function emptyResponse(query: string, started: number): SearchResponse {
  return {
    query,
    results: [],
    grouped: { nodes: [], maps: [], people: [], pages: [] },
    total: 0,
    ms: Math.round(performance.now() - started),
  };
}
