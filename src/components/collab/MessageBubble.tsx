'use client';

import styled from 'styled-components';
import { Avatar } from '@/components/ui';
import type { ChannelMessage } from '@/lib/collab/useMapChannel';

/**
 * MessageBubble — one message in the map thread (§15).
 *
 * The node chip is the part that matters. §15: "Typing `#` mentions a node and
 * posts a chip that recentres the map when tapped — this is what makes it map
 * chat rather than a chat box." A thread without it is a chat widget that
 * happens to sit next to a map.
 */

const Row = styled.div<{ $own: boolean }>`
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  flex-direction: ${({ $own }) => ($own ? 'row-reverse' : 'row')};
`;

const Body = styled.div<{ $own: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  max-width: 80%;
  align-items: ${({ $own }) => ($own ? 'flex-end' : 'flex-start')};
`;

const Meta = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Bubble = styled.div<{ $own: boolean }>`
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);

  background: ${({ $own }) => ($own ? 'var(--fam-create-wash)' : 'var(--ground-raised)')};
  border: 1px solid
    ${({ $own }) => ($own ? 'var(--fam-create-core)' : 'var(--ground-border)')};
  color: var(--ground-ink);
  font-size: var(--text-body);
  line-height: 1.45;

  /* A pasted URL must not push the panel wider than its column. */
  overflow-wrap: anywhere;
`;

const Chip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-2);
  padding: 2px var(--space-2);

  background: none;
  border: 1px solid var(--fam-discover-core);
  border-radius: var(--radius-pill);
  color: var(--fam-discover-core);
  font-family: var(--face-body);
  font-size: var(--text-caption);
  cursor: pointer;

  &:hover {
    background: var(--fam-discover-wash);
  }
`;

export interface MessageBubbleProps {
  message: ChannelMessage;
  own: boolean;
  /** Recentres the map on the mentioned node. */
  onOpenNode?: (nodeId: string) => void;
}

export function MessageBubble({ message, own, onOpenNode }: MessageBubbleProps) {
  return (
    <Row $own={own}>
      <Avatar name={message.authorName} size="sm" />

      <Body $own={own}>
        <Meta>
          {own ? 'You' : message.authorName} · {timeOf(message.createdAt)}
        </Meta>

        <Bubble $own={own}>
          {message.body}

          {/*
            Rendered from the STORED node id, and labelled with the node's
            current title. The chip therefore keeps working after a rename,
            which storing the typed text would not.
          */}
          {message.nodeRef && (
            <div>
              <Chip
                type="button"
                onClick={() => onOpenNode?.(message.nodeRef!)}
                aria-label={`Go to ${message.nodeTitle ?? 'the node'} on the map`}
              >
                # {message.nodeTitle ?? 'node'}
              </Chip>
            </div>
          )}
        </Bubble>
      </Body>
    </Row>
  );
}

function timeOf(iso: string): string {
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC; Date needs the marker to read
  // it as UTC rather than as local time, which would shift every timestamp.
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
