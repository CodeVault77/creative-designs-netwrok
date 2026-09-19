'use client';

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button } from '@/components/ui';
import { transition } from '@/lib/styles/motion';

/**
 * UrlField — §12 step 2 and step 3.
 *
 * "Large URL field, paste button, 2–3 example links" and then "inline
 * scheme/format check; favicon + page title resolve as a preview chip".
 *
 * The preview chip is the point of this component. §12 calls resolving the
 * title before processing "the trust moment": the user has handed us a link
 * and needs to see that we fetched the thing they meant, before committing to
 * fifteen seconds of processing.
 */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const Row = styled.div`
  display: flex;
  gap: var(--space-2);
  align-items: stretch;

  @media (max-width: 600px) {
    flex-direction: column;
  }
`;

const Field = styled.div<{ $invalid: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;

  padding: 0 var(--space-4);
  height: 56px;

  background: var(--ground-raised);
  border: 1px solid
    ${({ $invalid }) => ($invalid ? 'var(--color-danger)' : 'var(--ground-border)')};
  border-radius: var(--radius-pill);

  ${transition('selection', 'border-color', 'box-shadow')}

  &:focus-within {
    border-color: var(--color-focus);
    box-shadow: 0 0 0 1px var(--color-focus);
  }
`;

const Input = styled.input`
  flex: 1;
  min-width: 0;
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
`;

const Hint = styled.p<{ $tone: 'muted' | 'danger' }>`
  margin: 0;
  font-size: var(--text-caption);
  color: ${({ $tone }) =>
    $tone === 'danger' ? 'var(--color-danger)' : 'var(--ground-muted)'};
`;

const Examples = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
`;

const ExampleButton = styled.button`
  padding: var(--space-1) var(--space-3);
  background: none;
  border: 1px dashed var(--ground-border);
  border-radius: var(--radius-pill);
  color: var(--ground-muted);
  font-size: var(--text-caption);
  font-family: var(--face-body);
  cursor: pointer;

  ${transition('selection', 'color', 'border-color')}

  &:hover {
    color: var(--ground-ink);
    border-color: var(--color-focus);
  }
`;

const Chip = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
`;

const Favicon = styled.img`
  width: 20px;
  height: 20px;
  border-radius: var(--radius-chip);
  flex-shrink: 0;
`;

const ChipText = styled.div`
  min-width: 0;
  flex: 1;
`;

const ChipTitle = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ChipHost = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/**
 * §12: "Examples matter: they set expectations about what works (articles,
 * docs, product pages)."
 *
 * Three kinds, deliberately — one article, one documentation page, one
 * reference. A user who sees only news links assumes news links.
 */
export const EXAMPLES = [
  { label: 'A Wikipedia article', url: 'https://en.wikipedia.org/wiki/Mind_map' },
  {
    label: 'A docs page',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/grid',
  },
  { label: 'A standard', url: 'https://www.rfc-editor.org/rfc/rfc9309.html' },
];

export interface UrlPreview {
  ok: boolean;
  url?: string;
  title?: string;
  siteName?: string;
  favicon?: string;
  reason?: string;
  message?: string;
  paywalled?: boolean;
}

export interface UrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  preview: UrlPreview | null;
  resolving: boolean;
  disabled?: boolean;
  /** Copy for the primary action, so the retry screen can reuse this field. */
  actionLabel?: string;
}

/** A format check good enough to catch typing, not to replace the server. */
export function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export function UrlField({
  value,
  onChange,
  onSubmit,
  preview,
  resolving,
  disabled = false,
  actionLabel = 'Make a map',
}: UrlFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Only complain once the user has stopped typing and left something wrong
  // behind. Validating on every keystroke marks every URL invalid until its
  // final character.
  const invalid = touched && value.trim().length > 0 && !looksLikeUrl(value);

  const hint = (() => {
    if (invalid)
      return {
        tone: 'danger' as const,
        text: 'That does not look like a web address.',
      };
    if (preview && !preview.ok) {
      return {
        tone: 'danger' as const,
        text: preview.message ?? 'We could not read that address.',
      };
    }
    if (resolving) return { tone: 'muted' as const, text: 'Checking that link…' };
    return {
      tone: 'muted' as const,
      text: 'One public web page at a time. Batch links and PDFs are coming.',
    };
  })();

  return (
    <Wrap>
      <Row>
        <Field $invalid={invalid || preview?.ok === false}>
          <Input
            ref={inputRef}
            type="url"
            inputMode="url"
            value={value}
            placeholder="Paste a link"
            aria-label="Page address"
            aria-invalid={invalid || preview?.ok === false}
            aria-describedby="url-hint"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onBlur={() => setTouched(true)}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && looksLikeUrl(value)) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
        </Field>

        <Button
          onClick={onSubmit}
          disabled={disabled || !looksLikeUrl(value)}
          size="lg"
        >
          {actionLabel}
        </Button>
      </Row>

      <Hint id="url-hint" $tone={hint.tone}>
        {hint.text}
      </Hint>

      {preview?.ok && (
        <Chip>
          {preview.favicon && (
            <Favicon
              src={preview.favicon}
              alt=""
              // A missing favicon is the norm, not an error worth showing.
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          )}
          <ChipText>
            <ChipTitle>{preview.title}</ChipTitle>
            <ChipHost>{preview.siteName}</ChipHost>
          </ChipText>
        </Chip>
      )}

      <Examples>
        <Hint $tone="muted" as="span">
          Try:
        </Hint>
        {EXAMPLES.map((example) => (
          <ExampleButton
            key={example.url}
            type="button"
            onClick={() => {
              setTouched(false);
              onChange(example.url);
            }}
          >
            {example.label}
          </ExampleButton>
        ))}
      </Examples>
    </Wrap>
  );
}
