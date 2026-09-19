'use client';

import { useCallback, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { MapGraph, MapNode } from '@/lib/map/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * Screen 04 — the tree view.
 *
 * This is the map's accessible equivalent, and §24's acceptance criterion is
 * that it "matches the map exactly". It does, because it renders from the
 * SAME graph and the SAME expansion state — not from a parallel structure
 * that has to be kept in sync.
 *
 * It is not a fallback or a lesser mode. A canvas cannot be made meaningfully
 * accessible by bolting labels onto it; the honest answer is a real DOM tree
 * that a screen reader and a keyboard can operate properly. Some sighted
 * users will prefer it too, which is why the view toggle is a first-class
 * control rather than something hidden in settings.
 *
 * Implements the ARIA treegrid keyboard contract:
 *   ↑ / ↓     move between visible rows
 *   → / ←     expand / collapse, or move to parent
 *   Home/End  first / last visible row
 *   Enter     open
 */

export interface TreeListProps {
  graph: MapGraph;
  expandedIds: ReadonlySet<string>;
  selectedId: string | null;
  rootId?: string;
  onSelect: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onOpen: (nodeId: string) => void;
}

interface Row {
  node: MapNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/**
 * The caption above the tree.
 *
 * The design canvas states outright that this view is the accessible peer of
 * the map, not a lesser fallback, and saying so matters: someone who lands
 * here from the Tree toggle needs to know they are not missing content, and
 * someone using a screen reader needs to know this is the intended route
 * rather than a degraded one.
 */
const Caption = styled.p`
  margin: 0 0 var(--space-3);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 1.5px;
  color: var(--ground-muted);
`;

/**
 * One frame around the whole tree, with hairline dividers between rows.
 *
 * The rows previously floated on the page background, which left the
 * indentation carrying the entire hierarchy on its own. A container plus
 * dividers gives the eye a column edge to read the indent against.
 */
const Frame = styled.div`
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  overflow: hidden;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const Row = styled.li`
  list-style: none;

  & + & {
    border-top: 1px solid var(--ground-border);
  }
`;

const RowButton = styled.div<{ $depth: number; $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--space-2);

  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  padding-left: calc(var(--space-3) + ${({ $depth }) => $depth * 20}px);

  border: 1px solid
    ${({ $selected }) => ($selected ? 'var(--color-focus)' : 'transparent')};
  border-radius: var(--radius-control);
  background: ${({ $selected }) => ($selected ? 'rgba(255,255,255,0.04)' : 'transparent')};
  color: var(--ground-ink);
  cursor: pointer;
  text-align: left;

  ${transition('selection', 'background-color', 'border-color')}

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }
`;

const Chevron = styled.span<{ $expanded: boolean; $hidden: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--ground-muted);
  visibility: ${({ $hidden }) => ($hidden ? 'hidden' : 'visible')};
  transform: rotate(${({ $expanded }) => ($expanded ? 90 : 0)}deg);
  ${transition('collapse', 'transform')}
`;

const Dot = styled.span<{ $family: FamilyName; $dim: boolean }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  opacity: ${({ $dim }) => ($dim ? 0.4 : 1)};
`;

/**
 * The node's slot number.
 *
 * §10's numbering is what makes "node 7 is at four o'clock" a true sentence,
 * and it is the one piece of the map's spatial identity a linear list can
 * still carry. Tabular figures so the column does not jitter between 1 and 12.
 */
const Slot = styled.span`
  flex: none;
  min-width: 16px;
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Title = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-body);
`;

const Badge = styled.span`
  flex-shrink: 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--fam-services-core);
  border: 1px solid var(--fam-services-core);
  border-radius: var(--radius-chip);
  padding: 1px 5px;
`;

const Count = styled.span`
  flex-shrink: 0;
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export function TreeList({
  graph,
  expandedIds,
  selectedId,
  rootId,
  onSelect,
  onToggle,
  onOpen,
}: TreeListProps) {
  const containerRef = useRef<HTMLUListElement>(null);

  /**
   * Flattened visible rows.
   *
   * Flattening is what makes the keyboard contract simple: ↑/↓ move by one
   * index rather than walking a tree, and the DOM order matches the reading
   * order a screen reader announces.
   */
  const rows = useMemo(() => {
    const result: Row[] = [];
    const start = rootId ?? graph.rootId;

    const walk = (nodeId: string, depth: number) => {
      const node = graph.nodes.get(nodeId);
      if (!node) return;

      const childIds = graph.childrenOf.get(nodeId) ?? [];
      const expanded = depth === 0 || expandedIds.has(nodeId);

      result.push({
        node,
        depth,
        hasChildren: childIds.length > 0,
        expanded: expanded && childIds.length > 0,
      });

      if (expanded) {
        for (const childId of childIds) walk(childId, depth + 1);
      }
    };

    walk(start, 0);
    return result;
  }, [graph, expandedIds, rootId]);

  const focusRow = useCallback((index: number) => {
    const items =
      containerRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]');
    items?.[Math.max(0, Math.min(items.length - 1, index))]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, row: Row, index: number) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusRow(index + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusRow(index - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          if (row.hasChildren && !row.expanded) onToggle(row.node.id);
          else if (row.hasChildren) focusRow(index + 1);
          break;
        case 'ArrowLeft': {
          event.preventDefault();
          if (row.expanded) {
            onToggle(row.node.id);
          } else {
            // Move to the parent row — the nearest earlier row one level up.
            for (let i = index - 1; i >= 0; i--) {
              if (rows[i]!.depth < row.depth) {
                focusRow(i);
                break;
              }
            }
          }
          break;
        }
        case 'Home':
          event.preventDefault();
          focusRow(0);
          break;
        case 'End':
          event.preventDefault();
          focusRow(rows.length - 1);
          break;
        case 'Enter':
          event.preventDefault();
          onOpen(row.node.id);
          break;
        case ' ':
          event.preventDefault();
          onSelect(row.node.id);
          break;
        default:
          break;
      }
    },
    [rows, focusRow, onToggle, onOpen, onSelect],
  );

  return (
    <>
      <Caption>ACCESSIBLE TREE · SAME DATA AS THE MAP</Caption>

      <Frame>
        <List ref={containerRef} role="tree" aria-label="Map contents">
          {rows.map((row, index) => {
            const childCount = (graph.childrenOf.get(row.node.id) ?? []).length;
            const comingSoon = row.node.status === 'coming_soon';
            const selected = row.node.id === selectedId;

            return (
              /*
               * role="none" is required, not cosmetic.
               *
               * `role="tree"` on the <ul> removes its implicit list semantics, so
               * the <li> inside it is no longer a listitem in a list — and it sits
               * between the tree and its treeitem, breaking the parent/child
               * relationship the tree pattern depends on. Marking it presentational
               * makes it transparent, so the treeitem is owned by the tree.
               *
               * Found by the P13 axe pass: aria-required-children,
               * aria-required-parent and listitem all had the same single cause.
               */
              <Row key={row.node.id} role="none">
                <RowButton
                  role="treeitem"
                  // Roving tabindex: one stop for the whole tree, then arrows
                  // move within it. Otherwise a 150-node map is 150 tab stops.
                  tabIndex={index === 0 ? 0 : -1}
                  aria-level={row.depth + 1}
                  aria-selected={selected}
                  aria-expanded={row.hasChildren ? row.expanded : undefined}
                  $depth={row.depth}
                  $selected={selected}
                  onClick={() => onSelect(row.node.id)}
                  onDoubleClick={() => onOpen(row.node.id)}
                  onKeyDown={(event) => handleKeyDown(event, row, index)}
                >
                  <Chevron
                    $expanded={row.expanded}
                    $hidden={!row.hasChildren}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(row.node.id);
                    }}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                      <path
                        d="M6 3.5 10.5 8 6 12.5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Chevron>

                  <Dot
                    $family={row.node.family}
                    $dim={comingSoon}
                    aria-hidden="true"
                  />

                  {/*
                   * Hidden from assistive tech: the tree already conveys position
                   * through aria-level and the row order, and reading "3" before
                   * every title turns a scan of the list into a recital of digits.
                   * It is a visual aid for cross-referencing the map, not content.
                   */}
                  <Slot aria-hidden="true">
                    {/*
                     * The root has no slot — it is the centre, not a position on a
                     * ring — so numbering it "1" would invent a coordinate and put
                     * it in competition with the real node 1 directly beneath it.
                     * The column still reserves its width so the titles stay
                     * aligned.
                     */}
                    {row.depth === 0 ? '' : row.node.slot + 1}
                  </Slot>

                  <Title>{row.node.title}</Title>

                  {/* Coming Soon is stated in text here, not implied by styling —
                  §08 requires the tree row to carry the badge. */}
                  {comingSoon && <Badge>Soon</Badge>}

                  {childCount > 0 && !row.expanded && <Count>{childCount}</Count>}
                </RowButton>
              </Row>
            );
          })}
        </List>
      </Frame>
    </>
  );
}
