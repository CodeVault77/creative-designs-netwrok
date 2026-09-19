'use client';

import { useState, type ReactNode } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { ServerStyleSheet, StyleSheetManager } from 'styled-components';

/**
 * styled-components + Next App Router SSR bridge.
 *
 * Without this, styles are only applied after hydration, which produces a
 * visible flash of unstyled content — fatal for a dark-themed product where
 * the unstyled state is white.
 *
 * How it works: on the server we collect rules into a sheet and hand them to
 * Next via useServerInsertedHTML, then clear the tag so rules are not emitted
 * twice during streaming. On the client the branch is skipped entirely and
 * styled-components manages the stylesheet itself.
 */
export function StyledComponentsRegistry({ children }: { children: ReactNode }) {
  // Lazily create the sheet once per request.
  const [styledComponentsStyleSheet] = useState(() => new ServerStyleSheet());

  useServerInsertedHTML(() => {
    const styles = styledComponentsStyleSheet.getStyleElement();
    styledComponentsStyleSheet.instance.clearTag();
    return <>{styles}</>;
  });

  if (typeof window !== 'undefined') return <>{children}</>;

  return (
    <StyleSheetManager sheet={styledComponentsStyleSheet.instance}>
      {children}
    </StyleSheetManager>
  );
}
