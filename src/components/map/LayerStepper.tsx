'use client';

import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * The layer stepper — §09's "visual telescope".
 *
 * Shifts which ring occupies the centre band while preserving the user's
 * sense of place. It exists because pinch-zooming through four rings to reach
 * depth 3 is tedious and imprecise, and because a critical design principle
 * requires an alternative to manually zooming through every layer.
 *
 * Left edge, vertically centred: the right edge already carries zoom and
 * recentre, and putting a fifth control there would make a wall of glass
 * circles.
 */

/**
 * Left edge (§09) — but NOT vertically centred.
 *
 * Centred, it lands exactly on the ring's horizontal band, where the nodes at
 * three and nine o'clock and their labels live, and the control covered them.
 * A map control that hides map content is worse than one that is slightly
 * further from the thumb, so it sits low-left instead, mirroring the zoom
 * column on the right and leaving the equator clear.
 */
const Column = styled.div`
  position: absolute;
  left: var(--space-3);
  /* Centred opposite the zoom column, mirroring the design canvas. */
  top: 50%;
  transform: translateY(-50%);
  z-index: var(--z-mapControls);

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
`;

const StepButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 44px;
  height: 44px;

  background: rgba(13, 14, 23, 0.72);
  backdrop-filter: blur(12px);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-circle);
  color: var(--ground-ink);
  cursor: pointer;

  ${transition('selection', 'background-color', 'border-color', 'color')}

  &:hover:not(:disabled) {
    border-color: var(--fam-discover-core);
    color: var(--fam-discover-core);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @supports not (backdrop-filter: blur(12px)) {
    background: var(--ground-surface);
  }
`;

/** Which ring is in the centre band, in the mono face like every other count. */
const DepthReadout = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  background: rgba(13, 14, 23, 0.72);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  padding: 2px 8px;
  backdrop-filter: blur(12px);
`;

export interface LayerStepperProps {
  /** Ring currently framed in the centre band. */
  depth: number;
  /** Deepest ring that currently has anything in it. */
  maxDepth: number;
  onStepInward: () => void;
  onStepOutward: () => void;
}

export function LayerStepper({
  depth,
  maxDepth,
  onStepInward,
  onStepOutward,
}: LayerStepperProps) {
  return (
    <Column role="group" aria-label="Map layer">
      <StepButton
        onClick={onStepOutward}
        disabled={depth <= 1}
        aria-label="Step out one layer"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            d="M9 5l-6 7 6 7M21 5l-6 7 6 7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </StepButton>

      {/*
       * The depth readout appears only when there is more than one level.
       *
       * On a map with a single ring it said "1/1" — a control-shaped chip
       * reporting that there is nowhere to go. It is also the widest thing in
       * this column, so it was the one part of the stepper that reached the
       * ring and sat on top of a node. The design reference shows two
       * chevrons and no readout for exactly this case.
       */}
      {maxDepth > 1 && (
        <DepthReadout aria-live="polite">
          {depth}/{Math.max(depth, maxDepth)}
        </DepthReadout>
      )}

      <StepButton
        onClick={onStepInward}
        disabled={depth >= maxDepth}
        aria-label="Step in one layer"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            d="M15 5l6 7-6 7M3 5l6 7-6 7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </StepButton>
    </Column>
  );
}
