import type { MapGraph, MapNode } from './types';

/**
 * Polar layout (§09).
 *
 *   R(r) = R0 + r × G      R0 = 148, G = 132 on mobile
 *                          R0 = 190, G = 168 on desktop
 *
 *   slot i of n sits at θ = -90° + i × (360/n)
 *
 * Two properties this file must never lose:
 *
 * 1. **Slots are fixed.** A node's angle depends only on its slot and its
 *    sibling count — never on weight, engagement or render order. Position is
 *    the only durable thing a spatial interface has (ADR-0002). If you ever
 *    find yourself passing a score into an angle calculation, stop.
 *
 * 2. **Node 1 is always at twelve o'clock.** The -90° offset is what makes the
 *    numbering in §10 a usable address ("node 7 is at four o'clock") and what
 *    lets people build muscle memory.
 */

export interface GeometrySpec {
  /** Radius of ring one. */
  R0: number;
  /** Radial gap between rings. */
  G: number;
  /** Root node diameter. */
  rootSize: number;
  /** Node diameter at weight 0 and weight 1 (§09: 56 → 72). */
  minNodeSize: number;
  maxNodeSize: number;
}

/**
 * Node sizes are matched to the design reference, where a ring-one circle is
 * about 46px against a 92px root — roughly a 1:2 ratio, so the centre is
 * unmistakably the centre.
 *
 * They were 56–72, which at the default fit left a 3-o'clock node's right edge
 * past the point where the zoom column starts: the controls sat on top of the
 * ring. Smaller circles and a slightly tighter fit clear them without shrinking
 * the map back into the middle of the screen.
 */
export const MOBILE_GEOMETRY: GeometrySpec = {
  /*
   * R0 is up from 148 and the root is down from 96, to lengthen the SPOKES.
   *
   * The visible part of a connector is the ring radius minus the two circles
   * it joins, so at the old proportions the root and the node between them ate
   * more than half of it and the map read as circles jammed against a hub. The
   * reference gives the lines roughly 60% of the radius; these values get to
   * about 59% without shrinking a node below a comfortable tap target.
   *
   * Raising R0 alone would have done nothing: the camera fits to the outermost
   * ring, so a bigger radius is cancelled by a smaller scale and the spoke
   * comes out the same length on screen. What lengthens it is the RATIO of the
   * radius to the circles at each end.
   *
   * The root is deliberately DOMINANT here — large enough to carry the brand
   * lockup (mark, three-colour wordmark, tagline) rather than a title, which
   * is what the community map's centre is for. That costs spoke length, and
   * the trade was made knowingly: the centre is the thing people recognise.
   *
   * R0 is chosen so the fit lands near 0.75 — comfortably inside the `default`
   * zoom tier. Too large and the scale drops under 0.6, which switches the
   * renderer to overview and draws every node as a bare dot.
   */
  R0: 160,
  G: 132,
  rootSize: 165,
  minNodeSize: 46,
  maxNodeSize: 58,
};

export const DESKTOP_GEOMETRY: GeometrySpec = {
  /* Same rebalance as mobile — see the note there. */
  /*
   * Raised well past the old 216, specifically to make room for the
   * description line `renderer.ts` now draws under a ring-one label on
   * desktop. `fitScaleFor` explains why raising R0 alone is not a no-op the
   * way it would look at first: a desktop viewport has so much spare width
   * that the fit is already pinned at its scale-1 ceiling, not still solving
   * for scale, so a bigger R0 here becomes bigger ON-SCREEN spacing between
   * nodes almost directly, rather than being cancelled out by a smaller fit
   * scale the way it would be nearer the ceiling's edge. Chosen by rendering
   * the real 12-node ring at 1440px and increasing R0 until adjacent nodes'
   * two-line captions stopped colliding with their neighbours.
   */
  R0: 400,
  G: 260,
  rootSize: 200,
  minNodeSize: 76,
  maxNodeSize: 96,
};

/**
 * §17 puts the desktop geometry at 1024px and above.
 *
 * Exported rather than left as a literal inside `geometryFor`, because
 * `renderer.ts` needs the same threshold to decide whether there is room for
 * a ring-one description line under a label — and a second hand-copied
 * `1024` is exactly the kind of thing that drifts from this one when either
 * changes.
 */
export const DESKTOP_BREAKPOINT = 1024;

export function geometryFor(viewportWidth: number): GeometrySpec {
  return viewportWidth >= DESKTOP_BREAKPOINT ? DESKTOP_GEOMETRY : MOBILE_GEOMETRY;
}

/** R(r) = R0 + r × G. Depth 0 (the root) sits at the origin. */
export function ringRadius(depth: number, spec: GeometrySpec): number {
  if (depth <= 0) return 0;
  return spec.R0 + (depth - 1) * spec.G;
}

/**
 * θ for slot i of n, in radians, measured from the positive x-axis.
 *
 * -90° puts slot 0 at twelve o'clock. Canvas y grows downward, so this same
 * value is used directly in the sin/cos below without a flip.
 */
export function slotAngle(slot: number, siblingCount: number): number {
  if (siblingCount <= 0) return -Math.PI / 2;
  const step = (Math.PI * 2) / siblingCount;
  return -Math.PI / 2 + slot * step;
}

/**
 * Node diameter from weight.
 *
 * ADR-0002: weight drives size and glow, never position. The range is kept
 * deliberately narrow (56–72) so a hot node cannot overlap its neighbours and
 * break the ring's readability.
 */
export function nodeSize(weight: number, spec: GeometrySpec): number {
  const clamped = Math.min(1, Math.max(0, weight));
  return spec.minNodeSize + clamped * (spec.maxNodeSize - spec.minNodeSize);
}

export interface PolarPosition {
  x: number;
  y: number;
  theta: number;
  radius: number;
}

/**
 * Places a node in world space.
 *
 * `parentTheta` biases a subtree so children bloom outward from their parent
 * rather than wrapping the full circle — without it, ring two of node 7 would
 * sprawl across the whole map and cross every other branch.
 */
/**
 * Horizontal space the ring may NOT use, per side.
 *
 * The zoom column and the layer stepper are vertically centred on the left and
 * right edges — exactly the height ring one passes through — so this is not
 * free canvas at the only place it matters.
 *
 * 28, not the controls' full 52. It keeps node CIRCLES off the controls while
 * letting the labels beneath them run past — which is what the design
 * reference does too. Reserving the full width bought tidy labels at the cost
 * of roughly 50px of ring radius, and on a 390px phone that is the difference
 * between a centre that can hold the brand lockup and one that cannot.
 */
export const SIDE_CHROME = 28;

/**
 * How far the ring is stretched vertically to use the space that is there.
 *
 * The result is the ratio of the room available above the centre to the room
 * available beside it, so a spoke pointing up is as long as the frame allows
 * and a spoke pointing sideways stops short of the controls. On a square frame
 * this returns 1 and the ring is a circle again.
 *
 * Clamped at 1.5. The cap, not the frame, is what sets the vertical reach on a
 * phone: a 390x620 frame would allow about 2.7, so this is a deliberate choice
 * to stop well short of the room available. The taller the ring gets the more
 * it reads as a slot rather than a ring — the diagonal neighbours bunch toward
 * the poles, and the top and bottom spokes grow long enough to look like a
 * different kind of connection from the side ones.
 *
 * Because only y is scaled, lowering this shortens the vertical spokes in
 * full, the diagonals in proportion to how vertical they are, and the
 * horizontal ones not at all.
 */
export function ringStretch(
  viewport: { width: number; height: number },
  spec: GeometrySpec,
): number {
  const pad = spec.maxNodeSize / 2 + 18;

  const availableX = viewport.width / 2 - pad - SIDE_CHROME;
  const availableY = viewport.height / 2 - pad;

  if (availableX <= 0 || availableY <= 0) return 1;

  return Math.min(1.5, Math.max(1, availableY / availableX));
}

export function placePolar(
  slot: number,
  siblingCount: number,
  depth: number,
  spec: GeometrySpec,
  parentTheta?: number,
  /**
   * How much taller than wide the ring is (ry / rx).
   *
   * 1 is a circle. Above 1 the ring is an ellipse, which is what a portrait
   * phone actually wants: there is far more room above and below the centre
   * than beside it, and the sides additionally have the zoom column and the
   * layer stepper sitting in them. A circle has to fit the TIGHTEST direction,
   * so on a 390x620 frame every spoke was cut down to what the width allowed
   * and roughly 40% of the height went unused.
   *
   * Stretching only y keeps every angle exactly where it was — slot 0 is still
   * twelve o'clock, node 7 is still at four o'clock — so ADR-0002's promise
   * that a node never moves is untouched. Only the distance changes.
   */
  stretch = 1,
): PolarPosition {
  const radius = ringRadius(depth, spec);

  let theta: number;
  if (parentTheta === undefined || depth <= 1) {
    theta = slotAngle(slot, siblingCount);
  } else {
    // Fan the children across an arc centred on the parent's own angle. The
    // arc narrows as sibling count grows so nodes never collide, and it is
    // capped so a single child does not sit exactly on the parent's radius
    // line where its label would collide with the parent's.
    /*
     * The fan is capped at 126 degrees, not 216.
     *
     * At the old width five children spread most of the way around their
     * parent: the outer two ended up level with the centre on opposite sides,
     * so an expanded branch read as a second ring rather than as one node's
     * children, and on a phone the ends were clipped by both edges.
     *
     * Narrow enough to be a fan, wide enough that a single child is not hidden
     * directly behind its parent's own label.
     */
    const arc = Math.min(
      Math.PI * 0.7,
      (Math.PI / 5) * Math.max(1, siblingCount - 1),
    );
    const step = siblingCount > 1 ? arc / (siblingCount - 1) : 0;
    theta = parentTheta - arc / 2 + slot * step;
  }

  return {
    x: Math.cos(theta) * radius,
    y: Math.sin(theta) * radius * stretch,
    theta,
    radius,
  };
}

/** Depth of a node, walking parent links. Cycle-safe. */
export function depthOf(graph: MapGraph, nodeId: string): number {
  let depth = 0;
  let current = graph.nodes.get(nodeId);
  const seen = new Set<string>();

  while (current?.parent_id && !seen.has(current.id)) {
    seen.add(current.id);
    depth++;
    current = graph.nodes.get(current.parent_id);
  }
  return depth;
}

/** Ancestor chain from root to the node, inclusive. Cycle-safe. */
export function ancestorsOf(graph: MapGraph, nodeId: string): MapNode[] {
  const chain: MapNode[] = [];
  const seen = new Set<string>();
  let current = graph.nodes.get(nodeId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_id ? graph.nodes.get(current.parent_id) : undefined;
  }
  return chain;
}

/** Builds the childrenOf index, sorted by slot so layout is deterministic. */
export function indexChildren(
  nodes: readonly MapNode[],
): Map<string, readonly string[]> {
  const byParent = new Map<string, MapNode[]>();

  for (const node of nodes) {
    if (!node.parent_id) continue;
    const list = byParent.get(node.parent_id);
    if (list) list.push(node);
    else byParent.set(node.parent_id, [node]);
  }

  const result = new Map<string, readonly string[]>();
  for (const [parentId, children] of byParent) {
    children.sort((a, b) => a.slot - b.slot);
    result.set(
      parentId,
      children.map((c) => c.id),
    );
  }
  return result;
}

export function buildGraph(
  id: string,
  title: string,
  rootId: string,
  nodes: readonly MapNode[],
): MapGraph {
  return {
    id,
    title,
    rootId,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    childrenOf: indexChildren(nodes),
  };
}
