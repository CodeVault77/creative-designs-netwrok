import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { communityMap } from '@/lib/map/seed';
import { dedupeKey, getInterestStore } from '@/lib/interest/store';
import { visitorHashFrom } from '@/lib/interest/visitor';

export const dynamic = 'force-dynamic';

/**
 * Interest capture — the mechanism ADR-0001's whole bet rests on.
 *
 * Deliberately open to signed-out visitors. Requiring an account before
 * someone can say "I want this" would collect the opinions of people who
 * already committed and discard everyone else's, which inverts the signal we
 * are trying to read. Email is optional, for the same reason.
 */

const bodySchema = z.object({
  nodeId: z.string().min(1).max(128),
  /** Optional — supplying it opts into being told when the feature ships. */
  email: z.string().email().max(320).optional(),
});

/** Crude per-process limiter. P13 replaces it with a shared one. */
const recent = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(key, hits);
  return hits.length > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request',
        issues: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 },
    );
  }

  const { nodeId, email } = parsed.data;

  // The node must exist AND actually be Coming Soon. Without this check the
  // endpoint is an open counter anyone can inflate for any string, and the
  // build-order data becomes worthless.
  const node = communityMap().nodes.get(nodeId);
  if (!node) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (node.status !== 'coming_soon') {
    return NextResponse.json(
      { error: 'That node is already live' },
      { status: 409 },
    );
  }

  const session = await getSession();
  const visitorHash = session ? null : visitorHashFrom(request.headers);
  const key = dedupeKey({ userId: session?.userId ?? null, visitorHash });

  if (rateLimited(key)) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const store = getInterestStore();
  const created = await store.register({
    nodeId,
    userId: session?.userId ?? null,
    visitorHash,
    email: email ?? null,
    createdAt: new Date().toISOString(),
  });

  const count = await store.countFor(nodeId);

  // 200 either way. A duplicate is not an error from the user's point of
  // view — they already asked, and telling them so is friendlier than a 409
  // they cannot act on. `created` lets the client tell the two apart.
  return NextResponse.json({ created, count });
}

/** Lets the Coming Soon screen show whether this viewer already registered. */
export async function GET(request: Request) {
  const nodeId = new URL(request.url).searchParams.get('nodeId');
  if (!nodeId) {
    return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });
  }

  const session = await getSession();
  const visitorHash = session ? null : visitorHashFrom(request.headers);
  const key = dedupeKey({ userId: session?.userId ?? null, visitorHash });

  const store = getInterestStore();
  return NextResponse.json({
    count: await store.countFor(nodeId),
    registered: await store.hasRegistered(nodeId, key),
  });
}
