'use client';

import { useEffect, useState } from 'react';
import { tokens, type BreakpointName } from '@/lib/styles/tokens.generated';

/**
 * Current breakpoint, per §17's five bands.
 *
 * Returns 'phone' during SSR and on the first client render. That default is
 * chosen on purpose: the phone layout is the narrowest, so a one-frame
 * mismatch degrades to a slightly cramped desktop rather than a desktop
 * layout overflowing a phone.
 *
 * Prefer CSS media queries wherever a layout can be expressed in CSS. Use this
 * hook only when the DIFFERENCE IS STRUCTURAL — a tab bar versus a rail is
 * different markup with different semantics, not one element restyled, and
 * rendering both and hiding one leaves duplicate landmarks in the
 * accessibility tree.
 */

const ORDER: readonly BreakpointName[] = [
  'phone',
  'tablet',
  'desktop',
  'large',
  'board',
] as const;

function resolve(width: number): BreakpointName {
  // Walk downward so the widest matching band wins.
  for (let i = ORDER.length - 1; i >= 0; i--) {
    const name = ORDER[i]!;
    if (width >= tokens.breakpoint[name].min) return name;
  }
  return 'phone';
}

export function useBreakpoint(): BreakpointName {
  const [breakpoint, setBreakpoint] = useState<BreakpointName>('phone');

  useEffect(() => {
    const update = () => setBreakpoint(resolve(window.innerWidth));

    update();
    window.addEventListener('resize', update, { passive: true });
    // Rotating a tablet changes the band without firing resize in some browsers.
    window.addEventListener('orientationchange', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return breakpoint;
}

/** True at desktop and above — where the rail replaces the tab bar. */
export function useIsRailLayout(): boolean {
  const breakpoint = useBreakpoint();
  return (
    breakpoint === 'desktop' || breakpoint === 'large' || breakpoint === 'board'
  );
}

export { resolve as resolveBreakpoint, ORDER as BREAKPOINT_ORDER };
