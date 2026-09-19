'use client';

import { useMemo } from 'react';
import styled from 'styled-components';
import { MapCanvas } from '@/components/map/MapCanvas';
import { buildGraph } from '@/lib/map/geometry';
import type { MapNode } from '@/lib/map/types';
import type { StructuredNode } from '@/lib/ingest/structure';
import { INGEST_FAMILY, pathId, walk } from '@/lib/ingest/to-draft';

/**
 * StructurePreview — §12 step 5.
 *
 * "Generated structure rendered as an actual radial map... Preview in the real
 * renderer, not a list — the user must see it is a _map_."
 *
 * So this is MapCanvas, the same component the product's main surface uses,
 * fed an ephemeral graph. Nothing here is a mockup of the map: what the user
 * approves is what they get, which is the entire argument for the screen.
 *
 * Drag-to-reparent is enabled, because §12 step 6 lists it as one of the four
 * permitted edits and the map is where that gesture belongs.
 */

const Frame = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 380px;
  border-radius: var(--radius-sheet);
  overflow: hidden;
  background: var(--ground-background);
`;

const Badge = styled.p`
  position: absolute;
  left: var(--space-3);
  top: var(--space-3);
  z-index: var(--z-mapControls);

  margin: 0;
  padding: var(--space-1) var(--space-3);
  background: rgba(13, 14, 23, 0.82);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(12px);

  font-size: var(--text-caption);
  color: var(--ground-muted);
  pointer-events: none;
`;

const NO_FOCUS = {
  selectedId: null,
  ancestorIds: new Set<string>(),
  siblingIds: new Set<string>(),
};

export interface StructurePreviewProps {
  root: StructuredNode;
  depth: number;
  excluded: ReadonlySet<string>;
  renamed: ReadonlyMap<string, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** §12 step 6: "drag to reparent". */
  onReparent: (id: string, newParentId: string) => void;
  /** Set when the structure is the 3-node stub rather than a real reading. */
  note?: string;
}

export function StructurePreview({
  root,
  depth,
  excluded,
  renamed,
  selectedId,
  onSelect,
  onReparent,
  note,
}: StructurePreviewProps) {
  const { graph, expandedIds, count } = useMemo(() => {
    const nodes: MapNode[] = [];
    const expanded = new Set<string>();

    /**
     * A node whose ancestor is switched off does not appear at all — the map
     * has to agree with the checklist, or the preview stops being a preview.
     */
    const suppressed = (path: number[]) => {
      for (let i = 1; i <= path.length; i++) {
        if (excluded.has(pathId(path.slice(0, i)))) return true;
      }
      return false;
    };

    // Slots are counted per surviving parent so switching a node off closes
    // the gap in its ring rather than leaving a hole.
    const slots = new Map<string, number>();

    for (const entry of walk(root)) {
      if (entry.depth >= depth) continue;
      if (suppressed(entry.path)) continue;

      const parentPath = entry.path.slice(0, -1);
      const parentId = entry.path.length === 0 ? null : pathId(parentPath);
      const slot = parentId ? (slots.get(parentId) ?? 0) : 0;
      if (parentId) slots.set(parentId, slot + 1);

      nodes.push({
        id: entry.id,
        map_id: 'preview',
        parent_id: parentId,
        slot,
        title: renamed.get(entry.id) ?? entry.node.title,
        description: entry.node.summary || undefined,
        family: INGEST_FAMILY,
        type: 'topic',
        status: 'active',
        visibility: 'public',
        // The root reads as the centre; everything else is uniform. Weight
        // drives size and glow only, never position (ADR-0002), and a
        // proposal has no engagement data to represent anyway.
        weight: entry.depth === 0 ? 1 : 0.5,
      });

      expanded.add(entry.id);
    }

    return {
      graph: buildGraph('preview', root.title, 'root', nodes),
      expandedIds: expanded,
      count: nodes.length,
    };
  }, [root, depth, excluded, renamed]);

  return (
    <Frame>
      <MapCanvas
        graph={graph}
        expandedIds={expandedIds}
        focus={NO_FOCUS}
        centreId="root"
        selectedId={selectedId}
        // Ring two exists whenever depth is 3, and this panel cannot be panned
        // to find it — fit to what is actually on screen.
        fitDepth={depth >= 3 ? 2 : 1}
        editable
        onSelect={(node) => onSelect(node?.node.id ?? null)}
        onExpand={() => {}}
        onOpen={() => {}}
        onNodeDrop={(nodeId, drop) => {
          // The root has nowhere to go, and a node cannot become its own
          // parent — either would produce a cycle the layout cannot resolve.
          // A drop with no target is a free reposition, which this screen does
          // not offer: the four permitted edits do not include moving a node
          // off its ring.
          if (nodeId === 'root' || !drop.targetId || nodeId === drop.targetId)
            return;
          onReparent(nodeId, drop.targetId);
        }}
      />

      <Badge>
        {note ? note : `${count} node${count === 1 ? '' : 's'} · drag to reparent`}
      </Badge>
    </Frame>
  );
}
