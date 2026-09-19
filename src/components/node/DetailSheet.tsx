'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * The mobile presentation: a bottom sheet at 45% height, draggable to 90%.
 *
 * §09 gives those numbers precisely, and the reason is the map. A sheet that
 * opens full-height replaces the map with a page and breaks the sense that
 * you are still standing somewhere in the network. At 45% the selected node
 * and its neighbours stay visible above it, so the sheet reads as an overlay
 * on a place rather than a destination.
 *
 * This shell knows nothing about node modes — see NodeDetailBody. It owns
 * position, drag, focus and dismissal, and that is all.
 */

const DETENT = { peek: 0.45, full: 0.9 } as const;

const Scrim = styled.div<{ $open: boolean; $progress: number }>`
  position: fixed;
  inset: 0;
  z-index: var(--z-scrim);

  /* Scales with how far the sheet is open, so dragging it up dims the map
     progressively rather than in a single step. */
  background: rgba(0, 0, 0, ${({ $progress }) => 0.35 + $progress * 0.4});
  backdrop-filter: blur(2px);

  opacity: ${({ $open }) => ($open ? 1 : 0)};
  pointer-events: ${({ $open }) => ($open ? 'auto' : 'none')};
  ${transition('sheet', 'opacity')}
`;

const Panel = styled.div<{ $open: boolean; $height: number; $dragging: boolean }>`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-sheet);

  display: flex;
  flex-direction: column;
  height: ${({ $height }) => $height * 100}dvh;
  max-height: 92dvh;

  background: var(--ground-surface);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  box-shadow: var(--elev-sheet);
  padding-bottom: env(safe-area-inset-bottom, 0);

  transform: translateY(${({ $open }) => ($open ? '0' : '100%')});

  /*
   * The panel takes programmatic focus on open so a screen reader lands
   * inside it. Chrome treats that as :focus-visible and draws the global
   * focus ring around the whole sheet, which reads as an error state.
   *
   * This is the narrow case where removing the outline is correct: the panel
   * is a focus-management target, not a control anyone tabs to, and every
   * control inside it keeps its own ring.
   */
  &:focus,
  &:focus-visible {
    outline: none;
  }

  /* No transition while the finger is down: the sheet must track the finger
     exactly, and an eased transform during a drag feels like lag. */
  ${({ $dragging }) => !$dragging && transition('sheet', 'transform', 'height')}
`;

const Grabber = styled.div`
  flex-shrink: 0;
  padding: var(--space-2) 0 var(--space-1);
  display: flex;
  justify-content: center;
  cursor: grab;
  touch-action: none;

  &::after {
    content: '';
    width: 36px;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--ground-border);
  }
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-3) var(--space-4) var(--space-6);
`;

const CloseButton = styled.button`
  position: absolute;
  top: var(--space-2);
  right: var(--space-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: none;
  /*
   * A visible border, per the design canvas.
   *
   * A borderless glyph on a dark panel reads as decoration until you try it;
   * the outline is what makes it look like the control it is. Same reason the
   * canvas draws it as a bordered square rather than a bare ✕.
   */
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-muted);
  cursor: pointer;

  &:hover {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.04);
  }
`;

export interface DetailSheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}

export function DetailSheet({ open, onClose, label, children }: DetailSheetProps) {
  /**
   * The scrim closes only on a gesture that STARTED on it.
   *
   * On a touch device the browser dispatches a compatibility `click` after
   * `touchend`, at the coordinates the finger lifted. Selecting a node mounts
   * this sheet and its scrim underneath that finger, so the click landed on a
   * scrim that had not existed when the tap began — the sheet opened and shut
   * in the same gesture, and the selection (and its `?node=` param) was gone
   * before anything was drawn. It looked like a redirect.
   *
   * Arming on `pointerdown` fixes it without a timeout: a click whose gesture
   * began somewhere else never arms, and a real dismissing tap always does.
   */
  const scrimArmedRef = useRef(false);

  const [height, setHeight] = useState<number>(DETENT.peek);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset to the peek detent so the next node opens consistently rather
      // than inheriting how far the last one was dragged.
      setHeight(DETENT.peek);
      return;
    }

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  const onGrabberDown = useCallback(
    (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = { startY: event.clientY, startHeight: height };
      setDragging(true);
    },
    [height],
  );

  const onGrabberMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const delta = drag.startY - event.clientY;
    const next = drag.startHeight + delta / window.innerHeight;
    setHeight(Math.min(0.92, Math.max(0.2, next)));
  }, []);

  const onGrabberUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag) return;

    // Snap to the nearest detent, or dismiss if dragged below the peek.
    // Free-floating heights make the sheet feel unresolved.
    if (height < DETENT.peek * 0.62) {
      onClose();
      return;
    }
    setHeight(
      Math.abs(height - DETENT.peek) < Math.abs(height - DETENT.full)
        ? DETENT.peek
        : DETENT.full,
    );
  }, [height, onClose]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const progress = (height - DETENT.peek) / (DETENT.full - DETENT.peek);

  return (
    <>
      <Scrim
        $open={open}
        $progress={Math.min(1, Math.max(0, progress))}
        onPointerDown={() => {
          scrimArmedRef.current = true;
        }}
        onClick={() => {
          if (!scrimArmedRef.current) return;
          scrimArmedRef.current = false;
          onClose();
        }}
        aria-hidden="true"
      />
      <Panel
        ref={panelRef}
        $open={open}
        $height={height}
        $dragging={dragging}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        inert={!open}
      >
        <Grabber
          onPointerDown={onGrabberDown}
          onPointerMove={onGrabberMove}
          onPointerUp={onGrabberUp}
          onPointerCancel={onGrabberUp}
          role="separator"
          aria-label="Resize panel"
          aria-orientation="horizontal"
        />
        <CloseButton onClick={onClose} aria-label="Close details">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </CloseButton>
        <Content>{children}</Content>
      </Panel>
    </>
  );
}

export { DETENT };
