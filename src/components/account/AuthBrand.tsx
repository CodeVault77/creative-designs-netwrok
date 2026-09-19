'use client';

import styled from 'styled-components';
import { BRAND_MARK } from '@/lib/map/icons';

/**
 * The brand moment on the authentication screens.
 *
 * A REDUCED version of screen 01's ring, not a copy of it. The entry screen's
 * ring is 286px and carries the three-colour wordmark and the tagline, because
 * there it IS the screen. Here the form is the screen, so the ring drops to
 * 128px and holds the mark alone — enough to say which product this is,
 * without competing with the field a thumb is heading for.
 *
 * The full lockup returns once, on the success frame, where it is the only
 * thing on screen and the user has nothing left to do.
 *
 * The sweep is built from the six family hues in token order rather than from
 * hand-picked stops, so it cannot drift from the map's root ring, which is
 * drawn from the same set (renderer.ts, drawRootRing).
 */

const FAMILY_SWEEP = [
  'var(--fam-create-core)',
  'var(--fam-discover-core)',
  'var(--fam-services-core)',
  'var(--fam-people-core)',
  'var(--fam-organise-core)',
  'var(--fam-commerce-core)',
].join(', ');

const Ring = styled.div<{ $size: number }>`
  position: relative;
  flex: none;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: var(--radius-circle);

  /* from -160deg puts the create/lime join at the top, matching slot 0. */
  background: conic-gradient(from -160deg, ${FAMILY_SWEEP}, var(--fam-create-core));
  box-shadow: ${({ theme }) => theme.tokens.glow.organise[2]};
`;

const Well = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: var(--radius-circle);

  /* The same off-centre highlight the renderer paints, so the disc reads as a
     lit sphere rather than a hole punched in the ring. */
  background: radial-gradient(circle at 50% 40%, #0a0a14, var(--ground-canvas) 76%);
`;

const Lockup = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 64px;
  flex: none;
`;

const Wordmark = styled.span`
  font-family: var(--face-display);
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.bold};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--ground-ink);

  /* One accent word, as TopBar has it. The three-colour lockup is the entry
     and marketing treatment; at this size it would shout. */
  em {
    font-style: normal;
    color: var(--fam-organise-core);
  }
`;

/**
 * The mark itself, stroked with `BRAND_MARK`'s gradient.
 *
 * Drawn from BRAND_MARK rather than from the public SVG file so the auth
 * screens, the map centre and the canvas renderer all stroke the same path
 * data from one source. `gradientUnits="userSpaceOnUse"` with `x1`/`x2` set to
 * the same 0–width span as the `viewBox` is what the map's canvas version
 * got wrong — its transform and its gradient disagreed about which
 * coordinate space "0 to width" meant. SVG has no such gap here: this
 * gradient and this `<path>` read the same viewBox by construction.
 */
export function BrandMark({ width = 44 }: { width?: number }) {
  const height = (width * BRAND_MARK.height) / BRAND_MARK.width;
  const gradientId = 'cdn-auth-mark';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${BRAND_MARK.width} ${BRAND_MARK.height}`}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2={BRAND_MARK.width}
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          {BRAND_MARK.stops.map((stop) => (
            <stop key={stop.at} offset={stop.at} stopColor={stop.color} />
          ))}
        </linearGradient>
      </defs>
      <g
        stroke={`url(#${gradientId})`}
        strokeWidth={(1.8 * BRAND_MARK.width) / width}
        strokeLinecap="round"
      >
        {BRAND_MARK.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

/** Mark + wordmark. The authentication header, in place of the app's TopBar. */
export function AuthHeader() {
  return (
    <Lockup>
      <BrandMark width={44} />
      <Wordmark>
        Creative Design <em>Networks</em>
      </Wordmark>
    </Lockup>
  );
}

/** The reduced ring. `size` is the outer diameter. */
export function AuthRing({ size = 128 }: { size?: number }) {
  return (
    <Ring $size={size} aria-hidden="true">
      <Well>
        <BrandMark width={size * 0.59} />
      </Well>
    </Ring>
  );
}
