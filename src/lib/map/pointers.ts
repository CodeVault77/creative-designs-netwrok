import type { Camera } from './camera';
import { panBy, zoomAt } from './camera';
import type { Viewport } from './types';

/**
 * The pointer model.
 *
 * §17 names three decisions that make the eventual 20/40/60-point touch board
 * cheap rather than a rewrite, and this file implements the first of them:
 *
 *   "the renderer tracks pointers by pointerId from day one, never assuming a
 *    single active pointer"
 *
 * Hence a Map keyed by pointerId rather than the usual `isDragging` boolean
 * plus a remembered start position. That pattern costs nothing today and is
 * genuinely expensive to retrofit, because every gesture handler written
 * against a single implicit pointer has to be rewritten.
 *
 * Gestures supported (§09):
 *   one pointer   pan, with momentum at 0.92 friction
 *   two pointers  pinch-zoom anchored at the midpoint, rotation captured and
 *                 discarded
 *   long press    400ms without movement -> expand
 *   double tap    within 280ms and 24px -> open
 */

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  /** Timestamp, ms. */
  t: number;
}

export type GestureKind = 'none' | 'pan' | 'pinch';

export interface GestureState {
  kind: GestureKind;
  pointers: Map<number, PointerSample>;
  /** Where each pointer went down, for tap/long-press discrimination. */
  origins: Map<number, PointerSample>;
  /** Distance between the two pointers when the pinch began. */
  pinchStartDistance: number;
  pinchStartScale: number;
  /**
   * Rotation is captured and discarded (§17). Tracking it prevents the small
   * rotational drift a two-finger gesture always carries from leaking into
   * the pan delta, which otherwise makes pinch feel like it slides.
   */
  rotation: number;
  /** Recent samples for the momentum estimate. */
  velocity: { vx: number; vy: number };
  lastMoveTime: number;
}

export const LONG_PRESS_MS = 400;
export const DOUBLE_TAP_MS = 280;
/** A press that moves more than this is a drag, not a tap. */
export const TAP_SLOP_PX = 12;
export const DOUBLE_TAP_SLOP_PX = 24;

export function createGestureState(): GestureState {
  return {
    kind: 'none',
    pointers: new Map(),
    origins: new Map(),
    pinchStartDistance: 0,
    pinchStartScale: 1,
    rotation: 0,
    velocity: { vx: 0, vy: 0 },
    lastMoveTime: 0,
  };
}

function midpoint(a: PointerSample, b: PointerSample) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: PointerSample, b: PointerSample) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angle(a: PointerSample, b: PointerSample) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function twoPointers(state: GestureState): [PointerSample, PointerSample] | null {
  const list = [...state.pointers.values()];
  if (list.length < 2) return null;
  // Always the two lowest ids, so a third finger landing does not reassign
  // which pair drives the pinch mid-gesture.
  list.sort((a, b) => a.id - b.id);
  return [list[0]!, list[1]!];
}

export function onPointerDown(
  state: GestureState,
  sample: PointerSample,
  camera: Camera,
): GestureState {
  state.pointers.set(sample.id, sample);
  state.origins.set(sample.id, sample);
  state.velocity = { vx: 0, vy: 0 };

  const pair = twoPointers(state);
  if (pair) {
    state.kind = 'pinch';
    state.pinchStartDistance = distance(pair[0], pair[1]);
    state.pinchStartScale = camera.scale;
    state.rotation = angle(pair[0], pair[1]);
  } else {
    state.kind = 'pan';
  }

  return state;
}

export interface MoveResult {
  camera: Camera;
  /** True while a gesture is actively changing the camera — drives `flat`. */
  active: boolean;
}

export function onPointerMove(
  state: GestureState,
  sample: PointerSample,
  camera: Camera,
  viewport: Viewport,
): MoveResult {
  const previous = state.pointers.get(sample.id);
  if (!previous) return { camera, active: state.kind !== 'none' };

  state.pointers.set(sample.id, sample);

  const pair = twoPointers(state);

  if (state.kind === 'pinch' && pair) {
    const currentDistance = distance(pair[0], pair[1]);
    if (state.pinchStartDistance <= 0) return { camera, active: true };

    const ratio = currentDistance / state.pinchStartDistance;
    const centre = midpoint(pair[0], pair[1]);

    // Rotation is measured and thrown away — see the note at the top.
    state.rotation = angle(pair[0], pair[1]);

    const next = zoomAt(
      camera,
      state.pinchStartScale * ratio,
      centre.x,
      centre.y,
      viewport,
    );
    return { camera: next, active: true };
  }

  if (state.kind === 'pan') {
    const dx = sample.x - previous.x;
    const dy = sample.y - previous.y;

    const dt = Math.max(1, sample.t - previous.t);
    // Velocity in world units per frame, assuming 16ms frames.
    state.velocity = {
      vx: (dx / camera.scale / dt) * 16,
      vy: (dy / camera.scale / dt) * 16,
    };
    state.lastMoveTime = sample.t;

    return { camera: panBy(camera, dx, dy), active: true };
  }

  return { camera, active: false };
}

export interface UpResult {
  /** Momentum to hand to the animation loop, or null if the gesture was a tap. */
  momentum: { vx: number; vy: number } | null;
  /** True when the pointer went down and up without meaningful movement. */
  wasTap: boolean;
  /** Where the tap landed, for hit-testing. */
  tapPoint: { x: number; y: number } | null;
  active: boolean;
}

export function onPointerUp(state: GestureState, sample: PointerSample): UpResult {
  const origin = state.origins.get(sample.id);
  state.pointers.delete(sample.id);
  state.origins.delete(sample.id);

  const travelled = origin
    ? Math.hypot(sample.x - origin.x, sample.y - origin.y)
    : Infinity;
  const wasTap = state.kind === 'pan' && travelled <= TAP_SLOP_PX;

  const remaining = state.pointers.size;

  if (remaining === 0) {
    const wasPinch = state.kind === 'pinch';
    state.kind = 'none';

    // A pinch never coasts. Momentum after a two-finger gesture reads as the
    // map slipping out from under you.
    const momentum =
      wasTap || wasPinch || Math.hypot(state.velocity.vx, state.velocity.vy) < 0.5
        ? null
        : { ...state.velocity };

    return {
      momentum,
      wasTap,
      tapPoint: wasTap ? { x: sample.x, y: sample.y } : null,
      active: false,
    };
  }

  // Lifting one finger of a pinch drops back to a pan on the remaining one,
  // rather than ending the gesture and stranding the map mid-zoom.
  state.kind = remaining >= 2 ? 'pinch' : 'pan';
  state.velocity = { vx: 0, vy: 0 };

  return { momentum: null, wasTap: false, tapPoint: null, active: true };
}

export function onPointerCancel(state: GestureState, pointerId: number): void {
  state.pointers.delete(pointerId);
  state.origins.delete(pointerId);
  if (state.pointers.size === 0) {
    state.kind = 'none';
    state.velocity = { vx: 0, vy: 0 };
  }
}

/**
 * Whether a pointer has been held still long enough to count as a long press.
 * Callers poll this on a timer rather than the module owning one, so the
 * gesture model stays free of timers and remains testable.
 */
export function isLongPress(
  state: GestureState,
  pointerId: number,
  now: number,
): boolean {
  const origin = state.origins.get(pointerId);
  const current = state.pointers.get(pointerId);
  if (!origin || !current) return false;
  if (state.kind !== 'pan') return false;

  const travelled = Math.hypot(current.x - origin.x, current.y - origin.y);
  return travelled <= TAP_SLOP_PX && now - origin.t >= LONG_PRESS_MS;
}

/** Whether two taps should be treated as a double tap. */
export function isDoubleTap(
  previous: { x: number; y: number; t: number } | null,
  current: { x: number; y: number; t: number },
): boolean {
  if (!previous) return false;
  return (
    current.t - previous.t <= DOUBLE_TAP_MS &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <= DOUBLE_TAP_SLOP_PX
  );
}
