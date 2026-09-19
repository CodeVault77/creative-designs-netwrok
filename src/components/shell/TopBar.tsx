'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styled, { css } from 'styled-components';
import { Icon } from './Icon';
import { LogoMark } from '@/components/brand/LogoMark';
import { MenuDrawer } from './MenuDrawer';
import { transition } from '@/lib/styles/motion';
import { routes } from '@/lib/routes';

/**
 * Top bar — logo, title, and the actions that are not primary destinations.
 *
 * Search and notifications live here rather than in the tab bar because §06
 * gives the tab bar exactly four slots. On phone the top bar carries the
 * brand; on tablet it also carries the actions that the rail would otherwise
 * hold (§17: "bottom bar + top actions").
 */

export interface TopBarProps {
  /** Replaces the wordmark with a title and a back button. */
  title?: string;
  /** Shows a back control. Uses history when no explicit href is given. */
  backHref?: string;
  showBack?: boolean;
  showSearch?: boolean;
  showNotifications?: boolean;
  /** Unread count. Renders a dot, and a number once we have real data. */
  unreadCount?: number;
  /** Hides the brand when a rail is already showing it. */
  showBrand?: boolean;
  /**
   * The overflow menu (design canvas: the hamburger beside search).
   *
   * Phone only in practice — the rail already lists these destinations, so
   * showing it alongside a rail would be two doors to one room.
   */
  showMenu?: boolean;
  /** Staff-only rows inside the menu. */
  isStaff?: boolean;
  actions?: React.ReactNode;
}

const Bar = styled.header`
  position: sticky;
  top: 0;
  z-index: var(--z-chrome);

  display: flex;
  align-items: center;
  gap: var(--space-2);

  height: 56px;
  padding: 0 var(--space-3);
  padding-top: env(safe-area-inset-top, 0px);

  background: rgba(7, 7, 12, 0.82);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--ground-border);

  @supports not (backdrop-filter: blur(16px)) {
    background: var(--ground-background);
  }
`;

const Brand = styled(Link)`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ground-ink);
  text-decoration: none;
  min-width: 0;

  /*
   * The mark keeps its size while the row is squeezed.
   *
   * An SVG in a flex row is shrinkable like anything else, and at 320px it
   * collapsed to an illegible two-pixel smudge beside a wordmark that was
   * still perfectly readable. Width and height attributes do not prevent
   * that — only refusing to shrink does.
   */
  svg {
    flex-shrink: 0;
  }
`;

const Wordmark = styled.span`
  font-family: var(--face-display);
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.bold};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--ground-ink);

  /*
   * NETWORKS carries a blue-to-violet gradient, as in the brand lockup.
   *
   * One accent word rather than three: the full three-colour treatment is the
   * ENTRY and marketing lockup, where it is the largest thing on screen. At
   * 13px in a chrome bar three hues read as noise, so only the last word is
   * tinted — and it takes the gradient rather than a flat violet so it matches
   * the mark sitting next to it.
   */
  em {
    font-style: normal;
    background: linear-gradient(
      90deg,
      #2e7bf6 0%,
      #6366f1 45%,
      var(--fam-organise-core) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;

    /*
     * A gradient clipped to text is invisible where background-clip: text is
     * unsupported — transparent text on a transparent background, which loses
     * the last word of the company name rather than degrading it. The flat
     * violet is the fallback, and it is why the colour is set again here
     * rather than only above.
     */
    @supports not ((-webkit-background-clip: text) or (background-clip: text)) {
      background: none;
      color: var(--fam-organise-core);
    }
  }

  /*
   * Two steps down, and only then away.
   *
   * This used to disappear below 380px, which took the name off every common
   * phone — 360, 375 and 390 are the widths most people actually hold, and
   * all three have room for the full lockup.
   *
   * Below 340px they do not: the mark, the wordmark and two 44px touch
   * targets exceed the viewport, and the measured result was NETWORKS running
   * underneath the search icon. So the wordmark steps down a size first, and
   * is dropped only where it would otherwise collide. The mark alone still
   * links home.
   */
  @media (max-width: 380px) {
    font-size: var(--text-caption);
    letter-spacing: 0.06em;
  }

  @media (max-width: 340px) {
    display: none;
  }
`;

const Title = styled.h1`
  flex: 1;
  min-width: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Spacer = styled.div`
  flex: 1;
`;

/**
 * Shared between the <button> and <Link> forms.
 *
 * styled-components v6 removed `withComponent`, and `styled(Action)` on a
 * styled.button would render a <button> inside an <a>. Extracting the rules
 * into a css block keeps one definition and two correct elements.
 */
const actionStyles = css`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  width: ${({ theme }) => theme.tokens.control[theme.density].iconButton};
  height: ${({ theme }) => theme.tokens.control[theme.density].iconButton};

  background: none;
  border: none;
  border-radius: var(--radius-control);
  color: var(--ground-muted);
  cursor: pointer;
  text-decoration: none;

  ${transition('selection', 'color', 'background-color')}

  &:hover {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.04);
  }
`;

const Action = styled.button`
  ${actionStyles}
`;

const ActionLink = styled(Link)`
  ${actionStyles}
`;

/** A dot rather than a number: exact counts invite compulsive checking. */
const UnreadDot = styled.span`
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: var(--fam-people-core);
  box-shadow: 0 0 0 2px var(--ground-background);
`;

export function TopBar({
  title,
  backHref,
  showBack = false,
  showSearch = false,
  showNotifications = false,
  showMenu = false,
  isStaff = false,
  unreadCount = 0,
  showBrand = true,
  actions,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  return (
    <Bar>
      {showBack &&
        (backHref ? (
          <ActionLink href={backHref} aria-label="Back">
            <Icon name="chevronLeft" size={22} />
          </ActionLink>
        ) : (
          <Action onClick={() => router.back()} aria-label="Back">
            <Icon name="chevronLeft" size={22} />
          </Action>
        ))}

      {showBrand && !title && (
        <Brand href={routes.map} aria-label="Creative Design Networks — home">
          {/*
           * The real brand mark, not the generic `infinity` glyph this used
           * to draw. That glyph is a monochrome stroke path which inherited
           * the bar's ink colour, so the one place the logo appears on every
           * app screen was the one place it was not the logo.
           *
           * No glow at this size: LogoMark's own note is that the filter pass
           * reads as blur rather than emission below hero size.
           */}
          <LogoMark size={20} glow={false} />
          <Wordmark>
            Creative Design <em>Networks</em>
          </Wordmark>
        </Brand>
      )}

      {title ? <Title>{title}</Title> : <Spacer />}

      {actions}

      {showSearch && (
        <ActionLink href={routes.search} aria-label="Search">
          <Icon name="search" size={22} />
        </ActionLink>
      )}

      {showMenu && (
        <Action onClick={() => setMenuOpen(true)} aria-label="Menu">
          <Icon name="menu" size={22} />
        </Action>
      )}

      {showMenu && (
        <MenuDrawer
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          isStaff={isStaff}
        />
      )}

      {showNotifications && (
        <ActionLink
          href={routes.notifications}
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
        >
          <Icon name="bell" size={22} />
          {unreadCount > 0 && <UnreadDot />}
        </ActionLink>
      )}
    </Bar>
  );
}

export const TOP_BAR_HEIGHT = 56;
