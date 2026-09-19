import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { drain } from '@/lib/jobs/worker';
import { queueStats } from '@/lib/jobs/queue';

/*
 * Importing this module is what REGISTERS the outbox handler — registration
 * happens at module load. The worker must never be reachable before the
 * handlers it needs are known, or the first tick dead-letters the job for
 * having no handler.
 */
import { scheduleOutboxDrain } from '@/lib/email/drain';

/*
 * Same reason: importing this module registers the webhook fan-out and
 * delivery handlers and binds their event subscriptions. Without it every
 * queued delivery would dead-letter for having no handler — silently, at the
 * moment somebody's integration was waiting for it.
 */
import '@/lib/webhooks/fanout';

export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/drain — run pending background work.
 *
 * ── Why an HTTP endpoint and not a long-lived worker ────────────────────────
 *
 * A Next.js server has no supervised worker process. A `setInterval` started at
 * module load would run once per server instance, would not survive a
 * redeploy's overlap, and would be invisible to monitoring. An endpoint a
 * scheduler calls is observable, restartable, and works identically on every
 * host — and the scheduler already has to exist for backups.
 *
 * Call it every minute:
 *   curl -X POST -H "authorization: Bearer $JOB_RUNNER_TOKEN" \\
 *        https://example.com/api/jobs/drain
 *
 * ── Authorisation ───────────────────────────────────────────────────────────
 *
 * A scheduler has no session, so this accepts a bearer token OR a staff
 * session. When no token is configured the token path is closed entirely
 * rather than defaulting to open — an unauthenticated drain endpoint lets
 * anyone force retries and read queue depth.
 */
export async function POST(request: Request) {
  const configured = serverEnv.JOB_RUNNER_TOKEN;
  const offered = request.headers.get('authorization');

  /*
   * Compared only when a token is configured, so an unset variable can never
   * match an absent header and let a request through.
   */
  const tokenOk = Boolean(
    configured && offered && offered === `Bearer ${configured}`,
  );

  if (!tokenOk) {
    const session = await getSession();
    if (!session?.isStaff) {
      // 404, not 403: the same convention the rest of the app uses, so this
      // endpoint does not confirm its own existence to an unauthorised caller.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  /*
   * Make sure there is an outbox sweep to run.
   *
   * Without this the queue would only ever drain mail that something explicitly
   * scheduled, so a message queued by a code path that forgot to schedule would
   * sit forever — exactly the failure this whole subsystem exists to end. The
   * dedupe key means a tick that finds one already pending adds nothing.
   */
  scheduleOutboxDrain();

  /*
   * Bounded per call. The scheduler calling again is how more work gets done —
   * an unbounded loop would hold this request open for as long as jobs keep
   * arriving and give the platform's request timeout something to kill.
   */
  const result = await drain(25);

  return NextResponse.json({ ...result, queue: queueStats() });
}

/** GET — queue depth. Staff only; the number that matters is `dead`. */
export async function GET() {
  const session = await getSession();
  if (!session?.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ queue: queueStats() });
}
