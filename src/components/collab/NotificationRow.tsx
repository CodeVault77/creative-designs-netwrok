'use client';

import Link from 'next/link';
import styled from 'styled-components';
import { Avatar } from '@/components/ui';
import { transition } from '@/lib/styles/motion';

/**
 * NotificationRow — screen 20.
 *
 * One row, two states. The unread marker is a dot AND a background AND a word
 * in the accessible name, because "unread" conveyed by colour alone is invisible
 * to anyone who cannot see the colour, and this list is almost entirely about
 * which items are unread.
 */

const Row = styled(Link)<{ $unread: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);

  padding: var(--space-3);
  border-radius: var(--radius-card);
  border: 1px solid var(--ground-border);
  background: ${({ $unread }) => ($unread ? 'var(--ground-raised)' : 'transparent')};

  color: inherit;
  text-decoration: none;

  ${transition('selection', 'background', 'border-color')}

  &:hover {
    border-color: var(--color-focus);
  }
`;

const Body = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Text = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-ink);
  overflow-wrap: anywhere;
`;

const Meta = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Dot = styled.span`
  width: 8px;
  height: 8px;
  margin-top: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  background: var(--fam-create-core);
`;

const Spacer = styled.span`
  width: 8px;
  flex-shrink: 0;
`;

export interface NotificationItem {
  id: string;
  actorName: string;
  kind: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
}

const VERB: Record<string, string> = {
  message: 'sent a message',
  invite: 'invited you',
  node_added: 'added a node',
  role_changed: 'changed your role',
};

export interface NotificationRowProps {
  notification: NotificationItem;
  onOpen?: (id: string) => void;
}

export function NotificationRow({ notification, onOpen }: NotificationRowProps) {
  const verb = VERB[notification.kind] ?? 'updated a map';

  return (
    <Row
      href={notification.href || '/maps'}
      $unread={!notification.read}
      onClick={() => onOpen?.(notification.id)}
      // The unread state is in the NAME, not only in the colour.
      aria-label={`${notification.read ? '' : 'Unread. '}${notification.actorName} ${verb}`}
    >
      {notification.read ? (
        <Spacer aria-hidden="true" />
      ) : (
        <Dot aria-hidden="true" />
      )}

      <Avatar name={notification.actorName} size="sm" />

      <Body>
        <Text>
          <strong>{notification.actorName}</strong> {verb}
          {notification.body ? `: ${notification.body}` : ''}
        </Text>
        <Meta>{relativeTime(notification.createdAt)}</Meta>
      </Body>
    </Row>
  );
}

export function relativeTime(iso: string): string {
  // SQLite stores UTC without a marker; without the Z this reads as local time
  // and every notification looks hours old the moment it arrives.
  const then = new Date(
    iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`,
  ).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}
