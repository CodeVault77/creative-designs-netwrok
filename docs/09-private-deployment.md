# Private deployment

Running Creative Design Networks on infrastructure you control — a customer's
own cloud account, a VPC, or on-premises.

This is a Phase 8 deliverable and it is deliberately written as an operations
document rather than a sales one. Everything below is something that must
actually be true before a deployment is safe to use.

---

## 1. What you are deploying

One Next.js application, one database, one scheduler, and an object store if
you accept uploads. There is no separate API service, no message broker and no
worker fleet: the job queue is a table, and the worker is an HTTP endpoint a
scheduler calls. That is a deliberate constraint from Phase 1 and it is what
makes a private deployment a normal afternoon rather than a project.

```
  browser ──► Next.js (app + API) ──► database
                    │
                    └──► object store (uploads)

  scheduler ──► POST /api/jobs/drain   (every minute)
             ──► POST /api/jobs/drain  (also drains webhooks and email)
```

---

## 2. Required configuration

These must be set. The application refuses to start without the ones marked
**required in production**, rather than falling back to a default — a default
secret is the same secret on every deployment of this code in the world.

| Variable               | Required     | What it is                                      |
| ---------------------- | ------------ | ----------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | yes          | Absolute URL this deployment answers on         |
| `APP_ENV`              | yes          | `production` for a real deployment              |
| `MFA_ENCRYPTION_KEY`   | **in prod**  | 32 bytes, base64. Encrypts TOTP and SSO secrets |
| `INGEST_HASH_SALT`     | **in prod**  | Salts hashed IPs. Must differ per environment   |
| `JOB_RUNNER_TOKEN`     | yes          | Bearer token the scheduler presents             |
| `ENTERPRISE_BASE_URL`  | if different | Overrides the OIDC redirect URI base            |

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**`MFA_ENCRYPTION_KEY` cannot be rotated without re-enrolment.** It decrypts
every stored TOTP secret and SSO client secret. Losing it means every user
re-enrols their second factor and every SSO connection is reconfigured. Back it
up somewhere that is not the database it protects.

### Optional, by feature

| Feature  | Variables                                               |
| -------- | ------------------------------------------------------- |
| AI       | `ANTHROPIC_API_KEY`, `INGEST_MONTHLY_USD_CAP`           |
| Email    | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` |
| Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`            |

Each is genuinely optional. Without `ANTHROPIC_API_KEY` the ingest pipeline
falls back to its deterministic structurer; without Stripe, billing reports
itself unconfigured rather than pretending a checkout worked.

---

## 3. The database

The repository ships with SQLite, which is correct for a single-instance
deployment and correct for evaluation. **It is not correct for more than one
application instance**, because SQLite's write lock is per-file and two
instances will not see each other's writes.

For anything beyond one instance, migrate to Postgres. `src/lib/db/migrations.ts`
exports `POSTGRES_RLS`, which contains the row-level-security policies as a
transcription rather than a design exercise — the application-level equivalent
is already enforced in `repo.ts`, and RLS is defence in depth on top of it.

Back up the database file (or the Postgres cluster) before every upgrade.
Migrations are forward-only and additive by policy, but a restore path is not
optional.

---

## 4. The scheduler

Background work does not happen on its own. Something must call:

```bash
curl -X POST -H "authorization: Bearer $JOB_RUNNER_TOKEN" \
     https://your-host/api/jobs/drain
```

Every minute. This drains queued email, delivers webhooks, runs agent steps and
retries whatever failed. **Without it, nothing queued ever happens** — no email
arrives, no webhook fires, and the symptom is silence rather than an error.

Cron, a Kubernetes CronJob, systemd timer, or the platform's own scheduler are
all fine. It is an ordinary HTTP request.

Also schedule, less often:

- `sweepRetention()` — audit rows past the retention window (daily is plenty)
- `pruneStates()` — expired SSO authorisation attempts (hourly)
- `pruneRequests()` — API request log older than a day

---

## 5. Network requirements

**Outbound.** The application makes outbound requests for: web page ingest,
webhook delivery, OIDC discovery and token exchange, and the AI provider. All
outbound fetches go through the SSRF policy in `src/lib/ingest/ssrf.ts`, which
refuses private ranges, loopback and cloud metadata addresses, and re-checks at
connect time to close DNS rebinding.

**In a VPC this matters more, not less.** An application that can reach your
internal services is an application whose ingest feature can be pointed at
them. The guard is on by default and should not be relaxed.

**Inbound.** HTTPS only. The OIDC redirect URI must be https and must match
what is registered with the provider character for character — the
organisation settings screen displays the exact value to paste.

---

## 6. Security checklist before going live

- [ ] `MFA_ENCRYPTION_KEY` set, and backed up outside the database
- [ ] `INGEST_HASH_SALT` set, and different from every other environment
- [ ] `JOB_RUNNER_TOKEN` set — without it the drain endpoint accepts staff
      sessions only, and never falls open
- [ ] HTTPS terminated, HSTS on
- [ ] Database backups running, and a restore actually tested
- [ ] The scheduler is calling `/api/jobs/drain` and you have checked its logs
- [ ] At least one account has `is_staff`, and that account has MFA enabled
- [ ] SSO tested end to end before enforcement is switched on

The last one is enforced in code: a connection cannot be made mandatory until
somebody has signed in through it. That check exists because the alternative is
locking an organisation out of its own deployment with one click.

---

## 7. What is not included

Stated plainly, so nobody discovers it during an evaluation:

- **No SAML.** OIDC only — ADR-0010 explains why, and what to put in front if
  SAML is genuinely required.
- **No horizontal scaling on SQLite.** One instance, or migrate to Postgres.
- **No built-in log shipping or metrics export.** Analytics and errors are
  first-party and readable at `/admin/dashboard`; forwarding them elsewhere is
  your integration.
- **Per-node permission denial is not enforced for offline sync.** ADR-0011
  documents the limit and why closing it is a design problem rather than a
  missing check. If per-node denial is a security boundary for you, do not
  enable offline editing.
- **No air-gapped AI.** The AI features call an external provider. Without a
  key they degrade to the deterministic path rather than failing.

---

## 8. Upgrading

1. Back up the database.
2. Deploy the new build.
3. Migrations run at startup, forward-only and additive.
4. Check `/api/health` and the readiness panel on `/admin/dashboard`.

Rolling back a deploy is safe. Rolling back a **migration** is not — additive
migrations are designed so the previous application version keeps working
against the new schema, which is what makes step 2 safe to do first.
