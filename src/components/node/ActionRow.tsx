'use client';

import { useState } from 'react';
import styled from 'styled-components';
import { Button, useToast } from '@/components/ui';
import { track } from '@/lib/analytics';
import type { NodeDetail, NodeDetailMode } from '@/lib/nodes/detail';

/**
 * The actions on a node.
 *
 * §24's headline funnel metric is a live destination reached in **3 taps**:
 * tap the node, then Open. That makes `Open` the primary action, first in
 * order and the only filled button — anything competing with it for
 * prominence costs taps directly.
 *
 * Expand is secondary because §10 is explicit that a single tap must never
 * navigate; expanding is the exploratory path and Open is the committing one.
 */

const Row = styled.div`
  display: flex;
  align-items: stretch;
  gap: var(--space-2);
`;

/** Open takes the room that is left; the other two are sized by content. */
const Grow = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;

const Fixed = styled.div`
  flex: 0 0 auto;
`;

/**
 * Share is an icon, not a word.
 *
 * The design reference gives the third slot a square glyph button, and the
 * reason it works is that the row is a hierarchy: one committing action, one
 * exploratory, one utility. Spelling out "Copy link" gave the least important
 * action the second-most text and pushed Open — the action §24's 3-tap metric
 * depends on — into a narrower box.
 *
 * It keeps a real accessible name, so nothing is lost to anyone reading the
 * label rather than the glyph.
 */
const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 48px;
  height: 100%;
  min-height: 44px;

  background: none;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--ground-ink);
    border-color: var(--ground-muted);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

export interface ActionRowProps {
  detail: NodeDetail;
  mode: NodeDetailMode;
  onOpen: (href: string) => void;
  onExpand?: () => void;
}

export function ActionRow({ detail, mode, onOpen, onExpand }: ActionRowProps) {
  const { show } = useToast();
  const [copying, setCopying] = useState(false);

  const copyLink = async () => {
    setCopying(true);
    try {
      // Clipboard access fails on http origins and when permission is denied.
      // Falling back to showing the URL is better than a silent failure —
      // the user can still select and copy it themselves.
      await navigator.clipboard.writeText(detail.shareUrl);
      track('node_link_copied', { node_id: detail.id });
      show({ message: 'Link copied', tone: 'success' });
    } catch {
      show({ message: detail.shareUrl, tone: 'neutral', duration: 8000 });
    } finally {
      setCopying(false);
    }
  };

  return (
    <Row>
      {/*
        A locked node offers only the share link. Expanding it would reveal
        the child structure the lock exists to protect, and there is nothing
        to open.
      */}
      {mode !== 'locked' && detail.href && (
        <Grow>
          <Button
            variant="primary"
            family={detail.family}
            fullWidth
            onClick={() => onOpen(detail.href!)}
          >
            Open
          </Button>
        </Grow>
      )}

      {mode !== 'locked' && onExpand && detail.childCount > 0 && (
        <Fixed>
          {/*
            No count on the label: the meta table above already states
            CHILDREN, and repeating it here made the button grow with the
            number while saying nothing new.
          */}
          <Button variant="secondary" onClick={onExpand}>
            Expand
          </Button>
        </Fixed>
      )}

      <Fixed>
        <IconButton
          type="button"
          onClick={copyLink}
          disabled={copying}
          aria-label="Copy link to this node"
        >
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 15V3"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="m8 7 4-4 4 4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </IconButton>
      </Fixed>
    </Row>
  );
}
