# ADR-0007: Page Watcher browses CDN community content only

**Status:** Accepted
**Date:** 2026-08-31
**Phase:** P0

## Context

Page Watcher lets a user pick interests, press Go, and browse matching pages. The source description says "pages in the CDN community", but the feature could plausibly be read as browsing the open web. Indexing the open web means owning a crawler, an index and a ranking system — a quarter of engineering by itself.

## Decision

Page Watcher browses **CDN community content**: public map pages, service nodes and published projects. Not the open web.

Because that makes the feature only as good as the content already in the system, the MVP additionally requires **60–100 seeded pages** drawn from existing CDN and partner projects before launch, plus honest empty-state copy that says the community is new rather than pretending the feed is broken.

## Consequences

**Easy.** Buildable in about a week on the content model already needed for public maps. Every item in the feed is a CDN object, which keeps _Add to map_ meaningful — that convertibility is the thing that makes Page Watcher feel native to CDN rather than a generic feed bolted on.

**Hard.** Cold start is real. Without seeding, the feature launches empty and reads as broken. §23 rates this Medium risk and the seeding is the mitigation, not an optional nicety. Consider launching Page Watcher two weeks after the map so there is content by the time anyone looks.

**Reversing it.** Cheap to widen later. External sources can be added to the same feed and card model without redesigning the feature.

## Alternatives considered

- **Index the open web.** Rejected on cost.
- **Proxy a third-party content API.** Considered. Rejected because the items would not be CDN objects, so _Add to map_ would produce nodes pointing at content the platform does not model — which breaks the one thing that makes this feature ours.
