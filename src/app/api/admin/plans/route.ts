import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { allPlans, retirePlan, upsertPlan } from '@/lib/billing/plans-admin';

export const dynamic = 'force-dynamic';

/**
 * Plan configuration. Staff only.
 *
 * 404 for everyone else, including on GET: which plans exist as DRAFTS, and
 * what they are priced at before they are announced, is not public.
 *
 * This route records a decision that was made in Stripe. It does not create a
 * price there — deliberately. A route that could mint prices would make the
 * dashboard and this table two independent sources of truth for what a
 * customer is charged, and reconciling those after the fact is not a job worth
 * having.
 */

const planSchema = z.object({
  id: z.string().min(2).max(40),
  name: z.string().min(1).max(80),
  stripePriceId: z.string().max(120).nullable().default(null),
  centsPerMonth: z.number().int().min(0).max(10_000_00),
  monthlyCredits: z.number().int().min(0).max(100_000_000),
  maxMaps: z.number().int().min(0).max(100_000),
  maxAgents: z.number().int().min(0).max(10_000),
  active: z.boolean().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session?.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    plans: allPlans({ userId: session.userId, isStaff: true }),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = planSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const ctx = { userId: session.userId, isStaff: true };

  const result = upsertPlan(ctx, {
    ...parsed.data,
    // An empty field in a form means "no price id", not the empty string —
    // which would otherwise pass the paid-plan check and fail at checkout.
    stripePriceId: parsed.data.stripePriceId?.trim() || null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ plans: allPlans(ctx) });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session?.isStaff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const planId = new URL(request.url).searchParams.get('id') ?? '';
  const ctx = { userId: session.userId, isStaff: true };

  /*
   * DELETE, but it deactivates. The verb describes what the caller means —
   * take this off sale — and `retirePlan` is what makes sure existing
   * subscribers are not left pointing at a row that no longer exists.
   */
  const result = retirePlan(ctx, planId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ plans: allPlans(ctx) });
}
