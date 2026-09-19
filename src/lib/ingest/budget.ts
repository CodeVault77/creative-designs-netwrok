import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { serverEnv } from '@/lib/env';

/**
 * Rate limits and the spend cap.
 *
 * §20 rates "LLM cost per run" High, and §19 names Link-to-Mind-Map "the main
 * abuse vector". Both come down to the same question asked before any network
 * call: is this run allowed to happen?
 *
 * Every limit is checked BEFORE the fetch, and the run is recorded whatever
 * the outcome. Recording only successes would let an attacker burn the
 * fetcher indefinitely on failures, which is exactly the traffic a scan
 * produces.
 *
 * This module lives outside `repo.ts` because it does not read user content —
 * but it takes the same AuthContext first argument for the same reason, and
 * `client.ts` is imported here under the same rule the chokepoint test
 * enforces (see the allowlist in chokepoint.test.ts).
 */

/** §12: "Signed-out users get 1 free run, then sign-in." */
export const ANON_FREE_RUNS = 1;

/** A signed-in user's hourly and daily allowance. */
export const USER_RUNS_PER_HOUR = 10;
export const USER_RUNS_PER_DAY = 40;

/**
 * Politeness limit per source host, across all users.
 *
 * Not about our costs — about not being the reason a small site falls over,
 * and about not earning the scraping complaints §20 lists under this risk.
 */
export const HOST_RUNS_PER_HOUR = 12;

/**
 * Hard monthly ceiling in US dollars. §20 requires "a hard monthly LLM spend
 * cap with graceful degradation" — graceful meaning the deterministic
 * heading path keeps working after the cap is hit, so the feature degrades to
 * free rather than to broken.
 */
export const MONTHLY_USD_CAP = serverEnv.INGEST_MONTHLY_USD_CAP;

export type LimitReason =
  'anon-exhausted' | 'user-hourly' | 'user-daily' | 'host-hourly';

export interface LimitVerdict {
  allowed: boolean;
  reason?: LimitReason;
  /** Seconds until the caller may retry. Drives the Retry-After header. */
  retryAfter?: number;
  message?: string;
}

/**
 * Identify a signed-out caller without storing an IP.
 *
 * Salted with a server secret so the hashes are not a rainbow-table of the
 * IPv4 space — an unsalted SHA of an IP is reversible by brute force in
 * seconds.
 */
export function clientHash(ip: string, userAgent = ''): string {
  const salt = serverEnv.INGEST_HASH_SALT;
  return createHash('sha256')
    .update(`${salt}:${ip}:${userAgent}`)
    .digest('hex')
    .slice(0, 32);
}

function countSince(
  db: Database,
  column: 'user_id' | 'client_hash' | 'host',
  value: string,
  hours: number,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ingest_runs
        WHERE ${column} = ?
          AND created_at >= datetime('now', ?)`,
    )
    .get(value, `-${hours} hours`) as { n: number };
  return row.n;
}

/**
 * May this caller start a run?
 *
 * Order matters: the cheapest and most specific check first, so the message
 * the user gets names the limit they actually hit.
 */
export function checkLimits(
  ctx: AuthContext,
  clientKey: string,
  host: string,
  db: Database = getDb(),
): LimitVerdict {
  if (!ctx.userId) {
    const used = countSince(db, 'client_hash', clientKey, 24 * 365);
    if (used >= ANON_FREE_RUNS) {
      return {
        allowed: false,
        reason: 'anon-exhausted',
        message: 'Sign in to turn more pages into maps.',
      };
    }
    return { allowed: true };
  }

  if (countSince(db, 'user_id', ctx.userId, 1) >= USER_RUNS_PER_HOUR) {
    return {
      allowed: false,
      reason: 'user-hourly',
      retryAfter: 3600,
      message: "You've hit the hourly limit. Try again in an hour.",
    };
  }
  if (countSince(db, 'user_id', ctx.userId, 24) >= USER_RUNS_PER_DAY) {
    return {
      allowed: false,
      reason: 'user-daily',
      retryAfter: 86400,
      message: "You've hit today's limit. Try again tomorrow.",
    };
  }
  if (host && countSince(db, 'host', host, 1) >= HOST_RUNS_PER_HOUR) {
    return {
      allowed: false,
      reason: 'host-hourly',
      retryAfter: 3600,
      message: 'That site has been read a lot recently. Try again in an hour.',
    };
  }

  return { allowed: true };
}

/** Spend so far this calendar month, in USD. */
export function monthSpend(db: Database = getDb()): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ingest_runs
        WHERE created_at >= datetime('now', 'start of month')`,
    )
    .get() as { total: number };
  return row.total;
}

/**
 * Is there budget left for a model call specifically?
 *
 * Answering false does NOT fail the run — it routes it to the deterministic
 * structurer. That is the "graceful degradation" §20 asks for: over budget,
 * the feature gets less clever, not unavailable.
 */
export function modelBudgetAvailable(db: Database = getDb()): boolean {
  return monthSpend(db) < MONTHLY_USD_CAP;
}

export interface RunRecord {
  userId: string | null;
  clientKey: string;
  url: string;
  host: string;
  outcome: string;
  source?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  mapId?: string | null;
}

/** Record an attempt. Called for failures too — see the note at the top. */
export function recordRun(record: RunRecord, db: Database = getDb()): string {
  const id = `ing_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  db.prepare(
    `INSERT INTO ingest_runs
       (id, user_id, client_hash, url, host, outcome, source,
        input_tokens, output_tokens, cost_usd, map_id)
     VALUES (@id, @userId, @clientKey, @url, @host, @outcome, @source,
             @inputTokens, @outputTokens, @costUsd, @mapId)`,
  ).run({
    id,
    userId: record.userId || null,
    clientKey: record.clientKey,
    url: record.url.slice(0, 2048),
    host: record.host,
    outcome: record.outcome,
    source: record.source ?? null,
    inputTokens: record.inputTokens ?? 0,
    outputTokens: record.outputTokens ?? 0,
    costUsd: record.costUsd ?? 0,
    mapId: record.mapId ?? null,
  });
  return id;
}

/** Attach cost to a run once the model has answered. */
export function settleRun(
  id: string,
  usage: { inputTokens: number; outputTokens: number; costUsd: number },
  source: string,
  db: Database = getDb(),
): void {
  db.prepare(
    `UPDATE ingest_runs
        SET input_tokens = @inputTokens,
            output_tokens = @outputTokens,
            cost_usd = @costUsd,
            source = @source
      WHERE id = @id`,
  ).run({ id, ...usage, source });
}

/** Mark the outcome of a run that has finished. */
export function finishRun(
  id: string,
  outcome: string,
  mapId: string | null = null,
  db: Database = getDb(),
): void {
  db.prepare(
    `UPDATE ingest_runs SET outcome = @outcome, map_id = @mapId WHERE id = @id`,
  ).run({
    id,
    outcome,
    mapId,
  });
}
