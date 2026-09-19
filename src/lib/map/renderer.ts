import { tokens, type FamilyName } from '@/lib/styles/tokens.generated';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import { drawGlow, type GlowLevel } from './glowSprites';
import { renderingFor, truncate, type ZoomTier } from './zoomTiers';
import { BRAND_MARK, ICON_VIEWBOX, iconPathsFor } from './icons';
import { DESKTOP_BREAKPOINT } from './geometry';
import type { Edge, PlacedNode, Viewport } from './types';

/**
 * The canvas draw pass.
 *
 * Ordering matters and is fixed: edges, then halos, then bodies, then labels.
 * Halos composite additively, so drawing them in one contiguous pass lets
 * overlapping glows accumulate correctly and means the composite mode is set
 * twice per frame rather than twice per node.
 *
 * ── The gesture optimisation ────────────────────────────────────────────────
 *
 * §09: "Defer glow rendering during active gestures: draw flat during
 * pinch/pan, restore glow on gesture end. Users do not perceive the
 * difference; the frame counter does."
 *
 * `flat` implements exactly that. It is the single largest frame-time lever in
 * the renderer — the halo pass is ~60% of a frame at 150 nodes — and it is
 * invisible in motion because the eye cannot resolve a soft halo on a moving
 * object.
 */

export interface RenderOptions {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  viewport: Viewport;
  nodes: readonly PlacedNode[];
  edges: readonly Edge[];
  tier: ZoomTier;
  selectedId: string | null;
  /** Skip the halo pass. Set while a pan or pinch is in flight. */
  flat: boolean;
  dpr: number;
  /** Ids matching the current search, drawn at full glow (§09). */
  searchMatchIds?: ReadonlySet<string> | null;
  /** Edit mode: the node a drag would reparent onto (§14 "target highlights"). */
  dropTargetId?: string | null;
  /** Edit mode: the node currently being dragged. */
  draggingId?: string | null;
}

const GREY_STROKE = '#4A4E68';

export function render(options: RenderOptions): void {
  const {
    ctx,
    camera,
    viewport,
    nodes,
    edges,
    tier,
    selectedId,
    flat,
    dpr,
    dropTargetId,
    draggingId,
  } = options;
  const rendering = renderingFor(tier);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // §16: the map canvas alone uses pure black. It is what makes neon read as
  // emission rather than as paint.
  ctx.fillStyle = tokens.color.ground.canvas;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  // ------------------------------------------------------------- 1. edges

  ctx.lineCap = 'round';
  for (const edge of edges) {
    const a = worldToScreen(edge.x1, edge.y1, camera, viewport);
    const b = worldToScreen(edge.x2, edge.y2, camera, viewport);

    const relation = edge.kind === 'relation';

    ctx.globalAlpha = edge.opacity;
    ctx.strokeStyle = tokens.familyRamp[edge.family].core;
    /*
     * A relationship is drawn thinner than containment.
     *
     * The tree is the structure of the map and has to keep reading as
     * structure; explicit links are annotations over it. At equal weight the
     * two are indistinguishable and the map claims a hierarchy that is not
     * there.
     */
    ctx.lineWidth = Math.max(1, (relation ? 1 : 1.5) * camera.scale);

    /*
     * Different dash rhythms, not merely "dashed or not".
     *
     * `dashed` already means "leads to something unbuilt" on a containment
     * edge, so relationships need their own signature rather than borrowing
     * that one — otherwise a link to a live node and a spine into a Coming
     * Soon node draw identically.
     */
    if (relation) ctx.setLineDash([2, 4]);
    else if (edge.dashed) ctx.setLineDash([5, 5]);
    else ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    /*
     * A dot at the midpoint of every connector, as the design reference draws
     * it. It gives the eye something to fix on along an otherwise featureless
     * hairline, and at a glance it reads as direction of travel — the spoke is
     * going somewhere rather than just separating two circles.
     */
    ctx.setLineDash([]);

    // Containment only. The dot reads as direction of travel down the spine;
    // putting one on every relationship turns a lightly annotated map into a
    // field of dots.
    if (!relation) {
      const dotRadius = Math.max(1.2, 1.9 * camera.scale);
      ctx.fillStyle = tokens.familyRamp[edge.family].core;
      ctx.beginPath();
      ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // -------------------------------------------------------------- 2. halos

  if (!flat) {
    for (const item of nodes) {
      const level = glowLevelFor(item, selectedId);
      if (level === 0) continue;

      const screen = worldToScreen(item.x, item.y, camera, viewport);
      const radius = (item.size / 2) * camera.scale;

      /*
       * The centre gets its own bloom, not a family halo sprite.
       *
       * For the brand root, `discover` is only its nominal family; painting
       * that cyan sprite made the middle of the map look like a large Page
       * Watcher. It belongs to every family at once, so its light reads as
       * brand — violet and magenta, matching its six-hue ring.
       *
       * A descended centre belongs to ONE branch, so `ringHue` hands back the
       * dominant family of the ring around it and both the bloom and the ring
       * stroke use it. The two must agree: a green ring in a violet cloud was
       * the tell that they did not.
       */
      if (item.depth === 0) {
        drawRootGlow(
          ctx,
          screen.x,
          screen.y,
          radius,
          item.opacity,
          ringHue(nodes, item),
        );
        continue;
      }

      drawGlow(
        ctx,
        item.node.family,
        level,
        screen.x,
        screen.y,
        radius,
        item.opacity,
        dpr,
      );
    }
  }

  // ------------------------------------------------------------- 3. bodies

  for (const item of nodes) {
    drawNode(
      ctx,
      item,
      camera,
      viewport,
      tier,
      selectedId,
      item.depth === 0 ? ringHue(nodes, item) : null,
    );

    /*
     * §14: "Drag from node edge handle to target; target highlights."
     *
     * The highlight is what makes a reparent predictable — the user sees where
     * the node will land BEFORE releasing, so a wrong drop is prevented rather
     * than undone.
     */
    if (dropTargetId && item.node.id === dropTargetId) {
      const screen = worldToScreen(item.x, item.y, camera, viewport);
      const radius = (item.size / 2) * camera.scale;
      ctx.strokeStyle = tokens.color.semantic.focus;
      ctx.lineWidth = Math.max(2, 2.5 * camera.scale);
      ctx.setLineDash([5 * camera.scale, 4 * camera.scale]);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 8 * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // The dragged node lifts: a faint ring shows it is detached from the ring
    // it came from.
    if (draggingId && item.node.id === draggingId) {
      const screen = worldToScreen(item.x, item.y, camera, viewport);
      const radius = (item.size / 2) * camera.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 12 * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------- 4. labels

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (const item of nodes) {
    if (rendering.labelLines === 0) continue;
    if (item.depth > rendering.labelMaxDepth && item.node.id !== selectedId)
      continue;

    /*
     * A cluster's title IS its count, and `drawNode` has already drawn it
     * inside the circle. Labelling it as well printed "+5" twice, once in the
     * ring and once beneath it.
     */
    if (item.cluster) continue;

    /*
     * The root carries its name inside the ring when there is room for it, so
     * labelling it again outside would print the map's title twice. When the
     * ring is too small for legible text, drawRootContents draws none and the
     * external label is the fallback — hence the size test rather than a flat
     * skip.
     */
    if (item.depth === 0) {
      const rootRadius = (item.size / 2) * camera.scale;
      if (rootTitleFitsInside(rootRadius)) continue;
    }

    drawLabel(ctx, item, camera, viewport, tier);
  }

  ctx.restore();
}

// ------------------------------------------------------------------ helpers

function glowLevelFor(item: PlacedNode, selectedId: string | null): GlowLevel {
  // §10: Coming Soon and inactive have NO glow. A glowing Coming Soon node
  // reads as live and breaks the honesty the whole state depends on.
  if (item.node.status !== 'active') return 0;
  if (item.node.id === selectedId) return 3;
  if (item.depth === 0) return 3;
  return 2;
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  item: PlacedNode,
  camera: Camera,
  viewport: Viewport,
  tier: ZoomTier,
  selectedId: string | null,
  /** The centre's borrowed hue; null for the brand root. Ignored otherwise. */
  hue: [string, string] | null,
): void {
  const rendering = renderingFor(tier);
  const screen = worldToScreen(item.x, item.y, camera, viewport);
  const selected = item.node.id === selectedId;

  // §09: selected scales to 1.08.
  const scale = selected ? 1.08 : 1;
  const radius = ((item.size / 2) * camera.scale * scale) | 0;

  const ramp = tokens.familyRamp[item.node.family];
  const comingSoon = item.node.status === 'coming_soon';
  const inactive = item.node.status === 'inactive';

  ctx.globalAlpha = item.opacity;

  /*
   * The brand root gets the six-hue sweep, because it genuinely belongs to
   * every family and picking one would imply a hierarchy that is not there.
   *
   * A DESCENDED centre does not. It belongs to one branch, and wearing the
   * full spectrum made it look like a second copy of the map's root sitting
   * inside a single-colour ring — the one node on screen whose colour said
   * nothing about where it was. It takes the same hue its bloom already
   * borrows from the ring around it.
   */
  if (item.depth === 0) {
    drawRootRing(ctx, screen.x, screen.y, radius, camera.scale, item.node, hue);
    ctx.globalAlpha = 1;
    return;
  }

  if (rendering.dot) {
    // Overview: a dot in the family hue, no icon, no ring.
    ctx.fillStyle = inactive || comingSoon ? GREY_STROKE : ramp.core;
    ctx.beginPath();
    ctx.arc(
      screen.x,
      screen.y,
      Math.max(3, (rendering.dotSize / 2) * camera.scale),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  // Fill: a wash, never a solid. A saturated fill on black loses the icon.
  ctx.fillStyle = comingSoon || inactive ? 'rgba(255,255,255,0.02)' : ramp.wash;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Stroke, with the state's second channel: dashed for Coming Soon, grey
  // for inactive (§10 — every state differs in at least two channels).
  ctx.strokeStyle = comingSoon
    ? tokens.color.family.services
    : inactive
      ? GREY_STROKE
      : ramp.core;
  ctx.lineWidth = Math.max(1, (comingSoon ? 1.5 : 2) * camera.scale);
  ctx.setLineDash(comingSoon ? [4 * camera.scale, 4 * camera.scale] : []);
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Selected: white ring outside the family stroke (§09).
  if (selected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, 2 * camera.scale);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + 4 * camera.scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * The glyph inside the circle.
   *
   * Drawn AFTER the ring so a dashed Coming Soon stroke never cuts across it,
   * and skipped entirely for clusters, whose interior is taken by the count.
   *
   * The icon is a second, non-colour channel for what a node IS — which is
   * what makes the family hues decoration rather than the only carrier of
   * meaning, and therefore what keeps the map readable to someone who cannot
   * separate lime from cyan.
   */
  if (!item.cluster && rendering.showIcon) {
    drawIcon(
      ctx,
      item.node.icon,
      screen.x,
      screen.y,
      radius,
      comingSoon || inactive ? GREY_STROKE : ramp.core,
    );
  }

  // Cluster count sits inside the circle in the mono face.
  if (item.cluster) {
    ctx.fillStyle = tokens.color.ground.ink;
    ctx.font = `500 ${Math.max(9, 13 * camera.scale)}px ${monoStack()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${item.cluster.count}`, screen.x, screen.y);
    ctx.textBaseline = 'top';
  }

  // SOON badge, upper-right of the circle (§09).
  if (comingSoon && rendering.showBadge) {
    drawSoonBadge(
      ctx,
      screen.x + radius * 0.7,
      screen.y - radius * 0.7,
      camera.scale,
    );
  }

  ctx.globalAlpha = 1;
}

/**
 * Stroke a 24×24 glyph centred in a node.
 *
 * `Path2D` takes the same path data the design canvas uses, so the map and any
 * DOM chrome draw byte-identical artwork from one source (`icons.ts`) instead
 * of two hand-kept copies.
 *
 * Below roughly 11px the strokes merge into a smudge that reads as dirt on the
 * screen rather than as a symbol, so it is cheaper AND clearer to draw nothing
 * — the label underneath is still there and still says what the node is.
 */
function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: string | undefined,
  x: number,
  y: number,
  radius: number,
  colour: string,
): void {
  const paths = iconPathsFor(name);
  if (paths.length === 0) return;

  // Half the node's diameter: the glyph occupies the middle, leaving the ring
  // and the wash reading as a container rather than a frame around a picture.
  const size = radius;
  if (size < 11) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / ICON_VIEWBOX, size / ICON_VIEWBOX);
  ctx.translate(-ICON_VIEWBOX / 2, -ICON_VIEWBOX / 2);

  ctx.strokeStyle = colour;
  /*
   * Divided back out of the transform so the stroke lands at a constant ~1.7
   * device pixels rather than thickening with the node. Under `ctx.scale(k)` a
   * width of L paints L×k, so L must be 1.7/k — and k is size/ICON_VIEWBOX.
   */
  ctx.lineWidth = (1.7 * ICON_VIEWBOX) / size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'transparent';

  for (const d of paths) ctx.stroke(new Path2D(d));

  ctx.restore();
}

/**
 * The centre's bloom.
 *
 * Studied from the design reference, where the middle of the map sits in a
 * wide, soft violet light that reaches well past its ring and fades to nothing
 * — noticeably broader and gentler than the tight rim light on a ring-one node
 * (see glowSprites), because the centre is meant to look like the source the
 * rest of the map is lit by.
 *
 * Violet-dominant with a magenta core. Those two sit between the cyan and
 * orange ends of the ring's sweep, so the bloom reads as the whole spectrum
 * blurred rather than as any single family — which a cyan or an orange halo
 * would not.
 *
 * Two stacked gradients rather than one: a single stop from solid to
 * transparent bands visibly at this size on a near-black ground. The inner
 * pass carries the colour and the outer pass carries the falloff.
 */
/**
 * The hue a centre should glow, taken from the ring around it.
 *
 * The map's true root belongs to every family at once — that is why its ring is
 * a six-hue sweep — so it keeps the violet-and-magenta brand bloom. A DESCENDED
 * centre belongs to one branch, and lighting it in the brand colours made every
 * branch look identical: "Build With Us" sat in violet light surrounded by
 * orange children, and the centre looked pasted in from another map.
 *
 * Read from the children rather than the node's own family, because the
 * children are what the eye is comparing it against. They almost always agree;
 * when they do not, the ring is what the reader can see.
 */
/**
 * A colour at a given alpha, accepting `#rrggbb` or an existing rgb/rgba.
 *
 * Canvas gradient stops need an explicit alpha; the family ramp stores its
 * `glow` already translucent and its `core` opaque, so both have to be
 * normalised before they can be used as stops.
 */
function withAlpha(colour: string, alpha: number): string {
  if (colour.startsWith('#')) {
    const hex = colour.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const parts = colour.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return colour;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
}

function ringHue(
  nodes: readonly PlacedNode[],
  centre: PlacedNode,
): [string, string] | null {
  if (centre.node.payload?.wordmark === true) return null;

  const counts = new Map<FamilyName, number>();
  for (const item of nodes) {
    if (item.depth !== 1) continue;
    counts.set(item.node.family, (counts.get(item.node.family) ?? 0) + 1);
  }

  let family: FamilyName = centre.node.family;
  let best = 0;
  for (const [name, count] of counts) {
    if (count > best) {
      best = count;
      family = name;
    }
  }

  const ramp = tokens.familyRamp[family];
  return [ramp.core, ramp.glow];
}

function drawRootGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  opacity: number,
  hue: [string, string] | null,
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  // Additive, so the bloom brightens the ground instead of greying it — the
  // same compositing the family halos use.
  ctx.globalCompositeOperation = 'lighter';

  /*
   * `lighter` compositing means alpha carries the brightness, so the two
   * passes are built from an opaque hue plus an explicit alpha rather than
   * from the ramp's pre-baked translucent `glow` value.
   */
  const [core, wash] = hue ?? ['#8B5CF6', '#C026D3'];

  const outer = ctx.createRadialGradient(x, y, radius * 0.72, x, y, radius * 1.95);
  outer.addColorStop(0, withAlpha(core, 0.34));
  outer.addColorStop(0.45, withAlpha(core, 0.13));
  outer.addColorStop(1, withAlpha(core, 0));

  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.95, 0, Math.PI * 2);
  ctx.fill();

  // A tighter magenta pass hugging the ring, which is what gives the stroke
  // its lit edge rather than leaving it a flat outline in a cloud.
  const inner = ctx.createRadialGradient(x, y, radius * 0.86, x, y, radius * 1.28);
  inner.addColorStop(0, withAlpha(wash, 0.3));
  inner.addColorStop(1, withAlpha(wash, 0));

  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * The six families, ordered so the ring sweeps the colour wheel once.
 *
 * NOT declaration order, and that is the whole point. Declaration order runs
 * create → discover → services → people → organise → commerce, whose hues are
 * 83° → 188° → 24° → 335° → 258° → 172°: every neighbour is a large jump, and
 * the jumps alternate direction. Six flat arcs in that order can only read as
 * six flat arcs, however carefully their ends are overlapped.
 *
 * Sorted by hue the sweep is monotonic — 258 → 335 → 24 → 83 → 172 → 188 —
 * climbing once round the wheel and wrapping 70° back to the start. Adjacent
 * colours are then genuinely adjacent, so interpolating between them passes
 * through hues that belong there.
 *
 * It climbs CLOCKWISE from violet at twelve o'clock, which is the direction
 * and phase of the reference artwork: violet, pink, orange, lime, teal, cyan.
 * Running it the other way is equally smooth and reads as a different mark.
 *
 * This order is presentational only. It is not the slot order, which is fixed
 * by ADR-0002 and must never be sorted by anything.
 */
const SPECTRUM: readonly FamilyName[] = [
  'organise',
  'people',
  'services',
  'create',
  'commerce',
  'discover',
];

/**
 * The centre ring's colour: one continuous conic sweep.
 *
 * `createConicGradient` is not in every engine we support (Firefox gained it
 * comparatively recently), so the segmented draw survives as a fallback. It is
 * the OLD appearance, which is worse but correct — a ring that fails to paint
 * at all would take the brand mark's frame off the screen.
 */
function spectrumFor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): CanvasGradient | string {
  if (typeof ctx.createConicGradient !== 'function') {
    return tokens.familyRamp[SPECTRUM[0]!].core;
  }

  // Starts at twelve o'clock so the seam sits behind the top of the ring,
  // where the wordmark's own leading already interrupts the eye.
  const sweep = ctx.createConicGradient(-Math.PI / 2, x, y);

  SPECTRUM.forEach((family, index) => {
    sweep.addColorStop(index / SPECTRUM.length, tokens.familyRamp[family].core);
  });

  /*
   * The first colour repeated at 1.0 closes the loop.
   *
   * Without it the gradient interpolates from the LAST stop to nothing across
   * the final sixth, leaving a visible dead arc where the ring should be
   * returning to where it began.
   */
  sweep.addColorStop(1, tokens.familyRamp[SPECTRUM[0]!].core);

  return sweep;
}

function drawRootRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  scale: number,
  node: PlacedNode['node'],
  hue: [string, string] | null,
): void {
  ctx.lineWidth = Math.max(2, 3 * scale);

  if (hue) {
    // One colour, all the way round.
    ctx.strokeStyle = hue[0];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeStyle = spectrumFor(ctx, x, y);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  /*
   * A dark well, not a flat wash.
   *
   * The reference fills the centre with a radial fade whose highlight sits
   * ABOVE the middle, so the circle reads as a lit sphere with the wordmark
   * resting in it. The old uniform 3% white was flat, and with the bloom now
   * pressing in from outside it looked like a grey disc punched out of the
   * glow. Painted after the ring so the bloom cannot wash the interior out.
   */
  const well = ctx.createRadialGradient(
    x,
    y - radius * 0.2,
    radius * 0.1,
    x,
    y,
    radius,
  );
  well.addColorStop(0, '#0A0A14');
  well.addColorStop(0.76, '#000000');
  well.addColorStop(1, '#000000');

  ctx.fillStyle = well;
  ctx.beginPath();
  ctx.arc(x, y, radius - 1, 0, Math.PI * 2);
  ctx.fill();

  drawRootContents(ctx, x, y, radius, scale, node);
}

/**
 * Whether the root's title can be set inside its ring at this size.
 *
 * Shared with the label pass, which skips the root only when this says the
 * title is already drawn inside. Without one predicate in one place the two
 * disagreed at small scales and the map's name vanished entirely: the body
 * pass declined to draw it inside, and the label pass had already been told
 * the root never needs an outside label.
 *
 * Below this the text would be under about 9px, which is smaller than the
 * ring-one captions around it — an outside label is the better answer there.
 */
function rootTitleFitsInside(radius: number): boolean {
  return radius >= 30;
}

/**
 * Break a title into at most `maxLines` lines that each fit `maxWidth`.
 *
 * Word-wrapped, not truncated. The root's title is the map's name, and
 * "Creative Design Networks" clipped to "Creativ..." inside its own circle is
 * the least useful thing that space could hold. Only a word that is genuinely
 * wider than the box gets cut.
 */
/*
 * Fills complete lines up to `maxLines - 1`, then puts everything left over —
 * not just the one word that overflowed — on the final line and runs THAT
 * through `fitText`. An earlier version pushed the completed line, started
 * the next one with the single overflowing word, and broke out the moment
 * `maxLines` was reached — which discarded that word and everything after it
 * rather than folding them into a truncated final line. Harmless for a map
 * name short enough to rarely reach the cap; not harmless for a ring-one
 * description, where losing a clause is losing content someone will notice.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  let i = 0;

  while (i < words.length && lines.length < maxLines - 1) {
    const word = words[i];
    // Unreachable given the loop guard above; narrows `words[i]` for
    // `noUncheckedIndexedAccess`, which cannot see that guarantee on its own.
    if (word === undefined) break;
    const candidate = current ? `${current} ${word}` : word;

    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = '';
      continue; // retry this same word as the start of the next line
    }

    current = candidate;
    i += 1;
  }

  const rest = words.slice(i).join(' ');
  const finalLine = current && rest ? `${current} ${rest}` : current || rest;
  if (finalLine) lines.push(finalLine);

  return lines.map((line, index) =>
    index === lines.length - 1 ? fitText(ctx, line, maxWidth) : line,
  );
}

/**
 * The brand mark and the map's name, INSIDE the root circle.
 *
 * The design canvas puts both here rather than hanging a label underneath, and
 * it is the better call: the root is the one node whose identity is the whole
 * map, so a label floating below it reads as just another ring-one caption.
 * Inside the ring it reads as the centre.
 *
 * Everything is measured off `radius`, so the mark and the text shrink out
 * together as the camera pulls back rather than bursting the circle.
 */
function drawRootContents(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  scale: number,
  node: PlacedNode['node'],
): void {
  // Below this the mark is a smudge and the text is unreadable; the ring alone
  // still says "centre".
  if (radius < 26) return;

  const brand = node.payload?.wordmark === true;

  /*
   * Laid out as ONE vertically centred stack, not as independently positioned
   * pieces.
   *
   * Placing the mark and the text from separate offsets left the lockup
   * sitting low in the circle with the tagline clipping the ring — each part
   * was correct relative to the centre and wrong relative to the others. The
   * height is summed first, then the stack starts at half of it above centre,
   * so the group is centred however many pieces it has.
   */
  const markWidth = radius * (brand ? 0.86 : 1);
  const markHeight = (markWidth * BRAND_MARK.height) / BRAND_MARK.width;

  /*
   * 0.19, not 0.21. The wordmark is not the only thing in the circle: a
   * shorter stack lifts the tagline to a shallower depth, where the chord is
   * wider — at 0.21 it sat low enough that "THE CENTRAL NODE" could not fit
   * between the ring's walls and was dropped entirely.
   */
  const wordSize = Math.max(8, radius * 0.19);
  const lineHeight = wordSize * 1.2;
  const taglineSize = wordSize * 0.46;
  const taglineText =
    brand && typeof node.payload?.tagline === 'string' ? node.payload.tagline : '';

  /*
   * ONE decision about whether the tagline is drawn.
   *
   * The height sum below and the draw call both read it. When they each made
   * their own call — the sum assuming a tagline, the renderer skipping it
   * under a minimum size — the stack reserved room for a line that never
   * appeared, and the lockup sat high in the circle with a gap beneath it.
   *
   * 4.5px is the floor. It is small, but this is drawn at device pixel ratio,
   * so on the phones this ships to it lands at 9px or better.
   */
  const showTagline = taglineText !== '' && taglineSize >= 4.5;
  const tagline = showTagline ? taglineText : '';

  const titleFits = rootTitleFitsInside(radius);

  let textHeight = 0;
  if (titleFits) {
    textHeight = brand
      ? wordSize * 0.4 +
        lineHeight * 3 +
        (showTagline ? wordSize * 0.4 + taglineSize : 0)
      : wordSize * 0.4 + Math.max(9, radius * 0.16) * 1.15 * 2;
  }

  let cursor = -(markHeight + textHeight) / 2;

  // ------------------------------------------------------------------- mark

  ctx.save();

  ctx.translate(x - markWidth / 2, y + cursor);
  ctx.scale(markWidth / BRAND_MARK.width, markHeight / BRAND_MARK.height);

  /*
   * Built AFTER the transform above, in the PATH's own local coordinates —
   * (0, height/2) to (width, height/2) — not before it, in screen space.
   *
   * A `CanvasGradient`'s coordinates are not fixed at creation the way they
   * look; they are re-read through whatever transform is active at the next
   * stroke/fill. Built in screen space and then stroked after a translate and
   * a ~1/22 scale-down, the gradient's endpoints (root-node screen
   * coordinates, easily in the hundreds of pixels) land far outside the local
   * 0–44 box the path now lives in — so every point on the path samples one
   * clamped end of the gradient, and the whole glyph paints as a single flat
   * colour. That was invisible in review because it still looked like SOME
   * colour, just the wrong shape of it: a flat blue mark where the sign-in
   * screen and the entry ring both show a full sweep through cyan, violet,
   * pink and orange for the exact same asset.
   */
  const gradient = ctx.createLinearGradient(
    0,
    BRAND_MARK.height / 2,
    BRAND_MARK.width,
    BRAND_MARK.height / 2,
  );
  for (const stop of BRAND_MARK.stops) gradient.addColorStop(stop.at, stop.color);

  ctx.strokeStyle = gradient;
  // Undo the transform's scaling so the stroke stays a constant screen weight.
  ctx.lineWidth = (1.8 * BRAND_MARK.width) / markWidth;
  ctx.lineCap = 'round';
  for (const d of BRAND_MARK.paths) ctx.stroke(new Path2D(d));

  ctx.restore();

  if (!titleFits) return;

  cursor += markHeight + wordSize * 0.4;

  // ------------------------------------------------------------------- text

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  if (brand) {
    drawWordmark(
      ctx,
      x,
      y,
      y + cursor,
      radius,
      wordSize,
      lineHeight,
      taglineSize,
      tagline,
    );
  } else {
    const fontSize = Math.max(9, radius * 0.16);
    ctx.fillStyle = tokens.color.ground.ink;
    ctx.font = `600 ${fontSize}px ${displayStack()}`;

    /*
     * Width is measured against a chord, not the diameter. The text sits below
     * centre, where the circle is already narrowing, so 1.25x the radius is
     * about what is really available before its corners cross the ring.
     */
    const lines = wrapText(ctx, node.title, radius * 1.25, 2);

    lines.forEach((line, index) => {
      ctx.fillText(line, x, y + cursor + index * fontSize * 1.15);
    });
  }

  ctx.restore();
}

/**
 * The three-colour wordmark and tagline, for a root flagged as the brand.
 *
 * The same lockup as the entry screen, so arriving at the map lands you
 * somewhere you recognise rather than at a circle with a caption in it.
 *
 * Sized entirely off `radius`, so it holds together at every zoom instead of
 * bursting the ring as the camera pushes in. The three hues are brand colours
 * on near-black at display weight, which is where they pass contrast — the
 * same exception §16 allows the marketing lockup, and the reason node labels
 * elsewhere stay ink.
 */
function drawWordmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  centreY: number,
  top: number,
  radius: number,
  size: number,
  lineHeight: number,
  taglineSize: number,
  tagline: string,
): void {
  const WORDS: readonly [string, string][] = [
    ['CREATIVE', '#2FD9F5'],
    ['DESIGN', '#8B5CF6'],
    ['NETWORKS', '#FF8A3D'],
  ];

  ctx.font = `700 ${size}px ${displayStack()}`;
  ctx.letterSpacing = `${(size * 0.085).toFixed(2)}px`;

  WORDS.forEach(([word, colour], index) => {
    ctx.fillStyle = colour;
    ctx.fillText(word, x, top + index * lineHeight);
  });

  ctx.letterSpacing = '0px';

  if (!tagline) return;

  const taglineTop = top + WORDS.length * lineHeight + size * 0.4;

  /*
   * Fitted to the CHORD at its own height, not to the diameter.
   *
   * The tagline is the lowest thing in the lockup, where the circle has
   * narrowed considerably — half-width there is sqrt(r^2 - d^2), not r. Sized
   * against the diameter it ran past the ring on both sides and the first and
   * last letters were clipped by the stroke.
   *
   * Measured at the line's BASE, the widest point it has to clear.
   */
  const depth = Math.min(radius, Math.abs(taglineTop + taglineSize - centreY));
  const available =
    Math.sqrt(Math.max(0, radius * radius - depth * depth)) * 2 * 0.9;

  ctx.font = `500 ${taglineSize}px ${displayStack()}`;
  ctx.letterSpacing = `${(taglineSize * 0.18).toFixed(2)}px`;
  ctx.fillStyle = tokens.color.ground.muted;

  const text = fitText(ctx, tagline, available);
  // An ellipsised tagline is worse than none: it is decoration, not content.
  if (!text.endsWith('…')) ctx.fillText(text, x, taglineTop);

  ctx.letterSpacing = '0px';
}

function drawSoonBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
): void {
  const w = 30 * scale;
  const h = 13 * scale;
  if (h < 7) return;

  ctx.fillStyle = tokens.color.ground.canvas;
  ctx.strokeStyle = tokens.color.family.services;
  ctx.lineWidth = 1;

  const r = h / 2;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = tokens.color.family.services;
  ctx.font = `500 ${Math.max(6, 8 * scale)}px ${monoStack()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SOON', x, y + 0.5);
  ctx.textBaseline = 'top';
}

/**
 * Space a label may occupy before it collides with its neighbour.
 *
 * Derived from the arc between siblings rather than from a fixed character
 * count. The font has a 9px floor for legibility while node size scales with
 * the camera, so at a zoomed-out fit scale a fixed 18-character label is
 * physically wider than the gap between two nodes and the ring turns into
 * overlapping text. Truncating to the available width instead keeps the ring
 * readable at every scale.
 */
function labelBudget(item: PlacedNode, camera: Camera): number {
  if (item.depth === 0) return 240;
  // Chord length between adjacent slots on this ring, in screen pixels.
  const circumference = 2 * Math.PI * item.radius * camera.scale;
  // Ring one has up to 12 slots; deeper rings fan into a narrower arc, so
  // assume a comparable neighbour spacing rather than the full circle.
  const approxSiblings = 12;
  // 1.4 lets a label borrow a little of its neighbour's slack — labels are
  // centred under nodes, so adjacent ones grow away from each other — without
  // letting a long title run across the node beside it.
  return Math.max(48, (circumference / approxSiblings) * 1.4);
}

/** Truncates by MEASURED width, not character count. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let low = 1;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}…`;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  item: PlacedNode,
  camera: Camera,
  viewport: Viewport,
  tier: ZoomTier,
): void {
  const rendering = renderingFor(tier);
  const screen = worldToScreen(item.x, item.y, camera, viewport);
  const radius = (item.size / 2) * camera.scale;

  const fontSize = Math.max(9, 13 * camera.scale);
  if (fontSize < 9) return;

  ctx.globalAlpha = item.opacity;
  ctx.font = `600 ${fontSize}px ${displayStack()}`;
  ctx.textAlign = 'center';

  const text = fitText(
    ctx,
    truncate(item.node.title, rendering.labelChars),
    labelBudget(item, camera),
  );
  /*
   * The root needs more clearance than a ring node.
   *
   * Its multi-hue ring is a 3px stroke with a bright halo, so a label 6px
   * below the edge sits on top of the glow and reads as touching the circle.
   * Ring nodes have a thinner stroke and a tighter halo and are fine at 6.
   */
  const gap = (item.depth === 0 ? 12 : 6) * camera.scale;
  const y = screen.y + radius + gap;

  /*
   * A soft shadow, NOT a filled rectangle behind the text.
   *
   * The pad that used to sit here was an opaque black box under every label —
   * a row of hard-edged rectangles stamped across the map, which is the single
   * thing that made it look least like the reference. A shadow does the same
   * job (hold the text legible where it crosses a connector or a neighbour's
   * halo) without drawing a shape of its own.
   *
   * It is affordable now only because the halos are tight: against the old
   * fog, a shadow could not have won.
   */
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 4;

  /*
   * §16 keeps labels off the family hue — the ring carries colour, and tinted
   * text fails contrast at this size. State is the one exception, and it is
   * carried by VALUE rather than hue: an unbuilt node's name is muted, so the
   * live map reads as the bright layer and Coming Soon recedes without
   * inventing a colour for it.
   */
  const unbuilt =
    item.node.status === 'coming_soon' || item.node.status === 'inactive';
  ctx.fillStyle = unbuilt ? tokens.color.ground.muted : tokens.color.ground.ink;

  ctx.fillText(text, screen.x, y);

  ctx.shadowBlur = 0;

  let nextLineY = y + fontSize + 3;

  if (rendering.labelLines === 2 && item.node.type !== 'cluster') {
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = tokens.color.ground.muted;
    ctx.font = `400 ${fontSize * 0.82}px ${monoStack()}`;
    ctx.fillText(item.node.type, screen.x, nextLineY);
    ctx.shadowBlur = 0;
    nextLineY += fontSize * 0.82 + 4;
  }

  /*
   * Ring-one's description, on desktop only.
   *
   * The reference this is drawn from puts a one- or two-line caption under
   * every ring-one node — "Map ideas, projects and everything", not just a
   * name. A phone has no room for that without the map turning into a wall
   * of text at the first ring, which is why this is gated on viewport WIDTH
   * (a property of the device, checked once per frame) and not on zoom scale
   * — the zoom tier above stays a pure function of scale for every device
   * alike (see the file header on `zoomTiers.ts`), and this adds a SEPARATE,
   * independent line beneath whatever that tier already draws rather than
   * changing what the tier means.
   *
   * Ring one only (`item.depth === 1`): deeper rings are reached by
   * expanding, at which point the node that matters is the new centre, and
   * captioning every descendant at once is the wall of text this avoids at
   * the first ring.
   */
  if (
    viewport.width >= DESKTOP_BREAKPOINT &&
    item.depth === 1 &&
    item.node.type !== 'cluster' &&
    item.node.description
  ) {
    const descSize = Math.max(9, fontSize * 0.72);
    ctx.font = `400 ${descSize}px ${displayStack()}`;
    // A touch dimmer than the type line above — a caption, not a second label.
    ctx.fillStyle = withAlpha(tokens.color.ground.muted, 0.85);
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;

    for (const line of wrapText(
      ctx,
      item.node.description,
      labelBudget(item, camera),
      2,
    )) {
      nextLineY += descSize * 1.2;
      ctx.fillText(line, screen.x, nextLineY);
    }

    ctx.shadowBlur = 0;
  }

  ctx.globalAlpha = 1;
}

/**
 * Font stacks for canvas.
 *
 * Canvas cannot read CSS custom properties, so the var() indirection the DOM
 * uses is unavailable here — this is the concrete case ADR-0008 predicted.
 * The literal family names must stay in step with design/tokens.json.
 */
function displayStack(): string {
  return "'Chakra Petch', system-ui, sans-serif";
}

function monoStack(): string {
  return "'IBM Plex Mono', ui-monospace, monospace";
}
