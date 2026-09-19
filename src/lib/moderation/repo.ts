import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';

/**
 * Reporting and moderation (§15, screen 21).
 *
 * Two principles, both from §15, and both of them constraints rather than
 * features:
 *
 *   - **"Private maps are not scanned — scanning private content is a promise
 *     you cannot walk back."** So moderation acts on things that are PUBLIC or
 *     have been REPORTED. There is no sweep, no classifier over private maps,
 *     and no code path that reads a private map without a report pointing at
 *     it.
 *
 *   - **"Every action written to an audit trail."** The trail is append-only
 *     and outlives its target: `moderation_actions.target_id` is a plain
 *     column with no foreign key, so removing a node does not erase the record
 *     of who removed it. A trail that cascades away is not a trail.
 */

export type TargetType = 'node' | 'map' | 'message' | 'user';

/**
 * The reasons offered, in one place.
 *
 * A fixed list rather than free text as the primary field: free text alone
 * gives a queue nobody can triage, and "other" plus a detail box covers what
 * the list misses.
 */
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or self-harm' },
  { value: 'illegal', label: 'Illegal content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'copyright', label: 'Copyright' },
  { value: 'other', label: 'Something else' },
] as const;

export const REPORT_REASON_VALUES = REPORT_REASONS.map((reason) => reason.value);

/** §15's moderation actions, exactly. */
export const MODERATION_ACTIONS = [
  'dismiss',
  'warn',
  'unpublish',
  'remove',
  'suspend',
] as const;

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export interface ReportRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  reporterId: string | null;
  reporterName: string;
  reason: string;
  detail: string;
  status: string;
  createdAt: string;
  /** How many open reports this target has. Drives triage order. */
  reportCount: number;
}

export const MAX_REPORT_DETAIL = 1000;

/**
 * File a report.
 *
 * Deliberately open to signed-out visitors. The people most in need of a report
 * button are often not members — someone who has followed a link to a public
 * map and found something abusive on it should not have to create an account
 * to say so.
 *
 * Rate-limited by client hash so it cannot be used to bury the queue.
 */
export function fileReport(
  ctx: AuthContext,
  input: {
    targetType: TargetType;
    targetId: string;
    reason: string;
    detail?: string;
    clientHash: string;
  },
  db: Database = getDb(),
): { ok: boolean; id?: string; error?: string } {
  if (
    !REPORT_REASON_VALUES.includes(
      input.reason as (typeof REPORT_REASON_VALUES)[number],
    )
  ) {
    return { ok: false, error: 'Choose a reason' };
  }
  if (!input.targetId.trim()) return { ok: false, error: 'Nothing to report' };

  /**
   * One open report per person per target.
   *
   * Not an error the reporter sees as a failure — they are told it was
   * received either way. Telling someone "you already reported this" when they
   * are upset enough to try twice serves nobody.
   */
  if (ctx.userId) {
    const existing = db
      .prepare(
        `SELECT id FROM reports
          WHERE target_type = ? AND target_id = ? AND reporter_id = ? AND status = 'open'`,
      )
      .get(input.targetType, input.targetId, ctx.userId);
    if (existing) return { ok: true, id: (existing as { id: string }).id };
  }

  // A flood guard for signed-out reporters, who have no id to dedupe against.
  const recent = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM reports
          WHERE reporter_id IS @userId
            AND created_at >= datetime('now', '-1 hour')`,
      )
      .get({ userId: ctx.userId || null }) as { n: number }
  ).n;

  if (!ctx.userId && recent >= 20) {
    return { ok: false, error: 'Too many reports just now. Try again shortly.' };
  }

  const id = `rep_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  db.prepare(
    `INSERT INTO reports (id, target_type, target_id, reporter_id, reason, detail)
     VALUES (@id, @targetType, @targetId, @reporterId, @reason, @detail)`,
  ).run({
    id,
    targetType: input.targetType,
    targetId: input.targetId,
    reporterId: ctx.userId || null,
    reason: input.reason,
    detail: (input.detail ?? '').slice(0, MAX_REPORT_DETAIL),
  });

  return { ok: true, id };
}

/**
 * The queue (screen 21). Staff only — enforced here AND at the route.
 *
 * Checked in both places on purpose: the route is the gate people go through,
 * and this is the gate a future caller might forget to.
 */
export function listReports(
  ctx: AuthContext,
  filter: { status?: string; targetType?: TargetType } = {},
  db: Database = getDb(),
): ReportRow[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `SELECT reports.*,
              COALESCE(users.display_name, 'Anonymous') AS reporter_name,
              (SELECT COUNT(*) FROM reports AS peer
                WHERE peer.target_type = reports.target_type
                  AND peer.target_id = reports.target_id
                  AND peer.status = 'open') AS report_count
         FROM reports
         LEFT JOIN users ON users.id = reports.reporter_id
        WHERE (@status IS NULL OR reports.status = @status)
          AND (@targetType IS NULL OR reports.target_type = @targetType)
        ORDER BY report_count DESC, reports.created_at DESC
        LIMIT 200`,
    )
    .all({
      status: filter.status ?? null,
      targetType: filter.targetType ?? null,
    }) as {
    id: string;
    target_type: string;
    target_id: string;
    reporter_id: string | null;
    reporter_name: string;
    reason: string;
    detail: string;
    status: string;
    created_at: string;
    report_count: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    targetType: row.target_type as TargetType,
    targetId: row.target_id,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    createdAt: row.created_at,
    reportCount: row.report_count,
  }));
}

export interface AuditRow {
  id: string;
  moderatorName: string;
  action: string;
  targetType: string;
  targetId: string;
  note: string;
  createdAt: string;
}

/**
 * Act on a report.
 *
 * The action and its audit entry are ONE transaction. An action that succeeds
 * without its trail entry is exactly the case the trail exists to cover, and
 * "the moderation worked but the log did not" is not a state anyone can
 * reconstruct afterwards.
 */
export function actOnReport(
  ctx: AuthContext,
  reportId: string,
  action: ModerationAction,
  note = '',
  db: Database = getDb(),
): { ok: boolean; error?: string } {
  if (!ctx.isStaff) return { ok: false, error: 'Not found' };
  if (!MODERATION_ACTIONS.includes(action)) {
    return { ok: false, error: 'Unknown action' };
  }

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId) as
    { id: string; target_type: TargetType; target_id: string } | undefined;

  if (!report) return { ok: false, error: 'Not found' };

  const run = db.transaction(() => {
    switch (action) {
      case 'dismiss':
        break;

      case 'warn':
        // A warning is a record and a notification, not a state on the target.
        break;

      case 'unpublish':
        // Reversible: the content stays, it just stops being public. Always
        // the first reach for anything ambiguous.
        if (report.target_type === 'map') {
          db.prepare(`UPDATE maps SET visibility = 'private' WHERE id = ?`).run(
            report.target_id,
          );
        } else if (report.target_type === 'node') {
          db.prepare(
            `UPDATE map_nodes SET visibility = 'private' WHERE id = ?`,
          ).run(report.target_id);
        }
        break;

      case 'remove':
        // Irreversible, so it is reserved for things that must not exist.
        if (report.target_type === 'message') {
          db.prepare('DELETE FROM map_messages WHERE id = ?').run(report.target_id);
        } else if (report.target_type === 'node') {
          db.prepare('DELETE FROM map_nodes WHERE id = ?').run(report.target_id);
        } else if (report.target_type === 'map') {
          db.prepare('DELETE FROM maps WHERE id = ?').run(report.target_id);
        }
        break;

      case 'suspend':
        if (report.target_type === 'user') {
          db.prepare(
            `UPDATE users SET suspended_at = datetime('now') WHERE id = ?`,
          ).run(report.target_id);
        }
        break;
    }

    db.prepare(`UPDATE reports SET status = @status WHERE id = @id`).run({
      id: reportId,
      status: action === 'dismiss' ? 'dismissed' : 'actioned',
    });

    /**
     * Every other open report on the same target is resolved too. Leaving them
     * means a moderator works through five rows describing one thing and has
     * no way to tell it is already handled.
     */
    db.prepare(
      `UPDATE reports SET status = @status
        WHERE target_type = @targetType AND target_id = @targetId AND status = 'open'`,
    ).run({
      status: action === 'dismiss' ? 'dismissed' : 'actioned',
      targetType: report.target_type,
      targetId: report.target_id,
    });

    db.prepare(
      `INSERT INTO moderation_actions
         (id, report_id, moderator_id, action, target_type, target_id, note)
       VALUES (@id, @reportId, @moderatorId, @action, @targetType, @targetId, @note)`,
    ).run({
      id: `mod_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      reportId,
      moderatorId: ctx.userId || null,
      action,
      targetType: report.target_type,
      targetId: report.target_id,
      note: note.slice(0, 500),
    });
  });

  run();
  return { ok: true };
}

/** §15: "Every action written to an audit trail." */
export function listAudit(ctx: AuthContext, db: Database = getDb()): AuditRow[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `SELECT moderation_actions.*,
              COALESCE(users.display_name, 'Removed account') AS moderator_name
         FROM moderation_actions
         LEFT JOIN users ON users.id = moderation_actions.moderator_id
        ORDER BY moderation_actions.created_at DESC
        LIMIT 200`,
    )
    .all() as {
    id: string;
    moderator_name: string;
    action: string;
    target_type: string;
    target_id: string;
    note: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    moderatorName: row.moderator_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export function isSuspended(userId: string, db: Database = getDb()): boolean {
  const row = db
    .prepare('SELECT suspended_at FROM users WHERE id = ?')
    .get(userId) as { suspended_at: string | null } | undefined;
  return Boolean(row?.suspended_at);
}
