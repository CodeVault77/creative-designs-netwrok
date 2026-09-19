import 'server-only';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './policy';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * scrypt from `node:crypto` rather than bcrypt or argon2. Two reasons:
 *
 *   - it is in the standard library, so there is no native dependency to fail
 *     to build on a deploy target;
 *   - it is memory-hard, which is the property that matters — a GPU farm
 *     cannot brute-force it the way it can a fast hash.
 *
 * Never SHA-256. A fast hash is exactly wrong for passwords: speed is the
 * attacker's advantage, and the whole point is to be slow.
 */

/** OWASP's floor for scrypt. Raising it later is fine — see `needsRehash`. */
const N = 16_384;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Format: scrypt$N$salt$hash — self-describing so parameters can change. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(normalise(password), salt, KEY_LENGTH);
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[2]!, 'base64');
  const expected = Buffer.from(parts[3]!, 'base64');

  let actual: Buffer;
  try {
    actual = await scryptAsync(normalise(password), salt, expected.length);
  } catch {
    return false;
  }

  // Constant-time. A plain `===` leaks how many leading bytes matched through
  // timing, which is enough to recover a hash byte by byte.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** True when a stored hash used weaker parameters and should be upgraded. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N;
}

/**
 * Unicode-normalises so the same typed password verifies on every platform.
 *
 * An accented character can be one code point or two depending on the OS and
 * keyboard. Without NFKC, a password set on a Mac can fail to verify on
 * Windows, and the user is told their correct password is wrong.
 */
function normalise(password: string): string {
  return password.normalize('NFKC');
}

export interface PasswordProblem {
  message: string;
}

/**
 * Password rules.
 *
 * Length only. Composition rules ("one uppercase, one symbol") measurably push
 * people toward `Password1!` and into reuse; NIST dropped them years ago.
 * Length is the property that actually costs an attacker anything.
 */
export function checkPassword(password: string): PasswordProblem | null {
  const value = normalise(password);

  if (value.length < MIN_PASSWORD_LENGTH) {
    return {
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase works well.`,
    };
  }
  // Bounded because scrypt hashes the whole input, and an unbounded password
  // is an unbounded amount of work per sign-in attempt.
  if (value.length > MAX_PASSWORD_LENGTH) {
    return { message: `That is longer than ${MAX_PASSWORD_LENGTH} characters.` };
  }
  if (/^\s+$/.test(value)) {
    return { message: 'That is only whitespace.' };
  }
  return null;
}

export { N as SCRYPT_COST };
