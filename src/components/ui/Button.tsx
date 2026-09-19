'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { FamilyName } from '@/lib/styles/tokens.generated';
import type { AppTheme } from '@/lib/styles/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Overrides the family from context. Primary and destructive use it for hue. */
  family?: FamilyName;
  /** Stretches to the container width. Standard for mobile sheet actions. */
  fullWidth?: boolean;
  /**
   * Shows a spinner and blocks interaction, without collapsing the label —
   * a button that changes width mid-press moves the target under the finger.
   */
  loading?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
}

/**
 * §16: "Primary = family-hue fill at 12% + 1.5px hue stroke + ink label +
 * glow-1. A solid neon fill would blow out on black."
 *
 * That rule is the whole reason this component looks the way it does. On a
 * pure black ground a saturated fill at full strength loses its label and
 * bleeds into the surrounding pixels. The wash-plus-stroke treatment keeps
 * the hue legible as identity while the ink label stays readable.
 */
/**
 * The family a button paints with: the explicit prop when given, otherwise the
 * ambient one from context.
 *
 * The `family` prop was documented as an override from P1 but was never read —
 * every primary button painted in the context family regardless. It surfaced
 * as an orange Services node offering a cyan Open button.
 */
const famOf = (props: { theme: AppTheme; $family?: FamilyName }): FamilyName =>
  props.$family ?? props.theme.family;

const variants = {
  primary: css<{ $family?: FamilyName }>`
    background: ${(p) => p.theme.tokens.familyRamp[famOf(p)].wash};
    border: 1.5px solid ${(p) => p.theme.tokens.familyRamp[famOf(p)].core};
    color: var(--ground-ink);
    box-shadow: ${(p) => p.theme.tokens.glow[famOf(p)][1]};

    &:hover:not(:disabled) {
      background: ${(p) => p.theme.tokens.familyRamp[famOf(p)].glow};
      box-shadow: ${(p) => p.theme.tokens.glow[famOf(p)][2]};
    }

    &:active:not(:disabled) {
      transform: translateY(1px);
      box-shadow: ${(p) => p.theme.tokens.glow[famOf(p)][1]};
    }
  `,

  secondary: css<{ $family?: FamilyName }>`
    background: transparent;
    border: 1px solid var(--ground-border);
    color: var(--ground-ink);

    &:hover:not(:disabled) {
      border-color: ${(p) => p.theme.tokens.familyRamp[famOf(p)].core};
      background: ${(p) => p.theme.tokens.familyRamp[famOf(p)].wash};
    }

    &:active:not(:disabled) {
      transform: translateY(1px);
    }
  `,

  ghost: css`
    background: transparent;
    border: 1px solid transparent;
    color: var(--ground-muted);

    &:hover:not(:disabled) {
      color: var(--ground-ink);
      background: rgba(255, 255, 255, 0.04);
    }
  `,

  destructive: css`
    background: transparent;
    border: 1.5px solid var(--color-danger);
    color: var(--color-danger);

    /* Fills only on press — §16. A permanently filled destructive button
       reads as the primary action, which is exactly wrong. */
    &:hover:not(:disabled) {
      background: rgba(255, 77, 109, 0.08);
    }

    &:active:not(:disabled) {
      background: var(--color-danger);
      color: var(--ground-canvas);
    }
  `,
} as const;

/**
 * Heights come from the active control set, so the same markup is 48px on
 * touch and 40px on pointer with no per-screen overrides. `sm` and `lg` shift
 * relative to that rather than being absolute.
 */
const sizes = {
  /**
   * A chip-height action, for a control that sits beside a heading rather than
   * inside a form — "New map" against the My Maps title, where the default
   * height rivalled the title itself and pulled more attention than the list
   * the screen exists to show.
   *
   * Safe to make this short because the `::after` below presents a full
   * minHitTarget touch area regardless of the visual box, so shrinking the
   * button never shrinks the thing a thumb has to find.
   */
  xs: css`
    height: calc(
      ${({ theme }) => theme.tokens.control[theme.density].buttonHeight} - 16px
    );
    padding: 0 var(--space-3);
    font-size: var(--text-label);
  `,
  sm: css`
    height: calc(
      ${({ theme }) => theme.tokens.control[theme.density].buttonHeight} - 8px
    );
    padding: 0 var(--space-3);
    font-size: var(--text-label);
  `,
  md: css`
    height: ${({ theme }) => theme.tokens.control[theme.density].buttonHeight};
    padding: 0 var(--space-4);
    font-size: var(--text-body);
  `,
  lg: css`
    height: calc(
      ${({ theme }) => theme.tokens.control[theme.density].buttonHeight} + 8px
    );
    padding: 0 var(--space-6);
    font-size: var(--text-body);
  `,
} as const;

const StyledButton = styled.button<{
  $variant: ButtonVariant;
  $size: ButtonSize;
  $fullWidth: boolean;
  $loading: boolean;
  $family?: FamilyName;
}>`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);

  font-family: var(--face-body);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  line-height: 1;
  white-space: nowrap;

  border-radius: var(--radius-control);
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;

  ${({ $size }) => sizes[$size]}
  ${({ $variant }) => variants[$variant]}
  ${({ $fullWidth }) =>
    $fullWidth &&
    css`
      width: 100%;
    `}

  ${transition('selection', 'background-color', 'border-color', 'box-shadow', 'color', 'transform')}

  /*
   * Guarantees the §17 hit target without changing layout. The button can be
   * visually 40px inside a dense toolbar while still presenting an 88px touch
   * target on a phone — hit geometry separate from visual geometry, the same
   * principle the map renderer uses for nodes (§10).
   */
  &::after {
    content: '';
    position: absolute;
    inset: 50% 0 0 0;
    height: ${({ theme }) => theme.tokens.control[theme.density].minHitTarget};
    transform: translateY(-50%);
    pointer-events: auto;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }

  ${({ $loading }) =>
    $loading &&
    css`
      cursor: progress;
      pointer-events: none;
    `}
`;

/**
 * Label stays in place and keeps its width while the spinner shows.
 *
 * `opacity: 0`, not `visibility: hidden` — visibility removes the element
 * from the accessibility tree, which would leave a loading button with no
 * accessible name at all. Opacity hides it visually while keeping both the
 * layout box and the screen-reader text.
 */
const Label = styled.span<{ $hidden: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  opacity: ${({ $hidden }) => ($hidden ? 0 : 1)};
`;

const Spinner = styled.span`
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: var(--radius-circle);
  animation: cdn-spin 640ms linear infinite;

  @keyframes cdn-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Reduced motion: the spinner still communicates busy, it just stops
     rotating. A static ring plus aria-busy carries the meaning. */
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    border-top-color: currentColor;
    opacity: 0.6;
  }
`;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    fullWidth = false,
    loading = false,
    family,
    disabled,
    iconStart,
    iconEnd,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <StyledButton
      ref={ref}
      type={type}
      $variant={variant}
      $size={size}
      $fullWidth={fullWidth}
      $loading={loading}
      {...(family ? { $family: family } : {})}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner aria-hidden="true" />}
      <Label $hidden={loading}>
        {iconStart}
        {children}
        {iconEnd}
      </Label>
    </StyledButton>
  );
});
