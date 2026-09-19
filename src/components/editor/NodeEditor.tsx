'use client';

import { useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { Button, TextField } from '@/components/ui';
import { ColorFamilyPicker, IconPicker, TypePicker } from './pickers';
import type { DraftNode } from '@/lib/editor/types';
import type { NodeType } from '@/lib/map/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * Screen 10 — the node editor, rendered as the `edit` mode of the detail
 * panel.
 *
 * ── The form half of the undo risk ──────────────────────────────────────────
 *
 * This is a fully CONTROLLED form driven by the draft. Not a local copy that
 * syncs back on blur.
 *
 * That matters because of undo. If the form kept its own state, pressing
 * Cmd+Z while a title field had focus would revert the draft and leave the
 * input showing the old text — the two surfaces would visibly disagree, and
 * the next keystroke would write the stale value back. Reading straight from
 * the draft means undo updates the field for free.
 *
 * The cost is one command per keystroke, which is exactly what the coalescing
 * in `stack.ts` exists to absorb.
 */

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const Row = styled.div`
  display: flex;
  gap: var(--space-2);
`;

const Divider = styled.hr`
  margin: 0;
  border: none;
  border-top: 1px solid var(--ground-border);
`;

const DangerZone = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const Hint = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  line-height: 1.5;
`;

export interface NodeEditorProps {
  node: DraftNode;
  /** Descendant count, so delete can warn before taking a subtree. */
  descendantCount: number;
  isRoot: boolean;
  onChange: (field: keyof DraftNode, value: unknown) => void;
  /** Ends the coalescing run — called on blur. */
  onCommit: () => void;
  onDelete: () => void;
  readOnly?: boolean;
  /** §08 screen 10 permission state: a commenter gets the comment field only. */
  commentOnly?: boolean;
}

export function NodeEditor({
  node,
  descendantCount,
  isRoot,
  onChange,
  onCommit,
  onDelete,
  readOnly = false,
  commentOnly = false,
}: NodeEditorProps) {
  const titleRef = useRef<HTMLInputElement>(null);

  /**
   * Move the cursor into the title whenever a NEW, untitled node is selected.
   *
   * §14: "Centre node opens in edit state, cursor in the title field." The
   * §20 criterion — ten nodes in three minutes — depends on add → type → add
   * flowing without reaching for the mouse.
   *
   * `autoFocus` alone is not enough: it only fires on mount, and adding a
   * second node while the panel is already open is an update, not a mount. So
   * focus stayed on the + button and every new node needed a click into the
   * field before typing. Keyed on the node id so it fires per node, and
   * guarded on an empty title so it never steals the cursor from someone
   * editing an existing node.
   */
  useEffect(() => {
    if (readOnly || commentOnly) return;
    if (node.title !== '') return;
    titleRef.current?.focus();
  }, [node.id, node.title, readOnly, commentOnly]);

  const confirmDelete = useCallback(() => {
    // §14: "Confirm only when children exist: 'Delete this and 4 nodes under
    // it?'" A confirmation on every delete makes building a map exhausting;
    // none at all makes losing a subtree a single mis-tap. The line is drawn
    // at how expensive the mistake is.
    if (descendantCount > 0) {
      const ok = window.confirm(
        `Delete this and ${descendantCount} node${descendantCount === 1 ? '' : 's'} under it?`,
      );
      if (!ok) return;
    }
    onDelete();
  }, [descendantCount, onDelete]);

  if (commentOnly) {
    return (
      <Form>
        <Hint>You can comment on this map, but not change it.</Hint>
      </Form>
    );
  }

  return (
    <Form>
      <TextField
        ref={titleRef}
        label="Title"
        value={node.title}
        onChange={(event) => onChange('title', event.target.value)}
        onBlur={onCommit}
        placeholder="What is this node?"
        maxLength={60}
        disabled={readOnly}
      />

      <TextField
        label="Description"
        value={node.description ?? ''}
        onChange={(event) =>
          onChange('description', event.target.value || undefined)
        }
        onBlur={onCommit}
        placeholder="Optional"
        maxLength={2000}
        disabled={readOnly}
      />

      {/*
        A link field only where a link means something. Showing it on every
        node type teaches people to skip the form.
      */}
      {(node.type === 'link' || node.href) && (
        <TextField
          label="Link"
          type="url"
          value={node.href ?? ''}
          onChange={(event) => onChange('href', event.target.value || undefined)}
          onBlur={onCommit}
          placeholder="https://"
          disabled={readOnly}
          {...(node.href && !isValidUrl(node.href)
            ? { error: 'That does not look like a web address' }
            : {})}
        />
      )}

      <TypePicker
        value={node.type}
        onChange={(type: NodeType) => {
          onChange('type', type);
          onCommit();
        }}
        disabled={readOnly}
      />

      <ColorFamilyPicker
        value={node.family}
        onChange={(family: FamilyName) => {
          onChange('family', family);
          onCommit();
        }}
        disabled={readOnly}
      />

      <IconPicker
        value={node.icon}
        onChange={(icon) => {
          onChange('icon', icon);
          onCommit();
        }}
        disabled={readOnly}
      />

      {!isRoot && !readOnly && (
        <>
          <Divider />
          <DangerZone>
            <Row>
              <Button variant="destructive" onClick={confirmDelete}>
                Delete node
              </Button>
            </Row>
            <Hint>
              {descendantCount > 0
                ? `This will also delete ${descendantCount} node${descendantCount === 1 ? '' : 's'} under it.`
                : 'You can undo this for 10 seconds.'}
            </Hint>
          </DangerZone>
        </>
      )}

      {isRoot && (
        <Hint>
          This is the centre of your map. It carries the map&apos;s name and cannot
          be deleted.
        </Hint>
      )}
    </Form>
  );
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
