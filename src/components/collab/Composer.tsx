'use client';

import { useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button } from '@/components/ui';

/**
 * Composer — the chat input, with `#` node mentions (§15).
 *
 * The mention list is the only real complexity, and it earns its place: §15
 * calls the node chip "what makes it map chat rather than a chat box", and a
 * chip nobody can produce because they would have to know a node id is not a
 * feature.
 */

const Wrap = styled.form`
  position: relative;
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
  padding-top: var(--space-2);
  border-top: 1px solid var(--ground-border);
`;

const Input = styled.textarea`
  flex: 1;
  min-height: 40px;
  max-height: 140px;
  padding: var(--space-2) var(--space-3);
  resize: none;

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);
  line-height: 1.4;

  &:focus {
    outline: none;
    border-color: var(--color-focus);
  }
`;

const Menu = styled.ul`
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 0;
  right: 0;
  z-index: 3;

  margin: 0;
  padding: var(--space-1);
  list-style: none;
  max-height: 200px;
  overflow-y: auto;

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  box-shadow: var(--elev-menu);
`;

const Option = styled.li<{ $active: boolean }>`
  padding: var(--space-2);
  border-radius: var(--radius-chip);
  cursor: pointer;
  font-size: var(--text-body);
  color: var(--ground-ink);
  background: ${({ $active }) => ($active ? 'rgba(255,255,255,0.07)' : 'transparent')};
`;

export interface ComposerNode {
  id: string;
  title: string;
}

export interface ComposerProps {
  nodes: readonly ComposerNode[];
  onSend: (body: string) => Promise<string | null>;
  disabled?: boolean;
  placeholder?: string;
}

export function Composer({ nodes, onSend, disabled, placeholder }: ComposerProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * The token currently being typed after a `#`, if the caret is inside one.
   *
   * Matched against the END of the text rather than anywhere in it, so the
   * menu appears while typing a mention and disappears once the user has moved
   * on to the rest of the sentence.
   */
  const query = useMemo(() => {
    const match = value.match(/#([\w-]*)$/);
    return match ? match[1]!.toLowerCase() : null;
  }, [value]);

  const matches = useMemo(() => {
    if (query === null) return [];
    return nodes
      .filter((node) => node.title.toLowerCase().includes(query))
      .slice(0, 6);
  }, [nodes, query]);

  const choose = (node: ComposerNode) => {
    // The real id is inserted, so the server resolves the reference without
    // guessing from a title that may not be unique.
    setValue((current) => current.replace(/#[\w-]*$/, `#${node.id} `));
    setHighlight(0);
    inputRef.current?.focus();
  };

  const submit = async () => {
    const body = value.trim();
    if (!body || busy) return;

    setBusy(true);
    const error = await onSend(body);
    setBusy(false);

    // The text is kept on failure. Clearing it would throw away what someone
    // just wrote because the network blinked.
    if (!error) setValue('');
  };

  return (
    <Wrap
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {matches.length > 0 && (
        <Menu role="listbox" aria-label="Mention a node">
          {matches.map((node, index) => (
            <Option
              key={node.id}
              role="option"
              aria-selected={index === highlight}
              $active={index === highlight}
              // onMouseDown, not onClick: click fires after blur, by which
              // point the textarea has lost the caret the insert depends on.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(node);
              }}
            >
              {node.title}
            </Option>
          ))}
        </Menu>
      )}

      <Input
        ref={inputRef}
        value={value}
        disabled={disabled || busy}
        placeholder={placeholder ?? 'Message the map — type # to mention a node'}
        aria-label="Message"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (matches.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlight((h) => (h + 1) % matches.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((h) => (h - 1 + matches.length) % matches.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              choose(matches[highlight]!);
              return;
            }
            if (event.key === 'Escape') {
              setValue((current) => `${current} `);
              return;
            }
          }

          // Enter sends; Shift+Enter is a newline. The opposite convention
          // makes a chat box feel like a form.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      <Button
        type="submit"
        disabled={disabled || busy || !value.trim()}
        loading={busy}
      >
        Send
      </Button>
    </Wrap>
  );
}
