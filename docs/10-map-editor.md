# Map Editor (P5)

**Status:** Shipped · **Date:** 2026-08-31 · **Phase:** P5

Implements §08 screens 07, 08, 09 and 10, and §14 (user-created maps).

---

## Measured against the acceptance criterion

| §20 criterion                         | Result                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Blank → 10-node map in <3 min unaided | **Path verified.** 10 nodes in 3.5s of scripted interaction, 10 actions, no dead ends |

A script cannot run a usability test. What it can prove is that the path exists and nothing blocks it: create → add → type → add, with the cursor always where the next keystroke should go. **The unaided-human half of this criterion is still outstanding** and needs a real session with someone who has not seen the editor.

`npm run verify:editor` runs 24 browser checks: the create flow, the ten-node path, autosave, the undo risk, delete-with-undo, conflict refusal, authorisation, and the structural guard.

## The named risk: undo across canvas and form

§20 rates this High, and it is. Four decisions handle it.

**1. Commands carry `before` AND `after`.** Inversion is total and computed from the command alone. An inverse derived at undo time reads current state, and is wrong the moment another command has touched the same node in between — which is exactly what happens when someone drags a node and then renames it. Tested directly: an unrelated edit survives an undo of the rename.

**2. A drag is one command, pushed on drop.** Canvas gestures fire continuously; per-`pointermove` commands would make one reposition take sixty undos. The dragged node's _drawn_ position is overridden during the gesture, so nothing enters the stack until release.

**3. Typing is one command, coalesced.** The mirror problem. `update_node` commands on the same node and field merge within 900ms, so undo reverses "the rename" rather than "the letter y". Coalescing lives in the stack, not at the call site — the node editor is a plain controlled form and knows nothing about it.

Coalescing breaks on blur and on selection change. Without that, typing in one node, tabbing to another and typing again within the window would merge two nodes' edits into a single command — the cross-surface bug in its purest form.

**4. The form is controlled by the draft, never by local state.** This is what makes Cmd+Z work _inside a text field_. With local form state, undo would revert the draft and leave the input showing the old text; the next keystroke would write the stale value back. Verified: undo from inside a focused title field reverts both, and redo restores both.

## Local-first

§14: _"Autosave, debounced 800ms… No Save button. A Save button in a canvas editor is a bug report waiting to happen."_

Every command applies synchronously to the in-memory draft and persists to `localStorage` immediately. The network save runs behind it. So an edit never waits on a round trip, closing the tab loses nothing, and offline is not a mode — it is a slow save.

On load the client **prefers a newer local draft over the server copy**. Server-first would silently discard offline work, which is the one thing a local-first editor must never do. A local draft on an _older_ version is stale and discarded.

Flush happens on `visibilitychange`, not `beforeunload` — mobile browsers frequently kill a backgrounded tab without ever firing the latter, which is precisely when unsaved work is lost.

## Conflict handling

The client sends the version it last saw. A stale version is **refused with 409**, and the current map comes back so the user gets a real choice.

Last-write-wins is one line shorter and silently deletes a collaborator's work — the failure nobody notices until the person whose edits vanished asks where they went. Verified: a stale write is refused and does not land.

The server also refuses structurally broken maps (no root, or a node pointing at a missing parent). Those would render as an empty or infinite canvas, so they are rejected at write time rather than discovered later.

## Interaction model

| Gesture              | Does                                       |
| -------------------- | ------------------------------------------ |
| **+** or **Enter**   | Adds a **sibling** of the selection        |
| **Tab**              | Adds a **child** of the selection          |
| Drag a node          | Reposition; drop on another node reparents |
| Alt+drag             | Free position (§14)                        |
| Delete/Backspace     | Delete the selection                       |
| Cmd/Ctrl+Z, +Shift+Z | Undo, redo — including inside form fields  |

The +/Tab split matters. Focus follows each new node, so if + added a _child_ every time, nine presses would build a nine-deep chain — almost nobody wants that. A map is usually a root with branches, and the common motion is "another one at this level".

Delete confirms **only when a subtree is at stake** (§14) and offers a 10-second undo otherwise. Confirming every delete makes building a map exhausting; confirming none makes losing four nodes a single mis-tap.

`moveNodeCommand` refuses a drop that would make a node its own descendant — otherwise the subtree detaches and nothing renders it.

## Defects found by looking at it

**Focus stayed on the + button after an add.** `autoFocus` only fires on mount, and adding a second node while the panel is open is an update. So every new node needed a click into the title field before typing — which breaks the add→type→add rhythm the whole 3-minute criterion rests on. Now an effect keyed on node id moves the cursor into the title of any new, untitled node.

I found this because the harness typed a _space_ into what it thought was the title field and re-pressed the FAB instead: 9 clicks produced 18 nodes. The symptom was a test artifact; the cause was real.

**The + FAB sat on top of the recentre control.** Both are bottom-right and both shift left to clear the inspector, so at the same vertical offset they collided. The FAB now stacks above the zoom column.

## Storage — the honest caveat

Both the map store and the interest store are **in-memory**. They do not survive a restart and are per-process.

Work is not lost — the editor is local-first and keeps its draft in `localStorage` — but a map will not be there on another device until P6 lands the tables. The schema for both is written out in `src/lib/maps/store.ts` and `src/lib/interest/store.ts` so P6 is a swap, not a design exercise.

**Ownership is enforced in the route handlers**, not by row-level security. That is weaker: one missed check leaks a map. P6 adds RLS, and §20 already rates "RLS mistakes leak data" as High.

## Known gaps

- **Reference edges** (§14: dashed, non-structural, in addition to one parent) are not built. The data model has no second edge type yet; adding one touches the layout and the renderer, so it was left rather than half-built.
- **Slot-level rearrange** — dropping on empty canvas keeps the parent and takes the next free slot rather than snapping to the nearest angular slot under the pointer. Reparenting works; fine-grained reordering does not.
- **Duplicate and rename-from-card** (§14, map menu) are not built. Rename works in place in the toolbar.
- **Activity log** (§14) is not built. It is listed there as "cheap to build, disproportionately trust-building" and belongs with P7's sharing work.
- **Templates are structure only.** Branch titles, no example content. Whether that is enough to speed someone up is exactly what the usability test should answer.
- **The unaided usability test has not been run.** The scripted path is verified; the human half of the criterion is not.
