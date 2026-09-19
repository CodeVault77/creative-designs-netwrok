'use client';

import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * Map ↔ Tree (§06).
 *
 * A first-class control, not a setting. The tree is a legitimate way to use
 * the product — for keyboard users, for screen-reader users, and for anyone
 * who simply wants to scan a list — and burying it in preferences would say
 * the opposite.
 */

const Group = styled.div`
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: var(--z-mapControls);

  display: flex;
  padding: 2px;
  background: rgba(13, 14, 23, 0.72);
  backdrop-filter: blur(12px);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);

  @supports not (backdrop-filter: blur(12px)) {
    background: var(--ground-surface);
  }
`;

const Option = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);

  height: 32px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-pill);

  background: ${({ $active }) => ($active ? 'var(--fam-discover-wash)' : 'transparent')};
  color: ${({ $active }) => ($active ? 'var(--fam-discover-core)' : 'var(--ground-muted)')};

  font-family: var(--face-body);
  font-size: var(--text-label);
  font-weight: ${({ theme, $active }) =>
    $active
      ? theme.tokens.typography.weight.medium
      : theme.tokens.typography.weight.regular};
  cursor: pointer;

  ${transition('selection', 'background-color', 'color')}

  &:hover {
    color: var(--ground-ink);
  }
`;

export interface ViewToggleProps {
  view: 'map' | 'tree';
  onChange: (view: 'map' | 'tree') => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <Group role="group" aria-label="View">
      <Option
        $active={view === 'map'}
        onClick={() => onChange('map')}
        aria-pressed={view === 'map'}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="1.6" fill="currentColor" />
          <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Map
      </Option>

      <Option
        $active={view === 'tree'}
        onClick={() => onChange('tree')}
        aria-pressed={view === 'tree'}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 4h6M2 8h9M2 12h12"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        Tree
      </Option>
    </Group>
  );
}
