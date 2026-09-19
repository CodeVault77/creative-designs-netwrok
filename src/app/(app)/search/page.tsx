import { SearchScreen } from '@/components/search';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search' };

/**
 * Screens 05 and 06 — one route.
 *
 * A query turns the search screen into the results screen; they share the
 * field, the filters and the recent chips. Splitting them would remount the
 * field on every submit and lose the cursor.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <SearchScreen initialQuery={q ?? ''} />;
}
