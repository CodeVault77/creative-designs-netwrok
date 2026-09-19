'use client';

import { forwardRef } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * SearchField — the pill-shaped input from §16.
 *
 * Its own component rather than a TextField with a shape prop, because search
 * carries behaviour a form field does not: a clear button that appears with
 * content, Escape to clear then close, and a `role="combobox"` relationship
 * with the suggestion list below it.
 */

const Wrap = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);

  height: ${({ theme }) => theme.tokens.control[theme.density].inputHeight};
  padding: 0 var(--space-3);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);

  ${transition('selection', 'border-color', 'box-shadow')}

  &:focus-within {
    border-color: var(--color-focus);
    box-shadow:
      0 0 0 1px var(--color-focus),
      ${({ theme }) => theme.tokens.glow.discover[1]};
  }
`;

const Icon = styled.span`
  display: inline-flex;
  color: var(--ground-muted);
  flex-shrink: 0;
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

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--ground-muted);
  }

  /* The browser's own clear button duplicates ours and cannot be styled. */
  &::-webkit-search-cancel-button {
    display: none;
  }
`;

const Clear = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  background: none;
  border: none;
  border-radius: var(--radius-circle);
  color: var(--ground-muted);
  cursor: pointer;

  &:hover {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.06);
  }
`;

const Spinner = styled.span`
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 2px solid var(--ground-border);
  border-top-color: var(--color-focus);
  border-radius: var(--radius-circle);
  animation: cdn-search-spin 700ms linear infinite;

  @keyframes cdn-search-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    border-top-color: var(--ground-border);
  }
`;

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose?: () => void;
  loading?: boolean;
  /** Wires the combobox relationship to the suggestion list. */
  listboxId?: string;
  expanded?: boolean;
  activeOptionId?: string;
  placeholder?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    {
      value,
      onChange,
      onSubmit,
      onClose,
      loading = false,
      listboxId,
      expanded = false,
      activeOptionId,
      placeholder = 'Search the network',
    },
    ref,
  ) {
    return (
      <Wrap>
        <Icon aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M11 11l3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </Icon>

        <Input
          ref={ref}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }
            if (event.key === 'Escape') {
              // Escape clears first and closes second. Closing straight away
              // discards a query someone may only have wanted to edit.
              if (value) onChange('');
              else onClose?.();
            }
          }}
          placeholder={placeholder}
          aria-label="Search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />

        {loading && <Spinner aria-hidden="true" />}

        {value && !loading && (
          <Clear onClick={() => onChange('')} aria-label="Clear search">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </Clear>
        )}
      </Wrap>
    );
  },
);
