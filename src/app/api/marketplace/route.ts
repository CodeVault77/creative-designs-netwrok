import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import {
  browse,
  createListing,
  listingReviewQueue,
  listingsBy,
  order,
  ordersFor,
  rate,
  reviewListing,
  reviewsFor,
  submitListing,
  updateListing,
} from '@/lib/marketplace/repo';
import { allKinds, isListingKind } from '@/lib/marketplace/kinds';
import { ensureCatalogues } from '@/lib/marketplace/catalogues';

export const dynamic = 'force-dynamic';

/**
 * The marketplace, for the application's own screens.
 *
 * The public, key-authenticated read lives at `/api/v1/marketplace`. This one
 * is session-authenticated because everything below the catalogue — listing,
 * ordering, rating — is somebody acting as themselves.
 */

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    kind: z.string().max(20),
    title: z.string().min(2).max(120),
    targetId: z.string().min(1).max(80),
    summary: z.string().max(200).optional(),
    description: z.string().max(8000).optional(),
    priceCents: z.number().int().min(0).max(100_000_00).optional(),
    slug: z.string().max(60).optional(),
  }),
  z.object({
    action: z.literal('update'),
    listingId: z.string().max(80),
    title: z.string().max(120).optional(),
    summary: z.string().max(200).optional(),
    description: z.string().max(8000).optional(),
    priceCents: z.number().int().min(0).max(100_000_00).optional(),
  }),
  z.object({ action: z.literal('submit'), listingId: z.string().max(80) }),
  z.object({
    action: z.literal('review'),
    listingId: z.string().max(80),
    decision: z.enum(['published', 'draft', 'suspended']),
    note: z.string().max(500).default(''),
  }),
  z.object({ action: z.literal('order'), listingId: z.string().max(80) }),
  z.object({
    action: z.literal('rate'),
    listingId: z.string().max(80),
    rating: z.number().int().min(1).max(5),
    body: z.string().max(2000).optional(),
  }),
]);

export async function GET(request: Request) {
  ensureCatalogues();

  const session = await getSession();
  const params = new URL(request.url).searchParams;
  const kindParam = params.get('kind');
  const listingId = params.get('listing');

  const ctx = {
    userId: session?.userId ?? '',
    isStaff: session?.isStaff ?? false,
  };

  return NextResponse.json({
    catalogues: allKinds().map((adapter) => ({
      kind: adapter.kind,
      label: adapter.label,
      blurb: adapter.blurb,
    })),
    listings: browse({
      kind: kindParam && isListingKind(kindParam) ? kindParam : undefined,
      query: params.get('q') ?? undefined,
    }),
    // Reviews are public: they are the thing a buyer reads before ordering.
    reviews: listingId ? reviewsFor(listingId) : [],
    mine: session ? listingsBy(ctx) : [],
    orders: session ? ordersFor(ctx) : [],
    reviewQueue: session?.isStaff ? listingReviewQueue(ctx) : [],
  });
}

export async function POST(request: Request) {
  ensureCatalogues();

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the request' }, { status: 400 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const input = parsed.data;

  switch (input.action) {
    case 'create': {
      const result = createListing(ctx, input);
      return result.ok
        ? NextResponse.json({ listing: result.listing })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }

    case 'update': {
      const result = updateListing(ctx, input.listingId, input);
      return result.ok
        ? NextResponse.json({ listing: result.listing })
        : NextResponse.json({ error: result.error }, { status: 404 });
    }

    case 'submit': {
      const result = submitListing(ctx, input.listingId);
      return result.ok
        ? NextResponse.json({ listing: result.listing })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }

    case 'review': {
      if (!session.isStaff) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const result = reviewListing(
        ctx,
        input.listingId,
        input.decision,
        input.note,
      );
      return result.ok
        ? NextResponse.json({ listing: result.listing })
        : NextResponse.json({ error: result.error }, { status: 404 });
    }

    case 'order': {
      const result = order(ctx, input.listingId);

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      /*
       * A pending order means a paid listing awaiting payment, not a failure.
       * The status is returned so the screen can say "checkout next" rather
       * than "done" — the difference between the two is what the buyer sees.
       */
      return NextResponse.json({ order: result.order });
    }

    case 'rate': {
      const result = rate(ctx, input.listingId, input);
      return result.ok
        ? NextResponse.json({ reviews: reviewsFor(input.listingId) })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }
  }
}
