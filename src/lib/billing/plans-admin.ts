import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';

/**
 * Configuring paid plans.
 *
 * ── Why no plans are seeded ─────────────────────────────────────────────────
 *
 * The migration seeds `free` and nothing else, and that is deliberate rather
 * than unfinished. A paid plan needs a Stripe price id, and a price id only
 * exists once somebody has created that price in the Stripe dashboard. Seeding
 * a "Pro — $20" row with an invented id would produce a plan that looks
 * purchasable and fails at checkout, which is worse than no plan at all.
 *
 * Pricing is also not an engineering decision. What to charge, and for what,
 * is the business's to set — this file is the mechanism for recording that
 * decision once it has been made, not a place to guess it.
 *
 * ── The order of operations ─────────────────────────────────────────────────
 *
 *   1. create the product and its price in Stripe
 *   2. copy the price id (it looks like `price_1AbC...`)
 *   3. call `upsertPlan` with it, through the admin route or a script
 *
 * Getting that backwards — recording the plan first — leaves a row that
 * cannot be bought until someone remembers to come back.
 */

export interface PlanInput {
  id: string;
  name: string;
  /** From the Stripe dashboard. Null only for the free plan. */
  stripePriceId: string | null;
  /** Integer cents per month. Must agree with the Stripe price. */
  centsPerMonth: number;
  monthlyCredits: number;
  maxMaps: number;
  maxAgents: number;
  active?: boolean;
}

export interface PlanResult {
  ok: boolean;
  error?: string;
}

/**
 * Create or update a plan. Staff only.
 *
 * `centsPerMonth` is stored for display, and Stripe remains the authority on
 * what is actually charged. They can drift if someone changes the price in the
 * dashboard without updating here — which is why the pricing page renders this
 * number and the CHECKOUT uses the price id, so a drift shows up as a wrong
 * label rather than a wrong charge.
 */
export function upsertPlan(
  ctx: AuthContext,
  input: PlanInput,
  db: Database = getDb(),
): PlanResult {
  if (!ctx.isStaff) return { ok: false, error: 'Not found' };

  if (!/^[a-z0-9_-]{2,40}$/.test(input.id)) {
    return { ok: false, error: 'A plan id is lower case, digits and dashes' };
  }

  /*
   * A paid plan without a price id is refused.
   *
   * That combination is the failure this file exists to prevent: a plan that
   * appears on the pricing page, takes a click, and dies at checkout with an
   * error nobody can act on.
   */
  if (input.centsPerMonth > 0 && !input.stripePriceId) {
    return { ok: false, error: 'A paid plan needs its Stripe price id' };
  }

  if (input.stripePriceId && !input.stripePriceId.startsWith('price_')) {
    /*
     * Stripe has product ids (`prod_`) and price ids (`price_`), and pasting
     * the wrong one is the most common way to configure this incorrectly. The
     * failure otherwise appears at checkout, to a customer.
     */
    return {
      ok: false,
      error: 'That looks like a product id. Checkout needs the price id.',
    };
  }

  try {
    db.prepare(
      `INSERT INTO plans
         (id, name, stripe_price_id, cents_per_month, monthly_credits,
          max_maps, max_agents, active)
       VALUES (@id, @name, @priceId, @cents, @credits, @maxMaps, @maxAgents, @active)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         stripe_price_id = excluded.stripe_price_id,
         cents_per_month = excluded.cents_per_month,
         monthly_credits = excluded.monthly_credits,
         max_maps = excluded.max_maps,
         max_agents = excluded.max_agents,
         active = excluded.active`,
    ).run({
      id: input.id,
      name: input.name.slice(0, 80),
      priceId: input.stripePriceId,
      cents: Math.max(0, Math.round(input.centsPerMonth)),
      credits: Math.max(0, Math.round(input.monthlyCredits)),
      maxMaps: Math.max(0, Math.round(input.maxMaps)),
      maxAgents: Math.max(0, Math.round(input.maxAgents)),
      active: input.active === false ? 0 : 1,
    });

    return { ok: true };
  } catch (cause) {
    // The unique index on stripe_price_id: two plans on one price would make
    // "which plan did they buy" ambiguous in every webhook.
    if (String(cause).includes('UNIQUE')) {
      return { ok: false, error: 'Another plan already uses that price id' };
    }
    throw cause;
  }
}

/**
 * Withdraw a plan from sale.
 *
 * Deactivates rather than deletes. Existing subscribers keep it — a foreign
 * key would refuse the delete anyway, and quite right: a subscription pointing
 * at nothing is a customer nobody can price.
 */
export function retirePlan(
  ctx: AuthContext,
  planId: string,
  db: Database = getDb(),
): PlanResult {
  if (!ctx.isStaff) return { ok: false, error: 'Not found' };
  if (planId === 'free') {
    return { ok: false, error: 'The free plan cannot be retired' };
  }

  const changed = db
    .prepare('UPDATE plans SET active = 0 WHERE id = ?')
    .run(planId).changes;

  return changed > 0 ? { ok: true } : { ok: false, error: 'Not found' };
}

export interface PlanRow extends PlanInput {
  active: boolean;
  /** How many people are on it. Shown before anyone retires one. */
  subscribers: number;
}

/** Every plan including retired ones, for the admin screen. */
export function allPlans(ctx: AuthContext, db: Database = getDb()): PlanRow[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `SELECT plans.*,
              (SELECT COUNT(*) FROM subscriptions
                WHERE subscriptions.plan_id = plans.id) AS subscribers
         FROM plans ORDER BY plans.cents_per_month`,
    )
    .all() as {
    id: string;
    name: string;
    stripe_price_id: string | null;
    cents_per_month: number;
    monthly_credits: number;
    max_maps: number;
    max_agents: number;
    active: number;
    subscribers: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    stripePriceId: row.stripe_price_id,
    centsPerMonth: row.cents_per_month,
    monthlyCredits: row.monthly_credits,
    maxMaps: row.max_maps,
    maxAgents: row.max_agents,
    active: row.active === 1,
    subscribers: row.subscribers,
  }));
}
