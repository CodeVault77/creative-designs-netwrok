# Decision records

One file per decision. Numbered, immutable once accepted — a decision that changes gets a **new** record that supersedes the old one, so the reasoning trail survives.

`ADR-0001` through `ADR-0007` close the seven open questions from §25 of the roadmap. Closing them was the P0 acceptance criterion.

| #                                              | Decision                                                        | Status   |
| ---------------------------------------------- | --------------------------------------------------------------- | -------- |
| [0001](0001-four-live-node-families.md)        | Four live node families, eight Coming Soon                      | Accepted |
| [0002](0002-popularity-does-not-move-nodes.md) | Popularity affects size and glow, never position                | Accepted |
| [0003](0003-ring-one-recut.md)                 | Ring one is re-cut around destinations, not features            | Accepted |
| [0004](0004-web-before-native.md)              | Responsive web + PWA before native apps                         | Accepted |
| [0005](0005-payments-deferred.md)              | Payments deferred to month 4; enquiry-based revenue node in MVP | Accepted |
| [0006](0006-private-maps-not-scanned.md)       | Private maps are not content-scanned                            | Accepted |
| [0007](0007-page-watcher-scope.md)             | Page Watcher browses CDN community content only                 | Accepted |
| [0008](0008-frontend-stack.md)                 | Next.js + React + TypeScript + styled-components                | Accepted |

## Template

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNNN
**Date:** YYYY-MM-DD
**Phase:** Pn

## Context

What forced a decision. Include the constraint, not just the goal.

## Decision

What we are doing, in one paragraph, in the active voice.

## Consequences

What this makes easy. What this makes hard. What it costs to reverse later.

## Alternatives considered

What else was on the table and why it lost.
```
