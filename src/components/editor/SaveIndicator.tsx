'use client';

import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { SaveStatus } from '@/lib/editor/types';

/**
 * §14: "status text reads Saving / Saved / Offline".
 *
 * It reports; it never asks. The three quiet states are deliberately
 * low-contrast — a permanently prominent "Saved" trains people to ignore the
 * spot where the important message will eventually appear.
 *
 * The two states that need action get a border and full contrast, because
 * §08 screen 09 requires the error case to be a "persistent amber bar" rather
 * than a toast that vanishes before it is read.
 */

const Wrap = styled.div<{ $tone: 'quiet' | 'warn' | 'error' }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;

  height: 28px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);

  font-size: var(--text-caption);
  white-space: nowrap;

  ${transition('selection', 'color', 'background-color', 'border-color')}

  ${({ $tone }) =>
    $tone === 'quiet'
      ? css`
          color: var(--ground-muted);
          border: 1px solid transparent;
        `
      : $tone === 'warn'
        ? css`
            color: var(--color-warning);
            border: 1px solid var(--color-warning);
            background: rgba(255, 176, 32, 0.08);
          `
        : css`
            color: var(--color-danger);
            border: 1px solid var(--color-danger);
            background: rgba(255, 77, 109, 0.08);
          `}
`;

const Dot = styled.span<{ $spin: boolean }>`
  width: 7px;
  height: 7px;
  border-radius: var(--radius-circle);
  background: currentColor;
  flex-shrink: 0;

  ${({ $spin }) =>
    $spin &&
    css`
      animation: cdn-save-pulse 1s ease-in-out infinite;

      @keyframes cdn-save-pulse {
        50% {
          opacity: 0.3;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        animation: none;
        opacity: 0.6;
      }
    `}
`;

const RetryButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
`;

const COPY: Record<SaveStatus, { text: string; tone: 'quiet' | 'warn' | 'error' }> =
  {
    idle: { text: '', tone: 'quiet' },
    saving: { text: 'Saving', tone: 'quiet' },
    saved: { text: 'Saved', tone: 'quiet' },
    // Not an error: the work is safe locally and will go up when the network
    // comes back. Saying "failed" here would be alarming and wrong.
    offline: { text: 'Offline — saved on this device', tone: 'warn' },
    error: { text: "Couldn't save", tone: 'error' },
    conflict: { text: 'Someone else edited this map', tone: 'error' },
  };

export function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === 'idle') return null;

  const { text, tone } = COPY[status];
  const needsAction = status === 'error' || status === 'conflict';

  return (
    <Wrap
      $tone={tone}
      // polite, not assertive: a save status must never interrupt someone
      // mid-sentence in a title field.
      role="status"
      aria-live="polite"
    >
      <Dot $spin={status === 'saving'} aria-hidden="true" />
      {text}
      {status === 'error' && <RetryButton onClick={onRetry}>Retry</RetryButton>}
      {needsAction && status === 'conflict' && (
        <RetryButton onClick={onRetry}>Reload</RetryButton>
      )}
    </Wrap>
  );
}
