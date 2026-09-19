'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import styled from 'styled-components';
import { MapCanvas } from '@/components/map/MapCanvas';
import { buildGraph } from '@/lib/map/geometry';
import { track } from '@/lib/analytics';
import type { SearchResult } from '@/lib/search/types';
import type { MapNode } from '@/lib/map/types';

/**
 * ResultMap — §11's "See as map".
 *
 * "The query text sits at the centre with a dashed ring, results occupy ring
 * one sorted by relevance, and results sharing a parent are grouped into a
 * shared arc with the parent named on the arc. This is the feature that makes
 * search feel native to CDN rather than bolted on."
 *
 * It is built as an EPHEMERAL GRAPH and rendered through the same MapCanvas
 * as everything else. §06 lists "search result map" as one of the four map
 * spaces, so it should be the same object the rest of the product is made of
 * — a bespoke result visualisation would be a second renderer to keep in step
 * with P3's performance work.
 *
 * The centre node is `coming_soon` purely to borrow the dashed, unglowed
 * treatment §09 asks for. That is a small abuse of a status field and is
 * called out here so it is not mistaken for a real Coming Soon node.
 */

const Frame = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
`;

const Legend = styled.p`
  position: absolute;
  left: 50%;
  bottom: var(--space-3);
  transform: translateX(-50%);
  z-index: var(--z-mapControls);

  margin: 0;
  padding: var(--space-1) var(--space-3);
  background: rgba(13, 14, 23, 0.82);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(12px);

  font-size: var(--text-caption);
  color: var(--ground-muted);
  white-space: nowrap;
  pointer-events: none;
`;

const NO_FOCUS = {
  selectedId: null,
  ancestorIds: new Set<string>(),
  siblingIds: new Set<string>(),
};

const ROOT_ID = '__query__';

export function ResultMap({
  query,
  results,
}: {
  query: string;
  results: SearchResult[];
}) {
  const router = useRouter();

  const { graph, expandedIds, groupCount, fitDepth } = useMemo(() => {
    const nodes: MapNode[] = [
      {
        id: ROOT_ID,
        map_id: 'search',
        parent_id: null,
        slot: 0,
        // The query itself at the centre, so the map is self-describing.
        title: query,
        family: 'discover',
        type: 'topic',
        // Borrowed for the dashed, unglowed centre ring (§09). Not a real
        // Coming Soon node.
        status: 'coming_soon',
        visibility: 'public',
        weight: 1,
      },
    ];

    /*
     * §11: "results sharing a parent are grouped into a shared arc with the
     * parent named on the arc."
     *
     * Modelled as a real intermediate node per source map, which gives the
     * grouping for free from the existing radial layout — children of one
     * parent already fan into a shared arc (§09). A bespoke arc primitive
     * would be new renderer code for something the geometry already does.
     *
     * A group of one is NOT worth a parent: it would put a node two rings out
     * for no gain and push everything else outward.
     */
    const byGroup = new Map<string, SearchResult[]>();
    for (const result of results) {
      const key = result.path[0] ?? 'Results';
      const list = byGroup.get(key);
      if (list) list.push(result);
      else byGroup.set(key, [result]);
    }

    const expanded = new Set<string>([ROOT_ID]);
    let slot = 0;

    for (const [label, groupResults] of byGroup) {
      if (groupResults.length === 1) {
        const result = groupResults[0]!;
        nodes.push(toNode(result, ROOT_ID, slot++));
        continue;
      }

      const groupId = `group:${label}`;
      nodes.push({
        id: groupId,
        map_id: 'search',
        parent_id: ROOT_ID,
        slot: slot++,
        title: label,
        family: groupResults[0]!.family,
        type: 'cluster',
        status: 'active',
        visibility: 'public',
        weight: 0.8,
      });
      expanded.add(groupId);

      groupResults.forEach((result, index) => {
        nodes.push(toNode(result, groupId, index));
      });
    }

    return {
      graph: buildGraph('search', query, ROOT_ID, nodes),
      expandedIds: expanded,
      groupCount: byGroup.size,
      /**
       * Grouping pushes its members out to ring two. This panel is a fixed
       * height with nothing to pan, so fitting ring one would open with the
       * grouped results sliced off by the top edge — which is exactly how it
       * looked before this was passed through.
       */
      fitDepth: [...byGroup.values()].some((g) => g.length > 1) ? 2 : 1,
    };
  }, [query, results]);

  const hrefById = useMemo(() => {
    const map = new Map<string, string>();
    for (const result of results) map.set(nodeIdFor(result), result.href);
    return map;
  }, [results]);

  return (
    <Frame>
      <MapCanvas
        graph={graph}
        expandedIds={expandedIds}
        focus={NO_FOCUS}
        centreId={ROOT_ID}
        selectedId={null}
        fitDepth={fitDepth}
        onSelect={(node) => {
          if (!node) return;
          const href = hrefById.get(node.node.id);
          if (!href) return;
          track('search_result_opened', { result_type: 'node', position: 0 });
          router.push(href);
        }}
        onExpand={() => {}}
        onOpen={(node) => {
          const href = hrefById.get(node.node.id);
          if (href) router.push(href);
        }}
      />

      <Legend>
        {results.length} result{results.length === 1 ? '' : 's'}
        {groupCount > 1 ? ` across ${groupCount} places` : ''}
      </Legend>
    </Frame>
  );
}

function nodeIdFor(result: SearchResult): string {
  // Namespaced by group: a map and a node can legitimately share an id space,
  // and a collision would send a tap to the wrong destination.
  return `${result.group}:${result.id}`;
}

function toNode(result: SearchResult, parentId: string, slot: number): MapNode {
  return {
    id: nodeIdFor(result),
    map_id: 'search',
    parent_id: parentId,
    slot,
    title: result.title,
    family: result.family,
    type: result.type ?? 'topic',
    status: result.status,
    visibility: 'public',
    // Rank drives size and glow, so the most relevant result reads as the
    // most prominent — the one place weight-as-emphasis is uncontroversial,
    // because a result map has no learned layout to protect (ADR-0002).
    weight: Math.max(0.2, 1 - Math.min(1, Math.max(0, result.rank) / 10)),
  };
}
