'use client';

import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * ChipGrid — §13 step 2.
 *
 * "A grid of chips, family-tinted, each with a live content count.
 * Multi-select, minimum one, no maximum."
 *
 * The live count is doing more work than it looks. It is the honest signal
 * about cold start (§20's risk for this phase): a user who picks an interest
 * with four items behind it has been told it has four items, and is not
 * surprised by the feed that follows.
 */

const Grid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`;

/**
 * A real checkbox, visually hidden rather than replaced.
 *
 * A div with role="checkbox" would need keyboard handling, focus management
 * and an accessible name reimplemented by hand. The native control already
 * has all of that, and §13's grid is exactly a multi-select.
 */
const Input = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
`;

const Chip = styled.label<{ $family: FamilyName; $selected: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);

  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  cursor: pointer;
  user-select: none;

  background: ${({ $family, $selected }) =>
    $selected ? `var(--fam-${$family}-wash)` : 'transparent'};
  border: 1.5px solid
    ${({ $family, $selected }) =>
      $selected ? `var(--fam-${$family}-core)` : 'var(--ground-border)'};
  color: ${({ $selected }) => ($selected ? 'var(--ground-ink)' : 'var(--ground-muted)')};

  font-size: var(--text-body);
  font-family: var(--face-body);

  ${transition('selection', 'background', 'border-color', 'color')}

  &:hover {
    color: var(--ground-ink);
    border-color: ${({ $family }) => `var(--fam-${$family}-core)`};
  }

  /* The focus ring belongs on the label, because the input is hidden. */
  &:focus-within {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const Count = styled.span<{ $selected: boolean }>`
  font-size: var(--text-caption);
  /*
   * No opacity here. Muted text at 75% opacity dropped this below 4.5:1 and
   * failed WCAG AA on all 22 chips — caught by the P13 axe pass. Dimming with
   * opacity is invisible in review because the token still looks right; the
   * contrast is only wrong once it is composited.
   */
  color: ${({ $selected }) => ($selected ? 'var(--ground-ink)' : 'var(--ground-muted)')};
  font-variant-numeric: tabular-nums;
`;

export interface InterestOption {
  tag: string;
  label: string;
  family: FamilyName;
  count: number;
}

export interface ChipGridProps {
  options: readonly InterestOption[];
  selected: ReadonlySet<string>;
  onToggle: (tag: string) => void;
}

export function ChipGrid({ options, selected, onToggle }: ChipGridProps) {
  return (
    <Grid role="group" aria-label="Interests">
      {options.map((option) => {
        const isSelected = selected.has(option.tag);
        return (
          <Chip key={option.tag} $family={option.family} $selected={isSelected}>
            <Input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggle(option.tag)}
              /*
               * An explicit name, so the control is called "Design" rather
               * than "Design 12" — the count is context for a sighted user
               * scanning the grid, not part of what this checkbox is.
               */
              aria-label={option.label}
              aria-describedby={`count-${option.tag}`}
            />
            {option.label}
            <Count id={`count-${option.tag}`} $selected={isSelected}>
              {option.count} items
            </Count>
          </Chip>
        );
      })}
    </Grid>
  );
}
