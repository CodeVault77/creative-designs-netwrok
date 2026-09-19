'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';

export type FieldState = 'default' | 'error' | 'disabled';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size'
> {
  label: string;
  /** Visually hides the label but keeps it for screen readers. */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  /** Pill-shaped, for the search field only (§16). */
  shape?: 'control' | 'pill';
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  /**
   * An INTERACTIVE end adornment — a password visibility toggle, a clear
   * button.
   *
   * Separate from `iconEnd` because that one is wrapped in `aria-hidden`,
   * which is right for a decorative glyph and wrong for a control: a button
   * inside an aria-hidden container is invisible to a screen reader while
   * still being focusable, which is the worst of both.
   */
  actionEnd?: ReactNode;
  /**
   * A control rendered on the label's row, right-aligned — "Forgot password?".
   *
   * It belongs to the field, so it lives inside the field's own layout rather
   * than being positioned over it by the caller. Putting it here also keeps
   * the label and the link on one baseline at every text size.
   */
  labelAction?: ReactNode;
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
`;

/** Holds the label and its optional action on one row. */
const LabelRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
`;

const LabelText = styled.label<{ $hidden: boolean }>`
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  color: var(--ground-muted);

  ${({ $hidden }) =>
    $hidden &&
    css`
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    `}
`;

const Field = styled.div<{ $state: FieldState; $shape: 'control' | 'pill' }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);

  height: ${({ theme }) => theme.tokens.control[theme.density].inputHeight};
  padding: 0 var(--space-3);

  background: var(--ground-raised);
  border: 1px solid
    ${({ $state }) =>
      $state === 'error' ? 'var(--color-danger)' : 'var(--ground-border)'};
  border-radius: ${({ $shape }) =>
    $shape === 'pill' ? 'var(--radius-pill)' : 'var(--radius-control)'};

  ${transition('selection', 'border-color', 'box-shadow')}

  /*
   * Focus is always cyan, never the family hue — §16. If focus borrowed the
   * family colour it would be indistinguishable from family state on a
   * family-themed panel, and focus must never be ambiguous.
   */
  &:focus-within {
    border-color: var(--color-focus);
    box-shadow:
      0 0 0 1px var(--color-focus),
      ${({ theme }) => theme.tokens.glow.discover[1]};
  }

  ${({ $state }) =>
    $state === 'error' &&
    css`
      &:focus-within {
        border-color: var(--color-danger);
        box-shadow:
          0 0 0 1px var(--color-danger),
          0 0 10px rgba(255, 77, 109, 0.35);
      }
    `}

  ${({ $state }) =>
    $state === 'disabled' &&
    css`
      opacity: 0.45;
      cursor: not-allowed;
    `}
`;

const Input = styled.input`
  flex: 1;
  min-width: 0;
  height: 100%;
  background: none;
  border: none;
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);

  /* The Field draws the focus treatment; a second ring inside it is noise. */
  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--ground-muted);
  }

  &:disabled {
    cursor: not-allowed;
  }
`;

const Adornment = styled.span`
  display: inline-flex;
  align-items: center;
  color: var(--ground-muted);
  flex-shrink: 0;
`;

const Message = styled.p<{ $error: boolean }>`
  margin: 0;
  font-size: var(--text-caption);
  color: ${({ $error }) => ($error ? 'var(--color-danger)' : 'var(--ground-muted)')};
`;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      label,
      hideLabel = false,
      hint,
      error,
      shape = 'control',
      iconStart,
      iconEnd,
      actionEnd,
      labelAction,
      disabled,
      id,
      ...rest
    },
    ref,
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const messageId = `${inputId}-message`;

    const state: FieldState = disabled ? 'disabled' : error ? 'error' : 'default';
    const message = error ?? hint;

    return (
      <Wrapper>
        <LabelRow>
          <LabelText htmlFor={inputId} $hidden={hideLabel}>
            {label}
          </LabelText>
          {labelAction}
        </LabelRow>

        <Field $state={state} $shape={shape}>
          {iconStart && <Adornment aria-hidden="true">{iconStart}</Adornment>}
          <Input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={message ? messageId : undefined}
            {...rest}
          />
          {iconEnd && <Adornment aria-hidden="true">{iconEnd}</Adornment>}
          {/* Not aria-hidden — see `actionEnd` on the props. */}
          {actionEnd && <Adornment>{actionEnd}</Adornment>}
        </Field>

        {message && (
          <Message
            id={messageId}
            $error={Boolean(error)}
            /* Errors are announced; hints are not, because a hint that
               interrupts on every keystroke is worse than silence. */
            role={error ? 'alert' : undefined}
          >
            {message}
          </Message>
        )}
      </Wrapper>
    );
  },
);
