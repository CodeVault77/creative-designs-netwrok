'use client';

import styled from 'styled-components';
import { ROLE_LABELS, type Role } from '@/lib/sharing/roles';

/** PendingInvite — an invitation that has not been accepted yet. */

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

const Placeholder = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  border: 1px dashed var(--ground-border);
  color: var(--ground-muted);
`;

const Identity = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const Email = styled.span`
  font-size: var(--text-body);
  color: var(--ground-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
`;

const LinkButton = styled.button`
  background: none;
  border: none;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-chip);
  color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.tokens.familyRamp[theme.family].wash};
  }
`;

const Revoke = styled(LinkButton)`
  color: var(--color-danger);

  &:hover {
    background: rgba(255, 77, 109, 0.08);
  }
`;

export interface PendingInviteProps {
  email: string;
  role: Role;
  expiresAt: string;
  /** Present only while there is no mail provider — see docs/12-sharing.md. */
  onCopyLink?: () => void;
  onRevoke: () => void;
}

export function PendingInvite({
  email,
  role,
  expiresAt,
  onCopyLink,
  onRevoke,
}: PendingInviteProps) {
  const days = Math.max(
    0,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 86_400_000),
  );

  return (
    <Row>
      <Placeholder aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path d="M2 4.5h12v7H2z" stroke="currentColor" strokeWidth="1.2" />
          <path d="m2.5 5 5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </Placeholder>
      <Identity>
        <Email>{email}</Email>
        <Meta>
          Invited as {ROLE_LABELS[role]} · expires in {days} day
          {days === 1 ? '' : 's'}
        </Meta>
      </Identity>
      <Actions>
        {onCopyLink && <LinkButton onClick={onCopyLink}>Copy link</LinkButton>}
        <Revoke onClick={onRevoke}>Revoke</Revoke>
      </Actions>
    </Row>
  );
}
