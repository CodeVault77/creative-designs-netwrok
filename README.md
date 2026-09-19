# Creative Design Networks

A spatial browser. Destinations, tools, people and your own notes on a map you can learn.

**Current phase: P13 complete — fit to ship.** Foundation and CI (P0); design tokens, primitives, Storybook (P1); 22 routes with guards and responsive chrome (P2); the Community Map, canvas renderer and tree view (P3); node detail in four modes, Coming Soon with interest capture, the lens (P4); the map editor with command-stack undo and local-first autosave (P5); real accounts, a SQLite database with migrations, and an authorisation choke point (P6); share links, visibility, node-viewable, roles and invites, with server-side payload filtering (P7); permission-aware full-text search with a camera snapshot that makes Back restore the map exactly (P8); Link-to-Mind-Map — a guarded fetcher, robots.txt, a heading structurer that costs nothing, and a failure taxonomy where every mode has its own message (P9); Page Watcher — an interest picker, a ranked feed of community content, and an Add-to-map action that turns any card into a node (P10); collaboration — map chat with node mentions, presence, soft locks, an activity log and notifications, over an event log that survives a dropped connection (P11); the revenue node — a public service page, an enquiry form with honeypot-and-timing spam scoring, and enquiries that are stored before they are emailed (P12); QA, accessibility and security — WCAG 2.1 AA clean across 18 surfaces, a keyboard-driven tree audit, an attack-shaped security pass with no critical findings, a load baseline, and reporting plus a moderation queue with an append-only audit trail (P13). Launch is P14.

---

## Quick start

```bash
nvm use                    # Node 20.19+
npm install
cp .env.example .env.local
npm run dev                # http://localhost:3000
```

Before pushing:

```bash
npm run verify             # typecheck + lint + format:check + test
```

## Scripts

| Command                 | Does                                  |
| ----------------------- | ------------------------------------- |
| `npm run dev`           | Dev server                            |
| `npm run build`         | Production build                      |
| `npm run start`         | Serve the production build            |
| `npm run verify`        | Everything CI checks, minus the build |
| `npm run typecheck`     | `tsc --noEmit`                        |
| `npm run lint`          | ESLint, zero warnings tolerated       |
| `npm run format`        | Prettier, write                       |
| `npm test`              | Vitest                                |
| `npm run test:coverage` | Vitest with coverage                  |

## Where things are

```
src/
  app/                     Routes. Server Components by default.
    layout.tsx             Root layout + metadata
    providers.tsx          All client providers, composed once
    api/health/            Liveness endpoint for CI and monitoring
  components/
    ui/                    Design system primitives (P1)
    shell/                 AppShell, TabBar, NavRail, TopBar (P2)
    map/                   MapCanvas, TreeList, Breadcrumb, controls (P3)
    node/                  Detail in 4 modes, 2 presentations (P4)
    account/               Auth form, My Maps, profile (P6)
    sharing/               Share sheet, roles, invites (P7)
    search/                Field, suggestions, filters, results (P8)
    link/                  URL field, stages, structure preview, checklist (P9)
    watch/                 Chip grid, content cards, infinite list (P10)
    collab/                Chat, composer, presence, notifications (P11)
    services/              Service page, capability list, enquiry form (P12)
    moderation/            Report dialog, moderation queue (P13)
    editor/                Map editor, node editor, pickers (P5)
  lib/
    map/                   The map engine — pure logic, no React (P3)
      geometry.ts          Polar layout, fixed angular slots
      camera.ts            World<->screen, anchored zoom, momentum
      layout.ts            Walk, cluster, focus, cull, cap
      renderer.ts          The canvas draw pass
      glowSprites.ts       18 pre-baked halos — never box-shadow
      pointers.ts          pointerId-keyed gestures
      seed.ts              Community Map data
    db/                    THE AUTHORISATION CHOKE POINT
      client.ts            SQLite handle + migration runner. Do not import.
      repo.ts              Every query takes an AuthContext. Read this first.
      migrations.ts        Schema, plus the Postgres RLS policies for prod
    sharing/               THE SHARE PAYLOAD FILTER
      payload.ts           The only thing that builds what a viewer receives
      roles.ts             The role matrix, pure and data-driven
    auth/                  Sessions, scrypt passwords, sign-up/in
    quotas.ts              Abuse ceilings, not a paid tier
    editor/                THE COMMAND STACK — undo across canvas and form
      commands.ts          Command union; every one carries before AND after
      stack.ts             Undo/redo, coalescing, focus-follows-undo
      useEditor.ts         Local-first draft, debounced autosave
    maps/store.ts          Map persistence with optimistic concurrency
    nodes/detail.ts        Node detail model — derives the mode, filters payload
    interest/              Interest capture (ADR-0001's demand signal)
    routes.ts              THE ROUTE REGISTRY — all 22 screens, one source
    auth/                  Stubbed session + guards (P6 replaces the session)
    env.ts                 Environment contract, validated at boot
    analytics/
      events.ts            The full event taxonomy — typed, declared up front
      index.ts             Vendor-agnostic track() facade
    styles/
      StyledComponentsRegistry.tsx   SSR bridge — do not remove
      GlobalStyle.ts       Reset, focus ring, reduced-motion
      tokens.generated.ts  Generated — do not edit
      theme.ts             Density + family on top of the tokens
      motion.ts            Durations that respect reduced motion
      styled.d.ts          Types props.theme everywhere
design/tokens.json         SINGLE SOURCE for every design value
docs/
  00-scope-contract.md     What the MVP is. The answer to "can we just add…"
  02-success-metrics.md    How we know if it worked
  03-analytics-plan.md     Rules around the taxonomy
  04-environments.md       Four environments, secrets, promotion path
  05-definition-of-done.md When a phase is actually done
  06-design-system.md      P1 — tokens, primitives, Storybook
  07-navigation.md         P2 — routes, guards, responsive chrome
  08-radial-map.md         P3 — the map engine, performance, accessibility
  09-node-interaction.md   P4 — detail modes, Coming Soon, interest, the lens
  10-map-editor.md         P5 — command stack, autosave, conflicts
  11-accounts.md           P6 — auth, persistence, the RLS mitigation
  12-sharing.md            P7 — the payload filter, roles, tokens
  13-search.md             P8 — the leakage rules, the camera snapshot
  14-link-to-mind-map.md   P9 — SSRF, robots.txt, the cost path, the failures
  15-page-watcher.md       P10 — the seed, ranking, the honest empty state
  16-collaboration.md      P11 — the event log, replay, leases, realtime cost
  17-revenue-node.md       P12 — spam scoring, the inbox, what is stored first
  18-qa-a11y-security.md   P13 — the audit, the attacks, the load baseline
  decisions/               ADRs. The seven open questions from §25, closed.
CDN-MVP-IMPLEMENTATION-ROADMAP.md   The full blueprint. Section numbers (§n)
                                    referenced throughout the codebase.
```

## Things that will bite you if you don't know them

**styled-components needs both halves of its SSR wiring.** `StyledComponentsRegistry` in `providers.tsx` _and_ `compiler.styledComponents` in `next.config.mjs`. Remove either and the page hydrates through a flash of unstyled white — very visible on a black ground. There is no test for this; check the server HTML contains `data-styled` tags.

**`styled` means Client Component.** Keep route-level components server-rendered and push styling into leaf client components. `app/page.tsx` → `components/FoundationStatus.tsx` is the pattern.

**The map canvas cannot use styled-components or the theme context.** It draws to canvas and has no access to either at draw time. P1's token pipeline emits both a theme object and a plain JS token object for exactly this reason. Per-node styled-components is a performance mistake — see ADR-0008 and §23.

**`NEXT_PUBLIC_` is public forever.** Inlined into the browser bundle at build time, including builds already deployed. Rotating such a value does not un-publish it.

**Adding an analytics event requires two edits.** `AnalyticsEventMap` and the `ANALYTICS_EVENTS` array. Forget the second and the build fails — that is deliberate.

**Design values live in `design/tokens.json` only.** Everything under `src/lib/styles/*.generated.ts` is built from it. `npm run tokens:check` fails CI if you edit one and forget to rebuild.

**Node detail is `?node=<id>`, not a route.** A path segment would remount the map canvas on every selection and lose the camera. Same for the node editor. See `docs/07-navigation.md`.

**Staff routes 404, they never 403.** A 403 confirms the route exists. `requireStaff()` handles this; do not "improve" it into a permission error.

**The dev session is a cookie anyone can set.** `cdn_dev_session=user` or `=staff`. It must not survive into production — P6 replaces it.

**Never put glow on a canvas node with `box-shadow` or `filter`.** Use the pre-baked sprites in `glowSprites.ts`. A blur is a full-surface GPU readback per frame; this is the single decision the map's frame rate rests on.

**Per-frame state lives in refs, not React state.** `MapCanvas` reads camera, layout and gesture state inside `requestAnimationFrame`. A `setState` per `pointermove` re-renders the tree 120 times a second.

**The tree view is not a fallback.** It renders the same graph and the same expansion state as the map, which is why they cannot drift. Changing map state must go through `useMapState`.

**One detail component, four modes, two presentations.** If you are about to add a third sheet, what you probably need is a fifth mode in `NodeDetailBody`. See `docs/09-node-interaction.md`.

**A locked node's payload omits its content server-side.** Never send private fields and hide them in the UI — the browser can read anything it receives.

**Never import `@/lib/db/client` outside the repository.** Every query must go through `repo.ts`, where an AuthContext is a mandatory argument. A direct import can read anyone's rows, and a test fails the build if one appears.

**Ownership goes in the SQL predicate, never a check afterwards.** A fetch-then-compare leaves the row in memory, one log line from a leak.

**Staff read; staff do not write.** Elevated read access for moderation is not edit access.

**Every response reaching a non-owner goes through `buildSharePayload`.** Not just `/s/<token>` — the editor API and the editor page too. Two endpoints returning the same map with different filtering is how one of them ends up wrong; that exact bug was found and fixed by the P7 review.

**A user-supplied URL is an attack.** The fetcher checks the address policy three times — before the request, at every redirect hop, and at TCP connect on the resolved IP. Only the last of those survives DNS rebinding; the first two exist to fail early and honestly. `src/lib/ingest/ssrf.ts` is pure and has a table of sixteen real techniques against it, and `npm run verify:link` fires the same table at the live server.

**The socket is a notification; the database is the truth.** Every realtime event is a durable row with a monotonic id, and the stream only says "catch up from N". A reconnecting client replays exactly what it missed from `Last-Event-ID`. **And a lock is a lease** — `expires_at`, not a flag — because the thing that takes a lock and never releases it is a laptop lid closing. See `docs/16-collaboration.md`.

**404, never 403.** A 403 says "this exists but is not yours", which turns an id into an oracle. Every endpoint, every staff surface and every page follows it; `verify:security` asserts that a real private map and a nonexistent one are indistinguishable.

**An undefined CSS variable fails silently.** `var(--nope)` resolves to nothing — no TypeScript error, no console warning, no visible sign unless you know what the colour should have been. `src/lib/styles/vars.test.ts` walks every source file and fails on any token name the pipeline does not generate, expanding interpolated names across all six families. It was written after `--family-create-core` shipped through a green build; the real name is `--fam-create-core`.

**A search index authorises nothing.** Every read joins back to `maps` and re-applies the same predicate as `repo.ts`. An index queried without permissions is an oracle: you cannot open the document, but you can confirm word by word what is in it. See `docs/13-search.md` for the titles-only rule that closes the same hole for descriptions.

**The payload filter builds a NEW object field by field.** Never spread a stored node and delete fields — a spread makes the default "include", so a field added later leaks until someone remembers.

**Share and invite tokens are bearer credentials, stored hashed.** They are shown once and cannot be displayed again, only replaced.

**Editor forms are controlled by the draft, never by local state.** That is what makes Cmd+Z work inside a text field. A local copy would leave the input showing stale text after an undo.

**A drag is one command, pushed on drop. Typing coalesces.** Never push a command per pointermove or per keystroke — see `docs/10-map-editor.md`.

**Never last-write-wins a map save.** The client sends the version it saw; a stale one is refused with 409.

## Contributing

Read [`docs/05-definition-of-done.md`](docs/05-definition-of-done.md) first. The short version: every screen ships its loading, empty, error and permission states; every interactive thing is keyboard operable with a visible focus ring; permission filtering happens server-side; and a phase is not done until its analytics events are emitting.

Scope changes need a record in [`docs/decisions/`](docs/decisions/) and product-owner approval, not just a code review. §23 rates scope re-expansion as the highest-likelihood risk on the project.
