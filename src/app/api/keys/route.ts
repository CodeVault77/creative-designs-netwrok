import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { issueKey, listKeys, revokeKey } from '@/lib/api/keys';
import { ALL_SCOPES, isScope, SCOPES, type Scope } from '@/lib/api/scopes';

export const dynamic = 'force-dynamic';

/**
 * Managing your own API keys.
 *
 * ── Session-authenticated, unlike everything it creates ─────────────────────
 *
 * This route is application surface, not public API. Minting a credential must
 * require a person present in a browser — a key that could mint more keys
 * would make revoking one meaningless, because the compromised key would
 * simply issue itself another.
 */

const createSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string()).min(1).max(ALL_SCOPES.length),
  /** ISO timestamp. Optional, recommended. */
  expiresAt: z.string().max(40).nullable().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const ctx = { userId: session.userId, isStaff: session.isStaff };

  return NextResponse.json({
    keys: listKeys(ctx),
    // The catalogue of scopes, so the form renders exactly what the server
    // enforces rather than a hand-kept copy that drifts.
    scopes: SCOPES,
  });
}

export async function POST(request: Request) {
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

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the form' }, { status: 400 });
  }

  const scopes = parsed.data.scopes.filter((value): value is Scope =>
    isScope(value),
  );

  if (scopes.length === 0) {
    return NextResponse.json(
      { error: 'Choose at least one permission' },
      { status: 400 },
    );
  }

  const result = issueKey(
    { userId: session.userId, isStaff: session.isStaff },
    {
      name: parsed.data.name,
      scopes,
      expiresAt: parsed.data.expiresAt ?? null,
    },
  );

  if (!result.ok || !result.issued) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    key: result.issued.key,
    /*
     * The only time this value exists outside the client's own storage.
     *
     * It is not recoverable, and the UI must say so before the user navigates
     * away. Returning it on a later GET would mean the database held something
     * that could be read back, which is the property hashing removed.
     */
    secret: result.issued.secret,
  });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const keyId = new URL(request.url).searchParams.get('id') ?? '';
  const result = revokeKey(
    { userId: session.userId, isStaff: session.isStaff },
    keyId,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({
    keys: listKeys({ userId: session.userId, isStaff: session.isStaff }),
  });
}
