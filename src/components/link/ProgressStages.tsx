'use client';

import styled, { keyframes, css } from 'styled-components';
import { Button } from '@/components/ui';
import { STAGES, STAGE_LABEL, type Stage } from '@/lib/ingest/contract';

/**
 * ProgressStages — §12 step 4.
 *
 * "Four named stages with real progress: Fetching → Reading → Structuring →
 * Laying out. Never a generic spinner. Named stages make 15 s feel like 5.
 * Cancel available throughout."
 *
 * The stages are REAL: each one is rendered when the server says that stage
 * has begun, not on a timer. A fake sequence that advances on setInterval
 * looks identical until something is slow, at which point it lies — it sits
 * at "Laying out" while the fetch is still hanging, and the user's model of
 * what is happening is wrong exactly when they need it to be right.
 */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 480px;
`;

const List = styled.ol`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
`;

const Item = styled.li<{ $state: 'done' | 'active' | 'waiting' }>`
  display: flex;
  align-items: center;
  gap: var(--space-3);

  font-size: var(--text-body);
  color: ${({ $state }) =>
    $state === 'waiting' ? 'var(--ground-muted)' : 'var(--ground-ink)'};

  ${({ $state }) =>
    $state === 'active' &&
    css`
      animation: ${pulse} 1.6s ease-in-out infinite;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    `}
`;

const Marker = styled.span<{ $state: 'done' | 'active' | 'waiting' }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;

  border-radius: var(--radius-circle);
  border: 1px solid
    ${({ $state }) =>
      $state === 'waiting' ? 'var(--ground-border)' : 'var(--fam-create-core)'};
  background: ${({ $state }) =>
    $state === 'done' ? 'var(--fam-create-core)' : 'transparent'};
  color: var(--ground-background);
  font-size: 12px;
`;

const Bar = styled.div`
  height: 3px;
  background: var(--ground-border);
  border-radius: var(--radius-pill);
  overflow: hidden;
`;

const Fill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: var(--fam-create-core);
  border-radius: var(--radius-pill);
  transition: width 400ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const Foot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
`;

const Note = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export interface ProgressStagesProps {
  current: Stage | null;
  /** The resolved page title, once the Reading stage has produced one. */
  pageTitle?: string;
  onCancel: () => void;
}

export function ProgressStages({
  current,
  pageTitle,
  onCancel,
}: ProgressStagesProps) {
  const index = current ? STAGES.indexOf(current) : -1;

  /**
   * Progress is reported as "this stage has started", so the bar sits at the
   * START of the active stage rather than pretending to know how far through
   * it is. Interpolating within a stage would be the same lie as a fake
   * sequence, just smaller.
   */
  const pct = index < 0 ? 4 : ((index + 0.5) / STAGES.length) * 100;

  return (
    <Wrap>
      <Bar
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={STAGES.length}
        aria-valuenow={index + 1}
        aria-valuetext={current ? STAGE_LABEL[current] : 'Starting'}
      >
        <Fill $pct={pct} />
      </Bar>

      {/*
       * One live region for the whole list, so a screen reader announces
       * "Structuring" once rather than re-reading four items on every change.
       */}
      <List aria-live="polite" aria-atomic="false">
        {STAGES.map((stage, i) => {
          const state = i < index ? 'done' : i === index ? 'active' : 'waiting';
          return (
            <Item key={stage} $state={state}>
              <Marker $state={state} aria-hidden="true">
                {state === 'done' ? '✓' : ''}
              </Marker>
              {STAGE_LABEL[stage]}
              {state === 'active' && (
                <span className="sr-only"> — in progress</span>
              )}
            </Item>
          );
        })}
      </List>

      <Foot>
        <Note>
          {pageTitle
            ? `Reading “${pageTitle}”`
            : 'This usually takes a few seconds.'}
        </Note>
        {/* §12: "Cancel available throughout." Not only at the start. */}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </Foot>
    </Wrap>
  );
}
