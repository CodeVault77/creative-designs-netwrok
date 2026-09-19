# 18 — QA, accessibility and security (P13)

§20's brief for this phase is "fit to ship", with **no new components** on the
design side and four engineering deliverables: moderation queue, reporting, rate
limits, pen-test pass, load test.

The criterion:

> WCAG 2.1 AA on all non-canvas surfaces; tree view fully operable by keyboard
> and screen reader; no critical findings.

And the risk, which is the interesting part:

> Discovering a11y debt here `High` — mitigate by auditing from P3.

---

## The risk, and whether the mitigation worked

It largely did. The tree view already implemented the full WAI-ARIA tree pattern
from P3 — `role="tree"`, `treeitem`, `aria-level`, `aria-selected`,
`aria-expanded`, roving tabindex, and the four-way arrow-key contract. None of
that had to be retrofitted.

But the audit still found **four real defects**, three of them in code written
during P9–P12 — which is precisely the debt §20 predicted, just accumulated in
the phases after the mitigation was put in place.

### 1. The tree's ARIA structure was broken by its own markup

```
ul[role="tree"] > li > div[role="treeitem"]
```

`role="tree"` **removes the `<ul>`'s implicit list semantics**. So the `<li>`
inside it was no longer a listitem in a list, and it sat between the tree and its
treeitems, breaking the ownership relationship the whole pattern depends on.
Three axe violations — `aria-required-children`, `aria-required-parent`,
`listitem` — one cause.

The fix is one attribute: `role="none"` on the `<li>`, making it transparent to
the accessibility tree.

Worth dwelling on because every individual attribute was correct. The pattern
was right, the roles were right, and the structure was still wrong.

### 2. Colour contrast lost to an opacity

The Page Watcher chip counts used `--ground-muted` — which passes — and then
`opacity: 0.75`, which dropped all 22 of them below 4.5:1.

Dimming with opacity is invisible in review: the token still looks correct in
the source, and the contrast is only wrong once it is composited. Removed.

### 3. The search screen had no `h1`

The search field _was_ the header. Fixed with a visually-hidden `h1` — clipped
rather than `display: none`, which would remove it from the accessibility tree
and defeat the point. A visible heading above the field would be redundant to a
sighted reader while remaining essential to someone navigating by headings.

### 4. `POST /api/maps/[mapId]/lock` returned 200 to a stranger

Found by the security pass, not the a11y one. `acquireLock` correctly refused —
nothing was locked and nothing leaked — but it refused by returning the same
`{ ok: false }` that a legitimately contended lock returns, under HTTP **200**.

Every other endpoint answers a stranger with 404. An endpoint that answers 200
instead is the one that starts leaking the day someone adds a field to that
response. Now checks `roleOn` first.

---

## Accessibility

```bash
npm run verify:a11y
```

axe-core against **18 surfaces**, at WCAG 2.1 AA, with only `[data-map-canvas]`
excluded — the controls over the canvas and the sheets beside it are all still
audited. Panels that exist only when open (chat, activity) are audited open.

**Result: 0 violations of any severity.**

On top of the automated pass, the tree view gets a hand-written audit, because
it is the accessible equivalent of the canvas rather than an alternative to it:

- exactly one item in the tab order (roving tabindex) — a tree where every row
  is tabbable makes a keyboard user press Tab a hundred times to leave it
- `aria-level`, `aria-selected`, `aria-expanded` on every item
- Arrow keys, Home, End, and Space, driven for real
- the four-way expand/collapse contract:
  Right expands a collapsed node, or descends into an expanded one; Left
  collapses an expanded node, or ascends from a collapsed one

Plus the things axe cannot see: a **visible focus indicator** on every control
(compared computed styles before and after focus), one `h1` per page, a declared
document language, and a distinct title per page.

> An earlier version of this harness asserted that Left always collapses, and
> reported a bug against an implementation following the spec correctly. It also
> tested the map's centre node, which stays expanded by design — collapsing it
> would empty the map.

**The summary says out loud that an automated pass finds perhaps a third of real
barriers.** Green here is necessary, not sufficient; manual screen-reader testing
is still owed and is recorded as a gap.

---

## Security

```bash
npm run verify:security
```

Every check is an **attack**, run against the live server, grouped by what an
attacker is trying to get. Phrased as "must not" throughout — a security test
that asserts the happy path is a functional test wearing a hat.

| Category      | What is tested                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorisation | 5 read and 5 write endpoints on a stranger's private map; the secret must appear in no body; the map must survive every attempt                                                       |
| Enumeration   | a private map and a nonexistent one must be **indistinguishable**; staff surfaces 404 not 403; sign-in must not reveal whether an account exists; reporting must not confirm a target |
| SSRF          | 10 probes — metadata, loopback in five spellings, `file:`, `gopher:`, RFC1918                                                                                                         |
| Injection     | stored and reflected XSS asserted on the **rendered DOM**, `javascript:` URLs, SQL injection                                                                                          |
| Session       | httpOnly, SameSite, cross-origin delete, sign-out invalidation, forged token                                                                                                          |
| Availability  | oversized payload, report flooding, and 8 concurrent writes at one version                                                                                                            |

**Result: no critical findings.**

The concurrency check is the one worth keeping: eight simultaneous writes at the
same version produce `200,409,409,409,409,409,409,409`. **Exactly one winner.**
Two winners would mean one person's work was silently overwritten.

---

## Load

```bash
npm run verify:load
```

Deliberately a **smoke load test, not a capacity plan**. The target is a closed
beta of 20–50 users (§20 P14), so the useful question is not requests per second
but whether anything fails, leaks, or degrades non-linearly at the scale we are
actually about to see.

Measured latency (concurrency 4, which is what one user experiences):

| Path            | p95   | p99   |
| --------------- | ----- | ----- |
| health          | 29ms  | 31ms  |
| search          | 55ms  | 76ms  |
| watch feed      | 72ms  | 78ms  |
| watch interests | 31ms  | 42ms  |
| service page    | 112ms | 132ms |
| community map   | 116ms | 116ms |

Saturation, at 8× the concurrency: **227 rps at 40 in flight vs 143 rps at 5**,
zero errors, and p95 within 1.3× of what Little's law predicts.

> The first version of this test set latency budgets at concurrency 30 and
> failed them. That was arithmetic, not a regression: on a single-threaded
> server, latency under load ≈ concurrency ÷ throughput, so it was measuring the
> queue the test itself had created. Latency is now measured at a depth a user
> experiences, and saturation is judged on **throughput and errors** — because
> throughput collapsing is what distinguishes contention from healthy queueing.

Also checked: 60 simultaneous stream connections refused cleanly, the server
healthy afterwards, and a 600-request sustained run with a p50→p99 spread of
1.8× (a steady climb would be the signature of a leak).

---

## Reporting and moderation

§15: _"Report lives in the overflow of every node, map, message and profile. One
flow, one component, everywhere."_ One `ReportDialog`, one `POST /api/reports`,
one table across all four target types — the queue reviews them together and a
moderator does not care which kind of thing they are looking at until they open
it.

- **Open to signed-out visitors.** The people most in need of a report button are
  often not members.
- **A repeat report is deduped silently.** Telling someone "you already reported
  this" when they are upset enough to try twice serves nobody.
- **The response says nothing about the target.** Reporting a nonexistent id
  returns the same "received" as a real one, or the endpoint becomes a way to
  test whether a private map exists.

The queue (screen 21) is ordered by **how many people reported the same thing**,
not by time. Ten reports on one node is the signal; the oldest row usually is
not. Acting on one report resolves every sibling report on the same target.

§15's five actions, ordered least to most destructive, reversible first —
`dismiss`, `warn`, `unpublish`, `remove`, `suspend`. A queue that puts Remove
next to Dismiss gets Remove pressed by accident on a tired afternoon.

**The audit trail outlives what it describes.** `moderation_actions.target_id`
is a plain column with **no foreign key**, so removing a map does not erase the
record of who removed it — which is exactly when the record matters. Tested by
deleting both the target and the moderator and asserting the entry survives.

And the constraint that is really a promise: §15 says _"private maps are not
scanned — scanning private content is a promise you cannot walk back."_ There is
no sweep, no classifier, and no code path that reads a private map without a
report pointing at it.

---

## Known gaps

- **No manual screen-reader testing.** The automated pass is clean and the tree
  is driven by keyboard for real, but nobody has used this with NVDA, JAWS or
  VoiceOver. That is the single largest remaining a11y unknown.
- **The canvas has no accessible representation of its own.** The tree view is
  the equivalent surface, which is what §20 asks for — but a user who lands on
  the map has to know to switch.
- **No real penetration test.** The pass covers known classes automatically; it
  is not a substitute for someone trying properly before launch.
- **The load test is single-process.** A real capacity test belongs after the
  Postgres move, and the numbers above are a floor, not a ceiling.
- **`warn` records but does not notify.** It writes the audit entry and resolves
  the report; telling the person they were warned needs the notification
  fan-out wiring that P11 built but this does not yet call.
- **No automated screening on publish.** §15 asks for text classification and a
  domain blocklist on publish-to-public; only reporting is built.
- **Report is on nodes only.** The dialog takes any of the four target types,
  but only the node sheet currently opens it — map, message and profile
  overflows still need the entry point.
