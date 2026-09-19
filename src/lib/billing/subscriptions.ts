import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { serverEnv } from '@/lib/env';
import { StripeProvider } from './stripe';
import {
  UnconfiguredBilling,
  type BillingProvider,
  type VerifiedEvent,
} from './provider';
import { grantPeriod, post } from './credits';

/**
 * Subscriptions, plans, and the webhook that keeps them in step with Stripe.
 *
 * ── Stripe is the source of truth ───────────────────────────────────────────
 *
 * Nothing here decides whether someone has paid. Stripe decides; this mirrors
 * the answer so a page can render without a network call and so the system
 * keeps working when Stripe is briefly unreachable. Anywhere the two disagree,
 * Stripe wins and the next webhook corrects us.
 *
 * That is why status strings are Stripe's own vocabulary rather than a local
 * enum — a mapping layer between two sets of names is a place for them to
 * drift, and the mapping is never as obvious later as it seems now.
 */

export interface Plan {
  id: string;
  name: string;
  stripePriceId: string | null;
  centsPerMonth: number;
  monthlyCredits: number;
  maxMaps: number;
  maxAgents: number;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: string;
  stripeCustomerId: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

let cached: BillingProvider | null = null;

export function billing(): BillingProvider {
  if (cached) return cached;

  cached =
    serverEnv.STRIPE_SECRET_KEY && serverEnv.STRIPE_WEBHOOK_SECRET
      ? new StripeProvider({
          apiKey: serverEnv.STRIPE_SECRET_KEY,
          webhookSecret: serverEnv.STRIPE_WEBHOOK_SECRET,
        })
      : new UnconfiguredBilling();

  return cached;
}

/** Tests swap the provider; nothing else should. */
export function setBillingProvider(next: BillingProvider | null): void {
  cached = next;
}

export function plans(db: Database = getDb()): Plan[] {
  const rows = db
    .prepare('SELECT * FROM plans WHERE active = 1 ORDER BY cents_per_month')
    .all() as {
    id: string;
    name: string;
    stripe_price_id: string | null;
    cents_per_month: number;
    monthly_credits: number;
    max_maps: number;
    max_agents: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    stripePriceId: row.stripe_price_id,
    centsPerMonth: row.cents_per_month,
    monthlyCredits: row.monthly_credits,
    maxMaps: row.max_maps,
    maxAgents: row.max_agents,
  }));
}

/**
 * Someone's subscription, creating a free one if they have none.
 *
 * Every user has a subscription. Making "no row" a valid state would mean
 * every caller handling null and deciding what a missing subscription implies,
 * and one of them getting it wrong in the permissive direction.
 */
export function subscriptionFor(
  userId: string,
  db: Database = getDb(),
): Subscription {
  const existing = db
    .prepare('SELECT * FROM subscriptions WHERE user_id = ?')
    .get(userId) as Record<string, unknown> | undefined;

  if (!existing) {
    const id = `sub_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    db.prepare(
      `INSERT INTO subscriptions (id, user_id, plan_id, status)
       VALUES (?, ?, 'free', 'active')`,
    ).run(id, userId);

    return {
      id,
      userId,
      planId: 'free',
      status: 'active',
      stripeCustomerId: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  return {
    id: String(existing.id),
    userId,
    planId: String(existing.plan_id),
    status: String(existing.status),
    stripeCustomerId: (existing.stripe_customer_id as string | null) ?? null,
    periodEnd: (existing.period_end as string | null) ?? null,
    cancelAtPeriodEnd: existing.cancel_at_period_end === 1,
  };
}

export function planFor(userId: string, db: Database = getDb()): Plan {
  const subscription = subscriptionFor(userId, db);

  const row = db
    .prepare('SELECT * FROM plans WHERE id = ?')
    .get(subscription.planId) as Record<string, unknown> | undefined;

  /*
   * A subscription pointing at a plan that no longer exists falls back to
   * free rather than throwing. Retiring a plan should not lock out the people
   * who were on it; it should quietly reduce what they can do until someone
   * migrates them.
   */
  const plan =
    row ??
    (db.prepare("SELECT * FROM plans WHERE id = 'free'").get() as Record<
      string,
      unknown
    >);

  return {
    id: String(plan.id),
    name: String(plan.name),
    stripePriceId: (plan.stripe_price_id as string | null) ?? null,
    centsPerMonth: Number(plan.cents_per_month),
    monthlyCredits: Number(plan.monthly_credits),
    maxMaps: Number(plan.max_maps),
    maxAgents: Number(plan.max_agents),
  };
}

/**
 * Whether a subscription entitles someone to paid features right now.
 *
 * `past_due` counts as entitled. Stripe keeps retrying a failed card for days,
 * and cutting someone off the moment a renewal fails punishes an expired card
 * as harshly as a refusal to pay. Stripe moves it to `canceled` when it gives
 * up, and that is the point at which access stops.
 */
export function isEntitled(subscription: Subscription): boolean {
  return subscription.status === 'active' || subscription.status === 'past_due';
}

// ------------------------------------------------------------------ webhooks

export interface WebhookResult {
  ok: boolean;
  /** False when this event had already been processed. Not an error. */
  processed: boolean;
  error?: string;
}

function objectOf(event: VerifiedEvent): Record<string, unknown> {
  const data = event.data as { object?: Record<string, unknown> };
  return data.object ?? {};
}

/**
 * Apply a verified webhook.
 *
 * ── Idempotency is enforced by the database, not by a check ─────────────────
 *
 * Stripe retries until it gets a 2xx and can deliver the same event twice even
 * on success. The event id is the primary key of `webhook_events`, so a repeat
 * fails to insert and returns before doing anything — rather than a
 * SELECT-then-INSERT, where two concurrent deliveries both pass the select.
 *
 * The caller must have verified the signature already. That is why this takes
 * a `VerifiedEvent` and not a string: it is not possible to hand it an
 * unverified body by forgetting a step.
 */
export function applyWebhook(
  event: VerifiedEvent,
  db: Database = getDb(),
): WebhookResult {
  try {
    db.prepare('INSERT INTO webhook_events (id, type) VALUES (?, ?)').run(
      event.id,
      event.type,
    );
  } catch (cause) {
    if (String(cause).includes('UNIQUE')) {
      return { ok: true, processed: false };
    }
    throw cause;
  }

  const object = objectOf(event);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const customerId = String(object.customer ?? '');
        if (!customerId) break;

        const owner = db
          .prepare('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?')
          .get(customerId) as { user_id: string } | undefined;

        if (!owner) break;

        /*
         * The plan comes from the price id, which is the only stable link
         * between what Stripe charged and what we grant. Matching on a product
         * name would break the first time someone renames one in the
         * dashboard.
         */
        const priceId =
          (object.items as { data?: { price?: { id?: string } }[] } | undefined)
            ?.data?.[0]?.price?.id ?? null;

        const plan = priceId
          ? (db
              .prepare('SELECT id FROM plans WHERE stripe_price_id = ?')
              .get(priceId) as { id: string } | undefined)
          : undefined;

        db.prepare(
          `UPDATE subscriptions SET
             plan_id = COALESCE(@planId, plan_id),
             status = COALESCE(@status, status),
             stripe_subscription_id = COALESCE(@subId, stripe_subscription_id),
             period_end = COALESCE(@periodEnd, period_end),
             cancel_at_period_end = COALESCE(@cancel, cancel_at_period_end),
             updated_at = datetime('now')
           WHERE user_id = @userId`,
        ).run({
          userId: owner.user_id,
          planId: plan?.id ?? null,
          status: object.status ? String(object.status) : null,
          subId: object.id ? String(object.id) : null,
          periodEnd: object.current_period_end
            ? new Date(Number(object.current_period_end) * 1000).toISOString()
            : null,
          cancel:
            object.cancel_at_period_end === undefined
              ? null
              : object.cancel_at_period_end
                ? 1
                : 0,
        });

        break;
      }

      case 'customer.subscription.deleted': {
        const customerId = String(object.customer ?? '');
        if (!customerId) break;

        /*
         * Dropped to free rather than deleted. The row records that they were
         * a customer, and a subsequent invoice or refund webhook still has
         * something to attach to.
         */
        db.prepare(
          `UPDATE subscriptions
              SET plan_id = 'free', status = 'canceled', updated_at = datetime('now')
            WHERE stripe_customer_id = ?`,
        ).run(customerId);

        break;
      }

      case 'invoice.paid': {
        const customerId = String(object.customer ?? '');
        const owner = db
          .prepare(
            'SELECT user_id, plan_id FROM subscriptions WHERE stripe_customer_id = ?',
          )
          .get(customerId) as { user_id: string; plan_id: string } | undefined;

        if (!owner) break;

        db.prepare(
          `INSERT OR IGNORE INTO invoices
             (id, user_id, stripe_invoice_id, amount_cents, currency, status, hosted_url)
           VALUES (?, ?, ?, ?, ?, 'paid', ?)`,
        ).run(
          `inv_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
          owner.user_id,
          String(object.id ?? ''),
          Number(object.amount_paid ?? 0),
          String(object.currency ?? 'usd'),
          object.hosted_invoice_url ? String(object.hosted_invoice_url) : null,
        );

        const plan = db
          .prepare('SELECT monthly_credits FROM plans WHERE id = ?')
          .get(owner.plan_id) as { monthly_credits: number } | undefined;

        /*
         * Credits are keyed on the INVOICE id, not on "now".
         *
         * A retried invoice.paid then grants once. Keying on the current month
         * would double-grant anyone whose billing period straddles a month
         * boundary, which is most people.
         */
        if (plan && plan.monthly_credits > 0) {
          post(
            owner.user_id,
            {
              amount: plan.monthly_credits,
              kind: 'grant',
              reference: `invoice:${String(object.id ?? '')}`,
              note: 'Credits for this billing period',
            },
            db,
          );
        }

        break;
      }

      case 'invoice.payment_failed': {
        const customerId = String(object.customer ?? '');
        db.prepare(
          `UPDATE subscriptions SET status = 'past_due', updated_at = datetime('now')
            WHERE stripe_customer_id = ?`,
        ).run(customerId);
        break;
      }

      default:
        db.prepare(
          "UPDATE webhook_events SET outcome = 'ignored' WHERE id = ?",
        ).run(event.id);
        return { ok: true, processed: false };
    }

    return { ok: true, processed: true };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    /*
     * The failure is recorded rather than swallowed, and the event row STAYS —
     * so a replay is a deliberate act rather than something Stripe's retry
     * does silently while we are still broken.
     */
    db.prepare(
      "UPDATE webhook_events SET outcome = 'failed', error = ? WHERE id = ?",
    ).run(message.slice(0, 500), event.id);

    return { ok: false, processed: false, error: message };
  }
}

/**
 * The email to put on the Stripe customer.
 *
 * Here rather than in the route, because `chokepoint.test.ts` keeps everything
 * under app/ off the database handle. It is billing's own lookup: the address
 * is used to create a customer record and for nothing else.
 */
export function billingEmail(userId: string, db: Database = getDb()): string {
  const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as
    { email: string } | undefined;

  return row?.email ?? '';
}

/** Attach a Stripe customer id to a user, so webhooks can find them. */
export function linkCustomer(
  userId: string,
  customerId: string,
  db: Database = getDb(),
): void {
  subscriptionFor(userId, db);

  db.prepare(
    `UPDATE subscriptions SET stripe_customer_id = ?, updated_at = datetime('now')
      WHERE user_id = ?`,
  ).run(customerId, userId);
}

export interface InvoiceRow {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  hostedUrl: string | null;
  createdAt: string;
}

export function invoicesFor(userId: string, db: Database = getDb()): InvoiceRow[] {
  const rows = db
    .prepare(
      `SELECT id, amount_cents, currency, status, hosted_url, created_at
         FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(userId) as {
    id: string;
    amount_cents: number;
    currency: string;
    status: string;
    hosted_url: string | null;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    hostedUrl: row.hosted_url,
    createdAt: row.created_at,
  }));
}

/**
 * Make sure a user has this month's credits.
 *
 * ── Lazy, rather than a backfill ────────────────────────────────────────────
 *
 * Every existing account predates the credit ledger, and a migration that
 * inserted a row per user would be a one-off that has to be repeated for every
 * future month anyway. Granting on first use is idempotent by construction —
 * the reference is the month, so calling this a thousand times in a month
 * grants once — and it self-heals for accounts created between runs of any
 * scheduled job.
 */
export function ensureCredits(userId: string, db: Database = getDb()): void {
  const plan = planFor(userId, db);
  if (plan.monthlyCredits <= 0) return;

  // The calendar month for free, so it renews predictably. A paid plan is
  // granted by invoice.paid instead, keyed on the invoice.
  if (plan.id === 'free') {
    grantPeriod(
      userId,
      new Date().toISOString().slice(0, 7),
      plan.monthlyCredits,
      db,
    );
  }
}

/** Grant the free plan's monthly credits. Called by the maintenance job. */
export function grantFreeCredits(userId: string, db: Database = getDb()): void {
  const plan = planFor(userId, db);
  if (plan.id !== 'free' || plan.monthlyCredits <= 0) return;

  const periodStart = new Date().toISOString().slice(0, 7);
  grantPeriod(userId, periodStart, plan.monthlyCredits, db);
}
