import { routes, type TabId } from '@/lib/routes';
import type { IconName } from './Icon';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The four primary destinations (§06).
 *
 * TabBar and NavRail both render from this list, so the phone and desktop
 * navigations cannot drift apart — the classic failure where a tab is added
 * on mobile and quietly missing on desktop for a release.
 *
 * Four, not five. §06 fixed it at four; a fifth tab means one of these is not
 * primary, and that is a scope conversation rather than a layout tweak.
 */
export interface NavItem {
  id: TabId;
  label: string;
  href: string;
  icon: IconName;
  /** Tints the active indicator. Ties each destination to a family hue. */
  family: FamilyName;
  /** Signed-out users see it, but it will bounce them to sign-in. */
  requiresAuth: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'map',
    label: 'Map',
    href: routes.map,
    icon: 'map',
    family: 'discover',
    requiresAuth: false,
  },
  {
    id: 'search',
    label: 'Search',
    href: routes.search,
    icon: 'search',
    family: 'discover',
    requiresAuth: false,
  },
  {
    id: 'maps',
    label: 'My Maps',
    href: routes.maps,
    icon: 'maps',
    family: 'create',
    requiresAuth: true,
  },
  {
    id: 'you',
    label: 'You',
    href: routes.you,
    icon: 'you',
    family: 'people',
    requiresAuth: true,
  },
] as const;
