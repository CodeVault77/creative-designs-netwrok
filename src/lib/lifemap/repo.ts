import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { createMap } from '@/lib/db/repo';
import {
  detectSource,
  parseArchiveJson,
  type ArchiveEntry,
  type ArchiveSource,
} from './archive';
import {
  buildTimeline,
  extractEntities,
  proposeMap,
  type TimelineBucket,
} from './entities';

/**
 * Storing and reading a LifeMap.
 *
 * ── Private to one account, structurally ────────────────────────────────────
 *
 * There is no visibility column here, no share table and no `ctx.isStaff`
 * escape. Every query below filters on `user_id` in its own WHERE clause, and
 * `user_id` is denormalised onto every table so that filter never depends on
 * a join somebody might forget.
 *
 * Staff are not an exception. Moderation reaches across ownership everywhere
 * else in this codebase and deliberately does not reach here: a LifeMap is
 * somebody's private messages and photographs, imported for their own use, and
 * there is no support question worth building a door for. If one ever arises,
 * the answer is to ask the person to export it — not to add a bypass.
 *
 * ── The archive file is never stored ────────────────────────────────────────
 *
 * It is parsed in memory, the entries are kept, and the upload is discarded.
 * Retaining the original would mean holding a complete second copy of
 * somebody's Facebook history indefinitely, which is a liability nobody asked
 * us to take on and which no feature here needs.
 */

export type ImportStatus = 'pending' | 'analysed' | 'applied' | 'discarded';

export interface LifeImport {
  id: string;
  userId: string;
  source: ArchiveSource;
  label: string;
  status: ImportStatus;
  entryCount: number;
  skippedCount: number;
  mapId: string | null;
  createdAt: string;
  appliedAt: string | null;
}

interface ImportRow {
  id: string;
  user_id: string;
  source: string;
  label: string;
  status: string;
  entry_count: number;
  skipped_count: number;
  map_id: string | null;
  created_at: string;
  applied_at: string | null;
}

function hydrate(row: ImportRow): LifeImport {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source as ArchiveSource,
    label: row.label,
    status: (['pending', 'analysed', 'applied', 'discarded'] as const).includes(
      row.status as ImportStatus,
    )
      ? (row.status as ImportStatus)
      : 'pending',
    entryCount: row.entry_count,
    skippedCount: row.skipped_count,
    mapId: row.map_id,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

export interface ImportResult {
  ok: boolean;
  import?: LifeImport;
  error?: string;
}

/** The most archives one account may hold. Each is tens of thousands of rows. */
export const MAX_IMPORTS = 10;

/**
 * Parse an archive and store what it contained.
 *
 * Takes the file's TEXT rather than a handle, so the transport — an upload, a
 * paste, a test — is the caller's problem and this stays one job.
 */
export function importArchive(
  ctx: AuthContext,
  input: { text: string; label?: string; source?: ArchiveSource },
  db: Database = getDb(),
): ImportResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const existing = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM lifemap_imports WHERE user_id = ? AND status != 'discarded'",
      )
      .get(ctx.userId) as { n: number }
  ).n;

  if (existing >= MAX_IMPORTS) {
    return { ok: false, error: 'Remove an old import before adding another' };
  }

  const source = input.source ?? detectSource(input.text);
  const parsed = parseArchiveJson(input.text, source);

  if (!parsed.ok)
    return { ok: false, error: parsed.error ?? 'Could not read that' };

  if (parsed.entries.length === 0) {
    return { ok: false, error: 'That archive had nothing we could read' };
  }

  const id = `lmi_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const entities = extractEntities(parsed.entries);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO lifemap_imports
         (id, user_id, source, label, status, entry_count, skipped_count)
       VALUES (?, ?, ?, ?, 'analysed', ?, ?)`,
    ).run(
      id,
      ctx.userId,
      source,
      (input.label ?? '').slice(0, 120) || `${source} archive`,
      parsed.entries.length,
      parsed.skipped,
    );

    const insertEntry = db.prepare(
      `INSERT INTO lifemap_entries
         (id, import_id, user_id, kind, title, body, occurred_at, people, place, source)
       VALUES (@id, @importId, @userId, @kind, @title, @body, @at, @people, @place, @source)`,
    );

    for (const entry of parsed.entries) {
      insertEntry.run({
        id: `lme_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        importId: id,
        userId: ctx.userId,
        kind: entry.kind,
        title: entry.title.slice(0, 300),
        body: entry.body.slice(0, 20_000),
        at: entry.at,
        people: JSON.stringify(entry.people),
        place: entry.place ?? '',
        source: entry.source,
      });
    }

    const insertEntity = db.prepare(
      `INSERT OR IGNORE INTO lifemap_entities
         (id, import_id, user_id, kind, entity_key, label, count, first_seen, last_seen)
       VALUES (@id, @importId, @userId, @kind, @key, @label, @count, @first, @last)`,
    );

    for (const entity of entities) {
      insertEntity.run({
        id: `lmn_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        importId: id,
        userId: ctx.userId,
        kind: entity.kind,
        key: entity.key,
        label: entity.label.slice(0, 200),
        count: entity.count,
        first: entity.firstSeen,
        last: entity.lastSeen,
      });
    }
  })();

  return { ok: true, import: getImport(ctx, id, db) ?? undefined };
}

export function getImport(
  ctx: AuthContext,
  importId: string,
  db: Database = getDb(),
): LifeImport | null {
  if (!ctx.userId) return null;

  // Scoped in the WHERE clause, not checked afterwards: the two cannot then
  // disagree, and there is no branch where the check could be skipped.
  const row = db
    .prepare('SELECT * FROM lifemap_imports WHERE id = ? AND user_id = ?')
    .get(importId, ctx.userId) as ImportRow | undefined;

  return row ? hydrate(row) : null;
}

export function importsFor(ctx: AuthContext, db: Database = getDb()): LifeImport[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      "SELECT * FROM lifemap_imports WHERE user_id = ? AND status != 'discarded' ORDER BY created_at DESC",
    )
    .all(ctx.userId) as ImportRow[];

  return rows.map(hydrate);
}

interface EntryRow {
  kind: string;
  title: string;
  body: string;
  occurred_at: string | null;
  people: string;
  place: string;
  source: string;
}

function hydrateEntry(row: EntryRow): ArchiveEntry {
  let people: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.people);
    if (Array.isArray(parsed))
      people = parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    people = [];
  }

  return {
    kind: row.kind as ArchiveEntry['kind'],
    title: row.title,
    body: row.body,
    at: row.occurred_at,
    people,
    place: row.place || null,
    source: row.source as ArchiveSource,
  };
}

export function entriesFor(
  ctx: AuthContext,
  importId: string,
  limit = 5000,
  db: Database = getDb(),
): ArchiveEntry[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `SELECT kind, title, body, occurred_at, people, place, source
         FROM lifemap_entries WHERE import_id = ? AND user_id = ?
        ORDER BY occurred_at DESC LIMIT ?`,
    )
    .all(importId, ctx.userId, limit) as EntryRow[];

  return rows.map(hydrateEntry);
}

export interface LifeEntity {
  kind: string;
  key: string;
  label: string;
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export function entitiesFor(
  ctx: AuthContext,
  importId: string,
  limit = 200,
  db: Database = getDb(),
): LifeEntity[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `SELECT kind, entity_key, label, count, first_seen, last_seen
         FROM lifemap_entities WHERE import_id = ? AND user_id = ?
        ORDER BY count DESC LIMIT ?`,
    )
    .all(importId, ctx.userId, limit) as {
    kind: string;
    entity_key: string;
    label: string;
    count: number;
    first_seen: string | null;
    last_seen: string | null;
  }[];

  return rows.map((row) => ({
    kind: row.kind,
    key: row.entity_key,
    label: row.label,
    count: row.count,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  }));
}

export function timelineFor(
  ctx: AuthContext,
  importId: string,
  db: Database = getDb(),
): TimelineBucket[] {
  return buildTimeline(entriesFor(ctx, importId, 50_000, db));
}

/**
 * Search a LifeMap in plain language.
 *
 * ── Keyword, not semantic, and that is a stated limitation ──────────────────
 *
 * The business plan describes natural-language search: "When did I first start
 * working on this project?" This is the keyword half of it — terms, people,
 * places and a date range — which answers most of those questions and answers
 * them instantly, offline, at no cost.
 *
 * Semantic search over a LifeMap needs an embedding per entry, which means
 * sending years of somebody's private messages to a model. `lib/ai/embeddings`
 * can do it and this deliberately does not call it: that is a separate,
 * explicit, consented step, not something an import does by default.
 */
export function searchLifeMap(
  ctx: AuthContext,
  query: string,
  options: { importId?: string; from?: string; to?: string; limit?: number } = {},
  db: Database = getDb(),
): ArchiveEntry[] {
  if (!ctx.userId) return [];

  const clauses = ['lifemap_entries.user_id = @userId'];
  const params: Record<string, string | number> = {
    userId: ctx.userId,
    limit: Math.min(500, Math.max(1, options.limit ?? 100)),
  };

  if (options.importId) {
    clauses.push('lifemap_entries.import_id = @importId');
    params.importId = options.importId;
  }

  const trimmed = query.trim();
  if (trimmed) {
    clauses.push(
      '(lifemap_entries.title LIKE @q OR lifemap_entries.body LIKE @q OR lifemap_entries.people LIKE @q OR lifemap_entries.place LIKE @q)',
    );
    // Wildcards escaped: a search for "100%" must not return everything, which
    // is what an unescaped % does to a LIKE.
    params.q = `%${trimmed.replace(/[%_\\]/g, '\\$&')}%`;
  }

  if (options.from) {
    clauses.push('lifemap_entries.occurred_at >= @from');
    params.from = options.from;
  }
  if (options.to) {
    clauses.push('lifemap_entries.occurred_at <= @to');
    params.to = options.to;
  }

  const rows = db
    .prepare(
      `SELECT kind, title, body, occurred_at, people, place, source
         FROM lifemap_entries WHERE ${clauses.join(' AND ')}
        ORDER BY occurred_at DESC LIMIT @limit`,
    )
    .all(params) as EntryRow[];

  return rows.map(hydrateEntry);
}

export interface ApplyResult {
  ok: boolean;
  mapId?: string;
  error?: string;
}

/**
 * Turn an analysed import into a real map.
 *
 * ── Only on an explicit request ─────────────────────────────────────────────
 *
 * Importing analyses; applying creates. They are separate calls because the
 * proposal is something a person should look at before it becomes a map of
 * their life — the clustering will have got some of it wrong, and a map
 * generated silently would present that as fact.
 *
 * The map is created PRIVATE, whatever else the account defaults to.
 */
export function applyImport(
  ctx: AuthContext,
  importId: string,
  db: Database = getDb(),
): ApplyResult {
  const record = getImport(ctx, importId, db);
  if (!record) return { ok: false, error: 'Not found' };

  if (record.status === 'applied' && record.mapId) {
    // Idempotent: a repeated apply returns the map it already made rather
    // than creating a second copy of somebody's life.
    return { ok: true, mapId: record.mapId };
  }

  const entries = entriesFor(ctx, importId, 50_000, db);
  if (entries.length === 0) return { ok: false, error: 'Nothing to build from' };

  const proposed = proposeMap(entries, { rootTitle: record.label });
  const mapId = `map_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  const ids = new Map<string, string>();
  for (const node of proposed) {
    ids.set(node.key, `nod_${randomUUID().replace(/-/g, '').slice(0, 20)}`);
  }

  const rootId = ids.get('root')!;
  const nodes: Record<string, never> = {};
  const slots = new Map<string, number>();

  for (const node of proposed) {
    const id = ids.get(node.key)!;
    const parentId = node.parentKey ? (ids.get(node.parentKey) ?? null) : null;

    const slotKey = parentId ?? 'root';
    const slot = slots.get(slotKey) ?? 0;
    slots.set(slotKey, slot + 1);

    (nodes as Record<string, unknown>)[id] = {
      id,
      map_id: mapId,
      parent_id: parentId,
      slot,
      title: node.title,
      family: 'organise',
      type: node.type,
      status: 'active',
      // Node-level visibility is `public` WITHIN a private map, which is what
      // every other map here uses. The map's own visibility is what keeps it
      // private, and setting both would imply a second mechanism.
      visibility: 'public',
      weight: node.weight,
      payload: node.payload,
    };
  }

  db.transaction(() => {
    createMap(
      ctx,
      {
        id: mapId,
        title: record.label || 'My LifeMap',
        family: 'organise',
        /*
         * Private, always, and not a default the caller can override.
         *
         * "LifeMap data is private by default. Users control every layer of
         * visibility." A person can make it public afterwards, deliberately,
         * on a map they have looked at — which is a different act from a map
         * arriving public because of a parameter.
         */
        visibility: 'private',
        rootId,
        nodes: nodes as never,
        version: 1,
        updatedAt: new Date().toISOString(),
        dirty: [],
        metaDirty: false,
      },
      db,
    );

    db.prepare(
      "UPDATE lifemap_imports SET status = 'applied', map_id = ?, applied_at = datetime('now') WHERE id = ? AND user_id = ?",
    ).run(mapId, importId, ctx.userId);
  })();

  return { ok: true, mapId };
}

/**
 * Delete an import and everything derived from it.
 *
 * A real delete, not a status flag. Somebody removing their imported personal
 * history means remove it — and `ON DELETE CASCADE` takes the entries and
 * entities with the import row rather than leaving orphans that a later query
 * could still find.
 *
 * The MAP is deliberately left alone: once applied it is an ordinary map the
 * person owns and may have edited, and deleting somebody's map because they
 * tidied up an import would be destroying work they did afterwards.
 */
export function deleteImport(
  ctx: AuthContext,
  importId: string,
  db: Database = getDb(),
): { ok: boolean; error?: string } {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const changed = db
    .prepare('DELETE FROM lifemap_imports WHERE id = ? AND user_id = ?')
    .run(importId, ctx.userId).changes;

  return changed > 0 ? { ok: true } : { ok: false, error: 'Not found' };
}

/** The proposal for an import, without writing anything. */
export function previewImport(
  ctx: AuthContext,
  importId: string,
  db: Database = getDb(),
): ReturnType<typeof proposeMap> {
  const record = getImport(ctx, importId, db);
  if (!record) return [];

  return proposeMap(entriesFor(ctx, importId, 50_000, db), {
    rootTitle: record.label,
  });
}
