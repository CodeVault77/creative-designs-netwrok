import { collectionPage } from '@/components/collections/page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Work' };

/**
 * Tasks and milestones from every map you own or share.
 *
 * The whole page is `collectionPage('work')` — see that helper for why three
 * destinations share one implementation.
 */
export default function Page() {
  return collectionPage('work');
}
