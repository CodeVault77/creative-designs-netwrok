'use client';

import styled from 'styled-components';
import { Avatar } from '@/components/ui';
import type { ChannelPresence, ConnectionState } from '@/lib/collab/useMapChannel';

/**
 * PresenceStack — §15's "avatar stack in the top bar".
 *
 * It also carries the connection state, which is the part people actually
 * need. §20's risk here is reconnection, and the failure that matters is not a
 * dropped socket — it is a dropped socket nobody was told about, so someone
 * keeps typing into a map that stopped updating twenty minutes ago.
 */

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`;

const Stack = styled.div`
  display: inline-flex;
  align-items: center;

  /* Overlapping avatars, most recent first. */
  > * + * {
    margin-left: -8px;
  }
`;

const Slot = styled.span`
  border-radius: var(--radius-circle);
  box-shadow: 0 0 0 2px var(--ground-background);
`;

const More = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  box-shadow: 0 0 0 2px var(--ground-background);

  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Dot = styled.span<{ $state: ConnectionState }>`
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);

  background: ${({ $state }) =>
    $state === 'live'
      ? 'var(--color-success)'
      : $state === 'offline'
        ? 'var(--color-danger)'
        : 'var(--color-warning)'};
`;

const Label = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
  white-space: nowrap;
`;

const STATE_LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline — changes will sync when you reconnect',
};

export interface PresenceStackProps {
  present: readonly ChannelPresence[];
  state: ConnectionState;
  /** Excluded from the stack — you know you are here. */
  selfId?: string;
  max?: number;
}

export function PresenceStack({
  present,
  state,
  selfId,
  max = 4,
}: PresenceStackProps) {
  const others = present.filter((person) => person.userId !== selfId);
  const shown = others.slice(0, max);
  const overflow = others.length - shown.length;

  return (
    <Wrap>
      {shown.length > 0 && (
        <Stack aria-label={`${others.length} other people here`}>
          {shown.map((person) => (
            <Slot key={person.userId} title={person.name}>
              <Avatar name={person.name} size="sm" />
            </Slot>
          ))}
          {overflow > 0 && <More>+{overflow}</More>}
        </Stack>
      )}

      {/*
        role="status" so a screen reader hears the transition to Offline
        without it stealing focus. Silence is the wrong way to report a
        connection that has gone.
      */}
      <Dot $state={state} aria-hidden="true" />
      <Label role="status">
        {state === 'live' && others.length > 0
          ? `${others.length} here`
          : STATE_LABEL[state]}
      </Label>
    </Wrap>
  );
}
