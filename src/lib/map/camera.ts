import type { Viewport } from './types';

/**
 * The camera: world <-> screen, zoom, clamping, momentum.
 *
 * Pure functions over an immutable Camera. Keeping this free of canvas and
 * React means the whole navigation model — including the parts hardest to get
 * right, anchored zoom and momentum — is unit-testable without a DOM.
 */

export interface Camera {
  /** World coordinate at the centre of the viewport. */
  x: number;
  y: number;
  /** 1 = 100%. §09 clamps to 0.35–2.4. */
  scale: number;
}

export const MIN_SCALE = 0.35;
export const MAX_SCALE = 2.4;

/** §09: momentum friction per frame at 60fps. */
export const FRICTION = 0.92;

/** Below this speed (world units/frame) momentum stops rather than crawling. */
const MOMENTUM_CUTOFF = 0.08;

export const IDENTITY_CAMERA: Camera = { x: 0, y: 0, scale: 1 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(
  wx: number,
  wy: number,
  camera: Camera,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (wx - camera.x) * camera.scale + viewport.width / 2,
    y: (wy - camera.y) * camera.scale + viewport.height / 2,
  };
}

export function screenToWorld(
  sx: number,
  sy: number,
  camera: Camera,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (sx - viewport.width / 2) / camera.scale + camera.x,
    y: (sy - viewport.height / 2) / camera.scale + camera.y,
  };
}

/**
 * Zoom anchored at a screen point (§09: "anchored at gesture midpoint").
 *
 * The world point under the anchor must stay under the anchor. Without this,
 * pinching appears to drag the map toward the viewport centre and the gesture
 * feels broken in a way people notice immediately but rarely articulate.
 */
export function zoomAt(
  camera: Camera,
  nextScale: number,
  anchorScreenX: number,
  anchorScreenY: number,
  viewport: Viewport,
): Camera {
  const scale = clampScale(nextScale);
  if (scale === camera.scale) return camera;

  // The world point currently under the anchor.
  const before = screenToWorld(anchorScreenX, anchorScreenY, camera, viewport);
  // Where that world point would land after a naive scale change.
  const after = screenToWorld(
    anchorScreenX,
    anchorScreenY,
    { ...camera, scale },
    viewport,
  );

  return {
    scale,
    x: camera.x + (before.x - after.x),
    y: camera.y + (before.y - after.y),
  };
}

/** Pans by a screen-space delta, converting to world units. */
export function panBy(camera: Camera, dxScreen: number, dyScreen: number): Camera {
  return {
    ...camera,
    x: camera.x - dxScreen / camera.scale,
    y: camera.y - dyScreen / camera.scale,
  };
}

export interface Momentum {
  vx: number;
  vy: number;
}

/**
 * One momentum step. Returns null once the glide has effectively stopped, so
 * the caller can end the animation frame loop rather than burning frames on
 * sub-pixel movement.
 */
export function stepMomentum(
  camera: Camera,
  momentum: Momentum,
): { camera: Camera; momentum: Momentum } | null {
  const vx = momentum.vx * FRICTION;
  const vy = momentum.vy * FRICTION;

  if (Math.hypot(vx, vy) < MOMENTUM_CUTOFF) return null;

  return {
    camera: { ...camera, x: camera.x - vx, y: camera.y - vy },
    momentum: { vx, vy },
  };
}

/**
 * Eases a camera toward a target. `t` is 0–1 progress, already eased by the
 * caller, so this stays a pure lerp and the easing curve lives with the
 * motion tokens.
 */
export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped,
    scale: from.scale + (to.scale - from.scale) * clamped,
  };
}

/** §09 camera easing: cubic-bezier(.25,.9,.25,1), approximated for JS use. */
export function easeCamera(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * The world-space rectangle currently visible, expanded by `margin`.
 *
 * §09 culls to viewport + 20%. The margin exists so nodes are already drawn
 * when they slide in during a pan, rather than popping into existence at the
 * edge.
 */
export function visibleBounds(
  camera: Camera,
  viewport: Viewport,
  margin = 0.2,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const halfW = viewport.width / 2 / camera.scale;
  const halfH = viewport.height / 2 / camera.scale;
  const padX = halfW * margin;
  const padY = halfH * margin;

  return {
    minX: camera.x - halfW - padX,
    maxX: camera.x + halfW + padX,
    minY: camera.y - halfH - padY,
    maxY: camera.y + halfH + padY,
  };
}
