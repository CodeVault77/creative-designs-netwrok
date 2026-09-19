/**
 * Marketing navigation.
 *
 * Every Phase 1 destination is listed NOW with `enabled: false`. That is the
 * mechanism behind the migration promise in roadmap §28: turning on About or
 * Projects later is a boolean, not a restructure, and the sitemap picks them
 * up automatically because it is generated from this list.
 *
 * Disabled entries are never rendered and never appear in the sitemap — an
 * entry here is an intention, not a live link.
 */

export interface NavItem {
  label: string;
  href: string;
  enabled: boolean;
  /** External links open in a new tab and are excluded from the sitemap. */
  external?: boolean;
}

/**
 * Header navigation. Deliberately short — four items is what fits on a phone
 * beside a logo, and a header that needs a hamburger on desktop is a header
 * that is doing too much.
 */
export const headerNav: readonly NavItem[] = [
  { label: 'What is CDN', href: '/#what', enabled: true },
  { label: 'Services', href: '/services', enabled: true },
  { label: 'Contact', href: '/contact', enabled: true },

  // ---- Phase 1. Present so the switch is a flag, not a refactor. ----
  { label: 'About', href: '/about', enabled: false },
  { label: 'Projects', href: '/projects', enabled: false },
  { label: 'Solutions', href: '/solutions', enabled: false },
  { label: 'Resources', href: '/resources', enabled: false },
  { label: 'Pricing', href: '/pricing', enabled: false },
];

export const footerNav: readonly { title: string; items: readonly NavItem[] }[] = [
  {
    title: 'Company',
    items: [
      { label: 'What is CDN', href: '/#what', enabled: true },
      { label: 'Services', href: '/services', enabled: true },
      { label: 'About', href: '/about', enabled: false },
      { label: 'Projects', href: '/projects', enabled: false },
    ],
  },
  {
    title: 'Get in touch',
    items: [
      { label: 'Contact', href: '/contact', enabled: true },
      { label: 'Request a project', href: '/request', enabled: true },
      /**
       * OPEN DECISION OD-11. The roadmap recommends a footer link rather than
       * a landing-page section — present for anyone looking, not competing
       * with the two CTAs that matter.
       */
      { label: 'Partners & investors', href: '/contact#partners', enabled: true },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Privacy', href: '/privacy', enabled: true },
      { label: 'Terms', href: '/terms', enabled: true },
    ],
  },
];

/**
 * Social links. Empty by default — OPEN DECISION.
 *
 * An empty array renders nothing at all, which is correct. A row of icons
 * linking to accounts that do not exist is worse than no row.
 */
export const socialLinks: readonly NavItem[] = [];

export const enabled = (items: readonly NavItem[]): NavItem[] =>
  items.filter((item) => item.enabled);
