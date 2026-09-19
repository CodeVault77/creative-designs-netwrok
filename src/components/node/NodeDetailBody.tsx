'use client';

import { useState } from 'react';
import styled from 'styled-components';
import { Skeleton } from '@/components/ui';
import { ReportDialog } from '@/components/moderation';
import { ActionRow } from './ActionRow';
import { ComingSoonBlock } from './ComingSoonBlock';
import { MetaList } from './MetaList';
import { NodeHeader } from './NodeHeader';
import type { NodeDetail, NodeDetailMode } from '@/lib/nodes/detail';

/**
 * The node detail CONTENT. One component, four modes.
 *
 * §18 lists DetailSheet and InspectorPanel as "one component, four modes",
 * and §20 names "sheet component sprawl" as this phase's risk. The way that
 * risk actually materialises is someone needing a Coming Soon variant, adding
 * `ComingSoonSheet.tsx`, and six weeks later there being four sheets whose
 * headers have quietly diverged.
 *
 * So the split here is along the one axis that genuinely differs:
 *
 *   THIS FILE   what is shown — mode: view | edit | soon | locked
 *   DetailSheet / InspectorPanel   where it is shown — the two presentations
 *
 * A new mode is a branch here. A new presentation is a new shell. Neither is
 * ever a new copy of the other.
 */

export interface NodeDetailBodyProps {
  detail: NodeDetail | null;
  mode: NodeDetailMode;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (href: string) => void;
  onExpand?: () => void;
  onNavigateCrumb?: (nodeId: string) => void;
  /** Rendered by the shell, not here, so the sheet can pin it to the bottom. */
  hideActions?: boolean;
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const Description = styled.p`
  margin: 0;
  color: var(--ground-muted);
  font-size: var(--text-body);
  line-height: var(--leading-body);
`;

const LockedNotice = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--fam-organise-core);
  border-radius: var(--radius-card);
  background: var(--fam-organise-wash);
`;

const LockedTitle = styled.p`
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ground-ink);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
`;

const LockedBody = styled.p`
  margin: 0;
  color: var(--ground-muted);
  font-size: var(--text-label);
  line-height: var(--leading-body);
`;

const ErrorBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-card);
`;

const ErrorText = styled.p`
  margin: 0;
  color: var(--ground-ink);
  font-size: var(--text-body);
`;

const RetryButton = styled.button`
  align-self: flex-start;
  height: 36px;
  padding: 0 var(--space-3);
  background: transparent;
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-control);
  color: var(--color-danger);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;

  &:hover {
    background: rgba(255, 77, 109, 0.08);
  }
`;

const ReportRow = styled.div`
  display: flex;
  justify-content: flex-start;
  padding-top: var(--space-3);
  margin-top: var(--space-2);
  border-top: 1px solid var(--ground-border);
`;

const ReportButton = styled.button`
  min-height: var(--control-minHitTarget);
  padding: 0;

  background: none;
  border: none;
  color: var(--ground-muted);
  font-family: var(--face-body);
  font-size: var(--text-caption);
  text-decoration: underline;
  cursor: pointer;

  &:hover {
    color: var(--color-danger);
  }
`;

export function NodeDetailBody({
  detail,
  mode,
  loading,
  error,
  onRetry,
  onOpen,
  onExpand,
  onNavigateCrumb,
  hideActions = false,
}: NodeDetailBodyProps) {
  // Declared before the early returns below, because hooks cannot be
  // conditional and the error branch returns first.
  const [reporting, setReporting] = useState(false);

  /*
   * §08 screen 03, error state: "Details didn't load. Retry inline; sheet
   * stays open." The sheet must not close on failure — closing it discards
   * the user's selection and makes them find the node again.
   */
  if (error && !detail) {
    return (
      <Body>
        <ErrorBlock role="alert">
          <ErrorText>Details didn&apos;t load.</ErrorText>
          <RetryButton onClick={onRetry}>Try again</RetryButton>
        </ErrorBlock>
      </Body>
    );
  }

  /*
   * §08 screen 03, loading state: "Sheet opens instantly with title from map
   * data; body shimmers." The title comes from the graph we already have, so
   * the sheet is never a blank rectangle — the user always sees what they
   * tapped.
   */
  if (loading && !detail) {
    return (
      <Body>
        <Skeleton lines={3} />
      </Body>
    );
  }

  if (!detail) return null;

  return (
    <Body>
      <NodeHeader
        detail={detail}
        mode={mode}
        {...(onNavigateCrumb ? { onNavigateCrumb } : {})}
      />

      {mode === 'locked' ? (
        <LockedNotice>
          <LockedTitle>
            <svg
              viewBox="0 0 16 16"
              width="15"
              height="15"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="7"
                width="10"
                height="7"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            This node is private
          </LockedTitle>
          <LockedBody>
            Ask the owner for access. You can see that it exists and where it sits
            in the map, but not what is inside it.
          </LockedBody>
        </LockedNotice>
      ) : mode === 'soon' ? (
        <ComingSoonBlock detail={detail} />
      ) : (
        <>
          {/*
            §08 screen 03, empty state: "Node with no description shows type +
            link only." No filler copy — an invented sentence is worse than a
            short panel, because it teaches people to stop reading.
          */}
          {detail.description && <Description>{detail.description}</Description>}
          <MetaList detail={detail} />
        </>
      )}

      {!hideActions && (
        <ActionRow
          detail={detail}
          mode={mode}
          onOpen={onOpen}
          {...(onExpand ? { onExpand } : {})}
        />
      )}

      {/*
        §15: "Report lives in the overflow of every node, map, message and
        profile. One flow, one component, everywhere."
        
        Quiet and last, deliberately — it should be findable without being one
        of the things the sheet appears to be for.
      */}
      {!hideActions && (
        <ReportRow>
          <ReportButton type="button" onClick={() => setReporting(true)}>
            Report this node
          </ReportButton>
        </ReportRow>
      )}

      <ReportDialog
        open={reporting}
        targetType="node"
        targetId={detail.id}
        label={detail.title}
        onClose={() => setReporting(false)}
      />
    </Body>
  );
}
