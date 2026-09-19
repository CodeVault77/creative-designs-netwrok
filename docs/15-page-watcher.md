# 15 — Page Watcher (P10)

Screens 15 and 16. Pick interests, press Go, scroll community pages, turn any
card into a node.

§13 names the design risk plainly: "the design risk is that it becomes a
generic feed and stops being CDN. The fix is that every card can become a
node." §20 names the delivery risk: **cold-start emptiness**. Both are content
problems more than code problems, and most of what follows is about them.

---

## The assumption that shapes everything

§13: Page Watcher browses **CDN community content** — public maps, service
nodes, published projects — **not the open web**.

That is why `content_items` is a denormalised _index over things already in the
system_, not a second content store, and why every read joins back to `maps`
rather than trusting the index. Unpublish a map and its card disappears on the
next query, instead of lingering until something sweeps it. It is the same rule
the search index follows: **an index authorises nothing**.

| Module                                | What it owns                                          |
| ------------------------------------- | ----------------------------------------------------- |
| `lib/watch/seed.ts`                   | The interest vocabulary and 81 seeded items.          |
| `lib/watch/repo.ts`                   | Feed, ranking, interests, saves. A peer of `repo.ts`. |
| `components/watch/ChipGrid.tsx`       | The picker (§13 step 2).                              |
| `components/watch/ContentCard.tsx`    | One card (§13 step 4).                                |
| `components/watch/InfiniteList.tsx`   | The scroll container.                                 |
| `components/watch/AddToMapPicker.tsx` | §13 step 6.                                           |

---

## The risk — cold-start emptiness

§13 states the mitigation outright: "seed 60–100 pages ... and let the empty
state say honestly that the community is new." So the seed **is** the
mitigation, and it is treated as product content rather than fixtures.

**81 items, 22 interests, all six families.** The specific way cold start bites
is not "the feed is empty" — it is **"I picked the one thing I care about and
got nothing."** So the constraint that matters is coverage, and it is tested:

- every interest has at least **3** items behind it (`watch.test.ts`)
- every interest, queried alone, returns a feed (`verify-watch.mjs`)
- the picker shows a **live count per chip**, so nobody picks blind
- the Go button reports the total waiting before you commit

Two honesty rules, because the alternative is unrecoverable:

- **Seeded items are labelled "Seeded by CDN."** They carry no owner, and the
  card says where they came from. Passing seeds off as community activity is
  the kind of thing you cannot walk back once someone notices.
- **The empty state says the community is new**, and offers the two things that
  actually help — widen your interests, or make the missing content with
  Link-to-Mind-Map. Not a shrug, and not a fake feed.

The seed is also tested for _quality_: real titles, real excerpts, no
placeholder text. A feed of lorem ipsum is worse than an empty one, because it
teaches people the feed is worthless.

---

## Ranking

§20 asks for "simple relevance ranking", and simple is the operative word:

```
matched interests DESC, published_at DESC, id DESC
```

Not a learned ranker. With 81 items and a fixed vocabulary, tag overlap **is**
the signal — and the UI tells the user _why_ each card appeared, by highlighting
the tags that matched. A score you cannot explain in a chip is a score that
feels arbitrary at this size.

One deliberate choice: when interests are selected, items matching **none** of
them are **excluded**, not ranked last. §13's feed is "pick interests, press
Go"; a feed that quietly mixes in everything else is not a filter, and there is
no way to tell the two apart on screen.

**Pagination is keyset, not `OFFSET`.** An infinite list on an `OFFSET` query
re-scans what it has already returned and shifts by one whenever a row is
inserted above — which the user sees as a card appearing twice, or vanishing,
halfway down. The harness walks all 81 items and asserts 81 distinct ids.

---

## The card, and the thing that keeps this from being a feed reader

Cards are **~72% viewport height** (§13 step 4), so one is always dominant. That
matters more when the corpus is small: 81 items in a dense grid look sparse; 81
items one at a time do not.

Three actions — Save, **Add to map**, Share. Add to map sits in the middle
rather than in an overflow menu, because it is the answer to §13's stated design
risk. On confirm the node is created with the card's title, excerpt, family and
a link back, and a toast offers "View in map".

The node keeps the **card's family**, not the map's: the card was that colour in
the feed, and a node that changes colour on arrival breaks the link between what
was chosen and what appeared. Its slot is `max(sibling slots) + 1` rather than
the sibling count, so deleting a node does not hand its position to the next one
added (ADR-0002).

---

## Details worth keeping

**The infinite list always has a real button.** The sentinel loads
automatically, but "Load more" is present and focusable. An infinite list with
no control cannot be operated from a keyboard, and strands anyone whose browser
never fires the observer. The end is announced too — a feed that simply stops is
indistinguishable from one that is broken, which matters most on the screen
whose risk is emptiness.

**`onLoadMore` is read through a ref inside the observer callback.** Otherwise
the effect re-subscribes every render, and re-subscribing while the sentinel is
on screen fires another load immediately — one scroll becomes four pages.

**Signed out is a first-class state.** The picker and the feed both work without
an account; the selection travels in the URL instead of the profile. Requiring
an account to look at community content puts a sign-up wall in front of the one
feature that might make someone want an account. Only saving and adding to a map
need sign-in, and both say so rather than failing quietly.

**The saved filter is URL-backed** (`?saved=1`). Found by the harness: without
it, reloading or sharing the page silently dropped the filter and showed the
whole feed, and the two views look similar enough that a reader would not
necessarily notice.

---

## Two bugs this phase found

**`--family-create-core` does not exist; the token is `--fam-create-core`.**
Written during P9, shipped through a green build. CSS does not complain about an
undefined custom property — it silently resolves to nothing, so the component
rendered with no accent colour and no error anywhere. Found by eye, which is not
a process, so it now has one: `src/lib/styles/vars.test.ts` walks every source
file, extracts every `var(--…)`, and fails on any name the token pipeline does
not generate. It expands interpolated names (`var(--fam-${family}-core)`) across
all six families, which is exactly where the bug lived.

**Two buttons named "Saved".** The header's filter and each card's Save button
shared an accessible name. The test harness clicked the wrong one and silently
switched the feed into saved-only mode — which is precisely what a screen-reader
user navigating by name would have done. The filter is now "Saved items".

---

## Verifying

```bash
npm run verify:watch     # needs the app running: npm run build && npm start
```

29 checks:

- **cold start**: 60–100 seeded pages, no interest empty, none under three
  items, every interest productive on its own, all six families, seeds labelled
- **ranking**: more matches first, every card explains itself, filtered means
  filtered, 81 items paginated with no repeats or gaps
- **the criterion, as one unbroken journey**: pick interests → Go → feed →
  scroll → Add to map → the node exists, read back from the API with the right
  title and family
- **the empty state**: says so plainly, offers a way forward
- **permissions**: no cross-user saves, no adding to someone else's map (404,
  not 403), no saving while signed out

---

## Known gaps

- **`ensureSeeded` runs on first read**, not in a migration, because the seed is
  product content that will change more often than the schema — and a migration
  that changes is not a migration. It is a no-op once a single row exists.
- **The in-app reader (§13 step 5) is the item's own route**; seeded items link
  to `/watch/item/<id>`, which is not built yet. Real community items link
  straight to the map or service they index.
- **§13 step 1's "map recedes rather than cuts"** is implemented as a route, not
  as a panel over a live canvas. A second canvas rendering under a panel nobody
  is looking at does not fit P3's frame budget; revisit if the transition is
  missed in testing.
- **Ranking has no personalisation beyond tags** — no history, no collaborative
  signal. That is correct at this corpus size and will not be at ten thousand
  items.
