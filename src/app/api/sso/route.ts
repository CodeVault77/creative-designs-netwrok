import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { orgRoleOf } from '@/lib/orgs/repo';
import {
  connectionForEmail,
  connectionsFor,
  createConnection,
  deleteConnection,
  identitiesFor,
  updateConnection,
} from '@/lib/enterprise/sso';
import { redirectUri, startUrl } from '@/lib/enterprise/urls';

export const dynamic = 'force-dynamic';

/**
 * Managing SSO connections, and discovering which one an address uses.
 *
 * ── The discovery half is deliberately public ───────────────────────────────
 *
 * The sign-in screen asks "is this address federated" before anyone has
 * authenticated, because that determines whether to show a password field or
 * a button. It answers a property of the DOMAIN, never of the person — so it
 * cannot be used to find out whether an account exists, which is the thing
 * sign-in works hard not to leak.
 */

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    orgId: z.string().max(80),
    name: z.string().min(1).max(80),
    issuer: z.string().url().max(300),
    clientId: z.string().min(1).max(200),
    clientSecret: z.string().min(1).max(500),
    emailDomain: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal('update'),
    connectionId: z.string().max(80),
    enforced: z.boolean().optional(),
    active: z.boolean().optional(),
    emailDomain: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal('delete'), connectionId: z.string().max(80) }),
]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const email = params.get('email');

  // Public: which provider, if any, this domain uses.
  if (email) {
    const connection = connectionForEmail(email);

    return NextResponse.json({
      sso: connection
        ? {
            id: connection.id,
            name: connection.name,
            enforced: connection.enforced,
            startUrl: startUrl(connection.id),
          }
        : null,
    });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const orgId = params.get('org');

  return NextResponse.json({
    connections: orgId ? connectionsFor(ctx, orgId, orgRoleOf(ctx, orgId)) : [],
    // Which providers this person's own account is linked to, for their
    // security screen.
    identities: identitiesFor(session.userId),
    redirectUri: redirectUri(),
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

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const input = parsed.data;

  if (input.action === 'create') {
    const result = await createConnection(ctx, orgRoleOf(ctx, input.orgId), input);

    return result.ok
      ? NextResponse.json({ connection: result.connection })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  /*
   * The org is resolved from the CONNECTION, not from the request.
   *
   * Taking an org id from the caller and checking their role in it would let
   * anyone pass an org they administer alongside a connection belonging to
   * somebody else's — and the role check would pass.
   */
  const { getConnection } = await import('@/lib/enterprise/sso');
  const connection = getConnection(input.connectionId);

  if (!connection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const orgRole = orgRoleOf(ctx, connection.orgId);

  const result =
    input.action === 'delete'
      ? deleteConnection(ctx, orgRole, input.connectionId)
      : updateConnection(ctx, orgRole, input.connectionId, input);

  return result.ok
    ? NextResponse.json({
        connections: connectionsFor(ctx, connection.orgId, orgRole),
      })
    : NextResponse.json({ error: result.error }, { status: 400 });
}
