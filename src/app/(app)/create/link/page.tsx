import { LinkScreen } from '@/components/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Link to Mind Map' };

/**
 * Screen 14 — Link-to-Mind-Map (§12).
 *
 * §12 step 1 gives three entries — ring node 2, the editor toolbar and the
 * search empty state — all landing here. `url` lets the search empty state
 * hand over an address the user already typed, and `from` records which entry
 * was used so the analytics in §03 can tell them apart.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; from?: string }>;
}) {
  const { url, from } = await searchParams;

  const entrySource =
    from === 'editor' || from === 'search_empty' ? from : 'ring_node';

  return <LinkScreen initialUrl={url ?? ''} entrySource={entrySource} />;
}
