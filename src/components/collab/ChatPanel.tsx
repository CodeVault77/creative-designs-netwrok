'use client';

import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { MessageBubble } from './MessageBubble';
import { Composer, type ComposerNode } from './Composer';
import type { ChannelMessage } from '@/lib/collab/useMapChannel';

/**
 * ChatPanel — §15: "Map chat is one thread per map, docked right on desktop
 * and a bottom sheet on mobile."
 *
 * The docked/sheet split is done with a media query rather than two components,
 * so there is one thread implementation and the breakpoint is the only thing
 * that differs. Two components would be two scroll behaviours to keep in step.
 */

const Panel = styled.aside`
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;

  background: var(--ground-background);
  border-left: 1px solid var(--ground-border);

  /* §17: a bottom sheet under 600px, a right panel above. */
  @media (max-width: 600px) {
    border-left: none;
    border-top: 1px solid var(--ground-border);
  }
`;

const Head = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--ground-border);
`;

const Title = styled.h2`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-label);
  color: var(--ground-ink);
`;

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;

  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
`;

const Empty = styled.p`
  margin: auto 0;
  text-align: center;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Foot = styled.div`
  padding: 0 var(--space-3) var(--space-3);
`;

export interface ChatPanelProps {
  messages: readonly ChannelMessage[];
  nodes: readonly ComposerNode[];
  selfId: string;
  canPost: boolean;
  onSend: (body: string) => Promise<string | null>;
  onOpenNode?: (nodeId: string) => void;
  headerSlot?: React.ReactNode;
}

export function ChatPanel({
  messages,
  nodes,
  selfId,
  canPost,
  onSend,
  onOpenNode,
  headerSlot,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  /**
   * Stick to the bottom, but only if the reader was already there.
   *
   * Scrolling someone back down while they are reading history is the classic
   * chat annoyance, and it happens every time a message arrives. The threshold
   * is generous because "near the bottom" is what people mean by "at the
   * bottom".
   */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages]);

  return (
    <Panel aria-label="Map chat">
      <Head>
        <Title>Chat</Title>
        {headerSlot}
      </Head>

      <Scroll
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages.length === 0 ? (
          <Empty>
            No messages yet. Type <strong>#</strong> to point at a node.
          </Empty>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              own={message.authorId === selfId}
              onOpenNode={onOpenNode}
            />
          ))
        )}
      </Scroll>

      <Foot>
        {canPost ? (
          <Composer nodes={nodes} onSend={onSend} />
        ) : (
          // §15: a Viewer may read the thread but not post. Said plainly
          // rather than shown as a disabled box with no explanation.
          <Empty>You have view-only access to this map.</Empty>
        )}
      </Foot>
    </Panel>
  );
}
