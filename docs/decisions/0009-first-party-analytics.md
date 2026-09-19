# ADR-0009 — Analytics is first-party, not a vendor

**Status:** Accepted · **Date:** 2026-09-01 · **Phase:** P14

## Context

`docs/03-analytics-plan.md` (P0) declared the whole event taxonomy up front and
deliberately deferred the provider choice, first to P6 and then in practice to
here. That deferral cost nothing, because product code has always gone through
`track()` and never touched a vendor SDK — swapping the sink is a one-file
change, exactly as designed.

But the decision cannot be deferred past launch. §20 rates P14's risk as
**"launching without instrumentation" — High** — and its criterion is
"activation and 3-tap metrics instrumented". Shipping to a closed beta with
`NEXT_PUBLIC_ANALYTICS_PROVIDER=console` means every event goes to the browser
console and nowhere else: the instrumentation exists and measures nothing.

The analytics plan set five criteria for the choice:

| Criterion                      | Why                                                           |
| ------------------------------ | ------------------------------------------------------------- |
| Self-hostable or EU-hosted     | ADR-0006 commits to a strong privacy position                 |
| Generous custom properties     | The taxonomy is property-heavy                                |
| Reasonable free tier           | Beta is 20–50 users                                           |
| No cookie banner for basic use | A consent wall in front of the map damages the arrival metric |
| Export / API access            | Coming Soon demand data drives the roadmap                    |

## Decision

**Write the events to our own database.** No third-party analytics vendor for
the MVP.

A `beacon` provider posts batched events to `POST /api/analytics`, which writes
to `analytics_events`. Funnels are computed with SQL and read on a staff-only
dashboard.

## Why

**It satisfies every criterion outright rather than approximately.** Self-hosted
is more than self-hostable. Properties are a JSON column. The free tier is a
table. There is nothing to consent to under GDPR's legitimate-interest basis
because no data reaches a third party and no cross-site identifier exists.
Export is `SELECT`.

**It is consistent with a promise already made.** ADR-0006 says private maps are
not scanned. Shipping a vendor pixel alongside that promise would be the kind of
inconsistency users are right to notice — the cheapest way to keep data private
is not to send it anywhere.

**At beta scale the cost is genuinely lower.** 20–50 users generate thousands of
events, not millions. That is a table with an index, not a data platform. A
vendor would be more infrastructure to configure, not less.

**We only need to answer §24's questions.** Two funnels — 3-tap reach and
activation — plus Coming Soon demand per dark node. Those are three SQL queries.
Buying a product-analytics suite to run three queries is procurement, not
engineering.

## What this costs

Stated plainly, because this decision has real downsides:

- **No session replay.** The analytics plan flagged replay as a possible need
  for map usability debugging. We give that up. If watching real sessions turns
  out to be the only way to understand a map interaction problem, this decision
  gets revisited — and the facade means revisiting is still one file.
- **No funnel-exploration UI.** New questions mean writing SQL, not clicking. At
  20–50 users that is fine; at 20,000 it is a bottleneck for whoever cannot
  write SQL.
- **No retention or cohort analysis out of the box.** Buildable, not built.
- **We now own an ingestion endpoint.** It is public by necessity, so it is
  rate-limited, size-capped, and validated against the declared taxonomy —
  unknown event names are rejected rather than stored.
- **Retention and growth are ours to manage.** Events are pruned after 180 days
  by the backup script; nobody else will do it.

## Revisit when

- The beta opens up and event volume exceeds roughly a million rows a month
- Session replay becomes the only way to answer a real usability question
- Someone who cannot write SQL needs to explore the funnel themselves

## Alternatives considered

**PostHog (cloud).** Strong on every functional criterion and has a real free
tier. Rejected for the MVP because it means user behaviour leaving our
infrastructure while we are telling people their maps never do — and because at
this scale it solves a problem we do not have yet.

**PostHog (self-hosted).** Satisfies the privacy criterion, but it is a
ClickHouse deployment to run for a 30-person beta. The operational cost dwarfs
the thing being measured.

**Plausible.** Privacy-first and EU-hosted, but built around page views. The
taxonomy here is property-heavy and event-shaped; `node_selected` alone carries
five properties. Wrong shape.

**Keep `console`.** Rejected: that is the risk §20 names, written down as a
decision.
