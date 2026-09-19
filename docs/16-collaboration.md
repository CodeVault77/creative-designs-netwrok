# 16 — Collaboration (P11)

Chat, presence, activity, notifications and soft locks (§15).

§20's criterion is four words long and both halves of it are load-bearing:
**"two accounts co-edit and chat without data loss or lockout."** Almost every
design decision below comes from taking one of those two words seriously.

---

## The one idea

**The socket is a notification. The database is the truth.**

Everything durable is a row in `map_events` with a monotonic id. The realtime
channel carries a nudge — "something happened" — and the client goes and reads
the log. Nothing of value only ever exists in flight.

```
write ──► map_events row (id: 412)  ──► publish(mapId, 412)
                                          │
                          ┌───────────────┴───────────────┐
                     tab A: read from 411            tab B: offline
                                                          │
                                          reconnects with Last-Event-ID: 388
                                          ──► replayed 389…412
```

A design that pushes down a channel and stores nothing loses whatever was in
flight when the connection dropped, and the first anyone knows is a message
that never arrived. That is unfalsifiable in testing and infuriating in
production, so the log came first and the socket second.

| Module                        | What it owns                                                   |
| ----------------------------- | -------------------------------------------------------------- |
| `lib/collab/repo.ts`          | Roles, events, chat, presence, locks, activity, notifications. |
| `lib/collab/bus.ts`           | The in-process notification bus.                               |
| `lib/collab/useMapChannel.ts` | The client: stream, reconnect, heartbeat.                      |
| `api/maps/[mapId]/stream`     | SSE, with replay from `Last-Event-ID`.                         |

---

## No data loss

`EventSource` reconnects on its own and **resends the last id it saw** as the
`Last-Event-ID` header. The stream route reads it and replays the log from that
point before subscribing to anything new. So a client offline for a minute gets
that minute, in order, exactly once.

Two details that are easy to get wrong:

- **Publish after the commit, never before.** A nudge that arrives before the
  row exists sends every listener to read something that is not there, and the
  change looks lost.
- **The flush is guarded against re-entry.** A burst of writes fires the
  listener several times; without the guard each one starts its own read and
  they interleave, delivering events out of order.

Replay is **capped at 200** events per read and reports `truncated`. A client
back after a week must not be handed ten thousand rows in one response — it
would stall the tab it is trying to restore — so past the cap the caller
reloads from scratch instead. Silently dropping the excess would be data loss
wearing a different hat.

The harness proves this the only way worth proving it: it opens two real
browsers, **cuts Bob's stream while Alice keeps talking**, then reconnects from
his last cursor and asserts the missed events arrive, in order, with no
duplicates and nothing before the cursor.

---

## No lockout

§15 asks for a soft lock: "a node being edited by someone else shows their
avatar and a subtle pulse, and your edit is refused with 'Sam is editing
this.'"

**A lock is a lease, not a flag.** `expires_at` is the entire design. The thing
that takes a lock and never gives it back is not a bug in the release path — it
is a laptop lid closing, and no code will apologise for it. Without a TTL, one
closed lid makes a node permanently uneditable and there is no recovery short
of a database edit.

- **30-second lease**, renewed every 12 seconds while the node stays selected.
  Half the TTL, so one dropped request does not hand the node away mid-edit.
- **Acquire and renew are the same call.** Separating them makes the client
  track whether it already holds the lock, and get it wrong exactly when the
  answer matters — after a reconnect.
- **Released on deselect**, so the next person is not made to wait out a lease
  nobody is using. Sent with `keepalive`, because it fires as the page unloads
  and an ordinary fetch is cancelled on navigation.
- **Expired locks are collected when they are in the way**, not by a sweeper.
  There is no background job here, and a stale lock nobody asks about does no
  harm.
- **A refusal returns 200 with `ok: false`**, not 409. It is a normal outcome
  the UI renders as "Alice is editing this" — §15's exact words — and it needs
  the holder's _name_. An error status pushes it through the client's failure
  path, where that name has nowhere to go.

The harness closes Bob's entire browser context while he holds a lock, then
waits out the lease and asserts Alice can take it.

---

## Realtime cost

§20's other risk. Answered by three things and no cleverness:

- **No polling.** One `EventEmitter` listener per open connection; a write wakes
  exactly the connections watching that map.
- **One channel per map, shared by three features.** Chat, presence and locks
  all hang off a single `useMapChannel`. Three features each opening their own
  stream is precisely the cost being warned about.
- **Hidden tabs do not heartbeat.** A backgrounded tab that keeps beating is a
  bill for nothing, and it leaves a ghost in everyone else's avatar stack.
  Presence is a heartbeat with a **45-second TTL** rather than a count of open
  sockets — counting connections means a crashed tab stays present until some
  timeout you have to invent anyway, so the timeout _is_ the design.

Client backoff is exponential to 30 seconds. `EventSource` retries on its own at
a fixed interval, which is right for a blip and wrong for a server that is
actually gone.

**Scaling, stated plainly because it is what breaks first:** the bus is
in-process. With two instances, a write on A does not wake a listener on B, and
those clients fall back to their reconnect interval — correct, but slow. The fix
is Postgres `LISTEN/NOTIFY` or Redis pub/sub in place of the emitter, and
nothing else changes: the durable log and the catch-up query are already the
contract.

---

## Chat that belongs to a map

§15: "Typing `#` mentions a node and posts a chip that recentres the map when
tapped — **this is what makes it map chat rather than a chat box.**"

- The composer offers the map's nodes as you type `#`, and inserts the **node
  id**. Requiring someone to know an id would make the feature unusable.
- The reference is **resolved server-side**, against the map the sender can
  actually see. Trusting a node id from the client would let a message carry a
  chip pointing into a map the reader has no access to — and tapping it would
  be a probe for which ids exist.
- It is stored **as an id**, so the chip keeps working after a rename. Storing
  the typed text leaves a chip pointing at a title that no longer exists.

Enter sends, Shift+Enter is a newline. The text is **kept on failure** — clearing
it would throw away what someone just wrote because the network blinked.

---

## Roles, activity, notifications

Roles are §15's table transcribed, as a rank comparison rather than a set per
capability, because the roles are strictly ordered: every Admin power is an
Editor power plus more. **One function, `roleOn`, is called by every entry
point**, so "may this person be here" is answered in exactly one place. It
returns null for both "no such map" and "not yours", and every route renders
404 — a 403 confirms the map exists.

**Activity** is append-only and survives its actor being deleted (the row stays;
it loses the name). §14 calls it "cheap to build, disproportionately
trust-building", and that is right: on a shared map the first question is not
what changed but _who_ changed it.

**Notifications fan out at write time**, one row per recipient, never to the
actor. A feed derived by querying every map you belong to gets slower the more
maps you join — the people with the most to read would wait longest. `markRead`
is scoped by user as well as id; without that, knowing an id would let anyone
mark someone else's notification read.

---

## Verifying

```bash
npm run verify:collab    # needs the app running; takes ~60s (it waits out a lease)
```

28 checks across two live browser contexts:

- the real P7 invite flow — invite by email, accept the link. A harness that
  fabricates membership passes while the path people actually take is broken.
- **no data loss**: stream cut mid-conversation, reconnected, replay asserted for
  order, duplicates and cursor correctness
- **no lockout**: contention, the named refusal, renewal, handover, and the lease
  outliving a closed browser
- the screen: connection state, chat panel, `#` mention list, node chip,
  activity log, fan-out (and never notifying you about your own action)
- permissions: a stranger gets 404 on read, post **and** the stream

---

## Known gaps

- **The coloured ring on nodes others have selected is not painted yet.** §15
  asks for it; it needs a renderer change in `MapCanvas`, and the same
  information is currently shown as text in the collaboration bar — which,
  unlike a ring, is readable without seeing the colour. The data
  (`channel.locks`) is already there.
- **Conflict resolution is last-write-wins per save**, guarded by the existing
  optimistic version check, plus the soft lock. §15 says this is "honest, cheap,
  and sufficient below ~5 concurrent editors. CRDTs are month 4+."
- **Notifications are in-app only.** No email or push fan-out.
- **The bus is single-process.** See the scaling note above.
- **Message editing and deletion do not exist**, and neither does report — §15
  puts report in the overflow of every message, which lands with moderation.
