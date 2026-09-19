import type { SVGProps } from 'react';

/**
 * The shell icon set.
 *
 * Inline SVG rather than an icon package: the whole set is under 2 KB, it
 * costs no extra request in front of the 2.5s time-to-interactive-map budget,
 * and every glyph inherits `currentColor` so the family and state treatments
 * work without per-icon overrides.
 *
 * Drawn on a 24-grid with a 1.6 stroke to sit alongside Chakra Petch without
 * looking heavier than the type.
 */

export type IconName =
  | 'map'
  | 'search'
  | 'maps'
  | 'you'
  | 'bell'
  | 'menu'
  | 'plus'
  | 'chevronLeft'
  | 'settings'
  | 'shield'
  | 'tree'
  | 'infinity';

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
  /** Filled variant for the active tab — the second channel beside colour. */
  active?: boolean;
};

const paths: Record<IconName, (active: boolean) => React.ReactNode> = {
  // Concentric rings — the product's own metaphor, not a generic house.
  map: (active) => (
    <>
      <circle cx="12" cy="12" r="2.5" fill={active ? 'currentColor' : 'none'} />
      <circle cx="12" cy="12" r="6.5" opacity={active ? 1 : 0.75} />
      <circle cx="12" cy="12" r="10" opacity={active ? 0.6 : 0.35} />
    </>
  ),
  search: () => (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" strokeLinecap="round" />
    </>
  ),
  maps: (active) => (
    <>
      <rect
        x="3"
        y="4"
        width="7.5"
        height="7.5"
        rx="1.5"
        fill={active ? 'currentColor' : 'none'}
      />
      <rect x="13.5" y="4" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="12.5" width="7.5" height="7.5" rx="1.5" />
      <rect
        x="13.5"
        y="12.5"
        width="7.5"
        height="7.5"
        rx="1.5"
        fill={active ? 'currentColor' : 'none'}
      />
    </>
  ),
  you: (active) => (
    <>
      <circle cx="12" cy="8" r="4" fill={active ? 'currentColor' : 'none'} />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
    </>
  ),
  bell: (active) => (
    <>
      <path
        d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"
        fill={active ? 'currentColor' : 'none'}
        strokeLinejoin="round"
      />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
    </>
  ),
  menu: () => (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </>
  ),
  plus: () => (
    <>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </>
  ),
  chevronLeft: () => (
    <>
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  settings: () => (
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"
        strokeLinecap="round"
      />
    </>
  ),
  shield: () => (
    <>
      <path
        d="M12 3 19 5.8v5.4c0 4.4-3 7.9-7 9.3-4-1.4-7-4.9-7-9.3V5.8L12 3Z"
        strokeLinejoin="round"
      />
    </>
  ),
  tree: () => (
    <>
      <path d="M4 6h5M4 12h9M4 18h13" strokeLinecap="round" />
      <circle cx="19" cy="6" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  // The CDN mark, reduced to something legible at 24px.
  infinity: () => (
    <>
      <path
        d="M8 12c0-2.2-1.3-3.5-3-3.5S2 9.8 2 12s1.3 3.5 3 3.5S8 14.2 8 12Zm0 0c0 2.2 1.6 3.5 3.5 3.5S15 14.2 15 12s-1.6-3.5-3.5-3.5S8 9.8 8 12Zm7 0c0-2.2 1.3-3.5 3-3.5s3 1.3 3 3.5-1.3 3.5-3 3.5-3-1.3-3-3.5Z"
        strokeLinejoin="round"
      />
    </>
  ),
};

export function Icon({ name, size = 24, active = false, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      // Icons here are always paired with a text label or an aria-label on the
      // control, so the glyph itself is decorative.
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name](active)}
    </svg>
  );
}
