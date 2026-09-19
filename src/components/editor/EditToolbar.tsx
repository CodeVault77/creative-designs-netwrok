'use client';

import Link from 'next/link';
import styled, { css } from 'styled-components';
import { SaveIndicator } from './SaveIndicator';
import { transition } from '@/lib/styles/motion';
import { routes } from '@/lib/routes';
import type { SaveStatus } from '@/lib/editor/types';

/**
 * The editor's top bar (§08 screen 09).
 *
 * Replaces the app's TopBar because the editor runs with `chrome: minimal` —
 * the canvas owns the viewport and a second bar of app-level navigation would
 * cost a row of it.
 *
 * Deliberately has no Save button. §14: "A Save button in a canvas editor is a
 * bug report waiting to happen" — it teaches people that unsaved work is
 * possible, then makes them responsible for a thing the software should own.
 * The SaveIndicator reports; it never asks.
 */

const Bar = styled.header`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-chrome);

  display: flex;
  align-items: center;
  gap: var(--space-2);

  height: 52px;
  padding: 0 var(--space-3);

  background: rgba(7, 7, 12, 0.86);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--ground-border);

  @supports not (backdrop-filter: blur(16px)) {
    background: var(--ground-background);
  }
`;

const BackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-control);
  color: var(--ground-muted);
  text-decoration: none;

  &:hover {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.04);
  }
`;

/**
 * The map title is edited in place.
 *
 * A dedicated rename dialog for a single text field is a screen nobody needs,
 * and it puts the map's name somewhere other than where the name is shown.
 */
const TitleInput = styled.input`
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 var(--space-2);

  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-control);

  font-family: var(--face-display);
  font-size: var(--text-title);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
  color: var(--ground-ink);

  ${transition('selection', 'background-color', 'border-color')}

  &:hover:not(:disabled) {
    border-color: var(--ground-border);
  }

  &:focus {
    outline: none;
    background: var(--ground-raised);
    border-color: var(--color-focus);
  }

  &::placeholder {
    color: var(--ground-muted);
  }

  &:disabled {
    cursor: default;
  }
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
`;

const iconButtonCss = css`
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

  ${transition('selection', 'color', 'background-color')}

  &:hover:not(:disabled) {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.04);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

const IconButton = styled.button`
  ${iconButtonCss}
`;

/**
 * The same control as an anchor.
 *
 * styled-components v6 removed `withComponent`, so the shared block is
 * extracted and applied to both rather than deriving one from the other.
 */
const IconButtonLink = styled(Link)`
  ${iconButtonCss}
  text-decoration: none;
`;

export interface EditToolbarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onTitleCommit: () => void;
  status: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
  /** §08 screen 09: a viewer gets read-only chrome with the edit tools ABSENT. */
  readOnly?: boolean;
}

export function EditToolbar({
  title,
  onTitleChange,
  onTitleCommit,
  status,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRetry,
  readOnly = false,
}: EditToolbarProps) {
  return (
    <Bar>
      <BackLink href={routes.maps} aria-label="Back to My Maps">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
          <path
            d="M10 3.5 5.5 8l4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </BackLink>

      <TitleInput
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        onBlur={onTitleCommit}
        placeholder="Untitled map"
        aria-label="Map name"
        maxLength={60}
        disabled={readOnly}
      />

      <SaveIndicator status={status} onRetry={onRetry} />

      {/*
        §08 screen 09 permission state: edit tools are ABSENT for a viewer, not
        greyed out. A disabled button invites someone to work out how to enable
        it; an absent one says the surface is read-only and moves on.
      */}
      {!readOnly && (
        <Actions>
          <IconButton onClick={onUndo} disabled={!canUndo} aria-label="Undo">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <path
                d="M7 7H12.5a4 4 0 0 1 0 8H9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.5 4.5 6.5 7l3 2.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>

          <IconButton onClick={onRedo} disabled={!canRedo} aria-label="Redo">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <path
                d="M13 7H7.5a4 4 0 0 0 0 8H11"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10.5 4.5 13.5 7l-3 2.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>

          {/*
            §12 step 1 lists the editor toolbar as one of Link-to-Mind-Map's
            three entries: the moment someone is building a map by hand is
            exactly when a link they want to pull in comes to mind.
          */}
          <IconButtonLink
            href={`${routes.linkToMindMap}?from=editor`}
            aria-label="Turn a web page into nodes"
            title="Turn a web page into nodes"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <path
                d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M11.5 8.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </IconButtonLink>
        </Actions>
      )}
    </Bar>
  );
}

export const EDIT_TOOLBAR_HEIGHT = 52;
