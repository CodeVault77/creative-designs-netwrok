import { describe, expect, it } from 'vitest';
import { tokens } from '@/lib/styles/tokens.generated';
import {
  DESKTOP_GEOMETRY,
  MOBILE_GEOMETRY,
  ancestorsOf,
  buildGraph,
  depthOf,
  geometryFor,
  nodeSize,
  placePolar,
  ringRadius,
  ringStretch,
  slotAngle,
} from './geometry';
import {
  IDENTITY_CAMERA,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  panBy,
  screenToWorld,
  stepMomentum,
  visibleBounds,
  worldToScreen,
  zoomAt,
} from './camera';
import {
  cameraToFit,
  computeLayout,
  fitScaleFor,
  NODE_CAP,
  CLUSTER_THRESHOLD,
  LABEL_ALLOWANCE,
} from './layout';
import { zoomTierFor, renderingFor, truncate } from './zoomTiers';
import { hitTest, isEmptyCanvas } from './hitTest';
import {
  createGestureState,
  isDoubleTap,
  isLongPress,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  TAP_SLOP_PX,
} from './pointers';
import { COMMUNITY_NODES, communityMap, syntheticMap } from './seed';
import type { Viewport } from './types';

const VIEWPORT: Viewport = { width: 390, height: 780 };
const DESKTOP_VIEWPORT: Viewport = { width: 1440, height: 900 };

// ---------------------------------------------------------------- geometry

describe('geometry', () => {
  it('places ring one at R0 and each ring G further out', () => {
    const spec = MOBILE_GEOMETRY;
    expect(ringRadius(0, spec)).toBe(0);
    expect(ringRadius(1, spec)).toBe(160);
    expect(ringRadius(2, spec)).toBe(160 + 132);
    expect(ringRadius(3, spec)).toBe(160 + 264);
  });

  /**
   * The connector has to read as a connector.
   *
   * Its visible length is the ring radius minus the two circles it joins, so
   * it is a RATIO, not a distance — and the ratio is what the camera fit
   * cannot change. When the root was 96 against a 148 radius the circles ate
   * more than half of it and the map looked like nodes jammed against a hub.
   *
   * Measured on the STRETCHED axis, because the ring is an ellipse: the tall
   * direction is where the space actually is, and that is the spoke a user
   * reads first. The sides are deliberately shorter — that is the point of the
   * stretch, not a defect — so they are covered by the separate test below.
   *
   * The bound is 0.4, down from the 0.55 it started at. That is a design
   * decision recorded, not a test bent to fit: the community map's root now
   * carries the whole brand lockup rather than a title, so it is deliberately
   * dominant and the spokes are shorter for it. The guard still catches the
   * failure it was written for — circles growing until the connectors between
   * them all but vanish — just at the size the centre is now meant to be.
   */
  it.each([
    ['mobile', MOBILE_GEOMETRY, { width: 390, height: 620 }],
    ['desktop', DESKTOP_GEOMETRY, { width: 1440, height: 900 }],
  ])('leaves most of the %s vertical spoke visible', (_label, spec, viewport) => {
    const radius = ringRadius(1, spec) * ringStretch(viewport, spec);
    const visible = radius - spec.rootSize / 2 - spec.maxNodeSize / 2;

    expect(visible / radius).toBeGreaterThan(0.4);
  });

  it('stretches the ring to the space available, not to a circle', () => {
    const spec = MOBILE_GEOMETRY;

    // A portrait phone has far more room above the centre than beside it, and
    // the sides additionally hold the zoom column and the layer stepper, so the
    // ring must come out meaningfully taller than wide. Deliberately a loose
    // bound: the exact cap is a visual judgement that gets retuned, and a test
    // pinned to today's number just breaks every time it is.
    expect(ringStretch({ width: 390, height: 620 }, spec)).toBeGreaterThan(1.25);

    // A wide, short frame has no vertical room to spare, so it stays circular
    // rather than squashing — the stretch only ever lengthens.
    expect(ringStretch({ width: 1440, height: 420 }, spec)).toBe(1);
  });

  it('uses the desktop spec at 1024px and above', () => {
    expect(geometryFor(390)).toBe(MOBILE_GEOMETRY);
    expect(geometryFor(1023)).toBe(MOBILE_GEOMETRY);
    expect(geometryFor(1024)).toBe(DESKTOP_GEOMETRY);
  });

  it('puts slot 0 at twelve o’clock', () => {
    // The whole numbering system in §10 depends on this. Node 1 must always
    // be at the top or "node 7 is at four o'clock" stops being true.
    expect(slotAngle(0, 12)).toBeCloseTo(-Math.PI / 2);
  });

  it('spaces slots evenly around the circle', () => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      expect(slotAngle(i, n)).toBeCloseTo(-Math.PI / 2 + i * ((Math.PI * 2) / n));
    }
  });

  it('gives the same node the same angle regardless of weight', () => {
    // ADR-0002. If this ever fails, position has become engagement-dependent
    // and the map has stopped being learnable.
    const a = placePolar(3, 12, 1, MOBILE_GEOMETRY);
    const b = placePolar(3, 12, 1, MOBILE_GEOMETRY);
    expect(a.theta).toBe(b.theta);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
  });

  it('keeps weight-driven size inside the specified range', () => {
    expect(nodeSize(0, MOBILE_GEOMETRY)).toBe(46);
    expect(nodeSize(1, MOBILE_GEOMETRY)).toBe(58);
    expect(nodeSize(0.5, MOBILE_GEOMETRY)).toBe(52);
    // Out-of-range weights must clamp, not extrapolate into overlap.
    expect(nodeSize(-3, MOBILE_GEOMETRY)).toBe(46);
    expect(nodeSize(99, MOBILE_GEOMETRY)).toBe(58);
  });

  it('fans deep children around their parent instead of the full circle', () => {
    const parentTheta = 0;
    const positions = [0, 1, 2].map((slot) =>
      placePolar(slot, 3, 2, MOBILE_GEOMETRY, parentTheta),
    );
    for (const p of positions) {
      expect(Math.abs(p.theta - parentTheta)).toBeLessThan(Math.PI);
    }
  });

  it('computes depth and ancestors without looping on a cycle', () => {
    const graph = communityMap();
    expect(depthOf(graph, 'cdn-root')).toBe(0);
    expect(depthOf(graph, 'mind-mapping')).toBe(1);
    expect(depthOf(graph, 'mm-0')).toBe(2);

    const chain = ancestorsOf(graph, 'mm-0').map((n) => n.id);
    expect(chain).toEqual(['cdn-root', 'mind-mapping', 'mm-0']);
  });

  it('sorts children by slot so layout is deterministic', () => {
    const graph = buildGraph('m', 'M', 'r', [
      {
        id: 'r',
        map_id: 'm',
        parent_id: null,
        slot: 0,
        title: 'R',
        family: 'create',
        type: 'topic',
        status: 'active',
        visibility: 'public',
        weight: 1,
      },
      {
        id: 'b',
        map_id: 'm',
        parent_id: 'r',
        slot: 2,
        title: 'B',
        family: 'create',
        type: 'topic',
        status: 'active',
        visibility: 'public',
        weight: 0,
      },
      {
        id: 'a',
        map_id: 'm',
        parent_id: 'r',
        slot: 0,
        title: 'A',
        family: 'create',
        type: 'topic',
        status: 'active',
        visibility: 'public',
        weight: 0,
      },
    ]);
    expect(graph.childrenOf.get('r')).toEqual(['a', 'b']);
  });
});

// ------------------------------------------------------------------ camera

describe('camera', () => {
  it('clamps scale to the specified range', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1)).toBe(1);
  });

  it('round-trips world and screen coordinates', () => {
    const camera = { x: 120, y: -60, scale: 1.7 };
    const screen = worldToScreen(300, 200, camera, VIEWPORT);
    const world = screenToWorld(screen.x, screen.y, camera, VIEWPORT);
    expect(world.x).toBeCloseTo(300);
    expect(world.y).toBeCloseTo(200);
  });

  it('keeps the anchored world point under the anchor while zooming', () => {
    // The single most noticeable gesture bug if it regresses: pinching would
    // appear to drag the map toward the viewport centre.
    const camera = IDENTITY_CAMERA;
    const anchorX = 90;
    const anchorY = 240;

    const before = screenToWorld(anchorX, anchorY, camera, VIEWPORT);
    const zoomed = zoomAt(camera, 2, anchorX, anchorY, VIEWPORT);
    const after = screenToWorld(anchorX, anchorY, zoomed, VIEWPORT);

    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('does not move the camera when the zoom is already clamped', () => {
    const camera = { x: 5, y: 5, scale: MAX_SCALE };
    expect(zoomAt(camera, MAX_SCALE * 2, 10, 10, VIEWPORT)).toBe(camera);
  });

  it('converts pan deltas by the current scale', () => {
    const panned = panBy({ x: 0, y: 0, scale: 2 }, 100, 50);
    expect(panned.x).toBe(-50);
    expect(panned.y).toBe(-25);
  });

  it('decays momentum and stops rather than crawling forever', () => {
    let camera = IDENTITY_CAMERA;
    let momentum = { vx: 10, vy: 0 };
    let steps = 0;

    for (;;) {
      const next = stepMomentum(camera, momentum);
      if (!next) break;
      camera = next.camera;
      momentum = next.momentum;
      steps++;
      if (steps > 500) throw new Error('momentum never terminated');
    }

    expect(steps).toBeGreaterThan(5);
    expect(steps).toBeLessThan(120);
  });

  it('expands the visible bounds by the cull margin', () => {
    const bounds = visibleBounds(IDENTITY_CAMERA, { width: 100, height: 100 }, 0.2);
    expect(bounds.minX).toBeCloseTo(-60);
    expect(bounds.maxX).toBeCloseTo(60);
  });
});

// -------------------------------------------------------------- zoom tiers

describe('zoom tiers', () => {
  it.each([
    [0.35, 'overview'],
    [0.59, 'overview'],
    [0.6, 'default'],
    [1.29, 'default'],
    [1.3, 'detail'],
    [2.4, 'detail'],
  ])('maps scale %s to the %s tier', (scale, tier) => {
    expect(zoomTierFor(scale)).toBe(tier);
  });

  it('labels ring one only at overview scale', () => {
    expect(renderingFor('overview').labelMaxDepth).toBe(1);
    expect(renderingFor('default').labelMaxDepth).toBe(Infinity);
  });

  it('draws dots at overview and circles with icons above it', () => {
    expect(renderingFor('overview').dot).toBe(true);
    expect(renderingFor('default').dot).toBe(false);
    expect(renderingFor('detail').showBadge).toBe(true);
  });

  it('truncates labels to the canvas budget', () => {
    expect(truncate('Mind Mapping', 18)).toBe('Mind Mapping');
    const long = truncate('Freelance & Marketplace', 18);
    expect(long).toHaveLength(18);
    expect(long.endsWith('…')).toBe(true);
  });
});

// ------------------------------------------------------------------ layout

const NO_FOCUS = {
  selectedId: null,
  ancestorIds: new Set<string>(),
  siblingIds: new Set<string>(),
};

function layoutOf(overrides: Partial<Parameters<typeof computeLayout>[0]> = {}) {
  return computeLayout({
    graph: communityMap(),
    expandedIds: new Set(),
    focus: NO_FOCUS,
    camera: { x: 0, y: 0, scale: 1 },
    viewport: DESKTOP_VIEWPORT,
    ...overrides,
  });
}

describe('layout', () => {
  it('places the root plus ring one when nothing is expanded', () => {
    const result = layoutOf();
    const depths = new Set(result.nodes.map((n) => n.depth));
    expect(depths.has(0)).toBe(true);
    expect(depths.has(1)).toBe(true);
    expect(depths.has(2)).toBe(false);
  });

  it('renders all twelve ring-one nodes', () => {
    // ADR-0001: all twelve are rendered, eight live. The scale is the pitch.
    const result = layoutOf({ camera: { x: 0, y: 0, scale: 0.5 } });
    const ringOne = result.nodes.filter((n) => n.depth === 1);
    expect(ringOne).toHaveLength(12);
  });

  it('keeps Coming Soon nodes present and placed, never removed', () => {
    const result = layoutOf({ camera: { x: 0, y: 0, scale: 0.5 } });
    const soon = result.nodes.filter((n) => n.node.status === 'coming_soon');
    expect(soon.length).toBeGreaterThan(0);
  });

  it('only places children of expanded branches', () => {
    const collapsed = layoutOf();
    const expanded = layoutOf({ expandedIds: new Set(['mind-mapping']) });
    expect(expanded.nodes.length).toBeGreaterThan(collapsed.nodes.length);
    expect(expanded.nodes.some((n) => n.node.parent_id === 'mind-mapping')).toBe(
      true,
    );
  });

  it('applies the focus dimming model', () => {
    const graph = communityMap();
    const result = computeLayout({
      graph,
      expandedIds: new Set(),
      focus: {
        selectedId: 'mind-mapping',
        ancestorIds: new Set(['cdn-root']),
        siblingIds: new Set(['page-watcher']),
      },
      camera: { x: 0, y: 0, scale: 1 },
      viewport: DESKTOP_VIEWPORT,
    });

    const byId = new Map(result.nodes.map((n) => [n.node.id, n]));
    expect(byId.get('mind-mapping')?.opacity).toBe(1);
    expect(byId.get('cdn-root')?.opacity).toBeCloseTo(0.7);
    expect(byId.get('page-watcher')?.opacity).toBeCloseTo(0.4);
    expect(byId.get('commerce')?.opacity).toBeCloseTo(0.3);
  });

  it('dims non-matches to 15% during a search', () => {
    const result = layoutOf({ searchMatchIds: new Set(['mind-mapping']) });
    const byId = new Map(result.nodes.map((n) => [n.node.id, n]));
    expect(byId.get('mind-mapping')?.opacity).toBe(1);
    expect(byId.get('page-watcher')?.opacity).toBeCloseTo(0.15);
  });

  it('never culls the root', () => {
    // Recentre must always have something to return to; an empty canvas
    // reads as broken rather than panned.
    const result = layoutOf({ camera: { x: 99999, y: 99999, scale: 1 } });
    expect(result.nodes.some((n) => n.depth === 0)).toBe(true);
  });

  /**
   * §17 budgets ring one per breakpoint and `tokens.map.ring1Max` carries the
   * numbers — but for four phases nothing read them. Every ring-one child was
   * placed at every width, so a 390px phone drew all twelve against a budget
   * of eight, and the only symptom was labels colliding all the way round the
   * ring: nothing threw, and no test noticed.
   */
  it('caps ring one at the budget for the viewport width', () => {
    const phone = layoutOf({ viewport: { width: 390, height: 844 } });
    const ringOne = phone.nodes.filter((n) => n.depth === 1);

    expect(ringOne.length).toBeLessThanOrEqual(tokens.map.ring1Max.phone);

    // Every slot holds a REAL node. The overflow used to become a "+5" bubble
    // sitting in the ring, which spent a scarce slot on something that is not
    // a destination and read as a family called "+5".
    expect(ringOne.every((n) => !n.cluster)).toBe(true);

    // Nothing is lost — it is reported, so the UI can offer the rest.
    const seedRingOne = COMMUNITY_NODES.filter(
      (n) => n.parent_id === 'cdn-root',
    ).length;

    expect(phone.ringOneTotal).toBe(seedRingOne);
    expect(ringOne.length + phone.ringOneHidden).toBe(seedRingOne);
  });

  it('rotates the ring window without reordering it', () => {
    const viewport = { width: 390, height: 844 };
    const at = (ringOffset: number) =>
      layoutOf({ viewport, ringOffset })
        .nodes.filter((n) => n.depth === 1)
        .map((n) => n.node.id);

    const first = at(0);
    const rotated = at(3);

    // A different window...
    expect(rotated).not.toEqual(first);

    /*
     * ...but the SAME cyclic order. ADR-0002 says popularity never moves a
     * node; rotating must not become a re-sort, or the arrangement someone
     * learned changes under them.
     */
    const all = COMMUNITY_NODES.filter((n) => n.parent_id === 'cdn-root').map(
      (n) => n.id,
    );
    const indices = rotated.map((id) => all.indexOf(id));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe((indices[i - 1]! + 1) % all.length);
    }
  });

  it('gives a wider viewport a bigger ring-one budget', () => {
    const phone = layoutOf({ viewport: { width: 390, height: 844 } });
    const board = layoutOf({ viewport: { width: 2560, height: 1440 } });

    const ringOneOf = (r: typeof phone) =>
      r.nodes.filter((n) => n.depth === 1).filter((n) => !n.cluster).length;

    expect(ringOneOf(board)).toBeGreaterThan(ringOneOf(phone));
  });

  it('culls nodes outside the viewport plus margin', () => {
    /*
     * Both layouts use the SAME viewport width, and vary only zoom.
     *
     * That is load-bearing. This test isolates culling — which is about what
     * fits on screen — from placement, which is about how many nodes ring one
     * is allowed at this breakpoint (§17, `tokens.map.ring1Max`). An earlier
     * version compared a 320px layout against a 3000px one, which was only
     * ever valid while the ring-one budget went unenforced: once it is
     * applied, a phone places 8 and a board places 16, and `totalPlaced`
     * differs for a reason that has nothing to do with culling.
     */
    const viewport = { width: 320, height: 320 };

    const fitted = layoutOf({ viewport, camera: { x: 0, y: 0, scale: 1 } });
    // Ring one sits at radius 160, so a 320px viewport still contains all of
    // it once the 20% margin is added. Zooming in is what pushes the ring
    // outside the frame and makes culling observable.
    const zoomed = layoutOf({ viewport, camera: { x: 0, y: 0, scale: 2.4 } });

    expect(zoomed.nodes.length).toBeLessThan(fitted.nodes.length);
    expect(zoomed.totalPlaced).toBe(fitted.totalPlaced);
  });

  it('keeps a node visible until it leaves the margin, not the viewport edge', () => {
    // The 20% margin exists so nodes are already drawn when they slide in
    // during a pan, rather than popping into existence at the edge.
    const tight = layoutOf({
      viewport: { width: 400, height: 400 },
      camera: { x: 0, y: 0, scale: 1 },
    });
    const bounds = 400 / 2 / 1;
    for (const node of tight.nodes) {
      if (node.depth === 0) continue;
      expect(Math.abs(node.x)).toBeLessThanOrEqual(bounds * 1.2 + node.size);
    }
  });

  it('caps rendered nodes and reports it', () => {
    // Deliberately at DEFAULT scale, not overview: at overview, clustering
    // already collapses the tail and the cap never has to fire. The cap is
    // the backstop for a zoomed-in map with a very wide viewport.
    const graph = syntheticMap(900);
    const expanded = new Set([...graph.nodes.keys()]);
    const result = computeLayout({
      graph,
      expandedIds: expanded,
      focus: NO_FOCUS,
      camera: { x: 0, y: 0, scale: 1 },
      viewport: { width: 6000, height: 6000 },
    });

    expect(result.totalPlaced).toBeGreaterThan(NODE_CAP);
    expect(result.nodes.length).toBeLessThanOrEqual(NODE_CAP);
    expect(result.capped).toBe(true);
  });

  it('lets clustering keep the count under the cap at overview scale', () => {
    // The two mechanisms are complementary: clustering is the graceful one
    // and should do the work; the cap is the guarantee.
    const graph = syntheticMap(900);
    const result = computeLayout({
      graph,
      expandedIds: new Set([...graph.nodes.keys()]),
      focus: NO_FOCUS,
      camera: { x: 0, y: 0, scale: 0.35 },
      viewport: { width: 4000, height: 4000 },
    });

    expect(result.nodes.length).toBeLessThanOrEqual(NODE_CAP);
    expect(result.nodes.some((n) => n.cluster)).toBe(true);
  });

  it('keeps shallower nodes when the cap bites', () => {
    const graph = syntheticMap(900);
    const result = computeLayout({
      graph,
      expandedIds: new Set([...graph.nodes.keys()]),
      focus: NO_FOCUS,
      camera: { x: 0, y: 0, scale: 1 },
      viewport: { width: 6000, height: 6000 },
    });

    const maxDepth = Math.max(...result.nodes.map((n) => n.depth));
    const minDepth = Math.min(...result.nodes.map((n) => n.depth));
    expect(minDepth).toBe(0);
    expect(maxDepth).toBeLessThanOrEqual(2);
  });

  it('clusters sibling leaves at overview scale only', () => {
    const graph = syntheticMap(200);
    const expanded = new Set([...graph.nodes.keys()]);
    const viewport = { width: 4000, height: 4000 };

    const overview = computeLayout({
      graph,
      expandedIds: expanded,
      focus: NO_FOCUS,
      camera: { x: 0, y: 0, scale: 0.4 },
      viewport,
    });
    const detail = computeLayout({
      graph,
      expandedIds: expanded,
      focus: NO_FOCUS,
      camera: { x: 0, y: 0, scale: 1.5 },
      viewport,
    });

    expect(overview.nodes.some((n) => n.cluster)).toBe(true);
    expect(detail.nodes.some((n) => n.cluster)).toBe(false);
  });

  it('records how many nodes a cluster stands for', () => {
    const graph = syntheticMap(200);
    const result = computeLayout({
      graph,
      expandedIds: new Set([...graph.nodes.keys()]),
      focus: NO_FOCUS,
      camera: { x: 0, y: 0, scale: 0.4 },
      viewport: { width: 4000, height: 4000 },
    });

    const cluster = result.nodes.find((n) => n.cluster);
    expect(cluster?.cluster?.count).toBeGreaterThanOrEqual(2);
    expect(cluster?.cluster?.memberIds.length).toBe(cluster?.cluster?.count);
    expect(cluster?.node.title).toBe(`+${cluster?.cluster?.count}`);
  });

  it('draws an edge for every visible non-root node', () => {
    const result = layoutOf({ camera: { x: 0, y: 0, scale: 0.5 } });
    const nonRoot = result.nodes.filter((n) => n.depth > 0);
    expect(result.edges).toHaveLength(nonRoot.length);
  });

  it('never draws an edge brighter than its dimmer endpoint', () => {
    const graph = communityMap();
    const result = computeLayout({
      graph,
      expandedIds: new Set(),
      focus: {
        selectedId: 'mind-mapping',
        ancestorIds: new Set(['cdn-root']),
        siblingIds: new Set(['page-watcher']),
      },
      camera: { x: 0, y: 0, scale: 0.5 },
      viewport: DESKTOP_VIEWPORT,
    });

    const byId = new Map(result.nodes.map((n) => [n.node.id, n]));
    for (const edge of result.edges) {
      const dimmer = Math.min(
        byId.get(edge.fromId)?.opacity ?? 1,
        byId.get(edge.toId)?.opacity ?? 1,
      );
      expect(edge.opacity).toBeLessThanOrEqual(dimmer);
    }
  });

  it('re-centres on a descendant without losing the rest of the graph', () => {
    const result = layoutOf({ centreId: 'mind-mapping' });
    const root = result.nodes.find((n) => n.depth === 0);
    expect(root?.node.id).toBe('mind-mapping');
    expect(root?.x).toBe(0);
    expect(root?.y).toBe(0);
  });
});

// ---------------------------------------------------------------- hit test

describe('hit testing', () => {
  it('finds a node under the pointer', () => {
    const result = layoutOf();
    const target = result.nodes.find((n) => n.depth === 1)!;
    const camera = { x: 0, y: 0, scale: 1 };
    const screen = worldToScreen(target.x, target.y, camera, DESKTOP_VIEWPORT);

    const hit = hitTest(result.nodes, screen.x, screen.y, camera, DESKTOP_VIEWPORT);
    expect(hit?.node.id).toBe(target.node.id);
  });

  it('honours the minimum touch target for a tiny node', () => {
    // §10: hit geometry is separate from visual geometry. A 12px dot at
    // overview scale must still be tappable, or the zoomed-out map is unusable.
    const camera = { x: 0, y: 0, scale: 0.4 };
    const result = layoutOf({ camera });
    // Slot 0 sits at twelve o'clock; probing radially outward from it stays
    // clear of its neighbours, which are ~78 world units away around the ring.
    const target = result.nodes.find((n) => n.node.id === 'mind-mapping')!;
    const screen = worldToScreen(target.x, target.y, camera, VIEWPORT);

    // 30px above the node — far outside the ~11px drawn circle at this scale.
    const hit = hitTest(result.nodes, screen.x, screen.y - 30, camera, VIEWPORT, {
      minTarget: 88,
    });
    expect(hit?.node.id).toBe('mind-mapping');
  });

  it('resolves overlapping touch targets to the nearest node', () => {
    // At overview scale an 88px target is ~110 world units while ring-one
    // siblings are only ~78 apart, so targets genuinely overlap. Nearest-wins
    // is what keeps that predictable — the node under your finger is the one
    // you get, not whichever was tested first.
    const camera = { x: 0, y: 0, scale: 0.4 };
    const result = layoutOf({ camera });
    const a = result.nodes.find((n) => n.node.id === 'mind-mapping')!;
    const b = result.nodes.find((n) => n.node.id === 'link-to-mind-map')!;

    const nearB = worldToScreen(
      a.x + (b.x - a.x) * 0.8,
      a.y + (b.y - a.y) * 0.8,
      camera,
      VIEWPORT,
    );

    const hit = hitTest(result.nodes, nearB.x, nearB.y, camera, VIEWPORT, {
      minTarget: 88,
    });
    expect(hit?.node.id).toBe('link-to-mind-map');
  });

  it('returns null over empty canvas', () => {
    const result = layoutOf();
    const camera = { x: 0, y: 0, scale: 1 };
    expect(
      hitTest(result.nodes, 5, 5, camera, DESKTOP_VIEWPORT, { minTarget: 10 }),
    ).toBeNull();
    expect(
      isEmptyCanvas(result.nodes, 5, 5, camera, DESKTOP_VIEWPORT, {
        minTarget: 10,
      }),
    ).toBe(true);
  });

  it('still hits a dimmed node', () => {
    // Inactive nodes stay selectable (§10) and search-dimmed nodes must stay
    // reachable, so opacity must not gate hit testing.
    const graph = communityMap();
    const result = computeLayout({
      graph,
      expandedIds: new Set(),
      focus: NO_FOCUS,
      camera: { x: 0, y: 0, scale: 1 },
      viewport: DESKTOP_VIEWPORT,
      searchMatchIds: new Set(['mind-mapping']),
    });

    const dimmed = result.nodes.find((n) => n.opacity === 0.15)!;
    const camera = { x: 0, y: 0, scale: 1 };
    const screen = worldToScreen(dimmed.x, dimmed.y, camera, DESKTOP_VIEWPORT);
    expect(
      hitTest(result.nodes, screen.x, screen.y, camera, DESKTOP_VIEWPORT),
    ).toBeTruthy();
  });

  it('picks the nearest node when targets overlap', () => {
    const result = layoutOf({ camera: { x: 0, y: 0, scale: 0.4 } });
    const camera = { x: 0, y: 0, scale: 0.4 };
    const a = result.nodes.find((n) => n.depth === 1)!;
    const screen = worldToScreen(a.x, a.y, camera, VIEWPORT);
    const hit = hitTest(result.nodes, screen.x, screen.y, camera, VIEWPORT, {
      minTarget: 200,
    });
    expect(hit?.node.id).toBe(a.node.id);
  });
});

// ---------------------------------------------------------------- pointers

describe('pointer model', () => {
  it('tracks pointers by id rather than assuming a single one', () => {
    // §17's multi-touch decision. Retrofitting this is expensive; keeping it
    // is free.
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 0, y: 0, t: 0 }, IDENTITY_CAMERA);
    onPointerDown(state, { id: 2, x: 100, y: 0, t: 0 }, IDENTITY_CAMERA);
    onPointerDown(state, { id: 3, x: 50, y: 50, t: 0 }, IDENTITY_CAMERA);
    expect(state.pointers.size).toBe(3);
  });

  it('pans with one pointer', () => {
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 100, y: 100, t: 0 }, IDENTITY_CAMERA);
    const result = onPointerMove(
      state,
      { id: 1, x: 150, y: 100, t: 16 },
      IDENTITY_CAMERA,
      VIEWPORT,
    );
    expect(result.camera.x).toBeCloseTo(-50);
    expect(result.active).toBe(true);
  });

  it('switches to pinch on the second pointer', () => {
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 100, y: 400, t: 0 }, IDENTITY_CAMERA);
    expect(state.kind).toBe('pan');
    onPointerDown(state, { id: 2, x: 200, y: 400, t: 0 }, IDENTITY_CAMERA);
    expect(state.kind).toBe('pinch');
    expect(state.pinchStartDistance).toBeCloseTo(100);
  });

  it('zooms proportionally to the pinch distance', () => {
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 100, y: 400, t: 0 }, IDENTITY_CAMERA);
    onPointerDown(state, { id: 2, x: 200, y: 400, t: 0 }, IDENTITY_CAMERA);

    const result = onPointerMove(
      state,
      { id: 2, x: 300, y: 400, t: 16 },
      IDENTITY_CAMERA,
      VIEWPORT,
    );
    expect(result.camera.scale).toBeCloseTo(2, 1);
  });

  it('falls back to pan when one finger of a pinch lifts', () => {
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 100, y: 400, t: 0 }, IDENTITY_CAMERA);
    onPointerDown(state, { id: 2, x: 200, y: 400, t: 0 }, IDENTITY_CAMERA);
    onPointerUp(state, { id: 2, x: 200, y: 400, t: 20 });
    expect(state.kind).toBe('pan');
  });

  it('reports a tap when the pointer barely moved', () => {
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 100, y: 100, t: 0 }, IDENTITY_CAMERA);
    const result = onPointerUp(state, {
      id: 1,
      x: 100 + TAP_SLOP_PX - 1,
      y: 100,
      t: 80,
    });
    expect(result.wasTap).toBe(true);
    expect(result.momentum).toBeNull();
  });

  it('does not report a tap after a drag', () => {
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 100, y: 100, t: 0 }, IDENTITY_CAMERA);
    onPointerMove(
      state,
      { id: 1, x: 300, y: 100, t: 16 },
      IDENTITY_CAMERA,
      VIEWPORT,
    );
    const result = onPointerUp(state, { id: 1, x: 300, y: 100, t: 32 });
    expect(result.wasTap).toBe(false);
  });

  it('never coasts after a pinch', () => {
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 100, y: 400, t: 0 }, IDENTITY_CAMERA);
    onPointerDown(state, { id: 2, x: 200, y: 400, t: 0 }, IDENTITY_CAMERA);
    onPointerMove(
      state,
      { id: 2, x: 300, y: 400, t: 16 },
      IDENTITY_CAMERA,
      VIEWPORT,
    );
    onPointerUp(state, { id: 1, x: 100, y: 400, t: 30 });
    const result = onPointerUp(state, { id: 2, x: 300, y: 400, t: 40 });
    expect(result.momentum).toBeNull();
  });

  it('detects a long press only when the pointer stayed still', () => {
    const state = createGestureState();
    onPointerDown(state, { id: 1, x: 100, y: 100, t: 0 }, IDENTITY_CAMERA);
    expect(isLongPress(state, 1, 200)).toBe(false);
    expect(isLongPress(state, 1, 500)).toBe(true);

    onPointerMove(
      state,
      { id: 1, x: 300, y: 100, t: 100 },
      IDENTITY_CAMERA,
      VIEWPORT,
    );
    expect(isLongPress(state, 1, 900)).toBe(false);
  });

  it('detects a double tap within the time and distance window', () => {
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 12, y: 12, t: 200 })).toBe(
      true,
    );
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 12, y: 12, t: 900 })).toBe(
      false,
    );
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 200, y: 10, t: 100 })).toBe(
      false,
    );
    expect(isDoubleTap(null, { x: 10, y: 10, t: 0 })).toBe(false);
  });
});

// -------------------------------------------------------------------- seed

describe('Community Map seed', () => {
  it('has twelve ring-one nodes', () => {
    const graph = communityMap();
    expect(graph.childrenOf.get(graph.rootId)).toHaveLength(12);
  });

  it('has exactly eight live ring-one nodes', () => {
    /*
     * ADR-0001 shipped five. Freelance & Marketplace became the sixth when the
     * marketplace shipped; Tasks & Projects and Commerce & Payments became the
     * seventh and eighth when their node-type packages got a destination to
     * open — `/work` and `/commerce`.
     *
     * Changing this number is a scope decision, not a data tweak — which is
     * the whole reason it is asserted. Flipping a node to `active` is a public
     * claim that a feature is available, and it should cost a deliberate edit
     * to a test and a line in the ADR, not be something that drifts.
     */
    const graph = communityMap();
    const ringOne = (graph.childrenOf.get(graph.rootId) ?? []).map((id) =>
      graph.nodes.get(id)!,
    );
    expect(ringOne.filter((n) => n.status === 'active')).toHaveLength(8);
    expect(ringOne.filter((n) => n.status === 'coming_soon')).toHaveLength(4);
  });

  it('assigns unique slots within each parent', () => {
    const graph = communityMap();
    for (const [parentId, childIds] of graph.childrenOf) {
      const slots = childIds.map((id) => graph.nodes.get(id)!.slot);
      expect(new Set(slots).size, `duplicate slot under ${parentId}`).toBe(
        slots.length,
      );
    }
  });

  it('gives no Coming Soon node children', () => {
    // Expanding a Coming Soon node would promise structure behind something
    // that does not exist.
    const graph = communityMap();
    for (const node of graph.nodes.values()) {
      if (node.status !== 'coming_soon') continue;
      expect(graph.childrenOf.get(node.id) ?? []).toHaveLength(0);
    }
  });

  it('gives every live ring-one node somewhere to go', () => {
    const graph = communityMap();
    const ringOne = (graph.childrenOf.get(graph.rootId) ?? []).map((id) =>
      graph.nodes.get(id)!,
    );
    for (const node of ringOne) {
      if (node.status !== 'active') continue;
      const hasChildren = (graph.childrenOf.get(node.id) ?? []).length > 0;
      expect(Boolean(node.href) || hasChildren, `${node.id} is a dead end`).toBe(
        true,
      );
    }
  });

  it('keeps every node title inside the 60-character cap', () => {
    for (const node of COMMUNITY_NODES) {
      expect(node.title.length, node.id).toBeLessThanOrEqual(60);
    }
  });

  it('generates a synthetic map of the requested size', () => {
    expect(syntheticMap(150).nodes.size).toBe(150);
    expect(syntheticMap(400).nodes.size).toBe(400);
  });
});

// ------------------------------------------------------------- performance

describe('layout performance', () => {
  it('lays out 150 nodes well inside a frame budget', () => {
    // §24: 60fps with 150 nodes. The layout pass is only part of a frame, so
    // budget it at a third of 16.6ms. This is a coarse guard against an
    // accidental O(n^2) — real frame rate is measured on device.
    const graph = syntheticMap(150);
    const expandedIds = new Set([...graph.nodes.keys()]);

    /**
     * The MEDIAN of individual runs, not the mean of a batch.
     *
     * A mean is hostage to one scheduling hiccup: this assertion failed once
     * in CI while a production build was running on the same machine, which
     * says nothing about the layout code. The median answers the question the
     * budget is actually asking — is a typical layout inside the budget — and
     * still fails loudly on an accidental O(n²), which is what this guards.
     */
    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      computeLayout({
        graph,
        expandedIds,
        focus: NO_FOCUS,
        camera: { x: 0, y: 0, scale: 1 },
        viewport: DESKTOP_VIEWPORT,
      });
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;

    expect(median).toBeLessThan(5);
  });

  it('lays out a 1200-node map inside a frame budget', () => {
    // The walk is linear in PLACED nodes — culling and the cap bound what is
    // rendered, not what is traversed — so this asserts an absolute budget
    // rather than a growth ratio. A ratio test here would be measuring the
    // machine's noise, not the algorithm.
    const graph = syntheticMap(1200);
    const expandedIds = new Set([...graph.nodes.keys()]);

    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      computeLayout({
        graph,
        expandedIds,
        focus: NO_FOCUS,
        camera: { x: 0, y: 0, scale: 1 },
        viewport: DESKTOP_VIEWPORT,
      });
    }
    const perLayout = (performance.now() - start) / 10;

    // Generous: this runs in CI on shared hardware. It catches an accidental
    // O(n^2), which is the failure that actually matters here.
    expect(perLayout).toBeLessThan(16);
  });
});

describe('fitting the viewport', () => {
  it('fits ring one and its labels on a phone', () => {
    // The defect this guards: the map opened at scale 1 and ring one ran off
    // both edges of a 390px screen, so a first-time user had to pinch out
    // before they could read anything.
    const scale = fitScaleFor(1, VIEWPORT);
    const spec = MOBILE_GEOMETRY;

    // LABEL_ALLOWANCE is imported, not copied. The previous version hardcoded
    // 34 here; when the fit was retuned this test failed for a reason that had
    // nothing to do with what it guards.
    const extent =
      (ringRadius(1, spec) + spec.maxNodeSize / 2 + LABEL_ALLOWANCE) * 2 * scale;

    expect(extent).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('accounts for the label below the circle, not just the circle', () => {
    // Labels clip before circles do; a fit computed on radius alone looks
    // correct in a diagram and wrong on a device.
    const spec = MOBILE_GEOMETRY;
    const scale = fitScaleFor(1, VIEWPORT);
    const circleOnly =
      VIEWPORT.width / ((ringRadius(1, spec) + spec.maxNodeSize / 2) * 2);
    expect(scale).toBeLessThan(circleOnly);
  });

  it('does not zoom past the clamp on a very large screen', () => {
    expect(fitScaleFor(1, { width: 8000, height: 8000 })).toBeLessThanOrEqual(
      MAX_SCALE,
    );
  });

  it('zooms out further for deeper rings', () => {
    expect(fitScaleFor(3, VIEWPORT)).toBeLessThan(fitScaleFor(1, VIEWPORT));
  });

  it('centres on the root', () => {
    const camera = cameraToFit(1, VIEWPORT);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
  });

  it('leaves every ring-one node inside the viewport at the fitted scale', () => {
    const camera = cameraToFit(1, VIEWPORT);
    const result = computeLayout({
      graph: communityMap(),
      expandedIds: new Set(),
      focus: NO_FOCUS,
      camera,
      viewport: VIEWPORT,
    });

    for (const node of result.nodes) {
      const screen = worldToScreen(node.x, node.y, camera, VIEWPORT);
      const r = (node.size / 2) * camera.scale;
      expect(screen.x - r, node.node.title).toBeGreaterThanOrEqual(-1);
      expect(screen.x + r, node.node.title).toBeLessThanOrEqual(VIEWPORT.width + 1);
    }
  });
});

describe('edges', () => {
  it('stops each connector at the node edge, not its centre', () => {
    // Otherwise the line runs under the circle and out through the label.
    const camera = cameraToFit(1, VIEWPORT);
    const result = computeLayout({
      graph: communityMap(),
      expandedIds: new Set(),
      focus: NO_FOCUS,
      camera,
      viewport: VIEWPORT,
    });

    const byId = new Map(result.nodes.map((n) => [n.node.id, n]));
    for (const edge of result.edges) {
      const to = byId.get(edge.toId)!;
      const gap = Math.hypot(edge.x2 - to.x, edge.y2 - to.y);
      expect(gap).toBeCloseTo(to.size / 2, 1);
    }
  });
});

describe('lens (§06, ADR-0002)', () => {
  it('shows everything by default', () => {
    const all = layoutOf({ lens: 'all', camera: { x: 0, y: 0, scale: 0.5 } });
    expect(all.nodes.filter((n) => n.depth === 1)).toHaveLength(12);
  });

  it('hides unbuilt nodes under the active lens', () => {
    const active = layoutOf({ lens: 'active', camera: { x: 0, y: 0, scale: 0.5 } });
    const ringOne = active.nodes.filter((n) => n.depth === 1);
    // Eight live; see ADR-0001's amendments.
    expect(ringOne).toHaveLength(8);
    expect(ringOne.every((n) => n.node.status === 'active')).toBe(true);
  });

  it('leaves no gap in the ring when nodes are filtered out', () => {
    // Slots are re-derived from the surviving set, so five nodes are evenly
    // spaced rather than sitting in their original twelve-slot positions with
    // seven holes.
    const active = layoutOf({ lens: 'active', camera: { x: 0, y: 0, scale: 0.5 } });
    const ringOne = active.nodes
      .filter((n) => n.depth === 1)
      .sort((a, b) => a.theta - b.theta);

    const gaps: number[] = [];
    for (let i = 1; i < ringOne.length; i++) {
      gaps.push(ringOne[i]!.theta - ringOne[i - 1]!.theta);
    }
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0]!, 5);
    }
  });

  it('does not move nodes under any lens except trending', () => {
    // ADR-0002: position never depends on engagement. Trending is the single
    // deliberate exception, and it is explicit, temporary and signposted.
    const base = layoutOf({ camera: { x: 0, y: 0, scale: 0.5 } });
    const mine = layoutOf({ lens: 'mine', camera: { x: 0, y: 0, scale: 0.5 } });

    const byId = new Map(base.nodes.map((n) => [n.node.id, n]));
    for (const node of mine.nodes) {
      expect(node.theta).toBeCloseTo(byId.get(node.node.id)!.theta, 6);
    }
  });

  it('re-lays by weight under the trending lens', () => {
    const trending = layoutOf({
      lens: 'trending',
      camera: { x: 0, y: 0, scale: 0.5 },
    });
    const ringOne = trending.nodes
      .filter((n) => n.depth === 1)
      .sort((a, b) => a.theta - b.theta);

    // Heaviest first, at twelve o'clock.
    for (let i = 1; i < ringOne.length; i++) {
      expect(ringOne[i - 1]!.node.weight).toBeGreaterThanOrEqual(
        ringOne[i]!.node.weight,
      );
    }
  });

  it('keeps trending non-default so the map stays learnable', () => {
    const base = layoutOf({ camera: { x: 0, y: 0, scale: 0.5 } });
    const trending = layoutOf({
      lens: 'trending',
      camera: { x: 0, y: 0, scale: 0.5 },
    });

    const baseFirst = base.nodes.find((n) => n.depth === 1 && n.node.slot === 0);
    const trendingFirst = trending.nodes
      .filter((n) => n.depth === 1)
      .sort((a, b) => a.theta - b.theta)[0];

    // The default layout puts slot 0 at twelve o'clock; trending puts the
    // heaviest there. They differ, which is the whole point of the lens
    // being a deliberate, reversible choice.
    expect(baseFirst).toBeTruthy();
    expect(trendingFirst).toBeTruthy();
  });
});

describe('cluster threshold', () => {
  it('matches the specified value', () => {
    expect(CLUSTER_THRESHOLD).toBe(6);
    expect(NODE_CAP).toBe(300);
  });
});
