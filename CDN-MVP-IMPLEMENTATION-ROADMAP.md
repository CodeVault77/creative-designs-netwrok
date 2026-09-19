# Creative Design Networks — MVP Design & Implementation Blueprint

**Version 1.1 · 2026-08-31**

Prepared against the uploaded reference screens (entry screen, central map, logo lockup) and the recorded product conversation.

Companion artifact, same content formatted for reading: <https://claude.ai/code/artifact/347811e8-96ee-4d2e-ba62-b22e4503b050>

---

## How to use this file

This is the implementation source of truth. Hand it back with an instruction naming a **phase** or a **screen number** and it carries enough detail to build from without a spec meeting.

| Want to build…             | Read                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| The design system / tokens | §16, §19                                                                              |
| The radial map renderer    | §09, §10, §17 (perf targets), §23 (risks)                                             |
| Any single screen          | §08 master table + §08 state matrix, then the section covering its flow               |
| A feature end to end       | §11 search · §12 Link-to-Mind-Map · §13 Page Watcher · §14 editor · §15 collaboration |
| The build order            | §20 phases → §21 three months → §22 six months                                        |
| To check "is it done?"     | §24                                                                                   |

### One vocabulary — there is only one plan

To avoid confusion, everything in this document is addressed by **one of three identifiers**, and they refer to the same single plan seen from different angles:

| Identifier        | Looks like | Means                                                                              | Defined in |
| ----------------- | ---------- | ---------------------------------------------------------------------------------- | ---------- |
| **Phase**         | `P0`–`P14` | A unit of work, with its own design, UX, engineering, acceptance criteria and risk | §20        |
| **Screen**        | `01`–`22`  | One screen in the product, with its states                                         | §08        |
| **Ring-one node** | `1`–`12`   | A destination on the Community Map                                                 | §03        |

There is **no separate design track running alongside the phases.** The artboards listed in §25 are the "Design + UX work" column of §20 — each artboard names the phase it belongs to. Design simply runs about two weeks ahead of the build for the same phase, which is why phase weeks in §20 overlap.

### Other conventions

- `Must` / `Should` / `Could` / `Defer` / `Coming Soon` — MoSCoW priority, defined in §04.
- `High` / `Med` — risk level.
- **Designed** = artboards and specs complete · **Prototyped** = clickable, testable, not production · **Built** = merged and working in staging · **Production-ready** = tested, accessible, monitored, live.
- Blockquotes labelled **ASSUMPTION** are decisions taken to keep the work moving; each states its consequence. All are listed for confirmation in §25.
- Blockquotes labelled **RESOLVING…** or **ON THE STATED GOAL…** flag a contradiction in the source requirements and propose a resolution.
- Ring-one node numbering (1–12) is stable and load-bearing: it is the spoken address, the deep-link path and the accessibility label. Do not renumber.

### Before implementation starts

Close the seven open decisions in §25. Each changes downstream design, and two of them reverse things stated in the original brief — the number of live node families, and popularity affecting node position.

---

## Contents

1. [Executive Summary](#1-executive-summary)
2. [Critical Analysis of the Reference Designs](#2-critical-analysis-of-the-reference-designs)
3. [Product Interpretation](#3-product-interpretation)
4. [MVP Definition](#4-mvp-definition)
5. [Feature Priority Matrix](#5-feature-priority-matrix)
6. [Information Architecture](#6-information-architecture)
7. [Core User Flows](#7-core-user-flows)
8. [Complete MVP Screen Inventory](#8-complete-mvp-screen-inventory)
9. [Central Radial Map Specification](#9-central-radial-map-specification)
10. [Node System Specification](#10-node-system-specification)
11. [Search UX](#11-search-ux)
12. [Link-to-Mind-Map UX](#12-link-to-mind-map-ux)
13. [Page Watcher UX](#13-page-watcher-ux)
14. [User-Created Maps UX](#14-user-created-maps-ux)
15. [Collaboration and Permissions](#15-collaboration-and-permissions)
16. [CDN Design System](#16-cdn-design-system)
17. [Responsive Design Strategy](#17-responsive-design-strategy)
18. [Component Architecture](#18-component-architecture)
19. [Design-to-Code Strategy](#19-design-to-code-strategy)
20. [Phase-by-Phase Implementation Roadmap](#20-phase-by-phase-implementation-roadmap)
21. [Three-Month Roadmap](#21-three-month-roadmap)
22. [Six-Month Roadmap](#22-six-month-roadmap)
23. [Risks and Technical Challenges](#23-risks-and-technical-challenges)
24. [MVP Acceptance Criteria](#24-mvp-acceptance-criteria)
25. [Next Steps and Open Decisions](#25-next-steps-and-open-decisions)

## 1. Executive Summary

The uploaded screens already contain a real product. The infinity mark, the black ground, the twelve hue-coded satellites orbiting a lit central ring — that is a visual identity most startups never find. It should be preserved almost intact. What it does **not** yet contain is an interface: the reference is a picture of a map, and CDN needs a map that is _operated_.

The gap between those two things is the whole job, and it is smaller than it looks. Three changes convert the poster into a product:

1. **Hue must carry meaning.** Twelve nodes in twelve hues means colour encodes nothing but position. Collapse to six domain families, and colour becomes a navigational instrument that survives 500 nodes.
2. **The centre must shrink.** The brand lockup occupies roughly a third of the canvas. In the product, the centre is a 96 px home node with the mark inside it, and the reclaimed space becomes ring two.
3. **Labels must be earned, not printed.** Four-line captions under every satellite are unreadable at 390 px and impossible at ring three. Labels appear by zoom tier and by focus, never all at once.

On scope: the recorded plan — one hundred revenue nodes, an infinite canvas, full collaboration, AI ingestion and marketplace, delivered in a single month by a small team — is not deliverable. It is not close. This blueprint replaces it with a scope that is: **four live node families out of twelve, twenty-two screens, one showcase AI feature, and a hard cut on everything else**, shipped over ninety days with the remaining eight families visible on the map as first-class _Coming Soon_ destinations that collect email interest. The scale of the vision stays fully visible to the user. The build stays finite.

> **THE SINGLE MOST IMPORTANT DECISION IN THIS DOCUMENT**
>
> Ship the _whole twelve-node map_ visually and only four families functionally. This is the only way to keep the "wow" of the reference screen while keeping the MVP buildable, and it converts unfinished scope from a liability into a demand signal — every tap on a dark node is a logged vote for what to build next.

**What a user can actually do at launch**

Enter the map. Pan, zoom, expand and collapse rings, walk layers forward and backward. Search and see results rendered as a map. Create their own mind map, edit nodes, save it to their account, share it by link with public / private / node-viewable controls, invite collaborators with roles, and chat inside the map. Paste one URL and get a generated mind map back. Open Page Watcher, pick interests, and browse the community. Everything else is honest scaffolding.

---

## 2. Critical Analysis of the Reference Designs

### What is working extremely well — preserve

- **The centre-as-home metaphor.** A single lit ring containing the brand mark is instantly legible as "you are here, everything radiates from here." Very few products get a spatial home that strong.
- **The lit ring itself.** The multi-hue circular sweep around the centre is the most ownable element in the whole identity — more ownable than the infinity mark, which reads as generic at small sizes. Keep the ring as the permanent signature of the centre and of any map root.
- **Radial-with-connectors, not a floating cloud.** Drawing an explicit line from centre to each satellite, with a small terminal dot at each end, communicates the graph relationship rather than merely decorating. Keep the connectors and the terminal dots — they become the anchor for edge states later (active, pending, permission-blocked).
- **Pure black ground with depth haze.** The faint violet network texture at the base of screen one gives depth without noise, and pure black is genuinely correct here: it makes neon read as emission rather than as pigment, and it is cheap on OLED.
- **Numbered satellites.** The 1–12 numbering is not decoration — it gives every node a stable spoken and written address ("open 7"), which will matter enormously for support, deep links, and accessibility.
- **The "You are in: Central Node" pill.** Correct instinct, wrong weight. This is the seed of the breadcrumb system in §09.

### What must change

| Observed                                    | Problem                                                                                                                                | Change                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **12 distinct hues, one per node**          | Colour carries zero information. At ring 3 with 60+ nodes it becomes visual noise, and no user can learn 12 hue–meaning pairs.         | Six **domain families**, each with one hue. Nodes inherit family hue; ring depth modulates luminance, not hue.                       |
| **Full brand lockup at centre**             | Consumes ~35% of a 390×844 canvas. Leaves no room for ring 2 without zooming out past legibility.                                      | Centre becomes a 96 px **home node**: lit ring + infinity glyph only. Wordmark lives in the top bar.                                 |
| **3–4 line caption under every node**       | ~9 px effective type on mobile; captions collide between adjacent satellites; unreadable and untranslatable.                           | Label = name only, one line, max 18 chars, truncating. Description moves to the node detail sheet. Labels render by zoom tier (§09). |
| **"Tap to enter" splash**                   | A full screen of friction on every cold start for a product whose value _is_ the map. Returning users pay it daily.                    | First-run only, and as a ≤1.2 s load transition that resolves into the map. Never a gate for a returning session.                    |
| **5-tab bottom nav with centre Create FAB** | A generic social-app chrome bolted onto a spatial product. It duplicates the map's own `+` FAB, and "Home / Explore" are both the map. | Four tabs: **Map · Search · My Maps · You**. One create affordance, owned by the map surface.                                        |
| **Both a bottom nav and a floating `+`**    | Two competing primary actions, ~14 px apart in the thumb zone.                                                                         | Remove the tab-bar Create. Keep the FAB, which is contextual to the current map.                                                     |
| **"Customize Your Map" pill**               | Ambiguous — customise appearance, or contents, or which nodes show? Sits at the highest-value screen position.                         | Replace with the **Lens** control (§09): a named view-state switcher (All · Active only · Trending · Mine).                          |
| **Uniform glow on every node**              | If everything glows, glow means nothing, and the frame cost is paid on every node.                                                     | Glow becomes the **state channel**: full glow = active/selected, soft = available, none = inactive, dashed no-glow = Coming Soon.    |

### Usability problems

- **No way back.** The screens show entry and expansion but no return path. In a zoomable canvas, users get lost within about three interactions. Requires: breadcrumb trail, `Recentre`, and layer forward/back — all three, not one.
- **Tap target vs. label mismatch.** The visible circle is ~64 px but the caption below is what users read and aim at. Hit area must be a single invisible ~88 px capsule enclosing circle _and_ label.
- **Ambiguous tap semantics.** Does tapping a node expand it, open it, or select it? Undefined in the reference. Specified in §10: tap = select + peek; second tap or sheet CTA = open; long-press / double-tap = expand ring.
- **Popularity re-sorting destroys spatial memory.** The recorded requirement is that popular nodes automatically pull toward the centre. That directly conflicts with the map being learnable — if node 7 moves every week, muscle memory never forms. See the resolution in §09.

### Mobile problems

- Twelve satellites on a 390 px width forces a ~150 px orbit radius; with 88 px targets the ring is over-subscribed and adjacent hit areas overlap. Mobile ring 1 must cap at **8 visible satellites**, with the remainder reachable by ring rotation or the list view.
- Pinch-zoom on a canvas fights the browser's own page zoom and iOS Safari's double-tap zoom unless `touch-action` is set explicitly on the canvas element and only there.
- The map's centre of gravity sits under the notch/dynamic island in screen 2. Safe-area insets must be real tokens, not guesses.
- Bottom sheet + bottom nav + home indicator stack to ~180 px of dead vertical space on the detail state.

### Desktop problems

- A mobile radial map scaled to 1440 px leaves enormous empty margins. Desktop needs a genuinely different composition: map centred in a canvas region with a **persistent right inspector panel** (360 px) replacing the bottom sheet, and the breadcrumb promoted to a top-left rail.
- No hover states exist in the reference at all. Desktop needs hover peek (label + one-line description on the connector), cursor affordances, and edge highlighting.
- No keyboard model. A radial canvas with no keyboard navigation is unusable for a meaningful share of users and unauditable for accessibility.

### Accessibility problems `Highest legal + reach risk`

- **Thin neon strokes on black.** A 1–2 px high-chroma stroke may pass a contrast-ratio calculation while being effectively invisible to low-vision users. Node borders need a minimum 2 px stroke plus an inner fill tint at ≥20% opacity so shape, not just edge, carries the node.
- **Saturated cyan/magenta text on pure black** causes chromatic aberration and halation, particularly for astigmatism. Node _labels_ must be near-white (`#EDEEF7`), never the node's hue. Hue lives in the ring, the glow and the connector only.
- **Colour as sole state channel.** Coming Soon vs. active must also differ in stroke style (dashed vs. solid) and carry a text badge in the detail sheet.
- **A radial canvas has no reading order.** This is the structural issue. The mitigation is not ARIA sprinkled on a canvas — it is a **parallel tree view** (§09) that renders the same data as a semantic nested list, toggleable by anyone, and used as the screen-reader and no-JS representation. It also gives you crawlable HTML for SEO and a low-end-device fallback. Build it in Phase 3, not as a retrofit.
- Motion: orbit drift, pulse and glow breathing must all be gated behind `prefers-reduced-motion`.

### Performance problems

- **CSS `box-shadow` and `filter: blur()` per node will not survive.** Each glow is an off-screen composite; 60 of them on a mid-range Android during a pinch gesture drops the map to single-digit frames. Glow must be pre-baked — a radial-gradient sprite drawn to canvas, or a single WebGL pass — not a live filter per element.
- DOM nodes cannot be the rendering strategy past ~150 elements. Target: canvas or WebGL renderer with DOM used only for the focused node's label and the panels.
- Connector lines with glow are the second cost centre; render them as a single batched path per family, not per edge.
- The starfield/network background must be a static image or one cheap shader, never animated particles.

### Information-architecture problems

- The twelve categories are **tool categories, not user goals**. "Analytics & Reports" and "Cloud & Storage" are features of a platform, not destinations a person navigates to. This makes the map look like a feature inventory rather than a place. §03 regroups them.
- Several named MVP features have no home in the twelve: Page Watcher, Freelancing, Active Projects, Partners & Sponsors, Community Map, Link-to-Mind-Map. Ring one must be re-cut to hold them.
- The Community Map and a user's own map are shown as the same surface, but they have entirely different permission models and must be visually distinguishable at a glance.

### Essential identity vs. decoration

| Element                               | Verdict        | Reasoning                                                                                                      |
| ------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| Lit multi-hue ring around centre      | `Essential`    | The single most ownable mark. Signature of any map root.                                                       |
| Pure black ground                     | `Essential`    | Makes neon read as emission. Also the cheapest ground for OLED and for glow compositing.                       |
| Radial layout with visible connectors | `Essential`    | It is the product, not a style.                                                                                |
| Circular node with icon inside        | `Essential`    | Scales, rotates and clusters better than cards. Keep.                                                          |
| Numbered nodes                        | `Essential`    | Stable addressing. Unexpectedly load-bearing.                                                                  |
| Infinity mark                         | `Keep, demote` | Works in the top bar and as the centre glyph; illegible below 32 px. Needs a simplified single-stroke variant. |
| Per-node unique hue                   | `Decorative`   | Actively harmful at scale. Replace with family hues.                                                           |
| Multi-line node captions              | `Decorative`   | Poster typography. Does not survive the interface.                                                             |
| Gradient wordmark (3 hues, 3 lines)   | `Decorative`   | Beautiful as a logo, unusable as UI chrome. One-line lockup for the app.                                       |
| Ambient particle/starfield            | `Decorative`   | Keep as a static texture at low opacity. Never animate it.                                                     |

---

## 3. Product Interpretation

Stated plainly, so that scope arguments have something to resolve against:

> **WORKING DEFINITION**
>
> **CDN is a spatial browser.** Where a conventional browser gives you one page at a time and hides structure in tabs and history, CDN gives you a persistent map where destinations, tools, people and your own notes occupy fixed positions you can learn. The Community Map is the shared public territory. A user map is private territory with the same physics.

Two products live inside that definition and they have different users:

| Surface                       | User                 | Job                                                             | Success signal                            |
| ----------------------------- | -------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| **Community Map** (discovery) | Visitor, new user    | See the scale of CDN; find a service, project or community page | Reaches a live destination inside 3 taps  |
| **My Maps** (creation)        | Returning, signed-in | Build, save, share and co-edit their own map                    | Creates a map and shares it within week 1 |

The MVP must be excellent at both, and the discovery surface is what sells the creation surface. That ordering drives the build order in §20.

### Ring one, re-cut

The reference's twelve are regrouped into **six domain families** (which own the hues) containing **twelve ring-one destinations** (which keep the numbering and the visual richness). Four families ship live.

| #   | Ring-one node                                         | Family   | Hue     | MVP status    |
| --- | ----------------------------------------------------- | -------- | ------- | ------------- |
| 1   | **Mind Mapping** — create & open your maps            | Create   | Lime    | `Live`        |
| 2   | **Link-to-Mind-Map** — paste a URL, get a map         | Create   | Lime    | `Live`        |
| 3   | **Page Watcher** — interest-led community browsing    | Discover | Cyan    | `Live`        |
| 4   | **Build With Us** — full-stack, web, mobile, game dev | Services | Orange  | `Live`        |
| 5   | **Active Projects** — live portfolio of CDN work      | Services | Orange  | `Live`        |
| 6   | **People & Networks** — profiles, follows             | People   | Magenta | `Coming Soon` |
| 7   | **Freelance & Marketplace**                           | Services | Orange  | `Coming Soon` |
| 8   | **AI Tools** — paid AI capabilities                   | Create   | Lime    | `Coming Soon` |
| 9   | **Ideas & Innovation**                                | Discover | Cyan    | `Coming Soon` |
| 10  | **Tasks, Calendar & Projects**                        | Organise | Violet  | `Coming Soon` |
| 11  | **Commerce & Payments**                               | Commerce | Teal    | `Coming Soon` |
| 12  | **Partners & Sponsors**                               | People   | Magenta | `Coming Soon` |

> **ASSUMPTION**
>
> Cloud & Storage, Analytics & Reports, Apps & Integrations and Marketing & Automation are removed from ring one. They are _platform capabilities_, not destinations — storage is implicit in saving a map, analytics belongs in a map's own panel. Consequence: ring one becomes twelve _places a person would go_ rather than a systems diagram. If you disagree, they return as ring-two children of Organise and cost nothing.

---

## 4. MVP Definition

The test applied to every line below: _does removing this stop a user completing "enter → find something → make something → share it"?_ If not, it is not MVP.

### Must have

- Radial Community Map: centre + ring one + ring two, pan, pinch/scroll zoom, expand, collapse.
- Layer forward / backward navigation and breadcrumb; `Recentre`.
- Parallel tree view (accessibility, low-end devices, SEO).
- Node select, node detail sheet/panel, node open, node deep link (`cdn.app/n/<id>`).
- Coming Soon node state with interest capture.
- Global search → list results _and_ map-rendered results; return to prior map state.
- Accounts: email + OAuth, session, profile basics.
- Map creator: create, add / edit / delete / connect / move nodes, undo, autosave, rename, duplicate.
- Cloud save of user maps; My Maps list.
- Share: link, with **Private / Link-viewable / Public** and the **node-viewable** toggle.
- Collaborators: invite by email/link, roles (Owner, Admin, Editor, Commenter, Viewer), remove, transfer admin.
- Map chat (per-map thread, text only).
- Link-to-Mind-Map: single URL → generated node structure → edit → save.
- Page Watcher: interest selection → Go → content feed → open / save / create node from item.
- Notifications: invites, role changes, chat mentions.
- Trust & safety: report node/map/user, moderation queue, automated text screening, blocklist, ToS gate on publish.
- Revenue node experience: service detail page + enquiry form, for _Build With Us_.

### Should have

- Lens switcher (All / Active only / Trending / Mine).
- Presence avatars on collaborative maps.
- Activity log per map.
- Map templates (3–5 starters).
- Node types beyond default: link, note, image, date. (Not the "limitless" node engine.)
- Export map as PNG.

### Could have

- Comments pinned to a node.
- Search filters by family and by node type.
- Map thumbnails auto-generated for the My Maps grid.
- Keyboard-only map traversal on desktop.

### Visible but Coming Soon

All eight non-live ring-one nodes, plus the ring-two children under them. Tapping opens a real sheet: what it will do, an honest target window, and _Notify me_. This is a designed experience, not a disabled state — see screen 22.

### Explicitly deferred

| Deferred                             | Why                                                                                                                | Earliest                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 100 revenue nodes                    | Each needs pricing, copy, fulfilment and support. One done well beats 100 hollow.                                  | Month 4+, incrementally |
| Payments / Stripe / subscriptions    | No paid feature exists yet to gate. Enquiry form converts fine at this stage.                                      | Month 4                 |
| Freelancer marketplace with escrow   | Two-sided market + money handling + disputes. Larger than the rest of the MVP combined.                            | Month 5–6               |
| "Limitless" node behaviour engine    | A node that can be a calendar, CRM, storefront and workflow is a plugin platform. Needs a stable core first.       | Month 6+                |
| Multi-touch smartboard (20/40/60 pt) | Real, valuable, and pointless before the single-pointer canvas is solid. Design for it now (§17); implement later. | Month 5–6               |
| Native iOS / Android apps            | Responsive web + PWA covers MVP validation at a fraction of the cost.                                              | Post-validation         |
| AI agent orchestration               | Vision-tier. One AI feature done well (Link-to-Mind-Map) proves the thesis.                                        | Month 6+                |
| Real-time multi-cursor co-editing    | CRDT infrastructure. MVP uses node-level locking + refresh, which is honest and sufficient for 2–5 collaborators.  | Month 4–5               |

### Do not design yet

Enterprise admin console, white-label theming, analytics dashboards, developer/plugin API surface, ad or sponsorship placement UI, in-map video calls, mobile-native onboarding. Designing these now produces work that will be thrown away when the core model shifts — and the core model _will_ shift after the first fifty real users.

---

## 5. Feature Priority Matrix

Value and cost are relative, 1–5. "Build" is the phase from §20.

| Feature                                 | Priority | Value | Cost | Build | Depends on           |
| --------------------------------------- | -------- | ----- | ---- | ----- | -------------------- |
| **Design system + tokens**              | `Must`   | 5     | 2    | P1    | —                    |
| **Canvas renderer (pan/zoom/hit-test)** | `Must`   | 5     | 5    | P3    | Tokens, node schema  |
| **Radial layout engine**                | `Must`   | 5     | 4    | P3    | Renderer             |
| **Layer fwd/back + breadcrumb**         | `Must`   | 5     | 2    | P3    | Layout engine        |
| **Tree view (a11y parallel)**           | `Must`   | 4     | 2    | P3    | Node schema          |
| **Node detail panel**                   | `Must`   | 5     | 2    | P4    | Renderer             |
| **Coming Soon experience**              | `Must`   | 4     | 1    | P4    | Node states          |
| **Node deep links**                     | `Must`   | 4     | 2    | P4    | Routing              |
| **Accounts + auth**                     | `Must`   | 5     | 2    | P6    | Backend              |
| **Map creator / editor**                | `Must`   | 5     | 5    | P5    | Renderer, schema     |
| **Cloud save + My Maps**                | `Must`   | 5     | 3    | P6    | Auth, DB             |
| **Share + privacy + node-viewable**     | `Must`   | 5     | 3    | P7    | Cloud save           |
| **Roles & invites**                     | `Must`   | 4     | 4    | P7    | Auth, sharing        |
| **Global search + map results**         | `Must`   | 5     | 3    | P8    | Index, layout engine |
| **Link-to-Mind-Map**                    | `Must`   | 5     | 3    | P9    | LLM, fetcher, editor |
| **Page Watcher**                        | `Must`   | 3     | 3    | P10   | Content model, tags  |
| **Map chat**                            | `Must`   | 3     | 3    | P11   | Roles, realtime      |
| **Moderation + reporting**              | `Must`   | 4     | 3    | P13   | Content model        |
| **Build With Us service node**          | `Must`   | 5     | 1    | P12   | Node detail          |
| Lens switcher                           | `Should` | 3     | 2    | P4    | Layout engine        |
| Presence + activity                     | `Should` | 3     | 3    | P11   | Realtime             |
| Templates                               | `Should` | 3     | 1    | P5    | Editor               |
| Extra node types                        | `Should` | 3     | 3    | P5    | Schema               |
| PNG export                              | `Could`  | 2     | 2    | P8    | Renderer             |
| Node comments                           | `Could`  | 2     | 3    | P11   | Chat                 |
| Keyboard traversal                      | `Could`  | 3     | 2    | P13   | Tree view            |
| Payments                                | `Defer`  | 4     | 4    | M4    | Paid surface         |
| Marketplace                             | `Defer`  | 4     | 5    | M5    | Payments, trust      |
| Node behaviour engine                   | `Defer`  | 5     | 5    | M6    | Stable core          |
| Multi-touch board                       | `Defer`  | 3     | 4    | M5    | Canvas maturity      |

---

## 6. Information Architecture

**Primary navigation — 4 tabs, mobile**

| Tab         | Lands on                | Holds                                                                                                       |
| ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Map**     | Community Map at centre | The whole radial experience, node details, Coming Soon, service nodes, Page Watcher, Link-to-Mind-Map entry |
| **Search**  | Search field, focused   | Suggestions, filters, list results, map results                                                             |
| **My Maps** | Grid of the user's maps | Create, open editor, shared-with-me, templates                                                              |
| **You**     | Profile                 | Account, notifications, settings, saved items, moderation (if staff)                                        |

On desktop these become a left icon rail; the map region gains a right inspector panel.

**Secondary navigation — on-map, always available**

- **Breadcrumb** (top): `CDN › Create › Mind Mapping`, each segment tappable.
- **Layer stepper** (left edge): `⟨` outward / `⟩` inward — pulls an outer ring into the centre position without gesture work.
- **Zoom + Recentre** (right edge): `+` / `−` / `⌖`.
- **Lens** (bottom-left pill): All · Active only · Trending · Mine.
- **View toggle**: Map ↔ Tree.
- **Create FAB** (bottom-right): context-aware — on Community Map it starts a new map; inside your own map it adds a node.

**Content hierarchy**

| Level | Entity                                     | Cardinality at MVP                      |
| ----- | ------------------------------------------ | --------------------------------------- |
| 0     | Centre node (map root)                     | 1 per map                               |
| 1     | Ring-one destinations                      | 12 (Community), 3–8 typical (user maps) |
| 2     | Ring-two children                          | 4–8 per parent, ~60 total               |
| 3     | Leaf nodes — links, notes, services, pages | Unbounded, rendered by cluster (§09)    |

**Map spaces**

| Space                 | Owner        | Who edits             | Visual signature                               |
| --------------------- | ------------ | --------------------- | ---------------------------------------------- |
| **Community Map**     | CDN          | CDN staff admins only | Full-spectrum lit centre ring                  |
| **My Map**            | A user       | Owner + invited roles | Single-hue centre ring, owner avatar at centre |
| **Shared with me**    | Another user | Per assigned role     | Centre ring + collaborator badge               |
| **Search result map** | Ephemeral    | Nobody                | Dashed centre ring, "Results for …" at centre  |

**Account, settings, admin**

- **You** → Profile (name, handle, avatar, bio, public maps) · Notifications · Saved · Settings.
- **Settings** → Account · Privacy defaults · Notification prefs · Appearance (motion, glow intensity, tree-view default) · Blocked users · Data & deletion.
- **Admin** (staff only, hidden otherwise) → Moderation queue · Reports · Community Map editing · Coming Soon interest counts.
- **Map-level admin** (per map, owner/admin) → Collaborators · Roles · Privacy · Activity · Danger zone.

---

## 7. Core User Flows

Seven flows. Everything in the screen inventory serves one of them; anything that serves none was cut.

**F1 — First visit to arrival `Critical path`**

Load (branded transition ≤1.2 s) → Community Map, centre + ring one, gentle stagger-in → a one-time coach overlay names three gestures and dismisses on first touch → tap a node → detail sheet → _Open_ → destination. **Target: reach a live destination in ≤3 taps, ≤25 s.**

**F2 — Explore into depth and get back**

Tap node → long-press or _Expand_ → ring two blooms, parent re-anchors toward centre, breadcrumb gains a segment → pan/zoom freely → return via breadcrumb tap, layer stepper, or _Recentre_. **Rule: no state is reachable that cannot be exited in one tap.**

**F3 — Search as navigation**

Tap Search → type → live suggestions grouped by Nodes / Maps / People / Pages → Enter → results as list, with a _See as map_ toggle → result map renders with the query at centre → open a result → _Back to your map_ restores the exact prior camera and expansion state.

**F4 — Create, save, share `Critical path`**

My Maps → _New map_ → name + choose blank or template → editor opens with centre node in edit state → add nodes (FAB, double-tap canvas, or Enter/Tab on desktop) → autosave from the first change → _Share_ → choose visibility + node-viewable → copy link. **Target: blank to shared link in ≤3 minutes.**

**F5 — Invite and collaborate**

Share sheet → _Invite people_ → email or link, pick role → invitee gets notification + email → accepts → map appears in Shared with me → edits per role → map chat for coordination → owner reviews Activity, promotes to Admin or removes.

**F6 — Link-to-Mind-Map `Showcase`**

Ring-one node 2, or the editor toolbar → paste URL → inline validation → processing with visible stages → preview of proposed structure, already laid out radially → edit / drop / merge nodes → _Create map_ → saved to My Maps with source attribution on every node.

**F7 — Page Watcher**

Ring-one node 3 → interest chips (multi-select, remembered) → _Go_ → vertical card feed of community pages → open, save, or _Add to map_ → picker chooses target map → toast confirms and offers _View in map_.

---

## 8. Complete MVP Screen Inventory

Twenty-two screens ship. The reference list of 24 collapses: _Expanded radial map_, _Selected node state_ and _Node detail panel_ are **states of one screen**, not screens — treating them as separate is how design files bloat and how engineers end up building three components where one belongs. _Save map_ is a system behaviour (autosave) with a toast, not a screen.

**Master inventory**

| #   | Screen                 | Purpose                                     | Entry                             | Primary CTA     | Key components                                                                                   |
| --- | ---------------------- | ------------------------------------------- | --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| 01  | **Entry transition**   | Brand moment; preload map data              | Cold start, first run             | (auto-resolves) | LitRing, Wordmark, ProgressWhisper                                                               |
| 02  | **Community Map**      | The product. Browse the network             | Map tab, logo, deep link          | Tap a node      | MapCanvas, NodeMarker, Breadcrumb, LayerStepper, ZoomControls, LensPill, FAB                     |
| 03  | **Node detail**        | Explain a node, offer its actions           | Node tap, deep link               | Open / Expand   | DetailSheet (mobile) / InspectorPanel (desktop), NodeHeader, ActionRow, MetaList, ShareButton    |
| 04  | **Tree view**          | Accessible, scannable equivalent of the map | View toggle, screen reader, no-JS | Open a node     | TreeList, TreeRow, FamilyDot, ExpandChevron                                                      |
| 05  | **Search**             | Find anything; second navigation model      | Search tab, map search icon, `/`  | Submit query    | SearchField, SuggestionGroup, RecentChips, FilterBar                                             |
| 06  | **Search results**     | Show matches as list or map                 | From 05                           | Open result     | ResultCard, ViewToggle, ResultMap, FilterBar, BackToMapBar                                       |
| 07  | **My Maps**            | Own and shared maps                         | My Maps tab                       | New map         | MapCard, TabSegment (Mine/Shared), EmptyState, SortMenu                                          |
| 08  | **New map**            | Name it, choose a starting point            | New map, FAB                      | Create map      | Modal, TextField, TemplateTile, VisibilityPicker                                                 |
| 09  | **Map editor**         | Build and arrange a map                     | Open own map                      | Add node        | MapCanvas(edit), EditToolbar, NodeMarker(editable), SelectionHandles, UndoBar, SaveIndicator     |
| 10  | **Node editor**        | Set a node's content and behaviour          | Add/edit node in 09               | Done            | DetailSheet(edit), TextField, TypePicker, IconPicker, ColorFamilyPicker, LinkField, DeleteAction |
| 11  | **Share map**          | Produce a link with the right exposure      | Share in 09 / 07                  | Copy link       | ShareSheet, VisibilityPicker, NodeViewableToggle, LinkRow, InviteEntry, PreviewAs                |
| 12  | **Collaborators**      | Who has access and at what level            | Share sheet, map menu             | Invite          | PersonRow, RoleMenu, PendingInvite, RoleLegend, TransferOwnership                                |
| 13  | **Map chat**           | Coordinate without leaving the map          | Chat icon on a shared map         | Send            | ChatPanel, MessageBubble, Composer, PresenceStack, NodeMentionChip                               |
| 14  | **Link-to-Mind-Map**   | URL → generated map                         | Ring node 2, editor toolbar       | Create map      | UrlField, ProcessStages, StructurePreview, NodeChecklist, RegenerateButton                       |
| 15  | **Page Watcher setup** | Pick interests                              | Ring node 3                       | Go              | InterestChipGrid, SelectedCount, RememberToggle                                                  |
| 16  | **Page Watcher feed**  | Browse matched community content            | From 15                           | Open item       | ContentCard, SaveAction, AddToMapAction, FilterBar, InfiniteList                                 |
| 17  | **Service node**       | Sell a service; capture enquiries           | Ring node 4 / 5                   | Start a project | ServiceHero, CapabilityList, WorkGrid, EnquiryForm, TrustRow                                     |
| 18  | **Profile**            | Identity + public maps                      | You tab, avatar tap               | Edit profile    | ProfileHeader, MapCard grid, FollowButton (soon), ReportAction                                   |
| 19  | **Notifications**      | Invites, roles, mentions                    | Bell, You tab                     | Accept invite   | NotificationRow, InlineAcceptDecline, EmptyState, MarkAllRead                                    |
| 20  | **Settings**           | Account, privacy, appearance                | You tab                           | Save            | SettingsGroup, ToggleRow, SelectRow, DangerZone                                                  |
| 21  | **Moderation**         | Review reports; act                         | Staff-only route                  | Resolve         | ReportQueue, ReportCard, ActionBar, AuditTrail, FilterBar                                        |
| 22  | **Coming Soon**        | Honest placeholder that captures demand     | Tap an inactive node              | Notify me       | DetailSheet(soon), SoonBadge, TargetWindow, InterestButton, RelatedLiveNodes                     |

**Secondary actions & navigation targets**

| #   | Secondary actions                                                       | Goes to        |
| --- | ----------------------------------------------------------------------- | -------------- |
| 02  | Search, expand, collapse, recentre, lens, tree toggle, share map        | 03, 04, 05, 08 |
| 03  | Share node link, copy, report, add to my map, collapse                  | 02, 11, 17, 22 |
| 06  | Filter, switch view, clear, back to prior map state                     | 02, 03, 18     |
| 07  | Rename, duplicate, share, delete, sort, open shared tab                 | 09, 11         |
| 09  | Undo/redo, delete, connect, rearrange, chat, collaborators, share, exit | 10, 11, 12, 13 |
| 11  | Manage collaborators, preview as viewer, revoke link                    | 12             |
| 12  | Change role, remove, resend invite, transfer ownership                  | —              |
| 14  | Edit node, remove node, regenerate, change depth, cancel                | 09, 07         |
| 16  | Save, add to map, share, change interests, report                       | 15, 09, 21     |
| 22  | Notify me, see related live nodes, back to map                          | 02             |

**State matrix — every screen, every required state**

| #   | Loading                                                                                     | Empty                                                           | Error                                                                   | Permission                                                                       | Coming Soon                                            |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 02  | Centre ring draws first, satellites fade in staggered 40 ms; skeleton orbits at 12% opacity | n/a — Community Map always has content                          | "Can't reach the network." Cached map + Retry                           | n/a                                                                              | 8 of 12 nodes render dashed, unglowed                  |
| 03  | Sheet opens instantly with title from map data; body shimmers                               | Node with no description shows type + link only                 | "Details didn't load." Retry inline; sheet stays open                   | Private node: lock icon, "Ask the owner for access"                              | Swaps to the 22 variant                                |
| 04  | Row skeletons                                                                               | "Nothing under this branch yet."                                | Inline retry row                                                        | Restricted rows shown as locked, not hidden (structure isn't secret; content is) | Row shows Soon badge                                   |
| 05  | Suggestion shimmer after 150 ms only                                                        | Recent + suggested families                                     | "Search is having trouble." Retry                                       | n/a                                                                              | Filters for unbuilt types hidden                       |
| 06  | Result skeletons; map view shows pulsing centre                                             | "No matches for 'x'." Nearest families + Clear filters + Ask AI | Partial results + "Some sources unavailable"                            | Private results excluded silently, never teased                                  | n/a                                                    |
| 07  | Card skeletons                                                                              | Illustration + "Your first map starts with one idea." → New map | "Couldn't load your maps." Retry                                        | Signed out: sign-in prompt with value copy                                       | n/a                                                    |
| 08  | Button spinner on create                                                                    | n/a                                                             | Name conflict inline; network error keeps the modal and the input       | Map quota reached (if any)                                                       | Locked templates carry Soon badge                      |
| 09  | Canvas fades in from saved camera                                                           | Fresh map: centre node in edit state + "Add your first branch"  | Save failure → persistent amber bar, local buffer retained, Retry       | Viewer role: read-only chrome, edit tools absent (not greyed)                    | Node types not yet built hidden from picker            |
| 10  | n/a (local)                                                                                 | Placeholder copy in fields                                      | Field-level validation                                                  | Commenter: comment field only                                                    | Behaviour options beyond MVP marked Soon in the picker |
| 11  | Link generation spinner                                                                     | n/a                                                             | "Couldn't create the link." Retry                                       | Editor sees share but cannot change visibility                                   | Team/domain sharing marked Soon                        |
| 12  | Row skeletons                                                                               | "Only you so far." → Invite                                     | Invalid email inline; send failure with Retry                           | Non-admins see the list read-only                                                | Groups marked Soon                                     |
| 13  | Message skeletons                                                                           | "No messages yet. Say hello."                                   | Failed send stays in composer with Retry                                | Viewer can read, not post; input replaced by explanatory line                    | Attachments, calls marked Soon                         |
| 14  | Four named stages: Fetching → Reading → Structuring → Laying out                            | Thin page: "Not much to work with." Offer manual create         | Unreachable / paywalled / blocked-by-robots: distinct message per cause | Signed-out users get 1 free run, then sign-in                                    | Multi-URL and PDF marked Soon                          |
| 15  | Chips fade in                                                                               | n/a                                                             | Retry loading interests                                                 | n/a                                                                              | Interests without content yet are dimmed with a count  |
| 16  | Card skeletons; infinite-scroll spinner                                                     | "Nothing here yet for those interests." → Broaden               | "Couldn't load more." Retry                                             | Private community content excluded                                               | Follow/subscribe marked Soon                           |
| 17  | Hero image progressive                                                                      | No case studies: capability list only                           | Form submit failure preserves entries                                   | n/a                                                                              | Pricing and checkout marked Soon; enquiry is live      |
| 18  | Header + card skeletons                                                                     | "No public maps yet."                                           | Retry                                                                   | Blocked user: minimal profile                                                    | Follows, badges marked Soon                            |
| 19  | Row skeletons                                                                               | "You're all caught up."                                         | Retry                                                                   | n/a                                                                              | Digest settings marked Soon                            |
| 20  | n/a                                                                                         | n/a                                                             | Per-field save error with revert                                        | OAuth-only accounts hide password row                                            | Data export marked Soon                                |
| 21  | Queue skeletons                                                                             | "Queue clear."                                                  | Action failure keeps item in queue                                      | Non-staff: 404, never 403 (do not confirm the route exists)                      | Automated-rule config marked Soon                      |
| 22  | n/a                                                                                         | n/a                                                             | Notify-me failure → inline retry                                        | Sign-in required to be notified                                                  | This screen _is_ the state                             |

---

## 9. Central Radial Map Specification

This is the section engineering should be able to build from without a meeting.

### Geometry

Polar layout. Ring _r_ has radius `R(r) = R0 + r × G`, with `R0 = 148`, `G = 132` at zoom 1.0 on mobile; `R0 = 190`, `G = 168` on desktop. Nodes within a ring occupy **fixed angular slots**: slot _i_ of _n_ sits at `θ = -90° + i × (360/n)`, so node 1 is always at twelve o'clock. Slots are assigned once and persisted. A node never moves because of engagement.

> **RESOLVING THE POPULARITY CONTRADICTION**
>
> The recorded requirement — popular nodes automatically pull toward the centre — would make position unstable, and position is the only thing a spatial interface has. **Resolution:** popularity is expressed as _size and glow intensity_ within a fixed slot (a hot node grows from 56 to 72 px and burns brighter), never as position. Users who want the sorted view get it explicitly through the **Trending lens**, which re-lays the map by rank and is visibly a temporary view — the lens pill stays lit and a _Back to layout_ control persists. Same insight, no loss of learnability, and it delivers the "least looked at" view for free as an inverted sort.

### Centre node behaviour

- 96 px mobile / 128 px desktop. Lit multi-hue ring, infinity glyph inside, label beneath.
- **Anchored, not fixed:** it pans with the canvas but the _Recentre_ control always returns to it in a 420 ms ease.
- Tap = collapse everything back to ring one (an instant "home"). Long-press = map info sheet.
- In a user map the centre carries the map name and the owner avatar; the ring uses the map's single chosen hue.
- When you descend, the centre does not vanish — the **focused parent slides into the centre position** and the true root becomes the first breadcrumb segment. This is the mechanism that makes infinite depth navigable on a small screen.

### Expanding and collapsing

| Action     | Mobile                                | Desktop                          | Result                                                                                        |
| ---------- | ------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| Select     | Tap                                   | Click                            | Node highlights, peek label, detail sheet/panel opens                                         |
| Open       | Tap CTA in sheet, or double-tap       | Enter, or CTA                    | Navigates to the node's destination screen                                                    |
| Expand     | Long-press 400 ms, or Expand in sheet | Double-click, or `→`             | Children bloom outward, 260 ms staggered 25 ms; parent slides toward centre; breadcrumb grows |
| Collapse   | Tap parent again                      | Click parent, or `←`             | Children retract into parent, 200 ms; breadcrumb pops                                         |
| Pan        | One-finger drag                       | Drag empty canvas, or space+drag | Camera translate, momentum with 0.92 friction                                                 |
| Zoom       | Pinch                                 | Scroll / `+` `−` / `⌘`+scroll    | Scale 0.35–2.4, anchored at gesture midpoint                                                  |
| Layer step | Stepper `⟨` `⟩`                       | Stepper, `PgUp`/`PgDn`           | Shifts which ring occupies the centre band, preserving zoom — the "visual telescope"          |

Only one branch expands at a time by default (accordion). Multi-expand is available on desktop with `⌘`+expand, and is off on mobile because it destroys the layout at that width.

### Zoom tiers — how labels and detail appear

| Tier     | Scale   | Node renders as             | Labels                           |
| -------- | ------- | --------------------------- | -------------------------------- |
| Overview | < 0.6   | Dot, family hue only, 12 px | Ring-one only; the rest on focus |
| Default  | 0.6–1.3 | Circle + icon, 56–64 px     | One line, 18 chars, truncating   |
| Detail   | 1.3–2.4 | Circle + icon + count badge | Two lines + node type            |

Below Overview scale, clusters replace individuals: a group of ≥6 sibling leaves collapses into one **cluster node** showing the count (`+24`), which expands on tap. This is the mechanism that keeps thousands of nodes usable, and it must be in the renderer from day one — retrofitting clustering means rewriting hit-testing.

### Keeping large maps usable

- **Cull** anything outside the viewport plus a 20% margin.
- **Cluster** siblings past 6 per parent at Overview scale.
- **Cap** simultaneous rendered nodes at 300; beyond that, deepest-first culling with a "zoom in to see more" whisper.
- **Dim** non-ancestor branches to 30% when a branch is focused — focus is the strongest density tool available and costs nothing.
- **Defer** glow rendering during active gestures: draw flat during pinch/pan, restore glow on gesture end. Users do not perceive the difference; the frame counter does.

### Selection, focus and detail

Selected node: white 2 px ring, 4 px outer halo, family glow at 100%, scale 1.08, and its connector to the parent brightens end to end. Ancestors stay at 70%; siblings drop to 40%; unrelated branches to 30%. Detail appears as a bottom sheet at 45% height (draggable to 90%) on mobile, and as a persistent 360 px right inspector on desktop — the same component, two presentations.

### Search transforms the map

Submitting a query does not navigate away. The camera eases out, matched nodes retain full glow while everything else drops to 15%, and matches from other branches are drawn into a temporary outer ring connected by dashed edges. A bar reads **"Showing 14 matches for 'patent'"** with _Clear_. Clearing restores the exact prior camera and expansion state — store it as a single snapshot object before the query runs.

### Future and disabled nodes

Dashed 2 px stroke, no glow, icon at 45% opacity, node hue desaturated toward the family's grey, and a small `SOON` badge on the upper-right of the circle. They remain fully tappable — tapping opens screen 22. They are never greyed to the point of looking broken, and never removed, because their presence _is_ the pitch.

---

## 10. Node System Specification

### Data shape

| Field                  | Type        | Notes                                                                                                                         |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | uuid        | Basis of the share URL `/n/<id>`                                                                                              |
| `map_id`, `parent_id`  | uuid        | Adjacency list; ring depth derived, not stored                                                                                |
| `slot`                 | int         | Fixed angular position among siblings                                                                                         |
| `title`, `description` | text        | Title capped at 60 chars; label truncates at 18 on canvas                                                                     |
| `family`               | enum        | create · discover · services · people · organise · commerce — drives hue                                                      |
| `type`                 | enum        | topic · link · note · image · date · service · page · cluster                                                                 |
| `status`               | enum        | active · inactive · coming_soon                                                                                               |
| `visibility`           | enum        | inherit · public · private — enables node-level privacy inside a shared map                                                   |
| `icon`, `payload`      | text, jsonb | `payload` is the forward-compatible slot for the eventual behaviour engine. Ship it empty rather than schema-migrating later. |
| `weight`               | float       | Popularity 0–1; drives size and glow only                                                                                     |

### Visual states

| State           | Treatment                              |
| --------------- | -------------------------------------- |
| **Root**        | Multi-hue lit ring 96 / 128 px         |
| **Active**      | 2px family stroke glow 55%, fill 5%    |
| **Selected**    | White ring + halo scale 1.08           |
| **Connected**   | Ancestor / sibling opacity 70 / 40%    |
| **Inactive**    | No glow, grey stroke still selectable  |
| **Coming Soon** | Dashed stroke orange, no glow          |
| **Private**     | Violet + lock badge owner-only content |
| **Admin-owned** | Lime accent staff / map admin          |

Every state differs in **at least two channels** (stroke style, glow, opacity, badge) so none depends on hue alone. Public nodes are simply the default — there is no "public" decoration, because decorating the norm makes the map noisy.

### Interaction contract

| Input          | Meaning                                      | Never                                                             |
| -------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Single tap     | Select + open detail                         | Never navigates away directly — too easy to trigger while panning |
| Long press     | Expand children (view) / context menu (edit) | Never deletes                                                     |
| Double tap     | Open destination                             | Never zooms — suppress browser default on the canvas only         |
| Drag node      | Reposition (edit mode only)                  | Never pans the canvas mid-drag                                    |
| Drag onto node | Connect / reparent (edit mode)               | Never silently reparents without a highlighted drop target        |

Touch targets are a minimum 88 px capsule enclosing circle and label, regardless of the drawn circle size — hit geometry is separate from visual geometry in the renderer.

---

## 11. Search UX

Search is the second navigation model, and for many users it will become the first. It deserves the same care as the map.

**Field and suggestions**

Persistent icon in the map top bar; full screen on tap (mobile) or an inline overlay (desktop, `/` to focus). Suggestions appear after 2 characters, debounced 180 ms, grouped and capped at 4 per group: **Nodes · Maps · People · Pages**. Each row shows a family dot, the title, and its breadcrumb path — path is what makes a result trustworthy in a spatial product. Above suggestions: recent searches as dismissible chips.

**Filters**

A single horizontal bar: _All_ · family chips · _Type_ · _Live only_. "Live only" is important — it lets a user exclude Coming Soon results, which will otherwise pollute early search badly.

**Results**

Default is a list of ResultCards: family dot, title, one-line snippet with matched terms emphasised, breadcrumb path, status chip. A prominent **See as map** toggle switches to the visual result map (§09) — the query text sits at the centre with a dashed ring, results occupy ring one sorted by relevance, and results sharing a parent are grouped into a shared arc with the parent named on the arc. This is the feature that makes search feel native to CDN rather than bolted on.

**Web search integration**

> **ASSUMPTION**
>
> External web search is _not_ in the MVP index. Instead, the results screen ends with one row: **"Not in CDN? Turn a web page into a map"**, which passes the query into Link-to-Mind-Map. This converts the empty-result moment into the showcase feature at zero index cost, and avoids owning a crawler in month one.

**Return path**

Every search entry captures a camera snapshot. The results screen carries a persistent bottom bar: **← Back to Central Node** (or the map name), restoring camera, zoom, expansion set and selection exactly. Without this, search becomes a trapdoor.

---

## 12. Link-to-Mind-Map UX

The single most demonstrable feature in the MVP. It must feel like magic and fail like an adult.

| Step                  | What the user sees                                                                            | Design notes                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **1. Open**           | Ring node 2, editor toolbar, or the search empty state                                        | Three entries, one screen. Also accept a URL pasted directly into search — detect and offer.              |
| **2. Paste**          | Large URL field, paste button, 2–3 example links                                              | Examples matter: they set expectations about what works (articles, docs, product pages).                  |
| **3. Validate**       | Inline scheme/format check; favicon + page title resolve as a preview chip                    | Resolving the title before processing is the trust moment. Do it in <800 ms.                              |
| **4. Process**        | Four named stages with real progress: Fetching → Reading → Structuring → Laying out           | Never a generic spinner. Named stages make 15 s feel like 5. Cancel available throughout.                 |
| **5. Preview**        | Generated structure rendered as an actual radial map, plus a side checklist of proposed nodes | Preview in the real renderer, not a list — the user must see it is a _map_. Depth control: 2 or 3 levels. |
| **6. Edit**           | Toggle nodes off, rename inline, merge two into one, drag to reparent                         | Keep it to these four. Full editing happens after save, in the real editor.                               |
| **7. Confirm**        | Name field prefilled with the page title; visibility defaults to Private                      | Private by default is non-negotiable — the source may be paywalled or personal.                           |
| **8. Save**           | Lands in My Maps; every node carries a source-link chip back to the origin URL                | Attribution on every node is both ethical and useful.                                                     |
| **9. Share / return** | Standard share sheet; or "Open in editor"                                                     | Reuse screens 11 and 09 exactly. No bespoke variants.                                                     |

**Failure modes, each with its own message**

- **Unreachable** — "That page didn't respond. Check the link or try another." + Retry.
- **Blocked by robots.txt** — "This site asks not to be read by tools like CDN." No retry; offer manual create. _Honour robots.txt. This is a legal and reputational line, not a preference._
- **Login or paywall** — "We can only read publicly visible pages." Offer paste-text fallback.
- **Too thin** — "Not much text to work with — here's a starter map instead," delivering a 3-node stub rather than nothing.
- **Model failure / timeout** — "Structuring took too long." Retry, and log for tuning.

> **ASSUMPTION**
>
> MVP handles **one public HTML URL at a time**. Batch URLs, PDFs, YouTube and authenticated pages are Coming Soon in the same screen. Consequence: the backend is a fetch + readability extract + one structured LLM call — roughly a week of work rather than a quarter.

---

## 13. Page Watcher UX

The recorded description — pick interests, press Go, scroll community pages — is clear and should be built exactly that literally. The design risk is that it becomes a generic feed and stops being CDN. The fix is that every card can become a node.

1. **Open** from ring node 3. The map recedes rather than cutting — the panel rises over a dimmed, still-visible map so the user never loses their place.
2. **Choose interests.** A grid of chips, family-tinted, each with a live content count. Multi-select, minimum one, no maximum. Selections persist to the profile and are editable later from the feed header.
3. **Go.** One full-width button, disabled until a selection exists, showing the count: _Go · 4 interests_.
4. **Browse.** A single-column card feed: source, title, excerpt, thumbnail, family dot, and three actions — _Save_, _Add to map_, _Share_. Cards are ~72% viewport height so one is always dominant.
5. **Open** an item in an in-app reader with the origin link visible.
6. **Add to map** opens a compact picker: which map, which parent node. On confirm, a toast: _Added to "Research" · View in map_.
7. **Return** — the panel drops and the map is exactly as it was, with the Page Watcher node briefly pulsing to re-anchor the user.

> **ASSUMPTION**
>
> Page Watcher browses **CDN community content** (public map pages, service nodes, published projects) — not the open web. Consequence: it is only as good as the content in the system, so it is genuinely weak at launch. Mitigation: seed 60–100 pages from existing CDN and partner projects before launch, and let the empty state say honestly that the community is new.

---

## 14. User-Created Maps UX

The editor must feel like the same world as the Community Map. Same canvas component, same node visuals, edit affordances layered on top.

| Capability             | Interaction                                                            | Notes                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create map**         | My Maps → New map → name + blank/template                              | 3–5 templates: Project, Research, Business, Learning, Personal                                                                               |
| **Starting point**     | Centre node opens in edit state, cursor in the title field             | Never present an empty canvas — the centre node is the prompt                                                                                |
| **Add node**           | FAB, double-tap empty canvas, or select parent → `Tab`                 | New node auto-slots into the next free angular position                                                                                      |
| **Edit node**          | Tap → sheet in edit mode; title inline-editable on canvas              | Title, description, type, icon, family colour, link, visibility                                                                              |
| **Connect**            | Drag from node edge handle to target; target highlights                | MVP supports one parent per node plus _reference_ edges (dashed, non-structural)                                                             |
| **Delete**             | Sheet → Delete, or long-press → context menu                           | Confirm only when children exist: "Delete this and 4 nodes under it?" Undo for 10 s                                                          |
| **Rearrange**          | Drag to a new angular slot; siblings reflow live                       | Snap to slots by default; `Alt`+drag for free position                                                                                       |
| **Node behaviour**     | Type picker in the node sheet                                          | MVP: topic, link, note, image, date. Everything else in the picker is badged Soon — this is where the "limitless node" vision lands honestly |
| **Save**               | Autosave, debounced 800 ms; status text reads Saving / Saved / Offline | No Save button. A Save button in a canvas editor is a bug report waiting to happen                                                           |
| **Rename / duplicate** | Map menu, or card overflow in My Maps                                  | Duplicate copies nodes, not collaborators or share links                                                                                     |
| **Share**              | Screen 11                                                              | See §15                                                                                                                                      |
| **Activity**           | Map menu → Activity: who changed what, when                            | Append-only log. Cheap to build, disproportionately trust-building                                                                           |

---

## 15. Collaboration and Permissions

### Roles

| Role          | View | Edit nodes | Invite | Change roles    | Privacy | Delete map |
| ------------- | ---- | ---------- | ------ | --------------- | ------- | ---------- |
| **Owner**     | yes  | yes        | yes    | yes             | yes     | yes        |
| **Admin**     | yes  | yes        | yes    | yes (below own) | yes     | —          |
| **Editor**    | yes  | yes        | —      | —               | —       | —          |
| **Commenter** | yes  | —          | —      | —               | —       | —          |
| **Viewer**    | yes  | —          | —      | —               | —       | —          |

Exactly one Owner; transfer is explicit and confirmed. Admin delegation — the recorded requirement that a freelancer can be invited to admin a map — is precisely the Admin role, reached from screen 12.

### Visibility model

| Setting                | Who sees the map                           | What they see                                                                                                          |
| ---------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Private**            | Owner + invited                            | Everything their role allows                                                                                           |
| **Link-viewable**      | Anyone with the link                       | Read-only; not indexed, not searchable                                                                                 |
| **Public**             | Anyone; appears in search and Page Watcher | Read-only                                                                                                              |
| **Node-viewable: on**  | —                                          | Viewers can expand into node detail and follow links                                                                   |
| **Node-viewable: off** | —                                          | Viewers see structure, titles and shape — taps do not open detail. The requested "show the map, not the contents" mode |

Individual nodes may override to Private inside an otherwise shared map; they render with the lock state and their subtree is excluded from the share payload server-side. **Never** ship a client-side filter for this — the data must not leave the server.

### Chat, presence, activity

- **Map chat** is one thread per map, docked right on desktop and a bottom sheet on mobile. Typing `#` mentions a node and posts a chip that recentres the map when tapped — this is what makes it map chat rather than a chat box.
- **Presence**: avatar stack in the top bar; a coloured ring on nodes another person has selected. No live cursors in MVP.
- **Activity**: append-only log with filters by person and action.
- **Conflicts**: last-write-wins per field, with a soft lock — a node being edited by someone else shows their avatar and a subtle pulse, and your edit is refused with "Sam is editing this." Honest, cheap, and sufficient below ~5 concurrent editors. CRDTs are month 4+.

### Trust and safety

- **Report** lives in the overflow of every node, map, message and profile. One flow, one component, everywhere.
- **Automated screening** on publish-to-public and on every outbound URL: text classification, domain blocklist, known-bad URL check. Private maps are not scanned — scanning private content is a promise you cannot walk back.
- **Moderation queue** (screen 21) with actions: dismiss, warn, unpublish, remove, suspend. Every action written to an audit trail.
- **Rate limits** on map creation, invites, chat and Link-to-Mind-Map, which is the main abuse vector (it is a fetcher you are exposing to the internet — SSRF protections, private-IP blocking and a redirect cap are mandatory, not optional).
- **Publish gate**: first time a user makes anything public, a short ToS acknowledgement naming what is not allowed.

> **ON THE STATED GOAL OF PREVENTING ILLICIT ACTIVITY**
>
> "Limitless for everyone, with lawful restrictions" is a genuine tension and it should be resolved in writing before launch, not in a support ticket. The workable MVP position: **private maps are private and unscanned; anything public is screened, reportable and removable; link-out to known-bad domains is blocked in both.** That is defensible, implementable in the MVP window, and does not require moderating a million private documents you have no capacity to review.

---

## 16. CDN Design System

Derived from the reference screens, corrected for legibility and performance. Everything below is a token; nothing is a one-off.

### Ground and surface

| Hex       | Role                     |
| --------- | ------------------------ |
| `#000000` | ground — map canvas only |
| `#07070C` | app background           |
| `#0D0E17` | surface / sheets         |
| `#161930` | raised / inputs          |
| `#22253A` | border                   |
| `#EDEEF7` | ink — all labels         |
| `#8C8FA8` | muted text               |

The map canvas alone uses pure `#000000`; every panel above it uses `#0D0E17`. That two-step separation is what lets a sheet read as floating over the network without a heavy shadow, and it is why the neutrals carry a violet bias rather than being true grey.

### Family accents

| Hex       | Role     |
| --------- | -------- |
| `#A3E635` | Create   |
| `#2FD9F5` | Discover |
| `#FF8A3D` | Services |
| `#FF4D97` | People   |
| `#8B5CF6` | Organise |
| `#2DD4BF` | Commerce |

Six families, six hues, spaced far enough apart to survive colour-vision deficiency when combined with the icon and the badge. Each has three ramps: `--fam-x-core` (stroke), `--fam-x-glow` (core at 55% for the halo), `--fam-x-wash` (core at 8% for fills). Semantic colours are separate and never reused as accents: success `#2DD4BF`, warning `#FFB020`, danger `#FF4D6D`.

### Typography

| Role    | Face                      | Use                                           | Spec                                                                                                                       |
| ------- | ------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Display | **Chakra Petch** 600/700  | Screen titles, node labels, brand chrome      | Angular and technical — it reads as circuitry without the costume-sci-fi of Orbitron, and stays legible at 12 px on canvas |
| Body    | **Inter** 400/500         | Descriptions, sheets, forms, chat             | Neutral by design — the map carries the personality; running UI text should not compete                                    |
| Utility | **IBM Plex Mono** 400/500 | Node numbers, counts, timestamps, IDs, tokens | Tabular figures; the numbering system from the reference lives here                                                        |

Scale (mobile / desktop): display-l 28/36 · display-m 22/28 · title 18/20 · body 15/16 · label 13/14 · caption 11/12 · node-label 13/14. Line height 1.2 for display, 1.55 for body. Uppercase labels take 0.16em tracking. **Node labels are always `#EDEEF7`, never the family hue.**

### Elevation and glow

| Token          | Value                                  | Applies to                                 |
| -------------- | -------------------------------------- | ------------------------------------------ |
| `--glow-0`     | none                                   | Inactive, Coming Soon                      |
| `--glow-1`     | 0 0 10px fam@35%                       | Available node, connectors                 |
| `--glow-2`     | 0 0 18px fam@55%                       | Active node                                |
| `--glow-3`     | 0 0 0 4px #FFF@10%, 0 0 28px fam@75%   | Selected node, root ring                   |
| `--elev-sheet` | 0 -1px 0 border, 0 -20px 48px #000@60% | Sheets, panels — darkness, not drop shadow |

**Implementation rule:** `--glow-*` are design descriptions. On canvas they compile to pre-rendered radial-gradient sprites, one per family per level (18 sprites, cached), composited additively. They are _never_ emitted as live `box-shadow` or `filter` on canvas elements. In DOM chrome, box-shadow is fine.

### Shape, spacing, controls

- **Radius:** node = full circle. Sheets 20 px top. Cards 12 px. Inputs and buttons 10 px. Chips 6 px. Nothing at 8 px everywhere.
- **Spacing:** 4 px base — 4, 8, 12, 16, 24, 32, 48, 64. Map geometry uses its own scale (§09) and does not borrow these.
- **Buttons:** Primary = family-hue fill at 12% + 1.5 px hue stroke + ink label + `--glow-1` (a solid neon fill would blow out on black). Secondary = border only. Ghost = text. Destructive = danger stroke, fill on press. Height 48 mobile / 40 desktop.
- **Inputs:** `#161930` fill, 1 px `#22253A`, focus = 2 px cyan + `--glow-1`. Search field is pill-shaped; everything else is 10 px.
- **Cards:** surface fill, 1 px border, family dot top-left, no glow. Cards are the calm surface — glow belongs to the map.
- **Map controls:** 44 px circular glass buttons — `#0D0E17` at 72% with a 1 px border and backdrop blur, arranged vertically on the right, thumb-reachable.
- **Modals:** centred on desktop (max 480 px), bottom sheet on mobile. Scrim `#000` at 68% with a 2 px blur — enough to push the map back without hiding it.

### Motion

| Motion               | Duration              | Curve                      | Principle                                                         |
| -------------------- | --------------------- | -------------------------- | ----------------------------------------------------------------- |
| Node expand          | 260 ms, 25 ms stagger | cubic-bezier(.2,.8,.2,1)   | Children emerge _from_ the parent's position, never fade in place |
| Collapse             | 200 ms                | cubic-bezier(.4,0,.7,.2)   | Faster than expansion — retreat should feel decisive              |
| Camera / recentre    | 420 ms                | cubic-bezier(.25,.9,.25,1) | Always animated; a teleporting camera loses the user              |
| Sheet                | 280 ms                | spring, damping .82        | Follows the finger on drag                                        |
| Selection            | 140 ms                | ease-out                   | Immediate feedback beats smooth feedback                          |
| Ambient ring breathe | 4 s loop, ±4% opacity | ease-in-out                | Root node only. The one ambient animation in the product          |

Under `prefers-reduced-motion`: all easing collapses to 0 ms cross-fades, camera moves become instant, the ambient breathe stops. Ship this in Phase 1, not Phase 13.

---

## 17. Responsive Design Strategy

|                   | Phone <600          | Tablet 600–1023          | Desktop 1024–1599      | Large ≥1600                        | Touch board ≥2400                        |
| ----------------- | ------------------- | ------------------------ | ---------------------- | ---------------------------------- | ---------------------------------------- |
| **Nav**           | 4-tab bottom bar    | Bottom bar + top actions | Left icon rail         | Left rail expanded with labels     | Rail bottom-anchored, reachable standing |
| **Detail**        | Bottom sheet 45–90% | Right sheet 380 px       | Fixed inspector 360 px | Inspector 400 px + activity column | Floating panel, draggable to any edge    |
| **Ring 1 max**    | 8 nodes             | 10                       | 12                     | 14                                 | 16                                       |
| **Visible rings** | 1–2                 | 2                        | 2–3                    | 3                                  | 3–4                                      |
| **Node size**     | 56 px               | 60 px                    | 64 px                  | 68 px                              | 96 px                                    |
| **Hit target**    | 88 px               | 88 px                    | 44 px                  | 44 px                              | 120 px                                   |
| **Primary input** | Touch               | Touch                    | Mouse + keys           | Mouse + keys                       | Multi-touch, pen                         |
| **Node budget**   | 150                 | 220                      | 300                    | 400                                | 500                                      |
| **Renderer**      | Canvas 2D           | Canvas 2D                | Canvas 2D              | Canvas 2D / WebGL                  | WebGL                                    |

**Gestures**

One finger pans, two fingers pinch-zoom and rotate-lock (rotation is captured and discarded — capturing it prevents accidental drift), long-press expands, double-tap opens, two-finger tap steps back a layer. On desktop: scroll zooms, space+drag pans, arrow keys traverse siblings, `→`/`←` expand/collapse, `/` searches, `Esc` collapses to root.

**Multi-touch boards — design now, build later**

Three decisions taken in the MVP make the eventual 20/40/60-point board work cheap rather than a rewrite: **(1)** the renderer tracks pointers by `pointerId` from day one, never assuming a single active pointer; **(2)** selection state is a set, not a scalar; **(3)** the detail panel is positionable rather than edge-locked. None of these cost anything now. All three are expensive to retrofit.

**Performance targets**

60 fps pan/zoom on a 2021 mid-range Android with 150 nodes; ≤2.5 s to interactive map on 4G; ≤220 KB of critical JS before the canvas paints; map data streamed by ring so ring one renders before ring two arrives.

---

## 18. Component Architecture

Thirty-eight components cover all twenty-two screens. If a screen needs a thirty-ninth, that is a signal to re-examine the screen.

| Group           | Components                                                                                                                                  | Key props / variants                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Shell**       | AppShell, TabBar, NavRail, TopBar, SafeArea                                                                                                 | tabs, activeTab, density                                                    |
| **Map**         | MapCanvas, NodeMarker, EdgeLine, ClusterNode, RootNode, SelectionRing, MapControls, LayerStepper, Breadcrumb, LensPill, ViewToggle, MiniMap | NodeMarker: family, status, size, selected, glowLevel, badge, label, locked |
| **Tree**        | TreeList, TreeRow, ExpandChevron, FamilyDot                                                                                                 | depth, expanded, status                                                     |
| **Panels**      | DetailSheet, InspectorPanel, ChatPanel, FilterBar                                                                                           | mode: view / edit / soon / locked — one component, four modes               |
| **Search**      | SearchField, SuggestionGroup, ResultCard, ResultMap, RecentChips                                                                            | group, matchRanges, path                                                    |
| **Content**     | MapCard, ContentCard, ServiceHero, CapabilityList, WorkGrid                                                                                 | size, visibility, owner                                                     |
| **Forms**       | TextField, TextArea, Select, ToggleRow, ChipGrid, IconPicker, ColorFamilyPicker, UrlField                                                   | state: default / focus / error / disabled                                   |
| **Actions**     | Button, IconButton, FAB, ActionRow, Menu, ConfirmDialog                                                                                     | Button: primary / secondary / ghost / destructive × sm / md / lg            |
| **Permissions** | VisibilityPicker, RoleMenu, PersonRow, PendingInvite, LockBadge, PermissionNotice                                                           | role, canEdit, inherited                                                    |
| **Feedback**    | Toast, Skeleton, EmptyState, ErrorState, ComingSoonBlock, ProgressStages, SaveIndicator                                                     | ComingSoonBlock: title, window, notifyState, relatedNodes                   |
| **Social**      | Avatar, PresenceStack, NotificationRow, MessageBubble, Composer, ReportAction                                                               | size, presence, unread                                                      |

> **THE THREE COMPONENTS THAT DECIDE THE PROJECT**
>
> **MapCanvas** (camera, hit-testing, culling, clustering, pointer model), **NodeMarker** (every visual state in one place), and **DetailSheet** (which must serve view, edit, Coming Soon and locked from a single implementation). Get these three right in Phase 3–4 and the remaining nineteen screens are assembly. Get them wrong and every later phase pays interest.

---

## 19. Design-to-Code Strategy

**Naming**

Design layer names match code exactly: `NodeMarker / active / selected / lg` in the canvas is `<NodeMarker status="active" selected size="lg" />` in React. Screens are named by route (`MapScreen`, `MapEditorScreen`), not by content. No file called "Final v3".

**Tokens**

One `tokens.json` is the source of truth, compiled to CSS custom properties for DOM and to a plain JS object for the canvas renderer — the canvas cannot read CSS variables at draw time, so a build step exporting both is required from Phase 1. Never hard-code a hex in a component. Family colours are looked up by family key, never by name.

**Specifying interaction**

Each interactive component ships with a state table (default, hover, focus, active, disabled, loading, error) and a motion line naming duration, curve and the property animated. Gestures are specified as: trigger, threshold, feedback, cancel condition, and the outcome if the gesture is interrupted — that last one is where canvas bugs live.

**Accessibility contract per component**

Every component definition carries its role, its keyboard model, its focus-visible treatment, and its screen-reader announcement string. `MapCanvas`'s contract is explicit: it is `aria-hidden`, and the TreeList carries the accessible representation. Do not attempt to make a canvas accessible by annotation.

**Handoff package**

Per screen: the artboard, the component list with variants, the state table, the copy deck (real strings, ready for translation), the empty/error/loading/permission variants, and the analytics events. Per flow: a state diagram. Per release: a token diff.

**Decisions deliberately avoided because they are expensive**

- No per-node blur filters, no backdrop-filter on scrolling content, no animated SVG filters — all are frame-rate traps on mobile.
- No text on curved paths (labels stay horizontal at all zoom levels — rotated labels are unreadable and untranslatable).
- No layout that depends on exactly twelve nodes; every layout is a function of _n_.
- No design that requires simultaneous map and full-screen panel on phones.
- No custom scrollbars, no scroll-jacking, no bespoke video codecs.

---

## 20. Phase-by-Phase Implementation Roadmap

> **ASSUMPTIONS**
>
> 2–3 engineers plus one designer. Stack: React + TypeScript, canvas 2D renderer (WebGL later), Postgres with row-level security, object storage, one LLM API for Link-to-Mind-Map. Weeks are calendar weeks with overlap between phases — the totals below exceed twelve weeks because design and build run in parallel, not in series.

| Phase                                 | Objective                           | Design + UX work                                                             | Components                                                                                         | Engineering & data                                                                                     | Acceptance                                                                                                           | Risk                                                                 |
| ------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **P0** Foundation _wk 1_              | Agree scope, IA, flows              | This document ratified; open decisions in §25 closed; success metrics set    | —                                                                                                  | Repo, CI, environments, analytics plan                                                                 | Written sign-off on MVP scope and the four live families                                                             | Scope creep restarting here `High`                                   |
| **P1** Design system _wk 1–2_         | Tokens and primitives exist in code | Full token set; type scale; node state sheet; motion spec; both control sets | Button, TextField, Chip, Card, Sheet, Toast, Skeleton, Avatar                                      | tokens.json → CSS vars + JS export; Storybook                                                          | Every primitive rendered in all states in Storybook; reduced-motion honoured                                         | Token churn later `Med`                                              |
| **P2** Navigation shell _wk 2_        | Routing and chrome                  | Shell layouts for all 5 breakpoints; empty screens wired                     | AppShell, TabBar, NavRail, TopBar                                                                  | Router, deep-link scheme, auth-aware guards (stubbed)                                                  | Navigate all 22 routes on phone and desktop                                                                          | Low                                                                  |
| **P3** Radial map _wk 2–4_            | The core surface                    | Map geometry spec, zoom tiers, layer stepper, breadcrumb, tree view          | MapCanvas, RootNode, NodeMarker, EdgeLine, MapControls, LayerStepper, Breadcrumb, TreeList         | Renderer, camera, hit-test, culling, clustering, pointerId model; node schema; Community Map seed data | 60 fps with 150 nodes on mid-range Android; tree view matches map exactly                                            | **The project's biggest technical risk.** Budget a spike week `High` |
| **P4** Node interaction _wk 4–5_      | Nodes become useful                 | Detail sheet in 4 modes; Coming Soon experience; lens                        | DetailSheet, InspectorPanel, ActionRow, ComingSoonBlock, LensPill, ViewToggle                      | Node detail API, deep links, interest-capture table                                                    | 3-tap path to a live destination; every dark node captures interest                                                  | Sheet component sprawl `Med`                                         |
| **P5** Map editor _wk 5–7_            | Users create                        | Editor toolbar, node editor, drag/connect/reparent, undo                     | MapCanvas(edit), SelectionHandles, EditToolbar, UndoBar, IconPicker, ColorFamilyPicker, TypePicker | Local-first edit buffer, command stack, autosave debounce, conflict fields                             | Blank → 10-node map in <3 min unaided in usability test                                                              | Undo across canvas + form is subtle `High`                           |
| **P6** Accounts & save _wk 6–7_       | Work persists                       | Sign-in/up, profile, My Maps, quotas                                         | MapCard, TabSegment, EmptyState, ProfileHeader                                                     | Auth, users, maps, nodes tables with RLS; storage for images; migrations                               | Map survives sign-out, device change and offline edit                                                                | RLS mistakes leak data `High`                                        |
| **P7** Sharing & roles _wk 7–8_       | Maps travel safely                  | Share sheet, visibility, node-viewable, collaborators, invites               | ShareSheet, VisibilityPicker, RoleMenu, PersonRow, PendingInvite, LockBadge                        | Share tokens, membership table, server-side payload filtering, invite email                            | Security review: no private node data in any shared response body                                                    | Node-viewable-off must filter server-side `High`                     |
| **P8** Search _wk 8–9_                | Second navigation model             | Field, suggestions, filters, list and map results, return path               | SearchField, SuggestionGroup, ResultCard, ResultMap, FilterBar                                     | Postgres full-text index; permission-aware queries; camera snapshot store                              | <300 ms suggestions; map results render; back restores exact state                                                   | Permission leakage via search `High`                                 |
| **P9** Link-to-Mind-Map _wk 9–10_     | The showcase                        | Full flow incl. all five failure states                                      | UrlField, ProgressStages, StructurePreview, NodeChecklist                                          | Fetcher with SSRF guards + robots.txt; readability extract; structured LLM call; rate limits; cost cap | 10 varied URLs produce useful maps; every failure has a specific message                                             | Fetcher is an abuse surface; LLM cost per run `High`                 |
| **P10** Page Watcher _wk 10_          | Community discovery                 | Interest picker, feed, add-to-map                                            | ChipGrid, ContentCard, InfiniteList                                                                | Content + tag model; seed 60–100 pages; simple relevance ranking                                       | Interests → feed → node created, in one session                                                                      | Cold-start emptiness `Med`                                           |
| **P11** Collaboration _wk 10–11_      | Teams work together                 | Chat, presence, activity, notifications                                      | ChatPanel, MessageBubble, Composer, PresenceStack, NotificationRow                                 | Realtime channel, messages table, activity log, notification fan-out                                   | Two accounts co-edit and chat without data loss or lockout                                                           | Realtime cost and reconnection `Med`                                 |
| **P12** Revenue node _wk 11_          | First money path                    | Service page, capability list, enquiry form, project showcase                | ServiceHero, CapabilityList, WorkGrid, EnquiryForm                                                 | Enquiry table, email routing, spam protection                                                          | Enquiry submitted end-to-end and reaches an inbox                                                                    | Low — do this early if cash matters more than polish                 |
| **P13** QA, a11y, security _wk 11–12_ | Fit to ship                         | Audit every screen against the state matrix; write the copy deck             | Fixes only — no new components                                                                     | Moderation queue, reporting, rate limits, pen-test pass, load test                                     | WCAG 2.1 AA on all non-canvas surfaces; tree view fully operable by keyboard and screen reader; no critical findings | Discovering a11y debt here `High` — mitigate by auditing from P3     |
| **P14** Launch _wk 12_                | Real users                          | Onboarding coach marks, marketing map, launch copy                           | —                                                                                                  | Monitoring, error tracking, backups, rollback plan, support inbox                                      | Closed beta 20–50 users; activation and 3-tap metrics instrumented                                                   | Launching without instrumentation `High`                             |

---

## 21. Three-Month Roadmap

Four states are used precisely: **Designed** = artboards and specs complete · **Prototyped** = clickable, testable, not production · **Built** = merged and working in staging · **Production-ready** = tested, accessible, monitored, live.

| Month                               | Designed                                                             | Built                                                                                                    | Production-ready by month end                                                                             |
| ----------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **1** Core foundation               | Design system; map spec; screens 01–10 and 22; tree view; onboarding | Tokens, primitives, shell, renderer, radial map, node detail, Coming Soon, editor v1                     | Design system · navigation shell · Community Map (read-only) · Coming Soon · tree view                    |
| **2** Accounts, sharing, search, AI | Screens 11–17; permission matrix; chat; moderation; service page     | Auth, cloud save, My Maps, sharing, roles, invites, search + map results, Link-to-Mind-Map, service node | Accounts · save · My Maps · editor · sharing & privacy · search · enquiry-capable service node            |
| **3** Collaboration, safety, launch | Screens 18–21; launch copy; onboarding refinement from test findings | Chat, presence, activity, notifications, Page Watcher, moderation, reporting; hardening                  | **Everything above plus collaboration, Page Watcher, Link-to-Mind-Map and moderation. Closed beta live.** |

**Honest read on the schedule**

This is achievable with 2–3 focused engineers _if_ scope holds. Two things will break it, and both are predictable: the canvas renderer taking three weeks instead of two (mitigate with a hard spike in week 2 and a documented fallback to a DOM/SVG renderer capped at 150 nodes), and scope re-expanding toward payments or the marketplace (mitigate by treating §04 as a contract). The recorded ambition of shipping the whole platform in one month should be set aside now rather than discovered in week five.

**Milestone gates**

- **End of week 4** — map renders at 60 fps with real data, or the fallback renderer decision is taken. No exceptions.
- **End of week 8** — a user can create, save and share a map. If not, cut Page Watcher, not quality.
- **End of week 11** — feature freeze. Week 12 is hardening only.

---

## 22. Six-Month Roadmap

| Month | Theme                | Ships                                                                                                                                                          | Turns on                                   |
| ----- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **4** | Monetise & deepen    | Payments (Stripe), Pro tier, paid AI tools node, batch and PDF Link-to-Mind-Map, real-time co-editing (CRDT), PNG/PDF export                                   | Ring nodes 8 (AI Tools) and 11 (Commerce)  |
| **5** | Marketplace & people | Freelance profiles, service listings, invite-to-admin flow from a listing, ratings, escrowed payment, follows and profiles                                     | Ring nodes 6 (People) and 7 (Freelance)    |
| **6** | Scale & surface      | WebGL renderer, 20/40/60-point multi-touch board mode, integrations (calendar, Drive, Notion), node behaviour engine v1, map analytics, org accounts and roles | Ring nodes 10 (Organise) and 12 (Partners) |

**Advanced AI, sequenced honestly**

Month 4: multi-source ingestion and AI node suggestions inside the editor. Month 5: conversational map query ("what did I save about patents?"). Month 6: automated map maintenance — suggested merges, dedupe, stale-link detection. Agent orchestration is a month 7+ conversation and should not be promised before the node behaviour engine exists.

**Scalability work that must not slip past month 6**

Server-side layout precomputation for large public maps; CDN-cached map snapshots for read-heavy public maps; ring-by-ring pagination in the API; per-map node ceilings with graceful clustering; and a background job queue for ingestion so the fetcher never runs in a request thread.

---

## 23. Risks and Technical Challenges

| Risk                                                                 | Impact                                        | Likelihood | Mitigation                                                                                                                                              |
| -------------------------------------------------------------------- | --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canvas performance on mid-range mobile**                           | Fatal — the product _is_ the map              | High       | Spike in week 2 with 300 real nodes on a real device. Pre-baked glow sprites, culling, clustering, flat-render-during-gesture. Documented DOM fallback. |
| **Scope re-expansion**                                               | Fatal to the timeline                         | Very high  | §04 is a contract. New ideas go to a visible "Post-MVP" list, not into the sprint. The Coming Soon map absorbs the emotional need to show scale.        |
| **Permission leakage** (node-viewable, private nodes, search)        | Severe — trust and legal                      | Medium     | Filter server-side only; row-level security; automated tests asserting private nodes never appear in any response; security review gate in P13.         |
| **Link-to-Mind-Map fetcher abuse** (SSRF, scraping complaints, cost) | Severe                                        | Medium     | Block private IP ranges, cap redirects, honour robots.txt, rate-limit per user, hard monthly LLM spend cap with graceful degradation.                   |
| **Accessibility retrofit**                                           | High — expensive and possibly legally exposed | Medium     | Tree view built in P3, not P13. Audit each phase, not at the end.                                                                                       |
| **Empty community at launch**                                        | High — Page Watcher and search feel broken    | High       | Seed 60–100 real pages. Honest empty states. Consider launching Page Watcher two weeks after the map.                                                   |
| **Moderation load**                                                  | Medium, rising                                | Medium     | Automated screening on public content only; small closed beta; clear ToS; queue with audit trail from day one.                                          |
| **Single-developer-team dependency**                                 | High                                          | Medium     | Monthly source hand-off (already agreed), documented architecture, no proprietary build tooling, credentials owned by the client.                       |
| **Budget vs. ambition mismatch**                                     | High                                          | High       | Ship the revenue node (P12) early — it is one week of work and the only feature that returns money. Consider moving it to month 1.                      |
| **Undo/redo across canvas and forms**                                | Medium                                        | High       | Single command stack from the first editor commit. Retrofitting undo is a rewrite.                                                                      |

---

## 24. MVP Acceptance Criteria

**Functional — all must pass**

- A new visitor reaches a live destination in ≤3 taps and ≤25 s.
- Pan, zoom, expand, collapse, layer-step and recentre all work on phone and desktop; no state is unreachable or inescapable.
- All 12 ring-one nodes render; the 8 unbuilt ones open a Coming Soon sheet and record interest.
- Search returns permission-correct results in list and map form; back restores the exact prior camera state.
- A signed-in user creates a 10-node map, saves it, reloads on another device, and sees it intact.
- Sharing produces a working link honouring Private / Link-viewable / Public and the node-viewable toggle; a private node never appears in any shared response body.
- An invited Editor can edit; a Viewer cannot; an Admin can invite; the Owner can transfer ownership.
- Map chat delivers messages between two accounts, with node mentions that recentre the map.
- Link-to-Mind-Map produces a useful map from 10 varied public URLs, and gives a specific message for each of the five failure modes.
- Page Watcher: interests → Go → feed → add-to-map, completed in one session.
- An enquiry submitted on the service node arrives in the business inbox.
- Report → moderation queue → action → audit entry works end to end.

**Quality gates**

| Gate                      | Target                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Map frame rate            | ≥55 fps median, 150 nodes, 2021 mid-range Android                                            |
| Time to interactive map   | ≤2.5 s on 4G                                                                                 |
| Search suggestion latency | ≤300 ms p95                                                                                  |
| Accessibility             | WCAG 2.1 AA on all non-canvas surfaces; tree view fully keyboard- and screen-reader-operable |
| Reduced motion            | Every animation suppressed or reduced                                                        |
| Security                  | No critical or high findings; RLS verified by automated tests                                |
| Crash-free sessions       | ≥99.5%                                                                                       |
| Every screen              | Loading, empty, error and permission states implemented as specified in §08                  |

**Product signals from the beta — what "working" means**

≥60% of new users expand at least one node; ≥30% create a map; ≥15% share one; ≥10 Coming Soon interest signals per dark node in the first month (this is your build-order data); ≥3 service enquiries in the first month.

---

## 25. Next Steps and Open Decisions

**Immediate sequence — the next two weeks**

1. **Close the seven decisions below.** Nothing else should start first; each one changes downstream design.
2. **Draw the design canvas in phase order.** There is no separate design track — the artboards below _are_ the "Design + UX work" column of §20, and each one is named by the phase it belongs to. Design runs roughly two weeks ahead of the build for the same phase, which is why the phase weeks in §20 overlap.

| Order | Artboards to draw                                                                     | Belongs to phase | Screens covered        |
| ----- | ------------------------------------------------------------------------------------- | ---------------- | ---------------------- |
| 1     | Design-system sheet — palette, type scale, node states, buttons, inputs, map controls | **P1**           | — (foundation for all) |
| 2     | Community Map at three zoom tiers, plus selected state                                | **P3**           | 02, 04                 |
| 3     | Node detail in all four modes: view / edit / Coming Soon / locked                     | **P4**           | 03                     |
| 4     | Coming Soon experience                                                                | **P4**           | 22                     |
| 5     | Map editor and node editor                                                            | **P5**           | 07, 08, 09, 10         |
| 6     | Share, privacy, collaborators                                                         | **P7**           | 11, 12                 |
| 7     | Search and results                                                                    | **P8**           | 05, 06                 |
| 8     | Link-to-Mind-Map                                                                      | **P9**           | 14                     |

**Approval gate:** screens 13 and 15–21 are not designed until artboards 1–4 are signed off. They inherit every decision from those four — sheet behaviour, node visuals, permission treatment — so drawing them early means drawing them twice.

3. **Run the P3 renderer spike in parallel with artboards 1–2.** The design cannot be validated until someone has drawn 300 glowing nodes on a real phone.
4. **Test the map with five people** at the end of week 2 using a clickable prototype. Watch specifically for: do they find their way back, and do they understand what a dark node is.

**Decisions to confirm before implementation**

| #   | Decision                                                                                                                                    | Recommendation                                                       | If it goes the other way                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Four live families, eight Coming Soon — is that acceptable?                                                                                 | **Yes.** It is the difference between shipping and not.              | Every additional live family costs ~1.5 weeks and pushes launch                                  |
| 2   | Popularity as size/glow rather than position                                                                                                | **Adopt.** Trending lens gives the sorted view on demand             | Auto-repositioning makes the map unlearnable; expect users to complain that things move          |
| 3   | Ring one re-cut (Page Watcher, Link-to-Mind-Map, Build With Us, Active Projects promoted; Storage/Analytics/Integrations/Marketing demoted) | **Adopt.** Ring one should be places, not features                   | Keeping the original twelve means the MVP's best features are buried at ring two                 |
| 4   | Web (responsive + PWA) before native apps                                                                                                   | **Web first.** Deep links, sharing and iteration speed all favour it | Native doubles the build and adds review cycles before you have validation                       |
| 5   | Payments deferred to month 4                                                                                                                | **Defer**, but ship the enquiry-based service node in month 1–2      | Adding payments to the MVP costs ~2 weeks and pulls in tax, refunds and support                  |
| 6   | Private maps are not content-scanned                                                                                                        | **Adopt**, and say so plainly in the privacy policy                  | Scanning private content is a promise you cannot un-make, and a moderation load you cannot staff |
| 7   | Page Watcher browses CDN community content only                                                                                             | **Adopt**, with seeded content and honest empty states               | Indexing the open web means owning a crawler, and is a quarter of work by itself                 |

> **ONE LAST THING**
>
> The strongest asset here is not the feature list — it is that the central node is instantly understandable and genuinely beautiful. Protect that. Every decision in this document that trims scope exists so the map itself gets the engineering attention it needs, because a CDN that does four things on a map that feels alive will beat a CDN that does twenty on a map that stutters.
