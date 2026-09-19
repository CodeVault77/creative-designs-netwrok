# ADR-0004: Responsive web and PWA before native apps

**Status:** Accepted
**Date:** 2026-08-31
**Phase:** P0

## Context

The product is mobile-first and the reference designs are phone screens, which naturally suggests native apps. But the MVP's purpose is validation, and the core interaction — a pan/zoom canvas — is equally achievable on the web.

## Decision

Ship responsive web, installable as a PWA. Revisit native after the MVP has real usage data.

## Consequences

**Easy.** One codebase. Deep links work everywhere, which matters disproportionately because node-level shareable links are an MVP requirement (§10) and are the product's main growth mechanism — a link that opens a map instantly in any browser beats one that prompts an app install. No app-store review sitting between a fix and users having it. Iteration speed roughly doubles at this stage.

**Hard.** No push notifications on iOS below the PWA threshold, no app-store presence, and canvas performance ceilings are lower than native — which is exactly why §23 rates the renderer as the top technical risk and mandates a spike in week 2.

**Reversing it.** Moderate. The renderer and layout engine are the expensive parts and would need rewriting for native; the data model, API, permission model and design tokens carry over unchanged.

## Alternatives considered

- **React Native from day one.** Rejected: doubles the build before there is anything to validate, and the canvas story on React Native is worse rather than better.
- **Web plus a thin native wrapper at launch.** Deferred rather than rejected — worth revisiting at month 4 once the canvas is proven and push notifications start mattering for collaboration.
