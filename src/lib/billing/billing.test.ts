import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser } from '@/lib/db/repo';
import {
  balanceOf,
  creditsForUsd,
  history,
  grantPeriod,
  post,
  spend,
  usageThisMonth,
} from './credits';
import {
  applyWebhook,
  ensureCredits,
  invoicesFor,
  isEntitled,
  linkCustomer,
  planFor,
  plans,
  subscriptionFor,
} from './subscriptions';
import { StripeProvider } from './stripe';
import { BillingError, UnconfiguredBilling } from './provider';

/**
 * Billing tests.
 *
 * Two things here are not like the rest of the codebase, and both drive the
 * shape of these tests:
 *
 *   money       a rounding error is somebody's invoice, so every amount is an
 *               integer and the tests assert on exact values, never ranges;
 *   idempotency Stripe retries, and a retry that grants credits twice is a
 *               financial bug rather than a duplicate row. Every webhook test
 *               delivers the event at least twice.
 */

let db: Database;
let userId: string;

beforeEach(() => {
  db = createTestDb();
  userId = createUser(
    {
      id: 'u_pays',
      email: 'pays@example.com',
      passwordHash: 'x',
      handle: 'pays',
      displayName: 'Pays',
    },
    db,
  ).id;
});

// ----------------------------------------------------------------- credits

describe('the credit ledger', () => {
  it('reports a balance as the sum of its rows', () => {
    post(userId, { amount: 100, kind: 'grant', reference: 'a' }, db);
    post(userId, { amount: -30, kind: 'spend' }, db);

    expect(balanceOf(userId, db)).toBe(70);
  });

  it('rounds a cost UP so a tiny call is never free', () => {
    // $0.00001 is a fraction of a credit; charging zero would make an agent
    // making thousands of cheap calls pay nothing at all.
    expect(creditsForUsd(0.00001)).toBe(1);
    expect(creditsForUsd(0.003)).toBe(30);
    expect(creditsForUsd(0)).toBe(1);
  });

  it('posts an entry with the same reference only once', () => {
    const first = post(
      userId,
      { amount: 100, kind: 'grant', reference: 'inv_1' },
      db,
    );
    const second = post(
      userId,
      { amount: 100, kind: 'grant', reference: 'inv_1' },
      db,
    );

    expect(first.posted).toBe(true);
    // A retried webhook must not double a balance.
    expect(second.posted).toBe(false);
    expect(balanceOf(userId, db)).toBe(100);
  });

  it('still records every entry that has no reference', () => {
    // Per-call spends are genuinely distinct events; forcing a synthetic key
    // on them would be ceremony.
    post(userId, { amount: -5, kind: 'spend' }, db);
    post(userId, { amount: -5, kind: 'spend' }, db);

    expect(balanceOf(userId, db)).toBe(-10);
  });

  it('refuses a spend that would go negative', () => {
    post(userId, { amount: 10, kind: 'grant', reference: 'g' }, db);

    const result = spend(userId, 50, 'call_1', '', db);

    expect(result.ok).toBe(false);
    expect(balanceOf(userId, db)).toBe(10);
  });

  it('allows a spend that exactly empties the balance', () => {
    post(userId, { amount: 40, kind: 'grant', reference: 'g' }, db);

    expect(spend(userId, 40, 'call_1', '', db).ok).toBe(true);
    expect(balanceOf(userId, db)).toBe(0);
  });

  it('grants a period only once however often it is asked', () => {
    grantPeriod(userId, '2026-09', 500, db);
    grantPeriod(userId, '2026-09', 500, db);
    grantPeriod(userId, '2026-10', 500, db);

    // Two months, not three grants.
    expect(balanceOf(userId, db)).toBe(1000);
  });

  it('separates what was granted from what was spent', () => {
    post(userId, { amount: 100, kind: 'grant', reference: 'g' }, db);
    post(userId, { amount: -25, kind: 'spend' }, db);

    const usage = usageThisMonth(userId, db);

    expect(usage.grantedThisPeriod).toBe(100);
    expect(usage.spentThisPeriod).toBe(25);
    expect(usage.balance).toBe(75);
  });

  it('keeps a readable history', () => {
    post(
      userId,
      { amount: 100, kind: 'grant', reference: 'g', note: 'Monthly' },
      db,
    );
    expect(history(userId, 10, db)[0]?.note).toBe('Monthly');
  });
});

// ----------------------------------------------------------- subscriptions

describe('subscriptions', () => {
  it('gives everyone a free subscription rather than none', () => {
    const subscription = subscriptionFor(userId, db);

    // "No row" as a valid state means every caller decides what it implies,
    // and one of them getting it wrong in the permissive direction.
    expect(subscription.planId).toBe('free');
    expect(subscription.status).toBe('active');
  });

  it('provisions the free credits on first use, idempotently', () => {
    ensureCredits(userId, db);
    ensureCredits(userId, db);
    ensureCredits(userId, db);

    expect(balanceOf(userId, db)).toBe(100);
  });

  it('keeps existing subscribers on a plan that is no longer offered', () => {
    db.prepare(
      `INSERT INTO plans (id, name, cents_per_month, monthly_credits, max_maps, max_agents)
       VALUES ('legacy', 'Legacy', 500, 900, 10, 1)`,
    ).run();

    subscriptionFor(userId, db);
    db.prepare("UPDATE subscriptions SET plan_id = 'legacy' WHERE user_id = ?").run(
      userId,
    );

    // Retiring a plan means withdrawing it from sale, not from the people on
    // it. It leaves the pricing page and they keep what they pay for.
    db.prepare("UPDATE plans SET active = 0 WHERE id = 'legacy'").run();

    expect(plans(db).map((plan) => plan.id)).not.toContain('legacy');
    expect(planFor(userId, db).id).toBe('legacy');
    expect(planFor(userId, db).monthlyCredits).toBe(900);
  });

  it('cannot point a subscription at a plan that does not exist', () => {
    subscriptionFor(userId, db);

    /*
     * The foreign key is what makes `planFor`'s free fallback unreachable in
     * practice, and that is worth pinning: a dangling plan_id would be a
     * subscription nobody can price.
     */
    expect(() =>
      db
        .prepare("UPDATE subscriptions SET plan_id = 'gone' WHERE user_id = ?")
        .run(userId),
    ).toThrow(/FOREIGN KEY/);
  });

  it('keeps a past_due subscription entitled', () => {
    /*
     * Stripe retries a failed card for days before giving up. Cutting access
     * at the first failure punishes an expired card as harshly as a refusal
     * to pay; `canceled` is where access actually stops.
     */
    expect(isEntitled({ ...subscriptionFor(userId, db), status: 'past_due' })).toBe(
      true,
    );
    expect(isEntitled({ ...subscriptionFor(userId, db), status: 'canceled' })).toBe(
      false,
    );
  });
});

// --------------------------------------------------------------- webhooks

describe('webhooks', () => {
  const event = (id: string, type: string, object: Record<string, unknown>) => ({
    id,
    type,
    data: { object },
  });

  beforeEach(() => {
    subscriptionFor(userId, db);
    linkCustomer(userId, 'cus_123', db);

    db.prepare(
      `INSERT INTO plans (id, name, stripe_price_id, cents_per_month, monthly_credits, max_maps, max_agents)
       VALUES ('pro', 'Pro', 'price_pro', 2000, 5000, 50, 5)`,
    ).run();
  });

  it('processes an event once, however many times it is delivered', () => {
    const paid = event('evt_1', 'invoice.paid', {
      id: 'in_1',
      customer: 'cus_123',
      amount_paid: 2000,
      currency: 'usd',
    });

    const first = applyWebhook(paid, db);
    const second = applyWebhook(paid, db);
    const third = applyWebhook(paid, db);

    expect(first.processed).toBe(true);
    expect(second.processed).toBe(false);
    expect(third.processed).toBe(false);

    // One invoice, one grant. A retry that granted twice would be a financial
    // bug rather than a duplicate row.
    expect(invoicesFor(userId, db)).toHaveLength(1);
    expect(balanceOf(userId, db)).toBe(100);
  });

  it('grants the plan credits when an invoice is paid', () => {
    db.prepare("UPDATE subscriptions SET plan_id = 'pro' WHERE user_id = ?").run(
      userId,
    );

    applyWebhook(
      event('evt_2', 'invoice.paid', {
        id: 'in_2',
        customer: 'cus_123',
        amount_paid: 2000,
        currency: 'usd',
      }),
      db,
    );

    expect(balanceOf(userId, db)).toBe(5000);
  });

  it('keys the grant on the invoice, not the month', () => {
    db.prepare("UPDATE subscriptions SET plan_id = 'pro' WHERE user_id = ?").run(
      userId,
    );

    // Two invoices in one calendar month — a plan change mid-period, or a
    // billing cycle that straddles a month boundary. Both must grant.
    applyWebhook(
      event('evt_3', 'invoice.paid', { id: 'in_3', customer: 'cus_123' }),
      db,
    );
    applyWebhook(
      event('evt_4', 'invoice.paid', { id: 'in_4', customer: 'cus_123' }),
      db,
    );

    expect(balanceOf(userId, db)).toBe(10000);
  });

  it('moves the subscription to the plan the price maps to', () => {
    applyWebhook(
      event('evt_5', 'customer.subscription.updated', {
        id: 'sub_stripe',
        customer: 'cus_123',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' } }] },
      }),
      db,
    );

    expect(planFor(userId, db).id).toBe('pro');
  });

  it('marks a subscription past_due when payment fails', () => {
    applyWebhook(
      event('evt_6', 'invoice.payment_failed', { customer: 'cus_123' }),
      db,
    );

    expect(subscriptionFor(userId, db).status).toBe('past_due');
  });

  it('drops to free rather than deleting the row on cancellation', () => {
    applyWebhook(
      event('evt_7', 'customer.subscription.deleted', { customer: 'cus_123' }),
      db,
    );

    const subscription = subscriptionFor(userId, db);
    // The row records that they were a customer, so a later refund webhook
    // still has something to attach to.
    expect(subscription.planId).toBe('free');
    expect(subscription.status).toBe('canceled');
  });

  it('records an unknown event without acting on it', () => {
    const result = applyWebhook(
      event('evt_8', 'customer.discount.created', { customer: 'cus_123' }),
      db,
    );

    expect(result.processed).toBe(false);

    const row = db
      .prepare('SELECT outcome FROM webhook_events WHERE id = ?')
      .get('evt_8') as { outcome: string };
    expect(row.outcome).toBe('ignored');
  });
});

// ---------------------------------------------------- signature verification

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_x', type: 'invoice.paid', data: {} });

  function sign(payload: string, timestamp: number, withSecret = secret) {
    const signature = createHmac('sha256', withSecret)
      .update(`${timestamp}.${payload}`, 'utf8')
      .digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  const provider = (now: number) =>
    new StripeProvider({
      apiKey: 'sk_test',
      webhookSecret: secret,
      now: () => now,
    });

  it('accepts a correctly signed, recent event', () => {
    const now = 1_700_000_000_000;
    const event = provider(now).verifyWebhook(body, sign(body, now / 1000));

    expect(event.id).toBe('evt_x');
    expect(event.type).toBe('invoice.paid');
  });

  it('rejects a signature made with the wrong secret', () => {
    const now = 1_700_000_000_000;

    expect(() =>
      provider(now).verifyWebhook(body, sign(body, now / 1000, 'whsec_wrong')),
    ).toThrow(BillingError);
  });

  it('rejects a body that was altered after signing', () => {
    const now = 1_700_000_000_000;
    const signature = sign(body, now / 1000);

    // The whole point: a body claiming someone paid must not be trusted.
    const tampered = JSON.stringify({
      id: 'evt_x',
      type: 'invoice.paid',
      data: { object: { amount_paid: 999_999 } },
    });

    expect(() => provider(now).verifyWebhook(tampered, signature)).toThrow(
      BillingError,
    );
  });

  it('rejects a genuine event replayed later', () => {
    const signedAt = 1_700_000_000;
    const signature = sign(body, signedAt);

    /*
     * Signed correctly, and still refused an hour later. "This invoice was
     * paid" is a claim about now, so a captured request must not stay useful.
     */
    expect(() =>
      provider((signedAt + 3600) * 1000).verifyWebhook(body, signature),
    ).toThrow(/too old/);
  });

  it('rejects a malformed signature header', () => {
    const now = 1_700_000_000_000;

    expect(() => provider(now).verifyWebhook(body, 'nonsense')).toThrow(
      /malformed/,
    );
  });

  it('accepts any one of several signatures during a secret rotation', () => {
    const now = 1_700_000_000_000;
    const timestamp = now / 1000;

    const wrong = createHmac('sha256', 'whsec_old')
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex');
    const right = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex');

    const header = `t=${timestamp},v1=${wrong},v1=${right}`;

    expect(provider(now).verifyWebhook(body, header).id).toBe('evt_x');
  });
});

// -------------------------------------------------------------- unconfigured

describe('an unconfigured environment', () => {
  it('fails loudly rather than pretending a checkout worked', async () => {
    const provider = new UnconfiguredBilling();

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.createCheckout()).rejects.toThrow(BillingError);
    expect(() => provider.verifyWebhook()).toThrow(BillingError);
  });
});
