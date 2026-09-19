import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser, type AuthContext } from '@/lib/db/repo';
import { createDraft } from '@/lib/editor/draft';
import {
  MODERATION_ACTIONS,
  REPORT_REASONS,
  actOnReport,
  fileReport,
  isSuspended,
  listAudit,
  listReports,
} from './repo';

/**
 * §15's trust and safety rules, as tests.
 *
 * The two that matter most are both about restraint rather than capability:
 *
 *   - **Private maps are not scanned.** Moderation acts on what is public or
 *     what has been reported, and there is no path that reads private content
 *     without a report pointing at it. "Scanning private content is a promise
 *     you cannot walk back."
 *   - **Every action is written to an audit trail**, and the trail outlives
 *     what it describes. A log that cascade-deletes with its target is not a
 *     log.
 */

let db: Database;
let staff: AuthContext;
let alice: AuthContext;
let bob: AuthContext;

const anon: AuthContext = { userId: '', isStaff: false };

beforeEach(() => {
  db = createTestDb();

  const make = (id: string, handle: string) =>
    createUser(
      {
        id,
        email: `${handle}@example.com`,
        passwordHash: 'x',
        handle,
        displayName: handle[0]!.toUpperCase() + handle.slice(1),
      },
      db,
    );

  make('u_staff', 'staff');
  make('u_alice', 'alice');
  make('u_bob', 'bob');

  staff = { userId: 'u_staff', isStaff: true };
  alice = { userId: 'u_alice', isStaff: false };
  bob = { userId: 'u_bob', isStaff: false };
});

function report(ctx: AuthContext, over: Record<string, unknown> = {}) {
  return fileReport(
    ctx,
    {
      targetType: 'node',
      targetId: 'n_bad',
      reason: 'harassment',
      detail: 'This is abusive.',
      clientHash: 'client-1',
      ...over,
    } as Parameters<typeof fileReport>[1],
    db,
  );
}

// -------------------------------------------------------------- reporting

describe('reporting', () => {
  it('accepts a report from a signed-in person', () => {
    const result = report(alice);
    expect(result.ok).toBe(true);
    expect(result.id).toMatch(/^rep_/);
  });

  /**
   * §15 puts report "in the overflow of every node, map, message and profile".
   * The people most in need of it are often not members.
   */
  it('accepts a report from someone with no account', () => {
    expect(report(anon).ok).toBe(true);
  });

  it('covers all four target types', () => {
    for (const targetType of ['node', 'map', 'message', 'user'] as const) {
      expect(report(alice, { targetType, targetId: `t_${targetType}` }).ok).toBe(
        true,
      );
    }
    expect(listReports(staff, {}, db)).toHaveLength(4);
  });

  it('refuses a reason outside the list', () => {
    expect(report(alice, { reason: 'because' }).ok).toBe(false);
  });

  it('offers reasons that cover what people actually report', () => {
    const values = REPORT_REASONS.map((r) => r.value);
    for (const needed of ['spam', 'harassment', 'hate', 'illegal', 'other']) {
      expect(values).toContain(needed);
    }
  });

  /**
   * Reporting twice is not an error the reporter sees. Telling someone "you
   * already reported this" when they are upset enough to try again serves
   * nobody.
   */
  it('dedupes a repeat report without complaining', () => {
    const first = report(alice);
    const second = report(alice);

    expect(second.ok).toBe(true);
    expect(second.id).toBe(first.id);
    expect(listReports(staff, {}, db)).toHaveLength(1);
  });

  it('counts two different people reporting the same thing', () => {
    report(alice);
    report(bob);

    const rows = listReports(staff, {}, db);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.reportCount).toBe(2);
  });

  it('truncates an over-long detail rather than storing it', () => {
    report(alice, { detail: 'x'.repeat(5000) });
    expect(listReports(staff, {}, db)[0]!.detail.length).toBeLessThanOrEqual(1000);
  });
});

// ------------------------------------------------------------- the queue

describe('the queue', () => {
  it('is invisible to everyone but staff', () => {
    report(alice);
    expect(listReports(alice, {}, db)).toEqual([]);
    expect(listReports(anon, {}, db)).toEqual([]);
    expect(listReports(staff, {}, db)).toHaveLength(1);
  });

  /**
   * Ordered by how many people reported the same thing, not by time. Ten
   * reports on one node is the signal; the oldest row usually is not.
   */
  it('puts the most-reported target first', () => {
    report(alice, { targetId: 'n_quiet' });
    report(alice, { targetId: 'n_loud' });
    report(bob, { targetId: 'n_loud' });

    expect(listReports(staff, {}, db)[0]!.targetId).toBe('n_loud');
  });

  it('filters by status and type', () => {
    report(alice, { targetType: 'map', targetId: 'm_1' });
    report(alice, { targetType: 'node', targetId: 'n_1' });

    expect(listReports(staff, { targetType: 'map' }, db)).toHaveLength(1);
    expect(listReports(staff, { status: 'open' }, db)).toHaveLength(2);
    expect(listReports(staff, { status: 'actioned' }, db)).toHaveLength(0);
  });

  it('names an anonymous reporter as anonymous rather than blank', () => {
    report(anon);
    expect(listReports(staff, {}, db)[0]!.reporterName).toBe('Anonymous');
  });
});

// ------------------------------------------------------------- the actions

describe('moderation actions', () => {
  it('offers exactly the five §15 names', () => {
    expect([...MODERATION_ACTIONS]).toEqual([
      'dismiss',
      'warn',
      'unpublish',
      'remove',
      'suspend',
    ]);
  });

  it('lets only staff act', () => {
    const filed = report(alice);
    expect(actOnReport(alice, filed.id!, 'dismiss', '', db).ok).toBe(false);
    expect(actOnReport(anon, filed.id!, 'dismiss', '', db).ok).toBe(false);
    expect(actOnReport(staff, filed.id!, 'dismiss', '', db).ok).toBe(true);
  });

  it('dismisses without touching the target', () => {
    const filed = report(alice);
    actOnReport(staff, filed.id!, 'dismiss', 'not a problem', db);

    expect(listReports(staff, { status: 'open' }, db)).toHaveLength(0);
    expect(listReports(staff, { status: 'dismissed' }, db)).toHaveLength(1);
  });

  /**
   * Unpublish is reversible — the content stays, it just stops being public.
   * It is the first reach for anything ambiguous, which is most things.
   */
  it('unpublishes a map without deleting it', () => {
    const draft = createDraft('m_public', 'A public map', 'create');
    draft.visibility = 'public';
    createMap(alice, draft, db);

    const filed = report(alice, { targetType: 'map', targetId: 'm_public' });
    actOnReport(staff, filed.id!, 'unpublish', '', db);

    const row = db
      .prepare('SELECT visibility FROM maps WHERE id = ?')
      .get('m_public') as {
      visibility: string;
    };
    expect(row.visibility).toBe('private');
  });

  it('removes content when removal is the answer', () => {
    const draft = createDraft('m_gone', 'Doomed', 'create');
    createMap(alice, draft, db);

    const filed = report(alice, { targetType: 'map', targetId: 'm_gone' });
    actOnReport(staff, filed.id!, 'remove', 'illegal', db);

    expect(
      db.prepare('SELECT id FROM maps WHERE id = ?').get('m_gone'),
    ).toBeUndefined();
  });

  it('suspends an account', () => {
    const filed = report(alice, { targetType: 'user', targetId: 'u_bob' });
    actOnReport(staff, filed.id!, 'suspend', 'repeated abuse', db);

    expect(isSuspended('u_bob', db)).toBe(true);
    expect(isSuspended('u_alice', db)).toBe(false);
  });

  /**
   * Resolving one report resolves every other open report on the same target.
   * Otherwise a moderator works through five rows describing one thing with no
   * way to tell it is already handled.
   */
  it('closes sibling reports on the same target', () => {
    report(alice, { targetId: 'n_loud' });
    const second = report(bob, { targetId: 'n_loud' });

    actOnReport(staff, second.id!, 'dismiss', '', db);
    expect(listReports(staff, { status: 'open' }, db)).toHaveLength(0);
  });

  it('refuses an unknown report or action', () => {
    expect(actOnReport(staff, 'rep_nope', 'dismiss', '', db).ok).toBe(false);
    const filed = report(alice);
    expect(
      actOnReport(staff, filed.id!, 'delete-everything' as 'dismiss', '', db).ok,
    ).toBe(false);
  });
});

// -------------------------------------------------------- the audit trail

describe('the audit trail', () => {
  it('records every action with who did it', () => {
    const filed = report(alice);
    actOnReport(staff, filed.id!, 'warn', 'first warning', db);

    const audit = listAudit(staff, db);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.moderatorName).toBe('Staff');
    expect(audit[0]!.action).toBe('warn');
    expect(audit[0]!.note).toBe('first warning');
  });

  it('records a dismissal too — inaction is a decision', () => {
    const filed = report(alice);
    actOnReport(staff, filed.id!, 'dismiss', '', db);
    expect(listAudit(staff, db)).toHaveLength(1);
  });

  /**
   * The trail must OUTLIVE what it describes. `target_id` is a plain column
   * with no foreign key precisely so that removing a map does not erase the
   * record of who removed it — which is exactly when the record matters.
   */
  it('survives the target being deleted', () => {
    const draft = createDraft('m_gone', 'Doomed', 'create');
    createMap(alice, draft, db);

    const filed = report(alice, { targetType: 'map', targetId: 'm_gone' });
    actOnReport(staff, filed.id!, 'remove', 'illegal', db);

    const audit = listAudit(staff, db);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.targetId).toBe('m_gone');
    expect(audit[0]!.action).toBe('remove');
  });

  it('survives the moderator account being deleted', () => {
    const filed = report(alice);
    actOnReport(staff, filed.id!, 'remove', '', db);

    db.prepare('DELETE FROM users WHERE id = ?').run('u_staff');

    const audit = listAudit({ userId: 'x', isStaff: true }, db);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.moderatorName).toBe('Removed account');
  });

  it('is invisible to everyone but staff', () => {
    const filed = report(alice);
    actOnReport(staff, filed.id!, 'dismiss', '', db);

    expect(listAudit(alice, db)).toEqual([]);
    expect(listAudit(anon, db)).toEqual([]);
  });

  it('is append-only — an action never rewrites an earlier one', () => {
    const first = report(alice, { targetId: 'n_a' });
    const second = report(alice, { targetId: 'n_b' });

    actOnReport(staff, first.id!, 'dismiss', 'one', db);
    actOnReport(staff, second.id!, 'remove', 'two', db);

    const audit = listAudit(staff, db);
    expect(audit).toHaveLength(2);
    expect(audit.map((a) => a.action).sort()).toEqual(['dismiss', 'remove']);
  });
});
