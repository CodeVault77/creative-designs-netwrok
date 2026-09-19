import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { PUBLIC_CONTEXT } from '@/lib/db/repo';
import {
  MAX_EVENTS_PER_BATCH,
  activationReport,
  comingSoonDemand,
  eventVolume,
  ingest,
  threeTapReport,
} from '@/lib/analytics/store';

export const dynamic = 'force-dynamic';

const schema = z.object({
  anonId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
  userId: z.string().max(64).nullable().optional(),
  events: z
    .array(
      z.object({
        name: z.string().max(60),
        props: z.record(z.unknown()).optional(),
        at: z.string().max(40).optional(),
      }),
    )
    .max(MAX_EVENTS_PER_BATCH),
});

/**
 * POST /api/analytics — the first-party sink (ADR-0009).
 *
 * Public by necessity: the events worth having are the ones from people who
 * never sign in. So it is treated as hostile input — a bounded batch, a
 * per-sender hourly ceiling, properties stripped to scalars, and event names
 * checked against the declared taxonomy rather than stored as sent.
 *
 * `userId` comes from the SESSION, never from the body. A client-supplied user
 * id on a public endpoint is an invitation to attribute someone else's
 * behaviour to an account they do not own.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    // A malformed beacon is not worth an error page; it is worth ignoring.
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  const session = await getSession();

  const result = ingest({
    anonId: parsed.data.anonId,
    sessionId: parsed.data.sessionId,
    userId: session?.userId ?? null,
    events: parsed.data.events,
  });

  /**
   * 202, and never an error the client can see.
   *
   * `sendBeacon` cannot read a response and the facade swallows failures
   * anyway, so a 4xx here would achieve nothing except noise in the console of
   * someone whose only mistake was closing a tab.
   */
  return NextResponse.json(result, { status: 202 });
}

/**
 * GET — the funnels §20 P14 requires: "activation and 3-tap metrics
 * instrumented". Staff only, 404 for everyone else.
 */
export async function GET(request: Request) {
  const session = await getSession();
  const ctx = session
    ? { userId: session.userId, isStaff: session.isStaff }
    : PUBLIC_CONTEXT;

  if (!ctx.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const days = Math.min(
    Math.max(Number(new URL(request.url).searchParams.get('days') ?? 30), 1),
    365,
  );

  return NextResponse.json({
    days,
    threeTap: threeTapReport(ctx, days),
    activation: activationReport(ctx, days),
    demand: comingSoonDemand(ctx),
    volume: eventVolume(ctx, days),
  });
}
