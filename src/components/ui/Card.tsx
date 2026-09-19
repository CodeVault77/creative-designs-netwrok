'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { FamilyName } from '@/lib/styles/tokens.generated';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Shows the family dot top-left. */
  family?: FamilyName;
  /** Adds hover treatment and pointer cursor. Provide onClick or href yourself. */
  interactive?: boolean;
  selected?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  as?: 'div' | 'article' | 'li';
}

/**
 * §16: "Cards are the calm surface. Glow belongs to the map."
 *
 * No glow, no drop shadow — a card separates from the background by its
 * surface step (#0D0E17 over #07070C) and a hairline border. This is the rule
 * most likely to be violated later: a glowing card looks impressive in
 * isolation and turns a list into noise.
 */
const Root = styled.div<{ $interactive: boolean; $selected: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);

  padding: var(--space-4);
  background: var(--ground-surface);
  border: 1px solid
    ${({ $selected, theme }) =>
      $selected
        ? theme.tokens.familyRamp[theme.family].core
        : 'var(--ground-border)'};
  border-radius: var(--radius-card);
  box-shadow: var(--elev-card);

  ${transition('selection', 'border-color', 'background-color')}

  ${({ $interactive }) =>
    $interactive &&
    css`
      cursor: pointer;

      &:hover {
        border-color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
        background: rgba(255, 255, 255, 0.02);
      }

      &:focus-within {
        border-color: var(--color-focus);
      }
    `}
`;

const Dot = styled.span<{ $family: FamilyName }>`
  position: absolute;
  top: var(--space-4);
  left: var(--space-4);
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
`;

const Header = styled.div<{ $inset: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-left: ${({ $inset }) => ($inset ? 'var(--space-4)' : '0')};
  font-family: var(--face-display);
  font-size: var(--text-title);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
  color: var(--ground-ink);
`;

const Body = styled.div`
  color: var(--ground-muted);
  font-size: var(--text-body);
  line-height: var(--leading-body);
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--ground-border);
`;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    family,
    interactive = false,
    selected = false,
    header,
    footer,
    children,
    as = 'div',
    ...rest
  },
  ref,
) {
  return (
    <Root
      ref={ref}
      as={as}
      $interactive={interactive}
      $selected={selected}
      aria-current={selected || undefined}
      {...rest}
    >
      {family && <Dot $family={family} aria-hidden="true" />}
      {header && <Header $inset={Boolean(family)}>{header}</Header>}
      {children && <Body>{children}</Body>}
      {footer && <Footer>{footer}</Footer>}
    </Root>
  );
});
