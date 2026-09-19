# Analytics Plan

**Status:** Ratified · **Date:** 2026-08-31 · **Phase:** P0

The taxonomy itself is code: [`src/lib/analytics/events.ts`](../src/lib/analytics/events.ts). This document explains the rules around it.

---

## Principles

1. **The taxonomy is declared before the features.** Every event the product will emit through P13 is already named and typed. Adding an event means editing one file and getting it reviewed, not inventing a string at a call site.
2. **Product code never imports a vendor SDK.** Everything goes through `track()` in `src/lib/analytics`. Swapping providers is a one-file change.
3. **Analytics never breaks a session.** `track()` swallows every error. A failing sink is invisible to the user.
4. **Names are `object_verb_past_tense`, snake_case.** Object first, so events group alphabetically in any analytics UI. Enforced by a test.
5. **No personal data in event properties.** IDs, enums, counts and durations only. No titles, no node text, no URLs, no email addresses. A map title can contain anything a user typed; it does not belong in an analytics payload.

## Provider decision — deliberately deferred to P6

The MVP runs on the `console` provider locally and `noop` in tests and CI. A real provider is chosen in P6, when accounts exist and there is something to attribute.

Deferring is the right call because the choice depends on facts we do not yet have: whether we need session replay for map usability debugging, what the EU-user position turns out to be, and what the budget looks like after the renderer spike. The facade means deferring costs nothing.

When the decision is made it gets its own ADR. The criteria to judge against:

| Criterion                               | Why it matters here                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Self-hostable or EU-hosted option       | ADR-0006 commits us to a strong privacy position; the analytics vendor should not undercut it |
| Custom event properties, generously     | The taxonomy is property-heavy — `node_selected` alone carries five                           |
| Reasonable free tier                    | Beta is 20–50 users                                                                           |
| No cookie banner required for basic use | A consent wall in front of the map damages the arrival metric we care most about              |
| Export / API access                     | The Coming Soon demand data drives the roadmap and must be queryable                          |

## Consent and privacy

- No analytics events fire before consent where consent is required.
- The `noop` provider is the honest default when consent is refused — the app behaves identically, it just measures nothing.
- No cross-site tracking, no advertising pixels, no third-party identity resolution.
- The privacy policy states what is collected in plain language before launch, alongside the ADR-0006 position on private maps.

## Adding an event

1. Add it to `AnalyticsEventMap` in `events.ts` with a typed payload.
2. Add the name to the `ANALYTICS_EVENTS` array. If you forget, the compile-time exhaustiveness check fails the build — this is intentional.
3. Add it to the relevant table in [`02-success-metrics.md`](02-success-metrics.md) if it backs a metric.
4. Emit it from exactly one place. An event fired from three call sites will eventually mean three different things.

## Naming rules, with examples

| Good                                      | Bad                                       | Why                                                 |
| ----------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `node_selected`                           | `clickNode`                               | Not snake_case, verb-first, ambiguous tense         |
| `map_shared`                              | `share`                                   | No object; unsortable, collides with other surfaces |
| `link_to_map_failed` with a `reason` enum | `link_error_robots`, `link_error_timeout` | One event with a dimension beats five events        |
| `search_submitted` `{ query_length }`     | `search_submitted` `{ query }`            | Query text is user content and may be personal      |

## What each phase must instrument before it is done

| Phase | Events that must be live                                                                |
| ----- | --------------------------------------------------------------------------------------- |
| P3    | `map_loaded`, `map_panned`, `map_zoomed`, `map_layer_stepped`, `map_view_toggled`       |
| P4    | `node_selected`, `node_expanded`, `node_opened`, `destination_reached`, `coming_soon_*` |
| P5    | `map_created`, `map_node_*`, `map_autosaved`, `map_save_failed`                         |
| P6    | `account_*` — plus the real provider decision and its ADR                               |
| P7    | `map_shared`, `collaborator_*`                                                          |
| P8    | `search_*`                                                                              |
| P9    | `link_to_map_*`                                                                         |
| P10   | `page_watcher_*`                                                                        |
| P11   | `map_message_sent`, `invite_accepted`, `notification_opened`                            |
| P12   | `service_node_viewed`, `service_enquiry_submitted`                                      |
| P13   | `content_reported`, `moderation_action_taken`                                           |

A phase is not done until its row here is emitting. This is part of the definition of done, not a follow-up ticket.
