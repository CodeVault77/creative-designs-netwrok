'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { FamilyName } from '@/lib/styles/tokens.generated';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  family?: FamilyName;
  /** Renders a family dot before the label. */
  showDot?: boolean;
  iconStart?: ReactNode;
  count?: number;
  /** Static label rather than a toggle — renders as a span, not a button. */
  readOnly?: boolean;
}

const Root = styled.button<{ $selected: boolean; $family?: FamilyName }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);

  height: 32px;
  padding: 0 var(--space-3);

  font-family: var(--face-body);
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  line-height: 1;
  white-space: nowrap;

  border-radius: var(--radius-chip);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  ${transition('selection', 'background-color', 'border-color', 'color')}

  ${({ $selected, $family, theme }) => {
    const family = $family ?? theme.family;
    const fam = theme.tokens.familyRamp[family];
    return $selected
      ? css`
          background: ${fam.wash};
          border: 1px solid ${fam.core};
          color: var(--ground-ink);
        `
      : css`
          background: transparent;
          border: 1px solid var(--ground-border);
          color: var(--ground-muted);

          &:hover:not(:disabled) {
            border-color: ${fam.core};
            color: var(--ground-ink);
          }
        `;
  }}

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

/**
 * Selected state carries a check as well as the hue change (§10: every state
 * differs in at least two channels). Colour alone would fail for a
 * colour-blind user and in a screenshot.
 */
const Check = styled.span`
  display: inline-flex;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
`;

const Dot = styled.span<{ $family: FamilyName }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  box-shadow: ${({ theme, $family }) => theme.tokens.glow[$family][1]};
`;

const Count = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    selected = false,
    family,
    showDot = false,
    iconStart,
    count,
    readOnly = false,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <Root
      ref={ref}
      as={readOnly ? 'span' : 'button'}
      type={readOnly ? undefined : type}
      $selected={selected}
      $family={family}
      aria-pressed={readOnly ? undefined : selected}
      {...rest}
    >
      {showDot && family && <Dot $family={family} aria-hidden="true" />}
      {iconStart}
      {selected && !showDot && (
        <Check aria-hidden="true">
          <svg viewBox="0 0 12 12" fill="none" width="12" height="12">
            <path
              d="M2.5 6.2 4.8 8.5 9.5 3.8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Check>
      )}
      {children}
      {typeof count === 'number' && <Count data-numeric>{count}</Count>}
    </Root>
  );
});
