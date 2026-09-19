import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser } from '@/lib/db/repo';
import { plans } from './subscriptions';
import { allPlans, retirePlan, upsertPlan } from './plans-admin';

/**
 * Plan configuration tests.
 *
 * The bug this module exists to prevent is a plan that LOOKS purchasable and
 * is not: a paid row with no Stripe price id, or with a product id pasted
 * where the price id belongs. Both fail at checkout, in front of a customer,
 * with an error they cannot act on — so both are refused here, and both have
 * a test.
 */

let db: Database;
let staff: { userId: string; isStaff: true };
let outsider: { userId: string; isStaff: false };

const PRO = {
  id: 'pro',
  name: 'Pro',
  stripePriceId: 'price_test_pro',
  centsPerMonth: 2000,
  monthlyCredits: 50_000,
  maxMaps: 100,
  maxAgents: 5,
};

beforeEach(() => {
  db = createTestDb();

  createUser(
    {
      id: 'u_staff',
      email: 'staff@example.com',
      passwordHash: 'x',
      handle: 'staffer',
      displayName: 'Staffer',
    },
    db,
  );

  staff = { userId: 'u_staff', isStaff: true };
  outsider = { userId: 'u_other', isStaff: false };
});

// ------------------------------------------------------------- what is seeded

describe('what ships', () => {
  it('seeds the free plan and nothing else', () => {
    /*
     * Asserted deliberately, so that "no paid plans" stays a decision rather
     * than drifting into an oversight. A seeded paid plan would need a price
     * id, and a price id only exists once someone has created that price in
     * Stripe — an invented one produces a plan that dies at checkout.
     */
    const rows = allPlans(staff, db);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('free');
    expect(rows[0]?.centsPerMonth).toBe(0);
    expect(rows[0]?.stripePriceId).toBeNull();
  });
});

// -------------------------------------------------------------------- refusal

describe('a plan that cannot be bought is refused', () => {
  it('will not record a paid plan with no price id', () => {
    const result = upsertPlan(staff, { ...PRO, stripePriceId: null }, db);

    expect(result.ok).toBe(false);
    expect(allPlans(staff, db)).toHaveLength(1);
  });

  it('will not accept a product id where a price id belongs', () => {
    // The most common misconfiguration, and invisible until checkout.
    const result = upsertPlan(
      staff,
      { ...PRO, stripePriceId: 'prod_test_pro' },
      db,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/price id/i);
  });

  it('will not accept a plan id that is not a slug', () => {
    expect(upsertPlan(staff, { ...PRO, id: 'Pro Plan!' }, db).ok).toBe(false);
  });

  it('will not put two plans on one price', () => {
    // Otherwise "which plan did they buy" is ambiguous in every webhook.
    upsertPlan(staff, PRO, db);

    const clash = upsertPlan(staff, { ...PRO, id: 'pro2', name: 'Pro Two' }, db);

    expect(clash.ok).toBe(false);
    expect(clash.error).toMatch(/price id/i);
  });

  it('allows a free plan with no price id', () => {
    const result = upsertPlan(
      staff,
      {
        id: 'starter',
        name: 'Starter',
        stripePriceId: null,
        centsPerMonth: 0,
        monthlyCredits: 100,
        maxMaps: 3,
        maxAgents: 0,
      },
      db,
    );

    expect(result.ok).toBe(true);
  });
});

// --------------------------------------------------------------------- access

describe('staff only', () => {
  it('refuses a write from a non-staff user', () => {
    expect(upsertPlan(outsider, PRO, db).ok).toBe(false);
    expect(allPlans(staff, db)).toHaveLength(1);
  });

  it('returns nothing to a non-staff reader', () => {
    // Draft plans and unannounced prices are not public.
    upsertPlan(staff, { ...PRO, active: false }, db);

    expect(allPlans(outsider, db)).toEqual([]);
  });

  it('refuses a retirement from a non-staff user', () => {
    upsertPlan(staff, PRO, db);

    expect(retirePlan(outsider, 'pro', db).ok).toBe(false);
    expect(allPlans(staff, db).find((p) => p.id === 'pro')?.active).toBe(true);
  });
});

// ---------------------------------------------------------------- the happy path

describe('recording a plan', () => {
  it('creates it and makes it purchasable', () => {
    upsertPlan(staff, PRO, db);

    const purchasable = plans(db).find((plan) => plan.id === 'pro');

    expect(purchasable?.stripePriceId).toBe('price_test_pro');
    expect(purchasable?.centsPerMonth).toBe(2000);
  });

  it('updates in place rather than duplicating', () => {
    upsertPlan(staff, PRO, db);
    upsertPlan(staff, { ...PRO, name: 'Professional', monthlyCredits: 80_000 }, db);

    const rows = allPlans(staff, db).filter((plan) => plan.id === 'pro');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Professional');
    expect(rows[0]?.monthlyCredits).toBe(80_000);
  });

  it('rounds amounts to whole cents', () => {
    upsertPlan(staff, { ...PRO, centsPerMonth: 1999.6 }, db);

    expect(allPlans(staff, db).find((p) => p.id === 'pro')?.centsPerMonth).toBe(
      2000,
    );
  });
});

// ------------------------------------------------------------------ retirement

describe('taking a plan off sale', () => {
  it('deactivates rather than deleting', () => {
    upsertPlan(staff, PRO, db);

    expect(retirePlan(staff, 'pro', db).ok).toBe(true);

    const row = allPlans(staff, db).find((plan) => plan.id === 'pro');

    // Still there — a subscription pointing at nothing is a customer nobody
    // can price.
    expect(row).toBeDefined();
    expect(row?.active).toBe(false);
  });

  it('takes it off the purchasable list', () => {
    upsertPlan(staff, PRO, db);
    retirePlan(staff, 'pro', db);

    expect(plans(db).some((plan) => plan.id === 'pro')).toBe(false);
  });

  it('refuses to retire the free plan', () => {
    // Every account without a subscription resolves to it. Retiring it would
    // leave them on a plan that is not for sale.
    expect(retirePlan(staff, 'free', db).ok).toBe(false);
  });

  it('reports a plan that does not exist as not found', () => {
    expect(retirePlan(staff, 'nope', db).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ subscribers

describe('subscriber counts', () => {
  it('counts who is on each plan, so nobody retires one blind', () => {
    upsertPlan(staff, PRO, db);

    db.prepare(
      `INSERT INTO subscriptions (id, user_id, plan_id, status)
       VALUES ('sub_test', ?, 'pro', 'active')`,
    ).run('u_staff');

    expect(allPlans(staff, db).find((p) => p.id === 'pro')?.subscribers).toBe(1);
  });
});
