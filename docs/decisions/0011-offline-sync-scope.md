# ADR-0011 — Offline sync: what the CRDT does, and what it does not

**Status:** Accepted
**Date:** 2026-09-05
**Phase:** 8 — Enterprise and devices

## Context

The roadmap flags offline sync as **"a genuine research task"**. That is the
right instinct and slightly too pessimistic, because it bundles together one
problem that is solved and one that is not. Separating them is what makes the
phase deliverable.

## Decision

Implement a **hybrid logical clock plus an add-wins observed-remove set of
nodes, each node a record of last-write-wins registers.** Do not implement a
sequence CRDT for text.

## What is solved, and is built

A map is a set of nodes; a node is a record of independent fields. That shape
is exactly what the classic constructions handle:

- **Nodes** — an observed-remove set. A delete leaves a tombstone rather than
  removing the entry, so a late-arriving operation cannot resurrect a node by
  being indistinguishable from "never existed".
- **Fields** — one last-write-wins register each, ordered by hybrid logical
  clock with the device id as a total-order tie-break.
- **Ordering** — an HLC, because wall clocks are wrong and Lamport clocks are
  meaningless to a human. The hybrid keeps physical time close enough to be
  readable while guaranteeing that a received message always yields a
  timestamp strictly greater than the one it carried.

Both are decades old and provably convergent, and both fit in one file each.
`sync.test.ts` applies every permutation of a set of operations and asserts the
resulting states are byte-identical — which is the only assertion that actually
tests the claim.

**Last-write-wins is defensible for these fields specifically.** A title, a
type, a parent, a weight: these are values a person _sets_, not values they
accumulate. There is no sensible merge of two different titles. LWW gives a
deterministic answer and the loser is recorded rather than discarded.

## What is not solved, and is excluded

**Concurrent editing inside one text field.** Two people typing into the same
description on two offline devices cannot be merged word by word by anything
here — the later write wins the field.

Doing it properly needs a sequence CRDT (RGA, or Yjs/Automerge as a
dependency), which brings a data migration, a wire format, and a per-character
metadata cost. That is a project.

**The mitigation, which matters.** The losing write is kept in
`MapState.conflicts` and surfaced, rather than silently dropped. Nobody's
paragraph disappears without their being told — they see "your version was
replaced" with the text they wrote. That is worse than merging and much better
than the usual last-write-wins outcome, which is discovering next week that
work is gone.

Claiming to merge text and actually doing LWW would be the dishonest option,
and it is the one this ADR exists to rule out.

## Known limitation: permission granularity

Sync enforces `editNodes` **per map**, once per pushed batch. Per-node grants
from `lib/permissions/resolve.ts` are not consulted, so somebody denied one
node of a map they can otherwise edit can push an operation touching it.

This is a design problem rather than a missing check: enforcing it properly
means shipping the grant set to the device so it can be evaluated offline, and
a device holding the grant set can also read it. The options are to evaluate
server-side on push (rejecting operations after the fact, which the device
cannot predict) or to scope a device's sync to the nodes it may see (a
different sync unit). Neither is free.

**Until then:** per-node denial is enforced on every online path — the editor,
the API, agents, comments — and is not enforced for offline sync. An
organisation relying on per-node denial as a security boundary should know
that before enabling offline editing.

## Consequences

- A device offline for a month replays an operation log rather than
  downloading a snapshot, which is bounded by `MAX_BATCH` per request.
- `sync_ops` grows without bound and has no compaction. At current scale that
  is fine; the fix when it is not is a periodic snapshot operation, not
  deleting history.
- Tombstones are never collected. Collecting them safely requires knowing
  every device has seen them, which requires tracking every device forever —
  a trade to make deliberately, later, with data.

## Related

- `src/lib/sync/hlc.ts` — the clock
- `src/lib/sync/crdt.ts` — the merge, with the boundary argued at the top
- `src/lib/sync/repo.ts` — the server: two counters, two jobs
- ADR-0002 — position stability, which is why `slot` is not a synced field
