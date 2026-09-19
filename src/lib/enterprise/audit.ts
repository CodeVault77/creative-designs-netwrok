import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { subjectFor } from '@/lib/auth/rate-limit';

/**
 * The audit log.
 *
 * ── Why this is not `events` ────────────────────────────────────────────────
 *
 * `lib/jobs/events.ts` already records things that happened, so a second log
 * needs justifying. They answer different questions for different readers:
 *
 *   events      is MACHINERY. It drives jobs, workflows and webhooks. Its
 *               types come and go as the product changes, its payloads are
 *               shaped for the code that consumes them, and nothing outside
 *               engineering ever reads it.
 *
 *   audit_log   is EVIDENCE. Nobody's code branches on it. It is read months
 *               later by a person answering "who changed this, when, and from
 *               where" — often to a regulator, sometimes about an account that
 *               no longer exists.
 *
 * Merging them would mean either the audit log inheriting every internal event
 * type as noise, or the event bus being constrained by what an auditor needs
 * to see. The duplication is small and the coupling would not be.
 *
 * ── The actor is denormalised on purpose ────────────────────────────────────
 *
 * `actor_label` stores the handle and email at the time of the action, beside
 * the foreign key. Normalising would be correct database design and wrong
 * here: the row must still read correctly after the account is deleted, and
 * "user 4a7f… removed a member" is not an audit trail.
 *
 * ── Append-only ─────────────────────────────────────────────────────────────
 *
 * There is no update and no delete in this module beyond the retention sweep,
 * and the sweep only ever removes rows older than a stated window. An audit
 * log a suspect can edit is not one.
 */

/**
 * The actions worth recording.
 *
 * A closed list, not a free string. Two reasons: an auditor filtering by
 * action needs the vocabulary to be stable, and a typo'd action name is a row
 * that will never be found by anyone looking for it.
 */
export const AUDIT_ACTIONS = [
  // Authentication
  'auth.signed_in',
  'auth.signed_out',
  'auth.failed',
  'auth.password_changed',
  'auth.sessions_revoked',
  // Second factor
  'mfa.enabled',
  'mfa.disabled',
  'mfa.recovery_used',
  'mfa.recovery_regenerated',
  // Single sign-on
  'sso.connection_created',
  'sso.connection_updated',
  'sso.connection_deleted',
  'sso.signed_in',
  'sso.provisioned_user',
  // Organisation
  'org.member_added',
  'org.member_removed',
  'org.role_changed',
  'org.settings_changed',
  'org.branding_changed',
  'org.domain_verified',
  // Data
  'map.deleted',
  'map.visibility_changed',
  'map.transferred',
  // Credentials
  'key.issued',
  'key.revoked',
  'plugin.installed',
  'plugin.uninstalled',
  // Administration
  'admin.impersonation_attempt',
  'admin.export_generated',
  'audit.retention_swept',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export interface AuditEntry {
  id: string;
  orgId: string | null;
  actorId: string | null;
  actorLabel: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AuditRow {
  id: string;
  org_id: string | null;
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: string;
  created_at: string;
}

function hydrate(row: AuditRow): AuditEntry {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    metadata = {};
  }

  return {
    id: row.id,
    orgId: row.org_id,
    actorId: row.actor_id,
    actorLabel: row.actor_label,
    action: row.action as AuditAction,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata,
    createdAt: row.created_at,
  };
}

export interface RecordInput {
  action: AuditAction;
  actorId?: string | null;
  /** Handle or email, captured now. See the note above on denormalisation. */
  actorLabel?: string;
  orgId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  /** Raw client address. Hashed here; never stored in clear. */
  clientIp?: string;
}

/**
 * Write an audit row.
 *
 * ── Never throws ────────────────────────────────────────────────────────────
 *
 * An audit write that failed the action it was recording would be the worst
 * possible trade: someone unable to sign out because the log was full. It
 * catches, logs to stderr and returns — the operational alarm for a failing
 * audit log is monitoring on that stderr line, not a broken product.
 *
 * The counter-argument is real: an attacker who can break the audit log can
 * then act unlogged. It is answered by making the failure loud rather than by
 * refusing the action, because in every case here the action has ALREADY
 * happened by the time this is called.
 */
export function record(input: RecordInput, db: Database = getDb()): void {
  try {
    db.prepare(
      `INSERT INTO audit_log
         (id, org_id, actor_id, actor_label, action, target_type, target_id,
          metadata, client_hash)
       VALUES (@id, @orgId, @actorId, @actorLabel, @action, @targetType,
               @targetId, @metadata, @clientHash)`,
    ).run({
      id: randomUUID(),
      orgId: input.orgId ?? null,
      actorId: input.actorId ?? null,
      actorLabel: (input.actorLabel ?? '').slice(0, 200),
      action: input.action,
      targetType: (input.targetType ?? '').slice(0, 40),
      targetId: (input.targetId ?? '').slice(0, 80),
      metadata: JSON.stringify(input.metadata ?? {}).slice(0, 4000),
      /*
       * Salted hash, never a raw address — the same policy the rate limiter
       * and the ingest budget follow. It is enough to answer "was this the
       * same client as that", which is the audit question, without the log
       * becoming a store of personal data with its own retention problem.
       */
      clientHash: input.clientIp ? subjectFor(input.clientIp) : '',
    });
  } catch (cause) {
    console.error('[audit] FAILED TO RECORD', input.action, cause);
  }
}

export interface QueryOptions {
  action?: AuditAction;
  actorId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Read an organisation's log. Admins of that org, or staff.
 *
 * Takes an explicit `orgRole` rather than resolving it, so the caller has to
 * have asked the question — a reader that silently resolved membership would
 * make it easy to call this from somewhere that had not checked anything.
 */
export function queryOrg(
  ctx: AuthContext,
  orgId: string,
  orgRole: string | null,
  options: QueryOptions = {},
  db: Database = getDb(),
): AuditEntry[] {
  const permitted = ctx.isStaff || orgRole === 'owner' || orgRole === 'admin';
  if (!permitted) return [];

  const clauses = ['audit_log.org_id = @orgId'];
  const params: Record<string, string | number> = {
    orgId,
    limit: Math.min(500, Math.max(1, options.limit ?? 100)),
  };

  if (options.action) {
    clauses.push('audit_log.action = @action');
    params.action = options.action;
  }
  if (options.actorId) {
    clauses.push('audit_log.actor_id = @actorId');
    params.actorId = options.actorId;
  }
  if (options.since) {
    clauses.push('audit_log.created_at >= @since');
    params.since = options.since;
  }
  if (options.until) {
    clauses.push('audit_log.created_at <= @until');
    params.until = options.until;
  }
  if (options.cursor) {
    /*
     * Keyset pagination on (created_at, id), not OFFSET.
     *
     * An audit log grows forever and is written to while being read. OFFSET
     * would make page 40 slow and would skip or repeat rows whenever
     * something was written between pages — which in an audit trail reads as
     * evidence going missing.
     */
    clauses.push('audit_log.id < @cursor');
    params.cursor = options.cursor;
  }

  const rows = db
    .prepare(
      `SELECT * FROM audit_log WHERE ${clauses.join(' AND ')}
        ORDER BY audit_log.created_at DESC, audit_log.id DESC
        LIMIT @limit`,
    )
    .all(params) as AuditRow[];

  return rows.map(hydrate);
}

/** A person's own trail. Always readable by them — it is about them. */
export function querySelf(
  ctx: AuthContext,
  limit = 100,
  db: Database = getDb(),
): AuditEntry[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `SELECT * FROM audit_log WHERE actor_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(ctx.userId, Math.min(500, limit)) as AuditRow[];

  return rows.map(hydrate);
}

/**
 * Export as CSV.
 *
 * ── Formula injection ───────────────────────────────────────────────────────
 *
 * A field beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and
 * Sheets when the file is opened. An audit log contains attacker-influenced
 * strings — a display name, a map title — so a CSV export is a delivery
 * mechanism for that unless every such field is prefixed. This is the one
 * place in the codebase where a leading apostrophe is a security control.
 */
export function toCsv(entries: readonly AuditEntry[]): string {
  const escape = (value: unknown): string => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

    return `"${guarded.replace(/"/g, '""')}"`;
  };

  const header = [
    'timestamp',
    'action',
    'actor',
    'actor_id',
    'target_type',
    'target_id',
    'metadata',
  ].join(',');

  const lines = entries.map((entry) =>
    [
      escape(entry.createdAt),
      escape(entry.action),
      escape(entry.actorLabel),
      escape(entry.actorId ?? ''),
      escape(entry.targetType),
      escape(entry.targetId),
      escape(JSON.stringify(entry.metadata)),
    ].join(','),
  );

  return [header, ...lines].join('\r\n');
}

/** Default retention. Two years covers most audit obligations. */
export const RETENTION_DAYS = 730;

/**
 * Delete rows past the retention window.
 *
 * The only deletion in this module, and it records itself doing it — an audit
 * log with a silent gap is worse than one that says "12,400 rows older than
 * two years were removed on this date".
 */
export function sweepRetention(
  days = RETENTION_DAYS,
  db: Database = getDb(),
): number {
  const removed = db
    .prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', ?)`)
    .run(`-${Math.max(1, Math.round(days))} days`).changes;

  if (removed > 0) {
    record(
      {
        action: 'audit.retention_swept',
        actorLabel: 'system',
        metadata: { removed, days },
      },
      db,
    );
  }

  return removed;
}

export interface AuditSummary {
  action: AuditAction;
  count: number;
}

/** Counts by action over a window. The dashboard's top strip. */
export function summarise(
  ctx: AuthContext,
  orgId: string,
  orgRole: string | null,
  days = 30,
  db: Database = getDb(),
): AuditSummary[] {
  const permitted = ctx.isStaff || orgRole === 'owner' || orgRole === 'admin';
  if (!permitted) return [];

  const rows = db
    .prepare(
      `SELECT action, COUNT(*) AS n FROM audit_log
        WHERE org_id = ? AND created_at >= datetime('now', ?)
        GROUP BY action ORDER BY n DESC`,
    )
    .all(orgId, `-${Math.max(1, Math.round(days))} days`) as {
    action: string;
    n: number;
  }[];

  return rows
    .filter((row) => isAuditAction(row.action))
    .map((row) => ({ action: row.action as AuditAction, count: row.n }));
}
