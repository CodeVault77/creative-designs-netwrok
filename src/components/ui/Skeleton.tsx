'use client';

import styled, { css } from 'styled-components';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  shape?: 'text' | 'block' | 'circle';
  /** Number of stacked lines. Only meaningful for shape="text". */
  lines?: number;
}

/**
 * Loading placeholder.
 *
 * The shimmer is a background-position animation on a gradient rather than an
 * opacity pulse, because a pulse on a dark ground reads as flicker. Under
 * reduced motion it becomes a flat fill — still clearly a placeholder, no
 * movement.
 *
 * Use this where the shape of the content is known. Where it is not, a
 * spinner is more honest than a skeleton that guesses wrong.
 */
const Base = styled.span<{ $shape: 'text' | 'block' | 'circle' }>`
  display: block;
  position: relative;
  overflow: hidden;
  background: var(--ground-raised);

  ${({ $shape }) =>
    $shape === 'circle'
      ? css`
          border-radius: var(--radius-circle);
        `
      : $shape === 'text'
        ? css`
            border-radius: var(--radius-chip);
          `
        : css`
            border-radius: var(--radius-card);
          `}

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.05) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: cdn-shimmer 1400ms ease-in-out infinite;
  }

  @keyframes cdn-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
      background: none;
    }
  }
`;

const Stack = styled.span`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

function toCss(value: string | number | undefined, fallback: string) {
  if (value === undefined) return fallback;
  return typeof value === 'number' ? `${value}px` : value;
}

export function Skeleton({
  width,
  height,
  shape = 'text',
  lines = 1,
}: SkeletonProps) {
  const defaultHeight = shape === 'text' ? '1em' : '100%';

  const style = {
    width: toCss(width, '100%'),
    height: toCss(height, defaultHeight),
  };

  if (shape === 'text' && lines > 1) {
    return (
      // One aria-busy container, not one per line — a screen reader should
      // hear "loading" once, not five times.
      <Stack aria-busy="true" aria-live="polite" aria-label="Loading">
        {Array.from({ length: lines }, (_, index) => (
          <Base
            key={index}
            $shape="text"
            style={{
              ...style,
              // Last line short, so the block reads as prose rather than a bar
              width: index === lines - 1 ? '60%' : style.width,
            }}
          />
        ))}
      </Stack>
    );
  }

  return (
    <Base $shape={shape} style={style} aria-busy="true" aria-label="Loading" />
  );
}
