'use client';

import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * TabSegment — Mine / Shared with me (§08 screen 07).
 *
 * A segmented control rather than routes, because switching tabs is a filter
 * on one list rather than a change of place. Making it a route would put every
 * toggle in the back stack, so Back would walk through tab switches instead of
 * leaving the screen — the same reasoning as `?node=` on the map.
 *
 * Counts are shown on each tab. An empty tab you can see is empty is far
 * better than one you have to open to discover is empty.
 */

/**
 * Full width, with the options sharing it equally.
 *
 * The reference gives the control its own row and lets each half fill it, so
 * the two are visibly a pair of equal choices. Sized to content it drifted to
 * whatever width the longest label needed and read as a chip rather than a
 * switch.
 */
const Group = styled.div`
  display: flex;
  width: 100%;
  padding: 3px;
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
`;

const Option = styled.button<{ $active: boolean }>`
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);

  min-height: 36px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-chip);

  background: ${({ theme, $active }) =>
    $active ? theme.tokens.familyRamp[theme.family].wash : 'transparent'};
  color: ${({ theme, $active }) =>
    $active ? theme.tokens.familyRamp[theme.family].core : 'var(--ground-muted)'};

  font-family: var(--face-body);
  font-size: var(--text-label);
  font-weight: ${({ theme, $active }) =>
    $active
      ? theme.tokens.typography.weight.medium
      : theme.tokens.typography.weight.regular};
  cursor: pointer;
  white-space: nowrap;

  ${transition('selection', 'background-color', 'color')}

  &:hover {
    color: var(--ground-ink);
  }
`;

const Count = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  opacity: 0.8;
`;

export interface TabOption<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function TabSegment<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <Group role="tablist" aria-label={label}>
      {options.map((option) => (
        <Option
          key={option.id}
          role="tab"
          aria-selected={option.id === value}
          $active={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {typeof option.count === 'number' && (
            <Count data-numeric>{option.count}</Count>
          )}
        </Option>
      ))}
    </Group>
  );
}
