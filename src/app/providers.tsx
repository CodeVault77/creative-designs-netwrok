'use client';

import type { ReactNode } from 'react';
import { StyledComponentsRegistry } from '@/lib/styles/StyledComponentsRegistry';
import { DensityProvider } from '@/lib/styles/DensityProvider';
import { GlobalStyle } from '@/lib/styles/GlobalStyle';
import { ToastProvider } from '@/components/ui/Toast';

/**
 * Single place where every client-side provider is composed.
 *
 * Order matters: the registry must wrap everything that emits styles, and
 * GlobalStyle must be inside DensityProvider so it can read the theme.
 *
 * Later phases add here rather than wrapping layout.tsx again:
 *   P3  map camera / selection store
 *   P6  auth session
 *   P11 realtime channel
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <StyledComponentsRegistry>
      <DensityProvider>
        <GlobalStyle />
        <ToastProvider>{children}</ToastProvider>
      </DensityProvider>
    </StyledComponentsRegistry>
  );
}
