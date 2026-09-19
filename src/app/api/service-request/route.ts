import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { clientHash, submitEnquiry } from '@/lib/services/enquiries';
import {
  budgetOptions,
  heardFromOptions,
  projectTypeOptions,
  serviceOptions,
  timelineOptions,
} from '@/config/services';

export const dynamic = 'force-dynamic';

/**
 * POST /api/service-request — the marketing service request (roadmap §9.2).
 *
 * Thin on purpose. Every hard part — spam scoring, rate limiting, writing the
 * row BEFORE queueing mail, and filing rather than discarding suspected spam —
 * lives in `submitEnquiry` and is already tested. This route validates, works
 * out who is asking, and delegates.
 */

/**
 * Enum values are derived from the config, not restated.
 *
 * A service switched off in `config/services.ts` disappears from the form and
 * stops being accepted here in the same edit. Two hand-maintained lists would
 * drift, and the drift would only surface as a rejected submission from a real
 * customer.
 */
const oneOf = (options: readonly { value: string }[]) =>
  z
    .string()
    .refine((value) => value === '' || options.some((o) => o.value === value), {
      message: 'Choose one of the listed options',
    });

const schema = z.object({
  name: z.string().max(120),
  email: z.string().max(200),
  phone: z.string().max(40).optional(),
  company: z.string().max(160).optional(),
  serviceSlug: oneOf(serviceOptions()),
  projectType: oneOf(projectTypeOptions).optional(),
  message: z.string().max(4000),
  budget: oneOf(budgetOptions).optional(),
  timeline: oneOf(timelineOptions).optional(),
  heardFrom: oneOf(heardFromOptions).optional(),
  /** Required, and checked on the server — see below. */
  consent: z.boolean(),
  /** Honeypot. */
  website: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000).optional(),
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    /**
     * The first issue, named. §9.2 requires errors specific enough to act on,
     * and the client keeps every value it had — so a generic "invalid form"
     * would leave someone re-reading nine fields to find the problem.
     */
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: issue?.message ?? 'Check the form',
        field: issue?.path[0] ?? null,
      },
      { status: 400 },
    );
  }

  /**
   * Consent, server-side.
   *
   * The checkbox is a UI affordance; this is the record. A consent gate that
   * exists only in the browser is not a consent gate.
   */
  if (!parsed.data.consent) {
    return NextResponse.json(
      { error: 'Please confirm you are happy for us to reply', field: 'consent' },
      { status: 400 },
    );
  }

  const session = await getSession();
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || '0.0.0.0';

  const result = submitEnquiry(
    {
      serviceSlug: parsed.data.serviceSlug || 'not-sure',
      name: parsed.data.name,
      email: parsed.data.email,
      message: parsed.data.message,
      consent: parsed.data.consent,
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.company !== undefined
        ? { company: parsed.data.company }
        : {}),
      ...(parsed.data.budget !== undefined ? { budget: parsed.data.budget } : {}),
      ...(parsed.data.projectType !== undefined
        ? { projectType: parsed.data.projectType }
        : {}),
      ...(parsed.data.timeline !== undefined
        ? { timeline: parsed.data.timeline }
        : {}),
      ...(parsed.data.heardFrom !== undefined
        ? { heardFrom: parsed.data.heardFrom }
        : {}),
      ...(parsed.data.website !== undefined
        ? { website: parsed.data.website }
        : {}),
      ...(parsed.data.elapsedMs !== undefined
        ? { elapsedMs: parsed.data.elapsedMs }
        : {}),
    },
    {
      clientHash: clientHash(ip, request.headers.get('user-agent') ?? ''),
      userId: session?.userId ?? null,
    },
  );

  if (!result.ok) {
    // A rate limit and a validation failure both surface as 400 with the
    // specific message, because the client preserves input either way.
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  /**
   * The same response whether or not it was filed as spam. Telling a bot which
   * message tripped the filter is how it learns to get past it, and telling a
   * misclassified person their enquiry looks like spam is worse than useless.
   */
  return NextResponse.json({ ok: true, id: result.id });
}
