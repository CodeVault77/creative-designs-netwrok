'use client';

import { useState } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';
import {
  ASSIGNABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  canAssignRole,
  type Role,
} from '@/lib/sharing/roles';

/**
 * RoleMenu — change or choose a role.
 *
 * Which roles appear comes from `canAssignRole`, the same pure function the
 * server enforces with. The menu therefore cannot offer something the server
 * will refuse, and — more importantly — the UI is not where the rule lives.
 * If this component and the server ever disagreed, the server would win and
 * the user would see an unexplained failure.
 */

const Wrap = styled.div`
  position: relative;
  flex-shrink: 0;
`;

const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);

  height: 32px;
  padding: 0 var(--space-2);

  background: transparent;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;

  ${transition('selection', 'border-color')}

  &:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  }

  &:disabled {
    cursor: default;
    border-color: transparent;
    color: var(--ground-muted);
  }
`;

const Menu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: var(--z-menu);
  min-width: 220px;

  display: flex;
  flex-direction: column;
  padding: var(--space-1);

  background: var(--ground-surface);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  box-shadow: var(--elev-menu);
`;

const Item = styled.button<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;

  padding: var(--space-2) var(--space-3);
  background: ${({ $active }) => ($active ? 'rgba(255,255,255,0.05)' : 'transparent')};
  border: none;
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
`;

const ItemLabel = styled.span`
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
`;

const ItemBody = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Danger = styled(Item)`
  color: var(--color-danger);
  border-top: 1px solid var(--ground-border);
  border-radius: 0 0 var(--radius-control) var(--radius-control);
  margin-top: var(--space-1);
  padding-top: var(--space-2);
`;

export interface RoleMenuProps {
  /** The role being displayed. */
  value: Role;
  /** The acting user's role on this map. */
  actorRole: Role | null;
  onChange: (role: Role) => void;
  onRemove?: () => void;
  /** Label for the remove item — "Remove" vs "Leave map". */
  removeLabel?: string;
  disabled?: boolean;
}

export function RoleMenu({
  value,
  actorRole,
  onChange,
  onRemove,
  removeLabel = 'Remove',
  disabled = false,
}: RoleMenuProps) {
  const [open, setOpen] = useState(false);

  const options = ASSIGNABLE_ROLES.filter((role) =>
    canAssignRole(actorRole, value, role),
  );

  // Nothing to offer and nothing to remove: render the role as plain text
  // rather than a control that does nothing when pressed.
  const interactive = !disabled && (options.length > 0 || Boolean(onRemove));

  if (!interactive) {
    return (
      <Trigger as="span" disabled>
        {ROLE_LABELS[value]}
      </Trigger>
    );
  }

  return (
    <Wrap>
      <Trigger
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Role: ${ROLE_LABELS[value]}`}
      >
        {ROLE_LABELS[value]}
        <svg
          viewBox="0 0 12 12"
          width="10"
          height="10"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 4.5 6 7.5l3-3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Trigger>

      {open && (
        <Menu role="menu">
          {options.map((role) => (
            <Item
              key={role}
              role="menuitemradio"
              aria-checked={role === value}
              $active={role === value}
              onClick={() => {
                setOpen(false);
                onChange(role);
              }}
            >
              <ItemLabel>{ROLE_LABELS[role]}</ItemLabel>
              <ItemBody>{ROLE_DESCRIPTIONS[role]}</ItemBody>
            </Item>
          ))}

          {onRemove && (
            <Danger
              role="menuitem"
              $active={false}
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              <ItemLabel>{removeLabel}</ItemLabel>
            </Danger>
          )}
        </Menu>
      )}
    </Wrap>
  );
}
