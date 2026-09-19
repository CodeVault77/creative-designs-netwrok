/**
 * The CDN logo MARK.
 *
 * Lives in `brand/` rather than `marketing/` because it is not marketing's:
 * the entry screen, the app chrome and the marketing header all draw the same
 * mark, and a second copy is a second thing to fix when the artwork changes.
 *
 * Deliberately NOT a client component. It is pure SVG with no hooks, no state
 * and no styled-components, so it can render inside a server component — which
 * screen 01 needs, because its whole job is to be on screen before any
 * JavaScript has run.
 *
 * The wordmark stays in `marketing/Logo.tsx`: it is styled text with a layout
 * that differs per surface, and it is the part that legitimately varies.
 *
 * The file at `/brand/logo-mark.svg` is the same artwork, for the favicon, the
 * OG image and anywhere outside React.
 */

const ids = {
  gradient: 'cdn-logo-gradient',
  glow: 'cdn-logo-glow',
  path: 'cdn-logo-path',
};

export interface LogoMarkProps {
  /** Rendered height in px. Width follows the 2:1 aspect ratio. */
  size?: number;
  /**
   * The glow costs a filter pass. Worth it at hero size, wasted at 24px in a
   * footer where it reads as blur rather than emission.
   */
  glow?: boolean;
  className?: string;
}

export function LogoMark({ size = 32, glow = true, className }: LogoMarkProps) {
  return (
    <svg
      className={className}
      width={size * 2}
      height={size}
      viewBox="0 0 240 120"
      fill="none"
      /*
       * Decorative here: every place this is used pairs it with the wordmark
       * or a visible link label, so announcing it again would make a screen
       * reader say the company name twice.
       */
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={ids.gradient} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2E7BF6" />
          <stop offset="18%" stopColor="#2FD9F5" />
          <stop offset="42%" stopColor="#8B5CF6" />
          <stop offset="56%" stopColor="#FF4D97" />
          <stop offset="80%" stopColor="#FF8A3D" />
          <stop offset="100%" stopColor="#FF3D2E" />
        </linearGradient>

        {glow && (
          <filter id={ids.glow} x="-25%" y="-45%" width="150%" height="190%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}

        <path
          id={ids.path}
          d="M120,60 C105,29 85,14 62,14 C33,14 11,34 11,60 C11,86 33,106 62,106
             C85,106 105,91 120,60 C135,29 155,14 178,14 C207,14 229,34 229,60
             C229,86 207,106 178,106 C155,106 135,91 120,60 Z"
        />
      </defs>

      <g
        {...(glow ? { filter: `url(#${ids.glow})` } : {})}
        fill="none"
        stroke={`url(#${ids.gradient})`}
        strokeLinecap="round"
      >
        <use href={`#${ids.path}`} strokeWidth={9} />
        <use
          href={`#${ids.path}`}
          strokeWidth={2}
          opacity={0.75}
          transform="translate(120 60) scale(0.82) translate(-120 -60)"
        />
      </g>

      <g
        fill={`url(#${ids.gradient})`}
        {...(glow ? { filter: `url(#${ids.glow})` } : {})}
      >
        <circle cx="62" cy="14" r="4.5" />
        <circle cx="20" cy="33" r="3.5" />
        <circle cx="11" cy="60" r="4.5" />
        <circle cx="20" cy="87" r="3.5" />
        <circle cx="62" cy="106" r="4.5" />
        <circle cx="97" cy="31" r="3" />
        <circle cx="120" cy="60" r="4" />
        <circle cx="143" cy="31" r="3" />
        <circle cx="178" cy="14" r="4.5" />
        <circle cx="220" cy="33" r="3.5" />
        <circle cx="229" cy="60" r="4.5" />
        <circle cx="220" cy="87" r="3.5" />
        <circle cx="178" cy="106" r="4.5" />
      </g>
    </svg>
  );
}
