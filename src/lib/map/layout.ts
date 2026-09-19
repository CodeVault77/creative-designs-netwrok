import { tokens } from '@/lib/styles/tokens.generated';
import type { Camera } from './camera';
import { clampScale, visibleBounds } from './camera';
import {
  geometryFor,
  nodeSize,
  placePolar,
  ringRadius,
  ringStretch,
  SIDE_CHROME,
  type GeometrySpec,
} from './geometry';
import { zoomTierFor, type ZoomTier } from './zoomTiers';
import type {
  Edge,
  MapGraph,
  MapNode,
  PlacedNode,
  RelationInput,
  Viewport,
} from './types';

/**
 * The layout pipeline.
 *
 * One pass, run per frame, in this order:
 *
 *   1. walk   — visit expanded branches only, computing polar positions
 *   2. cluster — collapse ≥6 sibling leaves at Overview scale into one node
 *   3. focus  — apply the ancestor/sibling/unrelated dimming
 *   4. cull   — drop anything outside viewport + 20%
 *   5. cap    — deepest-first until at most 300 remain
 *
 * §09 is explicit that clustering "must be in the renderer from day one —
 * retrofitting clustering means rewriting hit-testing". That is why this
 * produces the SAME PlacedNode list that hit-testing consumes: there is
 * exactly one notion of what is on screen, so a tap can never hit something
 * the user cannot see, and a cluster is hit-testable as a first-class node.
 */

/** §09: cap simultaneous rendered nodes. */
export const NODE_CAP = 300;

/** §09: a group of ≥6 sibling leaves collapses at Overview scale. */
export const CLUSTER_THRESHOLD = 6;

/**
 * Room left past the outermost node when fitting a ring, in world units.
 *
 * Exported because `fitScaleFor`'s test needs the SAME number: it previously
 * kept its own copy of 34, so changing the fit here left the test asserting
 * against a value the code no longer used, and it failed for a reason that had
 * nothing to do with the behaviour it guards.
 *
 * Small on purpose. Together with a 52px control gutter this once shrank the
 * default view to about 0.62 — a small diagram marooned in the middle of the
 * screen, where the design reference fills the frame at close to 1:1. Labels
 * are allowed to run near the edge, as they do in the reference: a label
 * touching the bezel is a far smaller cost than a map that opens too small to
 * read.
 */
export const LABEL_ALLOWANCE = 18;

export interface FocusModel {
  /** The selected node, if any. */
  selectedId: string | null;
  /** Ids on the path from root to the selected node. */
  ancestorIds: ReadonlySet<string>;
  /** Ids sharing the selected node's parent. */
  siblingIds: ReadonlySet<string>;
}

/** §09 opacities. Focus is the strongest density tool available. */
const OPACITY = {
  selected: 1,
  ancestor: 0.7,
  sibling: 0.4,
  unrelated: 0.3,
  none: 1,
} as const;

export interface LayoutInput {
  graph: MapGraph;
  /** Ids whose children are currently shown. Accordion: usually one branch. */
  expandedIds: ReadonlySet<string>;
  focus: FocusModel;
  camera: Camera;
  viewport: Viewport;
  /**
   * The node currently occupying the centre position. §09: when you descend,
   * the focused parent slides into the centre and the true root becomes the
   * first breadcrumb segment. This is what makes deep maps navigable on a
   * phone.
   */
  centreId?: string;
  /** Search dims everything else to 15% and marks matches (§09). */
  searchMatchIds?: ReadonlySet<string> | null;
  /**
   * The active lens (§06).
   *
   * `active` hides unbuilt nodes. `trending` re-lays the ring by rank — the
   * ONLY circumstance in which position depends on weight, and it is explicit,
   * temporary and signposted by a lit pill plus a persistent "Back to layout"
   * control (ADR-0002). Never make this the default.
   */
  lens?: 'all' | 'active' | 'trending' | 'mine';
  /**
   * Which window of ring one is showing when it does not all fit (§17).
   *
   * An index into the children in their own slot order, so rotating never
   * reorders the ring — it only changes where the visible arc starts. The
   * arrangement a user learned is preserved, which is the whole point of
   * ADR-0002.
   */
  ringOffset?: number;
  /**
   * Explicit typed relationships from `node_edges`.
   *
   * Optional, and absent for every caller that only cares about the tree. Only
   * relationships whose BOTH endpoints are currently placed are drawn — a line
   * to a node that is culled, collapsed, or in another map would otherwise run
   * to a coordinate that is nowhere on screen.
   */
  relations?: readonly RelationInput[];
}

export interface LayoutResult {
  nodes: PlacedNode[];
  edges: Edge[];
  tier: ZoomTier;
  /** The camera scale this layout was computed at. Lets chrome react to zoom
   *  without reading the camera ref during render. */
  scale: number;
  spec: GeometrySpec;
  /** True when the cap dropped nodes — the UI shows a "zoom in" whisper. */
  capped: boolean;
  /**
   * Ring-one children not currently on screen because of the width budget.
   *
   * Drives the "N more" chip. Zero when the whole ring fits, so the chip is
   * absent rather than showing "0 more".
   */
  ringOneHidden: number;
  /** Total ring-one children, however many are showing. */
  ringOneTotal: number;
  /** How many nodes existed before culling, for diagnostics and tests. */
  totalPlaced: number;
}

export function computeLayout(input: LayoutInput): LayoutResult {
  const {
    graph,
    expandedIds,
    focus,
    camera,
    viewport,
    searchMatchIds,
    lens = 'all',
    ringOffset = 0,
    relations,
  } = input;
  const spec = geometryFor(viewport.width);
  const tier = zoomTierFor(camera.scale);
  const stretch = ringStretch(viewport, spec);

  // Counted during the walk rather than recomputed from `visible`, which is
  // culled by viewport and would under-report whenever the ring is panned
  // partly off screen.
  let ringOneTotal = 0;
  let ringOneShown = 0;

  const centreId = input.centreId ?? graph.rootId;

  // ---------------------------------------------------------------- 1. walk

  const placed: PlacedNode[] = [];
  const positions = new Map<string, PlacedNode>();

  const root = graph.nodes.get(centreId);
  if (!root) {
    return {
      nodes: [],
      edges: [],
      tier,
      scale: camera.scale,
      spec,
      capped: false,
      ringOneHidden: 0,
      ringOneTotal: 0,
      totalPlaced: 0,
    };
  }

  const rootPlaced: PlacedNode = {
    node: root,
    depth: 0,
    x: 0,
    y: 0,
    theta: -Math.PI / 2,
    radius: 0,
    /*
     * A DESCENDED centre is smaller than the map's true root.
     *
     * `rootSize` is set large enough to hold the brand lockup — mark,
     * three-colour wordmark and tagline — which only the community map's root
     * carries. Every other centre holds a mark and a title, so at the same
     * diameter it was a big empty disc dwarfing the ring it belongs to.
     *
     * Still clearly bigger than a ring node: the centre has to read as the
     * centre, just not as the whole map. It also sets the SPOKE length — the
     * visible part of a connector is the ring radius minus the two circles it
     * joins, and the on-screen ring radius is pinned by the fit — so growing
     * the centre is what shortens the lines.
     */
    size: root.id === graph.rootId ? spec.rootSize : spec.rootSize * 0.74,
    opacity: 1,
  };
  placed.push(rootPlaced);
  positions.set(root.id, rootPlaced);

  /**
   * Depth-first, but only into expanded branches. An unexpanded node's
   * children are never placed at all — not placed then hidden — so the cost
   * of a huge collapsed subtree is zero rather than "cheap".
   */
  const walk = (parentId: string, depth: number, parentTheta: number) => {
    const childIds = graph.childrenOf.get(parentId);
    if (!childIds || childIds.length === 0) return;

    // Ring one always shows. Deeper rings only inside an expanded branch.
    if (depth > 1 && !expandedIds.has(parentId)) return;

    let children = childIds
      .map((id) => graph.nodes.get(id))
      .filter((n): n is MapNode => Boolean(n));

    // Lens: filter before layout, so hidden nodes do not leave gaps in the
    // ring. Slots are re-derived from the surviving set.
    if (lens === 'active') {
      children = children.filter((n) => n.status === 'active');
    }

    // Trending is the one place weight touches position, and only because
    // the user explicitly asked for it (ADR-0002).
    if (lens === 'trending') {
      children = [...children].sort((a, b) => b.weight - a.weight);
    }

    const groups = clusterSiblings(
      children,
      tier,
      depth,
      viewport.width,
      ringOffset,
    );

    if (depth === 1) {
      ringOneTotal = children.length;
      ringOneShown = groups.length;
    }

    groups.forEach((group, index) => {
      const position = placePolar(
        index,
        groups.length,
        depth,
        spec,
        depth > 1 ? parentTheta : undefined,
        stretch,
      );

      if (group.kind === 'node') {
        const item: PlacedNode = {
          node: group.node,
          depth,
          x: position.x,
          y: position.y,
          theta: position.theta,
          radius: position.radius,
          size: nodeSize(group.node.weight, spec),
          opacity: 1,
        };
        placed.push(item);
        positions.set(group.node.id, item);

        if (expandedIds.has(group.node.id)) {
          walk(group.node.id, depth + 1, position.theta);
        }
      } else {
        // A cluster stands in for its members and is hit-testable like any
        // other node. Its synthetic id is stable for a given member set so
        // React keys and selection survive re-layout.
        const item: PlacedNode = {
          node: group.stand_in,
          depth,
          x: position.x,
          y: position.y,
          theta: position.theta,
          radius: position.radius,
          size: spec.minNodeSize,
          opacity: 1,
          cluster: {
            count: group.members.length,
            memberIds: group.members.map((m) => m.id),
          },
        };
        placed.push(item);
        positions.set(item.node.id, item);
      }
    });
  };

  walk(root.id, 1, -Math.PI / 2);

  const totalPlaced = placed.length;

  // --------------------------------------------------------------- 3. focus

  for (const item of placed) {
    item.opacity = opacityFor(item, focus, searchMatchIds);
  }

  // ---------------------------------------------------------------- 4. cull

  const bounds = visibleBounds(camera, viewport, 0.2);
  let visible = placed.filter((item) => {
    // The root is never culled: recentre must always have something to return
    // to, and a map with nothing drawn reads as broken rather than panned.
    if (item.depth === 0) return true;
    const r = item.size / 2;
    return (
      item.x + r >= bounds.minX &&
      item.x - r <= bounds.maxX &&
      item.y + r >= bounds.minY &&
      item.y - r <= bounds.maxY
    );
  });

  // ------------------------------------------------------------------ 5. cap

  let capped = false;
  if (visible.length > NODE_CAP) {
    capped = true;
    // Deepest-first: the outer rings are the least contextually important,
    // and dropping them keeps the centre — where the user is looking — intact.
    visible = [...visible].sort((a, b) => a.depth - b.depth).slice(0, NODE_CAP);
  }

  // ---------------------------------------------------------------- edges

  const visibleIds = new Set(visible.map((item) => item.node.id));
  const edges: Edge[] = [];

  for (const item of visible) {
    const parentId = item.node.parent_id;
    if (!parentId || item.depth === 0) continue;

    const parent =
      positions.get(parentId) ?? (parentId === root.id ? rootPlaced : undefined);
    if (!parent || !visibleIds.has(parent.node.id)) continue;

    // Trim each end back to the node's edge rather than its centre, so the
    // connector meets the circle instead of running under it and out the
    // other side through the label.
    const dx = item.x - parent.x;
    const dy = item.y - parent.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const fromTrim = parent.size / 2;
    const toTrim = item.size / 2;

    edges.push({
      fromId: parent.node.id,
      toId: item.node.id,
      x1: parent.x + ux * fromTrim,
      y1: parent.y + uy * fromTrim,
      x2: item.x - ux * toTrim,
      y2: item.y - uy * toTrim,
      family: item.node.family,
      // A connector is never brighter than the node it leads to.
      opacity: Math.min(parent.opacity, item.opacity) * 0.55,
      /*
       * A dashed connector into an unbuilt node, matching the dashed ring on
       * the node itself. §10 wants Coming Soon to differ in more than one
       * channel; the line leading to it is one more, and it reads before you
       * have looked at the node.
       */
      dashed: item.node.status === 'coming_soon',
      kind: 'contains',
    });
  }

  /*
   * Explicit relationships, drawn on top of the containment spine.
   *
   * Both endpoints must be placed AND visible. A relationship to a node that
   * is culled, collapsed into a cluster or living in another map has no
   * on-screen coordinate, and drawing to its world position would send a line
   * off toward empty space.
   *
   * Trimmed to each circle's edge exactly like a containment edge, so the two
   * kinds meet nodes the same way and only their styling differs.
   */
  if (relations) {
    for (const relation of relations) {
      const from = positions.get(relation.fromNodeId);
      const to = positions.get(relation.toNodeId);

      if (!from || !to) continue;
      if (!visibleIds.has(from.node.id) || !visibleIds.has(to.node.id)) continue;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;

      edges.push({
        fromId: from.node.id,
        toId: to.node.id,
        x1: from.x + ux * (from.size / 2),
        y1: from.y + uy * (from.size / 2),
        x2: to.x - ux * (to.size / 2),
        y2: to.y - uy * (to.size / 2),
        // The SOURCE node's family, so a relationship reads as belonging to
        // the thing that declared it rather than to the thing it points at.
        family: from.node.family,
        /*
         * Fainter than containment. The tree is the structure of the map and
         * has to stay legible as structure; relationships are annotations over
         * it, and at equal weight they turn a readable map into a mesh.
         */
        opacity: Math.min(from.opacity, to.opacity) * 0.4,
        dashed: true,
        kind: 'relation',
        relationType: relation.type,
      });
    }
  }

  return {
    nodes: visible,
    edges,
    tier,
    scale: camera.scale,
    spec,
    capped,
    totalPlaced,
    ringOneHidden: Math.max(0, ringOneTotal - ringOneShown),
    ringOneTotal,
  };
}

// ------------------------------------------------------------------ helpers

type SiblingGroup =
  | { kind: 'node'; node: MapNode }
  | { kind: 'cluster'; members: MapNode[]; stand_in: MapNode };

/**
 * §09: "a group of ≥6 sibling leaves collapses into one cluster node showing
 * the count (+24), which expands on tap".
 *
 * Only LEAVES cluster. A node with children is a branch someone may want to
 * open, and hiding it inside a count would make part of the map unreachable
 * by panning and zooming alone.
 *
 * Clustering applies at Overview scale only — at Default and Detail there is
 * room for the individuals, and collapsing them there would feel like the map
 * hiding things.
 */
/**
 * How many nodes ring one may show at this viewport width.
 *
 * §17 budgets this per breakpoint and `tokens.map.ring1Max` carries the
 * numbers, but nothing read them until now: every ring-one child was placed
 * regardless of width, so a 390px phone drew all twelve where the budget is
 * eight. The result was legible in a screenshot only as crowding — labels
 * colliding with their neighbours around the whole ring.
 *
 * Derived from `viewport.width` rather than passed in, so no call site has to
 * know about it and the layout cannot disagree with what is actually on
 * screen.
 */
function ringOneCapFor(width: number): number {
  const { breakpoint, map } = tokens;

  if (width <= breakpoint.phone.max) return map.ring1Max.phone;
  if (width <= breakpoint.tablet.max) return map.ring1Max.tablet;
  if (width <= breakpoint.desktop.max) return map.ring1Max.desktop;
  if (width <= breakpoint.large.max) return map.ring1Max.large;
  return map.ring1Max.board;
}

function clusterSiblings(
  children: readonly MapNode[],
  tier: ZoomTier,
  depth: number,
  viewportWidth: number,
  ringOffset: number,
): SiblingGroup[] {
  const groups: SiblingGroup[] = children.map((node) => ({ kind: 'node', node }));

  /**
   * Ring one is capped by width, at every tier.
   *
   * Separate from the leaf-clustering rule below, which is about crowded deep
   * branches and only applies at overview scale from depth 2. This one is
   * about the first thing anyone sees, and ADR-0003 re-cut ring one precisely
   * so that it fits — a cap that only applied when zoomed out would leave the
   * default view over budget, which is the view that matters most.
   */
  if (depth === 1) {
    const cap = ringOneCapFor(viewportWidth);
    if (children.length <= cap) return groups;

    /*
     * Ring one shows `cap` REAL nodes and nothing else.
     *
     * The overflow used to become a "+5" node sitting in the ring. That was
     * wrong twice over: it spent one of the scarce ring slots on something
     * that is not a place, and a grey bubble reading "+5" is visually a node,
     * so the ring appeared to contain a family called "+5". The design
     * reference keeps all eight slots for real destinations and moves the
     * remainder to a chip outside the ring ("4 more"), which is what
     * `LayoutResult.ringOneHidden` drives.
     *
     * Sliced in the map's OWN slot order, not by weight: ADR-0002 says
     * popularity never moves a node, and ranking the ring here would make the
     * arrangement change under the user as engagement shifted. `ringOffset`
     * rotates which window of that fixed order is showing.
     */
    const offset =
      ((ringOffset % children.length) + children.length) % children.length;
    const window: MapNode[] = [];
    for (let i = 0; i < cap; i++) {
      window.push(children[(offset + i) % children.length]!);
    }

    return window.map((node) => ({ kind: 'node', node }));
  }

  if (tier !== 'overview' || depth < 2) return groups;

  const leaves = children.filter((n) => n.type !== 'cluster');
  if (leaves.length < CLUSTER_THRESHOLD) return groups;

  // Keep the heaviest few individually — the popular ones are the reason
  // someone is looking — and cluster the tail.
  const sorted = [...leaves].sort((a, b) => b.weight - a.weight);
  const keep = sorted.slice(0, CLUSTER_THRESHOLD - 1);
  const collapse = sorted.slice(CLUSTER_THRESHOLD - 1);

  if (collapse.length < 2) return groups;

  const keepIds = new Set(keep.map((n) => n.id));
  const first = collapse[0]!;

  const result: SiblingGroup[] = children
    .filter((n) => keepIds.has(n.id))
    .map((node) => ({ kind: 'node', node }));

  result.push({
    kind: 'cluster',
    members: collapse,
    stand_in: {
      ...first,
      // Stable for a given member set, so selection survives re-layout.
      id: `cluster:${first.parent_id ?? 'root'}:${collapse.length}`,
      title: `+${collapse.length}`,
      type: 'cluster',
      status: 'active',
      weight: 0,
    },
  });

  return result;
}

function opacityFor(
  item: PlacedNode,
  focus: FocusModel,
  searchMatchIds?: ReadonlySet<string> | null,
): number {
  // §09: search dims non-matches to 15% and keeps matches at full glow.
  if (searchMatchIds) {
    return searchMatchIds.has(item.node.id) ? 1 : 0.15;
  }

  if (!focus.selectedId) return OPACITY.none;
  if (item.node.id === focus.selectedId) return OPACITY.selected;
  if (focus.ancestorIds.has(item.node.id)) return OPACITY.ancestor;
  if (focus.siblingIds.has(item.node.id)) return OPACITY.sibling;
  return OPACITY.unrelated;
}

/**
 * The scale at which a given ring fits the viewport, labels included.
 *
 * A map that opens cropped is the worst possible first frame: F1 targets a
 * live destination in 3 taps and 25 seconds, and a user who has to pinch out
 * before they can even read ring one has already lost several of those
 * seconds. So the opening camera fits, rather than defaulting to 1.0 and
 * hoping the viewport is big enough.
 *
 * The extent budget is the ring radius plus the node radius plus a label
 * allowance — the label sits BELOW the circle and is the thing that actually
 * clips first, which is easy to forget when reasoning about circles.
 */
export function fitScaleFor(
  depth: number,
  viewport: Viewport,
  spec = geometryFor(viewport.width),
): number {
  if (depth <= 0) return 1;

  // The allowance is module-level so the fit test reads the same number.
  const pad = spec.maxNodeSize / 2 + LABEL_ALLOWANCE;
  const radius = ringRadius(depth, spec);
  const stretch = ringStretch(viewport, spec);

  /*
   * Fitted on BOTH axes, because the ring is an ellipse.
   *
   * The horizontal half-space excludes SIDE_CHROME: the zoom column and the
   * layer stepper are vertically centred on the edges, which is exactly the
   * height ring one passes through, so those pixels are not available to a
   * 3- or 9-o'clock node however much bare frame is left.
   *
   * Taking the smaller of the two keeps the whole ring inside the frame. It is
   * the horizontal one that binds on a portrait phone — which is the point of
   * the stretch: the vertical spokes then use the room the width was never
   * going to give them.
   */
  const availableX = Math.max(1, viewport.width / 2 - SIDE_CHROME - pad);
  const availableY = Math.max(1, viewport.height / 2 - pad);

  const scaleX = availableX / radius;
  const scaleY = availableY / (radius * stretch);

  /*
   * Never zoom PAST the design size on load.
   *
   * The specs are authored for scale 1 — node diameters, stroke weights and
   * label sizes are all chosen there. Without this cap a wide desktop frame
   * has so much horizontal room that the fit computed roughly 3.9, which
   * would have opened the map with 200px nodes. Fitting means "make it fit",
   * not "make it as large as the frame allows".
   */
  return clampScale(Math.min(scaleX, scaleY, 1));
}

/** The camera that frames a ring, centred on the root. */
export function cameraToFit(
  depth: number,
  viewport: Viewport,
  spec = geometryFor(viewport.width),
): Camera {
  return { x: 0, y: 0, scale: fitScaleFor(depth, viewport, spec) };
}

/**
 * Camera target that frames a given ring in the centre band — the "visual
 * telescope" the layer stepper drives (§09). Preserves nothing about the
 * current camera except that it is a camera; the caller eases toward it.
 */
export function cameraForDepth(
  depth: number,
  viewport: Viewport,
  spec = geometryFor(viewport.width),
): Camera {
  if (depth <= 0) return { x: 0, y: 0, scale: 1 };
  return cameraToFit(depth, viewport, spec);
}
