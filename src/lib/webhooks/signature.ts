import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Outbound webhook signatures.
 *
 * ── The same scheme we ask Stripe to prove to us ────────────────────────────
 *
 * `lib/billing/stripe.ts` verifies Stripe's signature: HMAC-SHA256 over
 * `timestamp.payload`, compared in constant time, with an age limit. This
 * produces signatures in exactly that shape.
 *
 * Copying a scheme we already implement is worth more than inventing a better
 * one. A third party integrating with us has almost certainly integrated with
 * Stripe, so their verification code, their mental model and their tooling all
 * transfer — and the scheme is unremarkable enough that a correct
 * implementation exists in every language.
 *
 * ── Why the timestamp is inside the signed string ───────────────────────────
 *
 * Signing the payload alone produces a signature that stays valid forever, so
 * anyone who captures one delivery can replay it at any time and the receiver
 * cannot tell. Binding the time into the MAC means a replay must either be
 * fresh or carry a timestamp that no longer verifies.
 *
 * This file has no Node-server-only imports beyond `crypto` on purpose: it is
 * the reference implementation shipped in the SDK, and a receiver must be able
 * to run the verifier we publish.
 */

/** Header carrying `t=<unix seconds>,v1=<hex hmac>`. */
export const SIGNATURE_HEADER = 'x-cdn-signature';

/** How old a signed request may be. Five minutes, as Stripe uses. */
export const MAX_AGE_SECONDS = 300;

export function sign(
  payload: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest('hex');

  return `t=${timestampSeconds},v1=${mac}`;
}

export type VerifyFailure = 'malformed' | 'stale' | 'mismatch';

export interface VerifyResult {
  ok: boolean;
  failure?: VerifyFailure;
}

/**
 * Verify a signature header against a raw body.
 *
 * The RAW body, byte for byte — not a re-serialised object. `JSON.stringify`
 * of a parsed body reorders nothing in practice but changes whitespace, and a
 * MAC over different bytes is a different MAC. Every receiver that has ever
 * had a mysterious signature mismatch has had this bug.
 */
export function verify(
  payload: string,
  header: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const parts = new Map<string, string>();

  for (const piece of header.split(',')) {
    const index = piece.indexOf('=');
    if (index > 0) {
      parts.set(piece.slice(0, index).trim(), piece.slice(index + 1).trim());
    }
  }

  const timestamp = Number(parts.get('t'));
  const presented = parts.get('v1');

  if (!Number.isFinite(timestamp) || !presented) {
    return { ok: false, failure: 'malformed' };
  }

  /*
   * Age is checked on the ABSOLUTE difference.
   *
   * A signature timestamped in the future is as suspect as one from last week
   * — and clock skew between two servers goes both ways, so a one-sided check
   * rejects honest traffic from a receiver whose clock runs slow while
   * accepting a forged future timestamp indefinitely.
   */
  if (Math.abs(nowSeconds - timestamp) > MAX_AGE_SECONDS) {
    return { ok: false, failure: 'stale' };
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');

  // Length is compared first: timingSafeEqual throws on a mismatch, and a
  // thrown exception is both a timing signal and a 500 instead of a refusal.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, failure: 'mismatch' };
  }

  return { ok: true };
}
