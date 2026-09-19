import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BillingError,
  type BillingProvider,
  type CheckoutSession,
  type PortalSession,
  type VerifiedEvent,
} from './provider';

/**
 * Stripe, over its REST API.
 *
 * ── Why no SDK ──────────────────────────────────────────────────────────────
 *
 * Four endpoints and one signature check. The official SDK is a large
 * dependency carrying every product Stripe sells, and this uses none of them.
 * `fetch` with form encoding is the whole integration, and it is injectable,
 * which is what makes the billing tests run without a network.
 *
 * If this grows past a handful of calls the SDK becomes the right answer. It
 * is not yet.
 */

const API = 'https://api.stripe.com/v1';

/**
 * Stripe wants application/x-www-form-urlencoded, with nested keys written as
 * `a[b]`. Not JSON — sending JSON gets a 400 with a message that does not
 * mention the encoding, which is a confusing half hour the first time.
 */
function form(fields: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

export interface StripeOptions {
  apiKey: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
  /** Injectable so a signature test is not a clock test. */
  now?: () => number;
}

export class StripeProvider implements BillingProvider {
  readonly id = 'stripe';

  constructor(private readonly options: StripeOptions) {}

  isConfigured(): boolean {
    return this.options.apiKey.length > 0;
  }

  private async request(
    path: string,
    body: Record<string, string | number | undefined>,
  ): Promise<Record<string, unknown>> {
    if (!this.isConfigured()) {
      throw new BillingError('unconfigured', 'Payments are not configured.');
    }

    const doFetch = this.options.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(`${API}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form(body),
      });
    } catch (cause) {
      throw new BillingError(
        'unavailable',
        'Could not reach the payment provider.',
        cause instanceof Error ? cause.message : String(cause),
      );
    }

    // 429 and 5xx are transient; a 4xx is a request we got wrong and retrying
    // it produces the same answer while looking like flakiness.
    if (response.status === 429 || response.status >= 500) {
      throw new BillingError(
        'unavailable',
        'The payment provider is busy.',
        `HTTP ${response.status}`,
      );
    }

    if (!response.ok) {
      throw new BillingError(
        'refused',
        'That payment request was refused.',
        `HTTP ${response.status}`,
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }

  async ensureCustomer(input: {
    userId: string;
    email: string;
  }): Promise<{ customerId: string }> {
    const created = await this.request('/customers', {
      email: input.email,
      // The link back to our user, readable in the Stripe dashboard. Support
      // questions arrive as "this customer says…", and this is what turns that
      // into a row we can find.
      'metadata[user_id]': input.userId,
    });

    return { customerId: String(created.id) };
  }

  async createCheckout(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const session = await this.request('/checkout/sessions', {
      customer: input.customerId,
      mode: 'subscription',
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': 1,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });

    return {
      url: String(session.url),
      sessionId: String(session.id),
    };
  }

  async createPortal(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<PortalSession> {
    const session = await this.request('/billing_portal/sessions', {
      customer: input.customerId,
      return_url: input.returnUrl,
    });

    return { url: String(session.url) };
  }

  /**
   * Verify a webhook signature.
   *
   * ── Three things this must do, and why each matters ─────────────────────────
   *
   *   1. Recompute the HMAC over `timestamp.payload`, not over the payload
   *      alone. Signing only the body lets an attacker replay a real, correctly
   *      signed event forever.
   *   2. Compare in constant time. A byte-by-byte early exit leaks the expected
   *      signature one character at a time to anyone who can measure it.
   *   3. Reject an old timestamp. Even a genuine event replayed a week later is
   *      an attack — "this invoice was paid" is a claim about now.
   *
   * Implemented here rather than taken from the SDK because it is fifteen lines
   * and it is the single most security-sensitive function in the billing code:
   * everything downstream trusts whatever this returns.
   */
  verifyWebhook(payload: string, signature: string): VerifiedEvent {
    if (!this.options.webhookSecret) {
      throw new BillingError('unconfigured', 'No webhook secret is configured.');
    }

    // Stripe-Signature looks like: t=1614556800,v1=abc...,v1=def...
    const parts = new Map<string, string[]>();
    for (const piece of signature.split(',')) {
      const [key, value] = piece.split('=');
      if (!key || !value) continue;
      parts.set(key.trim(), [...(parts.get(key.trim()) ?? []), value.trim()]);
    }

    const timestamp = parts.get('t')?.[0];
    const signatures = parts.get('v1') ?? [];

    if (!timestamp || signatures.length === 0) {
      throw new BillingError('refused', 'That webhook signature is malformed.');
    }

    const expected = createHmac('sha256', this.options.webhookSecret)
      .update(`${timestamp}.${payload}`, 'utf8')
      .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'hex');

    /*
     * Several v1 signatures can be present during a secret rotation, and any
     * one matching is enough. `timingSafeEqual` throws on a length mismatch,
     * so the length is checked first — and a wrong length is a wrong signature
     * regardless.
     */
    const matches = signatures.some((candidate) => {
      const candidateBuffer = Buffer.from(candidate, 'hex');
      if (candidateBuffer.length !== expectedBuffer.length) return false;
      return timingSafeEqual(candidateBuffer, expectedBuffer);
    });

    if (!matches) {
      throw new BillingError('refused', 'That webhook signature is not valid.');
    }

    const now = (this.options.now ?? Date.now)();
    const ageSeconds = Math.abs(now / 1000 - Number(timestamp));

    // Five minutes, Stripe's own recommendation. Wide enough for clock skew,
    // narrow enough that a captured request is not useful tomorrow.
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
      throw new BillingError('refused', 'That webhook is too old.');
    }

    let parsed: { id?: unknown; type?: unknown; data?: unknown };
    try {
      parsed = JSON.parse(payload) as typeof parsed;
    } catch {
      throw new BillingError('refused', 'That webhook body is not JSON.');
    }

    if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
      throw new BillingError('refused', 'That webhook is missing an id or type.');
    }

    return {
      id: parsed.id,
      type: parsed.type,
      data: (parsed.data ?? {}) as Record<string, unknown>,
    };
  }
}
