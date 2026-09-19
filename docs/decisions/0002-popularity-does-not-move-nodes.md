# ADR-0002: Popularity affects size and glow, never position

**Status:** Accepted
**Date:** 2026-08-31
**Phase:** P0

## Context

The original brief specifies that popular nodes automatically pull toward the centre, so the rings continuously re-sort by engagement. The intent is sound: the map should feel alive and should surface what matters.

The problem is that position is the only durable thing a spatial interface has. If node 7 sits at four o'clock this week and at eleven o'clock next week, no user ever forms muscle memory, the numbering stops being a reliable address, deep links stop matching what people remember, and support conversations lose their vocabulary. A map that rearranges itself is a list with extra steps.

## Decision

Nodes occupy **fixed angular slots**, assigned once and persisted. Popularity is expressed as **size and glow intensity** within that slot: a hot node grows from 56 px to 72 px and burns brighter.

Users who want the sorted view get it explicitly via the **Trending lens**, which re-lays the map by rank, keeps its pill lit while active, and offers a persistent _Back to layout_ control so it reads as a temporary view rather than the new normal.

## Consequences

**Easy.** The map stays learnable. Fixed slots also make hit-testing, culling and layout caching dramatically simpler, and they make the numbering system in §10 trustworthy. The "show me the least looked at" request from the source conversation comes free as an inverted sort of the same lens.

**Hard.** The ambient sense of the map reorganising itself is lost. Size and glow carry less information than position does, so the popularity signal is weaker at a glance.

**Reversing it.** Moderate. The layout engine takes slot assignment as input, so a future ranked layout is a different input rather than a rewrite — but any change to default positions will be felt by existing users as things moving, and should be treated as a breaking UX change.

## Alternatives considered

- **Auto-reposition as originally specified.** Rejected for the learnability reasons above.
- **Reposition, but only once per month.** Rejected: gets the worst of both — still breaks memory, but so slowly that nobody perceives the map as live.
- **Popularity affects ring radius only, keeping the angle fixed.** Considered seriously and close to acceptable. Rejected because a node crossing between rings changes its perceived depth, which conflicts with the breadcrumb and layer-stepper model in §09.
