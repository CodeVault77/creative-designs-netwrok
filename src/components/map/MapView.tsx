'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import styled from 'styled-components';
import { MapCanvas, type MapCameraHandle } from './MapCanvas';
import { MapControls } from './MapControls';
import { LayerStepper } from './LayerStepper';
import { Breadcrumb } from './Breadcrumb';
import { TreeList } from './TreeList';
import { ViewToggle } from './ViewToggle';
import { LensPill, type LensId } from './LensPill';
import { NodeDetailContainer } from '@/components/node/NodeDetailContainer';
import { useMapState } from '@/lib/map/useMapState';
import type { RelationInput } from '@/lib/map/types';
import { useIsRailLayout } from '@/lib/useBreakpoint';
import { cameraForDepth, type LayoutResult } from '@/lib/map/layout';
import { MAX_SCALE, MIN_SCALE } from '@/lib/map/camera';
import { buildRoute, routes } from '@/lib/routes';
import { transition } from '@/lib/styles/motion';
import { NewMapSheet } from '@/components/editor/NewMapSheet';
import { track } from '@/lib/analytics';
import {
  captureSnapshot,
  isRestoring,
  readSnapshot,
  clearSnapshot,
  type MapSnapshot,
} from '@/lib/search/snapshot';
import type { MapGraph, PlacedNode } from '@/lib/map/types';

/**
 * Screen 02 — the Community Map, screen 04 as its tree view, and screen 03 as
 * the detail panel over it.
 *
 * All three live here because §08 says node detail is a STATE of the map
 * screen rather than a separate screen, and because §24 requires the tree to
 * match the map exactly — which only holds reliably when one piece of state
 * drives both renderers.
 *
 * The map is not unmounted when the tree shows. Remounting would drop the
 * camera and force the layout and sprite warm-up to run again on every
 * toggle, and the toggle is meant to be cheap enough to use freely.
 */

const Frame = styled.div`
  position: relative;
  width: 100%;
  /* The map is the product surface; it takes the viewport minus the chrome. */
  height: calc(100dvh - 56px - 72px - env(safe-area-inset-bottom, 0px));

  @media (min-width: 1024px) {
    height: calc(100dvh - 56px);
  }
`;

const CanvasLayer = styled.div<{ $hidden: boolean }>`
  position: absolute;
  inset: 0;
  /* Hidden, not unmounted — see the note above. */
  visibility: ${({ $hidden }) => ($hidden ? 'hidden' : 'visible')};
`;

const TreeLayer = styled.div`
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 64px var(--space-3) var(--space-6);
  background: var(--ground-background);
`;

/** §09: the whisper shown when the 300-node cap drops nodes. */
/**
 * The "N more" chip (design reference, bottom-right above the FAB).
 *
 * Ring one is capped by viewport width, so some families are simply not on
 * screen. Without this the omission is silent: the map looks complete, and
 * someone looking for a family they know exists has no way to tell whether it
 * was hidden, renamed or removed. The chip both states the omission and is the
 * control that resolves it.
 */
/**
 * Create a map — the design reference's green FAB, bottom-right.
 *
 * The corner was already reserved: MoreChip offsets itself 64px to sit above
 * a FAB that did not exist yet. Lime rather than a family hue because this is
 * the one control on the map that makes something new rather than navigating
 * what is already there, and `create` is exactly that family.
 */
const Fab = styled.button`
  position: absolute;
  right: var(--space-3);
  bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-mapControls);

  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;

  background: ${({ theme }) => theme.tokens.familyRamp.create.wash};
  border: 1.5px solid ${({ theme }) => theme.tokens.familyRamp.create.core};
  border-radius: var(--radius-circle);
  box-shadow: ${({ theme }) => theme.tokens.glow.create[2]};
  color: ${({ theme }) => theme.tokens.familyRamp.create.core};
  cursor: pointer;

  ${transition('selection', 'transform')}

  &:active {
    transform: scale(0.94);
  }
`;

const MoreChip = styled.button`
  position: absolute;
  right: var(--space-3);
  /* Above the FAB's corner, clear of the vertically centred zoom column. */
  bottom: calc(var(--space-6) + 64px + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-mapControls);

  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 30px;
  padding: 0 var(--space-3);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  color: var(--ground-muted);
  font: inherit;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  cursor: pointer;

  &:hover {
    color: var(--ground-ink);
    border-color: var(--ground-muted);
  }
`;

const Whisper = styled.p`
  position: absolute;
  left: 50%;
  bottom: var(--space-6);
  transform: translateX(-50%);
  z-index: var(--z-mapControls);
  margin: 0;
  padding: var(--space-1) var(--space-3);

  font-size: var(--text-caption);
  color: var(--ground-muted);
  background: rgba(13, 14, 23, 0.72);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(12px);
  pointer-events: none;
`;

export interface MapViewProps {
  graph: MapGraph;
  /** A dimension on every map analytics event. */
  surface: 'community' | 'user_map' | 'shared_map' | 'search_result';
  initialView?: 'map' | 'tree';
  /** Selected node id from `?node=<id>`, so deep links land selected. */
  initialSelectedId?: string | null;
  signedIn?: boolean;
}

export function MapView({
  graph,
  surface,
  initialView = 'map',
  initialSelectedId = null,
  signedIn = false,
}: MapViewProps) {
  const router = useRouter();
  const cameraRef = useRef<MapCameraHandle | null>(null);
  const isDesktop = useIsRailLayout();

  const state = useMapState(graph);
  const [view, setView] = useState<'map' | 'tree'>(initialView);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [creating, setCreating] = useState(false);

  /**
   * Explicit typed relationships for this map, drawn over the containment tree.
   *
   * Fetched rather than derived: unlike parent/child, a relationship is a row
   * in `node_edges` and can point into another map entirely, so it is not
   * recoverable from the graph the canvas already holds.
   *
   * Failure is silent on purpose. Relationships are an annotation over a map
   * that is perfectly usable without them — an error banner because a
   * secondary overlay did not load would be louder than the thing it failed to
   * draw.
   */
  const [relations, setRelations] = useState<RelationInput[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/edges?mapId=${encodeURIComponent(graph.id)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : { edges: [] }))
      .then(
        (body: {
          edges?: { fromNodeId: string; toNodeId: string; type: string }[];
        }) => {
          setRelations(
            (body.edges ?? []).map((edge) => ({
              fromNodeId: edge.fromNodeId,
              toNodeId: edge.toNodeId,
              type: edge.type,
            })),
          );
        },
      )
      .catch(() => {
        // Aborted, offline, or the endpoint is unhappy: the map still works.
      });

    return () => controller.abort();
  }, [graph.id]);

  /**
   * Which window of ring one is showing.
   *
   * Ring one is capped by viewport width, so on a phone four of the twelve
   * families are off screen. Rotating the window is how you reach them without
   * spending a ring slot on a "+5" bubble, and because it only changes where
   * the visible arc STARTS, every node keeps the position it always had
   * (ADR-0002).
   */
  const [ringOffset, setRingOffset] = useState(0);

  /** The drawn area, for fitting the camera to the canvas rather than the window. */
  const frameRef = useRef<HTMLDivElement>(null);

  /**
   * The state line under the lens pill.
   *
   * Ring one is capped by viewport width (§17), so on a phone some of it is
   * folded into a cluster. Without this the only signal is a "+5" bubble that
   * reads like just another node — and someone who cannot find a family they
   * know exists has no way to tell whether it is hidden or gone.
   */
  const ringOneCaption = useMemo(() => {
    if (!layout || layout.ringOneTotal === 0) return null;

    const shown = layout.ringOneTotal - layout.ringOneHidden;
    const tier = layout.tier.toUpperCase();

    /*
     * Read straight off the layout's own counts.
     *
     * An earlier version derived this by summing cluster sizes in the node
     * list. That silently became "DEFAULT · 8" the moment ring one stopped
     * producing clusters — the sum was zero, so the sentence lost the half
     * that mattered, and the map looked complete again.
     */
    return layout.ringOneHidden > 0
      ? `${tier} · ${shown} OF ${layout.ringOneTotal}`
      : `${tier} · ${layout.ringOneTotal}`;
  }, [layout]);
  const [depth, setDepth] = useState(1);
  const [lens, setLens] = useState<LensId>('all');

  /** Taps taken to reach the current selection, for §24's 3-tap metric. */
  const tapsRef = useRef(1);
  const sessionStartRef = useRef(0);

  const appliedInitial = useRef(false);
  if (
    !appliedInitial.current &&
    initialSelectedId &&
    graph.nodes.has(initialSelectedId)
  ) {
    appliedInitial.current = true;
    state.select(initialSelectedId);
  }

  /**
   * §11: "Every search entry captures a camera snapshot."
   *
   * Captured continuously rather than on the way out, because there is no
   * "on the way out" — search is reachable from the tab bar, a keyboard
   * shortcut and the top bar, and a capture hung off one of those would miss
   * the others.
   *
   * It is driven from the LAYOUT CALLBACK rather than a state effect. The
   * camera lives in a ref and panning never re-renders, so a state-driven
   * capture recorded the position at mount and nothing after: the snapshot
   * read x=0 no matter where the user had actually panned to. Throttled,
   * because the layout callback fires per frame while the map is dirty.
   */
  const lastCaptureRef = useRef(0);
  const captureNow = useCallback(() => {
    const camera = cameraRef.current?.getCamera();
    if (!camera) return;

    captureSnapshot({
      mapId: graph.id,
      camera,
      expandedIds: [...state.expandedIds],
      selectedId: state.selectedId,
      centreId: state.centreId,
      returnHref: window.location.pathname,
      label: surface === 'community' ? 'Central Node' : graph.title,
    });
  }, [
    graph.id,
    graph.title,
    surface,
    state.expandedIds,
    state.selectedId,
    state.centreId,
  ]);

  const loadedRef = useRef(false);
  const handleLayout = useCallback(
    (result: LayoutResult) => {
      /*
       * Lift into React only when something the chrome reads has changed.
       *
       * The comparison has to list EVERY field the chrome reads, or it
       * silently serves a stale layout. It compared capped/tier/scale only,
       * so descending into a node — which changes neither the tier nor the
       * fit — left the lens caption and the "N more" chip reporting the ring
       * they were built for: "8 OF 12" beside a centre with five children.
       *
       * Nothing threw. The map was correct and the chrome describing it was
       * a screen out of date.
       */
      setLayout((current) =>
        current?.capped === result.capped &&
        current?.tier === result.tier &&
        current?.scale === result.scale &&
        current?.ringOneTotal === result.ringOneTotal &&
        current?.ringOneHidden === result.ringOneHidden
          ? current
          : result,
      );

      // Throttled snapshot capture — see the note on captureNow below.
      const now = performance.now();
      if (view === 'map' && now - lastCaptureRef.current > 400) {
        lastCaptureRef.current = now;
        captureNow();
      }

      if (!loadedRef.current) {
        loadedRef.current = true;
        sessionStartRef.current = performance.now();
        track('map_loaded', {
          surface,
          node_count: result.totalPlaced,
          ms: Math.round(performance.now()),
        });
      }
    },
    [surface, view, captureNow],
  );

  /**
   * Restoring after a search (§11: "restoring camera, zoom, expansion set and
   * selection exactly. Without this, search becomes a trapdoor.").
   *
   * Read in a LAYOUT effect, and this timing is the whole trick:
   *
   *  - Not during render. Arriving here from the results screen is a client
   *    transition, and `window.location` still says /search while the new tree
   *    renders — so a render-time read saw no flag and restored nothing.
   *  - Not `useSearchParams`, which would force a Suspense boundary and cost
   *    /map/tree its static prerender.
   *  - Not a passive effect. MapCanvas fits ring one to the viewport as soon
   *    as ResizeObserver reports a size, and that delivery can beat a passive
   *    effect — the fit would then overwrite the restored camera. Layout
   *    effects commit before the observer is delivered, so the snapshot is in
   *    place as `initialCamera` and the fit stands down.
   */
  const [restore, setRestore] = useState<MapSnapshot | null>(null);
  const restoredRef = useRef(false);

  useLayoutEffect(() => {
    if (restoredRef.current) return;
    if (!isRestoring(new URLSearchParams(window.location.search))) return;

    restoredRef.current = true;
    const snapshot = readSnapshot();
    if (!snapshot || snapshot.mapId !== graph.id) return;
    setRestore(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.id]);

  useEffect(() => {
    if (!restore) return;

    for (const id of restore.expandedIds) state.expand(id, true);
    if (restore.centreId && restore.centreId !== graph.rootId) {
      state.descendTo(restore.centreId);
    }
    if (restore.selectedId) state.select(restore.selectedId);

    // The flag is consumed so a refresh does not re-apply a snapshot the user
    // has since moved away from.
    const url = new URL(window.location.href);
    url.searchParams.delete('restore');
    window.history.replaceState(null, '', url);
    clearSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore]);

  /**
   * Selection is mirrored into `?node=<id>` without a navigation.
   *
   * `history.replaceState`, not `router.push`: pushing would put every tap
   * into the back stack, so Back would walk backwards through a user's
   * selections instead of leaving the map. Replacing keeps the URL shareable
   * and refresh-safe while Back still means "leave".
   */
  useEffect(() => {
    if (view !== 'map') return;
    const url = new URL(window.location.href);
    if (state.selectedId) url.searchParams.set('node', state.selectedId);
    else url.searchParams.delete('node');
    window.history.replaceState(null, '', url);
  }, [state.selectedId, view]);

  const openNode = useCallback(
    (nodeId: string) => {
      const node = graph.nodes.get(nodeId);
      if (!node) return;

      // §10: Coming Soon nodes stay fully tappable and lead to screen 22.
      // Their presence is the pitch and the tap is the demand signal.
      if (node.status === 'coming_soon') {
        router.push(buildRoute.comingSoon(node.id));
        return;
      }
      if (node.href) router.push(node.href);
    },
    [graph, router],
  );

  const handleSelect = useCallback(
    (node: PlacedNode | null) => {
      state.select(node?.node.id ?? null);
      if (!node) return;

      // Arrival is tap 1, this selection is tap 2, Open will be tap 3.
      tapsRef.current = 2;

      track('node_selected', {
        node_id: node.node.id,
        family: node.node.family,
        status: node.node.status,
        depth: node.depth,
        surface,
      });
    },
    [state, surface],
  );

  /**
   * Frame a ring depth.
   *
   * Measured against the CANVAS, not the window. `window.innerHeight` includes
   * the top bar and the tab bar, so fitting to it framed a box roughly 140px
   * taller than the one the map is actually drawn in, and the outer ring
   * settled just past the bottom edge.
   */
  const fitToDepth = useCallback((next: number) => {
    setDepth(next);

    const canvas = frameRef.current?.querySelector('canvas');
    const box = canvas?.getBoundingClientRect();

    cameraRef.current?.easeTo(
      cameraForDepth(next, {
        width: box?.width || window.innerWidth,
        height: box?.height || window.innerHeight,
      }),
    );
  }, []);

  /**
   * The TREE's disclosure toggle — a genuine accordion, and deliberately not a
   * descend.
   *
   * A tree row's chevron means "show me what is inside this, here". Making it
   * re-root the whole view would break the one thing an outline is for, which
   * is seeing several levels at once. The map's Expand descends because the
   * map cannot show a branch in place; the tree can, so it does.
   */
  const handleToggle = useCallback(
    (nodeId: string) => {
      state.toggleExpand(nodeId);
    },
    [state],
  );

  /**
   * Expand DESCENDS: the node becomes the centre of the map.
   *
   * The design reference is explicit about this — after expanding Mind
   * Mapping, Mind Mapping sits in the middle with its own ring around it and
   * the breadcrumb reads CDN › Create › Mind Mapping. That is `descendTo`, not
   * an accordion.
   *
   * The accordion reading is what made this look broken. Fanning children out
   * at ring two put them past the edge of the canvas, and every attempt to
   * rescue that by moving the camera traded one problem for another: fitting
   * the whole ring dropped the scale into the overview tier, where nodes draw
   * as bare dots; panning toward the branch left the map lopsided with half
   * the ring off screen. None of it was fixable, because the layout was
   * answering a different question from the one the button asks.
   *
   * Descending has none of those problems: the children become ring ONE of a
   * new centre, laid out by the same code that frames the map on arrival.
   * `descendTo` also clears the selection, which closes the sheet — so the map
   * you just changed is the thing you are looking at.
   */
  const handleDescend = useCallback(
    (nodeId: string) => {
      const childCount = (graph.childrenOf.get(nodeId) ?? []).length;
      if (childCount === 0) return;

      state.descendTo(nodeId);
      fitToDepth(1);

      track('node_expanded', {
        node_id: nodeId,
        child_count: childCount,
        depth: 1,
      });
    },
    [state, graph, fitToDepth],
  );

  const stepTo = useCallback(
    (next: number, direction: 'inward' | 'outward') => {
      fitToDepth(next);
      track('map_layer_stepped', { direction, depth: next });
    },
    [fitToDepth],
  );

  const selectedNode = state.selectedId
    ? (graph.nodes.get(state.selectedId) ?? null)
    : null;
  const currentScale = layout?.scale ?? 1;

  return (
    <Frame ref={frameRef}>
      <CanvasLayer $hidden={view !== 'map'}>
        <MapCanvas
          graph={graph}
          expandedIds={state.expandedIds}
          focus={state.focus}
          centreId={state.centreId}
          selectedId={state.selectedId}
          lens={lens}
          onSelect={handleSelect}
          onExpand={(node) => handleDescend(node.node.id)}
          onOpen={(node) => openNode(node.node.id)}
          onLayout={handleLayout}
          {...(restore ? { initialCamera: restore.camera } : {})}
          cameraRef={cameraRef}
          ringOffset={ringOffset}
          relations={relations}
        />
      </CanvasLayer>

      {view === 'tree' && (
        <TreeLayer>
          <TreeList
            graph={graph}
            expandedIds={state.expandedIds}
            selectedId={state.selectedId}
            rootId={state.centreId}
            onSelect={(id) => {
              tapsRef.current = 2;
              state.select(id);
            }}
            onToggle={handleToggle}
            onOpen={openNode}
          />
        </TreeLayer>
      )}

      <Breadcrumb
        trail={state.trail}
        onNavigate={(id) => {
          state.ascendTo(id);
          cameraRef.current?.recentre();
          track('map_breadcrumb_used', {
            depth_from: state.trail.length,
            depth_to: 1,
          });
        }}
      />

      <ViewToggle
        view={view}
        onChange={(next) => {
          setView(next);
          track('map_view_toggled', { to: next });
        }}
      />

      {view === 'map' && (
        <>
          <LensPill
            lens={lens}
            onChange={setLens}
            signedIn={signedIn}
            /*
             * "DEFAULT · 8 OF 12" — the zoom tier, and how much of ring one is
             * actually on screen.
             *
             * Read off the computed layout rather than the node list, because
             * a cluster is one node standing for several: counting rendered
             * circles would report 8 of 8 on a phone that is hiding four.
             */
            {...(ringOneCaption ? { caption: ringOneCaption } : {})}
          />

          <LayerStepper
            depth={depth}
            maxDepth={state.maxDepth}
            onStepInward={() =>
              stepTo(Math.min(state.maxDepth, depth + 1), 'inward')
            }
            onStepOutward={() => stepTo(Math.max(1, depth - 1), 'outward')}
          />

          {/*
           * Create a map. Signed-out visitors are sent to sign-in with a
           * return target rather than shown a form that cannot submit — the
           * map itself is public, so this is the first control here that
           * genuinely needs an account.
           */}
          <Fab
            type="button"
            aria-label="New map"
            onClick={() => {
              if (!signedIn) {
                router.push(buildRoute.signIn(routes.newMap));
                return;
              }
              setCreating(true);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 6v12" />
              <path d="M6 12h12" />
            </svg>
          </Fab>

          <NewMapSheet open={creating} onClose={() => setCreating(false)} />

          {layout && layout.ringOneHidden > 0 && (
            <MoreChip
              onClick={() =>
                setRingOffset(
                  (offset) => (offset + layout.ringOneHidden) % layout.ringOneTotal,
                )
              }
              /*
               * Announced as what it does, not as what it says. "4 more" alone
               * gives a screen-reader user a number and no verb.
               */
              aria-label={`Show the other ${layout.ringOneHidden} of ${layout.ringOneTotal} in this ring`}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M20 12a8 8 0 1 1-3-6.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M20 4v4h-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {layout.ringOneHidden} more
            </MoreChip>
          )}

          <MapControls
            canZoomIn={currentScale < MAX_SCALE}
            canZoomOut={currentScale > MIN_SCALE}
            /* Clear the inspector when it is open, or the zoom controls sit
               behind it and become unreachable. */
            insetRight={isDesktop && selectedNode ? 360 : 0}
            onZoomIn={() => {
              cameraRef.current?.zoomBy(1.4);
              track('map_zoomed', { surface, scale: 1.4, method: 'button' });
            }}
            onZoomOut={() => {
              cameraRef.current?.zoomBy(1 / 1.4);
              track('map_zoomed', { surface, scale: 0.71, method: 'button' });
            }}
            onRecentre={() => {
              cameraRef.current?.recentre();
              state.collapseAll();
              setDepth(1);
              track('map_recentred', { surface });
            }}
          />

          {layout?.capped && <Whisper role="status">Zoom in to see more</Whisper>}
        </>
      )}

      {/* Screen 03 — a state of this screen, not a route. */}
      <NodeDetailContainer
        node={selectedNode}
        onClose={() => state.select(null)}
        onExpand={handleDescend}
        onNavigateCrumb={(id) => {
          state.ascendTo(id);
          cameraRef.current?.recentre();
        }}
        tapCount={tapsRef.current}
        sessionStart={sessionStartRef.current}
      />
    </Frame>
  );
}
