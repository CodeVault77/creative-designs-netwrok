import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getPendingUserId,
  getSession,
  markSessionMfaSatisfied,
} from '@/lib/auth/session';
import { getUserById } from '@/lib/db/repo';
import { LIMITS, check, subjectFor } from '@/lib/auth/rate-limit';
import {
  beginEnrolment,
  challenge,
  confirmEnrolment,
  disable,
  regenerateRecoveryCodes,
  statusFor,
} from '@/lib/auth/mfa';
import { record } from '@/lib/enterprise/audit';

export const dynamic = 'force-dynamic';

/**
 * Two-factor authentication.
 *
 * ── One route, two audiences ────────────────────────────────────────────────
 *
 * `verify` is reachable by a PENDING session — someone whose password was
 * right and who has not yet produced a code. Everything else needs a complete
 * session. That split is the whole access-control story here, and putting it
 * in one file keeps it visible rather than spread across two routes where the
 * weaker one gets copied.
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('begin') }),
  z.object({ action: z.literal('confirm'), code: z.string().max(20) }),
  z.object({ action: z.literal('verify'), code: z.string().max(20) }),
  z.object({ action: z.literal('disable'), code: z.string().max(20) }),
  z.object({ action: z.literal('regenerate'), code: z.string().max(20) }),
]);

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  return NextResponse.json({ status: statusFor(session.userId) });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const input = parsed.data;

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || '0.0.0.0';

  // ---- the pending-session path ------------------------------------------

  if (input.action === 'verify') {
    const pendingId = await getPendingUserId();
    if (!pendingId) {
      return NextResponse.json({ error: 'Start again' }, { status: 401 });
    }

    /*
     * Rate limited hard, on the account.
     *
     * A six-digit code has a million values, and without a limit an attacker
     * holding a stolen password can simply try them. The limit is what makes
     * six digits enough — the code's entropy is not doing this on its own.
     */
    if (!check(LIMITS.signIn, subjectFor(`mfa:${pendingId}`)).ok) {
      return NextResponse.json(
        { error: 'Too many attempts. Wait a few minutes.' },
        {
          status: 429,
          headers: { 'Retry-After': String(LIMITS.signIn.windowSeconds) },
        },
      );
    }

    const result = challenge(pendingId, input.code);

    if (!result.ok) {
      record({
        action: 'auth.failed',
        actorId: pendingId,
        metadata: { stage: 'mfa' },
        clientIp: ip,
      });

      return NextResponse.json(
        { error: 'That code is not right' },
        { status: 401 },
      );
    }

    await markSessionMfaSatisfied();

    record({
      action: 'auth.signed_in',
      actorId: pendingId,
      metadata: { mfa: true, recovery: result.usedRecovery === true },
      clientIp: ip,
    });

    if (result.usedRecovery) {
      record({ action: 'mfa.recovery_used', actorId: pendingId, clientIp: ip });
    }

    return NextResponse.json({
      ok: true,
      usedRecovery: result.usedRecovery === true,
    });
  }

  // ---- everything else needs a complete session ---------------------------

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const user = getUserById(session.userId);

  switch (input.action) {
    case 'begin': {
      const result = beginEnrolment(session.userId, user?.email ?? session.handle);
      return result.ok
        ? NextResponse.json({ enrolment: result.enrolment })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }

    case 'confirm': {
      const result = confirmEnrolment(session.userId, input.code);

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      await markSessionMfaSatisfied();
      record({ action: 'mfa.enabled', actorId: session.userId, clientIp: ip });

      // The only time these exist in clear. The screen must say so.
      return NextResponse.json({ recoveryCodes: result.recoveryCodes });
    }

    case 'disable': {
      const result = disable(session.userId, input.code);

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      record({ action: 'mfa.disabled', actorId: session.userId, clientIp: ip });
      return NextResponse.json({ ok: true });
    }

    case 'regenerate': {
      const result = regenerateRecoveryCodes(session.userId, input.code);

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      record({
        action: 'mfa.recovery_regenerated',
        actorId: session.userId,
        clientIp: ip,
      });

      return NextResponse.json({ recoveryCodes: result.recoveryCodes });
    }
  }
}
