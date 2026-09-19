'use client';

import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * §14: "Confirm only when children exist... Undo for 10s."
 *
 * The transient bar after a destructive edit. It is what lets delete be a
 * single tap for the common case — a confirmation dialog on every delete
 * makes building a map exhausting, and the acceptance criterion is a ten-node
 * map in under three minutes.
 *
 * The trade is explicit: confirm when a subtree is at stake (losing four
 * nodes by accident is expensive), offer undo otherwise (losing one is not).
 */

const Bar = styled.div<{ $visible: boolean }>`
  position: absolute;
  left: 50%;
  transform: translateX(-50%)
    translateY(${({ $visible }) => ($visible ? '0' : '120%')});
  bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-toast);

  display: flex;
  align-items: center;
  gap: var(--space-3);

  padding: var(--space-2) var(--space-3);
  background: var(--ground-surface);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  box-shadow: var(--elev-menu);

  font-size: var(--text-label);
  color: var(--ground-ink);
  white-space: nowrap;

  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? 'auto' : 'none')};
  ${transition('sheet', 'transform', 'opacity')}
`;

const UndoButton = styled.button`
  background: none;
  border: none;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-chip);
  color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  font: inherit;
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.tokens.familyRamp[theme.family].wash};
  }
`;

export const UNDO_WINDOW_MS = 10_000;

export interface UndoBarProps {
  /** Changes on every new undoable action; null hides the bar. */
  action: { id: number; label: string } | null;
  onUndo: () => void;
}

export function UndoBar({ action, onUndo }: UndoBarProps) {
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!action) {
      setVisible(false);
      return;
    }

    setLabel(action.label);
    setVisible(true);

    const timer = window.setTimeout(() => setVisible(false), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
    // Keyed on the action id so repeating the same action restarts the window
    // rather than being treated as no change.
  }, [action]);

  return (
    <Bar $visible={visible} role="status" aria-live="polite" inert={!visible}>
      <span>{label}</span>
      <UndoButton
        onClick={() => {
          setVisible(false);
          onUndo();
        }}
      >
        Undo
      </UndoButton>
    </Bar>
  );
}
