# Design System (P1)

**Status:** Shipped · **Date:** 2026-08-31 · **Phase:** P1

Implements §16 (design system), §10 (node visual states) and §17 (control sets) of the blueprint.

---

## The one rule

**`design/tokens.json` is the only place a design value is written by hand.**

Everything else is generated:

```
design/tokens.json
        │
        └── scripts/build-tokens.mjs        (npm run tokens)
                    │
                    ├── src/lib/styles/tokens.generated.ts   plain object
                    │      → the canvas renderer, tests, anything outside React
                    │
                    └── src/lib/styles/cssVars.generated.ts  95 CSS variables
                           → DOM chrome, injected once by GlobalStyle
```

Two outputs because of ADR-0008: the map renderer draws to canvas and cannot read CSS custom properties or React context at draw time. Maintaining the same values in two places by hand is how they drift.

`npm run tokens:check` fails CI if the generated files are stale, so a PR cannot land with `tokens.json` edited but not rebuilt.

## What exists

|                    | Count                                 | Where                     |
| ------------------ | ------------------------------------- | ------------------------- |
| Design tokens      | 95 CSS variables                      | `design/tokens.json`      |
| Families           | 6, each with core / glow / wash ramps | `tokens.familyRamp`       |
| Type steps         | 7, mobile + desktop                   | `tokens.typography.scale` |
| Node visual states | 9                                     | `tokens.nodeState`        |
| Control sets       | 2 — touch and pointer                 | `tokens.control`          |
| Primitives         | 8 + NodePreview                       | `src/components/ui/`      |
| Tests              | 57                                    | co-located                |

**Primitives:** Button, TextField, Chip, Card, Sheet, Toast, Skeleton, Avatar. Plus `NodePreview`, which is a specification artifact rather than a shipping component — see below.

## Storybook is the acceptance surface

```bash
npm run storybook          # http://localhost:6006
npm run build-storybook    # gated in CI
```

P1 is signed off against Storybook, not against the app. The app only ever renders a component in the states its screens happen to need — which is precisely how a broken `disabled` or `error` state ships unnoticed.

Two toolbar controls sit on every story, because they are the two axes every component varies along:

- **Density** — touch (48px controls, 88px targets) vs pointer (40px / 44px)
- **Family** — the six accent hues

The **a11y addon runs axe on every story.** §23 rates discovering accessibility debt at P13 as a High risk; auditing from P1 is the mitigation.

Key stories:

| Story                           | What it is for                                                 |
| ------------------------------- | -------------------------------------------------------------- |
| `Foundation/Tokens`             | The reference sheet. Generated, so it cannot go stale.         |
| `Primitives/Button → AllStates` | Every variant × every state. The sign-off grid.                |
| `Primitives/All states`         | The other seven primitives in every state.                     |
| `Map/Node state sheet`          | **The P3 renderer's visual reference.** 9 states × 6 families. |

## NodePreview is not the renderer

`NodePreview` draws nodes in SVG so the nine states can be reviewed and signed off before anyone writes renderer code. **It must never be used inside MapCanvas.**

The real renderer composites pre-baked radial-gradient sprites (18 = 6 families × 3 glow levels) onto canvas. Live `box-shadow` or `filter` per node is the performance mistake §23 names explicitly, and per-node styled-components is the same mistake in a different costume (ADR-0008).

## Rules the tests enforce

`src/lib/styles/tokens.test.ts` is not testing the build script. It is testing that the _decisions_ still hold after someone edits `tokens.json` — the file most likely to get a "quick tweak" that quietly violates a rule.

- Ink hits 4.5:1 on every surface; every family accent hits 3:1 on the map canvas
- All six family hues are distinct
- Every node state has ≥ 2 distinguishing channels, and no two states are visually identical
- Coming Soon and inactive have no glow; Coming Soon is dashed _and_ badged
- Collapse is faster than expand; selection is the fastest transition; nothing over 500ms
- Ring one caps at 8 on a phone; node budgets increase with screen size
- No `$comment` key leaks into the typed object

## Reduced motion

Shipped in P1 as §16 requires, not deferred to P13.

- **CSS** — the global rule in `GlobalStyle` collapses every transition and animation
- **JavaScript** — `duration()` and `stagger()` in `motion.ts` return 0

**Never read a duration from tokens directly in animation code.** Go through `motion.ts` so the reduced-motion path cannot be forgotten. This matters most for the P3 camera and expand stagger, which the global CSS rule cannot reach.

## Conventions

- Import from `@/components/ui`, never from the individual files
- Transient styled-components props are prefixed `$` so they do not reach the DOM
- Focus is **always** cyan, never the family hue — it must never be mistaken for family state
- Node labels are **always** ink, never the family hue (§16)
- Cards never glow. Glow belongs to the map (§16)
- Hit targets are guaranteed by a pseudo-element, so visual size and hit size stay independent — the same principle the renderer uses for nodes (§10)

## What P1 deliberately did not build

Form primitives beyond TextField (TextArea, Select, ToggleRow, IconPicker, ColorFamilyPicker) and all shell, map, panel, search and permission components. They are listed in §18 and belong to the phases that need them. Building all 38 components now would be building against screens that do not exist yet.

## Known gaps

- **Fonts are configured but unverified against a real network.** `next/font` self-hosts Chakra Petch, Inter and IBM Plex Mono; check the FOUT behaviour on a throttled connection during P2.
- **Sheet has focus movement, not a full focus trap.** Sufficient while the sheet is the only interactive surface; the DetailSheet in P4 needs the full trap.
- **Storybook runs on the Vite builder, not `@storybook/nextjs`** — that combination is broken on Next 15 + Storybook 8. Consequence: Next-specific APIs are not mocked in stories. No design-system primitive uses one, and if a component needs `next/image` or `next/navigation`, that is a signal it belongs in a route rather than in `src/components/ui`.
