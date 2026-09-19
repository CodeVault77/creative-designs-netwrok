import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientHash } from '@/lib/services/enquiries';
import { subscribe } from '@/lib/marketing/newsletter';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().max(200),
  source: z.string().max(40).optional(),
  /** Honeypot. Named plausibly so a bot fills it in. */
  website: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000).optional(),
  consent: z.boolean(),
});

/**
 * POST /api/newsletter — launch updates (roadmap §18.2).
 *
 * Open to everyone: the whole point is to hear from people who have no account
 * and may never want one.
 *
 * The response is identical for a new subscriber, a duplicate and a filtered
 * submission. A caller cannot use this endpoint to discover whether an address
 * is on the list, and a bot learns nothing about which signal caught it.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Check that email address' },
      { status: 400 },
    );
  }

  // Consent is required and is checked on the SERVER. A client-side-only
  // consent gate is not a consent record.
  if (!parsed.data.consent) {
    return NextResponse.json(
      { error: 'Please agree to receive updates first' },
      { status: 400 },
    );
  }

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || '0.0.0.0';

  const result = subscribe({
    email: parsed.data.email,
    ...(parsed.data.source !== undefined ? { source: parsed.data.source } : {}),
    ...(parsed.data.website !== undefined ? { website: parsed.data.website } : {}),
    ...(parsed.data.elapsedMs !== undefined
      ? { elapsedMs: parsed.data.elapsedMs }
      : {}),
    clientHash: clientHash(ip, request.headers.get('user-agent') ?? ''),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
