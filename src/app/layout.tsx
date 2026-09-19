import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { ErrorReporter } from '@/components/shell/ErrorReporter';
import { fontVariables } from '@/lib/styles/fonts';
import { clientEnv } from '@/lib/env';

export const metadata: Metadata = {
  metadataBase: new URL(clientEnv.NEXT_PUBLIC_SITE_URL),
  title: {
    default: 'Creative Design Networks',
    template: '%s · Creative Design Networks',
  },
  description:
    'A spatial browser. Destinations, tools, people and your own notes on a map you can learn.',
  applicationName: 'Creative Design Networks',

  /*
   * Installable, without a native shell.
   *
   * Phase 8 asks for "mobile shells over the existing responsive web". A PWA
   * IS that shell for most of what a shell is for: an icon on the home
   * screen, a standalone window with no browser chrome, and offline capability
   * through the sync layer. It ships with the web deploy, needs no review
   * queue, and cannot fall behind the web version.
   *
   * What it does not give you is a listing in an app store, push
   * notifications on iOS below 16.4, or any native API. Those need Capacitor
   * wrapping this same build — which is a packaging job on top of this, not an
   * alternative to it. See ADR-0012.
   */
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'CDN',
    // 'default' rather than 'black-translucent': translucent puts content
    // under the status bar, and the map's top controls end up beneath the
    // clock.
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  // The map canvas manages its own zoom; page-level pinch-zoom fights it.
  // userScalable stays true — disabling it is an accessibility failure, and
  // §09 suppresses the browser default on the canvas element only.
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#07070C',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /**
   * `fontVariables` MUST be on <html>.
   *
   * It carries --font-display/body/mono from next/font, and every face token
   * is written as `var(--font-display), 'Chakra Petch', ...`. A custom
   * property whose value references an undefined var is invalid at
   * computed-value time and resolves to the empty string — so leaving this
   * off does not fall back to Chakra Petch, it silently blanks --face-display
   * and every element in the app renders in the browser's default serif.
   */
  return (
    <html lang="en" className={fontVariables}>
      <body>
        {/*
          Mounted at the root so it is listening before any screen renders. It
          draws nothing — it only attaches the window error listeners that make
          `/api/errors` reachable, which it never was before.
        */}
        <ErrorReporter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
