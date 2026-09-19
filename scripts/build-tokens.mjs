#!/usr/bin/env node
/**
 * Token build: design/tokens.json -> two generated artifacts.
 *
 * ADR-0008 explains why there are two. The map renderer draws to canvas and
 * has no access to CSS custom properties or React context at draw time, so it
 * cannot read the styled-components theme. Hand-maintaining the same values in
 * two places is how they drift. One source, one build step, two outputs:
 *
 *   src/lib/styles/tokens.generated.ts    plain object — canvas renderer, tests,
 *                                         anything outside React
 *   src/lib/styles/cssVars.generated.ts   CSS custom property block — DOM chrome
 *
 * Run: npm run tokens        (also runs automatically before build and dev)
 * Check: npm run tokens:check  — fails if the generated files are stale, which
 *        is what stops a PR landing with tokens.json edited but not rebuilt.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'design/tokens.json');
const OUT_DIR = resolve(root, 'src/lib/styles');
const OUT_TS = resolve(OUT_DIR, 'tokens.generated.ts');
const OUT_CSS = resolve(OUT_DIR, 'cssVars.generated.ts');

const checkOnly = process.argv.includes('--check');

const BANNER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: design/tokens.json
 * Build:  scripts/build-tokens.mjs  (npm run tokens)
 *
 * Edit the source and rebuild. Edits here are silently overwritten, and
 * \`npm run tokens:check\` fails in CI if this file is stale.
 */
`;

// ---------------------------------------------------------------- helpers

/** #RRGGBB -> "r, g, b". Throws loudly rather than emitting a broken colour. */
function hexToRgbTriplet(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255].join(', ');
}

function rgba(hex, alpha) {
  return `rgba(${hexToRgbTriplet(hex)}, ${alpha})`;
}

/** Unwraps the { value, comment } shape used for documented tokens. */
function val(node) {
  return node && typeof node === 'object' && 'value' in node ? node.value : node;
}

/**
 * Strips documentation keys ($comment, comment) recursively.
 *
 * Without this they survive into the generated object and widen its inferred
 * type — `tokens.control[density]` becomes `string | {…}` and every property
 * access on it fails to compile. Documentation belongs in the source file,
 * never in the emitted type.
 */
function clean(node) {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== 'object') return node;

  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !key.startsWith('$') && key !== 'comment')
      .map(([key, value]) => [key, clean(value)]),
  );
}

function ts(value, indent = 2) {
  return JSON.stringify(value, null, indent).replace(
    /"([A-Za-z_$][\w$]*)":/g,
    '$1:',
  );
}

// ---------------------------------------------------------------- read

if (!existsSync(SOURCE)) {
  console.error(`Token source missing: ${SOURCE}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));

// ---------------------------------------------------------------- derive

const families = Object.fromEntries(
  Object.entries(raw.color.family).map(([name, node]) => [name, val(node)]),
);

const { glowAlpha, washAlpha } = raw.familyRamp;

/** Each family gets three ramps: core (stroke), glow (halo), wash (fill). */
const familyRamps = Object.fromEntries(
  Object.entries(families).map(([name, core]) => [
    name,
    {
      core,
      rgb: hexToRgbTriplet(core),
      glow: rgba(core, glowAlpha),
      wash: rgba(core, washAlpha),
    },
  ]),
);

const ground = Object.fromEntries(
  Object.entries(raw.color.ground).map(([k, v]) => [k, val(v)]),
);
const semantic = Object.fromEntries(
  Object.entries(raw.color.semantic).map(([k, v]) => [k, val(v)]),
);

/**
 * Glow levels as DOM box-shadow strings, per family.
 * Canvas does NOT use these — it composites pre-rendered sprites (§16).
 */
function glowShadow(level, coreHex) {
  const spec = raw.glow[String(level)];
  if (!spec || level === 0) return 'none';
  const halo = `0 0 ${spec.spread} ${rgba(coreHex, spec.alpha)}`;
  return spec.ring ? `${spec.ring}, ${halo}` : halo;
}

const glowByFamily = Object.fromEntries(
  Object.entries(families).map(([name, core]) => [
    name,
    {
      0: 'none',
      1: glowShadow(1, core),
      2: glowShadow(2, core),
      3: glowShadow(3, core),
    },
  ]),
);

const durations = Object.fromEntries(
  Object.entries(raw.motion.duration).map(([k, v]) => [k, val(v)]),
);

const easings = {
  expand: raw.motion.easing.expand,
  collapse: raw.motion.easing.collapse,
  camera: raw.motion.easing.camera,
  selection: raw.motion.easing.selection,
  sheet: raw.motion.easing.sheet.fallback,
};

const typeScale = Object.fromEntries(
  Object.entries(raw.typography.scale).map(([k, v]) => [
    k,
    {
      mobile: v.mobile,
      desktop: v.desktop,
      lineHeight: v.lineHeight,
      face: v.face,
    },
  ]),
);

const space = clean(raw.space);
const radius = clean(raw.radius);
const nodeState = clean(raw.nodeState);
const mapBudgets = clean(raw.map);

// ---------------------------------------------------------------- emit TS

const tokensTs = `${BANNER}
export const tokens = {
  color: {
    ground: ${ts(ground, 4)},
    family: ${ts(families, 4)},
    semantic: ${ts(semantic, 4)},
  },

  /** core = stroke · glow = halo at ${glowAlpha} · wash = fill at ${washAlpha} */
  familyRamp: ${ts(familyRamps, 2)},

  /** DOM box-shadow per family per glow level. Canvas uses sprites instead (§16). */
  glow: ${ts(glowByFamily, 2)},

  elevation: ${ts(
    Object.fromEntries(Object.entries(raw.elevation).map(([k, v]) => [k, val(v)])),
    2,
  )},

  scrim: {
    color: ${JSON.stringify(raw.scrim.value)},
    blur: ${JSON.stringify(raw.scrim.blur)},
  },

  typography: {
    face: ${ts(
      Object.fromEntries(
        Object.entries(raw.typography.face).map(([k, v]) => [k, v.stack]),
      ),
      4,
    )},
    scale: ${ts(typeScale, 4)},
    weight: ${ts(clean(raw.typography.weight), 4)},
    tracking: {
      normal: ${JSON.stringify(raw.typography.tracking.normal)},
      uppercase: ${JSON.stringify(val(raw.typography.tracking.uppercase))},
    },
  },

  space: ${ts(space, 2)},
  radius: ${ts(radius, 2)},

  motion: {
    duration: ${ts(durations, 4)},
    stagger: ${JSON.stringify(raw.motion.duration.expand.stagger)},
    easing: ${ts(easings, 4)},
    springDamping: ${raw.motion.easing.sheet.spring.damping},
    breatheOpacityDelta: ${raw.motion.breatheOpacityDelta},
  },

  control: ${ts(clean(raw.control), 2)},
  mapControl: ${ts(clean(raw.mapControl), 2)},

  breakpoint: ${ts(clean(raw.breakpoint), 2)},

  /** Per-breakpoint map budgets. Consumed by the P3 renderer, not DOM chrome. */
  map: ${ts(mapBudgets, 2)},

  /** §10 visual states. Every state differs in at least two channels. */
  nodeState: ${ts(nodeState, 2)},

  zIndex: ${ts(clean(raw.zIndex), 2)},
} as const;

export type Tokens = typeof tokens;
export type FamilyName = keyof typeof tokens.color.family;
export type NodeStateName = keyof typeof tokens.nodeState;
export type TypeScaleName = keyof typeof tokens.typography.scale;
export type SpaceStep = keyof typeof tokens.space;
export type Density = keyof typeof tokens.control;
export type BreakpointName = keyof typeof tokens.breakpoint;

export const FAMILY_NAMES = ${ts(Object.keys(families), 2)} as const satisfies readonly FamilyName[];
export const NODE_STATE_NAMES = ${ts(Object.keys(nodeState), 2)} as const satisfies readonly NodeStateName[];
`;

// ---------------------------------------------------------------- emit CSS

const cssLines = [];
const push = (name, value) => cssLines.push(`  --${name}: ${value};`);

cssLines.push('  /* ground */');
for (const [k, v] of Object.entries(ground)) push(`ground-${k}`, v);

cssLines.push('', '  /* family ramps */');
for (const [name, ramp] of Object.entries(familyRamps)) {
  push(`fam-${name}-core`, ramp.core);
  push(`fam-${name}-rgb`, ramp.rgb);
  push(`fam-${name}-glow`, ramp.glow);
  push(`fam-${name}-wash`, ramp.wash);
}

cssLines.push('', '  /* semantic */');
for (const [k, v] of Object.entries(semantic)) push(`color-${k}`, v);

cssLines.push('', '  /* type faces */');
for (const [k, v] of Object.entries(raw.typography.face))
  push(`face-${k}`, v.stack);

cssLines.push('', '  /* type scale — mobile */');
for (const [k, v] of Object.entries(typeScale)) {
  push(`text-${k}`, v.mobile);
  push(`leading-${k}`, v.lineHeight);
}

cssLines.push('', '  /* spacing */');
for (const [k, v] of Object.entries(space)) push(`space-${k}`, v);

cssLines.push('', '  /* radius */');
for (const [k, v] of Object.entries(radius)) push(`radius-${k}`, v);

cssLines.push('', '  /* motion */');
for (const [k, v] of Object.entries(durations)) push(`duration-${k}`, v);
for (const [k, v] of Object.entries(easings)) push(`ease-${k}`, v);
push('stagger-expand', raw.motion.duration.expand.stagger);

cssLines.push('', '  /* controls — touch is the default below 1024px */');
for (const [k, v] of Object.entries(clean(raw.control.touch)))
  push(`control-${k}`, v);

cssLines.push('', '  /* elevation */');
for (const [k, v] of Object.entries(raw.elevation)) push(`elev-${k}`, val(v));
push('scrim', raw.scrim.value);

cssLines.push('', '  /* z-index */');
for (const [k, v] of Object.entries(raw.zIndex)) push(`z-${k}`, String(v));

const desktopLines = [];
for (const [k, v] of Object.entries(typeScale)) {
  desktopLines.push(`    --text-${k}: ${v.desktop};`);
}
for (const [k, v] of Object.entries(clean(raw.control.pointer))) {
  desktopLines.push(`    --control-${k}: ${v};`);
}

const cssTs = `${BANNER}
/**
 * CSS custom properties for DOM chrome.
 *
 * Injected once by GlobalStyle. Components read these through the
 * styled-components theme where they need typing, and directly as var()
 * where a raw value is enough.
 *
 * The desktop block swaps the type scale and switches the control set from
 * touch to pointer at the 1024px breakpoint (§17).
 */
export const cssVariables = \`
:root {
${cssLines.join('\n')}
}

@media (min-width: ${raw.breakpoint.desktop.min}px) {
  :root {
${desktopLines.join('\n')}
  }
}
\`;
`;

// ---------------------------------------------------------------- write

mkdirSync(OUT_DIR, { recursive: true });

const outputs = [
  [OUT_TS, tokensTs],
  [OUT_CSS, cssTs],
];

if (checkOnly) {
  let stale = false;
  for (const [file, content] of outputs) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (current !== content) {
      console.error(`Stale: ${file.replace(root, '.')}`);
      stale = true;
    }
  }
  if (stale) {
    console.error('\nGenerated token files are out of date. Run: npm run tokens');
    process.exit(1);
  }
  console.log('Token outputs are up to date.');
  process.exit(0);
}

for (const [file, content] of outputs) {
  writeFileSync(file, content, 'utf8');
  console.log(`Wrote ${file.replace(root, '.')}`);
}

console.log(
  `\n${Object.keys(families).length} families · ${Object.keys(typeScale).length} type steps · ` +
    `${Object.keys(nodeState).length} node states · ${cssLines.filter((l) => l.includes('--')).length} CSS variables`,
);
