import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db/client';
import { getUserById } from '@/lib/db/repo';
import { isProduction } from '@/lib/env';

/**
 * Real sessions, replacing the P2 stub.
 *
 * The shape is unchanged, which was the point of writing the stub with a real
 * shape: every call site from P2 through P5 still works untouched.
 *
 * ── Two decisions worth knowing ─────────────────────────────────────────────
 *
 * 1. **The token is stored hashed.** The cookie holds a random secret; the
 *    database holds its SHA-256. A leaked database dump is then not a set of
 *    working sessions — the same reasoning as passwords, for the same reason.
 *
 * 2. **Server-side sessions, not a JWT.** A JWT cannot be revoked before it
 *    expires, and "sign out everywhere" is a thing users need after losing a
 *    device. A row that can be deleted is worth the lookup.
 */

export interface Session {
  userId: string;
  handle: string;
  displayName: string;
  isStaff: boolean;
}

const COOKIE = 'cdn_session';
const TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString();

  getDb()
    .prepare(
      'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(hashToken(token), userId, expiresAt, new Date().toISOString());

  const store = await cookies();
  store.set(COOKIE, token, {
    // Unreadable from JavaScript, so an XSS bug cannot exfiltrate the session.
    httpOnly: true,
    // Only over HTTPS in production; http://localhost has no TLS.
    secure: isProduction,
    // `lax` lets the cookie ride a top-level navigation, which is what makes a
    // shared /n/<id> link open signed in. `strict` would break exactly the
    // flow §10 calls the product's main growth mechanism.
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_DAYS * 86_400,
  });

  return token;
}

interface SessionRow {
  user_id: string;
  expires_at: string;
  mfa_at: string | null;
}

function readRow(token: string): SessionRow | null {
  const row = getDb()
    .prepare('SELECT user_id, expires_at, mfa_at FROM sessions WHERE id = ?')
    .get(hashToken(token)) as SessionRow | undefined;

  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    // Clean up as we go rather than relying on a sweep that might not run.
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
    return null;
  }

  return row;
}

/**
 * The signed-in person, or null.
 *
 * ── A pending session is not a session ──────────────────────────────────────
 *
 * Once MFA is on, a correct password creates a row with `mfa_at` NULL. This
 * function returns null for it, so every guard, every route and every page in
 * the codebase treats a half-authenticated request as signed out — with no
 * edit to any of them.
 *
 * That is the whole reason the pending state lives in the sessions table
 * rather than in a second cookie or store: there is exactly one place that
 * decides who you are, and the second factor is enforced inside it. A separate
 * store would mean every existing caller had to remember to ask twice, and one
 * of them would not.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const row = readRow(token);
  if (!row) return null;

  // The second factor has not been satisfied. Only `getPendingSession` can
  // see this, and only the challenge screen calls that.
  if (row.mfa_at === null && mfaPending(row.user_id)) return null;

  const user = getUserById(row.user_id);
  if (!user) return null;

  return {
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
    isStaff: user.isStaff,
  };
}

/**
 * Whether this account has a confirmed second factor.
 *
 * Read directly rather than through `lib/auth/mfa.ts` to keep the import
 * one-way: mfa.ts is free to use sessions, and a cycle between the two would
 * be a module-load order problem in the most load-bearing file in the app.
 */
function mfaPending(userId: string): boolean {
  const row = getDb()
    .prepare('SELECT confirmed_at FROM user_mfa WHERE user_id = ?')
    .get(userId) as { confirmed_at: string | null } | undefined;

  return Boolean(row?.confirmed_at);
}

/**
 * The half-authenticated user, for the MFA challenge screen only.
 *
 * Returns the id and nothing else. The challenge needs to know WHO is being
 * challenged and has no business rendering anything about them — a screen that
 * greeted someone by name before the second factor would confirm the password
 * was right to whoever was holding the laptop.
 */
export async function getPendingUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const row = readRow(token);
  if (!row) return null;

  return row.mfa_at === null && mfaPending(row.user_id) ? row.user_id : null;
}

/** Record that the second factor was satisfied for the current session. */
export async function markSessionMfaSatisfied(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return;

  getDb()
    .prepare("UPDATE sessions SET mfa_at = datetime('now') WHERE id = ?")
    .run(hashToken(token));
}

/** Note which SSO connection minted this session, so revoking it revokes them. */
export async function tagSessionConnection(connectionId: string): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return;

  getDb()
    .prepare('UPDATE sessions SET sso_connection_id = ? WHERE id = ?')
    .run(connectionId, hashToken(token));
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;

  if (token) {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  }

  store.delete(COOKIE);
}

/** Sign out everywhere — after a password change or a lost device. */
export function destroyAllSessions(userId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function isSignedIn(): Promise<boolean> {
  return (await getSession()) !== null;
}

/** Removes expired rows. Called opportunistically on sign-in. */
export function pruneSessions(): void {
  getDb()
    .prepare('DELETE FROM sessions WHERE expires_at < ?')
    .run(new Date().toISOString());
}

export { COOKIE as SESSION_COOKIE };
