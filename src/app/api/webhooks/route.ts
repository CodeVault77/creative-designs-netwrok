import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  createEndpoint,
  deleteEndpoint,
  listEndpoints,
  reactivate,
} from '@/lib/webhooks/endpoints';
import { deliveriesFor } from '@/lib/webhooks/delivery';

// Loading this registers the fan-out and delivery handlers and binds the
// event subscriptions. Without it a delivery job would dead-letter for having
// no handler, which is a silent failure at exactly the wrong moment.
import { WEBHOOK_EVENTS } from '@/lib/webhooks/fanout';

export const dynamic = 'force-dynamic';

/**
 * Your outbound webhook endpoints.
 *
 * Session-authenticated: an endpoint is where your data gets sent, so adding
 * one is a decision a person makes, not something an integration should be
 * able to do for you. A plugin gets its endpoint from its installation, where
 * the consent screen said what it would receive.
 */

const createSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.string().max(60)).min(1).max(40),
  description: z.string().max(200).optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const endpoints = listEndpoints(ctx);
  const endpointId = new URL(request.url).searchParams.get('endpoint');

  /*
   * Deliveries are only returned for an endpoint the caller owns, checked
   * against the list just read rather than by trusting the id. A delivery row
   * names an event type and a response code for somebody's integration.
   */
  const deliveries =
    endpointId && endpoints.some((endpoint) => endpoint.id === endpointId)
      ? deliveriesFor(endpointId)
      : [];

  return NextResponse.json({
    endpoints,
    deliveries,
    // What can be subscribed to. Rendering the server's own list keeps the
    // form from offering an event that will never fire.
    events: WEBHOOK_EVENTS,
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

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const result = createEndpoint(
    { userId: session.userId, isStaff: session.isStaff },
    parsed.data,
  );

  if (!result.ok || !result.endpoint) {
    // The SSRF module's own wording, which names the rule that was broken —
    // "that address points inside a private network" is actionable in a way
    // that "invalid URL" is not.
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ endpoint: result.endpoint });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const endpointId = new URL(request.url).searchParams.get('id') ?? '';
  const ctx = { userId: session.userId, isStaff: session.isStaff };

  // The only PATCH is re-enabling: an endpoint disabled by repeated failure,
  // switched back on once its owner has fixed the receiver.
  const result = reactivate(ctx, endpointId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ endpoints: listEndpoints(ctx) });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const endpointId = new URL(request.url).searchParams.get('id') ?? '';
  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const result = deleteEndpoint(ctx, endpointId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ endpoints: listEndpoints(ctx) });
}
