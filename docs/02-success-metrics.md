# Success Metrics

**Status:** Set · **Date:** 2026-08-31 · **Phase:** P0

The P0 acceptance criterion includes "success metrics set". These are they. Every metric below maps to a declared event in [`src/lib/analytics/events.ts`](../src/lib/analytics/events.ts), so instrumentation cannot drift from the definition.

§23 rates "launching without instrumentation" as a High risk. The mitigation is that the taxonomy exists before the features do.

---

## The one number that matters

**Activation: a new user creates and saves a map within their first session.**

Everything else is diagnostic. If this number is bad, nothing else being good will save the product.

|                        | Target                                                          |
| ---------------------- | --------------------------------------------------------------- |
| Activation rate (beta) | ≥ 30% of signed-up users                                        |
| Measured by            | `map_created` within the session containing `account_signed_up` |

---

## Funnel

| Stage       | Metric                                         | Target                         | Event                 |
| ----------- | ---------------------------------------------- | ------------------------------ | --------------------- |
| Arrive      | Reaches a live destination in ≤ 3 taps, ≤ 25 s | ≥ 60% of new visitors          | `destination_reached` |
| Explore     | Expands at least one node                      | ≥ 60% of new visitors          | `node_expanded`       |
| Create      | Creates a map                                  | ≥ 30% of signed-up users       | `map_created`         |
| Share       | Shares a map                                   | ≥ 15% of users who created one | `map_shared`          |
| Collaborate | Accepts an invite                              | ≥ 20% of invites sent          | `invite_accepted`     |

## Demand signal — what to build in months 4–6

| Metric                                           | Target          | Event                             |
| ------------------------------------------------ | --------------- | --------------------------------- |
| Coming Soon interest registrations per dark node | ≥ 10 in month 1 | `coming_soon_interest_registered` |

This is the single most valuable number the MVP produces. It converts the eight unbuilt families from a guess into a ranked queue, and it is the reason ADR-0001 is worth its cost.

## Revenue

| Metric                | Target         | Event                        |
| --------------------- | -------------- | ---------------------------- |
| Service enquiries     | ≥ 3 in month 1 | `service_enquiry_submitted`  |
| Enquiry response time | < 24 h         | manual, tracked in the inbox |

## Feature health

| Feature          | Metric                     | Target                                | Event                                          |
| ---------------- | -------------------------- | ------------------------------------- | ---------------------------------------------- |
| Link-to-Mind-Map | Success rate               | ≥ 80% of attempts produce a saved map | `link_to_map_generated` / `link_to_map_failed` |
| Link-to-Mind-Map | Cost per successful map    | ≤ $0.05                               | provider billing, reconciled monthly           |
| Search           | Result opened after query  | ≥ 50%                                 | `search_result_opened` / `search_submitted`    |
| Search           | Returns to prior map state | ≥ 90% restore success                 | `search_returned_to_map` with `restored: true` |
| Page Watcher     | Item converted to a node   | ≥ 10% of items opened                 | `page_watcher_node_created`                    |
| Tree view        | Share of sessions using it | tracked, no target                    | `map_view_toggled`                             |

**On the tree view number:** it has no target because it means two different things. High usage among screen-reader or keyboard users is success. High usage among pointer users on capable devices means the map is failing them, and is a signal to investigate rather than celebrate. Segment before drawing a conclusion.

## Performance and quality gates

These are pass/fail at P13, not trend metrics.

| Gate                      | Threshold                                          |
| ------------------------- | -------------------------------------------------- |
| Map frame rate            | ≥ 55 fps median, 150 nodes, 2021 mid-range Android |
| Time to interactive map   | ≤ 2.5 s on 4G                                      |
| Search suggestion latency | ≤ 300 ms p95                                       |
| Crash-free sessions       | ≥ 99.5%                                            |
| Accessibility             | WCAG 2.1 AA on all non-canvas surfaces             |

## What we deliberately do not measure at MVP

Time-on-site, page views, session count, DAU/MAU. At this stage they reward the wrong things — a confusing map produces excellent time-on-site. Revisit after activation is healthy.

## Review cadence

Weekly during the beta, against this file. A metric that has been missed for three consecutive weeks triggers a written decision: fix, re-target, or drop. Silent drift is how metrics become decoration.
