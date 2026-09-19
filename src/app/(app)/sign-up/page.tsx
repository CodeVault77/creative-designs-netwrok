import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { AuthForm } from '@/components/account';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create an account' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  if (await getSession()) {
    redirect(returnTo && returnTo.startsWith('/') ? returnTo : routes.maps);
  }

  return <AuthForm mode="sign-up" {...(returnTo ? { returnTo } : {})} />;
}
