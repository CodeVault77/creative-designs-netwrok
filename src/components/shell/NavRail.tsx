'use client';

import Link from 'next/link';
import styled, { css } from 'styled-components';
import { NAV_ITEMS } from './navItems';
import { Icon } from './Icon';
import { transition } from '@/lib/styles/motion';
import { routes, type TabId } from '@/lib/routes';
import type { FamilyName, BreakpointName } from '@/lib/styles/tokens.generated';

/**
 * Left icon rail — desktop and above (§17).
 *
 * Three variants from one component, because they differ only in width and
 * anchoring:
 *   desktop (1024–1599)  icons only, 72px, top-anchored
 *   large   (≥1600)      icons + labels, 208px, top-anchored
 *   board   (≥2400)      icons + labels, BOTTOM-anchored — someone standing at
 *                        a wall-mounted screen cannot reach the top of it
 */

export type RailVariant = 'compact' | 'expanded' | 'board';

export function railVariantFor(breakpoint: BreakpointName): RailVariant {
  if (breakpoint === 'board') return 'board';
  if (breakpoint === 'large') return 'expanded';
  return 'compact';
}

const Rail = styled.nav<{ $variant: RailVariant }>`
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: var(--z-chrome);

  display: flex;
  flex-direction: column;
  gap: var(--space-2);

  width: ${({ $variant }) => ($variant === 'compact' ? '72px' : '208px')};
  padding: var(--space-4) var(--space-3);

  background: var(--ground-background);
  border-right: 1px solid var(--ground-border);

  /* Board: push the items to the bottom so they sit within arm's reach of
     someone standing at a large wall display. */
  justify-content: ${({ $variant }) => ($variant === 'board' ? 'flex-end' : 'flex-start')};
`;

const Brand = styled(Link)<{ $variant: RailVariant }>`
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  margin-bottom: var(--space-4);
  color: var(--ground-ink);
  text-decoration: none;
  justify-content: ${({ $variant }) => ($variant === 'compact' ? 'center' : 'flex-start')};

  /* On a board the brand belongs above the items, which are bottom-anchored. */
  ${({ $variant }) =>
    $variant === 'board' &&
    css`
      margin-top: auto;
    `}
`;

const Wordmark = styled.span`
  font-family: var(--face-display);
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.bold};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
`;

const Item = styled(Link)<{
  $active: boolean;
  $family: FamilyName;
  $variant: RailVariant;
}>`
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);

  height: 48px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-control);

  text-decoration: none;
  justify-content: ${({ $variant }) => ($variant === 'compact' ? 'center' : 'flex-start')};

  color: ${({ $active, theme, $family }) =>
    $active ? theme.tokens.familyRamp[$family].core : 'var(--ground-muted)'};

  ${transition('selection', 'color', 'background-color')}

  &:hover {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.04);
  }

  ${({ $active, $family, theme }) =>
    $active &&
    css`
      background: ${theme.tokens.familyRamp[$family].wash};

      /* Vertical lit bar on the leading edge — the rail equivalent of the
         tab bar's top bar. */
      &::before {
        content: '';
        position: absolute;
        left: -12px;
        top: 12px;
        bottom: 12px;
        width: 2px;
        border-radius: var(--radius-pill);
        background: ${theme.tokens.familyRamp[$family].core};
        box-shadow: ${theme.tokens.glow[$family][1]};
      }
    `}
`;

const Label = styled.span<{ $active: boolean }>`
  font-family: var(--face-body);
  font-size: var(--text-label);
  font-weight: ${({ theme, $active }) =>
    $active
      ? theme.tokens.typography.weight.medium
      : theme.tokens.typography.weight.regular};
  white-space: nowrap;
`;

export function NavRail({
  activeTab,
  variant,
}: {
  activeTab: TabId;
  variant: RailVariant;
}) {
  const showLabels = variant !== 'compact';

  return (
    <Rail $variant={variant} aria-label="Primary">
      <Brand
        href={routes.map}
        $variant={variant}
        aria-label="Creative Design Networks"
      >
        <Icon name="infinity" size={24} />
        {showLabels && <Wordmark>Creative Design Networks</Wordmark>}
      </Brand>

      {NAV_ITEMS.map((item) => {
        const active = item.id === activeTab;
        return (
          <Item
            key={item.id}
            href={item.href}
            $active={active}
            $family={item.family}
            $variant={variant}
            aria-current={active ? 'page' : undefined}
            // Compact rail has no visible label, so the icon-only control
            // needs its own accessible name and a tooltip for sighted users.
            aria-label={showLabels ? undefined : item.label}
            title={showLabels ? undefined : item.label}
          >
            <Icon name={item.icon} size={22} active={active} />
            {showLabels && <Label $active={active}>{item.label}</Label>}
          </Item>
        );
      })}
    </Rail>
  );
}

export const RAIL_WIDTH = { compact: 72, expanded: 208, board: 208 } as const;
