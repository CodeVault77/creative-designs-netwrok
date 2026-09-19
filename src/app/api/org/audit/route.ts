import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { orgRoleOf } from '@/lib/orgs/repo';
import {
  isAuditAction,
  queryOrg,
  querySelf,
  record,
  summarise,
  toCsv,
} from '@/lib/enterprise/audit';

export const dynamic = 'force-dynamic';

/**
 * Reading the audit log.
 *
 * ── Read-only, by design ────────────────────────────────────────────────────
 *
 * There is no POST here and there never will be. An audit log the application
 * can write arbitrary rows into through an HTTP endpoint is an audit log
 * anybody who finds a bug can forge. Rows are written by the code performing
 * the action, in the same transaction wherever that is possible.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const orgId = params.get('org');
  const ctx = { userId: session.userId, isStaff: session.isStaff };

  // No org: a person's own trail. Always readable by them — it is about them.
  if (!orgId) {
    return NextResponse.json({ entries: querySelf(ctx), summary: [] });
  }

  const role = orgRoleOf(ctx, orgId);
  const actionParam = params.get('action');

  const entries = queryOrg(ctx, orgId, role, {
    action: actionParam && isAuditAction(actionParam) ? actionParam : undefined,
    actorId: params.get('actor') ?? undefined,
    since: params.get('since') ?? undefined,
    until: params.get('until') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    limit: Number(params.get('limit') ?? '100'),
  });

  if (params.get('format') === 'csv') {
    /*
     * The export is itself an audited event.
     *
     * Somebody taking a copy of the audit log is exactly the kind of thing an
     * audit log exists to record, and it is the one action that would
     * otherwise leave no trace of itself.
     */
    record({
      action: 'admin.export_generated',
      actorId: session.userId,
      orgId,
      metadata: { rows: entries.length },
    });

    return new NextResponse(toCsv(entries), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-${orgId}.csv"`,
      },
    });
  }

  return NextResponse.json({
    entries,
    summary: summarise(ctx, orgId, role),
    /*
     * Keyset cursor, not an offset. The log is written to while it is read,
     * and an offset would skip or repeat rows between pages — which in an
     * audit trail reads as evidence going missing.
     */
    cursor: entries.length > 0 ? entries[entries.length - 1]!.id : null,
  });
}
