import { css } from 'styled-components';
import { tokens } from './tokens.generated';

/**
 * Motion helpers.
 *
 * §16 requires reduced-motion support in P1, not P13. The global rule in
 * GlobalStyle catches CSS transitions and animations, but that is a blunt
 * instrument and it cannot help JavaScript-driven animation — the camera, the
 * expand stagger, and anything the canvas renderer does. Those must ask.
 *
 * Rule for the whole codebase: never read a duration from tokens directly in
 * animation code. Go through `duration()` or `prefersReducedMotion()` so the
 * reduced-motion path is impossible to forget.
 */

export type DurationName = keyof typeof tokens.motion.duration;
export type EasingName = keyof typeof tokens.motion.easing;

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the user has asked for reduced motion.
 *
 * Returns false during SSR and in environments without matchMedia. That is
 * the correct default: the first client render re-evaluates, and the global
 * CSS rule covers the gap for transitions.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_QUERY).matches;
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function onReducedMotionChange(
  handler: (reduced: boolean) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(REDUCED_QUERY);
  const listener = (event: MediaQueryListEvent) => handler(event.matches);
  mql.addEventListener('change', listener);
  return () => mql.removeEventListener('change', listener);
}

/**
 * Duration in milliseconds, collapsed to 0 when reduced motion is requested.
 * Use this for JS-driven animation — camera moves, expand staggers, canvas.
 */
export function duration(name: DurationName): number {
  if (prefersReducedMotion()) return 0;
  return parseFloat(tokens.motion.duration[name]);
}

/** Stagger between expanding children. 0 under reduced motion. */
export function stagger(): number {
  if (prefersReducedMotion()) return 0;
  return parseFloat(tokens.motion.stagger);
}

/**
 * A CSS transition that is automatically neutralised under reduced motion.
 *
 *   ${transition('selection', 'background-color', 'border-color')}
 */
export function transition(name: DurationName, ...properties: string[]) {
  const easingMap: Record<DurationName, EasingName> = {
    selection: 'selection',
    collapse: 'collapse',
    expand: 'expand',
    sheet: 'sheet',
    camera: 'camera',
    breathe: 'expand',
  };

  const props = properties.length > 0 ? properties : ['all'];
  const dur = tokens.motion.duration[name];
  const ease = tokens.motion.easing[easingMap[name]];

  return css`
    transition: ${props.map((p) => `${p} ${dur} ${ease}`).join(', ')};

    @media ${REDUCED_QUERY} {
      transition-duration: 0.01ms;
    }
  `;
}

/**
 * The root node's ambient breathe — the only ambient animation in the product
 * (§16). Stops entirely under reduced motion rather than merely speeding up,
 * because a fast pulse is worse than none.
 */
export const breathe = css`
  @keyframes cdn-breathe {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: ${1 - tokens.motion.breatheOpacityDelta};
    }
  }

  animation: cdn-breathe ${tokens.motion.duration.breathe} ease-in-out infinite;

  @media ${REDUCED_QUERY} {
    animation: none;
  }
`;

export const REDUCED_MOTION_QUERY = REDUCED_QUERY;
