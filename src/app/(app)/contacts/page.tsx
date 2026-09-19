import { collectionPage } from '@/components/collections/page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contacts' };

/** Contacts and deals from every map you own or share. */
export default function Page() {
  return collectionPage('contacts');
}
