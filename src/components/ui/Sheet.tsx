'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';
import { tokens } from '@/lib/styles/tokens.generated';

/**
 * How long to keep a closed sheet mounted so its exit animation can play.
 *
 * Read from the same token the panel's own transition uses, rather than
 * copied. A hardcoded number here would drift the moment the motion scale is
 * retuned, and the failure is subtle either way: too short and the panel
 * vanishes mid-slide, too long and it lingers invisibly, still holding the
 * scroll lock.
 */
const CLOSE_MS = Number.parseInt(tokens.motion.duration.sheet, 10) || 280;

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /**
   * Accessible name when there is no visible title.
   *
   * A sheet without a `title` renders no header — correct for a panel whose
   * own content is the heading — but `aria-label` then had nothing to fall
   * back to and the dialog reached screen readers unnamed.
   */
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * `bottom` on mobile, `right` on tablet+, `center` for confirmations.
   * §17 puts detail in a bottom sheet under 600px and a right sheet above.
   */
  placement?: 'bottom' | 'right' | 'center';
  /**
   * Panel width for the `right` placement, e.g. "248px".
   *
   * Width is a design decision per sheet, not a constant: an inspector wants
   * the full 380px, while a short navigation menu wants to stay narrow so the
   * screen behind it is still visible and it reads as a layer rather than a
   * new page. Ignored by the other placements.
   */
  width?: string;
  /** Fraction of viewport height for the bottom placement. §17: 45–90%. */
  height?: number;
  /** Hides the close button for flows that must be completed or cancelled. */
  dismissible?: boolean;
}

const Scrim = styled.div<{ $open: boolean }>`
  position: fixed;
  inset: 0;
  z-index: var(--z-scrim);

  /* §16: pushes the map back without hiding it. A fully opaque scrim would
     break the sense that the sheet is floating over a live network. */
  background: var(--scrim);
  backdrop-filter: blur(2px);

  opacity: ${({ $open }) => ($open ? 1 : 0)};
  pointer-events: ${({ $open }) => ($open ? 'auto' : 'none')};
  ${transition('sheet', 'opacity')}
`;

const Panel = styled.div<{
  $width?: string | undefined;
  $open: boolean;
  $placement: 'bottom' | 'right' | 'center';
  $height: number;
}>`
  position: fixed;
  z-index: var(--z-sheet);
  display: flex;
  flex-direction: column;

  background: var(--ground-surface);
  box-shadow: var(--elev-sheet);
  ${transition('sheet', 'transform', 'opacity')}

  ${({ $placement, $open, $height, $width }) => {
    if ($placement === 'bottom') {
      return css`
        left: 0;
        right: 0;
        bottom: 0;
        max-height: 92dvh;
        height: ${$height * 100}dvh;
        border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
        padding-bottom: env(safe-area-inset-bottom, 0);
        transform: translateY(${$open ? '0' : '100%'});
      `;
    }
    if ($placement === 'right') {
      return css`
        top: 0;
        right: 0;
        bottom: 0;
        width: min(${$width ?? '380px'}, 100vw);
        border-left: 1px solid var(--ground-border);
        transform: translateX(${$open ? '0' : '100%'});
      `;
    }
    return css`
      top: 50%;
      left: 50%;
      width: min(480px, calc(100vw - var(--space-8)));
      max-height: 80dvh;
      border: 1px solid var(--ground-border);
      border-radius: var(--radius-card);
      transform: translate(-50%, -50%) scale(${$open ? 1 : 0.97});
      opacity: ${$open ? 1 : 0};
    `;
  }}
`;

/** The drag affordance. Visual only — drag-to-dismiss is P4 work. */
const Grabber = styled.div`
  width: 36px;
  height: 4px;
  margin: var(--space-2) auto var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--ground-border);
  flex-shrink: 0;
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--ground-border);
  flex-shrink: 0;
`;

const Title = styled.h2`
  font-family: var(--face-display);
  font-size: var(--text-title);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
  color: var(--ground-ink);
`;

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${({ theme }) => theme.tokens.control[theme.density].iconButton};
  height: ${({ theme }) => theme.tokens.control[theme.density].iconButton};
  background: none;
  border: none;
  border-radius: var(--radius-control);
  color: var(--ground-muted);
  cursor: pointer;

  &:hover {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.04);
  }
`;

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-4);
`;

const Footer = styled.footer`
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--ground-border);
  flex-shrink: 0;
`;

/**
 * Modal sheet.
 *
 * Focus handling is deliberate and minimal: focus moves into the panel on
 * open and returns to the trigger on close, and Escape dismisses. A full
 * focus trap arrives with the DetailSheet in P4 — this primitive covers the
 * cases where the sheet is the only interactive surface.
 */
export function Sheet({
  open,
  onClose,
  title,
  ariaLabel,
  width,
  children,
  footer,
  placement = 'bottom',
  height = 0.6,
  dismissible = true,
}: SheetProps) {
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

  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /**
   * A closed sheet is not in the DOM at all.
   *
   * It used to stay mounted and park itself just past the edge with
   * translateX(100%) so it could slide back in. A fixed, transformed element
   * still counts toward the document's scrollable overflow, so a closed
   * right-hand sheet made the whole app scrollable sideways by its own width:
   * swiping on the map dragged the page across to reveal a menu nobody had
   * opened. `overflow-x: clip` on the root does not help, because clipping on
   * the root does not constrain fixed-position descendants.
   *
   * It also left a permanent `role="dialog"` in the accessibility tree for
   * every sheet on the page.
   *
   * `mounted` lags `open` by the transition duration so the CLOSING animation
   * still plays — the panel is removed after it has slid out, not the instant
   * the state flips.
   */
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;

    const timer = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  /**
   * One frame between mounting and opening.
   *
   * Without it the panel mounts with its open styles already applied and
   * appears instantly, because there was no previous position for the browser
   * to transition from.
   */
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!mounted || !open) {
      setEntered(false);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [mounted, open]);

  const shown = open && entered;

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    // Prevents the page scrolling behind the sheet, which on iOS otherwise
    // scrolls the body when the sheet's own content reaches its end.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        onClose();
      }
    },
    [dismissible, onClose],
  );

  if (!mounted) return null;

  /**
   * Rendered into `document.body`, not where it is written.
   *
   * `position: fixed` is relative to the viewport only while no ancestor
   * establishes a containing block — and `transform`, `filter`,
   * `backdrop-filter`, `perspective`, `contain` and `will-change` all do.
   * The top bar uses `backdrop-filter: blur(16px)`, so the menu drawer opened
   * inside it was confined to a 56px-tall bar: a full-height panel clipped to
   * a strip, with the map still fully visible underneath.
   *
   * Portalling fixes it at the primitive rather than at the one call site,
   * because any sheet opened from blurred or transformed chrome would hit the
   * same wall — and the symptom looks like a z-index problem, which is the
   * wrong thing to go and fix.
   */
  return createPortal(
    <>
      <Scrim
        $open={shown}
        onPointerDown={() => {
          scrimArmedRef.current = true;
        }}
        onClick={
          dismissible
            ? () => {
                if (!scrimArmedRef.current) return;
                scrimArmedRef.current = false;
                onClose();
              }
            : undefined
        }
        aria-hidden="true"
      />
      <Panel
        ref={panelRef}
        $open={shown}
        $placement={placement}
        $height={height}
        $width={width}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? ariaLabel}
        aria-hidden={!open}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        /* inert while closed, so a hidden sheet is not a keyboard trap */
        inert={!open}
      >
        {placement === 'bottom' && <Grabber aria-hidden="true" />}
        {title && (
          <Header>
            <Title>{title}</Title>
            {dismissible && (
              <CloseButton onClick={onClose} aria-label="Close">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </CloseButton>
            )}
          </Header>
        )}
        <Body>{children}</Body>
        {footer && <Footer>{footer}</Footer>}
      </Panel>
    </>,
    document.body,
  );
}
