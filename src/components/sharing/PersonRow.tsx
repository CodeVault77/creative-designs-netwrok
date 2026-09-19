'use client';

import styled from 'styled-components';
import { Avatar } from '@/components/ui';
import { RoleMenu } from './RoleMenu';
import type { Role } from '@/lib/sharing/roles';

/** PersonRow — one member in the collaborators list (§08 screen 12). */

const Row = styled.li`
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  list-style: none;
  border-bottom: 1px solid var(--ground-border);

  &:last-child {
    border-bottom: none;
  }
`;

const Identity = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const Name = styled.span`
  font-size: var(--text-body);
  color: var(--ground-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Handle = styled.span`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const You = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export interface PersonRowProps {
  displayName: string;
  handle: string;
  role: Role;
  isYou: boolean;
  actorRole: Role | null;
  onChangeRole: (role: Role) => void;
  onRemove?: () => void;
}

export function PersonRow({
  displayName,
  handle,
  role,
  isYou,
  actorRole,
  onChangeRole,
  onRemove,
}: PersonRowProps) {
  return (
    <Row>
      <Avatar name={displayName} size="md" />
      <Identity>
        <Name>
          {displayName} {isYou && <You>(you)</You>}
        </Name>
        <Handle>@{handle}</Handle>
      </Identity>
      <RoleMenu
        value={role}
        actorRole={actorRole}
        onChange={onChangeRole}
        {...(onRemove ? { onRemove } : {})}
        // Leaving your own map is a different action from removing someone
        // else, and the word matters — "Remove" next to your own name reads
        // like you are about to delete yourself.
        removeLabel={isYou ? 'Leave map' : 'Remove'}
      />
    </Row>
  );
}
