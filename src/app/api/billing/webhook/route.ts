import { NextResponse } from 'next/server';
import { billing, applyWebhook } from '@/lib/billing/subscriptions';
import { BillingError } from '@/lib/billing/provider';

export const dynamic = 'force-dynamic';

/**
 * The Stripe webhook.
 *
 * ── The raw body, not the parsed one ────────────────────────────────────────
 *
 * `request.text()` and never `request.json()`. The signature is computed over
 * the exact bytes Stripe sent, so parsing and re-serialising — which changes
 * key order and whitespace — produces a different string and every signature
 * fails. That is a genuinely confusing hour the first time it happens.
 *
 * ── What each status code means to Stripe ───────────────────────────────────
 *
 * Stripe retries on anything that is not 2xx, for up to three days. So:
 *
 *   bad signature      400, and never retried — it was never ours
 *   already processed  200, because it succeeded the first time
 *   handler failed     500, so Stripe retries and we get another chance
 *
 * Returning 200 on a handler failure would lose the event permanently, which
 * for `invoice.paid` means someone paid and never got their credits.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  const payload = await request.text();

  let event;
  try {
    event = billing().verifyWebhook(payload, signature);
  } catch (cause) {
    /*
     * A failed verification is logged but not echoed back. The error says
     * exactly why the signature did not match, and handing that to whoever
     * sent it is a free oracle for forging one.
     */
    console.error(
      '[billing] webhook rejected:',
      cause instanceof BillingError ? cause.message : String(cause),
    );

    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const result = applyWebhook(event);

  if (!result.ok) {
    // 500 so Stripe retries. The event row records the failure either way.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
