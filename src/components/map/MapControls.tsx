'use client';

import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * Zoom and recentre — the right-edge glass column (§16).
 *
 * Thumb-reachable on the right because the map fills the viewport and there is
 * nowhere else for them to go without covering content. 44px circles per §16.
 */

/**
 * `$inset` shifts the column left when the desktop inspector is open.
 *
 * The inspector occupies the right 360px, and the zoom and recentre controls
 * live at the right edge — so with a node selected they were sitting behind
 * the panel and could not be reached at all. A control that becomes
 * unreachable exactly when the user is inspecting something is worse than one
 * that moves.
 */
const Column = styled.div<{ $inset: number }>`
  position: absolute;
  right: calc(var(--space-3) + ${({ $inset }) => $inset}px);
  /*
   * Vertically CENTRED, as the design canvas has it — not pinned to the
   * bottom.
   *
   * Two things fall out of that. The corners come free, so the lens pill and
   * the add-node FAB can take the bottom-left and bottom-right the canvas
   * gives them instead of queueing above the zoom column; and on the editor
   * the FAB stops sitting directly above the zoom "+", where two identical
   * plus glyphs were stacked 8px apart.
   *
   * translateY rather than a hand-computed negative margin so the column
   * stays centred if a control is ever added or removed.
   */
  top: 50%;
  transform: translateY(-50%);
  z-index: var(--z-mapControls);

  display: flex;
  flex-direction: column;
  gap: var(--space-2);

  transition: right var(--duration-sheet) var(--ease-sheet);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const GlassButton = styled.button`
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

export interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecentre: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  /** Pixels to shift left, to clear the desktop inspector when it is open. */
  insetRight?: number;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onRecentre,
  canZoomIn,
  canZoomOut,
  insetRight = 0,
}: MapControlsProps) {
  return (
    <Column $inset={insetRight}>
      <GlassButton onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <path
            d="M12 6v12M6 12h12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </GlassButton>

      <GlassButton onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <path
            d="M6 12h12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </GlassButton>

      <GlassButton onClick={onRecentre} aria-label="Recentre the map">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </GlassButton>
    </Column>
  );
}
