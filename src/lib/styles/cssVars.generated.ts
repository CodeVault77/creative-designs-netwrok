/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: design/tokens.json
 * Build:  scripts/build-tokens.mjs  (npm run tokens)
 *
 * Edit the source and rebuild. Edits here are silently overwritten, and
 * `npm run tokens:check` fails in CI if this file is stale.
 */

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
export const cssVariables = `
:root {
  /* ground */
  --ground-canvas: #000000;
  --ground-background: #07070C;
  --ground-surface: #0D0E17;
  --ground-raised: #161930;
  --ground-border: #22253A;
  --ground-ink: #EDEEF7;
  --ground-muted: #8C8FA8;

  /* family ramps */
  --fam-create-core: #A3E635;
  --fam-create-rgb: 163, 230, 53;
  --fam-create-glow: rgba(163, 230, 53, 0.55);
  --fam-create-wash: rgba(163, 230, 53, 0.08);
  --fam-discover-core: #2FD9F5;
  --fam-discover-rgb: 47, 217, 245;
  --fam-discover-glow: rgba(47, 217, 245, 0.55);
  --fam-discover-wash: rgba(47, 217, 245, 0.08);
  --fam-services-core: #FF8A3D;
  --fam-services-rgb: 255, 138, 61;
  --fam-services-glow: rgba(255, 138, 61, 0.55);
  --fam-services-wash: rgba(255, 138, 61, 0.08);
  --fam-people-core: #FF4D97;
  --fam-people-rgb: 255, 77, 151;
  --fam-people-glow: rgba(255, 77, 151, 0.55);
  --fam-people-wash: rgba(255, 77, 151, 0.08);
  --fam-organise-core: #8B5CF6;
  --fam-organise-rgb: 139, 92, 246;
  --fam-organise-glow: rgba(139, 92, 246, 0.55);
  --fam-organise-wash: rgba(139, 92, 246, 0.08);
  --fam-commerce-core: #2DD4BF;
  --fam-commerce-rgb: 45, 212, 191;
  --fam-commerce-glow: rgba(45, 212, 191, 0.55);
  --fam-commerce-wash: rgba(45, 212, 191, 0.08);

  /* semantic */
  --color-success: #2DD4BF;
  --color-warning: #FFB020;
  --color-danger: #FF4D6D;
  --color-focus: #2FD9F5;

  /* type faces */
  --face-display: var(--font-display, 'Chakra Petch'), 'Chakra Petch', system-ui, sans-serif;
  --face-body: var(--font-body, 'Inter'), 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --face-mono: var(--font-mono, 'IBM Plex Mono'), 'IBM Plex Mono', ui-monospace, monospace;

  /* type scale — mobile */
  --text-hero: 38px;
  --leading-hero: 1.08;
  --text-display-l: 28px;
  --leading-display-l: 1.2;
  --text-display-m: 22px;
  --leading-display-m: 1.2;
  --text-title: 18px;
  --leading-title: 1.3;
  --text-body: 15px;
  --leading-body: 1.55;
  --text-label: 13px;
  --leading-label: 1.4;
  --text-caption: 11px;
  --leading-caption: 1.4;
  --text-node-label: 13px;
  --leading-node-label: 1.2;

  /* spacing */
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;
  --space-24: 96px;
  --space-32: 128px;

  /* radius */
  --radius-chip: 6px;
  --radius-control: 10px;
  --radius-card: 12px;
  --radius-sheet: 20px;
  --radius-pill: 999px;
  --radius-circle: 50%;

  /* motion */
  --duration-selection: 140ms;
  --duration-collapse: 200ms;
  --duration-expand: 260ms;
  --duration-sheet: 280ms;
  --duration-camera: 420ms;
  --duration-breathe: 4000ms;
  --ease-expand: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-collapse: cubic-bezier(0.4, 0, 0.7, 0.2);
  --ease-camera: cubic-bezier(0.25, 0.9, 0.25, 1);
  --ease-selection: cubic-bezier(0, 0, 0.2, 1);
  --ease-sheet: cubic-bezier(0.2, 0.9, 0.3, 1);
  --stagger-expand: 25ms;

  /* controls — touch is the default below 1024px */
  --control-buttonHeight: 48px;
  --control-inputHeight: 48px;
  --control-minHitTarget: 88px;
  --control-iconButton: 44px;
  --control-fontSize: 15px;

  /* elevation */
  --elev-sheet: 0 -1px 0 #22253A, 0 -20px 48px rgba(0,0,0,0.60);
  --elev-card: none;
  --elev-menu: 0 8px 32px rgba(0,0,0,0.72);
  --scrim: rgba(0,0,0,0.68);

  /* z-index */
  --z-canvas: 0;
  --z-mapControls: 10;
  --z-chrome: 20;
  --z-sheet: 30;
  --z-scrim: 29;
  --z-menu: 40;
  --z-toast: 50;
}

@media (min-width: 1024px) {
  :root {
    --text-hero: 60px;
    --text-display-l: 36px;
    --text-display-m: 28px;
    --text-title: 20px;
    --text-body: 16px;
    --text-label: 14px;
    --text-caption: 12px;
    --text-node-label: 14px;
    --control-buttonHeight: 40px;
    --control-inputHeight: 40px;
    --control-minHitTarget: 44px;
    --control-iconButton: 36px;
    --control-fontSize: 14px;
  }
}
`;
