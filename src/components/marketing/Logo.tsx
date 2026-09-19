'use client';

import styled from 'styled-components';
import { LogoMark } from '@/components/brand/LogoMark';

/**
 * The mark itself now lives in `@/components/brand/LogoMark` so the app's
 * entry screen can render it from a server component. Re-exported here
 * because every existing import in the marketing surface points at this file.
 */
export { LogoMark } from '@/components/brand/LogoMark';
export type { LogoMarkProps } from '@/components/brand/LogoMark';

/**
 * The CDN logo.
 *
 * ── Why the mark is inline SVG and the wordmark is HTML ─────────────────────
 *
 * The mark is inlined rather than loaded from `/brand/logo-mark.svg` so the
 * header and hero cost no extra request and nothing shifts while a logo
 * arrives — CLS on the largest element of the page is the easiest layout
 * shift to avoid and the most embarrassing to ship.
 *
 * The WORDMARK is HTML text, not SVG text, for three reasons: SVG `<text>`
 * needs the font to be present or it silently substitutes; real text is
 * selectable and readable by a screen reader without an `aria-label` standing
 * in for it; and it inherits the display face already loaded for the rest of
 * the page. The reference artwork sets the three words in three colours, which
 * is exactly what three spans do.
 *
 * The file at `/brand/logo-mark.svg` is the same artwork and exists for the
 * favicon, the OG image and anywhere outside React.
 */

// ------------------------------------------------------------------ wordmark

const Lockup = styled.span<{ $stacked: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-direction: ${({ $stacked }) => ($stacked ? 'column' : 'row')};
`;

const Words = styled.span<{ $stacked: boolean }>`
  display: flex;
  flex-direction: ${({ $stacked }) => ($stacked ? 'column' : 'row')};
  gap: ${({ $stacked }) => ($stacked ? '0' : '0.34em')};
  align-items: ${({ $stacked }) => ($stacked ? 'center' : 'baseline')};

  font-family: var(--face-display);
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: ${({ $stacked }) => ($stacked ? '1.06' : '1')};
  text-transform: uppercase;
  white-space: nowrap;
`;

/**
 * The three words carry the three anchor hues from the mark.
 *
 * These are brand colours on a near-black ground at display weight and size,
 * which is where they pass contrast comfortably. They are NEVER used for body
 * copy — that stays `--ground-ink`, which is the rule that keeps the palette
 * accessible (roadmap §11.1).
 */
const Creative = styled.span`
  color: #2fd9f5;
`;
const Design = styled.span`
  color: #8b5cf6;
`;
const Networks = styled.span`
  color: #ff8a3d;
`;

export interface LogoProps {
  size?: number;
  /** Stacked is the hero treatment; inline is the header and footer. */
  stacked?: boolean;
  glow?: boolean;
  /** Hides the words, leaving the mark. Used under ~400px. */
  markOnly?: boolean;
  className?: string;
}

export function Logo({
  size = 28,
  stacked = false,
  glow = true,
  markOnly = false,
  className,
}: LogoProps) {
  return (
    <Lockup $stacked={stacked} className={className}>
      <LogoMark size={size} glow={glow} />

      {!markOnly && (
        /*
         * One accessible name for the whole lockup. Without this a screen
         * reader reads "CREATIVE DESIGN NETWORKS" as three separate runs,
         * and with the mark also labelled it would say the name twice.
         */
        <Words
          $stacked={stacked}
          aria-label="Creative Design Networks"
          role="img"
          /*
           * The header hides this below 400px via `.cdn-words`, where the
           * lockup plus a menu button does not fit. A CSS hook rather than a
           * `markOnly` prop driven by a media query in JS: the latter needs a
           * matchMedia listener and renders the wrong thing until it runs,
           * which is a hydration mismatch on the most visible element of the
           * page.
           */
          className="cdn-words"
        >
          <Creative aria-hidden="true" style={{ fontSize: size * 0.62 }}>
            Creative
          </Creative>
          <Design aria-hidden="true" style={{ fontSize: size * 0.62 }}>
            Design
          </Design>
          <Networks aria-hidden="true" style={{ fontSize: size * 0.62 }}>
            Networks
          </Networks>
        </Words>
      )}
    </Lockup>
  );
}
