# ADR-0001: Four live node families, eight Coming Soon

**Status:** Accepted
**Date:** 2026-08-31
**Phase:** P0

## Context

The product vision names twelve ring-one destinations and, in the source conversation, a hundred revenue nodes. The available team is two to three engineers over roughly twelve weeks. Building twelve functional destinations plus the map engine, accounts, sharing, collaboration, search and an AI ingestion feature in that window is not achievable, and attempting it produces twelve shallow features rather than four good ones.

The competing pressure is real and should not be dismissed: the scale of the network _is_ the pitch. A map showing four nodes does not communicate what CDN is.

## Decision

Render all twelve ring-one nodes. Make five functional (Mind Mapping, Link-to-Mind-Map, Page Watcher, Build With Us, Active Projects), covering three live families. The remaining eight ship as first-class **Coming Soon** destinations — a designed experience with a real description, an honest target window and working interest capture, not a greyed-out disabled state.

## Consequences

**Easy.** The full scale of the vision is visible from the first tap, so the demo and the launch story survive intact. The build stays finite and estimable. Every tap on a dark node becomes logged demand data, which turns the build order for months 4–6 into evidence rather than guesswork.

**Hard.** Some users will tap a dark node and be disappointed. The Coming Soon experience has to be good enough that it reads as a roadmap rather than a broken link — that is real design work, not a placeholder, and it is why it appears as artboard 4 in §25.

**Reversing it.** Cheap in one direction: each additional family can be lit up later without touching the map engine. Expensive in the other: lighting more families _now_ costs roughly 1.5 weeks each and pushes launch directly.

## Alternatives considered

- **Ship all twelve functional.** Rejected: not achievable in the window with this team.
- **Ship only the four live nodes on the map.** Rejected: destroys the scale that makes the product legible, and wastes the strongest asset in the reference designs.
- **Hide unbuilt nodes behind a "more coming" affordance.** Rejected: adds an interaction and loses the visual impact of the full ring, gaining nothing.

## Amendments

The decision above still stands; what has changed is which nodes are lit. The
record is kept here rather than by editing the text above, because the original
count is the reasoning's starting point and rewriting it would erase why the
split existed.

### 2026-09-09 — Freelance & Marketplace goes live (five → six)

The marketplace shipped: one framework, four catalogues, with the freelancing
catalogue raising an enquiry directly into the professional-services pipeline.
It has a destination a person can use, so it is no longer an honest Coming
Soon.

**The bar for lighting a node, made explicit.** This amendment is also the
place to write down the rule the seed tests already enforce, because it was
implicit and it caused confusion:

> A node is `active` when a tap on it reaches somewhere real — an `href`, or
> children. Not when the capability exists in the codebase.

That distinction matters more than it sounds. Phases 6 and 7 shipped a great
deal of capability that is genuinely usable and still sits behind nodes marked
SOON:

- **Commerce & Payments** — `product`, `order` and `invoice` node types exist
  and can be created on any map today; Stripe billing is live at
  `/settings/billing`. But the node's own promise is "wallets, payments,
  invoicing and reports", and there is no commerce destination.
- **Tasks & Projects** — `task` and `milestone` node types are creatable now.
  No tasks screen.
- **AI Tools** — the whole provider, prompt, embedding and assistant layer
  exists, and **none of it has a user interface**. There is no screen to send
  anyone to.
- **People & Networks**, **Ideas & Innovation**, **Partners & Sponsors** — no
  destination and no distinct capability.

Lighting any of those on the strength of the library code beneath them would
be claiming an unfinished feature is available, which is the specific thing
the Coming Soon design exists to avoid. They stay dark until they have a
screen.

### 2026-09-09 — Tasks & Projects and Commerce & Payments go live (six → eight)

Phase 7 shipped `task`, `milestone`, `product`, `order` and `invoice` as node
types, creatable on any map. By the rule written above they still could not be
lit, because a node type is not a destination: there was nowhere for a tap to
go, and no way to see your tasks when they were spread across six maps.

So the missing half was built — `/work` and `/commerce`, plus `/contacts` for
the CRM pair. Each is a **lens**, not an application:

- one query over the same `map_nodes` rows the map already draws, filtered by
  type, with every row linking back to its node on its own map;
- no tasks table, no second permission model, and deliberately no editing —
  a task is a node, and nodes are edited on the map where their context is.

That keeps faith with the roadmap's framing of these as "node type packages,
not separate applications". Three destinations share one repository and one
screen; what differs between them is a title and a list of type strings.

**One description was narrowed.** Commerce & Payments promised "Wallets,
payments, invoicing and reports". Wallets and reports do not exist, so the node
now reads "Track products, orders and invoices across your maps" — what it
actually opens. A live node whose description overshoots is a Coming Soon
promise wearing a live badge.

**Four remain dark**, and the reason is the same rule:

- **AI Tools** — the provider, prompt, embedding and assistant layer is
  complete and has **no user interface at all**. There is no screen to send
  anyone to, so it stays dark until there is one.
- **People & Networks**, **Ideas & Innovation**, **Partners & Sponsors** — no
  destination and no distinct capability behind them yet.
