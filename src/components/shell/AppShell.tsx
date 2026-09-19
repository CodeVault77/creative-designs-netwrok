'use client';

import { usePathname } from 'next/navigation';
import styled, { css } from 'styled-components';
import { TabBar, TAB_BAR_HEIGHT } from './TabBar';
import { NavRail, RAIL_WIDTH, railVariantFor } from './NavRail';
import { TopBar, type TopBarProps } from './TopBar';
import { useBreakpoint } from '@/lib/useBreakpoint';
import { activeTabFor, bleedsFor, chromeFor } from '@/lib/routes';
import type { BreakpointName } from '@/lib/styles/tokens.generated';

/**
 * The application shell.
 *
 * Decides, per §17, which chrome to render at each of the five breakpoints:
 *
 *   phone   <600      bottom tab bar + top bar (brand only)
 *   tablet  600–1023  bottom tab bar + top bar carrying actions
 *   desktop 1024–1599 left icon rail, no tab bar
 *   large   ≥1600     left rail expanded with labels
 *   board   ≥2400     rail bottom-anchored, within standing reach
 *
 * ── Why this branches in JS rather than in CSS ──────────────────────────────
 *
 * A tab bar and a rail are not one element restyled; they are different markup
 * with different semantics. Rendering both and hiding one with a media query
 * would put two <nav aria-label="Primary"> landmarks in the accessibility
 * tree, and a screen-reader user would hear every primary destination twice.
 * So exactly one is mounted.
 *
 * The cost is a first client render at the phone layout before the breakpoint
 * resolves. That is the right default — the phone chrome is the narrowest, so
 * the transient state is a slightly sparse desktop rather than a desktop
 * layout overflowing a phone.
 */

export interface AppShellProps {
  children: React.ReactNode;
  /**
   * Overrides the chrome mode. Normally derived from the pathname:
   *   full     tab bar or rail, plus top bar
   *   minimal  top bar only — the editor owns the viewport (§08 screen 09)
   *   none     no chrome at all — the entry transition (screen 01)
   */
  chrome?: 'full' | 'minimal' | 'none';
  topBar?: TopBarProps;
  /**
   * Suppresses main's padding for surfaces that paint edge to edge.
   * Defaults to `bleedsFor(pathname)` — the map and the editor.
   */
  bleed?: boolean;
}

const Root = styled.div<{ $railWidth: number }>`
  min-height: 100dvh;
  ${({ $railWidth }) =>
    $railWidth > 0 &&
    css`
      padding-left: ${$railWidth}px;
    `}
`;

const Main = styled.main<{ $tabBar: boolean; $bleed: boolean }>`
  /*
   * The map needs the full height minus chrome, and it needs to know that
   * height exactly — a canvas sized by a percentage of an auto-height parent
   * collapses. An explicit min-height with the chrome subtracted keeps it
   * honest.
   */
  min-height: ${({ $tabBar }) =>
    $tabBar
      ? `calc(100dvh - ${TAB_BAR_HEIGHT}px - env(safe-area-inset-bottom, 0px))`
      : '100dvh'};

  padding: ${({ $bleed }) => ($bleed ? '0' : 'var(--space-4)')};
  padding-bottom: ${({ $tabBar, $bleed }) =>
    $tabBar
      ? `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px) + ${$bleed ? '0px' : 'var(--space-4)'})`
      : $bleed
        ? '0'
        : 'var(--space-4)'};
`;

/**
 * Skip link. First focusable element on every page.
 *
 * On a map-first product this matters more than usual: without it, a keyboard
 * user tabs through every primary destination before reaching the content,
 * on every single navigation.
 */
const SkipLink = styled.a`
  position: absolute;
  left: var(--space-3);
  top: var(--space-3);
  z-index: var(--z-toast);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  background: var(--ground-surface);
  border: 1px solid var(--color-focus);
  color: var(--ground-ink);
  font-size: var(--text-label);
  text-decoration: none;

  /* Off-screen until focused, rather than display:none, which would make it
     unfocusable and therefore useless. */
  transform: translateY(-200%);

  &:focus-visible {
    transform: translateY(0);
  }
`;

function railWidthFor(breakpoint: BreakpointName, chrome: string): number {
  if (chrome !== 'full') return 0;
  if (breakpoint === 'phone' || breakpoint === 'tablet') return 0;
  return RAIL_WIDTH[railVariantFor(breakpoint)];
}

export function AppShell({ children, chrome, topBar, bleed }: AppShellProps) {
  const pathname = usePathname();
  const breakpoint = useBreakpoint();

  const mode = chrome ?? chromeFor(pathname);
  const bleeds = bleed ?? bleedsFor(pathname);
  const activeTab = activeTabFor(pathname);

  const isRailLayout =
    breakpoint === 'desktop' || breakpoint === 'large' || breakpoint === 'board';

  const showRail = mode === 'full' && isRailLayout;
  const showTabBar = mode === 'full' && !isRailLayout;
  const showTopBar = mode !== 'none';

  if (mode === 'none') {
    return <>{children}</>;
  }

  return (
    <Root $railWidth={railWidthFor(breakpoint, mode)}>
      <SkipLink href="#main">Skip to content</SkipLink>

      {showRail && (
        <NavRail activeTab={activeTab} variant={railVariantFor(breakpoint)} />
      )}

      {showTopBar && (
        <TopBar
          // The rail already shows the brand; repeating it wastes the row.
          showBrand={!showRail}
          // Tablet has no rail, so the top bar carries the secondary actions
          // (§17: "bottom bar + top actions").
          /*
           * Search is in the top bar at EVERY width, as the design canvas has
           * it. Restricting it to tablet meant a phone had the icon nowhere in
           * the chrome — reachable only by leaving the screen for the Search
           * tab, which is a round trip when you are mid-map.
           */
          showSearch
          showNotifications={breakpoint === 'tablet' || isRailLayout}
          /*
           * The overflow menu is the phone's stand-in for the rail: without it
           * Settings, Notifications, the Watcher feed and Link-to-Mind-Map are
           * unreachable on a phone, because §06 caps the tab bar at four.
           */
          showMenu={!showRail}
          {...topBar}
        />
      )}

      <Main id="main" $tabBar={showTabBar} $bleed={bleeds} tabIndex={-1}>
        {children}
      </Main>

      {showTabBar && <TabBar activeTab={activeTab} />}
    </Root>
  );
}
