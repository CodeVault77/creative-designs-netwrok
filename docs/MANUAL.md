# Creative Design Networks — Manual

**How the application works, and how to use it.**

This document sits between the README (setup and scripts) and the numbered specs in `docs/` (which define individual subsystems in detail). It is the connecting narrative: what the product _is_, how a person moves through it, and how the machinery behind each screen actually works.

- **Part I — Using it** is for anyone operating the product.
- **Part II — How it works** is for anyone changing the code.
- **Part III — Running it** is the operator's section.

Where something is unfinished, this manual says so plainly rather than describing the intention as though it were the behaviour. §22 is the honest list, and it is worth reading before any demonstration.

---

# Part I — Using it

## 1. The idea in one paragraph

Most tools organise information as a **list**: folders, rows, search results. Creative Design Networks organises it as a **map**. Everything is a _node_ on a ring around a centre, and you navigate by moving through space rather than by reading down a page. The claim behind the design is that people remember _where_ something was more reliably than _what it was called_ — so position is made stable and meaningful, and never allowed to drift.

That single commitment explains most of the design decisions you will meet.

The second commitment explains the rest: **everything is a node.** A task, an invoice, a contact, an agent, a service you sell — all the same table, drawn as a circle, connected to other circles. There is no separate tasks application and no separate CRM, because a task and a contact are node _types_, not products.

## 2. The two surfaces

The application is really two products sharing one codebase.

| Surface            | Lives at                                         | Who it is for                                |
| ------------------ | ------------------------------------------------ | -------------------------------------------- |
| **Marketing site** | `/`, `/services`, `/services/[slug]`, `/request` | Visitors deciding whether to hire the studio |
| **The app**        | `/app`, `/map`, `/maps`, `/search`, `/you`, …    | People using the product                     |

They are deliberately isolated. A structural test (`src/components/marketing/marketing.test.ts`) fails the build if a marketing component imports anything from the map, editor or canvas modules — the marketing site must stay light enough to load fast, and it must never accidentally ship the map renderer to someone reading a services page.

Short share URLs stay **outside** `/app` on purpose — `/n/<node>`, `/u/<handle>`, `/s/<token>`, `/soon/<node>`. Those are what get pasted into a message, and burying them under a prefix would undo that for no gain.

## 3. Core concepts

You need six words to read any screen.

**Node.** One thing on the map. Every node has a title, a family, a type, a status and a position.

**Family.** One of six categories, each with its own colour: `create` (lime), `discover` (cyan), `services` (orange), `people` (pink), `organise` (violet), `commerce` (teal). Colour is never the _only_ signal — every state also differs in shape, stroke or badge, so the map stays readable to someone who cannot separate two hues.

**Type.** What a node _is_, and therefore what it can do: `topic`, `note`, `link`, `image`, `date`, plus the package types — `task`, `milestone`, `product`, `order`, `invoice`, `contact`, `deal`. A type brings its own fields and its own actions. This is the load-bearing concept behind §16 and §12.

**Ring and slot.** Nodes sit on concentric rings around a centre. Ring one is the first circle out. A node's **slot** is its fixed angular position — slot 0 is twelve o'clock, and the rest run clockwise. _A node's slot never changes because of popularity._ That is ADR-0002, and it is the promise that makes the map learnable: node 7 is always at four o'clock.

**Map.** A collection of nodes with one root. The **Community Map** is the public one everyone shares; your own maps are private by default.

**Centre.** Whatever currently sits in the middle. It starts as the map's root and changes when you descend into a branch.

## 4. First run

Open the app at `/app`. You get the entry screen: a ring in every family colour, the wordmark, and **TAP TO ENTER**. Tapping (or pressing Enter — it is a real link, not a click handler on a div) takes you to `/map`.

The entry screen is deliberately plain HTML and CSS with no JavaScript component behind it, so it paints instantly while the map data loads.

## 5. Reading the map

The Community Map at `/map` shows the centre and ring one — twelve destinations, of which **eight are live and four are Coming Soon**.

**What you will see:**

- **The centre** — a dark circle with the infinity mark. On the Community Map it also carries the three-colour wordmark and "THE CENTRAL NODE"; on other maps it carries the map's name.
- **Ring-one nodes** — a coloured circle with an icon inside and a label below.
- **Connectors** — a thin line from centre to node in the node's family colour, with a dot at the midpoint.
- **A dashed circle with a `SOON` badge** — a node that is planned but not built. Dashed stroke, no glow, and an orange badge: three separate signals, so it never reads as live.
- **A `+5` circle** — a cluster. Ring one is capped by screen width (8 on a phone), so the overflow folds into one node rather than crowding.
- **`DEFAULT · 8 OF 12`** at bottom left — the zoom tier, and how much of the ring is actually on screen. If the second number is larger, some nodes are folded away.
- **`↻ 4 more`** at bottom right — rotates the ring to bring the folded nodes into view.

**The glow means something.** Live nodes glow; Coming Soon and inactive nodes do not. A glowing node is one you can actually use.

### Ring one, by slot

| Slot | Destination             | Opens                     |
| ---- | ----------------------- | ------------------------- |
| 0    | Mind Mapping            | `/maps`                   |
| 1    | Link-to-Mind-Map        | `/create/link`            |
| 2    | AI Tools                | **Coming Soon** (§22)     |
| 3    | Commerce & Payments     | `/commerce`               |
| 4    | Tasks & Projects        | `/work`                   |
| 5    | Active Projects         | expands in place          |
| 6    | Build With Us           | `/services/build-with-us` |
| 7    | Freelance & Marketplace | `/marketplace`            |
| 8    | Page Watcher            | `/watch`                  |
| 9    | Ideas & Innovation      | **Coming Soon**           |
| 10   | People & Networks       | **Coming Soon**           |
| 11   | Partners & Sponsors     | **Coming Soon**           |

## 6. Moving around

| You want to                 | Do this                                           |
| --------------------------- | ------------------------------------------------- |
| Select a node and read it   | **Tap it once.** The detail sheet slides up       |
| Go to what a node points at | **Open** in the sheet, or **double-tap** the node |
| Go _into_ a node's branch   | **Expand** in the sheet                           |
| Go back up                  | Tap a breadcrumb segment at the top               |
| Move between rings          | The `‹‹` / `››` stepper on the left               |
| Zoom                        | `+` / `−` on the right, or pinch                  |
| Recentre                    | The crosshair button                              |
| See everything as a list    | The **Tree** toggle                               |

**Expand descends.** This is the one piece of behaviour worth stating precisely: expanding a node makes it the new **centre**, with its children arranged around it, and adds it to the breadcrumb. It does not fan children out beside their parent. On a phone there is not enough room to show a branch in place, so the map re-roots instead.

**Single tap never navigates away.** Tapping only selects. Leaving the map always takes a deliberate second action, because a stray tap while panning would otherwise throw away where you were.

## 7. The detail sheet

Selecting a node opens a sheet showing: the node's glyph in its family colour, its slot number, its title, its description, a small table of facts (family, type, children, status), and the actions available.

- **Open** — go to what this node points at
- **Expand** — descend into it
- **Copy link** — every node has a shareable URL
- **Report this node** — quiet and last, findable without being prominent

The actions on offer come from the node's **type**. A `task` offers different verbs from a `link`, because the type declares them.

A **Coming Soon** node shows something different: a target window, a **Notify me** button, and a row of _live_ things to try instead. A dead end is the worst thing a Coming Soon screen can be.

A **private** node you cannot see shows its title and position but not its contents. The structure of a map is not secret; what is inside it is.

## 8. Tree view

`/map/tree` is the same data as an accessible list — full keyboard support (arrows to move, `→`/`←` to expand and collapse, Enter to open) and correct screen-reader semantics.

It is not a fallback. A canvas cannot be made properly accessible by bolting labels onto it; the honest answer is a real DOM tree rendered from the _same_ graph and the _same_ expansion state, so the two can never disagree. Some sighted people prefer it too, which is why the toggle is a first-class control.

## 9. Search

`/search` searches every map you can see. Private maps you have no access to are never included in results.

Before you type, you get **RECENT** (your last searches, stored on your device only) and **SUGGESTED** (real live nodes from the Community Map).

Results show the matched terms emphasised, a snippet, and the path to the node. You can view results as a **list** or as a **map**. **Back to Central Node** returns you to exactly the camera position, zoom and expansion state you left — searching does not cost you your place.

Search fuses two rankings — keyword matching and semantic similarity — by reciprocal rank, so a query that shares no words with a node can still find it.

## 10. Accounts and security

Sign up at `/sign-up` with a name, an email and a password of **at least 10 characters**. There are deliberately no "one uppercase, one symbol" rules — those push people toward `Password1!` and into reuse. Length is what actually costs an attacker anything.

Sign-in never tells you whether an email exists. Sign-_up_ does, because otherwise you cannot tell a typo from a forgotten account.

**Two-factor authentication** is at `/settings/security`. Once confirmed, sign-in pauses at `/sign-in/verify`, a screen reachable only by a session that exists, is unexpired, and has not yet satisfied the second factor. Recovery codes are issued once and stored hashed.

Sign-in attempts are limited on **both** the account and the client, and both must pass — limiting only the account lets an attacker lock you out of your own login, and limiting only the client lets a botnet spread thin enough never to trip.

> **No surface yet:** password reset. The logic is built and tested (`src/lib/auth/reset.ts`) but has no route and no page, so a forgotten password still cannot be recovered. The sign-in form withholds the "Forgot password?" link deliberately rather than pointing it at a 404. See §22.

## 11. Your maps

`/maps` lists your maps and maps shared with you. Create one with the **+** button on the map screen or **New map** here. You choose a name and a starting template (Blank, Project, Research, Business, Learning, Personal). **Maps are private by default.**

## 12. The map editor

Opening one of your maps gives you the editor:

- **+** adds a node
- **Drag** a node onto another to reparent it
- **Tap** a node to edit its title, type and family
- **Undo / redo** in the top bar
- Changes **autosave** — the status pill says so

Choosing a node's **type** is what gives it behaviour. Pick `task` and it gains a status and a due date; pick `invoice` and it gains an amount in integer cents. Those fields are declared by the type, validated on save, and are what makes the collections in §16 possible.

Saves are version-checked. Two people editing the same map at once produce a visible conflict rather than a silent overwrite.

## 13. Sharing and collaboration

From a map, **Share** gives you three levels:

| Level       | Who can open it                        |
| ----------- | -------------------------------------- |
| **Private** | Only you and people you invite         |
| **Link**    | Anyone with the URL                    |
| **Public**  | Anyone, and it appears on your profile |

You can invite individuals by email with a role — **viewer**, **commenter** or **editor** — at `/maps/<id>/collaborators`. Invitation emails are delivered when an email provider is configured (§29); without one they queue and stay queued.

Permissions can be narrowed **below** the map role, down to a single node: one node of an otherwise readable map can be closed to a particular person. A node-level allow can also restore something the map denied, so "everyone except Sam, and Sam only on this one node" is expressible.

While several people are on a map you get **presence** (who is here, what they have selected), **chat** at `/maps/<id>/chat` that does not require leaving the canvas, and per-node **comments with @mentions**.

## 14. Link-to-Mind-Map

`/create/link` turns a web page into a map. Paste a URL, and the page is fetched, read and proposed as a structure you can edit before saving — you choose the depth and untick anything you do not want. Nothing is saved until you approve it.

Without an `ANTHROPIC_API_KEY` configured — or if the monthly spend cap is reached — it returns a simple three-node starter instead of a full reading. The interface says clearly when that has happened; it does not pass a stub off as a real analysis.

## 15. Page Watcher

`/watch` lets you pick interests and browse what the community is publishing. `/watch/feed` is the ranked feed. You can save items or add them straight to one of your maps.

## 16. Collections: Work, Commerce, Contacts

Once nodes carry types, they collect.

| Screen      | Gathers                       |
| ----------- | ----------------------------- |
| `/work`     | `task`, `milestone`           |
| `/commerce` | `product`, `order`, `invoice` |
| `/contacts` | `contact`, `deal`             |

Each lists every node of those types across **every map you own or are a member of**, with the map it came from, tabs counting each type, and totals — overdue items for Work, recorded value for Commerce.

These are **lenses, not a second place where work lives.** There is deliberately no editing here: every row links back to the node on its own map, where it has its context. Change it there and it is changed everywhere, because there is only one row.

The scope is narrower than ordinary map visibility on purpose. A stranger's public map is not your work, and staff get **no bypass** into anyone's task list.

## 17. Marketplace

`/marketplace` is one framework serving four catalogues: **templates** (maps), **plugins**, **agents**, and **freelancers**.

- Buying a **template** copies the map into your account — with fresh node ids, parent pointers remapped, and **private** whatever the original was. It does not give you access to the author's original.
- Ordering a **plugin** records entitlement; you install it afterwards, with the consent screen in front of you. A purchase never silently grants a third party access to your maps.
- Buying an **agent** copies its definition — name and instructions — and not its tool grants, which are authority over the author's maps, not yours.
- Hiring a **freelancer** raises an enquiry in that person's pipeline (§21), not in a second inbox nobody reads.

Free listings deliver immediately. Paid listings record a pending order and deliver nothing until the billing layer confirms the money arrived — the alternative is giving the thing away and hoping.

Every listing goes through one shared review queue before it appears.

## 18. Plugins

`/settings/plugins` shows what you have installed and what you could install.

**A plugin ships no code that runs on our servers.** It declares node types as _data_, receives signed webhooks at its own address, and acts back through the public API with a key whose permissions are the intersection of what it asked for and what you granted. The trust boundary is the network — separate machine, separate process, separate operator.

Installing is the consent moment, and the only one. A plugin cannot obtain more permission by publishing a new version; the installation is flagged for re-consent and keeps its old grant until you agree again. Removing a plugin destroys its key and its webhook in the same transaction.

## 19. Agents and workflows

`/maps/<id>/agents` and `/maps/<id>/workflows`.

An agent is a node with instructions and a set of tools. It runs **as you**, never above you: a tool grant narrows what you can do and never widens it, so an agent cannot touch a node you were denied, and revoking your own access revokes the agent's in the same instant.

Four independent brakes, re-checked before **every step** rather than once at the start: a global kill switch (staff, at `/admin/agents`), a per-agent switch, a spend cap, and a hard step ceiling. No tool an agent can call deletes anything, so the worst case is noise you remove rather than loss.

The workflow builder covers triggers, conditionals, multi-step runs, human approval, retries and logs.

## 20. Plan and credits

`/settings/billing` shows your AI credit balance, the plan you are on, invoices, and your credit history.

**There is no card field anywhere in this product.** Every button that touches money navigates to a Stripe-hosted page. Credits are integers, money is integer cents, and the credit ledger is append-only — the balance is the sum of the rows, never a stored total that can disagree with them.

Only the **free** plan ships. See §22.

## 21. Organisations, and the studio's own screens

`/settings/organisation` covers organisation membership, SSO (OIDC), branding and the audit log. An organisation can own maps; a person's role on a map still beats their role in the organisation.

Staff-only screens, all of which 404 rather than 403 for everyone else — a 403 confirms the route exists:

| Screen              | For                                               |
| ------------------- | ------------------------------------------------- |
| `/admin/dashboard`  | Health, errors, support queue, activation funnels |
| `/admin/pipeline`   | The professional-services pipeline                |
| `/admin/moderation` | Reports and moderation actions                    |
| `/admin/plans`      | Configuring plans against Stripe prices           |
| `/admin/agents`     | The global agent kill switch                      |

## 22. What does not work yet

Stated plainly, because a manual that describes intentions as behaviour is worse than no manual.

| Feature              | Reality                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AI Tools**         | The whole layer — provider, prompt registry, embeddings, an assistant that proposes changes for you to approve — is built and reachable **only from code**. No screen. This is why its ring-one node is still dark |
| **Password reset**   | Logic built and tested; **no route and no page**. A forgotten password cannot be recovered                                                                                                                         |
| **Three ring nodes** | Ideas & Innovation, People & Networks, Partners & Sponsors are genuinely unbuilt. Each opens a real Coming Soon page with a target window and a notify-me                                                          |
| **Paid plans**       | Only `free` is seeded. A paid plan needs its price created in Stripe first, and the app refuses to record one without a `price_…` id rather than failing at checkout in front of a customer                        |
| **Email**            | Delivered only when `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` are set. Otherwise messages queue and stay queued — the provider refuses to silently drop mail                                                    |
| **Closed beta**      | `BETA_MODE=closed` is read by `src/lib/launch/beta.ts` but is **not wired into sign-up**, so it still has no effect                                                                                                |
| **Support form**     | The backend accepts support messages; there is no form to submit one                                                                                                                                               |
| **Collections**      | Read-only by design. Editing happens on the map                                                                                                                                                                    |
| **Onboarding**       | No guided first run                                                                                                                                                                                                |
| **`npm run e2e`**    | Still broken — invokes Playwright Test with no config and no spec files. Use the `verify:*` scripts                                                                                                                |

If you are demonstrating this, the safe path is: map → node detail → expand → tree → search → a map of your own → a typed node → `/work`. Avoid AI Tools and anything that promises a password reset.

---

# Part II — How it works

## 23. Architecture

```
Browser
  │
  ├── Server Components ──► lib/* ──► repositories ──► SQLite
  │     (most pages)                    (AuthContext required)
  │
  ├── Client Components ──► /api/* route handlers ──► same repositories
  │     (map canvas, forms, editor)
  │
  └── Third parties ──────► /api/v1/* ──► gateway (API key + scopes) ──► same repositories
```

Next.js App Router. Most pages are **server components** that read the database directly through repositories. Anything interactive — the map canvas, forms, the editor — is a client component that talks to a route handler under `src/app/api/`.

There are **62 route handlers, 79 tables across 19 migrations, and 45 page routes.**

Migrations are forward-only, numbered, additive first, and recorded in `_migrations` so each runs exactly once.

## 24. The authorisation choke point

**This is the most important thing to understand before changing any data code.**

Every repository function takes an `AuthContext` as its **first argument**. That context decides which rows the caller can see. Nothing reaches around it.

This is enforced _structurally_, not by convention: `src/lib/db/chokepoint.test.ts` walks the whole source tree and **fails the build** if any module outside an explicit allow-list imports the raw database handle. Each allow-listed module carries a written justification, and the test also fails if anything under `app/` touches the database at all.

If you need direct database access, the honest options are to put your query in a repository, or to add yourself to the allow-list with an argument that survives review. Do not weaken this test.

## 25. The map rendering pipeline

Four stages, each in its own module under `src/lib/map/`:

```
graph ──► layout.ts ──► renderer.ts ──► <canvas>
             ▲
         geometry.ts (where a node sits)
         camera.ts   (what is on screen)
```

**`geometry.ts`** — pure maths. `slotAngle()` fixes a node's angle from its slot; `placePolar()` converts that to coordinates. Ring one is an **ellipse**, not a circle: a portrait phone has far more room above and below the centre than beside it, so the vertical radius stretches to use it while every angle stays exactly where it was.

**`layout.ts`** — decides what to place. Applies the lens filter, caps ring one to the viewport's budget (`tokens.map.ring1Max`), folds the overflow into a cluster, culls anything off screen, and returns `PlacedNode[]`.

**`camera.ts`** — pan, zoom, momentum, and the world↔screen conversion.

**`renderer.ts`** — paints, in a fixed order: **edges → halos → bodies → labels**. Halos composite additively, so drawing them in one contiguous pass lets overlapping glows accumulate correctly.

**Two performance decisions worth knowing.** Glows are pre-baked sprites, because a canvas `filter: blur()` is ruinous per frame. And during an active pan or pinch the halo pass is skipped entirely — the eye cannot resolve a soft glow on a moving object, and that pass is about 60% of a frame.

**Canvas cannot read CSS variables.** The renderer imports concrete values from `tokens.generated.ts`. This is the one place the token indirection breaks down, and it is called out in the code.

## 26. The node type registry

`src/lib/nodes/registry.ts` is where a type declares everything the rest of the system needs: its label, icon, availability, payload schema and actions. Core code asks the registry; it never switches on a literal.

This is what makes "commerce, CRM and project management are node types, not applications" true rather than aspirational. `src/lib/nodes/packages.ts` registers the three packages; adding a fourth is one file.

Payload schemas are `passthrough`, never `strict`. The `payload` column has been free-form since the first migration, so rows already carry keys no current schema knows about — under `strict` those are destroyed on the next save. Validation is worth having, but not at the price of deleting a user's data because a key predates its schema.

## 27. Design tokens

`design/tokens.json` is the single source. `scripts/build-tokens.mjs` generates two files:

- `src/lib/styles/tokens.generated.ts` — for TypeScript and the canvas
- `src/lib/styles/cssVars.generated.ts` — for styled-components

**Never edit the generated files.** `npm run tokens:check` fails the build if they are out of step with the source.

**A trap worth knowing:** an undefined CSS variable renders as _nothing_, silently. `--space-5` was used 14 times and did nothing at all for four phases. `src/lib/styles/vars.test.ts` now fails the build if any `var(--…)` reference has no definition. Keep its allow-list empty.

## 28. Authentication

Passwords are hashed with **scrypt** (`src/lib/auth/password.ts`). Sessions are opaque tokens in an `httpOnly`, `sameSite: lax` cookie, `secure` in production (`src/lib/auth/session.ts`), stored **hashed** — a leaked database yields no working sessions.

MFA secrets are encrypted at rest with `MFA_ENCRYPTION_KEY`; recovery codes are hashed like passwords.

Rate limiting (`src/lib/auth/rate-limit.ts`) is **durable**, in the database rather than in a per-process map — the earlier version reset on every deploy, multiplied its own allowance by the instance count, and leaked memory an anonymous POST could drive.

Server components call `getSession()`; protected pages call `requireAuth(returnTo)`, and staff pages call `requireStaff()`, which renders 404.

There is no `middleware.ts` — authorisation is per-route. This works, but it means a new route that forgets to call `requireAuth` is unprotected with nothing to catch it. Worth remembering when adding one.

## 29. Jobs, events and email

Nothing calls anything else directly. Something happens, an **event** is recorded, and whoever cares picks it up as a **job**.

```
share a map ──► emit('map.shared') ──► event row (durable)
                                   └─► enqueue subscribers ──► queue
                                                                 ├─► email
                                                                 └─► webhook
```

Two things happen on emit: the event is **written** (durable, queryable, survives a restart) and subscribers are **enqueued as jobs** (retried, exponentially backed off, dead-lettered). Deliberately not "call the subscriber now" — a slow or throwing subscriber would otherwise fail the request that emitted the event, letting an incidental consequence break the primary action.

The event id is the dedupe key, so a retried emit produces the same job rather than a second effect.

**Email** goes to an outbox and is drained by a job. The provider is Resend over `fetch` — chosen over SMTP because it needs no dependency and adds no socket-level failure surface. If `EMAIL_PROVIDER=resend` but the key is missing, it **refuses to drop mail** rather than pretending to send.

## 30. Sharing tokens

A share link is a random token in `share_tokens` carrying a role and an optional expiry. `/s/[token]` resolves it.

**An invalid token returns 404, never 403.** A 403 confirms that a map exists, which turns the endpoint into an oracle for guessing IDs.

## 31. Collaboration

Presence, chat, activity and locks run over **Server-Sent Events** at `/api/maps/[mapId]/stream`. Clients reconnect with `Last-Event-ID` and replay what they missed. Locks and presence are **leases with a TTL**, so a client that disappears cannot hold a node forever.

The stream cleanup bug recorded in earlier versions of this manual is fixed: idle timeouts, disconnect cleanup and a heartbeat.

## 32. The AI platform

`src/lib/ai/` is a provider seam, not a call site.

- `provider.ts` — the interface (complete / stream / embed / tool-call). `AIFailure` distinguishes `timeout` from `unavailable`, because they call for different responses.
- `anthropic.ts` — the first implementation. Swapping providers is a config change.
- `prompts.ts` — a versioned registry with eval fixtures. A drift test ties prompt text to the limits it claims, so a prompt cannot silently disagree with the code that clamps its output.
- `gateway.ts` — owns quota and the per-call audit trail. Every AI action is attributable.
- `assistant.ts` — only ever produces **proposals**. Nothing is written without a human accepting it.

Credits are provisioned lazily and month-keyed, so an existing account is not locked out by having no ledger rows.

## 33. Agents and safety

`src/lib/agents/`. The design rule is that an agent's authority is a **narrowing** of its owner's, never an addition to it.

Two independent gates on every tool call: does this agent hold this tool (`agent_tool_grants`, deny by default), and may its owner do this here (`canOnNode`, per resource). The second is the one that matters.

`preflight` is re-checked before **every step**, not once per run. A missing `agent_controls` row reads as **stopped** — fail closed. No tool matches `/delete|remove|drop/`.

## 34. The public API, webhooks and plugins

**`/api/v1/*`** authenticates by header only, never by session cookie. A browser attaches cookies to cross-site requests automatically, so an API that also accepted a session would be callable by any page the user visits — CSRF on every endpoint at once. A key must be presented deliberately, which is what makes the API safe to serve cross-origin.

Keys are `cdn_live_<prefix>_<secret>`. The prefix is indexed and stored in clear, so verification is one indexed lookup plus one constant-time comparison rather than a scan over every hash — which would be a denial-of-service vector as well as slow. The secret is stored as a SHA-256 digest; a 256-bit random secret does not need a slow KDF, and a KDF on every request would be a real cost on a hot path.

`isStaff` on a key context is **always false**, whoever owns it. A leaked long-lived staff credential would read every map in the system.

**Outbound webhooks** are signed HMAC-SHA256 over `timestamp.payload` — the same scheme we verify from Stripe, so a third party's existing verification code transfers. The timestamp is inside the signed string, so a captured delivery cannot be replayed indefinitely. Destinations are checked against the SSRF policy at publish time _and_ at endpoint creation. Endpoints auto-disable after repeated failures.

**Plugins** run nowhere near this process. `src/lib/plugins/manifest.ts` explains at length why: `vm` is not a security boundary, `isolated-vm` still shares a process, and a WASM host ends up reimplementing the operating system. The boundary is the network. A plugin contributes declarative node types — a field list _we_ compile into a schema, never a validator or regex from a stranger — namespaced `<slug>.<type>` so it can shadow neither a built-in nor another plugin.

## 35. The marketplace framework

One table, one review queue, one rating implementation, four catalogues. What genuinely differs per kind is: what `target_id` points at, whether that target is valid, and what fulfilling an order means. That is three functions in `src/lib/marketplace/kinds.ts`, not three tables.

`ownsTarget` is checked at create, at submit **and** again at delivery, because the world moves under a long-lived row.

## 36. Enterprise

`src/lib/enterprise/` — OIDC SSO, an append-only audit log, branding and white-label URLs. The audit log is deliberately separate from the event log: merging them would mean either the audit log inheriting every internal event or the event log being held to audit retention. There is no update and no delete beyond the retention sweep.

## 37. Offline sync

`src/lib/sync/` — a hybrid logical clock and a CRDT scoped to what the map's data model actually needs. The roadmap called this "a genuine research task" and was right; the module is explicit about the boundary of what it does and does not converge, because a "CRDT" that claimed more than it delivered would be worse than none.

`/offline` is the surface.

## 38. Internationalisation and display surfaces

`src/lib/i18n/` handles messages, interpolation and the `Intl` formatters — with real plural rules, because `"Deleted " + count + " nodes"` is wrong in most languages and English is why English-speaking developers do not notice.

`src/lib/display/surfaces.ts` distinguishes display surfaces by more than CSS pixel width: an 86-inch board and a phone can report similar values and are not remotely the same thing.

## 39. Analytics

First-party by decision (ADR-0009). `track()` is the only call product code makes; events go to `/api/analytics` and into `analytics_events`. No vendor SDK, no cross-site identifier, nothing leaves the server.

The event map in `src/lib/analytics/events.ts` is **typed**: an undeclared event name is a compile error. That is deliberate — it keeps the taxonomy from sprawling.

## 40. Testing

| Layer             | Tool               | Where                                                        |
| ----------------- | ------------------ | ------------------------------------------------------------ |
| Unit and logic    | Vitest             | 47 files, **1,397 tests**                                    |
| Structural guards | Vitest             | choke point, CSS vars, marketing coupling, template literals |
| Acceptance        | Playwright drivers | `scripts/verify-*.mjs`                                       |

The **structural guards** are the unusual part, and the most valuable: they catch classes of silent failure rather than individual bugs — a module reaching around the repositories, an undefined CSS variable, the marketing site importing the map, a backtick terminating a styled template literal.

Security-sensitive modules are tested **negatively first**. That habit has caught real defects on their first run, including a rate limiter that collided every same-second attempt into one row and a plan retirement that violated a foreign key.

> `npm run e2e` is still broken — it invokes Playwright Test, but there is no config and no spec files. Use the `verify:*` scripts instead.

---

# Part III — Running it

## 41. Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open **http://localhost:3000**. The database is created automatically on first run; migrations apply themselves.

## 42. Everyday commands

```bash
npm run dev              # development server
npm run verify           # tokens + typecheck + lint + format + tests — the gate
npm run test             # tests alone
npm run build            # production build (stop all dev servers first)

npm run verify:map       # acceptance harness for the map
npm run verify:a11y      # accessibility pass
npm run verify:security  # security pass
npm run verify:forms     # form validation pass
```

`npm run verify` is the gate. If it is green, the branch is in a committable state.

## 43. Environment variables

| Variable                         | Required          | Notes                                                                   |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`           | Yes               | Absolute URLs in share links, emails and Stripe return URLs             |
| `NEXT_PUBLIC_ANALYTICS_PROVIDER` | Yes               | `beacon` to record, `console` to log only                               |
| `APP_ENV`                        | Yes               | Drives `isProduction`                                                   |
| `ANTHROPIC_API_KEY`              | No                | Without it, ingest returns a stub and AI features are unavailable       |
| `INGEST_MODEL`                   | No                | Overrides the default model                                             |
| `INGEST_MONTHLY_USD_CAP`         | No                | Defaults to 50                                                          |
| `INGEST_HASH_SALT`               | **In production** | Has a working default — **change it**, or client hashes are predictable |
| `EMAIL_PROVIDER`                 | No                | `resend` to deliver; anything else queues without sending               |
| `RESEND_API_KEY`                 | With Resend       | Missing it makes the provider refuse rather than drop mail              |
| `EMAIL_FROM`                     | With Resend       | Sender address                                                          |
| `JOB_RUNNER_TOKEN`               | **In production** | Authorises the queue drain endpoint                                     |
| `STRIPE_SECRET_KEY`              | For billing       | Absent, billing reports itself unconfigured rather than erroring        |
| `STRIPE_WEBHOOK_SECRET`          | For billing       | Signature verification; without it webhooks are refused                 |
| `MFA_ENCRYPTION_KEY`             | **For MFA**       | Encrypts TOTP secrets at rest                                           |
| `ENTERPRISE_BASE_URL`            | No                | White-label and SSO callback base                                       |
| `BETA_MODE`                      | No                | Currently has no effect (§22)                                           |
| `APP_VERSION`                    | No                | Reported by the health endpoint                                         |

## 44. Deployment constraint

**SQLite via `better-sqlite3` is synchronous and file-backed.** It cannot run on serverless platforms — every instance would get its own ephemeral database and users would see different data per request.

Deploy to a **single-node host with a persistent volume** (Fly.io, Railway, a VPS). Moving to Postgres later is tractable because every query already goes through a repository, but it is not necessary at closed-beta scale.

The job queue needs a drain to be called on a schedule, authorised by `JOB_RUNNER_TOKEN`. Without it, email and webhooks queue and never leave.

## 45. Traps that will cost you an hour

Collected from real incidents in this codebase.

1. **A backtick inside a CSS comment in a styled template literal terminates the literal.** The parser error that follows points somewhere unhelpful. This happened at least eight times and twice took the dev server down. `src/lib/styles/template-literals.test.ts` now catches it. Write `min-height: 0`, not `` `min-height: 0` ``, inside styled CSS comments.

2. **`position: fixed` is not always viewport-relative.** `transform`, `filter`, `backdrop-filter`, `perspective`, `contain` and `will-change` on any ancestor create a containing block. The top bar's `backdrop-filter` once confined a full-height drawer to a 56px strip. The symptom looks exactly like a z-index bug and is not. `Sheet` now portals to `document.body`.

3. **An undefined CSS variable does nothing, silently.** See §27. Two invented tokens (`--text-display-s`, `--space-5`) were caught by `vars.test.ts` during Phase 6 alone.

4. **A token can exist, be asserted in a test, and never be read by any code.** `ring1Max` was declared and tested for four phases while the layout ignored it. Assert on behaviour, not on constants.

5. **SQLite stores UTC with a space separator, and `new Date()` parses that as local.** Comparing an expiry in JavaScript shifts it by the server's offset, so a fresh token reads as already expired west of UTC. Compare timestamps **in SQL**. This bit password reset and then API key expiry.

6. **`COALESCE` cannot distinguish "leave it alone" from "clear it".** Any nullable field that a user can deliberately empty needs its own "was it supplied" flag.

7. **The dev server holds `.next`.** `npm run build` fails with `EPERM` unless every dev server is stopped first.

8. **PowerShell's `Set-Content -Encoding utf8` writes a BOM and CRLF**, which breaks the format check. Normalise after any scripted edit.

---

## Where to go next

| You want                                  | Read                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| Setup and scripts                         | `README.md`                                              |
| The long-term architecture and phase plan | `CDN_PLATFORM_ARCHITECTURE_AUDIT_AND_ROADMAP.md`         |
| What is unfinished at MVP scope           | `CREATIVE_DESIGN_NETWORKS_MVP_IMPLEMENTATION_ROADMAP.md` |
| A subsystem in depth                      | `docs/06`–`docs/18`                                      |
| Why something is the way it is            | `docs/decisions/`                                        |
