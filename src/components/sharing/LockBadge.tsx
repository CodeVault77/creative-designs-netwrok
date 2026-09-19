'use client';

import styled from 'styled-components';

/**
 * LockBadge — "this exists, and you cannot open it".
 *
 * §10 requires every node state to differ in at least two channels, so this
 * carries an icon AND a label rather than relying on colour. It is used in the
 * tree view, in the detail panel and anywhere a node is present but withheld.
 *
 * The wording matters. "Locked" tells someone they are being kept out;
 * "Private" tells them whose decision it was, which is the true and less
 * adversarial reading.
 */

const Badge = styled.span<{ $size: 'sm' | 'md' }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;

  padding: ${({ $size }) => ($size === 'sm' ? '1px 5px' : '2px 8px')};
  border: 1px solid var(--fam-organise-core);
  border-radius: var(--radius-chip);

  font-family: var(--face-mono);
  font-size: ${({ $size }) => ($size === 'sm' ? '10px' : 'var(--text-caption)')};
  color: var(--fam-organise-core);
  white-space: nowrap;
`;

export function LockBadge({
  size = 'sm',
  label = 'Private',
}: {
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <Badge $size={size}>
      <svg viewBox="0 0 12 12" width="9" height="9" fill="none" aria-hidden="true">
        <rect
          x="2"
          y="5"
          width="8"
          height="6"
          rx="1.2"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M4 5V3.6a2 2 0 0 1 4 0V5"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
      {label}
    </Badge>
  );
}
