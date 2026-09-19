import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { ANALYTICS_EVENTS } from './events';

/**
 * The first-party analytics store (ADR-0009).
 *
 * Two jobs: accept events from the beacon, and answer §24's questions about
 * them. Nothing else — this is not a general query surface, and every funnel
 * below corresponds to a number the roadmap actually asks for.
 */

const KNOWN_EVENTS = new Set<string>(ANALYTICS_EVENTS);

/** Per-batch and per-window caps. The endpoint is public by necessity. */
export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_EVENTS_PER_HOUR = 2000;

export interface IncomingEvent {
  name: string;
  props?: Record<string, unknown>;
  at?: string;
}

export interface IngestResult {
  accepted: number;
  rejected: number;
}

/**
 * Properties are stripped to scalars.
 *
 * §03's rule is "no personal data in event properties — IDs, enums, counts and
 * durations only". A reviewer enforces that at the call site; this enforces the
 * SHAPE at the boundary, so a nested object smuggling a map title cannot be
 * stored even if someone adds one by accident.
 */
function cleanProps(props: Record<string, unknown> | undefined): string {
  if (!props) return '{}';

  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      // Bounded: an id or an enum, never prose.
      out[key] = value.slice(0, 120);
    }
    // Objects, arrays, functions and null are dropped entirely.
  }
  return JSON.stringify(out);
}

export function ingest(
  batch: {
    anonId: string;
    sessionId: string;
    userId?: string | null;
    events: IncomingEvent[];
  },
  db: Database = getDb(),
): IngestResult {
  const anonId = String(batch.anonId ?? '').slice(0, 64);
  const sessionId = String(batch.sessionId ?? '').slice(0, 64);
  if (!anonId || !sessionId) return { accepted: 0, rejected: 0 };

  // A per-sender ceiling, so the public endpoint cannot be used to fill the
  // disk. Checked once per batch rather than per event.
  const recent = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM analytics_events
          WHERE anon_id = ? AND created_at >= datetime('now', '-1 hour')`,
      )
      .get(anonId) as { n: number }
  ).n;

  if (recent >= MAX_EVENTS_PER_HOUR)
    return { accepted: 0, rejected: batch.events.length };

  const insert = db.prepare(
    `INSERT INTO analytics_events (name, props, anon_id, user_id, session_id, created_at)
     VALUES (@name, @props, @anonId, @userId, @sessionId, @createdAt)`,
  );

  let accepted = 0;
  let rejected = 0;

  db.transaction(() => {
    for (const event of batch.events.slice(0, MAX_EVENTS_PER_BATCH)) {
      /**
       * Unknown event names are REJECTED, not stored.
       *
       * §03: "Adding an event means editing one file and getting it reviewed,
       * not inventing a string at a call site." A public endpoint that accepts
       * any name is both an unbounded write and a way for the taxonomy to rot
       * without anyone noticing.
       */
      if (!KNOWN_EVENTS.has(event.name)) {
        rejected += 1;
        continue;
      }

      insert.run({
        name: event.name,
        props: cleanProps(event.props),
        anonId,
        userId: batch.userId || null,
        sessionId,
        // The client's clock is not trusted for ordering, but it is kept when
        // plausible so a batch flushed late does not compress ten minutes of
        // events into one instant.
        createdAt: plausibleTime(event.at),
      });
      accepted += 1;
    }
  })();

  return { accepted, rejected };
}

function plausibleTime(raw: string | undefined): string {
  const now = Date.now();
  const parsed = raw ? Date.parse(raw) : NaN;

  // Anything more than a day out in either direction is a broken clock.
  if (!Number.isFinite(parsed) || Math.abs(now - parsed) > 24 * 60 * 60 * 1000) {
    return new Date(now).toISOString().replace('T', ' ').slice(0, 19);
  }
  return new Date(parsed).toISOString().replace('T', ' ').slice(0, 19);
}

// ------------------------------------------------------------------ funnels

export interface ThreeTapReport {
  /** Sessions that reached a live destination at all. */
  sessions: number;
  /** …of those, how many did it in three taps or fewer. */
  withinThreeTaps: number;
  /** …and within twenty-five seconds. */
  withinTwentyFiveSeconds: number;
  /** Both, which is §24's actual criterion. */
  withinBoth: number;
  medianTaps: number;
  medianSeconds: number;
}

/**
 * §24: "A new visitor reaches a live destination in ≤3 taps and ≤25 s."
 *
 * Read from `destination_reached`, which carries `taps` and `ms_since_load`
 * precisely so this query is possible. The first such event per session is the
 * one that counts — reaching a second destination later says nothing about
 * arrival.
 */
export function threeTapReport(
  ctx: AuthContext,
  days = 30,
  db: Database = getDb(),
): ThreeTapReport {
  if (!ctx.isStaff) {
    return {
      sessions: 0,
      withinThreeTaps: 0,
      withinTwentyFiveSeconds: 0,
      withinBoth: 0,
      medianTaps: 0,
      medianSeconds: 0,
    };
  }

  const rows = db
    .prepare(
      `SELECT session_id,
              MIN(created_at) AS first_at,
              json_extract(props, '$.taps') AS taps,
              json_extract(props, '$.ms_since_load') AS ms
         FROM analytics_events
        WHERE name = 'destination_reached'
          AND created_at >= datetime('now', @window)
        GROUP BY session_id`,
    )
    .all({ window: `-${days} days` }) as {
    session_id: string;
    taps: number | null;
    ms: number | null;
  }[];

  const taps = rows.map((row) => row.taps ?? 99).sort((a, b) => a - b);
  const seconds = rows
    .map((row) => (row.ms ?? 999_000) / 1000)
    .sort((a, b) => a - b);

  const median = (values: number[]) =>
    values.length === 0 ? 0 : (values[Math.floor(values.length / 2)] ?? 0);

  return {
    sessions: rows.length,
    withinThreeTaps: rows.filter((row) => (row.taps ?? 99) <= 3).length,
    withinTwentyFiveSeconds: rows.filter((row) => (row.ms ?? 999_000) <= 25_000)
      .length,
    withinBoth: rows.filter(
      (row) => (row.taps ?? 99) <= 3 && (row.ms ?? 999_000) <= 25_000,
    ).length,
    medianTaps: median(taps),
    medianSeconds: Math.round(median(seconds) * 10) / 10,
  };
}

export interface ActivationReport {
  /** Everyone who arrived in the window. */
  visitors: number;
  /** …who opened a node. */
  exploredNode: number;
  /** …who signed up. */
  signedUp: number;
  /** …who created a map. */
  createdMap: number;
  /** …who saved one with real content. ACTIVATED. */
  activated: number;
  /** …who shared or invited. */
  shared: number;
}

/**
 * Activation, as a funnel of distinct people rather than a count of events.
 *
 * Each step is measured against the ANONYMOUS id, not the user id, so the
 * top of the funnel — people who never signed up — is countable at all. A
 * funnel that starts at sign-up cannot tell you what fraction of arrivals you
 * are losing before it.
 */
export function activationReport(
  ctx: AuthContext,
  days = 30,
  db: Database = getDb(),
): ActivationReport {
  if (!ctx.isStaff) {
    return {
      visitors: 0,
      exploredNode: 0,
      signedUp: 0,
      createdMap: 0,
      activated: 0,
      shared: 0,
    };
  }

  const distinct = (names: string[]) => {
    const list = names.map((name) => `'${name}'`).join(', ');
    return (
      db
        .prepare(
          `SELECT COUNT(DISTINCT anon_id) AS n FROM analytics_events
            WHERE name IN (${list}) AND created_at >= datetime('now', @window)`,
        )
        .get({ window: `-${days} days` }) as { n: number }
    ).n;
  };

  const all = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT anon_id) AS n FROM analytics_events
          WHERE created_at >= datetime('now', @window)`,
      )
      .get({ window: `-${days} days` }) as { n: number }
  ).n;

  return {
    visitors: all,
    exploredNode: distinct(['node_opened', 'node_expanded']),
    signedUp: distinct(['account_signed_up']),
    createdMap: distinct(['map_created']),
    // ACTIVATED is "saved a map with real content in it", which `map_autosaved`
    // is — the editor has no Save button (§14), so an autosave IS the save.
    activated: distinct(['map_autosaved']),
    shared: distinct(['map_shared', 'collaborator_invited']),
  };
}

export interface DemandRow {
  nodeId: string;
  count: number;
}

/**
 * §24: "Coming Soon interest per dark node" — the data that decides what gets
 * built next. Read from the interest table rather than from events, because a
 * registration is a durable fact and an event is a sample.
 */
export function comingSoonDemand(
  ctx: AuthContext,
  db: Database = getDb(),
): DemandRow[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `SELECT node_id, COUNT(*) AS n FROM node_interest
        GROUP BY node_id ORDER BY n DESC LIMIT 40`,
    )
    .all() as { node_id: string; n: number }[];

  return rows.map((row) => ({ nodeId: row.node_id, count: row.n }));
}

/** Raw event counts, for a sanity check that instrumentation is alive at all. */
export function eventVolume(
  ctx: AuthContext,
  days = 7,
  db: Database = getDb(),
): { name: string; count: number }[] {
  if (!ctx.isStaff) return [];

  return db
    .prepare(
      `SELECT name, COUNT(*) AS count FROM analytics_events
          WHERE created_at >= datetime('now', @window)
          GROUP BY name ORDER BY count DESC`,
    )
    .all({ window: `-${days} days` }) as { name: string; count: number }[];
}

/** Prune old rows. Called by the backup script; nobody else will do it. */
export function pruneEvents(olderThanDays = 180, db: Database = getDb()): number {
  const result = db
    .prepare(`DELETE FROM analytics_events WHERE created_at < datetime('now', ?)`)
    .run(`-${olderThanDays} days`);
  return result.changes;
}
