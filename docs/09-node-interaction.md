# Node Interaction (P4)

**Status:** Shipped · **Date:** 2026-08-31 · **Phase:** P4

Implements §08 screens 03 and 22, §09 selection and detail, §10 the interaction contract, and §06's lens.

---

## Measured against the acceptance criteria

| §20 criterion                     | Result                                                  |
| --------------------------------- | ------------------------------------------------------- |
| 3-tap path to a live destination  | **Verified.** Arrive → tap node → Open reaches `/watch` |
| Every dark node captures interest | **7/7**, deduped per person per node                    |

`npm run verify:node` runs 29 browser checks against a live server: the detail API, all four modes, the 3-tap path, interest capture and its rejections, the Coming Soon page, share-link resolution, and the desktop inspector.

## How "sheet component sprawl" was avoided

§20 names it as this phase's risk, and it materialises in a specific way: someone needs a Coming Soon variant, adds `ComingSoonSheet.tsx`, and six weeks later there are four sheets whose headers have quietly diverged.

The split here is along the one axis that genuinely differs:

```
NodeDetailBody          WHAT is shown — mode: view | edit | soon | locked
  ├── DetailSheet       WHERE, on mobile — bottom sheet, 45% → 90%
  └── InspectorPanel    WHERE, on desktop — persistent 360px right panel
```

**A new mode is a branch in `NodeDetailBody`. A new presentation is a new shell. Neither is ever a copy of the other.** The Coming Soon _page_ (`/soon/<id>`) composes the same `ComingSoonBlock` the sheet uses, which is how "the page needs a slightly different version" was prevented from becoming a fifth sheet.

`NodeDetailContainer` is the only place that chooses sheet vs inspector, so no screen ever has to.

## The four modes

| Mode     | When                         | Behaviour                                                               |
| -------- | ---------------------------- | ----------------------------------------------------------------------- |
| `view`   | Live node                    | Description, meta, Open / Expand / Copy link                            |
| `soon`   | `status = coming_soon`       | Target window, interest capture, related live nodes. **No Open action** |
| `locked` | Private, viewer lacks access | Title and path only. "Ask the owner for access"                         |
| `edit`   | Owner, editor open           | Declared; P5 builds the UI                                              |

**Permission is checked before status.** A private Coming Soon node reads as `locked`, not `soon` — otherwise the soon state confirms content exists behind the lock and leaks its target window.

**A locked node's payload omits the description entirely** rather than sending it and hiding it client-side. Hiding in the UI ships private content to the browser, where it is one network-tab click away. That is P7's rule ("no private node data in any shared response body") arriving early, because retrofitting it onto a client that expects complete objects is much harder.

## Interest capture

ADR-0001's whole bet. §24 measures ≥10 registrations per dark node in month one, and that number ranks months 4–6.

- **Open to signed-out visitors.** Requiring an account would collect only the opinions of people who already committed and discard everyone else's — inverting the signal.
- **Email is optional.** One tap is the whole ask.
- **Deduped** per person per node: signed-in user id when present, else a hashed visitor identifier.
- **Rejects live nodes (409) and unknown nodes (404).** Without that check the endpoint is an open counter anyone can inflate for any string, and the build-order data is worthless.

### Privacy of the visitor identifier

The lazy dedupe key is an IP address. That is wrong here: ADR-0006 commits us to a strong privacy position, and an IP log is personal data with retention obligations, collected to count a button press.

Instead the IP and user-agent are hashed with a per-process salt, **truncated to 16 hex characters**, and never stored raw. Truncation makes collisions possible and reversal impractical — slightly undercounting is a far better failure than holding a de-anonymisable identifier. The salt rotates on restart, bounding how long any hash can be correlated. For a build-order signal, approximate is entirely sufficient.

### Storage — the honest caveat

The store is an interface with an **in-memory default**. It does not survive a restart and is per-process. Correct for development and preview; **not sufficient for production**.

Until P6 lands the Postgres table (schema is in `src/lib/interest/store.ts`), the durable signal is the `coming_soon_interest_registered` analytics event. **Do not read month-one numbers out of the in-memory store.**

## The lens, and ADR-0002

`LensPill` is where ADR-0002's other half lands. The ADR refused auto-repositioning by popularity; Trending is the explicit, temporary, reversible way to get that view.

Two properties make it read as a _view_ rather than as the map having rearranged itself, and both are required:

1. the pill stays lit while a non-default lens is active;
2. a persistent **Back to layout** control sits beside it.

`trending` is the only code path in the entire layout where weight touches position. A test asserts every other lens leaves `theta` untouched.

`active` filters before layout, so the ring re-spaces evenly rather than leaving seven holes where the dark nodes were.

## Deep links

- `?node=<id>` is mirrored with `history.replaceState`, not `router.push`. Pushing would put every tap in the back stack, so Back would walk backwards through selections instead of leaving the map.
- `/n/<id>` now resolves properly: live → `/map?node=`, Coming Soon → `/soon/<id>`, private-without-access → **404, not 403** (a 403 turns a share link into an existence oracle).
- `/soon/<id>` is server-rendered so a shared link arrives complete rather than as a shell that fills in.

## Defects found by looking at the screens

Three, all real, none caught by the automated checks:

1. **`Button`'s `family` prop was documented but never read** — a P1 defect. Every primary button painted in the ambient context family, so an orange Services node offered a cyan Open button. Now honoured, with the context family as fallback.
2. **Zoom controls sat behind the desktop inspector** and became unreachable exactly when a node was selected. They now shift left by the panel width.
3. **The sheet drew a full-width cyan focus ring.** The panel takes programmatic focus so a screen reader lands inside it, and Chrome treats that as `:focus-visible`. Suppressed on the panel only — every control inside keeps its ring.

Also: the lens pill overlapped the layer stepper, now offset by the stepper's measured height.

## Known gap — the arrival metric

**`/maps` redirects signed-out visitors to `/sign-in`.** Mind Mapping sits at slot 0, twelve o'clock, the most prominent node on the map — and tapping through it lands a first-time visitor on a sign-in wall rather than a destination.

§24 measures arrival for **new** visitors, who are signed out by definition, so this directly damages the metric the MVP is judged on.

§08 screen 07's permission state already specifies the right answer: _"Signed out: sign-in prompt with value copy"_ — render the screen with a prompt, not a redirect. P2's guard implemented it as a redirect, which is a spec deviation.

**This is P6 work** (it needs screen 07's signed-out state built), so it is not fixed here. The harness asserts the current behaviour explicitly as `KNOWN GAP` rather than testing the signed-in happy path and pretending the criterion is fully met. The 3-tap criterion is verified against Page Watcher, a genuinely public destination.

## Other known gaps

- **`edit` mode is declared, not built.** P5.
- **Sheet drag has no velocity fling** — it snaps to the nearest detent on release. Adequate; a fling would feel better.
- **No focus trap in the sheet.** It is non-modal by design (`aria-modal="false"`) so the map stays reachable, but that decision should be re-tested with a screen reader in P13.
- **`relatedLive` only considers siblings.** A Coming Soon node whose siblings are all dark gets an empty list; none currently do.
