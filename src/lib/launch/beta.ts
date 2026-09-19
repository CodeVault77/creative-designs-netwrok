import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { serverEnv } from '@/lib/env';

/**
 * The closed beta gate (§20 P14: "Closed beta 20–50 users").
 *
 * The cap is ENFORCED, not intended. "We'll keep an eye on the numbers" is how
 * a closed beta becomes an open one on a Tuesday afternoon, and the whole point
 * of a closed beta is that the number of people who can hit a bug is bounded
 * while the bugs are still being found.
 *
 * Off by default. Local development and CI must not need an invite code, and a
 * gate that has to be disabled to work on the product is a gate people disable
 * permanently.
 */

export const BETA_CAP = 50;

export function betaEnabled(): boolean {
  return serverEnv.BETA_MODE === 'closed';
}

export interface BetaStatus {
  enabled: boolean;
  cap: number;
  used: number;
  remaining: number;
  /** Unredeemed codes still outstanding. */
  available: number;
}

export function betaStatus(db: Database = getDb()): BetaStatus {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN used_by IS NOT NULL THEN 1 ELSE 0 END) AS used
         FROM beta_invites`,
    )
    .get() as { total: number; used: number | null };

  const used = row.used ?? 0;

  return {
    enabled: betaEnabled(),
    cap: BETA_CAP,
    used,
    remaining: Math.max(0, BETA_CAP - used),
    available: row.total - used,
  };
}

/**
 * Mint codes.
 *
 * Refuses to mint past the cap. Generating a hundred codes "just in case" and
 * relying on nobody sending them is the same failure as having no cap.
 */
export function mintCodes(
  ctx: AuthContext,
  count: number,
  note = '',
  db: Database = getDb(),
): string[] {
  if (!ctx.isStaff) return [];

  const status = betaStatus(db);
  const room = Math.max(0, status.cap - status.used - status.available);
  const minting = Math.min(Math.max(0, count), room);

  const codes: string[] = [];
  const insert = db.prepare('INSERT INTO beta_invites (code, note) VALUES (?, ?)');

  db.transaction(() => {
    for (let i = 0; i < minting; i++) {
      // Readable enough to be typed off a screen, random enough not to be
      // guessed. Ambiguous characters left out on purpose.
      const code = `CDN-${randomBytes(4)
        .toString('hex')
        .toUpperCase()
        .replace(/[O0I1]/g, 'X')}`;
      insert.run(code, note.slice(0, 200));
      codes.push(code);
    }
  })();

  return codes;
}

export interface RedeemResult {
  ok: boolean;
  error?: string;
}

/**
 * Redeem a code as part of sign-up.
 *
 * Called INSIDE the sign-up transaction by the caller, so a code cannot be
 * consumed by an account that then fails to be created — which would burn a
 * seat on nobody.
 */
export function redeemCode(
  code: string,
  userId: string,
  db: Database = getDb(),
): RedeemResult {
  if (!betaEnabled()) return { ok: true };

  const normalised = code.trim().toUpperCase();
  if (!normalised)
    return { ok: false, error: 'An invite code is required during the beta' };

  const row = db
    .prepare('SELECT code, used_by FROM beta_invites WHERE code = ?')
    .get(normalised) as { code: string; used_by: string | null } | undefined;

  // The same message for "no such code" and "already used", so the endpoint is
  // not an oracle for which codes exist.
  if (!row || row.used_by) {
    return { ok: false, error: 'That invite code is not valid' };
  }

  const status = betaStatus(db);
  if (status.used >= status.cap) {
    return { ok: false, error: 'The beta is full for now. We will be in touch.' };
  }

  /**
   * Conditional UPDATE, not check-then-write.
   *
   * Two people redeeming the same code at the same moment both pass a prior
   * SELECT; only one can win a `WHERE used_by IS NULL`.
   */
  const result = db
    .prepare(
      `UPDATE beta_invites SET used_by = ?, used_at = datetime('now')
        WHERE code = ? AND used_by IS NULL`,
    )
    .run(userId, normalised);

  if (result.changes === 0) {
    return { ok: false, error: 'That invite code is not valid' };
  }

  return { ok: true };
}

export interface BetaCode {
  code: string;
  note: string;
  used: boolean;
  usedAt: string | null;
  createdAt: string;
}

export function listCodes(ctx: AuthContext, db: Database = getDb()): BetaCode[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare('SELECT * FROM beta_invites ORDER BY created_at DESC LIMIT 200')
    .all() as {
    code: string;
    note: string;
    used_by: string | null;
    used_at: string | null;
    created_at: string;
  }[];

  return rows.map((row) => ({
    code: row.code,
    note: row.note,
    used: row.used_by !== null,
    usedAt: row.used_at,
    createdAt: row.created_at,
  }));
}
