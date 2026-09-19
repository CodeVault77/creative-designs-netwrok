# Radial Map (P3)

**Status:** Shipped · **Date:** 2026-08-31 · **Phase:** P3

Implements §09 (map specification), §10 (node system) and the §17 performance targets. This was flagged as the project's biggest technical risk.

---

## Measured against the acceptance criteria

| §20 criterion                              | Result                                                          |
| ------------------------------------------ | --------------------------------------------------------------- |
| 60 fps with 150 nodes on mid-range Android | **61 fps** sustained pan, Chromium at 390×780 DPR 3             |
| Tree view matches map exactly              | 12 ring-one rows, 7 Coming Soon badges — same graph, same state |

`npm run verify:map` runs the browser harness: 19 checks covering canvas paint, chrome, frame rate, tap semantics, tree parity and keyboard operation. Requires a server on :3000.

**Caveat worth stating plainly:** 61 fps was measured in Chromium on this development machine, not on a physical mid-range Android. The architecture is built for the target and the headroom looks comfortable, but §20's criterion is not fully discharged until it runs on real hardware. That is the one P3 item still genuinely open.

## Architecture

Pure logic in `src/lib/map/`, React only at the edges. Everything below is unit-testable with no DOM:

| Module           | Responsibility                                         |
| ---------------- | ------------------------------------------------------ |
| `geometry.ts`    | Polar layout: `R(r) = R0 + r × G`, fixed angular slots |
| `camera.ts`      | World↔screen, anchored zoom, momentum, cull bounds     |
| `layout.ts`      | Walk → cluster → focus → cull → cap, plus edges        |
| `zoomTiers.ts`   | Overview / Default / Detail from scale alone           |
| `hitTest.ts`     | Screen-space targets, separate from visual geometry    |
| `glowSprites.ts` | 18 pre-baked halos                                     |
| `renderer.ts`    | The canvas draw pass                                   |
| `pointers.ts`    | `pointerId`-keyed gestures                             |
| `seed.ts`        | Community Map data + synthetic maps for perf work      |

**The rule in `MapCanvas`:** state that changes per frame lives in a ref and is read inside `requestAnimationFrame`; state the rest of the app needs lives in React. A `setState` per `pointermove` would re-render the tree 120 times a second, and no amount of memoisation makes that acceptable at 150 nodes.

## The five things that make it fast

1. **Pre-baked glow sprites.** 6 families × 3 levels, baked once into offscreen canvases and blitted with `drawImage` under `globalCompositeOperation: 'lighter'`. §16 and §23 both forbid live `box-shadow`/`filter` on canvas — a blur is a full-surface GPU readback per frame; a blit is effectively free.
2. **Flat during gestures.** §09: draw without halos while panning or pinching, restore on gesture end. The halo pass is the single largest frame-time cost, and the eye cannot resolve a soft halo on a moving object.
3. **Walk only expanded branches.** An unexpanded node's children are never placed — not placed then hidden — so a huge collapsed subtree costs nothing rather than "little".
4. **Cull to viewport + 20%.** The margin means nodes are already drawn when they slide in during a pan, instead of popping in at the edge.
5. **Cluster, then cap.** ≥6 sibling leaves collapse into one `+n` node at Overview scale; the 300-node cap is the backstop, dropping deepest-first so the centre stays intact. Clustering is the graceful mechanism and does most of the work; the cap is the guarantee.

§09 says clustering "must be in the renderer from day one — retrofitting clustering means rewriting hit-testing". It is: clusters are ordinary `PlacedNode`s, so hit-testing, selection and expansion treat them like any other node.

## Hit geometry is not visual geometry

§10 requires an 88px minimum target regardless of drawn size. `hitTest` measures in **screen** space, so a 12px dot at Overview scale still has an 88px target — a world-space target would shrink exactly when it is needed most.

At Overview these targets genuinely overlap: an 88px target is ~110 world units while ring-one siblings are ~78 apart. Nearest-wins resolves it, which is what keeps it predictable — the node under your finger is the one you get.

## The pointer model

Keyed by `pointerId` from the first commit, per §17's multi-touch decision. Free now, expensive to retrofit, because every gesture handler written against a single implicit pointer has to be rewritten.

One pointer pans (0.92 friction momentum); two pinch-zoom anchored at the midpoint. **Rotation is measured and discarded** — tracking it stops the small rotational drift every two-finger gesture carries from leaking into the pan delta.

Lifting one finger of a pinch drops back to a pan rather than ending the gesture. A pinch never coasts — momentum after a two-finger gesture reads as the map slipping away.

## Interaction contract (§10)

| Input            | Does                 | Never                                                   |
| ---------------- | -------------------- | ------------------------------------------------------- |
| Single tap       | Select + open detail | **Never navigates** — too easy to trigger while panning |
| Double tap       | Open destination     | Never zooms                                             |
| Long press 400ms | Expand children      | Never deletes                                           |
| Drag             | Pan                  | —                                                       |

Verified: a single tap on a node does not change the URL.

## Fixes found by looking at it

Three defects the automated checks passed but a screenshot caught. Worth recording because they are the class of problem tests do not find:

1. **The map opened cropped.** It rendered at scale 1.0 and ring one ran off both edges of a 390px screen. The camera now fits ring one _including its labels_ on mount — labels sit below the circles and clip first, which is easy to miss when reasoning about radii. Recentre returns to that fitted view, not to scale 1.
2. **The breadcrumb sat under the view toggle** at phone width. Now left-aligned with room reserved, centred only at ≥1024px.
3. **The layer stepper covered the ring's equator** — the nodes at three and nine o'clock and their labels. Moved low-left, mirroring the zoom column. §09 says "left edge"; it is still on the left edge, just not centred on the content it was hiding.

Also: labels now truncate by **measured width** against the arc available, not a fixed character count. The font has a 9px floor while nodes scale with the camera, so at a fitted zoom a fixed 18-character label is physically wider than the gap between two nodes.

## Accessibility

The canvas is `aria-hidden`. A canvas cannot be made meaningfully accessible by bolting labels onto it, and pretending otherwise is worse than admitting it.

The honest answer is `TreeList` — a real ARIA tree rendering **the same graph and the same expansion state**, which is why §24's "matches the map exactly" holds by construction rather than by synchronisation. It implements the full keyboard contract (↑↓ rows, →← expand/collapse/parent, Home/End, Enter to open) with a roving tabindex, so a 150-node map is one tab stop rather than 150.

The view toggle is a first-class control, not a setting. Some sighted users will simply prefer the list.

## Known gaps

- **Not yet measured on physical Android.** The one open acceptance item.
- **Node detail is not built** — tapping selects and emits `node_selected`, but the sheet is P4.
- **Search transformation of the map** (§09) is specified and the layout supports `searchMatchIds`, but the UI is P8.
- **Lens pill** (All / Active only / Trending / Mine) is §06 chrome, not in P3's component list. The Trending lens is where ADR-0002's sorted view lands.
- **Multi-expand on desktop** (`⌘`+expand) is plumbed through `additive` but has no key binding yet.
- **Desktop keyboard map navigation** (arrows between siblings, `/` for search, `Esc` to root) is specified in §17 and not yet implemented on the canvas — the tree view covers keyboard access in the meantime.
- **Canvas font stacks are literals**, not tokens. Canvas cannot read CSS custom properties — the concrete case ADR-0008 predicted. They must stay in step with `design/tokens.json` by hand.
