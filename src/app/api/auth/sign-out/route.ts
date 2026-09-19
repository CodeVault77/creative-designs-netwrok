import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * POST, never GET.
 *
 * A GET sign-out can be triggered by any image tag or link prefetch on any
 * site, which signs people out at random and reads as the app being broken.
 */
export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
