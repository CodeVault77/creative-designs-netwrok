'use client';

import { useCallback, useMemo, useState } from 'react';
import { ancestorsOf, depthOf } from './geometry';
import type { FocusModel } from './layout';
import type { MapGraph } from './types';

/**
 * Selection, expansion and focus state for a map.
 *
 * Kept out of the renderer so the same state drives BOTH the canvas and the
 * tree view. §24's acceptance criterion — "tree view matches map exactly" —
 * is only reliably true if there is one state, not two that are kept in sync.
 *
 * Accordion by default (§09): expanding a node collapses any sibling branch,
 * because more than one open branch at phone width produces a layout nobody
 * can read. Desktop multi-expand passes `additive`.
 */

export interface MapState {
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  /** The node currently at the centre. §09's "focused parent slides in". */
  centreId: string;
  focus: FocusModel;
  /** Root → centre, for the breadcrumb. */
  trail: { id: string; title: string }[];
  /** Deepest currently expanded ring, for the layer stepper. */
  maxDepth: number;

  select: (nodeId: string | null) => void;
  toggleExpand: (nodeId: string, additive?: boolean) => void;
  expand: (nodeId: string, additive?: boolean) => void;
  collapse: (nodeId: string) => void;
  collapseAll: () => void;
  /** Descend: the node becomes the centre and the trail grows. */
  descendTo: (nodeId: string) => void;
  /** Jump to a trail segment. */
  ascendTo: (nodeId: string) => void;
}

export function useMapState(graph: MapGraph): MapState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [centreId, setCentreId] = useState<string>(graph.rootId);

  const select = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId);
  }, []);

  const expand = useCallback(
    (nodeId: string, additive = false) => {
      setExpandedIds((current) => {
        if (additive) return new Set(current).add(nodeId);

        // Accordion: keep only this node's own ancestor chain expanded, so a
        // deep branch stays open while a sibling branch closes.
        const keep = new Set(ancestorsOf(graph, nodeId).map((n) => n.id));
        keep.add(nodeId);
        return keep;
      });
    },
    [graph],
  );

  const collapse = useCallback(
    (nodeId: string) => {
      setExpandedIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        // Collapsing a node must also collapse everything beneath it, or its
        // descendants stay "expanded" and re-bloom unexpectedly next time.
        for (const id of current) {
          if (ancestorsOf(graph, id).some((a) => a.id === nodeId && a.id !== id)) {
            next.delete(id);
          }
        }
        return next;
      });
    },
    [graph],
  );

  const toggleExpand = useCallback(
    (nodeId: string, additive = false) => {
      if (expandedIds.has(nodeId)) collapse(nodeId);
      else expand(nodeId, additive);
    },
    [expandedIds, expand, collapse],
  );

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
    setSelectedId(null);
    setCentreId(graph.rootId);
  }, [graph.rootId]);

  const descendTo = useCallback(
    (nodeId: string) => {
      if (!graph.nodes.has(nodeId)) return;
      setCentreId(nodeId);
      setExpandedIds(new Set());
      setSelectedId(null);
    },
    [graph],
  );

  const ascendTo = useCallback(
    (nodeId: string) => {
      if (!graph.nodes.has(nodeId)) return;
      setCentreId(nodeId);
      setExpandedIds(new Set());
      setSelectedId(null);
    },
    [graph],
  );

  const focus: FocusModel = useMemo(() => {
    if (!selectedId) {
      return { selectedId: null, ancestorIds: new Set(), siblingIds: new Set() };
    }

    const chain = ancestorsOf(graph, selectedId);
    const ancestorIds = new Set(chain.map((n) => n.id));
    ancestorIds.delete(selectedId);

    const selected = graph.nodes.get(selectedId);
    const siblingIds = new Set<string>();
    if (selected?.parent_id) {
      for (const id of graph.childrenOf.get(selected.parent_id) ?? []) {
        if (id !== selectedId) siblingIds.add(id);
      }
    }

    return { selectedId, ancestorIds, siblingIds };
  }, [graph, selectedId]);

  const trail = useMemo(
    () =>
      ancestorsOf(graph, centreId).map((n) => ({
        id: n.id,
        title: n.title,
      })),
    [graph, centreId],
  );

  const maxDepth = useMemo(() => {
    let deepest = 1;
    for (const id of expandedIds) {
      deepest = Math.max(deepest, depthOf(graph, id) + 1);
    }
    return deepest;
  }, [graph, expandedIds]);

  return {
    selectedId,
    expandedIds,
    centreId,
    focus,
    trail,
    maxDepth,
    select,
    toggleExpand,
    expand,
    collapse,
    collapseAll,
    descendTo,
    ascendTo,
  };
}
