import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { readiness } from '@/lib/launch/readiness';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Liveness and readiness (§20 P14: "monitoring").
 *
 * Two different questions, deliberately answered by one endpoint with two
 * modes, because conflating them is the classic monitoring mistake:
 *
 *   - **Liveness** (default): is this process running? Answered without
 *     touching anything, so a slow database never makes the process look dead
 *     and get restarted — which is how a slow dependency becomes an outage.
 *   - **Readiness** (`?ready=1`): can it actually serve? Checks the database
 *     and that migrations are applied, and returns 503 when they are not, so a
 *     load balancer holds traffic off a container that booted but cannot work.
 *
 * Deliberately reveals nothing beyond what an operator needs: no dependency
 * versions, no environment values, no stack details. The version string is the
 * exception — identifying which deploy is running is the first thing anyone
 * needs during an incident, and it is not a secret.
 */
export function GET(request: Request) {
  const wantsReadiness = new URL(request.url).searchParams.get('ready') === '1';

  if (!wantsReadiness) {
    return NextResponse.json(
      {
        status: 'ok',
        environment: serverEnv.APP_ENV,
        version: serverEnv.APP_VERSION,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const report = readiness();

  return NextResponse.json(
    {
      status: report.ready ? 'ok' : 'degraded',
      environment: serverEnv.APP_ENV,
      version: serverEnv.APP_VERSION,
      checks: report.checks,
      timestamp: new Date().toISOString(),
    },
    {
      // 503 so an orchestrator holds traffic rather than sending it into a
      // process that will fail every request.
      status: report.ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
