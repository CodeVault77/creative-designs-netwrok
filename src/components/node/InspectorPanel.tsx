'use client';

import { useCallback } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * The desktop presentation: a persistent 360px right inspector (§09, §17).
 *
 * "Persistent" is the important word. Unlike the mobile sheet this is not
 * modal and does not dim the map: on a desktop there is room for both, and a
 * scrim would make the user dismiss the panel to interact with the map they
 * are inspecting. It occupies layout space rather than floating over the
 * canvas, so nothing is hidden behind it.
 *
 * Same content as the sheet — see NodeDetailBody. Only position differs.
 */

const Panel = styled.aside<{ $open: boolean }>`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-sheet);

  display: flex;
  flex-direction: column;
  width: 360px;

  background: var(--ground-surface);
  border-left: 1px solid var(--ground-border);

  transform: translateX(${({ $open }) => ($open ? '0' : '100%')});
  ${transition('sheet', 'transform')}

  @media (min-width: 1600px) {
    width: 400px;
  }
`;

const Header = styled.div`
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding: var(--space-2) var(--space-2) 0;
`;

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
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

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-4) var(--space-6);
`;

export interface InspectorPanelProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}

export function InspectorPanel({
  open,
  onClose,
  label,
  children,
}: InspectorPanelProps) {
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Panel
      $open={open}
      aria-label={label}
      onKeyDown={onKeyDown}
      // Not a dialog: it is a complementary region beside the map, and
      // announcing it as a modal would be a lie a screen reader acts on.
      inert={!open}
    >
      <Header>
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
      </Header>
      <Content>{children}</Content>
    </Panel>
  );
}
