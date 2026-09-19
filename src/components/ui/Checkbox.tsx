'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * Checkbox — a real input, styled.
 *
 * The native control is kept and given `accent-color` rather than hidden
 * behind a styled box. A visually-hidden input with a fake box has to
 * reimplement the focus ring, the indeterminate state, and forced-colors
 * mode — and it is the single most common place a form loses keyboard
 * usability for the sake of a rounded corner.
 *
 * Used for consent, which is legally meaningful (§9.2): the label must be
 * clickable, associated, and never pre-checked.
 */

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  /** ReactNode, so consent text can contain a link to the privacy policy. */
  label: ReactNode;
  hint?: string;
  error?: string;
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const Row = styled.label`
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  /* A comfortable target for the whole row, not just the 18px box. */
  min-height: var(--control-minHitTarget);
  padding-block: var(--space-1);
  cursor: pointer;
`;

const Box = styled.input`
  width: 20px;
  height: 20px;
  margin: 2px 0 0;
  flex-shrink: 0;

  accent-color: var(--fam-services-core);
  cursor: pointer;

  ${transition('selection', 'box-shadow')}

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Text = styled.span`
  font-size: var(--text-body);
  line-height: 1.45;
  color: var(--ground-ink);

  a {
    color: var(--fam-discover-core);
  }
`;

const Message = styled.p<{ $error: boolean }>`
  margin: 0;
  padding-left: calc(20px + var(--space-3));
  font-size: var(--text-caption);
  color: ${({ $error }) => ($error ? 'var(--color-danger)' : 'var(--ground-muted)')};
`;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, hint, error, id, ...rest }, ref) {
    const generated = useId();
    const fieldId = id ?? generated;
    const messageId = `${fieldId}-message`;
    const message = error ?? hint;

    return (
      <Wrapper>
        <Row htmlFor={fieldId}>
          <Box
            ref={ref}
            id={fieldId}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={message ? messageId : undefined}
            {...rest}
          />
          <Text>{label}</Text>
        </Row>

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
  },
);
