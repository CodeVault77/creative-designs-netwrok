# Accounts & Persistence (P6)

**Status:** Shipped · **Date:** 2026-08-31 · **Phase:** P6

Implements §08 screens 07 and 18, §14 saving, and closes the in-memory caveats P4 and P5 shipped with.

---

## Measured against the acceptance criterion

| §20 criterion              | Result                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| Map survives sign-out      | **Verified.** Sign out, sign back in, map and nodes intact          |
| Map survives device change | **Verified.** Second browser context — separate cookies and storage |
| Map survives offline edit  | **Verified.** Edit offline, held locally, syncs on reconnect        |

Plus the one a single-run harness cannot catch:

|                               |                                                                            |
| ----------------------------- | -------------------------------------------------------------------------- |
| Survives a **server restart** | **Verified.** Account, map and nodes all present after killing the process |

That last one is the reason this phase exists. Everything looks durable while the process holding the data is still alive, which is exactly why P4 and P5 said so explicitly rather than claiming persistence they did not have.

```bash
npm run verify:accounts     # 30 checks: auth, persistence, isolation, profile
npm run verify:persistence  # two-phase, run either side of a restart
```

## The named risk: "RLS mistakes leak data"

Postgres RLS makes the _database_ refuse rows you may not see, so a forgotten `WHERE owner_id = ?` gets caught. SQLite has no such mechanism, so the guarantee has to come from the shape of the code. Four things carry it:

**1. Every query takes an `AuthContext` as its first argument.** There is no overload without one. Forgetting authorisation is not something you can do by omission — you would have to deliberately fabricate a context.

**2. Ownership is a predicate in the SQL, not a check afterwards.** `WHERE id = ? AND owner_id = ?` returns nothing for someone else's map. A fetch-then-compare leaves the row in memory, one careless log line from a leak.

**3. Reads and writes share one predicate helper.** The classic bug is a read path checking membership and a write path checking ownership. `PREDICATE.visible` and `PREDICATE.writable` sit adjacent in one object so the drift is visible.

**4. The raw handle never leaves `db/client.ts`.** Enforced by a test, not by convention — `chokepoint.test.ts` walks every source file and fails if anything outside a named allow-list imports it, if anything under `app/` touches the database, or if a `'use client'` file imports the repo.

**Every method is tested for cross-user access, not a representative sample** — the leak is never in the method you remembered to check. 37 repository tests plus 30 end-to-end checks, covering read, write, delete, list, quota count, title conflict and profile edit.

The Postgres RLS policies are written out in `migrations.ts` as `POSTGRES_RLS`, so the production swap is a transcription rather than a design exercise, and the intent is reviewable now.

### One decision worth stating

**Staff can read any map for moderation. Staff cannot write, delete, or edit a profile.** Elevated read access is not elevated write access — a staff account that can silently rewrite someone's map has a much larger blast radius than one that can only look. Tested in both directions.

## Auth

**scrypt from `node:crypto`**, not bcrypt or argon2: it is in the standard library, so there is no native dependency to fail on a deploy target, and it is memory-hard, which is the property that matters. Never a fast hash — speed is the attacker's advantage.

- Constant-time comparison. A plain `===` leaks how many bytes matched through timing.
- Passwords are NFKC-normalised, so one typed on a Mac verifies on Windows.
- **Length only, no composition rules.** "One uppercase, one symbol" measurably pushes people toward `Password1!` and into reuse. NIST dropped them years ago.

**Sessions are server-side rows, not JWTs.** A JWT cannot be revoked before it expires, and "sign out everywhere" is something people need after losing a device. The token is stored **hashed** — a leaked database dump is then not a set of working sessions.

Cookie is `httpOnly` (an XSS bug cannot exfiltrate it), `secure` in production, and `sameSite: lax` — `strict` would break a shared `/n/<id>` link opening signed in, which §10 calls the product's main growth mechanism.

**Sign-up tells you an email is taken; sign-in never does.** Deliberate asymmetry: without it people cannot tell a typo from a forgotten account, and the same fact is discoverable from any reset flow. Sign-in stays generic — and does the same amount of work either way, so a missing account is not measurably faster and the form is not an enumerator.

## Quotas

50 maps per account, 1000 nodes per map, 5 MB per image, 100 MB total.

Not a monetisation lever — ADR-0005 defers payments, so there is nothing to gate. They are an abuse ceiling: without them one script fills the database and the cost lands on everyone else. Set well above §17's 300-node render budget so nobody meets one while building something real, and surfaced **before** the action rather than as an error after someone has typed a name and chosen a template.

## What changed from earlier phases

| Was                                      | Now                                                        |
| ---------------------------------------- | ---------------------------------------------------------- |
| `cdn_dev_session` cookie stub (P2)       | Real sessions, same `Session` shape — no call site changed |
| In-memory map store (P5)                 | `maps` + `map_nodes` tables                                |
| In-memory interest store (P4)            | `node_interest` table, deduped by a unique index           |
| Ownership checked in route handlers (P5) | Ownership in the repository predicate                      |

The P2 stub was written with a real shape precisely so this swap would not ripple. It did not: every `getSession()` call site from P2 through P5 still works untouched.

Interest dedupe is now a **unique index** rather than an application check. A check-then-insert has a race — two taps in flight both see no row and both insert. `COALESCE(user_id, visitor_hash, 'anon')` is in the index because SQL treats NULLs as distinct, which would let one signed-out visitor register unlimited times.

## The `/maps` gap from P4 is closed

P4 recorded that `/maps` bounced signed-out visitors to a bare sign-in page, damaging §24's arrival metric. Sign-in now carries **value copy** and the `returnTo` path, as §08 screen 07 specifies — someone arriving from a protected route sees a reason to continue, not just a password box.

## Known gaps

- **Image storage is table-and-quota only.** The `assets` table and the size limits exist; the upload endpoint and the image node UI do not. Half an upload flow is worse than none, so it was left rather than stubbed.
- **No password reset.** Needs email delivery, which nothing else in the MVP needs yet. Until it exists, a forgotten password means a new account — acceptable for a closed beta, not for launch.
- **No email verification.** Same reason. It also means the optional email on interest capture is unverified.
- **`map_members` has no UI.** The table and the Shared tab exist so the tab can never be a lie; roles and invitations are P7.
- **SQLite, not Postgres.** Fine for a closed beta on one instance. It does not survive horizontal scaling, and the RLS policies are written but not exercised. That migration belongs before real traffic.
- **Sessions are not pruned on a schedule** — only opportunistically on sign-in. Fine at beta size; a cron job belongs with P14's monitoring.
