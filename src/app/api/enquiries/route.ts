import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { clientHash, listEnquiries, submitEnquiry } from '@/lib/services/enquiries';

export const dynamic = 'force-dynamic';

const schema = z.object({
  serviceSlug: z.string().max(60),
  name: z.string().max(120),
  email: z.string().max(200),
  company: z.string().max(160).optional(),
  budget: z.string().max(40).optional(),
  message: z.string().max(4000),
  /** The honeypot. Named plausibly so a bot fills it in. */
  website: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000).optional(),
});

/**
 * POST /api/enquiries — §20 P12's "first money path".
 *
 * Open to signed-out visitors by design: the entire purpose of this form is to
 * hear from people who do not have an account and may never want one. Putting
 * a sign-up in front of it would be the most expensive gate in the product.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the form' },
      { status: 400 },
    );
  }

  const session = await getSession();

  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || '0.0.0.0';
  const client = clientHash(ip, request.headers.get('user-agent') ?? '');

  const result = submitEnquiry(parsed.data, {
    clientHash: client,
    userId: session?.userId ?? null,
  });

  if (!result.ok) {
    // A rate limit and a validation error both come back as 400 with the
    // specific message. §08 screen 17: "Form submit failure preserves entries",
    // which the client does — so the message needs to say what to fix.
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  /**
   * The SAME response whether or not it was filed as spam.
   *
   * Telling a bot which message tripped the filter is how it learns to get
   * past it, and telling a misclassified person "your message looks like spam"
   * is worse than useless — they have no way to appeal and no idea what to
   * change. The message is stored either way and a human can look.
   */
  return NextResponse.json({ ok: true, id: result.id });
}

/**
 * GET — the business inbox.
 *
 * Staff only. Enquiries contain other people's names, email addresses and what
 * they are working on; the read side is the part that has to be locked, even
 * though the write side is deliberately open.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.isStaff) {
    // 404, not 403 — the same rule as everywhere else.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const search = new URL(request.url).searchParams;
  const status = search.get('status');
  const slug = search.get('service');

  return NextResponse.json({
    enquiries: listEnquiries({
      ...(status ? { status } : {}),
      ...(slug ? { serviceSlug: slug } : {}),
    }),
  });
}
