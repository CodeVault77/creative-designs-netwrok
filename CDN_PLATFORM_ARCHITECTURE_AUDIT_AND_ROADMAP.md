# Creative Design Networks — Platform Architecture Audit & Long-Term Roadmap

**Audit date:** 2026-09-05
**Scope:** The current codebase measured against the **full CDN platform vision**, not the MVP.
**Method:** Direct inspection of schema, engine, routes, services and configuration. Every finding cites the file that produced it.

> **Companion documents.** `CREATIVE_DESIGN_NETWORKS_MVP_IMPLEMENTATION_ROADMAP.md` covers finishing the MVP (email, backups, beta gate). This document is about whether the _architecture_ can carry the platform. They do not overlap; both are needed.

---

## The answer to the critical question, first

> _If we keep building on this codebase for 12–24 months, will it become the full platform — or will we need a rewrite?_

**No rewrite is needed. But three foundational changes must happen before any more features are added, and one of them is urgent.**

The codebase is well-built: a genuine authorisation choke point, generated design tokens, structural tests that fail the build on whole classes of error, and 679 passing tests. The engineering discipline is above average and the layering is clean. None of that is the problem.

**The problem is that the core data model is a tree, not a graph.**

```
map_nodes: id, map_id, parent_id, slot, title, family, type, status,
           visibility, icon, href, payload, weight, free_x, free_y
```

`parent_id` is the **only** relationship. There is **no edges table** — a search for `CREATE TABLE …edge|relation|link_` across all ten migrations returns **zero**. Edges in the renderer are derived parent→child in `src/lib/map/layout.ts:335`.

The vision's very first principle is _"Nodes can connect to other nodes."_ A tree cannot express that. Nor cross-map relationships, typed relationships, knowledge graphs, workflows connecting multiple nodes, or a node containing another map. **Roughly 60% of the vision is blocked on this one table that does not exist.**

The second gap: **nodes cannot _do_ anything.** `NodeType` is a closed union of eight string literals (`src/lib/map/types.ts:11`) and there is no capability, action or handler registry. A node is a labelled point with an optional `href`. The vision needs nodes that are agents, workflows, applications and services.

The third: **there is no event bus, job queue or worker.** No automation, no scheduled work, no agent execution, and — today — no way to send the emails already sitting in the `outbox` table.

**What to do now versus later.** Add the edges table, a node capability registry, and an event/job layer **before** building marketplaces, agents or commerce. Each is a few weeks. Retrofitting them after twenty features depend on the tree shape is a rewrite; doing them now is a migration. Everything else in the vision composes cleanly on top of those three.

---

# Part 1 — Current State

## 1.1 Executive summary

| Dimension                                | Assessment                                               |
| ---------------------------------------- | -------------------------------------------------------- |
| **Code quality**                         | High. Consistent, documented, tested                     |
| **Layering**                             | Clean. Repositories, services, routes properly separated |
| **Security posture**                     | Good foundations, incomplete coverage                    |
| **Test discipline**                      | Strong on logic; absent on auth and HTTP                 |
| **Vision coverage**                      | **~12% of the full vision**                              |
| **MVP coverage**                         | ~85%                                                     |
| **Architectural fitness for the vision** | **Blocked on three foundational gaps**                   |

**What is built:** a radial map with a canvas renderer, node detail, a map editor, accounts, sharing with a real role matrix, FTS5 search, page ingestion, a page-watcher feed, SSE collaboration, moderation, and a complete marketing site.

**What the vision names and does not exist at all:** agents, workflows, automation, payments, subscriptions, marketplaces, e-commerce, CRM, project management, LifeMap, plugins, SDK, webhooks, organisations, SSO, mobile/desktop apps, embeddings, and semantic search.

## 1.2 Verified inventory

| Layer                | Count           | Evidence                                    |
| -------------------- | --------------- | ------------------------------------------- |
| API route handlers   | 34              | `src/app/api/**/route.ts`                   |
| Database tables      | 30              | 10 migrations in `src/lib/db/migrations.ts` |
| Page routes          | 28              | `src/app/**/page.tsx`                       |
| Tests                | 679 in 20 files | `npm run verify`                            |
| Acceptance harnesses | 20              | `scripts/verify-*.mjs`                      |
| ADRs                 | 9               | `docs/decisions/`                           |

## 1.3 Technology

Next.js 15.5.24 (App Router) · React 19 · TypeScript `strict` + `noUncheckedIndexedAccess` · styled-components v6 · **SQLite via `better-sqlite3`** · zod · Vitest.

---

# Part 2 — Architectural Findings

These are the findings that determine whether the vision is reachable. Each is stated as _what exists_, then _what the vision needs_, then _the gap_.

## ARCH-1 · The graph is a tree — **P0, blocking ~60% of the vision**

**Status:** `ARCHITECTURALLY_WEAK`

**What exists.** `map_nodes` (migration `initial_schema`, line 72) with `parent_id TEXT` and two indexes: `map_nodes_map(map_id)` and `map_nodes_parent(map_id, parent_id)`. `MapGraph` in `src/lib/map/types.ts` exposes `childrenOf: Map<string, string[]>`. Layout walks that adjacency list recursively (`layout.ts:209`) and synthesises edges from the walk.

**What the vision needs.** Node↔node connections; typed relationships (`depends_on`, `authored_by`, `derived_from`); cross-map links; nodes containing maps; workflow chains; a knowledge graph; AI reasoning over relationships.

**The gap.** Every one of those is a many-to-many relationship with attributes. A tree gives one unattributed parent per node. There is no table to put an edge in, no type to describe one, and no query path to traverse one.

**Consequences if not fixed first.** Workflows, agent orchestration, knowledge graphs, LifeMap, cross-map search and marketplace composition are all unimplementable. Any feature built on the tree in the meantime has to be rewritten when edges arrive.

**Required change.** A `node_edges` table — `(id, map_id, from_node_id, to_node_id, type, payload, created_at)` — plus traversal in the repository layer and a renderer that draws edges from the table rather than deriving them. The tree becomes a _view_ over the graph (parent edges are edges of type `contains`), so nothing existing breaks.

**Complexity:** Large. **Do this first.**

## ARCH-2 · Nodes have no capabilities — **P0**

**Status:** `ARCHITECTURALLY_WEAK`

**What exists.** `type` is a closed union of eight literals: `'topic' | 'link' | 'note' | 'image' | 'date' | 'service' | 'page' | 'cluster'` (`src/lib/map/types.ts:11`). Behaviour is switched on that union in the renderer and the detail sheet. There is one generic escape hatch — `payload TEXT` — with a comment describing it as a "forward-compatible slot for the eventual behaviour engine". **That engine does not exist.**

**What the vision needs.** Nodes as agents, workflows, applications, databases, services, products, tasks and people; nodes that trigger actions, expose permissions, and gain capabilities from external APIs; developers adding node types without touching core.

**The gap.** Adding a node type today means editing a union, the renderer, the detail sheet and the editor. That is a core change per type — it does not scale to "hundreds of future node capabilities", which the vision explicitly requires.

**Credit where due.** `payload` was added deliberately for this and is the right hook. The registry that reads it was never built.

**Required change.** A node-type registry: each type declares its schema (zod), icon, renderer, available actions and permissions. Core dispatches through the registry; nothing switches on a literal union.

**Complexity:** Large.

## ARCH-3 · No event bus, no queue, no workers — **P0**

**Status:** `NOT_IMPLEMENTED`

**What exists.** Nothing. There is no scheduler, worker, queue consumer or event dispatcher anywhere in `src/lib`. `outbox` is a table with `queueEmail`/`pendingEmails`/`markSent` and **no caller for the last two** — the shape of a queue with no runner.

**What the vision needs.** Workflow automation, scheduled workflows, event-driven automation, retries, failure recovery, background jobs, agent execution, and — immediately — email delivery.

**The gap.** Every asynchronous capability in the vision needs this. It is also the reason no email is sent today, which makes it the rare foundational gap with an urgent product symptom.

**Required change.** A durable job table with a worker loop (retries, backoff, dead-letter), plus an event bus that lets nodes emit and subscribe. On SQLite this is a table plus a polling worker — genuinely modest.

**Complexity:** Medium. **Highest ratio of value to effort in this document.**

## ARCH-4 · No tenancy layer — **P1, blocks all enterprise**

**Status:** `NOT_IMPLEMENTED`

**What exists.** `users` and `maps.owner_id`. A search for org/team/workspace/tenant tables returns **zero**.

**What the vision needs.** Organisations, teams, enterprise workspaces, SSO, delegated administration, enterprise billing, white-label and private deployment.

**The gap.** Ownership is user-scoped throughout. Introducing organisations later means touching every table with an owner and every visibility query in `src/lib/db/repo.ts`.

**Required change.** An `organizations` table, `organization_members`, and an optional `org_id` on owned resources. **Cheap now, expensive later** — the pattern to follow is `map_members`, which already does this shape correctly for maps.

**Complexity:** Medium now, Very Large after more features land.

## ARCH-5 · Permissions are map-scoped and fixed — **P1**

**Status:** `FUNCTIONAL_BUT_INCOMPLETE`

**What exists — and it is good.** `src/lib/sharing/roles.ts` defines five roles (`owner | admin | editor | commenter | viewer`) against a fixed `Capabilities` struct of eight booleans, with a genuinely well-reasoned `canAssignRole` that prevents lateral privilege escalation (an admin cannot mint another admin or demote a peer). Node-level control exists but is coarse: `visibility: 'inherit' | 'public' | 'private'`.

**What the vision needs.** Object-level permissions, agent tool permissions, AI action permissions, delegated administration, enterprise policy.

**The gap.** Capabilities are a hardcoded struct. An agent needing "may call this tool but not that one" has nowhere to express it. Permissions attach to maps, not to nodes, edges, agents or workflows.

**Required change.** Generalise to `(subject, action, resource)` grants with the current matrix as the default policy. The existing role matrix should be _preserved_ as a preset — it encodes real thinking.

**Complexity:** Large.

## ARCH-6 · AI is one hardcoded vendor call — **P1**

**Status:** `HARDCODED`

**What exists.** `src/lib/ingest/structure.ts:284` fetches `https://api.anthropic.com/v1/messages` directly, with the model from `serverEnv.INGEST_MODEL` and an `anthropic-version` header inline. Budget capping (`src/lib/ingest/budget.ts`) and run recording are real and good. There is **no provider interface**, no prompt registry, no eval harness, no AI audit trail beyond cost.

**What the vision needs.** AI assistant, node generation, summarisation, classification, recommendations, memory, agents, agent teams, orchestration, an agent marketplace, monitoring and evaluation.

**The gap.** One call site, one vendor, one prompt shape, one use case. There is no seam to add a second AI feature against — the second one would copy the first.

**Required change.** An `AIProvider` interface (complete / stream / embed / tool-call), a prompt registry with versioning, a per-call audit trail, and eval fixtures. Then agents become a consumer of that layer rather than a parallel stack.

**Complexity:** Large.

## ARCH-7 · Canvas caps at 300 nodes — **P2**

**Status:** `FUNCTIONAL_BUT_INCOMPLETE`

**What exists.** `NODE_CAP = 300` (`src/lib/map/layout.ts:35`), viewport culling, ring-one budgets per breakpoint, cluster folding at `CLUSTER_THRESHOLD = 6`, pre-baked glow sprites, and a halo pass skipped during gestures. **This is a well-optimised renderer** — the constraints are deliberate and documented.

**The gap.** "Infinite canvas" and enterprise-scale graphs need level-of-detail, spatial indexing (quadtree), virtualisation and probably WebGL. Canvas 2D at 300 nodes is a correct MVP decision, not a platform one.

**Complexity:** Large. **Not urgent** — 300 nodes is beyond current usage.

## ARCH-8 · SQLite caps horizontal scale — **P1**

**Status:** `ARCHITECTURALLY_WEAK` (for the vision; _correct_ for today)

`better-sqlite3` is synchronous and file-backed (`src/lib/db/client.ts`). Single-node only; no serverless; no read replicas. FTS5 search (`node_search MATCH`, `src/lib/search/query.ts:198`) is likewise single-node.

**This is the right call now** and the wrong one at scale. The repository choke point makes migration tractable — every query already goes through one layer. Migrate when concurrency, not feature count, demands it.

## ARCH-9 · No semantic layer — **P2**

Zero embedding or vector tables. Search is keyword FTS5 only. The vision's semantic search, AI memory, knowledge graphs, deduplication and recommendations all need embeddings. Depends on ARCH-6.

## ARCH-10 · No extension framework — **P2**

No plugin loader, no SDK, no webhooks, no public API surface, no sandbox. The developer ecosystem, plugin/agent/template marketplaces and user-built applications all require this. Depends on ARCH-2 and ARCH-5.

---

# Part 3 — Feature Status Matrix

| Feature                            | Status                      | Evidence                               | What exists                                     | What is missing                | Severity     | Phase |
| ---------------------------------- | --------------------------- | -------------------------------------- | ----------------------------------------------- | ------------------------------ | ------------ | ----- |
| Radial map / canvas                | `COMPLETE`                  | `src/lib/map/`                         | Geometry, layout, camera, renderer, hit-testing | LOD, spatial index, >300 nodes | Low          | 6     |
| Node expand/collapse               | `COMPLETE`                  | `useMapState.ts`                       | Descend, ascend, breadcrumb                     | —                              | —            | —     |
| Nested maps                        | `NOT_IMPLEMENTED`           | no schema                              | —                                               | Node containing a map          | High         | 1     |
| **Node↔node relationships**        | **`NOT_IMPLEMENTED`**       | **no edges table**                     | Parent only                                     | **The entire edge model**      | **Critical** | **1** |
| Cross-map relationships            | `NOT_IMPLEMENTED`           | —                                      | —                                               | Depends on edges               | Critical     | 1     |
| Custom node types                  | `NOT_IMPLEMENTED`           | `types.ts:11` closed union             | 8 fixed types                                   | Registry                       | Critical     | 2     |
| Node actions                       | `NOT_IMPLEMENTED`           | —                                      | `href` only                                     | Action framework               | Critical     | 2     |
| Node permissions                   | `PARTIALLY_IMPLEMENTED`     | `visibility` column                    | 3-value coarse control                          | Object-level grants            | High         | 3     |
| Map CRUD                           | `COMPLETE`                  | `/api/maps`                            | Create, edit, delete                            | —                              | —            | —     |
| Map versioning / history           | `NOT_IMPLEMENTED`           | `maps.version` unused for history      | Column only                                     | Snapshots, restore             | Medium       | 4     |
| Map export / import / embed        | `NOT_IMPLEMENTED`           | —                                      | —                                               | All three                      | Medium       | 5     |
| Sharing & roles                    | `COMPLETE`                  | `sharing/roles.ts`                     | 5 roles, escalation-safe matrix                 | —                              | —            | —     |
| Search (keyword)                   | `COMPLETE`                  | FTS5                                   | Ranked, permission-filtered                     | —                              | —            | —     |
| Semantic / vector search           | `NOT_IMPLEMENTED`           | 0 vector tables                        | —                                               | Embeddings                     | High         | 4     |
| Link-to-Mind-Map                   | `FUNCTIONAL_BUT_INCOMPLETE` | `ingest/pipeline.ts`                   | URL → structure, budgeted                       | PDF, video, docs               | Medium       | 4     |
| Page Watcher                       | `COMPLETE`                  | `lib/watch/`                           | Interests, feed, save                           | —                              | —            | —     |
| Collaboration (SSE)                | `FUNCTIONAL_BUT_INCOMPLETE` | `/stream`                              | Presence, chat, locks                           | Leak; no CRDT                  | High         | 3     |
| Comments / mentions                | `NOT_IMPLEMENTED`           | —                                      | Map chat only                                   | Node comments                  | Medium       | 3     |
| **AI assistant**                   | `NOT_IMPLEMENTED`           | —                                      | Ingest only                                     | Everything                     | Critical     | 4     |
| **Agents / teams / orchestration** | `NOT_IMPLEMENTED`           | —                                      | —                                               | Entire subsystem               | Critical     | 5     |
| **Workflows / automation**         | `NOT_IMPLEMENTED`           | —                                      | —                                               | Entire subsystem               | Critical     | 5     |
| **Jobs / queues / retries**        | `NOT_IMPLEMENTED`           | outbox never drained                   | Table shape only                                | Worker                         | **Critical** | **1** |
| Payments / subscriptions           | `NOT_IMPLEMENTED`           | ADR-0005 defers                        | —                                               | All                            | Critical     | 6     |
| AI usage billing                   | `NOT_IMPLEMENTED`           | `ingest/budget.ts` global cap          | Cost tracking                                   | Per-user metering              | High         | 6     |
| Marketplaces (4 kinds)             | `NOT_IMPLEMENTED`           | —                                      | —                                               | All                            | High         | 7     |
| E-commerce / CRM / PM              | `NOT_IMPLEMENTED`           | `commerce` family exists as a _colour_ | Nothing functional                              | All                            | High         | 7     |
| Organisations / teams              | `NOT_IMPLEMENTED`           | 0 tables                               | —                                               | Tenancy                        | High         | 3     |
| SSO / MFA                          | `NOT_IMPLEMENTED`           | —                                      | Password only                                   | Both                           | High         | 8     |
| Email delivery                     | `BROKEN`                    | never drained                          | Queue only                                      | Provider + worker              | **Critical** | **1** |
| Notifications                      | `PARTIALLY_IMPLEMENTED`     | `/api/notifications`                   | In-app                                          | Email, push                    | Medium       | 3     |
| Moderation                         | `FUNCTIONAL_BUT_INCOMPLETE` | `lib/moderation/`                      | Reports, audit trail                            | No staff assignment path       | Medium       | 3     |
| Analytics                          | `PARTIALLY_IMPLEMENTED`     | `analytics_events`                     | Typed collection                                | No dashboard                   | High         | 3     |
| Observability / logging            | `NOT_IMPLEMENTED`           | 3 `console.*` in `src/`                | —                                               | Structured logging             | High         | 2     |
| Mobile / desktop apps              | `NOT_IMPLEMENTED`           | —                                      | Responsive web only                             | Native shells                  | Medium       | 8     |
| Multi-touch (20/40/60pt)           | `NOT_IMPLEMENTED`           | `pointers.ts` 1–2 pointers             | Pinch/pan                                       | Multi-pointer                  | Low          | 9     |
| Developer API / SDK / webhooks     | `NOT_IMPLEMENTED`           | —                                      | —                                               | All                            | High         | 7     |
| i18n                               | `NOT_IMPLEMENTED`           | strings inline                         | —                                               | Framework                      | Low          | 9     |
| Accessibility                      | `FUNCTIONAL_BUT_INCOMPLETE` | tree view, axe harness                 | Strong foundations                              | No screen-reader pass          | Medium       | 2     |
| LifeMap AI                         | `NOT_IMPLEMENTED`           | —                                      | —                                               | All                            | Medium       | 9     |

---

# Part 4 — Architecture Gap Matrix

| System        | Current                      | Problem                  | Future requirement     | Required change                   | Priority |
| ------------- | ---------------------------- | ------------------------ | ---------------------- | --------------------------------- | -------- |
| Graph         | Tree (`parent_id`)           | Cannot express node↔node | Typed multi-graph      | `node_edges` table + traversal    | **P0**   |
| Node engine   | 8-literal union              | Core edit per type       | Extensible registry    | Type registry + `payload` schemas | **P0**   |
| Async         | None                         | No automation possible   | Jobs, events, agents   | Job table + worker + event bus    | **P0**   |
| Tenancy       | User-owned                   | No enterprise            | Orgs, teams, isolation | `organizations` + `org_id`        | P1       |
| Permissions   | 8 fixed booleans, map-scoped | No object/agent-level    | Grant model            | `(subject, action, resource)`     | P1       |
| AI            | Direct vendor fetch          | One vendor, one use      | Multi-provider, agents | `AIProvider` + prompt registry    | P1       |
| Database      | SQLite, single node          | No horizontal scale      | Multi-instance         | Postgres migration                | P1       |
| Canvas        | Canvas 2D, cap 300           | No large graphs          | Infinite canvas        | LOD + quadtree + WebGL            | P2       |
| Search        | FTS5 keyword                 | No semantics             | Hybrid semantic        | Embeddings + vector index         | P2       |
| Extensibility | None                         | No ecosystem             | Plugins, SDK, webhooks | Extension framework               | P2       |
| Observability | 3 console calls              | Blind in production      | Full telemetry         | Structured logging + tracing      | P1       |

---

# Part 5 — Dependency Graph

```
                    ┌──────────────────────────────┐
                    │ PHASE 1 — FOUNDATIONS (P0)   │
                    │  1a  node_edges (graph)      │
                    │  1b  jobs + events + worker  │
                    │  1c  email delivery ─────────┼──► unblocks MVP
                    └───────────┬──────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
      │ 2 Node engine │ │ 3 Tenancy +   │ │ 2 Observability│
      │   registry    │ │   permissions │ │               │
      └───────┬───────┘ └───────┬───────┘ └───────────────┘
              │                 │
              ▼                 ▼
      ┌───────────────────────────────────┐
      │ 4 AI platform layer               │
      │   provider · prompts · embeddings │
      └───────────────┬───────────────────┘
                      ▼
      ┌───────────────────────────────────┐
      │ 5 Agents + Workflows              │
      └───────────────┬───────────────────┘
                      ▼
      ┌───────────────────────────────────┐
      │ 6 Billing ──► 7 Marketplaces      │
      │              ──► Commerce/CRM/PM  │
      └───────────────┬───────────────────┘
                      ▼
              8 Enterprise · Mobile
                      ▼
              9 LifeMap · i18n · multi-touch
```

**The critical path is `1 → 2 → 4 → 5`.** Nothing in the AI or agent half of the vision can start until the graph, the node registry and the async layer exist.

---

# Part 6 — Roadmap

## Phase 1 — Foundations · Months 1–2 · **P0**

**Objective:** make the architecture capable of the vision. No user-visible features.

| Work                     | Detail                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a · Graph edges**     | New `node_edges(id, map_id, from_node_id, to_node_id, type, payload, created_at)`. Indexes both directions. Repository traversal with depth limits and cycle guards. Renderer reads edges from the table. Parent relationships become `contains` edges so the tree is a view over the graph |
| **1b · Jobs and events** | `jobs(id, type, payload, run_after, attempts, status, last_error)` with a worker loop, exponential backoff and a dead-letter state. `events(id, type, actor, subject, payload)` with subscriptions                                                                                          |
| **1c · Email delivery**  | An `EmailProvider` interface, a real implementation, and `drainOutbox()` as the first consumer of 1b. **Fixes the outstanding MVP blocker as a side effect**                                                                                                                                |

- **Files:** `src/lib/db/migrations.ts` (migration 11), new `src/lib/graph/`, new `src/lib/jobs/`, `src/lib/email/`, `src/lib/map/layout.ts`, `src/lib/map/renderer.ts`
- **Risks:** the renderer change is the delicate part — 83 map tests must stay green. Cycles become possible for the first time; every traversal needs a visited set
- **Definition of done:** two nodes in different maps can be linked with a typed edge and the link renders; a queued job runs, fails, retries and dead-letters; a real email arrives
- **Complexity:** Large

## Phase 2 — Node engine and visibility · Months 2–3 · **P0/P1**

**Objective:** nodes become extensible and the system becomes observable.

- **Node type registry.** Each type declares a zod schema for `payload`, an icon, a renderer, actions and required permissions. Migrate the eight existing types onto it. Nothing switches on the union afterwards.
- **Node actions.** A declarative action framework — a node can expose "run", "sync", "open", "generate".
- **Observability.** Structured logging, request IDs, error tracking wired to the existing `/api/errors`, and the staff dashboard that ADR-0009 promised but never got.
- **Accessibility.** The manual screen-reader pass that has never been done.

- **Definition of done:** a new node type can be added in one file with no core edits.
- **Complexity:** Large

## Phase 3 — Tenancy, permissions, collaboration · Months 3–5 · **P1**

- `organizations` + `organization_members` + optional `org_id` on owned resources. **Cheapest now; the cost rises with every feature added first.**
- Generalise permissions to `(subject, action, resource)` grants, keeping the current role matrix as the default preset.
- Fix the SSE leak (idle timeouts, disconnect cleanup, heartbeat); add node-level comments and mentions.
- Auth hardening: rate limiting, the missing auth tests, password reset, CSP and HSTS.

- **Definition of done:** an organisation owns maps; a user's permissions on a single node can differ from their map role.
- **Complexity:** Large

## Phase 4 — AI platform · Months 5–7 · **P1**

- `AIProvider` interface (complete / stream / embed / tool-call) with Anthropic as the first implementation; **refactor `structure.ts` to consume it**.
- Versioned prompt registry with eval fixtures.
- Embeddings + vector index; hybrid keyword-plus-semantic search.
- Per-call AI audit trail; per-user quotas (extend `ingest/budget.ts` from a global cap).
- AI assistant: node generation, expansion, summarisation — **with human-in-the-loop confirmation before any write.**

- **Definition of done:** swapping providers is a config change; every AI action is attributable and reversible.
- **Complexity:** Very Large

## Phase 5 — Agents and workflows · Months 7–10 · **P1**

- Agent definitions as node types (Phase 2) with scoped tool permissions (Phase 3), isolated memory, and execution on the job runner (Phase 1b).
- Visual workflow builder over the edge model (Phase 1a): triggers, conditionals, multi-step, human approval, retries, logs.
- Agent monitoring and evaluation.

- **Risk:** the highest-risk phase. Agents acting on user data need permission enforcement, spend caps, an audit trail and a kill switch **before** launch, not after.
- **Complexity:** Very Large

## Phase 6 — Monetisation · Months 10–12 · **P2**

Subscriptions, AI credits and usage billing, invoices, the professional-services pipeline (extending the existing `enquiries`). Payments via Stripe — **do not build a payment processor.**

## Phase 7 — Ecosystem · Year 2 H1 · **P2/P3**

Public API, SDK, webhooks, plugin framework with sandboxing, then the four marketplaces (template, plugin, agent, freelancing) on shared infrastructure — **one marketplace framework, four catalogues.** Commerce, CRM and project management as node-type packages, not separate applications.

## Phase 8 — Enterprise and devices · Year 2 H2 · **P3**

SSO, MFA, audit controls, admin dashboards, white-label, private deployment. Mobile shells over the existing responsive web; desktop via Tauri or Electron; offline sync (needs CRDTs — a genuine research task).

## Phase 9 — Long-horizon · Year 2+ · **P4**

LifeMap AI, multi-touch (20/40/60-point), internationalisation, large-format displays.

---

# Part 7 — Roadmap Matrix

| Phase | Horizon | Capabilities                 | Objective                   | Depends on | Risk                            | Done when                                                |
| ----- | ------- | ---------------------------- | --------------------------- | ---------- | ------------------------------- | -------------------------------------------------------- |
| 1     | M1–2    | Edges, jobs, email           | Make the vision expressible | —          | **High** — touches the renderer | Cross-map typed edge renders; job retries; email arrives |
| 2     | M2–3    | Node registry, observability | Extensibility               | 1          | Medium                          | New node type in one file                                |
| 3     | M3–5    | Tenancy, permissions, collab | Multi-user safety           | 1          | Medium                          | Org owns maps; per-node grants                           |
| 4     | M5–7    | AI platform, embeddings      | AI foundation               | 1, 2       | Medium                          | Provider swap is config                                  |
| 5     | M7–10   | Agents, workflows            | Automation                  | 1, 2, 3, 4 | **Very High**                   | Agent runs within permissions, fully audited             |
| 6     | M10–12  | Billing                      | Revenue                     | 3          | Medium                          | Paid subscription end to end                             |
| 7     | Y2 H1   | API, SDK, marketplaces       | Ecosystem                   | 2, 3, 5, 6 | High                            | Third party ships a plugin                               |
| 8     | Y2 H2   | Enterprise, mobile           | Enterprise                  | 3, 6       | Medium                          | SSO login; app in store                                  |
| 9     | Y2+     | LifeMap, i18n, touch         | Long tail                   | All        | Low                             | —                                                        |

---

# Part 8 — Technical Debt and Contradictions

**Genuine debt to address during the phases above:**

1. **`payload TEXT` is untyped and unvalidated.** It is the right hook for ARCH-2, but today anything can go in it. Phase 2 must add per-type zod schemas.
2. **`weight` drives size and glow but never position** (ADR-0002). The vision asks for "relevance-based positioning" — **this is a direct contradiction with a deliberate, well-argued decision.** Do not casually reverse it: the stability of position is what makes the map learnable. If relevance must move nodes, it should be an explicit, temporary lens (the `trending` lens already models this correctly) and never the default.
3. **`free_x` / `free_y` exist for free-form layout** but the layout is polar-only. Either use them or drop them.
4. **The `commerce` family is a colour with no functionality.** The palette promises a capability that does not exist.
5. **20 acceptance harnesses are not in CI.** They only run when someone remembers.
6. **`npm run e2e` is broken** — Playwright Test with no config and no specs.

**Temporary MVP decisions that will become debt:**

| Decision                | Becomes debt when             | Act         |
| ----------------------- | ----------------------------- | ----------- |
| SQLite                  | Concurrency demands it        | Phase 3–4   |
| Tree model              | **Already**                   | **Phase 1** |
| Closed `NodeType` union | Fifth type is added           | Phase 2     |
| Map-scoped permissions  | Agents need tool scopes       | Phase 3     |
| Direct Anthropic call   | Second AI feature             | Phase 4     |
| No orgs                 | First enterprise conversation | Phase 3     |

---

# Part 9 — What must be built, in plain language

**To become the platform in the specification, this codebase needs, in order:**

1. **A real graph.** Right now nodes have exactly one parent and nothing else. Until a node can connect to any other node with a typed, attributed relationship, none of the network, workflow, agent or knowledge-graph vision is expressible. This is the single most important change and it should start immediately, because everything built on the tree in the meantime must be rebuilt.

2. **Nodes that can do things.** Today a node is a labelled circle with an optional link. The vision needs nodes that _are_ agents, workflows and applications. That means a registry where a type declares its own data, rendering, actions and permissions — so adding the hundredth node type is as cheap as the ninth.

3. **A way to run work in the background.** No queue, no scheduler, no events. This blocks all automation, every agent, and — today — every email the app has already promised to send.

4. **An organisation layer**, added now while it is cheap. Every month it is deferred, the migration gets larger.

5. **A permission model that describes actions, not just roles**, so an agent can be given precisely the authority it needs and no more.

6. **An AI layer rather than an AI call site.** One provider interface, versioned prompts, embeddings, per-user metering and an audit trail — then agents are a consumer of that layer instead of a second parallel stack.

**And then, on that foundation:** agents, workflows, billing, marketplaces, commerce, enterprise and mobile become modules rather than rewrites.

**What does not need changing:** the repository choke point, the design-token pipeline, the structural tests, the role matrix's escalation rules, the renderer's performance work, and the honesty conventions (404-not-403, storage-before-email, no invented data). These are assets. Several are better than what most teams have at this stage, and the roadmap above is built to preserve them.

---

## Appendix — Method and limits

**Verified by inspection:** `map_nodes` schema and the absence of any edges table (10 migrations); `NodeType` as a closed union (`types.ts:11`); edge derivation from the parent walk (`layout.ts:209`, `:335`); the role matrix and escalation rules (`sharing/roles.ts`); the direct Anthropic fetch (`structure.ts:284`); `NODE_CAP = 300`; FTS5 search; zero org/team/tenant tables; zero vector tables; zero job/queue/worker modules; `outbox` never drained.

**Not verified:** runtime behaviour under concurrent load; production build (blocked by `EPERM` on `.next` while a dev server runs); the 20 acceptance harnesses against the current tree (Playwright's browser binary is absent on this machine).

**Assumption stated explicitly:** the vision is taken from this request's `product_context` block. Where it contradicts a written ADR — notably relevance-based positioning versus ADR-0002 — the contradiction is flagged rather than silently resolved in either direction.
