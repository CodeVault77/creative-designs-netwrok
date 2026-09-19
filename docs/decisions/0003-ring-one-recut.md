# ADR-0003: Ring one is re-cut around destinations, not platform features

**Status:** Accepted
**Date:** 2026-08-31
**Phase:** P0

## Context

The reference design's twelve ring-one nodes include Cloud & Storage, Analytics & Reports, Apps & Integrations and Marketing & Automation. These are _platform capabilities_, not places a person navigates to — storage is implicit in saving a map, analytics belongs inside a map's own panel. Their presence makes the map read as a feature inventory rather than a territory.

Meanwhile several named MVP features had no home on ring one at all: Page Watcher, Link-to-Mind-Map, Active Projects, Freelancing, Partners & Sponsors.

Separately, the reference gives each of the twelve nodes its own hue. Twelve hues means colour encodes nothing but position, and no user can learn twelve hue-to-meaning pairs.

## Decision

Re-cut ring one so every entry is somewhere a person would go. Promote Page Watcher, Link-to-Mind-Map, Build With Us and Active Projects. Demote Storage, Analytics, Integrations and Marketing — they become ring-two children of Organise, or move into the surfaces where they belong.

Group the twelve into **six domain families** which own the hues: Create, Discover, Services, People, Organise, Commerce.

## Consequences

**Easy.** The MVP's best features are one tap from the centre instead of buried at ring two. Colour becomes a navigational instrument that survives hundreds of nodes rather than decoration that stops working past twelve. Six hues are also far easier to keep distinguishable under colour-vision deficiency than twelve.

**Hard.** The map no longer matches the reference screenshots exactly, so any marketing material already produced from them is stale.

**Reversing it.** Cheap. Ring membership is data, not code. The demoted nodes cost nothing to restore as ring-two children.

## Alternatives considered

- **Keep the original twelve and add the new features at ring two.** Rejected: buries the features the MVP is actually judged on.
- **Expand ring one to sixteen.** Rejected: §17 caps ring one at eight nodes on mobile for hit-target reasons. Sixteen is unusable on a phone.
- **Keep per-node hues.** Rejected: actively harmful past ring two, where hue collisions make the map read as noise.
