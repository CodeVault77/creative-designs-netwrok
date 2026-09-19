import { NextResponse } from 'next/server';
import { signUp, signUpSchema } from '@/lib/auth/accounts';
import { track } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = signUpSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'Check the form', field: issue?.path[0] },
      { status: 400 },
    );
  }

  const result = await signUp(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, field: result.field },
      { status: 409 },
    );
  }

  track('account_signed_up', { method: 'email' });

  return NextResponse.json({
    id: result.user!.id,
    handle: result.user!.handle,
    displayName: result.user!.displayName,
  });
}
