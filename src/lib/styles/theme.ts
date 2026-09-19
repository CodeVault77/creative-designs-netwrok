import { tokens, type FamilyName, type Density } from './tokens.generated';

/**
 * The styled-components theme.
 *
 * Thin by design: it is the generated tokens plus the two things that vary at
 * runtime and therefore cannot be baked into a static token file — the current
 * control density, and the family a subtree is themed to.
 *
 * Anything genuinely static belongs in design/tokens.json, not here.
 */
export interface AppTheme {
  readonly tokens: typeof tokens;

  /**
   * Which control set is active. `touch` below 1024px, `pointer` at and above.
   * Set by DensityProvider from a media query, overridable per subtree — a
   * dense toolbar on a tablet is a legitimate override.
   */
  readonly density: Density;

  /**
   * Family accent for this subtree. Components that carry a hue (Button
   * primary, Chip, FamilyDot, focus wash) read it from here rather than
   * taking a prop at every level.
   */
  readonly family: FamilyName;
}

export const defaultTheme: AppTheme = {
  tokens,
  density: 'touch',
  family: 'discover',
};

export function makeTheme(overrides: Partial<AppTheme> = {}): AppTheme {
  return { ...defaultTheme, ...overrides };
}

/** Current control set — `theme.tokens.control[theme.density]`, shortened. */
export function control(theme: AppTheme) {
  return theme.tokens.control[theme.density];
}

/** Family ramp for this subtree, or an explicitly named family. */
export function ramp(theme: AppTheme, family?: FamilyName) {
  return theme.tokens.familyRamp[family ?? theme.family];
}

/** DOM box-shadow for a glow level in this subtree's family. */
export function glow(theme: AppTheme, level: 0 | 1 | 2 | 3, family?: FamilyName) {
  return theme.tokens.glow[family ?? theme.family][level];
}

export { tokens };
export type { FamilyName, Density };
