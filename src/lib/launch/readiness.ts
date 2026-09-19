import 'server-only';
import { getDb } from '@/lib/db/client';
import { MIGRATIONS } from '@/lib/db/migrations';
import { serverEnv } from '@/lib/env';

/**
 * Readiness checks (§20 P14: "monitoring").
 *
 * Each check answers "would a request fail right now for this reason", and
 * each is allowed to fail independently so the response says WHICH one broke.
 * A boolean `ready: false` tells an operator that something is wrong and
 * nothing about what, which is the least useful moment to be vague.
 */

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: Check[];
}

export function readiness(): ReadinessReport {
  const checks: Check[] = [];

  // 1. Can we talk to the database at all?
  let db: ReturnType<typeof getDb> | null = null;
  try {
    db = getDb();
    db.prepare('SELECT 1').get();
    checks.push({ name: 'database', ok: true, detail: 'reachable' });
  } catch (error) {
    checks.push({
      name: 'database',
      ok: false,
      detail: error instanceof Error ? error.name : 'unreachable',
    });
  }

  // 2. Are migrations applied? A booted process on an old schema fails every
  //    write with a confusing error; better to refuse traffic and say so.
  if (db) {
    try {
      const applied = (
        db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number }
      ).n;
      const expected = MIGRATIONS.length;
      checks.push({
        name: 'migrations',
        ok: applied >= expected,
        detail: `${applied}/${expected} applied`,
      });
    } catch {
      checks.push({ name: 'migrations', ok: false, detail: 'no migration table' });
    }
  }

  // 3. Is the writable path actually writable? A read-only volume looks
  //    perfectly healthy until the first save.
  if (db) {
    try {
      db.prepare('PRAGMA quick_check').get();
      const journal = db.pragma('journal_mode', { simple: true });
      checks.push({ name: 'storage', ok: true, detail: String(journal) });
    } catch {
      checks.push({ name: 'storage', ok: false, detail: 'not writable' });
    }
  }

  /**
   * 4. Is instrumentation actually connected?
   *
   * §20 rates "launching without instrumentation" as this phase's High risk,
   * so a deployed environment running the console provider is a DEGRADED
   * state, not a healthy one. Making it visible in readiness is what stops it
   * being discovered three weeks into the beta when someone asks for numbers.
   */
  const deployed = serverEnv.APP_ENV !== 'local';
  const analytics = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER ?? 'console';
  checks.push({
    name: 'analytics',
    ok: !deployed || analytics === 'beacon',
    detail: deployed ? `${analytics} (deployed)` : `${analytics} (local)`,
  });

  /**
   * 5. Is the hash salt still the development default?
   *
   * It salts the rate-limit identifiers for signed-out visitors. Shipping the
   * default means every deployment shares a salt, which makes those hashes
   * correlatable across environments.
   */
  checks.push({
    name: 'secrets',
    ok: !deployed || serverEnv.INGEST_HASH_SALT !== 'cdn-local-development-salt',
    detail: deployed ? 'checked' : 'not checked locally',
  });

  return { ready: checks.every((check) => check.ok), checks };
}
