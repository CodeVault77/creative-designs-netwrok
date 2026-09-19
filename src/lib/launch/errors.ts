import 'server-only';
import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';

/**
 * Error tracking (§20 P14).
 *
 * Grouped by fingerprint, not stored one row per occurrence. At beta scale the
 * useful question is "what is broken, and how often" — and a thousand rows of
 * the same stack answers it worse than one row with a count of a thousand,
 * while costing a thousand times the disk.
 *
 * First-party for the same reason as analytics (ADR-0009): a stack trace can
 * contain a route, a query string and occasionally a value, and shipping that
 * to a third party sits badly beside ADR-0006.
 */

export interface ErrorRow {
  fingerprint: string;
  message: string;
  stack: string;
  source: string;
  route: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
}

export const MAX_STACK = 4000;

/**
 * What makes two errors "the same error".
 *
 * Message plus the first few stack frames, with anything variable stripped:
 * line and column numbers move with every build, and bundle hashes change on
 * every deploy. Without that normalisation the same bug fingerprints
 * differently after each release and the count resets to one.
 */
export function fingerprintOf(
  message: string,
  stack: string,
  route: string,
): string {
  const frames = stack
    .split('\n')
    .slice(0, 4)
    .map((line) =>
      line
        // strip :line:column
        .replace(/:\d+:\d+/g, '')
        // strip content hashes in bundle filenames
        .replace(/[-.][0-9a-f]{8,}\./gi, '.')
        // strip the origin, which differs between environments
        .replace(/https?:\/\/[^/]+/g, '')
        .trim(),
    )
    .join('|');

  return createHash('sha256')
    .update(`${message.slice(0, 200)}|${frames}|${route}`)
    .digest('hex')
    .slice(0, 32);
}

export function recordError(
  input: { message: string; stack?: string; source?: string; route?: string },
  db: Database = getDb(),
): string {
  const message = (input.message || 'Unknown error').slice(0, 500);
  const stack = (input.stack ?? '').slice(0, MAX_STACK);
  const route = (input.route ?? '').slice(0, 200);
  const source = input.source === 'server' ? 'server' : 'client';

  const fingerprint = fingerprintOf(message, stack, route);

  /**
   * Upsert, with `resolved_at` cleared on recurrence.
   *
   * An error someone marked resolved that then happens again is not resolved,
   * and silently leaving it closed is how a regression stays invisible.
   */
  db.prepare(
    `INSERT INTO error_reports (fingerprint, message, stack, source, route)
     VALUES (@fingerprint, @message, @stack, @source, @route)
     ON CONFLICT(fingerprint) DO UPDATE SET
       count = count + 1,
       last_seen = datetime('now'),
       resolved_at = NULL`,
  ).run({ fingerprint, message, stack, source, route });

  return fingerprint;
}

export function listErrors(
  ctx: AuthContext,
  options: { includeResolved?: boolean } = {},
  db: Database = getDb(),
): ErrorRow[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `SELECT * FROM error_reports
        WHERE (@includeResolved = 1 OR resolved_at IS NULL)
        ORDER BY last_seen DESC LIMIT 200`,
    )
    .all({ includeResolved: options.includeResolved ? 1 : 0 }) as {
    fingerprint: string;
    message: string;
    stack: string;
    source: string;
    route: string;
    count: number;
    first_seen: string;
    last_seen: string;
    resolved_at: string | null;
  }[];

  return rows.map((row) => ({
    fingerprint: row.fingerprint,
    message: row.message,
    stack: row.stack,
    source: row.source,
    route: row.route,
    count: row.count,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    resolved: row.resolved_at !== null,
  }));
}

export function resolveError(
  ctx: AuthContext,
  fingerprint: string,
  db: Database = getDb(),
): boolean {
  if (!ctx.isStaff) return false;
  const result = db
    .prepare(
      `UPDATE error_reports SET resolved_at = datetime('now') WHERE fingerprint = ?`,
    )
    .run(fingerprint);
  return result.changes > 0;
}

/** Unresolved errors seen in the last day. The number a launch gate cares about. */
export function activeErrorCount(ctx: AuthContext, db: Database = getDb()): number {
  if (!ctx.isStaff) return 0;
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM error_reports
          WHERE resolved_at IS NULL AND last_seen >= datetime('now', '-1 day')`,
      )
      .get() as { n: number }
  ).n;
}
