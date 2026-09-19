'use client';

import { useCallback, useId, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import { TextField } from '@/components/ui';
import { transition } from '@/lib/styles/motion';
import { strengthOf } from './authStrength';

/**
 * A password input with a visibility toggle and, on sign-up, a strength meter.
 *
 * Built ON TextField rather than beside it, so the focus treatment, the error
 * treatment, the hint/message wiring and the aria-describedby plumbing stay in
 * one place. It needs two things TextField did not have — an INTERACTIVE end
 * adornment (its `iconEnd` is aria-hidden, correctly, because it is for
 * decorative glyphs) and a control beside the label for "Forgot password?" —
 * so this ships alongside a small patch adding `actionEnd` and `labelAction`.
 *
 * The toggle is a real button with aria-pressed, not an icon that swaps on
 * click: someone using a screen reader needs to know the password is currently
 * visible, which is a state, not a picture.
 */

const ToggleButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  /* Full hit target inside a 48px field: the visual box is the icon, the
     touchable box is the whole square. */
  width: 44px;
  height: 44px;
  margin-right: calc(var(--space-3) * -1 + 2px);

  background: none;
  border: none;
  border-radius: var(--radius-control);
  color: var(--ground-muted);
  cursor: pointer;

  ${transition('selection', 'color', 'background-color')}

  &:hover {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.04);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
  }
`;

const Meter = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: 2px;
`;

const Bars = styled.div`
  display: flex;
  gap: 4px;
`;

const Bar = styled.span<{ $on: boolean; $color: string }>`
  flex: 1;
  height: 3px;
  border-radius: var(--radius-pill);
  background: ${({ $on, $color }) => ($on ? $color : 'var(--ground-border)')};

  ${transition('selection', 'background-color')}
`;

const MeterText = styled.p`
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const MeterLabel = styled.span<{ $color: string }>`
  font-family: var(--face-mono);
  color: ${({ $color }) => $color};
`;

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" />
      {off && <path d="M4 20 20 4" strokeLinecap="round" />}
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" strokeLinecap="round" />
    </svg>
  );
}

export interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** Sign-up: shows the length meter. */
  showStrength?: boolean;
  error?: string;
  hint?: string;
  placeholder?: string;
  autoComplete?: 'new-password' | 'current-password';
  /** Rendered beside the label — "Forgot password?" on sign-in. */
  labelAction?: ReactNode;
  required?: boolean;
  disabled?: boolean;
}

export function PasswordField({
  value,
  onChange,
  label = 'Password',
  showStrength = false,
  error,
  hint,
  placeholder,
  autoComplete = 'current-password',
  labelAction,
  required,
  disabled,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const meterId = useId();
  const strength = strengthOf(value);

  const toggle = useCallback(() => setVisible((v) => !v), []);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      <TextField
        label={label}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        iconStart={<LockIcon />}
        labelAction={labelAction}
        actionEnd={
          <ToggleButton
            type="button"
            onClick={toggle}
            aria-pressed={visible}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            <EyeIcon off={visible} />
          </ToggleButton>
        }
        {...(placeholder ? { placeholder } : {})}
        {...(error ? { error } : {})}
        {...(hint && !showStrength ? { hint } : {})}
        {...(showStrength ? { 'aria-describedby': meterId } : {})}
        required={required}
        disabled={disabled}
      />

      {showStrength && (
        <Meter>
          <Bars>
            {[1, 2, 3].map((step) => (
              <Bar
                key={step}
                $on={strength.level >= step}
                $color={strength.colorVar}
                aria-hidden="true"
              />
            ))}
          </Bars>
          {/*
            Polite, not assertive: this updates on every keystroke, and an
            assertive region would interrupt the user mid-word on each one.
          */}
          <MeterText id={meterId} aria-live="polite">
            <MeterLabel $color={strength.colorVar}>{strength.label}</MeterLabel>
            <span aria-hidden="true">·</span>
            <span>{strength.hint}</span>
          </MeterText>
        </Meter>
      )}
    </div>
  );
}
