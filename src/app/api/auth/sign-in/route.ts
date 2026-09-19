import { NextResponse } from 'next/server';
import { signIn, signInSchema } from '@/lib/auth/accounts';
import { LIMITS, check, clear, subjectFor } from '@/lib/auth/rate-limit';
import { track } from '@/lib/analytics';
import { record } from '@/lib/enterprise/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = signInSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  /*
   * Limited on the ACCOUNT and on the CLIENT, and both must pass.
   *
   * Either alone has a hole. By account only, an attacker can lock a victim
   * out of their own login by failing it repeatedly; by client only, a botnet
   * spreads a credential-stuffing run thinly enough to never trip a limit.
   */
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || '0.0.0.0';

  const account = subjectFor(parsed.data.email);
  const client = subjectFor(ip);

  const tooMany =
    !check(LIMITS.signIn, account).ok || !check(LIMITS.signIn, client).ok;

  if (tooMany) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a few minutes and try again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(LIMITS.signIn.windowSeconds) },
      },
    );
  }

  const result = await signIn(parsed.data);
  if (!result.ok) {
    record({
      action: 'auth.failed',
      actorLabel: parsed.data.email,
      metadata: { stage: 'password' },
      clientIp: ip,
    });

    // 401 with the same generic message whether the email exists or not.
    return NextResponse.json(
      {
        error: result.error,
        field: result.field,
        /*
         * `useSso` tells the client to offer the provider button instead of
         * arguing with the password field. It is safe to return: it is a
         * property of the email DOMAIN, which is already discoverable from
         * the public /api/sso lookup the sign-in screen uses, and says
         * nothing about whether an account exists.
         */
        useSso: result.useSso === true,
        connectionId: result.connectionId,
      },
      { status: 401 },
    );
  }

  /*
   * A success wipes the account's attempts.
   *
   * Someone who mistyped their password four times and then got it right
   * should not be left one slip away from a five-minute lockout. The client
   * counter is deliberately NOT cleared: one success does not vouch for the
   * other nine attempts from that address.
   */
  clear(LIMITS.signIn, account);

  /*
   * A pending session is NOT a completed sign-in.
   *
   * `mfaRequired` means the password was right and the second factor has not
   * been produced yet. Recording `auth.signed_in` here would put a sign-in in
   * the audit log for somebody who may never finish one — and the MFA route
   * records it when they do.
   */
  if (result.mfaRequired) {
    return NextResponse.json({ mfaRequired: true });
  }

  track('account_signed_in', { method: 'email' });

  record({
    action: 'auth.signed_in',
    actorId: result.user!.id,
    actorLabel: parsed.data.email,
    metadata: { method: 'password' },
    clientIp: ip,
  });

  return NextResponse.json({
    id: result.user!.id,
    handle: result.user!.handle,
    displayName: result.user!.displayName,
  });
}
