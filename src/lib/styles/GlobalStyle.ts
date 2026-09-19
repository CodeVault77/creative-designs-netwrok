'use client';

import { createGlobalStyle } from 'styled-components';
import { cssVariables } from './cssVars.generated';

/**
 * Global styles: token variables, reset, focus, reduced motion.
 *
 * Three rules here are load-bearing and must not be removed.
 *
 * 1. `cssVariables` injects all 95 generated tokens. Without it every
 *    `var(--…)` in the codebase silently resolves to nothing.
 * 2. `prefers-reduced-motion` is honoured globally (§16 requires this in P1).
 *    It covers CSS transitions and animations only — JS-driven animation must
 *    call `duration()` from motion.ts, which checks the same query.
 * 3. `:focus-visible` always shows a cyan ring. Focus is always cyan, never
 *    the family hue, so it can never be mistaken for family state.
 */
export const GlobalStyle = createGlobalStyle`
  ${cssVariables}

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  html {
    color-scheme: dark;
    -webkit-text-size-adjust: 100%;

    /*
     * Belt and braces against sideways scroll from ordinary overflowing
     * content. It does NOT constrain fixed-position descendants — clipping on
     * the root does not apply to them — so it is not what stops a closed Sheet
     * widening the page; Sheet unmounts itself for that.
     */
    overflow-x: clip;
  }

  body {
    margin: 0;
    min-height: 100dvh;
    background: var(--ground-background);
    color: var(--ground-ink);
    font-family: var(--face-body);
    font-size: var(--text-body);
    line-height: var(--leading-body);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: var(--face-display);
    line-height: var(--leading-display-m);
    margin: 0;
  }

  img,
  picture,
  video,
  canvas,
  svg {
    display: block;
    max-width: 100%;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
  }

  /* Tabular figures everywhere numbers are compared or counted. */
  [data-numeric] {
    font-family: var(--face-mono);
    font-variant-numeric: tabular-nums;
  }

  :focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-control);
  }

  /* Removing the outline is only acceptable when a component draws its own. */
  :focus:not(:focus-visible) {
    outline: none;
  }

  ::selection {
    background: var(--fam-discover-glow);
    color: var(--ground-canvas);
  }

  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: var(--ground-border);
    border-radius: var(--radius-pill);
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;
