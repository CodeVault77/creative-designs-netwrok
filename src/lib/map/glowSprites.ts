import { tokens, type FamilyName } from '@/lib/styles/tokens.generated';

/**
 * Pre-baked glow sprites — 6 families × 3 levels = 18 offscreen canvases.
 *
 * §16 and §23 both name this explicitly: glow must NEVER be a live
 * `box-shadow` or `filter` on canvas elements. A `filter: blur()` on a canvas
 * draw is a full-surface GPU readback per frame; at 150 nodes it is the
 * difference between 60fps and single digits on the mid-range Android the
 * §24 target names.
 *
 * Instead each halo is rendered ONCE into a small offscreen canvas as a radial
 * gradient, then blitted with `drawImage` and composited additively. A blit is
 * effectively free; a blur is not.
 *
 * The cache is keyed by family, level and device pixel ratio — a sprite baked
 * for DPR 1 looks soft when blitted on a DPR 3 phone.
 */

export type GlowLevel = 0 | 1 | 2 | 3;

/**
 * Halo radius as a multiple of the node radius.
 *
 * These are TIGHT on purpose. The design reference gives each node a CSS
 * box-shadow — light that hugs the ring and falls off within a few pixels of
 * it. The earlier 1.9–3.1 spreads at 0.55–0.75 alpha were not that: at 2.4×
 * a 30px node threw a 72px cloud, so eight of them merged into one luminous
 * fog with the map somewhere inside it. Edges disappeared under it, labels sat
 * on coloured haze, and the family hues bled into each other.
 *
 * A halo is a state channel (§16), not atmosphere. It has to be readable as
 * belonging to ONE node.
 *
 * The calibration that settled these numbers: the renderer drops the halo pass
 * entirely during a pan or pinch (`flat`), and the map looked RIGHT in that
 * state and wrong at rest. That is the whole test — if switching the halos off
 * improves a screen, the halos are too strong. These values are a rim light a
 * few pixels deep, close to the flat look, with just enough bloom left to
 * separate a live node from an unbuilt one.
 */
const SPREAD_MULTIPLIER: Record<GlowLevel, number> = {
  0: 0,
  1: 1.16,
  2: 1.24,
  3: 1.42,
};

const ALPHA: Record<GlowLevel, number> = {
  0: 0,
  1: 0.16,
  2: 0.22,
  3: 0.38,
};

/** Sprites are baked at this node radius and scaled at blit time. */
const BASE_RADIUS = 40;

type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;

const cache = new Map<string, SpriteCanvas>();

function keyFor(family: FamilyName, level: GlowLevel, dpr: number): string {
  return `${family}:${level}:${dpr}`;
}

function createCanvas(size: number): SpriteCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(size, size);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }
  // Server-side or a test environment without canvas: callers must handle null
  // and skip the glow pass rather than crashing.
  return null;
}

function bake(
  family: FamilyName,
  level: GlowLevel,
  dpr: number,
): SpriteCanvas | null {
  const spread = SPREAD_MULTIPLIER[level];
  if (spread === 0) return null;

  const radius = BASE_RADIUS * spread;
  const size = Math.ceil(radius * 2 * dpr);

  const canvas = createCanvas(size);
  if (!canvas) return null;

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return null;

  const centre = size / 2;
  const rgb = tokens.familyRamp[family].rgb;

  const gradient = ctx.createRadialGradient(
    centre,
    centre,
    0,
    centre,
    centre,
    centre,
  );
  // Transparent in the middle: the node's own fill is drawn on top, and a
  // solid centre would wash the icon out.
  gradient.addColorStop(0, `rgba(${rgb}, 0)`);
  gradient.addColorStop(BASE_RADIUS / radius, `rgba(${rgb}, ${ALPHA[level]})`);
  gradient.addColorStop(0.62, `rgba(${rgb}, ${ALPHA[level] * 0.35})`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return canvas;
}

/** Returns a cached sprite, baking it on first use. */
export function glowSprite(
  family: FamilyName,
  level: GlowLevel,
  dpr = 1,
): SpriteCanvas | null {
  if (level === 0) return null;

  const key = keyFor(family, level, dpr);
  const existing = cache.get(key);
  if (existing) return existing;

  const baked = bake(family, level, dpr);
  if (baked) cache.set(key, baked);
  return baked;
}

/**
 * Bakes all 18 sprites up front.
 *
 * Call once when the map mounts. Baking lazily means the first frame that
 * shows a new family stutters — which is precisely the frame where the user
 * is watching the map bloom in.
 */
export function warmGlowCache(dpr = 1): number {
  let count = 0;
  for (const family of Object.keys(tokens.color.family) as FamilyName[]) {
    for (const level of [1, 2, 3] as GlowLevel[]) {
      if (glowSprite(family, level, dpr)) count++;
    }
  }
  return count;
}

/**
 * Draws a halo centred on a world position already transformed into the
 * current canvas space.
 *
 * `lighter` composites additively so overlapping halos accumulate the way
 * real light does, rather than the nearer one occluding the further.
 */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  family: FamilyName,
  level: GlowLevel,
  x: number,
  y: number,
  nodeRadius: number,
  opacity: number,
  dpr = 1,
): void {
  const sprite = glowSprite(family, level, dpr);
  if (!sprite) return;

  const drawRadius = nodeRadius * SPREAD_MULTIPLIER[level];
  const size = drawRadius * 2;

  const previousComposite = ctx.globalCompositeOperation;
  const previousAlpha = ctx.globalAlpha;

  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = opacity;
  ctx.drawImage(
    sprite as CanvasImageSource,
    x - drawRadius,
    y - drawRadius,
    size,
    size,
  );

  ctx.globalCompositeOperation = previousComposite;
  ctx.globalAlpha = previousAlpha;
}

/** Test seam. */
export function clearGlowCache(): void {
  cache.clear();
}

export function glowCacheSize(): number {
  return cache.size;
}

export { SPREAD_MULTIPLIER, ALPHA as GLOW_ALPHA };
