'use client';

import { useState } from 'react';
import styled, { css } from 'styled-components';
import type { FamilyName } from '@/lib/styles/tokens.generated';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  /** Ring hue. Used for presence and for map-admin identification. */
  family?: FamilyName;
  /** Live presence ring — P11 collaboration. */
  present?: boolean;
  /** Shows a shield for map admins and staff (§10 admin-owned). */
  admin?: boolean;
}

const dimensions: Record<AvatarSize, string> = {
  sm: '24px',
  md: '32px',
  lg: '48px',
};

const Root = styled.span<{ $size: AvatarSize; $present: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  width: ${({ $size }) => dimensions[$size]};
  height: ${({ $size }) => dimensions[$size]};

  border-radius: var(--radius-circle);
  background: var(--ground-raised);
  overflow: visible;

  ${({ $present, theme }) =>
    $present &&
    css`
      box-shadow:
        0 0 0 2px var(--ground-background),
        0 0 0 4px ${theme.tokens.familyRamp[theme.family].core};
    `}
`;

const Image = styled.img`
  width: 100%;
  height: 100%;
  border-radius: var(--radius-circle);
  object-fit: cover;
`;

const Initials = styled.span<{ $size: AvatarSize }>`
  font-family: var(--face-display);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
  font-size: ${({ $size }) =>
    $size === 'lg' ? '18px' : $size === 'md' ? '13px' : '10px'};
  letter-spacing: 0.02em;
  color: var(--ground-ink);
  user-select: none;
`;

const Badge = styled.span`
  position: absolute;
  right: -2px;
  bottom: -2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: var(--radius-circle);
  background: var(--ground-background);
  color: var(--fam-create-core);
`;

/**
 * Derives up to two initials from a display name.
 * Handles single names, extra whitespace and non-Latin scripts by simply
 * taking first characters rather than assuming a Western name structure.
 */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return [...parts[0]!].slice(0, 2).join('').toUpperCase();
  return ([...parts[0]!][0]! + [...parts[parts.length - 1]!][0]!).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 'md',
  present = false,
  admin = false,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;

  return (
    <Root $size={size} $present={present} title={name}>
      {showImage ? (
        <Image src={src} alt={name} onError={() => setFailed(true)} />
      ) : (
        // Initials are decorative when the name is already in the row beside
        // it; the accessible name comes from the title on the root.
        <Initials $size={size} aria-hidden="true">
          {initialsFrom(name)}
        </Initials>
      )}
      {admin && (
        <Badge aria-label="Administrator">
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
            <path
              d="M6 1.5 9.5 3v3c0 2-1.6 3.7-3.5 4.5C4.1 9.7 2.5 8 2.5 6V3L6 1.5Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        </Badge>
      )}
    </Root>
  );
}
