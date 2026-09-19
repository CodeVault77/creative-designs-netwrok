import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { orgRoleOf, organizationsFor } from '@/lib/orgs/repo';
import {
  claimDomain,
  settingsFor,
  updateSettings,
  verifyDomain,
  DOMAIN_TXT_NAME,
} from '@/lib/enterprise/branding';

export const dynamic = 'force-dynamic';

/**
 * Organisation policy and white-label branding.
 *
 * The role is resolved from the caller's membership on every request rather
 * than trusted from the body — an org id in a payload says which org, never
 * what the sender may do in it.
 */

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    orgId: z.string().max(80),
    requireMfa: z.boolean().optional(),
    sessionHours: z.number().int().min(0).max(2160).optional(),
    brandName: z.string().max(60).optional(),
    brandLogoUrl: z.string().max(500).optional(),
    brandAccent: z.string().max(10).optional(),
    brandSupportEmail: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal('claim_domain'),
    orgId: z.string().max(80),
    domain: z.string().max(253),
  }),
  z.object({ action: z.literal('verify_domain'), orgId: z.string().max(80) }),
]);

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const orgId = new URL(request.url).searchParams.get('org');
  const mine = organizationsFor(ctx);

  if (!orgId) {
    return NextResponse.json({ organizations: mine, settings: null });
  }

  const role = orgRoleOf(ctx, orgId);

  if (!role && !session.isStaff) {
    // Not a member: the same 404 the rest of the app gives, so an org id
    // cannot be probed for existence.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    organizations: mine,
    settings: settingsFor(orgId),
    role,
    // The exact record to publish, shown rather than described — a hostname
    // somebody retypes is a hostname somebody mistypes.
    txtRecordName: DOMAIN_TXT_NAME,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

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
  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const role = orgRoleOf(ctx, input.orgId);

  switch (input.action) {
    case 'update': {
      const result = updateSettings(ctx, input.orgId, role, input);
      return result.ok
        ? NextResponse.json({ settings: result.settings })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }

    case 'claim_domain': {
      const result = claimDomain(ctx, input.orgId, role, input.domain);
      return result.ok
        ? NextResponse.json({
            token: result.token,
            settings: settingsFor(input.orgId),
          })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }

    case 'verify_domain': {
      const result = await verifyDomain(ctx, input.orgId, role);
      return result.ok
        ? NextResponse.json({ settings: settingsFor(input.orgId) })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }
  }
}
