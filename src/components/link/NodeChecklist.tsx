'use client';

import { useState } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { StructuredNode } from '@/lib/ingest/structure';
import { pathId, walk } from '@/lib/ingest/to-draft';

/**
 * NodeChecklist — §12 steps 5 and 6.
 *
 * "a side checklist of proposed nodes" whose editing is limited to four
 * things: "Toggle nodes off, rename inline, merge two into one, drag to
 * reparent. Keep it to these four. Full editing happens after save, in the
 * real editor."
 *
 * That limit is the design. Everything this screen can do, the P5 editor can
 * do better; the checklist exists to let someone reject a bad proposal in ten
 * seconds, not to become a second editor that has to keep pace with the first.
 *
 * Reparenting is handled on the MAP, not here — dragging a row in a list to
 * express "make this a child of that" is a worse gesture than dragging the
 * node itself, and the map is right there.
 */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const Head = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
`;

const Title = styled.h2`
  margin: 0;
  font-size: var(--text-title);
  font-family: var(--face-display);
  color: var(--ground-ink);
`;

const Count = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const List = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Row = styled.li<{ $depth: number; $off: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--space-2);

  padding: var(--space-2);
  padding-left: calc(var(--space-2) + ${({ $depth }) => $depth * 18}px);
  border-radius: var(--radius-chip);

  opacity: ${({ $off }) => ($off ? 0.4 : 1)};
  ${transition('selection', 'background', 'opacity')}

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }
`;

const Check = styled.input`
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  accent-color: var(--fam-create-core);
  cursor: pointer;
`;

const Label = styled.span<{ $off: boolean }>`
  flex: 1;
  min-width: 0;
  font-size: var(--text-body);
  color: var(--ground-ink);
  text-decoration: ${({ $off }) => ($off ? 'line-through' : 'none')};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
`;

const Rename = styled.input`
  flex: 1;
  min-width: 0;
  padding: 2px var(--space-2);
  background: var(--ground-background);
  border: 1px solid var(--color-focus);
  border-radius: var(--radius-chip);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);

  &:focus {
    outline: none;
  }
`;

const MergeButton = styled.button`
  flex-shrink: 0;
  padding: 2px var(--space-2);
  background: none;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  color: var(--ground-muted);
  font-size: var(--text-caption);
  font-family: var(--face-body);
  cursor: pointer;

  &:hover {
    color: var(--ground-ink);
    border-color: var(--color-focus);
  }
`;

export interface NodeChecklistProps {
  root: StructuredNode;
  depth: number;
  excluded: ReadonlySet<string>;
  renamed: ReadonlyMap<string, string>;
  onToggle: (id: string) => void;
  onRename: (id: string, title: string) => void;
  /** Merge this node INTO the row above it, at the same level. */
  onMerge: (id: string) => void;
  /** Selecting a row highlights the same node on the map beside it. */
  onSelect?: (id: string) => void;
}

export function NodeChecklist({
  root,
  depth,
  excluded,
  renamed,
  onToggle,
  onRename,
  onMerge,
  onSelect,
}: NodeChecklistProps) {
  const [editing, setEditing] = useState<string | null>(null);

  const rows = [...walk(root)].filter((entry) => entry.depth < depth);

  /**
   * A node inside an excluded subtree is not itself "off" — its ancestor is.
   * Showing it as available would let the user tick a child of something they
   * removed and wonder why it never appears.
   */
  const isSuppressed = (path: number[]) => {
    for (let i = 1; i <= path.length; i++) {
      if (excluded.has(pathId(path.slice(0, i)))) return true;
    }
    return false;
  };

  const included = rows.filter((r) => !isSuppressed(r.path)).length;

  return (
    <Wrap>
      <Head>
        <Title>Proposed nodes</Title>
        <Count>
          {included} of {rows.length}
        </Count>
      </Head>

      <List>
        {rows.map((entry, index) => {
          const off = isSuppressed(entry.path);
          const own = excluded.has(entry.id);
          const label = renamed.get(entry.id) ?? entry.node.title;
          const previous = rows[index - 1];

          return (
            <Row key={entry.id} $depth={entry.depth} $off={off}>
              <Check
                type="checkbox"
                checked={!off}
                // Only the node's own toggle is actionable; a suppressed
                // descendant is re-enabled by re-enabling its ancestor.
                disabled={off && !own}
                aria-label={`Include ${label}`}
                onChange={() => onToggle(entry.id)}
              />

              {editing === entry.id ? (
                <Rename
                  autoFocus
                  defaultValue={label}
                  aria-label={`Rename ${label}`}
                  onBlur={(event) => {
                    onRename(
                      entry.id,
                      event.target.value.trim() || entry.node.title,
                    );
                    setEditing(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <Label
                  $off={off}
                  title={entry.node.summary || label}
                  onClick={() => {
                    onSelect?.(entry.id);
                    setEditing(entry.id);
                  }}
                >
                  {label}
                </Label>
              )}

              {/*
               * Merge folds a node into the row above it. Offered only where
               * there IS a row above at the same depth — merging across levels
               * is a reparent, which belongs on the map.
               */}
              {previous && previous.depth === entry.depth && !off && (
                <MergeButton
                  type="button"
                  onClick={() => onMerge(entry.id)}
                  aria-label={`Merge ${label} into ${renamed.get(previous.id) ?? previous.node.title}`}
                >
                  Merge up
                </MergeButton>
              )}
            </Row>
          );
        })}
      </List>
    </Wrap>
  );
}
