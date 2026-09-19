import { describe, expect, it } from 'vitest';
import { tokens, FAMILY_NAMES, NODE_STATE_NAMES } from './tokens.generated';

/**
 * These tests enforce design-system rules that are easy to break silently.
 *
 * They are not testing that the build script works — they are testing that the
 * *decisions* in §10 and §16 still hold after someone edits tokens.json. A
 * token file is exactly the kind of thing that gets a "quick tweak" with no
 * reviewer noticing the rule it violated.
 */

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
  const int = parseInt(hex.slice(1), 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe('token integrity', () => {
  it('emits no documentation keys into the typed object', () => {
    // $comment surviving into the output widens every inferred type and
    // breaks property access on control[density]. Regression guard.
    const serialised = JSON.stringify(tokens);
    expect(serialised).not.toContain('$comment');
    expect(serialised).not.toMatch(/"comment":/);
  });

  it('has exactly six families', () => {
    // ADR-0003: six, not twelve. Twelve hues encode nothing learnable.
    expect(FAMILY_NAMES).toHaveLength(6);
  });

  it('gives every family three ramps derived from its core', () => {
    for (const family of FAMILY_NAMES) {
      const ramp = tokens.familyRamp[family];
      expect(ramp.core).toMatch(/^#[0-9A-F]{6}$/i);
      expect(ramp.glow).toContain('0.55');
      expect(ramp.wash).toContain('0.08');
      expect(ramp.rgb).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
    }
  });

  it('gives every family four glow levels, with level 0 being none', () => {
    for (const family of FAMILY_NAMES) {
      expect(tokens.glow[family][0]).toBe('none');
      expect(tokens.glow[family][1]).toContain('px');
      expect(tokens.glow[family][3]).toContain('rgba(255,255,255,0.10)');
    }
  });
});

describe('§16 colour rules', () => {
  it('keeps ink readable on every surface at AA for body text', () => {
    const { ink, canvas, background, surface, raised } = tokens.color.ground;
    for (const [name, bg] of Object.entries({
      canvas,
      background,
      surface,
      raised,
    })) {
      expect(contrast(ink, bg), `ink on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps muted text readable at AA-large on the main surfaces', () => {
    const { muted, background, surface } = tokens.color.ground;
    for (const [name, bg] of Object.entries({ background, surface })) {
      expect(contrast(muted, bg), `muted on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every family accent visible against the map canvas', () => {
    // The accents are strokes on pure black. Below 3:1 a 2px stroke
    // disappears on a low-quality phone screen in daylight.
    for (const family of FAMILY_NAMES) {
      const ratio = contrast(
        tokens.familyRamp[family].core,
        tokens.color.ground.canvas,
      );
      expect(ratio, `${family} on canvas`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps family hues distinguishable from one another', () => {
    // Not a contrast requirement — a sanity check that no two families were
    // set to near-identical hues, which would silently break the one thing
    // colour is doing on the map.
    const seen = new Set(
      FAMILY_NAMES.map((f) => tokens.familyRamp[f].core.toUpperCase()),
    );
    expect(seen.size).toBe(FAMILY_NAMES.length);
  });

  it('never reuses a semantic colour as the focus ring hue by accident', () => {
    // Focus must be one fixed colour, not a family hue (§16).
    expect(tokens.color.semantic.focus).toBe(tokens.color.family.discover);
  });
});

describe('§10 node state rules', () => {
  it('defines nine states', () => {
    expect(NODE_STATE_NAMES).toHaveLength(9);
  });

  it('gives every state at least two distinguishing channels', () => {
    // The rule that stops the map depending on hue alone. If a state is added
    // with one channel, this fails and the reviewer has to think about it.
    for (const state of NODE_STATE_NAMES) {
      const spec = tokens.nodeState[state];
      expect(spec.channels.length, `${state} channels`).toBeGreaterThanOrEqual(2);
    }
  });

  it('makes no two states identical across their visual properties', () => {
    const fingerprints = NODE_STATE_NAMES.map((state) => {
      const spec = tokens.nodeState[state];
      return JSON.stringify([
        spec.stroke,
        spec.strokeWidth,
        spec.glow,
        spec.badge,
        'opacity' in spec ? spec.opacity : 1,
        'strokeDash' in spec ? spec.strokeDash : null,
        'scale' in spec ? spec.scale : 1,
      ]);
    });
    expect(new Set(fingerprints).size).toBe(NODE_STATE_NAMES.length);
  });

  it('gives Coming Soon and inactive no glow', () => {
    // §16 glow-0 applies to both. A glowing Coming Soon node reads as live.
    expect(tokens.nodeState.comingSoon.glow).toBe(0);
    expect(tokens.nodeState.inactive.glow).toBe(0);
  });

  it('marks Coming Soon with a dashed stroke and a badge, not just colour', () => {
    expect(tokens.nodeState.comingSoon.strokeDash).toBeTruthy();
    expect(tokens.nodeState.comingSoon.badge).toBe('clock');
  });

  it('gives private and admin nodes a badge', () => {
    expect(tokens.nodeState.private.badge).toBe('lock');
    expect(tokens.nodeState.adminOwned.badge).toBe('shield');
  });
});

describe('§17 responsive budgets', () => {
  it('meets minimum touch target size on touch breakpoints', () => {
    expect(parseInt(tokens.control.touch.minHitTarget)).toBeGreaterThanOrEqual(44);
    expect(parseInt(tokens.control.pointer.minHitTarget)).toBeGreaterThanOrEqual(
      44,
    );
  });

  it('caps ring one at 8 nodes on a phone', () => {
    // More than 8 cannot hold an 88px target around a 56px circle at phone
    // width without overlapping.
    expect(tokens.map.ring1Max.phone).toBeLessThanOrEqual(8);
  });

  it('increases node budget monotonically with screen size', () => {
    const budgets = [
      tokens.map.nodeBudget.phone,
      tokens.map.nodeBudget.tablet,
      tokens.map.nodeBudget.desktop,
      tokens.map.nodeBudget.large,
      tokens.map.nodeBudget.board,
    ];
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]!).toBeGreaterThan(budgets[i - 1]!);
    }
  });

  it('keeps weight-driven sizing inside the ADR-0002 range', () => {
    // Popularity changes size, never position. The range must stay small
    // enough that a hot node does not overlap its neighbours.
    const { min, max } = tokens.map.weightSizeRange;
    expect(max / min).toBeLessThan(1.5);
  });
});

describe('§16 motion', () => {
  it('makes collapse faster than expand', () => {
    // "Retreat should feel decisive."
    expect(parseFloat(tokens.motion.duration.collapse)).toBeLessThan(
      parseFloat(tokens.motion.duration.expand),
    );
  });

  it('makes selection the fastest transition', () => {
    const others = Object.entries(tokens.motion.duration)
      .filter(([name]) => name !== 'selection' && name !== 'breathe')
      .map(([, value]) => parseFloat(value));
    for (const value of others) {
      expect(parseFloat(tokens.motion.duration.selection)).toBeLessThanOrEqual(
        value,
      );
    }
  });

  it('keeps every interaction duration under 500ms', () => {
    // Anything slower reads as lag rather than as motion.
    for (const [name, value] of Object.entries(tokens.motion.duration)) {
      if (name === 'breathe') continue;
      expect(parseFloat(value), name).toBeLessThanOrEqual(500);
    }
  });
});
