# Creative Design Networks — MVP Implementation Roadmap

**Audit date:** 2026-09-02
**Auditor:** Codebase audit against the working tree at `c:\Users\HP\creative-design-network-screen-design`
**Method:** Static inspection of source, migrations, routes, config and tests, plus a live dev server on `:3001`.

> **How to read this document.** Every finding is marked **[CONFIRMED]** (verified by reading the code, with a file reference) or **[UNVERIFIED]** (could not be checked in this environment — stated as a question, not a fact). Recommendations are marked **[RECOMMENDATION]** and are opinions, not findings.
>
> A route, table or component existing is _not_ treated as evidence that a feature works. Where a workflow was traced end to end, the trace is given.

---

## 1. Executive Summary

Creative Design Networks is a Next.js 15 / React 19 / TypeScript application implementing a radial "spatial browser" — a map of nodes you navigate, plus accounts, sharing, search, page ingestion, collaboration and a marketing site. It is substantially built: **34 API routes, 30 database tables, 28 page routes, 679 passing tests across 20 test files**, and a token-driven design system with structural guards.

The code quality is high in the areas that are finished. The gaps are not sloppiness — they are **unfinished seams between built components**, and a small number of them are severe.

### The five findings that matter most

| #   | Finding                                                                                                                                          | Severity                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 1   | **No email is ever sent.** `queueEmail` writes rows; nothing ever reads them. Invites, acknowledgements and confirmations silently never arrive. | **P0**                                |
| 2   | **Nothing has ever been committed to git.** Zero commits; 165 changed files. The entire project exists only as working-tree state.               | **P0**                                |
| 3   | **The beta gate is dead code.** `BETA_MODE=closed` has no effect — `redeemCode()` has zero callers.                                              | **P0 (if a closed beta is intended)** |
| 4   | **Authentication has no tests.** `src/lib/auth/` is 6 modules, 0 test files — the one subsystem where a silent regression is unrecoverable.      | **P1**                                |
| 5   | **No CSP, no HSTS, no rate limiting on 28 of 34 API routes.**                                                                                    | **P1**                                |

### What is genuinely done

P0–P13 of the original roadmap are implemented and tested: design tokens, navigation shell, radial map with canvas renderer, node detail, map editor, accounts, sharing, search, page ingestion, page watcher, collaboration, revenue nodes, and an accessibility/security pass. The marketing site (Milestones A–C) is complete with its own acceptance harnesses.

### What is not

**P14 (Launch) is roughly 40% done.** The library modules exist (`src/lib/launch/`) and typecheck; almost none of them are wired to anything. There is no launch dashboard, no onboarding, no backup/restore, and no `verify-launch.mjs`.

### Honest scope estimate

Closing the P0 and P1 items is **1–2 weeks** of focused work, dominated by email delivery, the beta gate, auth tests and a production hosting decision. The application does not need rewriting; it needs its last seams closed.

---

## 2. Current Application Architecture

```
src/
  app/
    (marketing)/        Public site: /, /services, /services/[slug], /request
    (app)/              Product: /app (entry), /map, /maps, /search, /you, …
    api/                34 route handlers
  components/
    brand/              Server-safe logo mark
    marketing/          Landing surface (guarded against importing the app)
    map/ node/ editor/  The product surface
    shell/ ui/          Chrome and primitives
    account/ search/ …  Feature components
  lib/
    db/                 better-sqlite3 client, migrations, repositories
    map/                Geometry, layout, canvas renderer, camera, hit-testing
    auth/ sharing/ search/ ingest/ watch/ collab/ moderation/ launch/
    styles/             Generated tokens + CSS variables
docs/                   Scope, metrics, ADRs 0001–0009
scripts/                20 hand-rolled acceptance harnesses + token build
```

**Architectural decisions worth knowing** (all documented in `docs/decisions/`):

- **ADR-0008** — styled-components, not Tailwind. Tokens are generated into both TS and CSS variables by `scripts/build-tokens.mjs`.
- **ADR-0009** — first-party analytics. No vendor SDK; events go to `analytics_events`.
- **ADR-0002** — popularity never moves a node. Position is fixed by slot.
- **The authorisation choke point** — every query takes an `AuthContext` as its first argument, enforced structurally by `src/lib/db/chokepoint.test.ts`, which fails the build if any module outside an explicit allow-list imports the raw database handle.

That last one is the strongest thing in the codebase and should not be weakened.

---

## 3. Technology Stack

| Layer      | Choice                                            | Notes                                     |
| ---------- | ------------------------------------------------- | ----------------------------------------- |
| Framework  | Next.js 15.5.24 (App Router)                      | Server components by default              |
| UI         | React 19, styled-components v6                    | SWC transform enabled for SSR             |
| Language   | TypeScript, `strict` + `noUncheckedIndexedAccess` | `src/tsconfig.json`                       |
| Database   | SQLite via `better-sqlite3`                       | **Synchronous, single-file, local disk**  |
| Validation | zod                                               | Used at API boundaries                    |
| Tests      | Vitest (679 tests / 20 files)                     | Plus 20 Playwright-driver scripts         |
| Build gate | `npm run verify`                                  | tokens → typecheck → lint → format → test |

**[CONFIRMED] The build gate is honest.** `next.config.mjs` sets `typescript.ignoreBuildErrors: false` and `eslint.ignoreDuringBuilds: false`, so a type or lint error fails the production build rather than shipping.

---

## 4. Current MVP Feature Inventory

34 API routes, grouped:

- **Auth (3)** — `auth/sign-in`, `auth/sign-up`, `auth/sign-out`
- **Maps (9)** — `maps`, `maps/[mapId]`, `+/activity`, `/chat`, `/lock`, `/members`, `/presence`, `/share`, `/stream`
- **Nodes & search (3)** — `nodes/[nodeId]`, `search`, `share/[token]`
- **Ingest (3)** — `ingest/preview`, `ingest/run`, `ingest/save`
- **Watch (4)** — `watch/add-to-map`, `watch/feed`, `watch/interests`, `watch/save`
- **Marketing (4)** — `enquiries`, `newsletter`, `service-request`, `interest`
- **Ops (5)** — `analytics`, `errors`, `health`, `support`, `moderation`
- **Other (3)** — `notifications`, `profile`, `reports`

30 tables across 10 forward-only migrations (`src/lib/db/migrations.ts`): `initial_schema`, `sharing`, `search`, `ingest`, `page_watcher`, `collaboration`, `enquiries`, `moderation`, `launch`, `marketing_forms`.

---

## 5. Feature Completeness Matrix

| Feature                   | Status                 | Frontend      | Backend    | Database | Integration     | Priority | Blocking? | Required work                                           |
| ------------------------- | ---------------------- | ------------- | ---------- | -------- | --------------- | -------- | --------- | ------------------------------------------------------- |
| Design system / tokens    | Fully Implemented      | ✅            | n/a        | n/a      | n/a             | —        | No        | —                                                       |
| Radial map + renderer     | Fully Implemented      | ✅            | ✅         | ✅       | n/a             | —        | No        | —                                                       |
| Node detail sheet         | Fully Implemented      | ✅            | ✅         | ✅       | n/a             | —        | No        | —                                                       |
| Tree view (a11y peer)     | Fully Implemented      | ✅            | ✅         | ✅       | n/a             | —        | No        | —                                                       |
| Map editor                | Fully Implemented      | ✅            | ✅         | ✅       | n/a             | —        | No        | —                                                       |
| Accounts (sign-up/in/out) | Partially Implemented  | ✅            | ✅         | ✅       | ❌ email        | P0       | **Yes**   | Email delivery; tests; password reset                   |
| Password reset            | Not Implemented        | ❌            | ❌         | ❌       | ❌              | P1       | **Yes**   | Whole flow; depends on email                            |
| Sharing & roles           | Partially Implemented  | ✅            | ✅         | ✅       | ❌ email        | P0       | **Yes**   | Invite emails never arrive                              |
| Search                    | Fully Implemented      | ✅            | ✅         | ✅       | n/a             | —        | No        | —                                                       |
| Link-to-Mind-Map (ingest) | Partially Implemented  | ✅            | ✅         | ✅       | ⚠️ optional key | P2       | No        | Falls back to a 3-node stub without `ANTHROPIC_API_KEY` |
| Page Watcher              | Fully Implemented      | ✅            | ✅         | ✅       | n/a             | —        | No        | —                                                       |
| Collaboration (SSE)       | Partially Implemented  | ✅            | ✅         | ✅       | n/a             | P1       | No        | Connection leak; presence ring unpainted                |
| Revenue / enquiries       | Partially Implemented  | ✅            | ✅         | ✅       | ❌ email        | P0       | **Yes**   | Business inbox unconfigured; mail never sent            |
| Marketing site            | Fully Implemented      | ✅            | ✅         | ✅       | ❌ email        | P1       | No        | Newsletter confirm mail never sent                      |
| Moderation                | Backend Only           | ⚠️ admin page | ✅         | ✅       | n/a             | P2       | No        | Staff flag has no assignment path                       |
| Analytics                 | Partially Implemented  | ✅            | ✅         | ✅       | n/a             | P1       | No        | No dashboard; default provider is `console`             |
| Error tracking            | Backend Only           | ❌            | ✅         | ✅       | n/a             | P1       | No        | No client reporter wired; no dashboard                  |
| Support inbox             | Backend Only           | ❌            | ✅         | ✅       | ❌ email        | P1       | No        | No support form UI                                      |
| Beta gate                 | **Mocked/Placeholder** | ❌            | ⚠️ unwired | ✅       | n/a             | **P0**   | **Yes**   | `redeemCode()` has zero callers                         |
| Onboarding / coach marks  | Not Implemented        | ❌            | n/a        | n/a      | n/a             | P2       | No        | Whole feature                                           |
| Backup / restore          | Not Implemented        | n/a           | ❌         | ❌       | n/a             | **P0**   | **Yes**   | No scripts, no rollback plan                            |
| E2E test suite            | **Broken**             | n/a           | n/a        | n/a      | n/a             | P1       | No        | `npm run e2e` has no config and no specs                |

---

## 6. Critical Bugs and Broken Functionality

### BUG-1 — Queued email is never sent [CONFIRMED] · P0

**Evidence.** `src/lib/email/outbox.ts` exports `queueEmail`, `pendingEmails(limit)` and `markSent(id)`. A repo-wide search for callers of `pendingEmails` or `markSent` outside that module returns **nothing**. There is no drain job, no cron, no SMTP or provider integration, and no `ANTHROPIC`-style provider key for email in `src/lib/env.ts`.

**What silently fails.** Every one of these writes a row and reports success to the user:

- Map invitations — `src/lib/email/outbox.ts:81` (`inviteEmail`)
- Enquiry acknowledgements — `src/lib/services/enquiries.ts`
- Support acknowledgements — `src/lib/launch/support.ts:126`
- Newsletter confirmations — `src/lib/marketing/newsletter.ts`

**Why it matters.** A user invites a collaborator, sees "invite sent", and nothing arrives. This is worse than a visible failure because there is no signal to anyone that it broke. It also makes password reset unimplementable.

**Note in the code's defence:** the storage-before-email ordering is correct and deliberate — the row is the record, mail is best-effort. The design is right; the delivery half was never built.

### BUG-2 — The beta gate does nothing [CONFIRMED] · P0

**Evidence.** `src/lib/launch/beta.ts` implements `betaEnabled()`, `mintCodes()`, `redeemCode()` and `listCodes()` with a correct race-safe conditional UPDATE. A repo-wide search shows **zero callers** of `redeemCode`, `mintCodes` or `betaStatus` outside `src/lib/launch/`. `src/app/api/auth/sign-up/route.ts` and `src/lib/auth/accounts.ts` contain no reference to beta.

**Consequence.** Setting `BETA_MODE=closed` changes nothing. Sign-up is open to the world. The module's own doc comment claims the cap is "ENFORCED, not intended" — it is currently neither.

### BUG-3 — `npm run e2e` cannot run [CONFIRMED] · P1

**Evidence.** `package.json` defines `"e2e": "playwright test"`, but there is no `playwright.config.*` at the repo root and no `*.spec.ts` anywhere outside `node_modules`. The 20 `scripts/verify-*.mjs` files are hand-rolled Playwright _driver_ scripts, not Playwright Test specs.

**Consequence.** The command fails immediately. Anyone trusting it as the E2E gate is trusting nothing.

### BUG-4 — SSE connections leak and exhaust the dev server [CONFIRMED] · P1

**Evidence.** Observed live during this session: `dev.log` recorded `GET /api/maps/m_.../stream 200 in 1057423ms` — a single SSE connection held open for 17 minutes. After several browser sessions, the dev server on `:3000` stopped answering _any_ request while still holding the port; it had to be abandoned for `:3001`.

**Consequence.** Next's dev connection pool fills with abandoned streams. In production the same pattern consumes a connection per stale tab.

**Requires verification.** Whether `src/app/api/maps/[mapId]/stream/route.ts` has an idle timeout and disconnect cleanup — the symptom is confirmed, the precise cause is not.

### BUG-5 — Duplicate key in `.env.example` [CONFIRMED] · P2

`.env.example` sets `NEXT_PUBLIC_ANALYTICS_PROVIDER` **twice** — `console` near the top and `beacon` further down. Last-wins, so a developer copying it gets `beacon` while reading `console`.

---

## 7. Partially Implemented Functionality

### PARTIAL-1 — Analytics writes but is never read [CONFIRMED] · P1

`src/lib/analytics/store.ts` and `POST /api/analytics` persist events to `analytics_events`. ADR-0009 justifies first-party analytics on the basis that "funnels are computed with SQL and read on a staff-only dashboard". **That dashboard does not exist.** The default provider in `.env.example` is also `console`, which §20 explicitly names as the P14 risk ("launching without instrumentation").

### PARTIAL-2 — Error tracking has no reporter and no reader [CONFIRMED] · P1

`src/lib/launch/errors.ts` implements fingerprinting and grouping well. `POST /api/errors` accepts reports. But no client-side `window.onerror` / `unhandledrejection` handler posts to it, and `GET /api/errors` has no UI. The subsystem is complete and entirely unreachable.

### PARTIAL-3 — Support inbox has no form [CONFIRMED] · P1

`src/lib/launch/support.ts` and `POST /api/support` are implemented, including rate limiting. There is no support form anywhere in `src/components` or `src/app`.

### PARTIAL-4 — Moderation has no way to become staff [CONFIRMED] · P2

`src/lib/moderation/` gates every function on `ctx.isStaff` and `/admin/moderation` exists. **Requires verification:** how `is_staff` is ever set on a user — no admin UI or CLI for it was found.

### PARTIAL-5 — Ingest degrades to a stub without a key [CONFIRMED] · P2

`src/lib/ingest/pipeline.ts:179` calls `starterStub()` when `ANTHROPIC_API_KEY` is absent, over budget, or the call fails, returning a 3-node placeholder map. This is a _good_ degradation and is surfaced honestly in `StructurePreview.tsx:68`. Flagged only so nobody mistakes stub output for the real feature during QA.

---

## 8. Missing MVP Functionality

| ID     | Missing                           | Evidence                                                                                    | Priority |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| MISS-1 | **Backup and restore**            | No script in `scripts/`; no rollback doc                                                    | **P0**   |
| MISS-2 | **Password reset**                | No route, no token table, no UI. `AuthForm` has a `forgotHref` prop deliberately left unset | P1       |
| MISS-3 | **Email delivery**                | See BUG-1                                                                                   | **P0**   |
| MISS-4 | **Launch/ops dashboard**          | `readiness.ts` is consumed only by `/api/health`                                            | P1       |
| MISS-5 | **Onboarding / coach marks**      | No component found                                                                          | P2       |
| MISS-6 | **`verify-launch.mjs`**           | Every other phase has a harness; P14 does not                                               | P2       |
| MISS-7 | **Email verification on sign-up** | Accounts are usable immediately                                                             | P2       |

---

## 9. Mocked, Placeholder and Hardcoded Functionality

**[CONFIRMED] The codebase is unusually clean here.** A search for `TODO`, `FIXME`, `HACK` and `XXX` across `src/` returns **zero** genuine markers. The only `stub` references are the _intentional, documented_ ingest fallback (§7 PARTIAL-5).

Hardcoded values that are real and should be moved to config:

| Location                       | Value                                | Note                                                 |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------- |
| `src/lib/launch/support.ts:17` | `support@creativedesignnetworks.com` | Hardcoded inbox; not in config or env                |
| `src/lib/nodes/detail.ts`      | `TARGET_WINDOWS` map of 7 dates      | Ship dates as a literal; should be config            |
| `src/config/contact.ts`        | Deliberately **empty**               | Correct — OD-1/OD-2 forbid inventing contact details |

The empty contact config is a deliberate honesty decision, not an oversight. It does mean **enquiries currently have no business inbox to route to**, which compounds BUG-1.

---

## 10. Frontend Gaps

- **[CONFIRMED] No global error boundary.** No `src/app/error.tsx` or `global-error.tsx` was found. An unhandled render error yields Next's default screen.
- **[CONFIRMED] `signedIn` plumbing was broken until this session.** `MapView` defaulted to `false` for everyone, silently disabling the "Mine" lens. Fixed in `src/app/(app)/map/page.tsx`. **This class of bug is untested** — no test asserts props reach components.
- **[CONFIRMED] Fixed-position containing-block trap.** `backdrop-filter` on the top bar confined `Sheet`'s fixed panel to a 56px strip. Fixed by portalling in `src/components/ui/Sheet.tsx`, now guarded by a test.
- **[CONFIRMED] Recurring build-breaker: backticks inside CSS comments in styled template literals.** Encountered at least six times this session. Each one terminates the literal and produces a confusing parser error.
  **[RECOMMENDATION]** Add a lint rule or a `verify` step that rejects a backtick inside a `/* */` comment within a styled template.

---

## 11. Backend Gaps

- **[CONFIRMED] Rate limiting covers 6 of 34 routes.** Only `enquiries`, `interest`, `newsletter`, `reports`, `service-request`, `support`. **Unprotected:** all auth routes, all map mutations, `search`, `analytics`, `errors`, `ingest/*`. `POST /api/auth/sign-in` has no brute-force protection.
- **[CONFIRMED] No `middleware.ts`.** Auth is enforced per-route via `requireAuth`/`getSession` (28 of 34 routes reference one). This works, but a forgotten call in a new route is an unprotected endpoint with nothing to catch it.
- **[CONFIRMED] Effectively no server logging.** Three `console.*` calls in all of `src/` outside tests. There is no request log, no structured logger, no error aggregation.
- **[CONFIRMED] `CDN_DATABASE_PATH` bypasses env validation.** Read at `src/lib/db/client.ts:34` but absent from the zod schema in `src/lib/env.ts` — undocumented and unvalidated.

---

## 12. Database Gaps

- **[CONFIRMED] SQLite via `better-sqlite3` is synchronous and local-disk.** This is correct and fast for a single-node closed beta. It is **incompatible with serverless/multi-instance hosting** (Vercel, Lambda): every instance gets its own ephemeral file. This is the single biggest deployment constraint and it is not documented anywhere in `docs/04-environments.md`.
- **[CONFIRMED] Forward-only additive migrations, no down-migrations.** A bad deploy cannot be rolled back at the schema level. Acceptable with backups (MISS-1); dangerous without.
- **[CONFIRMED] No retention job.** ADR-0009 states events "are pruned after 180 days by the backup script". That script does not exist, so `analytics_events` grows without bound.

---

## 13. Authentication and Authorization Gaps

**What is right [CONFIRMED]:** scrypt hashing (`src/lib/auth/password.ts`), `httpOnly` + `secure`-in-production + `sameSite: lax` cookies (`src/lib/auth/session.ts:52-60`), generic sign-in errors to resist enumeration, and the repository choke point enforced by a test.

**Gaps:**

| ID     | Gap                                                        | Priority |
| ------ | ---------------------------------------------------------- | -------- |
| AUTH-1 | **Zero tests.** `src/lib/auth/` is 6 modules, 0 test files | **P1**   |
| AUTH-2 | No rate limiting on sign-in — unlimited password guessing  | **P1**   |
| AUTH-3 | No password reset                                          | P1       |
| AUTH-4 | No email verification                                      | P2       |
| AUTH-5 | No session revocation UI ("sign out everywhere")           | P2       |
| AUTH-6 | No CSRF tokens — relies solely on `sameSite: lax`          | P2       |

AUTH-1 is the one to fix first. Auth is where a silent regression is unrecoverable, and it is the _only_ major subsystem with no test file at all.

---

## 14. Security Gaps

| ID    | Gap                                                                | Evidence                                                                           | Priority |
| ----- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------- |
| SEC-1 | **No Content-Security-Policy**                                     | `next.config.mjs` headers block                                                    | **P1**   |
| SEC-2 | **No Strict-Transport-Security**                                   | same                                                                               | **P1**   |
| SEC-3 | Sign-in brute force unthrottled                                    | See AUTH-2                                                                         | **P1**   |
| SEC-4 | `POST /api/analytics` and `/api/errors` are public and unthrottled | Both are write endpoints                                                           | P1       |
| SEC-5 | `INGEST_HASH_SALT` has a working default                           | `src/lib/env.ts:45` — deploying without setting it makes client hashes predictable | P1       |
| SEC-6 | No dependency audit in CI                                          | `.github/workflows/ci.yml`                                                         | P2       |

Present and correct: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `poweredByHeader: false`, and 404-not-403 enumeration resistance in the sharing routes.

---

## 15. Validation and Error-Handling Gaps

- **[CONFIRMED] Validation is consistently good.** zod schemas at API boundaries, server-side consent enforcement, enum values derived from config rather than restated.
- **[CONFIRMED] No global error boundary** (see §10).
- **[CONFIRMED] Client fetch error handling is inconsistent.** `AuthForm` handles network failure explicitly; several other callers do not. **Requires verification** per call site.
- **[CONFIRMED] `queueEmail` failures are invisible** — the deeper consequence of BUG-1.

---

## 16. Integration Gaps

| Integration            | Status                | Note                                                           |
| ---------------------- | --------------------- | -------------------------------------------------------------- |
| Anthropic API (ingest) | Implemented, optional | Budget-capped, degrades to stub                                |
| **Email provider**     | **Absent**            | BUG-1 — the critical one                                       |
| Analytics vendor       | Deliberately none     | ADR-0009                                                       |
| Payments               | Deliberately none     | ADR-0005 defers                                                |
| File storage           | `assets` table exists | **Requires verification** — no upload route found among the 34 |

---

## 17. Production and Deployment Blockers

| ID     | Blocker                                                                                                   | Priority |
| ------ | --------------------------------------------------------------------------------------------------------- | -------- |
| PROD-1 | **Zero git commits.** 55 tracked files, 165 changed. No history, no branches, no recovery from a bad edit | **P0**   |
| PROD-2 | **No backups** (MISS-1)                                                                                   | **P0**   |
| PROD-3 | **No email** (BUG-1)                                                                                      | **P0**   |
| PROD-4 | **Hosting undecided and constrained by SQLite** (§12)                                                     | **P0**   |
| PROD-5 | **Production build not verified**                                                                         | **P1**   |
| PROD-6 | No CSP/HSTS (SEC-1, SEC-2)                                                                                | P1       |
| PROD-7 | No logging or monitoring (§11)                                                                            | P1       |
| PROD-8 | No rollback plan                                                                                          | P1       |

**PROD-5 detail — [UNVERIFIED].** `npm run build` was attempted and failed with `EPERM: operation not permitted, open '.next\trace'` because the running dev server holds `.next`. **This is an environment conflict, not evidence of a code problem — but it means the production build has not been verified this session.** It must be run with all dev servers stopped before any deploy.

---

## 18. Technical Debt Worth Addressing

1. **[CONFIRMED] `ring1Max` was declared, tested and never read** for four phases — a phone rendered 12 ring-one nodes against a budget of 8. The token existed, a test asserted its value, and no code consumed it. **Lesson: assert on behaviour, not on constants.**
2. **[CONFIRMED] Undefined CSS variables render as nothing, silently.** `--space-5`, `--space-7` and seven others were used 33 times with no effect. Now guarded by `src/lib/styles/vars.test.ts` — keep that allowlist empty.
3. **[CONFIRMED] Two sources of truth for the password minimum** — fixed this session by extracting `src/lib/auth/policy.ts`.
4. **[RECOMMENDATION] The 20 `verify-*.mjs` harnesses are excellent but unversioned as a suite.** They are not in `npm run verify` and not in CI, so they only run when someone remembers.

---

## 19. Prioritized Implementation Roadmap

### P0 — Must be done before anyone else uses this

| ID   | Task                                                           | Complexity | Depends on |
| ---- | -------------------------------------------------------------- | ---------- | ---------- |
| T-01 | Initialise git history; commit the working tree                | Small      | —          |
| T-02 | Choose hosting compatible with SQLite (or migrate to Postgres) | Medium     | —          |
| T-03 | Implement email delivery + outbox drain                        | Medium     | T-02       |
| T-04 | Backup + restore scripts and a tested rollback                 | Medium     | T-02       |
| T-05 | Wire the beta gate into sign-up                                | Small      | T-03       |
| T-06 | Verify the production build with dev servers stopped           | Small      | —          |

### P1 — Required for a complete, reliable MVP

| ID   | Task                                               | Complexity | Depends on |
| ---- | -------------------------------------------------- | ---------- | ---------- |
| T-07 | Auth test suite                                    | Medium     | —          |
| T-08 | Rate limit auth + public write endpoints           | Small      | —          |
| T-09 | CSP and HSTS headers                               | Small      | T-06       |
| T-10 | Password reset                                     | Medium     | T-03       |
| T-11 | Global error boundary + client error reporter      | Small      | —          |
| T-12 | Structured server logging                          | Medium     | T-02       |
| T-13 | Fix the SSE connection leak                        | Medium     | —          |
| T-14 | Repair or remove `npm run e2e`                     | Small      | —          |
| T-15 | Staff/ops dashboard (analytics, errors, readiness) | Large      | T-07       |
| T-16 | Support form UI                                    | Small      | T-03       |

### P2 / P3 — After the MVP is safe

Onboarding coach marks · `verify-launch.mjs` · email verification · staff assignment path · moderation UI polish · analytics retention job · session revocation · CSRF tokens · dependency audit in CI.

---

## 20. Phase-by-Phase Implementation Plan

Each task below is specified to be implementable without rediscovering the codebase.

---

### Phase 1 — Preserve the work (do this first, today)

#### T-01 · Initialise git history · **P0** · Small

- **Status:** Not Implemented. `git log` → _"your current branch 'main' does not have any commits yet"_. 165 changed files.
- **Why it matters:** Every line of P0–P14 and Milestones A–C exists only as uncommitted working-tree state. One bad command loses months of work. This also blocks code review, CI and rollback.
- **Implementation:** Confirm `.gitignore` covers `.next/`, `node_modules/`, `*.db`, `dev*.log`, `scripts/.tmp-*`, `scripts/__screenshots__/`. Then commit in coherent slices (foundation → design system → map → accounts → sharing → search → ingest → watch → collab → marketing → launch) rather than one giant commit.
- **Files:** repo root, `.gitignore`
- **Acceptance:** `git log` shows history; `git status` is clean; no secrets or `.db` files tracked.
- **Testing:** `git ls-files | grep -E '\.env$|\.db$'` returns nothing.

#### T-06 · Verify the production build · **P0** · Small

- **Status:** Requires Verification (PROD-5).
- **Implementation:** Stop every dev server, `rm -rf .next`, run `npm run build`, then `npm run start` and smoke-test the routes.
- **Acceptance:** Build exits 0; `/`, `/map`, `/sign-in`, `/maps` render from the production server.

---

### Phase 2 — Decide where this runs

#### T-02 · Hosting decision · **P0** · Medium

- **Status:** Not Implemented. **This gates T-03 and T-04 and cannot be deferred.**
- **Problem:** `better-sqlite3` is synchronous and file-backed (`src/lib/db/client.ts`). On serverless every instance gets its own ephemeral database — users would see different data per request.
- **Two viable paths:**
  - **(a) Single-node host** (Fly.io / Railway / a VPS) with a persistent volume. **Keeps SQLite, changes no application code.** Recommended for a 20–50 user closed beta.
  - **(b) Migrate to Postgres.** Correct long-term; a substantial rewrite of `src/lib/db/` and all repositories. Not justified at beta scale.
- **[RECOMMENDATION]** Take (a) now. The choke-point architecture means (b) stays possible later — every query already goes through repositories.
- **Acceptance:** A deployed environment where data survives a restart and two concurrent users see the same data.
- **Also:** add `CDN_DATABASE_PATH` to the zod schema in `src/lib/env.ts` and document it in `docs/04-environments.md`.

---

### Phase 3 — Close the P0 functional gaps

#### T-03 · Email delivery · **P0** · Medium

- **Status:** Backend Only. See BUG-1.
- **Implementation:**
  1. Add an `EmailProvider` interface with a real implementation (Resend or SMTP) and a `log` implementation for development.
  2. Add `EMAIL_PROVIDER`, `EMAIL_FROM` and the provider key to `src/lib/env.ts`.
  3. Write `drainOutbox()` calling `pendingEmails()` → send → `markSent()`, with retry limits and a dead-letter state.
  4. Trigger it: a scheduled job on the chosen host, or an authenticated `POST /api/outbox/drain` hit by a cron.
  5. Set the real business inbox in `src/config/contact.ts` (currently empty by design — OD-1 requires the _user_ to supply it; do not invent one).
- **Files:** `src/lib/email/outbox.ts`, new `src/lib/email/provider.ts`, `src/lib/env.ts`, `src/config/contact.ts`
- **Acceptance:** An invite produces a real email. A provider failure leaves the row pending and retries. Nothing is marked sent that was not accepted by the provider.
- **Testing:** Unit tests for the drain (success, failure, retry cap) with a fake provider; one manual end-to-end send.

#### T-04 · Backup and restore · **P0** · Medium

- **Status:** Not Implemented (MISS-1).
- **Implementation:** `scripts/backup.mjs` using SQLite's online backup API (safe on a live database — do **not** copy the file), retention pruning of `analytics_events` past 180 days as ADR-0009 promises, and `scripts/restore.mjs`. Document the rollback in `docs/04-environments.md`.
- **Acceptance:** A backup taken while the app is running restores into a working database. **The restore must be executed at least once — an untested backup is not a backup.**

#### T-05 · Wire the beta gate · **P0** · Small

- **Status:** Mocked/Placeholder. See BUG-2.
- **Implementation:** Add `inviteCode` to the sign-up schema (`src/lib/auth/accounts.ts`), call `redeemCode(code, userId, db)` **inside the sign-up transaction** so a failed account creation cannot burn a seat, and add the field to `AuthForm` conditionally on `BETA_MODE`. Add a staff route to mint codes.
- **Files:** `src/app/api/auth/sign-up/route.ts`, `src/lib/auth/accounts.ts`, `src/lib/launch/beta.ts`, `src/components/account/AuthForm.tsx`
- **Acceptance:** With `BETA_MODE=closed`, sign-up without a valid code fails; a code works exactly once; the cap of 50 is enforced. With `BETA_MODE=open`, nothing changes.
- **Testing:** Unit tests including two concurrent redemptions of the same code (the conditional UPDATE already handles this — prove it).

---

### Phase 4 — Security and authentication

#### T-07 · Auth test suite · **P1** · Medium

- **Status:** Not Implemented (AUTH-1). `src/lib/auth/` = 6 modules, 0 tests.
- **Must cover:** password hash/verify round-trip and mismatch; `checkPassword` boundaries at 9/10/200/201 characters; session create → read → expire → revoke; `requireAuth` redirect with `returnTo`; sign-in does **not** reveal whether an email exists; sign-up **does**; duplicate email rejection.
- **Acceptance:** Every exported function in `src/lib/auth/` has at least one test; the enumeration-resistance asymmetry is asserted.

#### T-08 · Rate limiting · **P1** · Small

- **Status:** Partially Implemented — 6 of 34 routes.
- **Priority order:** `auth/sign-in` (brute force), `auth/sign-up` (mass registration), `analytics` and `errors` (public writes), `ingest/run` (costs money — check `src/lib/ingest/budget.ts` for overlap), map mutations.
- **Implementation:** Reuse the existing `clientHash` limiter from `src/lib/services/enquiries.ts` rather than writing a second one.
- **Acceptance:** Six wrong passwords in a minute are refused; the message does not reveal whether the account exists.

#### T-09 · CSP and HSTS · **P1** · Small

- **Implementation:** Add to the `headers()` block in `next.config.mjs`. CSP needs care with styled-components — it injects `<style>` tags, so either allow `'unsafe-inline'` for styles initially or adopt a nonce. **Ship report-only first**, check the reports, then enforce.
- **Acceptance:** `securityheaders.com` grade A; no console CSP violations in normal use.

---

### Phase 5 — Reliability

#### T-11 · Error boundary and reporter · **P1** · Small

- Add `src/app/global-error.tsx` and per-route `error.tsx`. Wire `window.onerror` and `unhandledrejection` to `POST /api/errors`, which already exists and fingerprints correctly.
- **Acceptance:** A thrown render error shows a recoverable screen and appears in `error_reports`.

#### T-13 · Fix the SSE leak · **P1** · Medium

- **Status:** Broken (BUG-4).
- **Implementation:** Add an idle timeout, ensure `AbortSignal` cleanup removes presence rows, cap concurrent streams per user, and add a heartbeat so dead connections are detected.
- **Acceptance:** 50 opened-then-abandoned streams leave no lingering connections; the server still answers after an hour of tab churn.

#### T-14 · Repair or remove `npm run e2e` · **P1** · Small

- **Two honest options:** add `playwright.config.ts` and port the harnesses to specs, **or** delete the `e2e` script and make `verify:*` the documented E2E path. **Either is fine; leaving a command that cannot run is not.**

---

### Phase 6 — Operator visibility

#### T-15 · Staff dashboard · **P1** · Large

- Surfaces what is already collected and currently unreadable: the analytics funnels ADR-0009 promised, the error list from `GET /api/errors`, the support queue, `readiness()`, and beta code management.
- **Acceptance:** A staff user can answer "is it healthy, what is broken, who is asking for help" without a SQL client. A non-staff user gets 404 (not 403 — matching the existing enumeration-resistance convention).

---

## 21. Dependency Graph

```
T-01 (git) ─── independent, do first
T-06 (build verify) ─── independent

T-02 (hosting)
  ├──> T-03 (email) ──> T-05 (beta gate)
  │                └──> T-10 (password reset)
  │                └──> T-16 (support form)
  ├──> T-04 (backup/restore)
  └──> T-12 (logging)

T-06 ──> T-09 (CSP/HSTS)

T-07 (auth tests) ──> T-15 (staff dashboard)

Independent: T-08, T-11, T-13, T-14
```

**Critical path:** `T-02 → T-03 → T-05`. Hosting gates email; email gates the beta gate, password reset and the support form. **Decide hosting first** — everything else in P0 waits on it.

---

## 22. Testing and QA Plan

**Current state [CONFIRMED]:** 679 tests / 20 files, all passing. Strong on pure logic (map geometry, layout, search, sharing, moderation, ingest) and structural guards (choke point, CSS variables, marketing coupling).

**Gaps, in priority order:**

| Gap                                                                  | Priority |
| -------------------------------------------------------------------- | -------- |
| `src/lib/auth/` — 6 modules, 0 tests                                 | **P1**   |
| `src/lib/launch/` — 4 modules, 0 tests                               | P1       |
| `src/lib/email/` — 0 tests                                           | P1       |
| `src/lib/interest/` — 0 tests                                        | P2       |
| No API route tests (all 34 untested at the HTTP layer)               | P1       |
| No working E2E suite                                                 | P1       |
| No prop-plumbing tests — `signedIn` was broken for phases undetected | P2       |

**Manual QA still required before beta:**

- **Screen-reader pass** (VoiceOver + NVDA) — never done; a known gap in the docs.
- **Real-device testing** — everything so far is emulated.
- **Production build smoke test** (T-06).

---

## 23. Production Readiness Checklist

- [ ] Git history exists, `.gitignore` excludes secrets and `*.db` — **T-01**
- [ ] Production build verified with dev servers stopped — **T-06**
- [ ] Hosting chosen; database persists across restarts — **T-02**
- [ ] Email sends for real — **T-03**
- [ ] Backups run automatically and a restore has been performed — **T-04**
- [ ] Beta gate enforced if a closed beta is intended — **T-05**
- [ ] `INGEST_HASH_SALT` set to a non-default value — **SEC-5**
- [ ] `NEXT_PUBLIC_ANALYTICS_PROVIDER=beacon`, duplicate key removed — **BUG-5**
- [ ] Business inbox configured in `src/config/contact.ts`
- [ ] Auth rate-limited — **T-08**
- [ ] CSP and HSTS enforced — **T-09**
- [ ] Error boundary and reporter live — **T-11**
- [ ] Server logging in place — **T-12**
- [ ] Auth test suite passing — **T-07**
- [ ] Screen-reader pass completed
- [ ] `npm run verify` green in CI

---

## 24. Post-MVP Recommendations

**[RECOMMENDATION] — none of these block launch.**

1. Postgres migration, if the beta outgrows one node. The repository pattern makes this tractable.
2. Session replay, only if a real map-usability question proves unanswerable — ADR-0009 already names this as the trigger to revisit.
3. Onboarding coach marks.
4. A lint rule for backticks inside CSS comments in styled templates (§10).
5. Visual regression testing — screenshots caught several defects this session that assertions did not.
6. Retire the second dev server on `:3001` once BUG-4 is fixed.

---

## 25. Final MVP Completion Checklist

**A user can:**

- [x] Arrive, see the map, navigate it — including on a phone
- [x] Open a node, read it, follow it, expand into it
- [x] Search and return to where they were
- [x] Create an account and sign in
- [x] Create, edit and share a map
- [x] Turn a web page into a map _(degraded without an API key)_
- [x] Browse the Page Watcher feed
- [x] Send an enquiry _(row is stored)_
- [ ] **Receive any email at all** — T-03
- [ ] **Reset a forgotten password** — T-10
- [ ] **Be admitted through a controlled beta** — T-05
- [ ] **Get help through a support form** — T-16

**An operator can:**

- [x] See liveness and readiness at `/api/health`
- [ ] **See analytics, errors and support in one place** — T-15
- [ ] **Restore from a backup** — T-04
- [ ] **Roll back a bad deploy** — T-04
- [ ] **Read a server log** — T-12

---

## Appendix — Audit Method and Limits

**Verified by reading code:** route inventory (34), migration and table inventory (30), env schema vs `.env.example`, outbox call graph, beta-gate call graph, session cookie flags, security headers, rate-limit coverage, test-file inventory, git state, absence of Playwright config.

**Verified by running:** `npm run verify` (679 tests / 20 files, green); live HTTP checks against `:3001` for `/`, `/services`, `/request`, `/app`, `/map`, `/map/tree`, `/search`, `/sign-in`, `/sign-up`, `/soon/people-networks` (all 200).

**Not verified — treat as open questions:**

1. **The production build** — blocked by `EPERM` on `.next/trace` from the running dev server (PROD-5).
2. **Runtime behaviour of most screens** — Playwright's browser binary is missing on this machine (`npx playwright install chromium` needed), so the 20 `verify-*.mjs` harnesses could not be run this session. They passed when last executed, but not against the current tree.
3. **How a user becomes staff** (PARTIAL-4).
4. **Whether the `assets` table has any upload path** (§16).
5. **The precise cause of the SSE leak** — the symptom is confirmed, the mechanism is not (BUG-4).

**Assumption stated explicitly:** this audit treats the intended MVP as the scope described in `CDN-MVP-IMPLEMENTATION-ROADMAP.md` §20 (phases P0–P14) plus the marketing milestones in `roadmap.md`. Features absent from both are treated as out of scope, not as gaps.
