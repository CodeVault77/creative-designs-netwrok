# Environments

**Status:** Defined · **Date:** 2026-08-31 · **Phase:** P0

## The four environments

| `APP_ENV`    | Where                         | Data                       | Analytics                       | Who uses it                             |
| ------------ | ----------------------------- | -------------------------- | ------------------------------- | --------------------------------------- |
| `local`      | A developer machine           | Local / seeded             | `console`                       | Engineers                               |
| `preview`    | Per-pull-request deploy       | Ephemeral, seeded          | `noop`                          | Reviewers, designer                     |
| `staging`    | One shared deploy from `main` | Persistent, non-production | Real provider, separate project | Product owner, beta testers pre-release |
| `production` | The live site                 | Production                 | Real provider                   | Users                                   |

`APP_ENV` is separate from `NODE_ENV` on purpose. `NODE_ENV` describes how the code was compiled; `APP_ENV` describes which deployment this is. Preview and staging both run production builds, so `NODE_ENV` cannot distinguish them.

## Configuration

Every variable is declared in [`.env.example`](../.env.example) and validated at boot by [`src/lib/env.ts`](../src/lib/env.ts). A missing or malformed value crashes the process immediately with a message naming the variable.

**The rule that matters:** anything prefixed `NEXT_PUBLIC_` is inlined into the browser bundle at build time. It is public forever, including in builds already deployed. Rotating a secret that was ever `NEXT_PUBLIC_` does not un-publish it. A test in `env.test.ts` asserts that no server key appears in the client schema.

## Secrets

- Never committed. `.env`, `.env.local` and `.env.*.local` are gitignored.
- Held in the hosting provider's secret store and in GitHub Actions secrets.
- Owned by the product owner, not by an individual developer's personal account. This matters for the single-developer-dependency risk in §23 — losing access to a deployment because one person's account is unavailable is an avoidable outage.
- Rotated when anyone with access leaves.

## Promotion path

```
feature branch → PR (preview deploy, CI must pass) → main (auto-deploy to staging) → manual promote → production
```

Production deploys are manual and deliberate. Every deploy must be revertible in under five minutes; if a change cannot be reverted — a destructive migration, for instance — it ships behind a flag instead.

## Database migrations (from P6)

- Forward-only, checked into the repo, reviewed like code.
- Every migration runs against staging before production.
- Additive first: add a column, backfill, switch reads, drop the old column in a later release. A migration that drops a column in the same deploy that stops writing it cannot be rolled back.

## Health and monitoring

`/api/health` returns environment and timestamp, with no dependency details. CI already smoke-tests it after building. From P14 it also backs uptime monitoring and the post-deploy gate.

Monitoring added in P14: error tracking, uptime checks against `/api/health`, deploy notifications, and daily database backups with a restore that has actually been tested — an untested backup is a hope, not a backup.

## Local setup

```bash
nvm use              # Node 20.11+
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

Before pushing:

```bash
npm run verify       # typecheck + lint + format:check + test
```

The pre-commit hook runs lint-staged on changed files. CI runs the full `verify` plus a production build and health smoke test, so a green local run is a good signal but not the gate.
