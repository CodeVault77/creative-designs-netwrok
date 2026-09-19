import 'server-only';
import { createHash } from 'node:crypto';

/**
 * Visitor identity for interest dedupe.
 *
 * The problem: a signed-out visitor must be counted once per node, and we
 * have no account to key on. The lazy answer is to store the IP address.
 *
 * That answer is wrong here. ADR-0006 commits us to a strong privacy
 * position, and an IP log is personal data with retention obligations,
 * collected for the sole purpose of counting a button press. So:
 *
 *   - the IP and user-agent are hashed with a per-deployment salt and never
 *     stored raw;
 *   - the hash is truncated, which makes collisions possible and reversal
 *     impractical — undercounting slightly is a much better failure than
 *     holding a de-anonymisable identifier;
 *   - the salt rotates per deployment, so the hash is not stable across
 *     releases and cannot be used to follow anyone over time.
 *
 * The cost is that the count is approximate. For a build-order signal, an
 * approximate count is entirely sufficient.
 */

/**
 * Per-process salt. Rotating on restart is deliberate: it bounds how long a
 * hash can be correlated, at the price of a small amount of double-counting
 * after a deploy.
 */
const SALT =
  process.env.INTEREST_SALT ??
  createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 32);

export function visitorHashFrom(headers: Headers): string {
  // x-forwarded-for is the first entry when behind a proxy; the rest are
  // proxy hops and must not be trusted.
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || headers.get('x-real-ip') || 'unknown';
  const agent = headers.get('user-agent') ?? 'unknown';

  return (
    createHash('sha256')
      .update(`${SALT}:${ip}:${agent}`)
      .digest('hex')
      // Truncated on purpose — see the note above.
      .slice(0, 16)
  );
}
