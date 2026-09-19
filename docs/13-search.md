# Search (P8)

**Status:** Shipped · **Date:** 2026-08-31 · **Phase:** P8

Implements §08 screens 05 and 06, and §11 (search — the second navigation model).

---

## Why search is a second navigation model, not a feature

§11's framing drives every decision here. The radial map answers _"what is near this?"_. Search answers _"where is this?"_ — a different question, needing a different model. The two have to interoperate, or search becomes a **trapdoor**: you fall out of the map you had arranged and cannot climb back.

That is why the camera snapshot is an acceptance criterion and not a nicety.

## The risk: permission leakage via search

§20 rates this **High**, and rightly. A search index is the classic place where authorisation is quietly lost: the index is built once, by a process with full access, and then queried by everyone. If the query does not re-apply permissions, the index becomes an oracle — you cannot open the document, but you can confirm word by word what is in it.

Four rules, all enforced in `src/lib/search/query.ts`:

1. **The index authorises nothing.** It stores rows; every read joins back to `maps` and applies a permission predicate in SQL.
2. **The predicate mirrors `repo.ts`.** `VISIBLE_MAP` is the same shape as `PREDICATE.visible` from P6 — owner, public, member, or staff. Two different predicates for "can see this map" is how one of them ends up wrong.
3. **Private nodes never match.** A node under a private subtree is excluded outright, exactly as `buildSharePayload` (P7) refuses to send it.
4. **Titles only, for outsiders on a node-viewable-off map.** This is the subtle one. If a map's owner has turned node detail off, an outsider receives titles and no descriptions. If search could match on description text, it would report a hit for a word the payload refuses to send — the oracle again, arriving by a side door. So for that audience the match expression is restricted to the title column.

Rule 4 has no visible symptom. It exists only because the alternative is a leak.

### Silence, not a tease

§08 screen 06 requires withheld results to be excluded **silently**. No "3 results hidden" count — a count is itself a disclosure, and a precise one. The harness asserts the response body contains neither `hidden` nor `withheld`.

### The session decides, not the request

`userId` and `isStaff` come from the server session and are never read from the query string. The harness forges both and confirms nothing changes.

## Verification

`npm run verify:search` runs **25 checks** against a production build. The leakage checks read **raw HTTP bodies**, for the same reason P7's review did: a UI test passes happily while the secret sits in the network tab. Each run seeds a uniquely-named secret node in a private map, so a match is unambiguous.

Plus 41 unit tests in `src/lib/search/search.test.ts`.

## Acceptance criteria

### "<300 ms suggestions"

Measured both server-side and as a full round trip. Worst observed: **2 ms server, 11 ms round trip** across five terms. FTS5 with `porter unicode61` tokenisation; the permission predicate is a join, not a post-filter, so it narrows the scan rather than following it.

The client debounces and the field shows a spinner, because the budget is about _felt_ latency and a field that redraws on every keystroke feels worse than one that settles.

### "map results render"

Results have a tree view and a map view. The map view is the same `MapCanvas` as everywhere else — search results are a graph, and rendering them any other way would mean a second renderer to keep in step. Verified by sampling the canvas pixel buffer (105 lit samples), not by asserting an element exists; a canvas with nothing painted on it still passes a presence check.

### "back restores exact state"

The hard one, and where the real bugs were.

`src/lib/search/snapshot.ts` keeps one snapshot in `sessionStorage` — camera, expansion set, selection, centre node, return href — with a one-hour expiry.

**Capture** runs from the map's layout callback, throttled to 400 ms. It began as a state effect, which was wrong: the camera lives in a ref and panning never re-renders, so the snapshot recorded the position at mount and nothing after. It read `x=0` no matter where the user had actually panned to.

**Restore** runs in a **layout effect**, and the timing is the whole trick. Three things it deliberately is not:

- **Not during render.** Arriving from the results screen is a client transition, and `window.location` still says `/search` while the new tree renders. A render-time read saw no flag and restored nothing.
- **Not `useSearchParams`.** It would force a Suspense boundary and cost `/map/tree` its static prerender.
- **Not a passive effect.** `MapCanvas` fits ring one to the viewport as soon as `ResizeObserver` reports a size, and that delivery can beat a passive effect — the fit then paints over the restored camera. This was the original failure: the harness reported the default zoom every time.

The snapshot is handed to `MapCanvas` as `initialCamera`, which **replaces** the fit rather than racing it. A flag beats a race.

The restore flag is then stripped from the URL and the snapshot cleared, so a refresh does not re-apply a position the user has since moved away from.

#### The assertion that was passing for the wrong reason

Worth recording. The check originally compared only `camera.scale`. The harness pans but never zooms — so scale sits at exactly the fitted value, and the assertion passed whether the restore ran or not. It now compares `x`, `y` **and** `scale`, and `MapCanvas` exposes `data-camera-x` / `data-camera-y` alongside `data-scale` to make that observable.

The tell that something was wrong was not the camera check at all. It was the URL still reading `?restore=1` — the flag had not been consumed, which meant the restore had never run. That is now its own check.

## Other defects found

- **A sticky-header bug.** The app's `TopBar` intercepted pointer events on the Map/Tree toggle, making it genuinely unclickable after scrolling. Fixed by making the search screen's header and filter row sticky _below_ it with explicit z-indexes. Found by the harness, not by review.
- **The return path was buried under the tab bar on phones.** The return bar and the `TabBar` are both fixed to the bottom of the viewport, so at phone width the link sat exactly behind it — in the DOM, invisible to the user, and §11 requires it to be reachable. The desktop harness could never have seen it, because the rail layout has no tab bar. There is now a phone-width check that asks `elementFromPoint` whether the spot a thumb would land on actually belongs to the link; a visibility assertion alone would have passed.
- **Grouped results opened clipped.** Grouping pushes members out to ring two, but `MapCanvas` always fitted ring one — fine for the browsable map, where deeper rings are meant to be panned to, wrong for a fixed-height panel with nothing to pan. `fitDepth` now frames the deepest occupied ring. Found by looking at a screenshot; every automated check was green.
- **A 500 on a duplicate node id.** Node ids are globally unique; a client submitting one already in use produced an unhandled `SQLITE_CONSTRAINT_PRIMARYKEY`. Now a 409, with a message that does not say which map holds the id — that would confirm the existence of a map the caller may not be able to see.

## Files

| File                                     | Role                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| `src/lib/search/query.ts`                | Permission-aware search. The four rules above.               |
| `src/lib/search/snapshot.ts`             | The camera snapshot store.                                   |
| `src/components/search/SearchScreen.tsx` | Screens 05 and 06.                                           |
| `src/components/search/SearchField.tsx`  | The combobox field.                                          |
| `src/app/api/search/route.ts`            | Session-derived auth context; never trusts the query string. |
| `src/lib/db/migrations.ts`               | Migration 3 — the FTS5 tables and their triggers.            |
| `scripts/verify-search.mjs`              | The 25-check acceptance harness.                             |

## Postgres

Migration 3 creates SQLite FTS5 tables. The production equivalent is `tsvector` columns with GIN indexes; the permission predicate is unchanged, because it is ordinary SQL against `maps` and `map_members` and does not depend on the text-search engine. `POSTGRES_RLS` in `migrations.ts` carries the row-level-security policies that will enforce the same rules a second time at the database.
