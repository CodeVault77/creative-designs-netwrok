# MVP Scope Contract

**Status:** Ratified · **Date:** 2026-08-31 · **Phase:** P0

This is the P0 acceptance artifact: _"Written sign-off on MVP scope and the four live families."_
It is deliberately short. The reasoning lives in [`../CDN-MVP-IMPLEMENTATION-ROADMAP.md`](../CDN-MVP-IMPLEMENTATION-ROADMAP.md); this file is the thing you point at when someone asks for a feature mid-sprint.

---

## What we are building

A **spatial browser**. A persistent radial map where destinations, tools, people and a user's own notes occupy positions they can learn. The Community Map is shared public territory; a user map is private territory with the same physics.

## The four live node families

Everything else on ring one ships **visible but Coming Soon**, with working interest capture.

| #   | Ring-one node              | Family   | Status at launch |
| --- | -------------------------- | -------- | ---------------- |
| 1   | Mind Mapping               | Create   | **Live**         |
| 2   | Link-to-Mind-Map           | Create   | **Live**         |
| 3   | Page Watcher               | Discover | **Live**         |
| 4   | Build With Us              | Services | **Live**         |
| 5   | Active Projects            | Services | **Live**         |
| 6   | People & Networks          | People   | Coming Soon      |
| 7   | Freelance & Marketplace    | Services | Coming Soon      |
| 8   | AI Tools                   | Create   | Coming Soon      |
| 9   | Ideas & Innovation         | Discover | Coming Soon      |
| 10  | Tasks, Calendar & Projects | Organise | Coming Soon      |
| 11  | Commerce & Payments        | Commerce | Coming Soon      |
| 12  | Partners & Sponsors        | People   | Coming Soon      |

Live families: **Create, Discover, Services** functionally, with **People, Organise, Commerce** present as hue families on the map but with no live destinations.

## Counts we are holding to

| Thing                          | MVP number                              |
| ------------------------------ | --------------------------------------- |
| Shipping screens               | 22                                      |
| Ring-one nodes rendered        | 12                                      |
| Ring-one nodes functional      | 5                                       |
| Revenue nodes with a live path | 1 (enquiry-based)                       |
| AI features                    | 1 (Link-to-Mind-Map, single public URL) |
| Reusable components            | ~38                                     |

## Out of scope for the MVP — not negotiable without a written decision

Payments and subscriptions · the freelancer marketplace with escrow · 100 revenue nodes · the "limitless" node behaviour engine · multi-touch smartboard mode · native iOS/Android apps · AI agent orchestration · real-time multi-cursor co-editing · enterprise admin, white-labelling, analytics dashboards, plugin API, ad placement, in-map video.

Full reasoning and earliest realistic dates: §04 of the roadmap.

## How to change this contract

1. Open a PR editing this file **and** adding a record in `docs/decisions/`.
2. The PR needs approval from the product owner, not only a code reviewer.
3. State what is being **removed** to make room. Scope is a fixed budget; additions without subtractions move the launch date, and that trade should be made deliberately.

## Why this exists

§23 of the roadmap rates scope re-expansion as the highest-likelihood risk on the project, above every technical risk. The mitigation named there is this document. Its whole job is to make "can we just add…" a conversation with a written answer rather than a silent two weeks.
