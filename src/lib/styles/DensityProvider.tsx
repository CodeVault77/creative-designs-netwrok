'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider } from 'styled-components';
import { makeTheme, defaultTheme, type AppTheme } from './theme';
import { tokens, type Density, type FamilyName } from './tokens.generated';

const POINTER_QUERY = `(min-width: ${tokens.breakpoint.desktop.min}px) and (pointer: fine)`;

/**
 * Chooses the control set: `touch` (48px controls, 88px hit targets) or
 * `pointer` (40px / 44px). §17.
 *
 * The query tests width AND pointer type, not width alone. A 1280px-wide
 * touchscreen laptop should keep touch-sized targets; width by itself gets
 * that wrong, and the failure mode — controls too small to hit — is the one
 * that matters.
 *
 * SSR renders `touch`, the safer default: oversized controls on a desktop are
 * a cosmetic flaw for one frame, undersized ones on a phone are unusable.
 */
export function DensityProvider({
  children,
  density: forced,
  family = 'discover',
}: {
  children: ReactNode;
  /** Overrides the media query. For Storybook, tests, and deliberate overrides. */
  density?: Density;
  family?: FamilyName;
}) {
  const [detected, setDetected] = useState<Density>('touch');

  useEffect(() => {
    if (forced) return;
    if (typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(POINTER_QUERY);
    const apply = (matches: boolean) => setDetected(matches ? 'pointer' : 'touch');

    apply(mql.matches);
    const listener = (event: MediaQueryListEvent) => apply(event.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, [forced]);

  const theme: AppTheme = useMemo(
    () => makeTheme({ density: forced ?? detected, family }),
    [forced, detected, family],
  );

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

/**
 * Themes a subtree to a family hue without changing density.
 * Used wherever a panel or card belongs to a family.
 */
export function FamilyProvider({
  family,
  children,
}: {
  family: FamilyName;
  children: ReactNode;
}) {
  return (
    <ThemeProvider
      // Falls back to the default theme when there is no parent provider,
      // so a FamilyProvider used standalone (in a test, or in Storybook)
      // still renders rather than throwing on an undefined theme.
      theme={(parent) => ({ ...(parent ?? defaultTheme), family })}
    >
      {children}
    </ThemeProvider>
  );
}

export { POINTER_QUERY };
