import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createUser,
  emailTaken,
  getUserForSignIn,
  handleTaken,
  type UserRow,
} from '@/lib/db/repo';
import { checkPassword, hashPassword, verifyPassword } from './password';
import { createSession, markSessionMfaSatisfied, pruneSessions } from './session';
import { isEnforced } from './mfa';
import { isSsoOnlyHash, ssoRequiredFor } from '@/lib/enterprise/sso';

/**
 * Sign-up and sign-in.
 *
 * Kept out of the route handlers so both the API and any future server action
 * share one implementation — two code paths to authentication is two places to
 * get it wrong.
 */

export const signUpSchema = z.object({
  email: z
    .string()
    .trim()
    .email('That does not look like an email address')
    .max(320),
  password: z.string().min(1, 'Choose a password').max(200),
  displayName: z.string().trim().min(1, 'What should we call you?').max(60),
});

export const signInSchema = z.object({
  email: z.string().trim().max(320),
  password: z.string().max(200),
});

export interface AuthResult {
  ok: boolean;
  user?: UserRow;
  error?: string;
  field?: 'email' | 'password' | 'displayName';
  /**
   * The password was right and a second factor is now required.
   *
   * `ok` is true because authentication SUCCEEDED as far as it went — the
   * session exists and is pending. Reporting it as a failure would make every
   * caller treat a correct password as a wrong one.
   */
  mfaRequired?: boolean;
  /** This account signs in through an identity provider, not a password. */
  useSso?: boolean;
  connectionId?: string;
}

export async function signUp(
  input: z.infer<typeof signUpSchema>,
): Promise<AuthResult> {
  const passwordProblem = checkPassword(input.password);
  if (passwordProblem) {
    return { ok: false, error: passwordProblem.message, field: 'password' };
  }

  if (emailTaken(input.email)) {
    // Sign-UP tells you the email is taken; sign-IN never does. The trade is
    // deliberate: without it people cannot tell a typo from a forgotten
    // account, and the same fact is discoverable from any password-reset flow
    // anyway. Sign-in stays generic because that is where credential stuffing
    // happens.
    return {
      ok: false,
      error: 'There is already an account with that email. Sign in instead?',
      field: 'email',
    };
  }

  const user = createUser({
    id: randomUUID(),
    email: input.email,
    passwordHash: await hashPassword(input.password),
    handle: uniqueHandle(input.displayName),
    displayName: input.displayName,
  });

  await createSession(user.id);
  return { ok: true, user };
}

export async function signIn(
  input: z.infer<typeof signInSchema>,
): Promise<AuthResult> {
  const record = getUserForSignIn(input.email);

  /*
   * The same generic message and the same amount of work either way.
   *
   * Returning early for an unknown email would make sign-in measurably faster
   * for addresses that do not exist, turning the form into an account
   * enumerator. So a missing user still costs one hash verification.
   */
  const GENERIC = 'That email and password do not match.';

  if (!record) {
    await verifyPassword(input.password, DUMMY_HASH);
    return { ok: false, error: GENERIC, field: 'password' };
  }

  /*
   * An SSO-provisioned account has no password at all.
   *
   * Its stored hash is a sentinel that no password can produce, so the
   * verification below would fail anyway — but failing with the generic
   * message would leave someone typing their company password into a form
   * that can never accept it. Refused explicitly, with the same message, and
   * the caller is told to send them to their provider.
   */
  if (isSsoOnlyHash(record.passwordHash)) {
    return { ok: false, error: GENERIC, field: 'password', useSso: true };
  }

  const valid = await verifyPassword(input.password, record.passwordHash);
  if (!valid) {
    return { ok: false, error: GENERIC, field: 'password' };
  }

  /*
   * Enforced SSO is checked AFTER the password verifies, not before.
   *
   * Checking first would let anyone discover which domains are federated by
   * watching how fast the form answers — and the answer would come back
   * without proving anything about who was asking.
   */
  const federated = ssoRequiredFor(record.id, record.email);
  if (federated) {
    return {
      ok: false,
      error: `Your organisation requires signing in with ${federated.name}.`,
      field: 'email',
      useSso: true,
      connectionId: federated.id,
    };
  }

  pruneSessions();

  const { passwordHash: _hash, ...user } = record;

  /*
   * MFA splits sign-in in two.
   *
   * The password half is done, and a session is created — but marked as NOT
   * having satisfied the second factor. `getSession` refuses to return it
   * until `mfa_at` is set, so a pending session can reach the challenge screen
   * and nothing else. The alternative, holding the half-authenticated state
   * somewhere else, means a second store to secure and to expire.
   */
  await createSession(record.id);

  if (isEnforced(record.id)) {
    return { ok: true, user, mfaRequired: true };
  }

  await markSessionMfaSatisfied();

  return { ok: true, user };
}

/**
 * A real scrypt hash of a value nobody knows, used to burn the same time on a
 * missing account as on a wrong password. Generated once at module load.
 */
const DUMMY_HASH =
  'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'ZGVsaWJlcmF0ZWx5LWludmFsaWQtaGFzaC1mb3ItdGltaW5nLWVxdWFsaXNhdGlvbi1vbmx5';

/**
 * A URL-safe handle derived from the display name.
 *
 * Collides often on common names, so a short random suffix is appended rather
 * than counting upward — counting leaks how many people share a name, and
 * probing `/u/john-2` tells you `john` exists.
 */
export function uniqueHandle(displayName: string): string {
  const base =
    displayName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'member';

  if (!handleTaken(base)) return base;

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${base}-${randomSuffix()}`;
    if (!handleTaken(candidate)) return candidate;
  }

  return `${base}-${randomUUID().slice(0, 8)}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}
