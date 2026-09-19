'use client';

import type { ReactNode } from 'react';
import styled from 'styled-components';
import { MarketingHeader } from './MarketingHeader';
import { MarketingFooter } from './MarketingFooter';

/**
 * The marketing shell: skip link, header, main, footer.
 *
 * Deliberately thin. It exists so every marketing page gets the same chrome
 * and the same landmark structure without repeating it, and so the boundary
 * with the application shell is a single component rather than a convention.
 */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--ground-background);
  color: var(--ground-ink);
`;

const Main = styled.main`
  flex: 1;
`;

/**
 * The skip link (§21).
 *
 * Visually hidden until focused, then a real, visible target — a skip link
 * that stays invisible when focused is the same as not having one, and it is
 * the first thing a keyboard user meets on the page.
 */
const Skip = styled.a`
  position: absolute;
  left: var(--space-4);
  top: -100px;
  z-index: var(--z-menu);

  padding: var(--space-3) var(--space-4);
  background: var(--ground-raised);
  border: 1px solid var(--color-focus);
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  text-decoration: none;

  &:focus {
    top: var(--space-4);
  }
`;

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <Page>
      <Skip href="#main">Skip to content</Skip>
      <MarketingHeader />
      <Main id="main">{children}</Main>
      <MarketingFooter />
    </Page>
  );
}
