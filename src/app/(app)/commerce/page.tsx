import { collectionPage } from '@/components/collections/page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Commerce' };

/** Products, orders and invoices from every map you own or share. */
export default function Page() {
  return collectionPage('commerce');
}
