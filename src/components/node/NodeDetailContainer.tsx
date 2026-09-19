'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DetailSheet } from './DetailSheet';
import { InspectorPanel } from './InspectorPanel';
import { NodeDetailBody } from './NodeDetailBody';
import { useIsRailLayout } from '@/lib/useBreakpoint';
import { track } from '@/lib/analytics';
import type { NodeDetail, NodeDetailMode } from '@/lib/nodes/detail';
import type { MapNode } from '@/lib/map/types';

/**
 * Chooses the presentation and owns the fetch.
 *
 * This is the only place that decides sheet-vs-inspector, so no screen ever
 * has to. §09: "the same component, two presentations".
 *
 * ── The 3-tap metric ────────────────────────────────────────────────────────
 *
 * §24's headline funnel target is a live destination reached in ≤3 taps and
 * ≤25 seconds. Tap 1 opens the map (arrival), tap 2 selects the node, tap 3
 * is Open. `destination_reached` is emitted once per session on first
 * arrival, carrying the actual tap count and elapsed time, so the number is
 * measured rather than assumed.
 */

export interface NodeDetailContainerProps {
  /** The selected node from the graph, used for the instant title. */
  node: MapNode | null;
  onClose: () => void;
  onExpand?: (nodeId: string) => void;
  onNavigateCrumb?: (nodeId: string) => void;
  /** Taps taken to reach this selection, for the §24 funnel metric. */
  tapCount?: number;
  /** When the map became interactive, for the elapsed-time half of it. */
  sessionStart?: number;
}

/** Session-scoped so `destination_reached` fires once, not per node. */
let reachedThisSession = false;

export function NodeDetailContainer({
  node,
  onClose,
  onExpand,
  onNavigateCrumb,
  tapCount = 2,
  sessionStart,
}: NodeDetailContainerProps) {
  const router = useRouter();
  const isDesktop = useIsRailLayout();

  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const requestRef = useRef(0);

  useEffect(() => {
    if (!node) {
      setDetail(null);
      setError(null);
      return;
    }

    // A stale response from a previously selected node must never overwrite
    // the current one — tapping quickly through several nodes otherwise
    // leaves the panel showing whichever request happened to finish last.
    const requestId = ++requestRef.current;
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    fetch(`/api/nodes/${encodeURIComponent(node.id)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<NodeDetail>;
      })
      .then((data) => {
        if (requestId !== requestRef.current) return;
        setDetail(data);
      })
      .catch((cause: unknown) => {
        if (requestId !== requestRef.current) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('load-failed');
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });

    return () => controller.abort();
  }, [node, reloadToken]);

  const handleOpen = useCallback(
    (href: string) => {
      if (!node) return;

      if (!reachedThisSession) {
        reachedThisSession = true;
        track('destination_reached', {
          node_id: node.id,
          taps: tapCount + 1,
          ms_since_load: sessionStart
            ? Math.round(performance.now() - sessionStart)
            : 0,
        });
      }

      track('node_opened', { node_id: node.id, family: node.family, depth: 1 });
      router.push(href);
    },
    [node, router, tapCount, sessionStart],
  );

  const mode: NodeDetailMode = detail
    ? detail.visibility === 'private'
      ? 'locked'
      : detail.status === 'coming_soon'
        ? 'soon'
        : 'view'
    : node?.status === 'coming_soon'
      ? 'soon'
      : 'view';

  // §08 screen 03, loading state: the sheet opens instantly with the title we
  // already have from the map, so it is never a blank rectangle.
  const shown: NodeDetail | null =
    detail ??
    (node && loading
      ? {
          id: node.id,
          mapId: node.map_id,
          title: node.title,
          family: node.family,
          type: node.type,
          status: node.status,
          visibility: node.visibility,
          trail: [{ id: node.id, title: node.title }],
          childCount: 0,
          // The map already knows both, so the instant state can draw the
          // real glyph and number rather than popping them in on load.
          slot: node.slot,
          ...(node.icon ? { icon: node.icon } : {}),
          shareUrl: '',
        }
      : null);

  const body = (
    <NodeDetailBody
      detail={shown}
      mode={mode}
      loading={loading && !detail}
      error={error}
      onRetry={() => setReloadToken((n) => n + 1)}
      onOpen={handleOpen}
      {...(onExpand && node ? { onExpand: () => onExpand(node.id) } : {})}
      {...(onNavigateCrumb ? { onNavigateCrumb } : {})}
    />
  );

  const label = node?.title ?? 'Node details';

  return isDesktop ? (
    <InspectorPanel open={Boolean(node)} onClose={onClose} label={label}>
      {body}
    </InspectorPanel>
  ) : (
    <DetailSheet open={Boolean(node)} onClose={onClose} label={label}>
      {body}
    </DetailSheet>
  );
}

/** Test seam — the session flag would otherwise leak between test cases. */
export function resetDestinationReached(): void {
  reachedThisSession = false;
}
