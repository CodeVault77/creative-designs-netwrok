'use client';

import Link from 'next/link';
import styled, { css } from 'styled-components';
import { NAV_ITEMS } from './navItems';
import { Icon } from './Icon';
import { transition } from '@/lib/styles/motion';
import type { TabId } from '@/lib/routes';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * Bottom tab bar — phone and tablet (§17).
 *
 * Sits at the bottom because the map occupies the whole viewport and the
 * thumb lives at the bottom of the phone. Every target is at least 88px tall
 * including its safe-area padding, per §17.
 */

const Bar = styled.nav`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-chrome);

  display: grid;
  grid-template-columns: repeat(${NAV_ITEMS.length}, 1fr);

  /* Translucent so the map keeps reading as continuous behind the chrome.
     The blur is what stops node glow bleeding through as mush. */
  background: rgba(7, 7, 12, 0.82);
  backdrop-filter: blur(16px);
  border-top: 1px solid var(--ground-border);
  padding-bottom: env(safe-area-inset-bottom, 0px);

  @supports not (backdrop-filter: blur(16px)) {
    background: var(--ground-background);
  }
`;

const Item = styled(Link)<{ $active: boolean; $family: FamilyName }>`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;

  min-height: 56px;
  padding: var(--space-2) var(--space-1) var(--space-3);

  text-decoration: none;
  -webkit-tap-highlight-color: transparent;

  color: ${({ $active, theme, $family }) =>
    $active ? theme.tokens.familyRamp[$family].core : 'var(--ground-muted)'};

  ${transition('selection', 'color')}

  &:hover {
    color: var(--ground-ink);
  }

  /* The active indicator: a lit bar at the top edge of the tab. Colour is
     never the only channel — the label also goes to medium weight and the
     icon switches to its filled variant. */
  ${({ $active, $family, theme }) =>
    $active &&
    css`
      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 24%;
        right: 24%;
        height: 2px;
        border-radius: var(--radius-pill);
        background: ${theme.tokens.familyRamp[$family].core};
        box-shadow: ${theme.tokens.glow[$family][1]};
      }
    `}
`;

const Label = styled.span<{ $active: boolean }>`
  font-family: var(--face-body);
  font-size: var(--text-caption);
  font-weight: ${({ theme, $active }) =>
    $active
      ? theme.tokens.typography.weight.medium
      : theme.tokens.typography.weight.regular};
  line-height: 1;
`;

export function TabBar({ activeTab }: { activeTab: TabId }) {
  return (
    <Bar aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const active = item.id === activeTab;
        return (
          <Item
            key={item.id}
            href={item.href}
            $active={active}
            $family={item.family}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon} size={22} active={active} />
            <Label $active={active}>{item.label}</Label>
          </Item>
        );
      })}
    </Bar>
  );
}

export const TAB_BAR_HEIGHT = 72;
