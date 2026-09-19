/**
 * The payments provider interface.
 *
 * ── We are not a payment processor ──────────────────────────────────────────
 *
 * Nothing in this codebase sees a card number, a CVC or an expiry. Checkout
 * happens on Stripe's hosted page, the customer portal is Stripe's, and the
 * invoice a user opens is a Stripe URL. That is not laziness — handling card
 * data pulls the entire application into PCI scope, and the correct amount of
 * card data to hold is none.
 *
 * ── Why an interface at all ─────────────────────────────────────────────────
 *
 * The same argument as `lib/ai/provider.ts`. Billing logic — granting credits,
 * summing a ledger, deciding whether someone is over their allowance — must be
 * testable without a network, and it is the logic most expensive to get wrong.
 * A fake provider in a test is the only way to exercise "the subscription
 * lapsed mid-month" without waiting a month.
 */

export type BillingFailure =
  /** Network, 5xx, or a rate limit. Worth retrying. */
  | 'unavailable'
  /** Stripe rejected the request. Retrying will not help. */
  | 'refused'
  /** No API key, so this environment cannot take payments at all. */
  | 'unconfigured';

export class BillingError extends Error {
  constructor(
    readonly kind: BillingFailure,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }

  get retryable(): boolean {
    return this.kind === 'unavailable';
  }
}

export interface CheckoutSession {
  /** Where to send the browser. A Stripe-hosted page. */
  url: string;
  sessionId: string;
}

export interface PortalSession {
  url: string;
}

/**
 * A webhook Stripe sent us, once its signature has been checked.
 *
 * `verified` is not optional and not defaulted. An unverified webhook body is
 * attacker-controlled input that claims someone paid — the type makes it
 * impossible to hand one to the handler by forgetting a step.
 */
export interface VerifiedEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface BillingProvider {
  readonly id: string;

  isConfigured(): boolean;

  /** Create or reuse the Stripe customer for a user. */
  ensureCustomer(input: {
    userId: string;
    email: string;
  }): Promise<{ customerId: string }>;

  /** A hosted checkout page for a plan. */
  createCheckout(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;

  /** The hosted page where someone manages or cancels their own subscription. */
  createPortal(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<PortalSession>;

  /**
   * Check a webhook signature and parse the body.
   *
   * Throws rather than returning null on a bad signature. A caller that
   * forgets to check a return value would otherwise process a forged event,
   * and this is the one place where failing loudly is unambiguously right.
   */
  verifyWebhook(payload: string, signature: string): VerifiedEvent;
}

/**
 * A provider for environments with no Stripe key.
 *
 * Every method throws `unconfigured`. Local development and CI must not need
 * payment credentials to run, and the alternative — silently pretending a
 * checkout succeeded — would make a broken configuration look like a working
 * one until money was involved.
 */
export class UnconfiguredBilling implements BillingProvider {
  readonly id = 'unconfigured';

  isConfigured(): boolean {
    return false;
  }

  private fail(): never {
    throw new BillingError(
      'unconfigured',
      'Payments are not configured in this environment.',
    );
  }

  async ensureCustomer(): Promise<{ customerId: string }> {
    this.fail();
  }

  async createCheckout(): Promise<CheckoutSession> {
    this.fail();
  }

  async createPortal(): Promise<PortalSession> {
    this.fail();
  }

  verifyWebhook(): VerifiedEvent {
    this.fail();
  }
}
