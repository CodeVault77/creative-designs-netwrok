'use client';

import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * Textarea — multi-line input with the TextField contract.
 *
 * Same label/hint/error wiring as TextField and Select, plus an optional
 * character counter for fields with a real limit.
 */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  /**
   * Shows "n / max" under the field. Only worth it where the limit is close
   * enough to matter — a counter on a field nobody will fill is noise.
   */
  showCount?: boolean;
  rows?: number;
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
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
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    `}
`;

const Control = styled.textarea<{ $error: boolean }>`
  width: 100%;
  padding: var(--space-3);
  /* Vertical only: horizontal resize breaks the column it sits in. */
  resize: vertical;

  background: var(--ground-raised);
  border: 1px solid
    ${({ $error }) => ($error ? 'var(--color-danger)' : 'var(--ground-border)')};
  border-radius: var(--radius-control);

  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);
  line-height: 1.5;

  ${transition('selection', 'border-color', 'box-shadow')}

  &::placeholder {
    color: var(--ground-muted);
  }

  &:focus {
    outline: none;
    border-color: var(--color-focus);
    box-shadow: 0 0 0 1px var(--color-focus);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Footer = styled.div`
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
`;

const Message = styled.p<{ $error: boolean }>`
  margin: 0;
  font-size: var(--text-caption);
  color: ${({ $error }) => ($error ? 'var(--color-danger)' : 'var(--ground-muted)')};
`;

const Count = styled.span<{ $near: boolean }>`
  flex-shrink: 0;
  font-size: var(--text-caption);
  font-variant-numeric: tabular-nums;
  color: ${({ $near }) => ($near ? 'var(--color-warning)' : 'var(--ground-muted)')};
`;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      hideLabel = false,
      hint,
      error,
      showCount = false,
      rows = 6,
      id,
      disabled,
      value,
      maxLength,
      ...rest
    },
    ref,
  ) {
    const generated = useId();
    const fieldId = id ?? generated;
    const messageId = `${fieldId}-message`;
    const message = error ?? hint;

    const length = typeof value === 'string' ? value.length : 0;
    const near = maxLength !== undefined && length > maxLength * 0.9;

    return (
      <Wrapper>
        <LabelText htmlFor={fieldId} $hidden={hideLabel}>
          {label}
        </LabelText>

        <Control
          ref={ref}
          id={fieldId}
          rows={rows}
          disabled={disabled}
          value={value}
          maxLength={maxLength}
          $error={Boolean(error)}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          {...rest}
        />

        {(message || (showCount && maxLength)) && (
          <Footer>
            {message ? (
              <Message
                id={messageId}
                $error={Boolean(error)}
                role={error ? 'alert' : undefined}
              >
                {message}
              </Message>
            ) : (
              <span />
            )}

            {showCount && maxLength && (
              /*
               * aria-hidden: a counter updating on every keystroke is noise in a
               * screen reader, and the limit is already enforced by maxLength
               * and stated in the hint.
               */
              <Count $near={near} aria-hidden="true">
                {length} / {maxLength}
              </Count>
            )}
          </Footer>
        )}
      </Wrapper>
    );
  },
);
