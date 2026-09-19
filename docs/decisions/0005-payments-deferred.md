# ADR-0005: Payments deferred to month 4; enquiry-based revenue in the MVP

**Status:** Accepted
**Date:** 2026-08-31
**Phase:** P0

## Context

Revenue is a stated priority and the source conversation puts service nodes at the front of the queue. That priority is correct and this decision does not soften it.

But payment integration brings tax handling, refunds, chargebacks, invoicing, subscription state and support load. At MVP there is no paid feature to gate: the AI tools, marketplace and Pro tier are all deferred, so a checkout would be plumbing attached to nothing.

## Decision

No payment processing in the MVP. Ship the **Build With Us** service node with a real service page — capability list, project showcase, trust signals — and a working enquiry form that reaches a monitored inbox. Payments land in month 4 alongside the first genuinely paid surface.

## Consequences

**Easy.** The revenue path exists from month 1 for roughly one week of work, which matters given the project's funding position. High-value development services are sold through conversation anyway; an enquiry form converts as well as a checkout for this kind of work, and often better because the scope is negotiated.

**Hard.** No self-serve revenue, so no subscription income during the MVP window. Enquiries need a human answering them promptly or the node is worse than nothing — an unanswered enquiry form damages trust more than no form at all.

**Reversing it.** Cheap. Adding payments later touches the commerce surfaces only; nothing in the map, editor or sharing model assumes their absence.

## Alternatives considered

- **Stripe in the MVP.** Rejected: roughly two weeks plus ongoing operational burden, gating nothing.
- **No revenue surface at all until month 4.** Rejected: the enquiry form is one week and is the only MVP feature that returns money. §23 explicitly suggests pulling this _earlier_ if cash matters more than polish.
