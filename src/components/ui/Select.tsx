'use client';

import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * Select — a native `<select>` with the TextField chrome.
 *
 * Native, deliberately. A custom listbox has to reimplement keyboard
 * navigation, type-ahead, touch behaviour and the platform picker that mobile
 * users already know — and every one of those is a place to introduce an
 * accessibility bug. The only thing wrong with a native select is that it
 * looks unstyled, and that is fixable without replacing it.
 *
 * Mirrors `TextFieldProps` so the two are interchangeable in a form: same
 * label/hint/error contract, same message wiring, same disabled treatment.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'size'
> {
  label: string;
  options: readonly SelectOption[];
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  /** Rendered as a disabled first option, so the field starts genuinely empty. */
  placeholder?: string;
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

const Field = styled.div<{ $error: boolean }>`
  position: relative;
  display: flex;
  align-items: center;

  background: var(--ground-raised);
  border: 1px solid
    ${({ $error }) => ($error ? 'var(--color-danger)' : 'var(--ground-border)')};
  border-radius: var(--radius-control);

  ${transition('selection', 'border-color', 'box-shadow')}

  &:focus-within {
    border-color: var(--color-focus);
    box-shadow: 0 0 0 1px var(--color-focus);
  }
`;

const Control = styled.select`
  appearance: none;
  width: 100%;
  min-height: ${({ theme }) => theme.tokens.control[theme.density].inputHeight};
  /* Right padding leaves room for the chevron, which is decorative. */
  padding: 0 var(--space-8) 0 var(--space-3);

  background: none;
  border: none;
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);
  cursor: pointer;

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /*
   * The dropdown itself is drawn by the OS and does not inherit page colours.
   * Setting them here is what stops a dark-UI select rendering white-on-white
   * options on some platforms.
   */
  option {
    background: var(--ground-surface);
    color: var(--ground-ink);
  }
`;

const Chevron = styled.span`
  position: absolute;
  right: var(--space-3);
  display: inline-flex;
  color: var(--ground-muted);
  pointer-events: none;
`;

const Message = styled.p<{ $error: boolean }>`
  margin: 0;
  font-size: var(--text-caption);
  color: ${({ $error }) => ($error ? 'var(--color-danger)' : 'var(--ground-muted)')};
`;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    hideLabel = false,
    hint,
    error,
    placeholder,
    id,
    disabled,
    ...rest
  },
  ref,
) {
  const generated = useId();
  const selectId = id ?? generated;
  const messageId = `${selectId}-message`;
  const message = error ?? hint;

  return (
    <Wrapper>
      <LabelText htmlFor={selectId} $hidden={hideLabel}>
        {label}
      </LabelText>

      <Field $error={Boolean(error)}>
        <Control
          ref={ref}
          id={selectId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Control>

        <Chevron aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Chevron>
      </Field>

      {message && (
        <Message
          id={messageId}
          $error={Boolean(error)}
          role={error ? 'alert' : undefined}
        >
          {message}
        </Message>
      )}
    </Wrapper>
  );
});
