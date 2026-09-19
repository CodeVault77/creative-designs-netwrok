'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import {
  IDENTITY_CAMERA,
  easeCamera,
  lerpCamera,
  screenToWorld,
  stepMomentum,
  zoomAt,
  type Camera,
} from '@/lib/map/camera';
import { cameraToFit, computeLayout, type LayoutResult } from '@/lib/map/layout';
import { hitTest } from '@/lib/map/hitTest';
import { render } from '@/lib/map/renderer';
import { warmGlowCache } from '@/lib/map/glowSprites';
import {
  createGestureState,
  isDoubleTap,
  isLongPress,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  LONG_PRESS_MS,
} from '@/lib/map/pointers';
import { prefersReducedMotion } from '@/lib/styles/motion';
import type {
  MapGraph,
  PlacedNode,
  RelationInput,
  Viewport,
} from '@/lib/map/types';
import type { FocusModel } from '@/lib/map/layout';

/**
 * The map canvas.
 *
 * React owns mounting, sizing and the callbacks out. It does NOT own the
 * camera, the layout or the frame loop — those live in refs and run inside
 * requestAnimationFrame, because a setState per pointermove would re-render
 * the tree 120 times a second and no amount of memoisation makes that
 * acceptable at 150 nodes.
 *
 * The rule: state that changes per-frame lives in a ref; state the rest of
 * the app needs lives in React.
 */

export interface MapCanvasProps {
  graph: MapGraph;
  expandedIds: ReadonlySet<string>;
  focus: FocusModel;
  centreId: string;
  selectedId: string | null;
  onSelect: (node: PlacedNode | null) => void;
  onExpand: (node: PlacedNode, additive: boolean) => void;
  onOpen: (node: PlacedNode) => void;
  /** Reports layout stats for the "zoom in to see more" whisper and tests. */
  onLayout?: (result: LayoutResult) => void;
  searchMatchIds?: ReadonlySet<string> | null;
  /** Active lens (§06). Filters or re-lays the ring — see layout.ts. */
  lens?: 'all' | 'active' | 'trending' | 'mine';
  /** Which window of ring one to show when it does not all fit (§17). */
  ringOffset?: number;
  /**
   * Explicit typed relationships from `node_edges`, drawn over the tree.
   *
   * Optional: a map with none renders exactly as before.
   */
  relations?: readonly RelationInput[];
  /**
   * Edit mode (§14: "the editor must feel like the same world").
   *
   * The SAME canvas, with dragging layered on. A separate editor renderer
   * would drift within a sprint and every P3 performance decision would have
   * to be made twice.
   */
  editable?: boolean;
  /**
   * Fired on DROP, never during the drag. One drag is one undo step; emitting
   * per pointermove would make a single reposition take sixty undos.
   */
  onNodeDrop?: (
    nodeId: string,
    drop: {
      targetId: string | null;
      slot: number | null;
      freeX?: number;
      freeY?: number;
    },
  ) => void;
  /**
   * Starting camera. When present it REPLACES the fit-on-mount.
   *
   * Without it, restoring a snapshot lost a race: the restore ran on mount,
   * then ResizeObserver measured the viewport and the fit overwrote it — so
   * returning from search always landed at the default zoom. A flag beats a
   * race.
   */
  initialCamera?: Camera;
  /**
   * Which ring the opening fit should frame. One for the browsable map, where
   * deeper rings are meant to be panned to. A fixed-height embed with no room
   * to pan wants its deepest occupied ring, or the outer nodes open clipped.
   */
  fitDepth?: number;
  /** Imperative handle for MapControls and the layer stepper. */
  cameraRef?: React.MutableRefObject<MapCameraHandle | null>;
}

export interface MapCameraHandle {
  zoomBy: (factor: number) => void;
  setScale: (scale: number) => void;
  recentre: () => void;
  easeTo: (camera: Camera) => void;
  getCamera: () => Camera;
}

const Host = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--ground-canvas);
  /* The canvas owns every gesture; the browser must not also pan or zoom. */
  touch-action: none;
  overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
`;

const Surface = styled.canvas`
  display: block;
  width: 100%;
  height: 100%;
`;

export function MapCanvas({
  graph,
  expandedIds,
  focus,
  centreId,
  selectedId,
  onSelect,
  onExpand,
  onOpen,
  onLayout,
  searchMatchIds,
  lens,
  ringOffset,
  relations,
  editable = false,
  onNodeDrop,
  initialCamera,
  fitDepth = 1,
  cameraRef,
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ---- per-frame state, deliberately outside React -------------------------
  const cameraStateRef = useRef<Camera>(IDENTITY_CAMERA);
  const gestureRef = useRef(createGestureState());
  const momentumRef = useRef<{ vx: number; vy: number } | null>(null);
  const layoutRef = useRef<LayoutResult | null>(null);
  const activeGestureRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);
  const easeRef = useRef<{ from: Camera; to: Camera; start: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  /**
   * Node drag state. Lives in a ref for the same reason the camera does: it
   * changes every frame, and a setState per pointermove would re-render the
   * whole tree at pointer rate.
   */
  const dragRef = useRef<{
    nodeId: string;
    startWorld: { x: number; y: number };
    offset: { x: number; y: number };
    current: { x: number; y: number };
    free: boolean;
    moved: boolean;
  } | null>(null);
  const dropTargetRef = useRef<string | null>(null);

  // ---- props that the frame loop reads, mirrored into refs ----------------
  const propsRef = useRef({
    graph,
    expandedIds,
    focus,
    centreId,
    selectedId,
    searchMatchIds,
    lens,
    ringOffset,
    relations,
  });
  propsRef.current = {
    graph,
    expandedIds,
    focus,
    centreId,
    selectedId,
    searchMatchIds,
    lens,
    ringOffset,
    relations,
  };

  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  // ------------------------------------------------------------------ sizing

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewport({ width, height });
      markDirty();
    });

    observer.observe(host);
    return () => observer.disconnect();
  }, [markDirty]);

  // Bake the 18 glow sprites before the first frame that needs them, so the
  // opening bloom does not stutter while they are generated lazily.
  useEffect(() => {
    warmGlowCache(Math.min(3, window.devicePixelRatio || 1));
  }, []);

  // Fit ring one to the viewport once, as soon as the size is known. Opening
  // cropped costs the user seconds of the F1 budget before they have done
  // anything.
  //
  // An explicit initialCamera wins: it means the caller is restoring a
  // remembered position, and fitting over it would discard the very thing the
  // user asked to get back.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current) return;
    if (viewport.width === 0 || viewport.height === 0) return;
    fittedRef.current = true;
    cameraStateRef.current = initialCamera ?? cameraToFit(fitDepth, viewport);
    markDirty();
  }, [viewport, initialCamera, fitDepth, markDirty]);

  // ------------------------------------------------------------- frame loop

  useEffect(() => {
    if (viewport.width === 0 || viewport.height === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);

    const frame = (now: number) => {
      frameRef.current = requestAnimationFrame(frame);

      // --- camera easing (recentre, layer step, breadcrumb jump) -----------
      const ease = easeRef.current;
      if (ease) {
        const duration = prefersReducedMotion() ? 0 : 420;
        const t = duration === 0 ? 1 : (now - ease.start) / duration;
        cameraStateRef.current = lerpCamera(ease.from, ease.to, easeCamera(t));
        if (t >= 1) easeRef.current = null;
        dirtyRef.current = true;
      }

      // --- momentum --------------------------------------------------------
      const momentum = momentumRef.current;
      if (momentum && !ease) {
        const stepped = stepMomentum(cameraStateRef.current, momentum);
        if (stepped) {
          cameraStateRef.current = stepped.camera;
          momentumRef.current = stepped.momentum;
          dirtyRef.current = true;
        } else {
          momentumRef.current = null;
          // Glow comes back only once the map has actually stopped.
          activeGestureRef.current = false;
          dirtyRef.current = true;
        }
      }

      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const p = propsRef.current;
      const result = computeLayout({
        graph: p.graph,
        expandedIds: p.expandedIds,
        focus: p.focus,
        camera: cameraStateRef.current,
        viewport: viewportRef.current,
        centreId: p.centreId,
        searchMatchIds: p.searchMatchIds ?? null,
        lens: p.lens ?? 'all',
        ringOffset: p.ringOffset ?? 0,
        ...(p.relations ? { relations: p.relations } : {}),
      });

      layoutRef.current = result;
      onLayout?.(result);

      // Reflect the live camera scale onto the host element.
      //
      // The camera lives in a ref and never reaches React state, which is what
      // keeps the frame loop cheap — but it also means nothing outside this
      // component can see where the camera is. This attribute is the one
      // read-only window onto it, used by the browser harness to compute where
      // a node currently is, and useful when debugging by eye.
      if (hostRef.current) {
        const cam = cameraStateRef.current;
        hostRef.current.dataset.scale = cam.scale.toFixed(4);
        // Pan as well as zoom: a scale-only window cannot tell "restored to
        // where the user was" apart from "fitted to the viewport", because a
        // pan leaves the scale exactly where the fit put it.
        hostRef.current.dataset.cameraX = cam.x.toFixed(2);
        hostRef.current.dataset.cameraY = cam.y.toFixed(2);
      }

      // The dragged node is drawn at the pointer rather than at its stored
      // position. Applying the move to the draft on every frame would flood
      // the command stack; overriding the drawn position does not.
      const drag = dragRef.current;
      const nodes = drag
        ? result.nodes.map((item) =>
            item.node.id === drag.nodeId
              ? { ...item, x: drag.current.x, y: drag.current.y }
              : item,
          )
        : result.nodes;

      render({
        ctx,
        camera: cameraStateRef.current,
        viewport: viewportRef.current,
        nodes,
        edges: result.edges,
        tier: result.tier,
        selectedId: p.selectedId,
        // §09: draw flat during pinch/pan, restore glow on gesture end.
        flat: activeGestureRef.current,
        dpr,
        searchMatchIds: p.searchMatchIds ?? null,
        dropTargetId: dropTargetRef.current,
        draggingId: drag?.nodeId ?? null,
      });
    };

    frameRef.current = requestAnimationFrame(frame);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [viewport.width, viewport.height, onLayout]);

  // Any prop the layout depends on invalidates the frame.
  useEffect(markDirty, [
    graph,
    expandedIds,
    focus,
    centreId,
    selectedId,
    searchMatchIds,
    lens,
    ringOffset,
    markDirty,
  ]);

  // ------------------------------------------------------ imperative handle

  useEffect(() => {
    if (!cameraRef) return;

    const easeTo = (to: Camera) => {
      easeRef.current = {
        from: cameraStateRef.current,
        to,
        start: performance.now(),
      };
      momentumRef.current = null;
      markDirty();
    };

    cameraRef.current = {
      getCamera: () => cameraStateRef.current,
      easeTo,
      setScale: (scale) => {
        const v = viewportRef.current;
        easeTo(zoomAt(cameraStateRef.current, scale, v.width / 2, v.height / 2, v));
      },
      zoomBy: (factor) => {
        const v = viewportRef.current;
        easeTo(
          zoomAt(
            cameraStateRef.current,
            cameraStateRef.current.scale * factor,
            v.width / 2,
            v.height / 2,
            v,
          ),
        );
      },
      // §09: recentre is ALWAYS animated. A teleporting camera loses the user.
      // It returns to the FITTED view, not to scale 1 — "home" means the view
      // you started from, not an arbitrary zoom level.
      recentre: () => easeTo(cameraToFit(fitDepth, viewportRef.current)),
    };

    return () => {
      cameraRef.current = null;
    };
  }, [cameraRef, fitDepth, markDirty]);

  // ------------------------------------------------------------- pointers

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const localPoint = useCallback((event: React.PointerEvent) => {
    const rect = hostRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Capture keeps the gesture alive when the finger leaves the element,
      // but it throws if the pointer has already been released — which happens
      // with synthetic events and during fast multi-touch. Losing capture
      // degrades the gesture slightly; letting it throw kills the whole
      // interaction, so it must never be fatal.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* gesture continues without capture */
      }

      const point = localPoint(event);

      momentumRef.current = null;
      easeRef.current = null;
      activeGestureRef.current = true;

      /*
       * §10: "Drag node → reposition (edit mode only). Never pans the canvas
       * mid-drag." The two are told apart HERE, by what is under the pointer,
       * rather than by a mode flag set somewhere in the gesture handler —
       * which is how a drag ends up doing both.
       */
      if (editable) {
        const hit = hitTest(
          layoutRef.current?.nodes ?? [],
          point.x,
          point.y,
          cameraStateRef.current,
          viewportRef.current,
        );

        // The root is the map's anchor and never moves.
        if (hit && hit.depth > 0) {
          const world = screenToWorld(
            point.x,
            point.y,
            cameraStateRef.current,
            viewportRef.current,
          );
          dragRef.current = {
            nodeId: hit.node.id,
            startWorld: { x: hit.x, y: hit.y },
            offset: { x: hit.x - world.x, y: hit.y - world.y },
            current: { x: hit.x, y: hit.y },
            // §14: "Snap to slots by default; Alt+drag for free position."
            free: event.altKey,
            moved: false,
          };
          markDirty();
          return;
        }
      }

      onPointerDown(
        gestureRef.current,
        { id: event.pointerId, x: point.x, y: point.y, t: event.timeStamp },
        cameraStateRef.current,
      );

      // §09: long press 400ms expands. Polled rather than owned by the gesture
      // module, so that module stays timer-free and testable.
      clearLongPress();
      longPressTimerRef.current = window.setTimeout(() => {
        if (!isLongPress(gestureRef.current, event.pointerId, performance.now()))
          return;
        const nodes = layoutRef.current?.nodes ?? [];
        const hit = hitTest(
          nodes,
          point.x,
          point.y,
          cameraStateRef.current,
          viewportRef.current,
        );
        if (hit && hit.depth > 0) {
          onExpand(hit, false);
          if ('vibrate' in navigator) navigator.vibrate?.(8);
        }
      }, LONG_PRESS_MS);

      markDirty();
    },
    [localPoint, onExpand, clearLongPress, markDirty, editable],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = localPoint(event);

      const drag = dragRef.current;
      if (drag) {
        const world = screenToWorld(
          point.x,
          point.y,
          cameraStateRef.current,
          viewportRef.current,
        );
        drag.current = { x: world.x + drag.offset.x, y: world.y + drag.offset.y };
        drag.moved = true;

        // §14: "target highlights". The drop target is resolved live so the
        // user knows what will happen before they let go — a reparent that
        // only becomes visible after the drop is a reparent people undo.
        const over = hitTest(
          layoutRef.current?.nodes ?? [],
          point.x,
          point.y,
          cameraStateRef.current,
          viewportRef.current,
        );
        dropTargetRef.current =
          over && over.node.id !== drag.nodeId ? over.node.id : null;

        markDirty();
        return;
      }

      if (!gestureRef.current.pointers.has(event.pointerId)) return;

      const result = onPointerMove(
        gestureRef.current,
        { id: event.pointerId, x: point.x, y: point.y, t: event.timeStamp },
        cameraStateRef.current,
        viewportRef.current,
      );

      cameraStateRef.current = result.camera;
      activeGestureRef.current = result.active;
      markDirty();
    },
    [localPoint, markDirty],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      clearLongPress();
      const point = localPoint(event);

      const drag = dragRef.current;
      if (drag) {
        dragRef.current = null;
        const target = dropTargetRef.current;
        dropTargetRef.current = null;
        activeGestureRef.current = false;

        if (drag.moved) {
          // ONE command, on drop. See the note on onNodeDrop.
          onNodeDrop?.(drag.nodeId, {
            targetId: target,
            slot: null,
            ...(drag.free ? { freeX: drag.current.x, freeY: drag.current.y } : {}),
          });
        } else {
          // A press that did not move is a tap, not a drag.
          const hit = hitTest(
            layoutRef.current?.nodes ?? [],
            point.x,
            point.y,
            cameraStateRef.current,
            viewportRef.current,
          );
          if (hit) onSelect(hit);
        }

        markDirty();
        return;
      }

      const result = onPointerUp(gestureRef.current, {
        id: event.pointerId,
        x: point.x,
        y: point.y,
        t: event.timeStamp,
      });

      momentumRef.current = result.momentum;
      // Glow stays off while momentum coasts; the frame loop restores it.
      activeGestureRef.current = result.active || result.momentum !== null;

      if (result.wasTap && result.tapPoint) {
        const nodes = layoutRef.current?.nodes ?? [];
        const hit = hitTest(
          nodes,
          result.tapPoint.x,
          result.tapPoint.y,
          cameraStateRef.current,
          viewportRef.current,
        );

        const tap = { ...result.tapPoint, t: event.timeStamp };
        const isDouble = isDoubleTap(lastTapRef.current, tap);
        lastTapRef.current = tap;

        if (hit) {
          // §10: single tap SELECTS and opens detail; it never navigates
          // away, because that is far too easy to trigger while panning.
          // Double tap opens.
          if (isDouble) onOpen(hit);
          else onSelect(hit);
        } else {
          onSelect(null);
        }
      }

      markDirty();
    },
    [localPoint, onSelect, onOpen, onNodeDrop, clearLongPress, markDirty],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      clearLongPress();
      dragRef.current = null;
      dropTargetRef.current = null;
      onPointerCancel(gestureRef.current, event.pointerId);
      activeGestureRef.current = gestureRef.current.pointers.size > 0;
      markDirty();
    },
    [clearLongPress, markDirty],
  );

  // Wheel must be a native non-passive listener: React's synthetic onWheel is
  // passive, so preventDefault() there is ignored and the page scrolls behind
  // the map.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);

      cameraStateRef.current = zoomAt(
        cameraStateRef.current,
        cameraStateRef.current.scale * factor,
        event.clientX - rect.left,
        event.clientY - rect.top,
        viewportRef.current,
      );
      markDirty();
    };

    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [markDirty]);

  useEffect(() => clearLongPress, [clearLongPress]);

  return (
    <Host
      ref={hostRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      data-map-canvas
    >
      {/*
        aria-hidden with a real alternative elsewhere. A canvas cannot be made
        meaningfully accessible by adding labels to it; §17's answer is the
        tree view, which renders the same state as focusable DOM. Pretending
        the canvas is accessible would be worse than admitting it is not.
      */}
      <Surface ref={canvasRef} aria-hidden="true" />
    </Host>
  );
}
