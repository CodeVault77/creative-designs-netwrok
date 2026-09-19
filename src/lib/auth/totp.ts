import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP — RFC 6238, on top of HOTP — RFC 4226.
 *
 * ── Why this is written out rather than installed ───────────────────────────
 *
 * The algorithm is about forty lines: an HMAC, a documented truncation, and a
 * counter derived from the clock. Every authenticator app in existence
 * implements the same thing, and there is nothing to invent. A dependency here
 * would add a supply chain to the most security-sensitive path in the product
 * in exchange for forty lines, and it is a path where a compromised package
 * could silently accept any code.
 *
 * It is also written where its two subtleties can be argued in place: the
 * verification window, and replay.
 *
 * ── Base32, because that is what QR codes carry ─────────────────────────────
 *
 * The `otpauth://` URI scheme every authenticator reads takes the shared
 * secret base32-encoded, unpadded. This file therefore does its own base32 —
 * Node has base64 and hex and not this.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The step, in seconds. Thirty is the universal default; apps assume it. */
export const STEP_SECONDS = 30;

/** Digits in a code. Six, for the same reason. */
export const DIGITS = 6;

/**
 * How many steps either side of now are accepted.
 *
 * One, which means a code is valid for ninety seconds in total. This is the
 * one number in the file with a real trade-off:
 *
 *   0  is correct in theory and unusable in practice. A phone's clock drifts,
 *      and a person who starts typing at second 29 fails through no fault of
 *      their own — then blames the product and turns MFA off.
 *
 *   1  tolerates a little drift and the time it takes to type six digits.
 *
 *   2+ is where the window starts being long enough for a shoulder-surfed or
 *      phished code to be worth relaying, which is the attack MFA is for.
 *
 * The replay guard below is what makes even this window safe: a code accepted
 * once cannot be accepted again.
 */
export const WINDOW_STEPS = 1;

export function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  // The remaining bits are left-aligned into a final character. Padding is
  // omitted: the otpauth URI scheme expects unpadded base32.
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];

  return output;
}

export function decodeBase32(input: string): Buffer {
  // Case-insensitive, and padding and spaces are ignored — people retype
  // these by hand from a screen, and rejecting a stray space helps nobody.
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * A fresh shared secret.
 *
 * 20 bytes — 160 bits — which is what RFC 4226 specifies for HMAC-SHA1 and
 * what every authenticator expects. Longer is not stronger here: the code is
 * six digits either way, and some apps refuse a secret they consider odd.
 */
export function generateSecret(): string {
  return encodeBase32(randomBytes(20));
}

/** The counter for a moment in time. */
export function stepFor(atMillis: number = Date.now()): number {
  return Math.floor(atMillis / 1000 / STEP_SECONDS);
}

/**
 * The HOTP code for one counter value.
 *
 * SHA-1 is correct here and is not a weakness. RFC 4226 specifies it,
 * authenticator apps implement it, and the property this needs from the hash
 * is not collision resistance — it is that HMAC-SHA1 remains a secure MAC,
 * which it is. Using SHA-256 would produce codes no authenticator generates.
 */
export function codeFor(secret: string, step: number): string {
  const key = decodeBase32(secret);

  // The counter is a big-endian 64-bit integer. Written as two 32-bit halves
  // because a JS number cannot hold the top half exactly at large values —
  // not a concern for a step counter, but the shift is what the RFC says.
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);

  const digest = createHmac('sha1', key).update(counter).digest();

  /*
   * Dynamic truncation, exactly as RFC 4226 §5.3 defines it. The low nibble
   * of the last byte picks where to read four bytes from, and the top bit is
   * masked off so the result is always a positive 31-bit integer.
   */
  const offset = digest[digest.length - 1]! & 0x0f;

  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export interface VerifyResult {
  ok: boolean;
  /**
   * The step the code belonged to, when it verified.
   *
   * Returned so the caller can STORE it and refuse anything at or below it
   * next time. Without that, a code observed on the wire stays usable for the
   * rest of its window — and a ninety-second window is plenty for a phishing
   * proxy to relay one.
   */
  step?: number;
}

/**
 * Check a code against a secret.
 *
 * `lastStep` is the highest step already accepted for this user. Pass it, and
 * pass the returned step back into storage on success — the two halves are
 * what make replay impossible, and either alone does nothing.
 */
export function verify(
  secret: string,
  code: string,
  options: { atMillis?: number; lastStep?: number | null } = {},
): VerifyResult {
  const cleaned = code.replace(/\D/g, '');
  if (cleaned.length !== DIGITS) return { ok: false };

  const current = stepFor(options.atMillis ?? Date.now());

  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
    const step = current + offset;

    // Already used, or older than one that was. Refused before the comparison
    // so a replayed code cannot even be timed.
    if (options.lastStep != null && step <= options.lastStep) continue;

    const expected = codeFor(secret, step);

    /*
     * Constant-time, even though a six-digit code has only a million values
     * and is rate-limited anyway. The cost is nothing and the habit is what
     * matters: the next person to copy this comparison may be comparing
     * something where the timing does leak.
     */
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(cleaned, 'utf8');

    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true, step };
  }

  return { ok: false };
}

/**
 * The `otpauth://` URI an authenticator app reads from a QR code.
 *
 * The label is `issuer:account` and the issuer is ALSO a parameter. That
 * duplication is not a mistake — it is what the de-facto spec requires, and
 * apps disagree about which one they read.
 */
export function provisioningUri(options: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${options.issuer}:${options.account}`);

  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}
