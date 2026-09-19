# 14 — Link-to-Mind-Map (P9)

Screen 14. Paste a URL, get a map you can edit. §12 calls it "the single most
demonstrable feature in the MVP. It must feel like magic and fail like an
adult."

§20 gives this phase two `High` risks, and they pull in opposite directions:
**the fetcher is an abuse surface**, and **LLM cost per run**. The first says
be paranoid about what we fetch; the second says fetch and think as little as
possible. Most of the design below falls out of taking both seriously.

---

## The shape

```
paste ──► preview (title resolves)     step 3, <800ms
      ──► run  ──► Fetching            step 4, SSE, four named stages
                   Reading
                   Structuring
                   Laying out
      ──► preview the map + checklist  steps 5 and 6
      ──► name it, save it private     steps 7 and 8
```

| Module                    | What it owns                                                      |
| ------------------------- | ----------------------------------------------------------------- |
| `lib/ingest/ssrf.ts`      | The address policy. Pure, no I/O, exhaustively tested.            |
| `lib/ingest/fetcher.ts`   | The guarded fetch and robots.txt.                                 |
| `lib/ingest/extract.ts`   | HTML → title, headings, text, paywall signal.                     |
| `lib/ingest/structure.ts` | Headings → tree; the model call; the stub.                        |
| `lib/ingest/budget.ts`    | Rate limits and the monthly spend cap.                            |
| `lib/ingest/pipeline.ts`  | The four stages and the failure taxonomy. Server only.            |
| `lib/ingest/contract.ts`  | Stage names, failure codes, **messages**. Shared with the client. |
| `lib/ingest/edits.ts`     | The four permitted edits on a proposal.                           |
| `lib/ingest/to-draft.ts`  | Proposal → `MapDraft`, the same object the editor uses.           |

---

## Risk 1 — the fetcher is an abuse surface

A server that fetches a user-supplied URL is an HTTP client sitting **inside**
the trust boundary. Unguarded, the first thing it is asked to do is read the
cloud metadata endpoint and hand back a set of credentials.

The policy is applied at **three** points, and only the third is sufficient on
its own:

1. **Before the first request** — `checkUrl`. Rejects the obvious and gives the
   user an honest message instead of a socket error.
2. **At every redirect hop** — redirects are followed _by hand_. This is the
   classic bypass: validate `example.com`, let the HTTP library transparently
   follow a `302` to `169.254.169.254`, and the guard never runs again.
   `maxRedirections: 0` and a loop that re-runs the policy each time.
3. **At TCP connect, on the resolved IP** — an undici `connect.lookup` hook.
   This is the only check DNS rebinding cannot race: the first two ask a
   resolver what a name means, and a hostile resolver is free to answer
   differently a millisecond later when the socket actually opens.

All resolved addresses must be public, not merely the first — a name answering
with one public and one private address is a rebinding attempt, and which one
the stack picks is not ours to predict.

Blocked: loopback in every spelling (`127.1`, `2130706433`, `0177.0.0.1`,
`::1`), RFC1918, CGNAT, link-local (the metadata range), IPv4-mapped IPv6
(`::ffff:169.254.169.254` — the most commonly missed bypass), NAT64, 6to4,
multicast, non-HTTP schemes, credentials in the URL, and non-web ports.

Other limits, each named after what happens without it:

| Limit       | Without it                                            |
| ----------- | ----------------------------------------------------- |
| 3 redirects | An open redirect walks us to metadata                 |
| 2 MB body   | A multi-gigabyte response is a memory DoS             |
| 8 s timeout | A server that accepts and never replies pins a worker |
| HTML only   | Wasted budget on a PDF or an image                    |

**robots.txt is honoured**, per §12: "a legal and reputational line, not a
preference". RFC 9309 precedence: the group naming us beats `*`, longest
matching rule wins, `Allow` breaks a tie. An unreachable robots.txt is _allow_
(RFC 9309); a `5xx` is _deny_. Verified in the harness against real sites that
disallow unknown crawlers.

---

## Risk 2 — LLM cost per run

**The deterministic path runs first, and it is the preferred path — not a
fallback.** A page with a usable heading outline already contains its own
structure, and asking a model to reproduce it costs latency, money and a chance
of invention.

In practice this is most of the web: of the 16 varied pages probed while
building this, **15 produced a usable map from headings alone**, with zero
tokens spent.

One subtlety worth recording. The first version rejected any page whose root
ended up with a single child — and that is the commonest shape on the web: one
`h1` carrying the page title, then `h2` sections. It sent the _best-formed_
pages on the internet down the paid path. The fix is to collapse a lone `h1`
into the root, since it almost always duplicates the page title anyway.

The model call, when it happens, uses **tool use** rather than "reply with
JSON" — the schema is then enforced by the API rather than by hoping — and the
result is _still_ validated with zod, because schema enforcement covers shape,
not our own depth and breadth limits.

**Caps** (`budget.ts`), all checked before any network call:

| Limit           | Value                                 | Why                                                         |
| --------------- | ------------------------------------- | ----------------------------------------------------------- |
| Signed-out      | 1 run, ever                           | §12: "1 free run, then sign-in"                             |
| Per user        | 10/hour, 40/day                       |                                                             |
| Per source host | 12/hour, across all users             | Not our cost — not being the reason a small site falls over |
| Monthly spend   | `INGEST_MONTHLY_USD_CAP`, default $50 | §20's "hard monthly cap"                                    |

Two properties matter more than the numbers:

- **Failed attempts count.** A limit that only counts successes is not a limit:
  a scan produces almost entirely failures, which is exactly the traffic being
  capped. The run row is written _before_ the fetch.
- **The spend cap degrades, it does not disable.** Over budget, the model path
  closes and the free structurer keeps working. §20 asks for "graceful
  degradation", and that means the feature gets less clever, not unavailable.

IPs are never stored — only a salted hash. An unsalted SHA of an IPv4 address
is reversible by brute force in seconds.

---

## Every failure has a specific message

`IngestFailure` is a closed union and `FAILURE_COPY` is a `Record` over it, so
a new failure mode **cannot be added without the compiler demanding its
message**. That is what enforces the acceptance criterion; a promise to
remember would not.

| Failure             | Message                                           | Retry? | Fallback             |
| ------------------- | ------------------------------------------------- | ------ | -------------------- |
| `unreachable`       | "That page didn't respond"                        | yes    | retry                |
| `blocked-by-robots` | "This site asks not to be read by tools like CDN" | **no** | build by hand        |
| `auth-required`     | "We can only read publicly visible pages"         | no     | paste the text       |
| `too-thin`          | "Not much text to work with"                      | —      | a 3-node starter map |
| `model-failed`      | "Structuring took too long"                       | yes    | retry                |
| `rate-limited`      | "Sign in to turn more pages into maps"            | —      | sign up              |
| `blocked-address`   | "We can't read that address"                      | no     | build by hand        |

Two of these are deliberate departures from "show an error":

- **robots gets no Retry button.** The answer will not change, and offering one
  invites the user to argue with a decision that is not ours to reverse.
- **`too-thin` is not an error at all.** It returns a real three-node map with a
  note. Delivering nothing would be the one failure that leaves someone staring
  at an empty screen after they pressed a button.

A paywall is detected from the _extracted text_, not the status code, because a
site would usually rather serve a login wall with `200` than a `403`. A
structured signal (`isAccessibleForFree: false`, `article:content_tier`) is
trusted on its own; a prose signal only counts on a short page, since "subscribe
to continue reading" in the footer of a full article is a promo, not a wall.

---

## Four named stages, not a spinner

§12: "Never a generic spinner. Named stages make 15 s feel like 5."

The stages are **real** — each is emitted by the server when that stage begins,
streamed over SSE. A sequence faked on a `setInterval` looks identical until
something is slow, at which point it lies: it sits on "Laying out" while the
fetch is still hanging, and the user's model of what is happening is wrong
exactly when they need it to be right.

The progress bar sits at the _start_ of the active stage rather than
interpolating within it, for the same reason at a smaller scale.

SSE is a `GET` because `EventSource` only issues GETs. Safe here: the request is
rate-limited and creates nothing the user keeps — the map is written only by the
separate save route, after they have edited it. Cancellation is the browser
closing the stream, which aborts the request, which aborts the pipeline between
stages and the model call mid-flight.

---

## The preview, and the 800ms budget

§12 calls resolving the title before processing "the trust moment" and budgets
it at 800 ms.

The first version took **2.4 seconds**, because it downloaded an entire article
to read forty bytes of its `<head>`. The fetch now stops at `</head>`. Measured:

```
our own share of the preview   8ms
total, warm                    549–715ms  (537–688ms of it upstream)
```

Almost all of the remaining time is the round trip to someone else's server. The
harness asserts on **both** numbers separately — asserting only on the total
fails when a third-party origin is having a slow morning, and passes when our
own extractor doubles in cost.

The preview is deliberately **not** counted against the rate limit: it fires on
every paste, including corrections, and charging a run for each would spend a
signed-out visitor's single free run before they ever pressed the button. The
fetch is still guarded, size-capped and timed out, which is what bounds it.

---

## Editing the proposal

§12 permits exactly four edits and says "keep it to these four. Full editing
happens after save, in the real editor." That limit is the design: everything
this screen could do, the P5 editor does better.

Node ids in the proposal are **positional** (`p0-2` is "third child of the
first child"). That buys stability — a node switched off stays off across a
depth change or a re-render — and it costs correctness the moment a node moves,
because every id below and after it now means something different.

So the edits split in two:

- **Toggle and rename** are non-structural. They live in a set and a map beside
  the tree; the tree is never touched.
- **Reparent and merge** are structural. They **bake** the pending toggles and
  renames into a new tree _first_, then move the node, then hand back an empty
  set and map.

Skipping the bake is the bug this design is built around: reparent one node and
every previously-excluded id silently points at something else.

The proposal is rendered through **`MapCanvas`** — the real renderer, not a
list — because §12 is explicit that "the user must see it is a _map_", and what
they approve should be what they get.

---

## Saving

A generated map is an ordinary map. It goes through `createMap` with the same
`AuthContext` and the same quota check as one built by hand: a second write path
is a second place for ownership to go wrong.

- **Private, always.** §12: "non-negotiable — the source may be paywalled or
  personal." Stated on the screen rather than offered as a control, so there is
  nothing to get wrong; sharing is one click away afterwards.
- **Attribution on every node** (`href`), plus `source_url` on the map.
- The structure arrives **from the client**, because the user has been editing
  it — so it is re-validated and re-clamped server-side rather than written as
  sent. Depth is bounded by the _schema_ rather than a check after parsing, so a
  deeply nested payload is rejected during parse instead of being walked; an
  unbounded `z.lazy` would recurse until the stack ran out.
- The source URL is re-checked against the SSRF policy before storage — not
  because we fetch it again, but because it becomes a link every viewer clicks.
- An over-long **summary is truncated, not rejected**. Nobody typed these; they
  come out of the page. Refusing an entire map because one description ran a few
  characters long is a bad failure — and was a real one, caught by the harness.
  The **title** stays strict, because that is the field the user edits.

---

## Verifying

```bash
npm run verify:link      # needs the app running: npm run build && npm start
```

32 checks, against the live server and the real internet:

- 16 SSRF attacks refused at the preview route, and at the run route
- a blocked address leaks no detail about what it found (a distinguishable
  error is a port scan)
- **10 varied URLs produce useful maps** — varied in _shape_, not just subject:
  encyclopedia, reference docs, a formal specification, an RFC, a tutorial.
  "Useful" is defined, not left to taste: ≥6 nodes, ≥2 branches, every node
  labelled, at least two levels.
- every failure mode reached for real — robots against a site that genuinely
  disallows us, a real `403`, a real thin page — with distinct messages
- the free run, and its refusal
- the screen: named stages, cancel, the canvas painted, depth control, toggling,
  private by default, save, attribution

The harness clears `ingest_runs` before starting, because the limits persist and
would otherwise throttle the second run of the harness itself. It also gives
every browser context a unique user agent: signed-out callers are bucketed by
address plus agent, and on localhost every request shares one address.

---

## Known gaps

- **`INGEST_HASH_SALT` must be set per environment.** The default is a
  development value.
- **Batch URLs, PDFs and authenticated pages are out**, per §12's assumption.
- **The paste-text fallback structures in the browser** and is deliberately
  crude — splitting on blank lines. Sending that text to the server would make
  us the store of someone's paywalled article.
- **DNS rebinding is closed at the socket, but an egress proxy is still the
  right production answer.** The connect hook is a strong mitigation inside one
  process; a network-level egress policy does not depend on application code
  being correct.
- **The model path is untested against a live key** in this environment — there
  is none configured. Its behaviour is covered by unit tests with an injected
  `fetch`, and the pipeline degrades to the free path when the key is absent,
  which is the path the harness exercises.
