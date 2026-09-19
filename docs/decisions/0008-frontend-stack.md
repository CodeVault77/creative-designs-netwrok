# ADR-0008: Next.js, React, TypeScript and styled-components

**Status:** Accepted
**Date:** 2026-08-31
**Phase:** P0

## Context

The frontend stack was specified by the product owner: Next.js + React + TypeScript, with styled-components for styling. Recording it here makes the constraint explicit for anyone joining later, and captures the consequences that follow from it — several of which reach well beyond P0.

## Decision

Next.js App Router, React 19, TypeScript in strict mode, styled-components v6 for all component styling.

Three consequences of the styling choice are handled in P0 rather than discovered later:

1. **SSR wiring is not optional.** styled-components requires an explicit registry in the App Router (`src/lib/styles/StyledComponentsRegistry.tsx`) _and_ `compiler.styledComponents` in `next.config.mjs`. Without both, server and client generate different class names and the page hydrates through a flash of unstyled white — especially bad for a black-grounded product.

2. **styled-components implies a client boundary.** It is runtime CSS-in-JS, so any component calling `styled` is a Client Component. Server Components cannot use it. The pattern adopted here: route-level components stay server-rendered and push styling down into leaf client components (see `app/page.tsx` handing off to `components/FoundationStatus.tsx`).

3. **The canvas cannot read the theme.** The map renderer draws to canvas and has no access to CSS custom properties or the React theme context at draw time. The P1 token pipeline therefore emits **two** artifacts from one `tokens.json`: the styled-components theme object, and a plain JS token object for the renderer. This is why §19 requires a build step rather than hand-maintained constants in two places.

## Consequences

**Easy.** A fully typed theme through the `DefaultTheme` module augmentation, so a mistyped token is a build failure rather than a silently transparent colour. Co-located styles suit a component-heavy design system with ~38 components. The team already knows it.

**Hard.** Runtime CSS-in-JS has a measurable per-render cost, and the map is the most performance-sensitive surface in the product. §23 already forbids live `box-shadow` or `filter` glow per node; the same reasoning extends here — **the map canvas and its per-node visuals must not be styled-components-driven per node.** Chrome, panels, sheets and forms are fine and are where the library earns its place.

**Reversing it.** Expensive once component count grows. This is the decision most worth being certain about now, which is why it is written down rather than assumed.

## Alternatives considered

Not evaluated — the stack was a given from the product owner. Recorded for traceability rather than to reopen the question.
