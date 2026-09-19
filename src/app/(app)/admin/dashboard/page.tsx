import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import {
  activationReport,
  comingSoonDemand,
  eventVolume,
  threeTapReport,
} from '@/lib/analytics/store';
import { listErrors } from '@/lib/launch/errors';
import { listSupport } from '@/lib/launch/support';
import { readiness } from '@/lib/launch/readiness';
import { queueStats } from '@/lib/jobs/queue';
import { StaffDashboard } from '@/components/admin/StaffDashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operations' };

/**
 * The staff dashboard ADR-0009 promised and never delivered.
 *
 * That ADR argued for first-party analytics partly on the grounds that
 * "funnels are computed with SQL and read on a staff-only dashboard". The
 * collection half shipped in P14; the reading half did not. Everything below
 * has been recorded for months and could not be seen without a SQL client:
 * activation funnels, grouped error reports, the support queue, readiness, and
 * now the job queue.
 *
 * A server component that reads directly, because every one of these functions
 * is staff-gated already and re-exposing them as routes would be a second
 * surface to secure for no gain.
 */
export default async function Page() {
  const session = await getSession();

  /*
   * 404, not 403 — the convention used everywhere else in this codebase. A 403
   * confirms the page exists, which tells someone probing for an admin surface
   * exactly what they wanted to know.
   */
  if (!session?.isStaff) notFound();

  const ctx = { userId: session.userId, isStaff: true };

  return (
    <StaffDashboard
      readiness={readiness()}
      queue={queueStats()}
      threeTap={threeTapReport(ctx)}
      activation={activationReport(ctx)}
      demand={comingSoonDemand(ctx)}
      volume={eventVolume(ctx)}
      errors={listErrors(ctx, { includeResolved: false })}
      support={listSupport(ctx, 'open')}
    />
  );
}
