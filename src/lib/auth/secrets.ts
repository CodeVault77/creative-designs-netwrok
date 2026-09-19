import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { isProduction, serverEnv } from '@/lib/env';

/**
 * Encrypting the secrets that have to be read back.
 *
 * ── Hashing versus encrypting, and when each is right ───────────────────────
 *
 * Almost everything secret in this codebase is HASHED — passwords, session
 * tokens, API keys, webhook recovery codes — because verifying them only ever
 * requires a comparison, and a hash cannot be reversed by whoever steals the
 * database.
 *
 * Two things in Phase 8 cannot work that way:
 *
 *   a TOTP secret     computing the expected six digits needs the original
 *                     bytes, every time somebody signs in;
 *   an SSO client     it is sent to the identity provider on every token
 *   secret            exchange, so we must be able to produce it.
 *
 * Both must therefore be reversible, which makes the question not "hash or
 * encrypt" but "where does the key live". It lives in the environment, outside
 * the database — so a stolen dump yields ciphertext and nothing else. That is
 * the entire security property, and it is why `secretsKey` refuses to start in
 * production without a real key rather than falling back to a constant that
 * would be identical on every deployment of this code in the world.
 *
 * ── AES-256-GCM, not CBC ────────────────────────────────────────────────────
 *
 * GCM authenticates as well as encrypts. Without that, an attacker with write
 * access to the database can flip bits in a ciphertext and the application
 * decrypts the result without complaint — which for a TOTP secret means
 * silently changing what code is accepted. The auth tag makes tampering a
 * decryption failure instead.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * A development key, derived from a fixed string.
 *
 * Deterministic on purpose: a random per-process key would make every restart
 * invalidate everyone's enrolment locally, which is a miserable way to work on
 * this. It is refused in production by `secretsKey`.
 */
const DEV_KEY = createHash('sha256')
  .update('cdn-local-development-secrets-key')
  .digest();

export class MissingSecretsKey extends Error {
  constructor() {
    super(
      'MFA_ENCRYPTION_KEY is not set. Generate one with: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    this.name = 'MissingSecretsKey';
  }
}

let cached: Buffer | null = null;

/**
 * The 32-byte key.
 *
 * Throws in production when unset. That is deliberate and is the whole point:
 * an environment that quietly encrypted every second factor with a key baked
 * into the source would look encrypted and protect nobody, and nobody would
 * find out until a breach.
 */
export function secretsKey(): Buffer {
  if (cached) return cached;

  const configured = serverEnv.MFA_ENCRYPTION_KEY;

  if (!configured) {
    if (isProduction) throw new MissingSecretsKey();
    cached = DEV_KEY;
    return cached;
  }

  /*
   * Accepts base64 or hex, and hashes anything else to 32 bytes.
   *
   * The hash branch is not laziness: people paste passphrases into
   * environment variables, and a passphrase that produced a length error
   * would be "fixed" by padding it with spaces. Deriving a key from whatever
   * was given is safer than a workaround someone invents under pressure.
   */
  const raw = Buffer.from(configured, 'base64');
  cached =
    raw.length === 32 ? raw : createHash('sha256').update(configured).digest();

  return cached;
}

/** Only for tests, which need a fresh key per case. */
export function resetSecretsKey(): void {
  cached = null;
}

/**
 * Encrypt a secret for storage.
 *
 * The stored form is `iv.tag.ciphertext`, base64url, in one column. Keeping
 * the parts together means a row can never be half-migrated or reassembled
 * from mismatched columns.
 */
export function seal(plaintext: string, key: Buffer = secretsKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export class TamperedSecret extends Error {
  constructor() {
    super('A stored secret failed authentication and was not decrypted');
    this.name = 'TamperedSecret';
  }
}

/**
 * Decrypt a stored secret.
 *
 * Throws rather than returning null on failure. A caller that got null would
 * be tempted to treat it as "no secret configured" and carry on — which for a
 * tampered TOTP secret means letting somebody past the second factor. There is
 * no safe way to continue, so there is no return value that permits it.
 */
export function open(sealed: string, key: Buffer = secretsKey()): string {
  const parts = sealed.split('.');
  if (parts.length !== 3) throw new TamperedSecret();

  const [ivPart, tagPart, dataPart] = parts as [string, string, string];

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const data = Buffer.from(dataPart, 'base64url');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new TamperedSecret();
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    // GCM's own integrity check failed: the ciphertext, the tag or the key is
    // wrong. Which one is not something the caller can act on differently.
    throw new TamperedSecret();
  }
}

/** Whether a real key is configured. Shown on the readiness screen. */
export function secretsConfigured(): boolean {
  return Boolean(serverEnv.MFA_ENCRYPTION_KEY);
}
