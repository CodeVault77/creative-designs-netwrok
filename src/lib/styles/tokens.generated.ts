/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: design/tokens.json
 * Build:  scripts/build-tokens.mjs  (npm run tokens)
 *
 * Edit the source and rebuild. Edits here are silently overwritten, and
 * `npm run tokens:check` fails in CI if this file is stale.
 */

export const tokens = {
  color: {
    ground: {
    canvas: "#000000",
    background: "#07070C",
    surface: "#0D0E17",
    raised: "#161930",
    border: "#22253A",
    ink: "#EDEEF7",
    muted: "#8C8FA8"
},
    family: {
    create: "#A3E635",
    discover: "#2FD9F5",
    services: "#FF8A3D",
    people: "#FF4D97",
    organise: "#8B5CF6",
    commerce: "#2DD4BF"
},
    semantic: {
    success: "#2DD4BF",
    warning: "#FFB020",
    danger: "#FF4D6D",
    focus: "#2FD9F5"
},
  },

  /** core = stroke · glow = halo at 0.55 · wash = fill at 0.08 */
  familyRamp: {
  create: {
    core: "#A3E635",
    rgb: "163, 230, 53",
    glow: "rgba(163, 230, 53, 0.55)",
    wash: "rgba(163, 230, 53, 0.08)"
  },
  discover: {
    core: "#2FD9F5",
    rgb: "47, 217, 245",
    glow: "rgba(47, 217, 245, 0.55)",
    wash: "rgba(47, 217, 245, 0.08)"
  },
  services: {
    core: "#FF8A3D",
    rgb: "255, 138, 61",
    glow: "rgba(255, 138, 61, 0.55)",
    wash: "rgba(255, 138, 61, 0.08)"
  },
  people: {
    core: "#FF4D97",
    rgb: "255, 77, 151",
    glow: "rgba(255, 77, 151, 0.55)",
    wash: "rgba(255, 77, 151, 0.08)"
  },
  organise: {
    core: "#8B5CF6",
    rgb: "139, 92, 246",
    glow: "rgba(139, 92, 246, 0.55)",
    wash: "rgba(139, 92, 246, 0.08)"
  },
  commerce: {
    core: "#2DD4BF",
    rgb: "45, 212, 191",
    glow: "rgba(45, 212, 191, 0.55)",
    wash: "rgba(45, 212, 191, 0.08)"
  }
},

  /** DOM box-shadow per family per glow level. Canvas uses sprites instead (§16). */
  glow: {
  create: {
    "0": "none",
    "1": "0 0 10px rgba(163, 230, 53, 0.35)",
    "2": "0 0 18px rgba(163, 230, 53, 0.55)",
    "3": "0 0 0 4px rgba(255,255,255,0.10), 0 0 28px rgba(163, 230, 53, 0.75)"
  },
  discover: {
    "0": "none",
    "1": "0 0 10px rgba(47, 217, 245, 0.35)",
    "2": "0 0 18px rgba(47, 217, 245, 0.55)",
    "3": "0 0 0 4px rgba(255,255,255,0.10), 0 0 28px rgba(47, 217, 245, 0.75)"
  },
  services: {
    "0": "none",
    "1": "0 0 10px rgba(255, 138, 61, 0.35)",
    "2": "0 0 18px rgba(255, 138, 61, 0.55)",
    "3": "0 0 0 4px rgba(255,255,255,0.10), 0 0 28px rgba(255, 138, 61, 0.75)"
  },
  people: {
    "0": "none",
    "1": "0 0 10px rgba(255, 77, 151, 0.35)",
    "2": "0 0 18px rgba(255, 77, 151, 0.55)",
    "3": "0 0 0 4px rgba(255,255,255,0.10), 0 0 28px rgba(255, 77, 151, 0.75)"
  },
  organise: {
    "0": "none",
    "1": "0 0 10px rgba(139, 92, 246, 0.35)",
    "2": "0 0 18px rgba(139, 92, 246, 0.55)",
    "3": "0 0 0 4px rgba(255,255,255,0.10), 0 0 28px rgba(139, 92, 246, 0.75)"
  },
  commerce: {
    "0": "none",
    "1": "0 0 10px rgba(45, 212, 191, 0.35)",
    "2": "0 0 18px rgba(45, 212, 191, 0.55)",
    "3": "0 0 0 4px rgba(255,255,255,0.10), 0 0 28px rgba(45, 212, 191, 0.75)"
  }
},

  elevation: {
  sheet: "0 -1px 0 #22253A, 0 -20px 48px rgba(0,0,0,0.60)",
  card: "none",
  menu: "0 8px 32px rgba(0,0,0,0.72)"
},

  scrim: {
    color: "rgba(0,0,0,0.68)",
    blur: "2px",
  },

  typography: {
    face: {
    display: "var(--font-display, 'Chakra Petch'), 'Chakra Petch', system-ui, sans-serif",
    body: "var(--font-body, 'Inter'), 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "var(--font-mono, 'IBM Plex Mono'), 'IBM Plex Mono', ui-monospace, monospace"
},
    scale: {
    hero: {
        mobile: "38px",
        desktop: "60px",
        lineHeight: "1.08",
        face: "display"
    },
    "display-l": {
        mobile: "28px",
        desktop: "36px",
        lineHeight: "1.2",
        face: "display"
    },
    "display-m": {
        mobile: "22px",
        desktop: "28px",
        lineHeight: "1.2",
        face: "display"
    },
    title: {
        mobile: "18px",
        desktop: "20px",
        lineHeight: "1.3",
        face: "display"
    },
    body: {
        mobile: "15px",
        desktop: "16px",
        lineHeight: "1.55",
        face: "body"
    },
    label: {
        mobile: "13px",
        desktop: "14px",
        lineHeight: "1.4",
        face: "body"
    },
    caption: {
        mobile: "11px",
        desktop: "12px",
        lineHeight: "1.4",
        face: "body"
    },
    "node-label": {
        mobile: "13px",
        desktop: "14px",
        lineHeight: "1.2",
        face: "display"
    }
},
    weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700
},
    tracking: {
      normal: "0",
      uppercase: "0.16em",
    },
  },

  space: {
  "0": "0",
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "6": "24px",
  "8": "32px",
  "12": "48px",
  "16": "64px",
  "24": "96px",
  "32": "128px"
},
  radius: {
  chip: "6px",
  control: "10px",
  card: "12px",
  sheet: "20px",
  pill: "999px",
  circle: "50%"
},

  motion: {
    duration: {
    selection: "140ms",
    collapse: "200ms",
    expand: "260ms",
    sheet: "280ms",
    camera: "420ms",
    breathe: "4000ms"
},
    stagger: "25ms",
    easing: {
    expand: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    collapse: "cubic-bezier(0.4, 0, 0.7, 0.2)",
    camera: "cubic-bezier(0.25, 0.9, 0.25, 1)",
    selection: "cubic-bezier(0, 0, 0.2, 1)",
    sheet: "cubic-bezier(0.2, 0.9, 0.3, 1)"
},
    springDamping: 0.82,
    breatheOpacityDelta: 0.04,
  },

  control: {
  touch: {
    buttonHeight: "48px",
    inputHeight: "48px",
    minHitTarget: "88px",
    iconButton: "44px",
    fontSize: "15px"
  },
  pointer: {
    buttonHeight: "40px",
    inputHeight: "40px",
    minHitTarget: "44px",
    iconButton: "36px",
    fontSize: "14px"
  }
},
  mapControl: {
  size: "44px",
  fill: "rgba(13, 14, 23, 0.72)",
  blur: "12px"
},

  breakpoint: {
  phone: {
    min: 0,
    max: 599
  },
  tablet: {
    min: 600,
    max: 1023
  },
  desktop: {
    min: 1024,
    max: 1599
  },
  large: {
    min: 1600,
    max: 2399
  },
  board: {
    min: 2400,
    max: null
  }
},

  /** Per-breakpoint map budgets. Consumed by the P3 renderer, not DOM chrome. */
  map: {
  nodeSize: {
    phone: 56,
    tablet: 60,
    desktop: 64,
    large: 68,
    board: 96
  },
  hitTarget: {
    phone: 88,
    tablet: 88,
    desktop: 44,
    large: 44,
    board: 120
  },
  ring1Max: {
    phone: 8,
    tablet: 10,
    desktop: 12,
    large: 14,
    board: 16
  },
  visibleRings: {
    phone: 2,
    tablet: 2,
    desktop: 3,
    large: 3,
    board: 4
  },
  nodeBudget: {
    phone: 150,
    tablet: 220,
    desktop: 300,
    large: 400,
    board: 500
  },
  rootSize: {
    min: 96,
    max: 128
  },
  weightSizeRange: {
    min: 56,
    max: 72
  },
  labelTruncate: {
    canvas: 18,
    title: 60
  }
},

  /** §10 visual states. Every state differs in at least two channels. */
  nodeState: {
  root: {
    stroke: "multi-hue",
    strokeWidth: 3,
    glow: 3,
    fillAlpha: 0.05,
    opacity: 1,
    badge: null,
    channels: [
      "multi-hue ring",
      "size",
      "glow-3",
      "breathe"
    ]
  },
  active: {
    stroke: "family",
    strokeWidth: 2,
    glow: 2,
    fillAlpha: 0.05,
    opacity: 1,
    badge: null,
    channels: [
      "family stroke",
      "glow-2"
    ]
  },
  selected: {
    stroke: "family",
    strokeWidth: 2,
    glow: 3,
    fillAlpha: 0.08,
    opacity: 1,
    scale: 1.08,
    ring: "white",
    badge: null,
    channels: [
      "white ring",
      "glow-3",
      "scale 1.08"
    ]
  },
  connectedAncestor: {
    stroke: "family",
    strokeWidth: 2,
    glow: 1,
    fillAlpha: 0.05,
    opacity: 0.7,
    badge: null,
    channels: [
      "opacity 70%",
      "glow-1"
    ]
  },
  connectedSibling: {
    stroke: "family",
    strokeWidth: 1.5,
    glow: 0,
    fillAlpha: 0.03,
    opacity: 0.4,
    badge: null,
    channels: [
      "opacity 40%",
      "glow-0"
    ]
  },
  inactive: {
    stroke: "#4A4E68",
    strokeWidth: 1.5,
    glow: 0,
    fillAlpha: 0.02,
    opacity: 0.75,
    badge: null,
    selectable: true,
    channels: [
      "grey stroke",
      "glow-0"
    ]
  },
  comingSoon: {
    stroke: "#FF8A3D",
    strokeWidth: 1.5,
    strokeDash: "4 4",
    glow: 0,
    fillAlpha: 0.02,
    opacity: 0.85,
    badge: "clock",
    channels: [
      "dashed stroke",
      "glow-0",
      "clock badge"
    ]
  },
  private: {
    stroke: "#8B5CF6",
    strokeWidth: 2,
    glow: 1,
    fillAlpha: 0.06,
    opacity: 1,
    badge: "lock",
    channels: [
      "violet stroke",
      "lock badge"
    ]
  },
  adminOwned: {
    stroke: "#A3E635",
    strokeWidth: 2,
    glow: 2,
    fillAlpha: 0.06,
    opacity: 1,
    badge: "shield",
    channels: [
      "lime stroke",
      "shield badge"
    ]
  }
},

  zIndex: {
  canvas: 0,
  mapControls: 10,
  chrome: 20,
  sheet: 30,
  scrim: 29,
  menu: 40,
  toast: 50
},
} as const;

export type Tokens = typeof tokens;
export type FamilyName = keyof typeof tokens.color.family;
export type NodeStateName = keyof typeof tokens.nodeState;
export type TypeScaleName = keyof typeof tokens.typography.scale;
export type SpaceStep = keyof typeof tokens.space;
export type Density = keyof typeof tokens.control;
export type BreakpointName = keyof typeof tokens.breakpoint;

export const FAMILY_NAMES = [
  "create",
  "discover",
  "services",
  "people",
  "organise",
  "commerce"
] as const satisfies readonly FamilyName[];
export const NODE_STATE_NAMES = [
  "root",
  "active",
  "selected",
  "connectedAncestor",
  "connectedSibling",
  "inactive",
  "comingSoon",
  "private",
  "adminOwned"
] as const satisfies readonly NodeStateName[];
