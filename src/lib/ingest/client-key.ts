import 'server-only';
import { getSession } from '@/lib/auth/session';
import { clientHash } from './budget';

/**
 * Who is asking, for rate-limiting purposes.
 *
 * A signed-in user is keyed by their id, so clearing cookies or switching
 * networks does not reset their allowance. A signed-out visitor is keyed by a
 * salted hash of their address and user agent — enough to make §12's "one free
 * run" mean something, and not enough to be a tracking record.
 *
 * `x-forwarded-for` is only trustworthy behind our own proxy. The leftmost
 * entry is taken because that is where the proxy puts the real client; the
 * value is hashed immediately either way, so a spoofed header buys an attacker
 * a different bucket, not an escape from being bucketed.
 */
export async function clientKeyFor(request: Request): Promise<string> {
  const session = await getSession();
  if (session) return clientHash(`user:${session.userId}`);

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || '0.0.0.0';
  return clientHash(ip, request.headers.get('user-agent') ?? '');
}
