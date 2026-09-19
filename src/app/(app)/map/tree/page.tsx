import { CommunityMapScreen } from '@/components/map/CommunityMapScreen';

export const metadata = { title: 'Tree view' };

/**
 * Screen 04 — the tree view.
 *
 * Its own route so it can be linked, bookmarked and set as a default by
 * someone who always wants it, rather than being a mode that resets on every
 * navigation. Same component, different initial view.
 */
export default function Page() {
  return <CommunityMapScreen initialView="tree" />;
}
