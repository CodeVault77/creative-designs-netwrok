/**
 * Zoom tiers (§09).
 *
 * | Tier     | Scale   | Node renders as             | Labels                    |
 * | Overview | < 0.6   | Dot, family hue only, 12px  | Ring-one only             |
 * | Default  | 0.6–1.3 | Circle + icon, 56–64px      | One line, 18 chars        |
 * | Detail   | 1.3–2.4 | Circle + icon + count badge | Two lines + node type     |
 *
 * The tier is a pure function of scale, deliberately. If it depended on node
 * count or device, the same pinch would produce different results on
 * different maps and the gesture would stop being learnable.
 */

export type ZoomTier = 'overview' | 'default' | 'detail';

export const TIER_BOUNDS = {
  overviewMax: 0.6,
  detailMin: 1.3,
} as const;

export function zoomTierFor(scale: number): ZoomTier {
  if (scale < TIER_BOUNDS.overviewMax) return 'overview';
  if (scale >= TIER_BOUNDS.detailMin) return 'detail';
  return 'default';
}

export interface TierRendering {
  /** Draw as a plain dot rather than a circle with an icon. */
  dot: boolean;
  /** Diameter used when `dot` is true. */
  dotSize: number;
  showIcon: boolean;
  showBadge: boolean;
  /** 0 = no labels, 1 = single line, 2 = two lines plus type. */
  labelLines: 0 | 1 | 2;
  /** Characters before truncation (§10: 18 on canvas). */
  labelChars: number;
  /** At Overview only ring one is labelled; deeper labels appear on focus. */
  labelMaxDepth: number;
}

export function renderingFor(tier: ZoomTier): TierRendering {
  switch (tier) {
    case 'overview':
      return {
        dot: true,
        dotSize: 12,
        showIcon: false,
        showBadge: false,
        labelLines: 1,
        labelChars: 18,
        // Ring one only. Labelling every dot at this scale produces a wall of
        // overlapping text that reads as noise.
        labelMaxDepth: 1,
      };
    case 'detail':
      return {
        dot: false,
        dotSize: 12,
        showIcon: true,
        showBadge: true,
        labelLines: 2,
        labelChars: 28,
        labelMaxDepth: Infinity,
      };
    case 'default':
    default:
      return {
        dot: false,
        dotSize: 12,
        showIcon: true,
        /*
         * The badge is on at default scale, not just in detail.
         *
         * §10 requires Coming Soon to differ in at least two channels, and at
         * this tier the other two are a dashed ring and no glow — both of
         * which are easy to miss on a small phone against a lit neighbour.
         * The design canvas shows SOON at this scale for the same reason: the
         * default view is the one people actually read.
         */
        showBadge: true,
        labelLines: 1,
        labelChars: 18,
        labelMaxDepth: Infinity,
      };
  }
}

/** §10: labels truncate at 18 characters on canvas. */
export function truncate(label: string, max: number): string {
  if (label.length <= max) return label;
  return `${label.slice(0, Math.max(1, max - 1))}…`;
}
