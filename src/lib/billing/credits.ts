import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';

/**
 * AI credits.
 *
 * ── The ledger is append-only ───────────────────────────────────────────────
 *
 * A balance is the SUM of the rows. There is no balance column, and adding one
 * would be the mistake this design exists to avoid: a stored total and a list
 * of transactions eventually disagree, and when they do nothing can say which
 * is right. Summing is slower and always correct, and at these volumes the
 * difference is unmeasurable. If it ever becomes measurable the fix is a
 * periodic snapshot ROW, not a mutable column.
 *
 * ── Credits are integers ────────────────────────────────────────────────────
 *
 * One credit is a hundredth of a cent of model spend, so a typical call costs
 * tens of credits and nothing ever needs a fraction. A ledger that can hold a
 * fraction can hold one that no arithmetic produced, and reconciling that is
 * worse than the rounding it was meant to avoid.
 */

/** Credits per US cent. A call costing $0.003 spends 30 credits. */
export const CREDITS_PER_CENT = 100;

/** Convert a model cost in dollars into whole credits, rounding UP. */
export function creditsForUsd(usd: number): number {
  /*
   * Rounded up, deliberately.
   *
   * Rounding down means a very cheap call costs nothing, and an agent making
   * thousands of them pays nothing at all. The house rounds toward the house
   * on the smallest unit; the alternative is a free tier with a loophole.
   */
  return Math.max(1, Math.ceil(usd * 100 * CREDITS_PER_CENT));
}

export type LedgerKind = 'grant' | 'spend' | 'purchase' | 'refund' | 'expiry';

export interface LedgerEntry {
  id: string;
  amount: number;
  kind: LedgerKind;
  reference: string;
  note: string;
  createdAt: string;
}

/** The current balance: the sum of every row. */
export function balanceOf(userId: string, db: Database = getDb()): number {
  return (
    (
      db
        .prepare(
          'SELECT COALESCE(SUM(amount), 0) AS total FROM credit_ledger WHERE user_id = ?',
        )
        .get(userId) as { total: number }
    ).total ?? 0
  );
}

export interface PostResult {
  ok: boolean;
  /** False when an identical entry already existed. Not an error. */
  posted: boolean;
  balance: number;
}

/**
 * Add an entry.
 *
 * ── Idempotent by (user, kind, reference) ───────────────────────────────────
 *
 * A retried Stripe webhook, a re-run period grant, a replayed job — all of them
 * try to post the same entry twice, and all of them would otherwise double a
 * balance. The unique index makes the second attempt a no-op rather than a
 * second effect, and `posted: false` tells the caller which happened.
 *
 * An entry with an EMPTY reference is not deduplicated: per-call spends are
 * genuinely distinct events and forcing a synthetic key on them would be
 * ceremony.
 */
export function post(
  userId: string,
  entry: {
    amount: number;
    kind: LedgerKind;
    reference?: string;
    note?: string;
  },
  db: Database = getDb(),
): PostResult {
  const reference = entry.reference ?? '';

  try {
    db.prepare(
      `INSERT INTO credit_ledger (id, user_id, amount, kind, reference, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      `cl_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      userId,
      Math.round(entry.amount),
      entry.kind,
      reference,
      (entry.note ?? '').slice(0, 200),
    );

    return { ok: true, posted: true, balance: balanceOf(userId, db) };
  } catch (cause) {
    // The unique index fired: this exact entry is already there.
    if (String(cause).includes('UNIQUE')) {
      return { ok: true, posted: false, balance: balanceOf(userId, db) };
    }
    throw cause;
  }
}

/**
 * Spend credits, refusing if the balance would go negative.
 *
 * The check and the insert are in one transaction. Two concurrent calls both
 * passing a prior balance check is exactly how an account goes negative, and
 * SQLite's write lock is what makes the pair atomic.
 */
export function spend(
  userId: string,
  credits: number,
  reference: string,
  note = '',
  db: Database = getDb(),
): { ok: boolean; balance: number; error?: string } {
  const amount = Math.max(0, Math.round(credits));
  if (amount === 0) return { ok: true, balance: balanceOf(userId, db) };

  return db.transaction(() => {
    const balance = balanceOf(userId, db);

    if (balance < amount) {
      return {
        ok: false,
        balance,
        error: 'You have run out of AI credits for this month.',
      };
    }

    post(userId, { amount: -amount, kind: 'spend', reference, note }, db);

    return { ok: true, balance: balance - amount };
  })();
}

/**
 * Grant a billing period's credits.
 *
 * The reference is the period start, so running this twice for the same period
 * — a retried webhook, a cron that fired twice — grants once. That property is
 * the reason the reference is not simply a timestamp of when it ran.
 */
export function grantPeriod(
  userId: string,
  periodStart: string,
  credits: number,
  db: Database = getDb(),
): PostResult {
  return post(
    userId,
    {
      amount: credits,
      kind: 'grant',
      reference: `period:${periodStart}`,
      note: 'Monthly credits',
    },
    db,
  );
}

export function history(
  userId: string,
  limit = 100,
  db: Database = getDb(),
): LedgerEntry[] {
  const rows = db
    .prepare(
      `SELECT id, amount, kind, reference, note, created_at
         FROM credit_ledger WHERE user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, limit) as {
    id: string;
    amount: number;
    kind: string;
    reference: string;
    note: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    kind: row.kind as LedgerKind,
    reference: row.reference,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export interface Usage {
  balance: number;
  grantedThisPeriod: number;
  spentThisPeriod: number;
}

/** What someone has been given and used this calendar month. */
export function usageThisMonth(userId: string, db: Database = getDb()): Usage {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS granted,
         COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS spent
       FROM credit_ledger
      WHERE user_id = ? AND created_at >= datetime('now', 'start of month')`,
    )
    .get(userId) as { granted: number; spent: number };

  return {
    balance: balanceOf(userId, db),
    grantedThisPeriod: row.granted,
    spentThisPeriod: row.spent,
  };
}
