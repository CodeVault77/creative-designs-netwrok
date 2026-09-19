'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  /** Optional single action, e.g. Undo after a destructive edit. */
  action?: { label: string; onPress: () => void };
  /** ms. 0 keeps it until dismissed — correct for anything with an action. */
  duration: number;
}

interface ToastContextValue {
  toasts: readonly Toast[];
  show: (toast: Omit<Toast, 'id' | 'tone' | 'duration'> & Partial<Toast>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}

const tones = {
  neutral: css`
    border-color: var(--ground-border);
  `,
  success: css`
    border-color: var(--color-success);
  `,
  warning: css`
    border-color: var(--color-warning);
  `,
  danger: css`
    border-color: var(--color-danger);
  `,
} as const;

const Region = styled.div`
  position: fixed;
  z-index: var(--z-toast);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(420px, calc(100vw - var(--space-8)));
  pointer-events: none;

  /*
   * Above the tab bar on mobile, bottom-left on desktop. Toasts must never
   * cover the map controls on the right (§16) — a confirmation that hides
   * the zoom control is a bad trade.
   */
  bottom: calc(72px + env(safe-area-inset-bottom, 0px) + var(--space-3));

  @media (min-width: 1024px) {
    left: var(--space-6);
    transform: none;
    bottom: var(--space-6);
  }
`;

const Item = styled.div<{ $tone: ToastTone }>`
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);

  background: var(--ground-surface);
  border: 1px solid var(--ground-border);
  border-left-width: 3px;
  border-radius: var(--radius-card);
  box-shadow: var(--elev-menu);
  color: var(--ground-ink);
  font-size: var(--text-body);
  pointer-events: auto;

  ${({ $tone }) => tones[$tone]}
  ${transition('sheet', 'transform', 'opacity')}

  animation: cdn-toast-in 280ms cubic-bezier(0.2, 0.9, 0.3, 1);

  @keyframes cdn-toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Message = styled.span`
  flex: 1;
  min-width: 0;
`;

const Action = styled.button`
  flex-shrink: 0;
  background: none;
  border: none;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-chip);
  color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  font: inherit;
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.tokens.familyRamp[theme.family].wash};
  }
`;

const Dismiss = styled.button`
  flex-shrink: 0;
  display: inline-flex;
  background: none;
  border: none;
  color: var(--ground-muted);
  cursor: pointer;
  padding: var(--space-1);

  &:hover {
    color: var(--ground-ink);
  }
`;

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ToastContextValue['show']>(
    (input) => {
      const id = input.id ?? `toast-${++counter}`;
      const toast: Toast = {
        id,
        message: input.message,
        tone: input.tone ?? 'neutral',
        duration: input.duration ?? (input.action ? 0 : 4000),
        ...(input.action ? { action: input.action } : {}),
      };

      setToasts((current) => [...current, toast]);

      if (toast.duration > 0) {
        setTimeout(() => dismiss(id), toast.duration);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        polite, not assertive: a save confirmation should not interrupt what a
        screen-reader user is reading. Errors that need immediate attention
        belong in the form, next to the field, not in a toast.
      */}
      <Region role="status" aria-live="polite">
        {toasts.map((toast) => (
          <Item key={toast.id} $tone={toast.tone}>
            <Message>{toast.message}</Message>
            {toast.action && (
              <Action
                onClick={() => {
                  toast.action?.onPress();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </Action>
            )}
            <Dismiss onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </Dismiss>
          </Item>
        ))}
      </Region>
    </ToastContext.Provider>
  );
}
