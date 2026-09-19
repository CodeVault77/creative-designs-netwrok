import { Chakra_Petch, Inter, IBM_Plex_Mono } from 'next/font/google';

/**
 * The three faces from §16, self-hosted by next/font.
 *
 * next/font downloads and serves these from our own origin at build time.
 * That matters for more than privacy: a render-blocking request to Google
 * Fonts sits directly in front of the 2.5s time-to-interactive-map budget,
 * and `display: swap` plus a preloaded local file avoids both the third-party
 * round trip and the layout shift a late-arriving face causes.
 *
 * Weights are pinned to exactly what the type scale uses. Every extra weight
 * is another file on the critical path.
 */

export const displayFont = Chakra_Petch({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-display',
});

export const bodyFont = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-body',
});

export const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
});

/** Applied to <html> so the variables are available everywhere. */
export const fontVariables = [
  displayFont.variable,
  bodyFont.variable,
  monoFont.variable,
].join(' ');
