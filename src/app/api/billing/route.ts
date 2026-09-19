import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { clientEnv } from '@/lib/env';
import { BillingError } from '@/lib/billing/provider';
import {
  billing,
  billingEmail,
  ensureCredits,
  invoicesFor,
  linkCustomer,
  planFor,
  plans,
  subscriptionFor,
} from '@/lib/billing/subscriptions';
import { history, usageThisMonth } from '@/lib/billing/credits';

export const dynamic = 'force-dynamic';

/**
 * Billing for the signed-in user.
 *
 * GET returns everything a billing page needs in one call. POST starts either
 * a checkout or a customer-portal session — both are Stripe-hosted pages, and
 * this application never renders a card field.
 */

const actionSchema = z.object({
  action: z.enum(['checkout', 'portal']),
  /** Required for checkout, ignored for the portal. */
  planId: z.string().max(60).optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  // Provisions the free allowance on first visit, idempotently.
  ensureCredits(session.userId);

  return NextResponse.json({
    subscription: subscriptionFor(session.userId),
    plan: planFor(session.userId),
    plans: plans(),
    usage: usageThisMonth(session.userId),
    ledger: history(session.userId, 25),
    invoices: invoicesFor(session.userId),
    /*
     * So the page can say "payments are not set up here" rather than offering
     * an Upgrade button that throws. An unconfigured environment should look
     * unconfigured.
     */
    configured: billing().isConfigured(),
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

  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the request' }, { status: 400 });
  }

  const provider = billing();
  if (!provider.isConfigured()) {
    return NextResponse.json(
      { error: 'Payments are not available here.' },
      { status: 503 },
    );
  }

  const site = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  try {
    const subscription = subscriptionFor(session.userId);

    /*
     * The Stripe customer is created once and reused.
     *
     * A second customer for the same person splits their invoice history in
     * two and makes every webhook lookup ambiguous — the id is how a webhook
     * finds the account it is about.
     */
    let customerId = subscription.stripeCustomerId;

    if (!customerId) {
      const created = await provider.ensureCustomer({
        userId: session.userId,
        email: billingEmail(session.userId),
      });

      customerId = created.customerId;
      linkCustomer(session.userId, customerId);
    }

    if (parsed.data.action === 'portal') {
      const portal = await provider.createPortal({
        customerId,
        returnUrl: `${site}/settings/billing`,
      });
      return NextResponse.json({ url: portal.url });
    }

    const plan = plans().find((candidate) => candidate.id === parsed.data.planId);

    if (!plan?.stripePriceId) {
      return NextResponse.json(
        { error: 'That plan cannot be purchased.' },
        { status: 400 },
      );
    }

    const checkout = await provider.createCheckout({
      customerId,
      priceId: plan.stripePriceId,
      successUrl: `${site}/settings/billing?checkout=done`,
      cancelUrl: `${site}/settings/billing`,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (cause) {
    const error = cause instanceof BillingError ? cause : null;

    console.error('[billing] session failed:', error?.detail ?? String(cause));

    /*
     * 503 for a transient failure so a client can sensibly retry, 400 for a
     * refusal it cannot fix by trying again. The provider's own message never
     * reaches the user — it can name internal ids.
     */
    return NextResponse.json(
      { error: 'Could not start that. Try again in a moment.' },
      { status: error?.retryable ? 503 : 400 },
    );
  }
}
