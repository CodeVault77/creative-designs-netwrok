import type { Camera } from './camera';
import { screenToWorld } from './camera';
import type { PlacedNode, Viewport } from './types';
import { tokens } from '@/lib/styles/tokens.generated';

/**
 * Hit-testing.
 *
 * §10: "Touch targets are a minimum 88px capsule enclosing circle and label,
 * regardless of the drawn circle size — hit geometry is separate from visual
 * geometry in the renderer."
 *
 * That separation is the whole point of this file. A 12px dot at Overview
 * scale is untappable if its hit area matches its pixels; giving it an 88px
 * screen-space target is what makes the zoomed-out map usable at all.
 *
 * The target is measured in SCREEN space, not world space. A world-space
 * target would shrink as the user zooms out — exactly when it is needed most.
 */

export function minHitTargetFor(viewportWidth: number): number {
  // §17: 88px on touch breakpoints, 44px on pointer ones.
  return viewportWidth >= tokens.breakpoint.desktop.min
    ? parseInt(tokens.control.pointer.minHitTarget, 10)
    : parseInt(tokens.control.touch.minHitTarget, 10);
}

export interface HitTestOptions {
  /** Overrides the breakpoint-derived minimum. Mostly for tests. */
  minTarget?: number;
}

/**
 * The node under a screen point, or null.
 *
 * Iterates in reverse so later-drawn nodes win — matching what the user sees
 * when two targets overlap.
 */
export function hitTest(
  nodes: readonly PlacedNode[],
  screenX: number,
  screenY: number,
  camera: Camera,
  viewport: Viewport,
  options: HitTestOptions = {},
): PlacedNode | null {
  const minTarget = options.minTarget ?? minHitTargetFor(viewport.width);
  const world = screenToWorld(screenX, screenY, camera, viewport);

  let best: PlacedNode | null = null;
  let bestDistance = Infinity;

  for (let i = nodes.length - 1; i >= 0; i--) {
    const item = nodes[i]!;

    // A fully dimmed node is still hittable — §10 says inactive nodes stay
    // selectable, and search-dimmed nodes must remain reachable. Only
    // genuinely invisible things should be excluded.
    if (item.opacity <= 0) continue;

    // Visual radius in world units...
    const visualRadius = item.size / 2;
    // ...versus the minimum target converted from screen to world units.
    const targetRadius = minTarget / 2 / camera.scale;
    const radius = Math.max(visualRadius, targetRadius);

    const distance = Math.hypot(world.x - item.x, world.y - item.y);
    if (distance <= radius && distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * Whether a screen point is over empty canvas.
 *
 * Used to decide whether a drag pans the camera or moves a node: §10 says a
 * node drag must never pan the canvas mid-drag, and the two are told apart
 * here rather than by a flag set somewhere in the gesture handler.
 */
export function isEmptyCanvas(
  nodes: readonly PlacedNode[],
  screenX: number,
  screenY: number,
  camera: Camera,
  viewport: Viewport,
  options: HitTestOptions = {},
): boolean {
  return hitTest(nodes, screenX, screenY, camera, viewport, options) === null;
}
