import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { AuthForm } from '@/components/account';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  // Already signed in: go where they were heading rather than showing a form
  // for something they have already done.
  if (await getSession()) {
    redirect(returnTo && returnTo.startsWith('/') ? returnTo : routes.maps);
  }

  return <AuthForm mode="sign-in" {...(returnTo ? { returnTo } : {})} />;
}
