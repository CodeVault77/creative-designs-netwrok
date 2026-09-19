import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser, type AuthContext } from '@/lib/db/repo';
import { createDraft } from '@/lib/editor/draft';
import {
  CAN,
  LOCK_TTL_SECONDS,
  PRESENCE_TTL_SECONDS,
  acquireLock,
  appendEvent,
  eventsSince,
  extractNodeRef,
  fanOut,
  heartbeat,
  latestEventId,
  listActivity,
  listLocks,
  listMessages,
  listNotifications,
  listPresence,
  lockHolder,
  markRead,
  postMessage,
  recordActivity,
  releaseLock,
  roleOn,
  unreadCount,
} from './repo';

/**
 * §20's criterion for this phase: "two accounts co-edit and chat WITHOUT DATA
 * LOSS OR LOCKOUT."
 *
 * Those two words drive almost every test below.
 *
 *   - No data loss means a reconnecting client can always find out what it
 *     missed. The socket is a notification; the event log is the truth.
 *   - No lockout means a lock is a LEASE. A held lock must expire on its own,
 *     because the thing that takes a lock and never gives it back is a laptop
 *     lid closing, and there is no code path that will apologise for it.
 */

let db: Database;
let alice: AuthContext;
let bob: AuthContext;
let carol: AuthContext;
const MAP = 'm_shared';

function user(id: string, handle: string) {
  return createUser(
    {
      id,
      email: `${handle}@example.com`,
      passwordHash: 'x',
      handle,
      displayName: handle[0]!.toUpperCase() + handle.slice(1),
    },
    db,
  );
}

beforeEach(() => {
  db = createTestDb();
  alice = { userId: user('u_alice', 'alice').id, isStaff: false };
  bob = { userId: user('u_bob', 'bob').id, isStaff: false };
  carol = { userId: user('u_carol', 'carol').id, isStaff: false };

  const draft = createDraft(MAP, 'Shared map', 'create');
  draft.nodes[draft.rootId]!.title = 'Root topic';
  createMap(alice, draft, db);

  // Bob is an editor; Carol is not a member at all.
  db.prepare(
    `INSERT INTO map_members (map_id, user_id, role, added_at)
     VALUES (?, ?, 'editor', datetime('now'))`,
  ).run(MAP, bob.userId);
});

const rootId = () =>
  (
    db.prepare('SELECT root_id FROM maps WHERE id = ?').get(MAP) as {
      root_id: string;
    }
  ).root_id;

// ---------------------------------------------------------------------- roles

describe('roles', () => {
  it('reads the owner, the member and the stranger differently', () => {
    expect(roleOn(alice, MAP, db)).toBe('owner');
    expect(roleOn(bob, MAP, db)).toBe('editor');
    expect(roleOn(carol, MAP, db)).toBeNull();
  });

  it('returns null for a map that does not exist', () => {
    expect(roleOn(alice, 'm_nope', db)).toBeNull();
  });

  it('lets anyone view a public map, read-only', () => {
    db.prepare(`UPDATE maps SET visibility = 'public' WHERE id = ?`).run(MAP);
    expect(roleOn(carol, MAP, db)).toBe('viewer');
    expect(CAN.comment('viewer')).toBe(false);
    expect(CAN.edit('viewer')).toBe(false);
  });

  /** §15's table, transcribed. */
  it('matches §15 exactly', () => {
    expect(CAN.edit('editor')).toBe(true);
    expect(CAN.invite('editor')).toBe(false);
    expect(CAN.invite('admin')).toBe(true);
    expect(CAN.comment('commenter')).toBe(true);
    expect(CAN.edit('commenter')).toBe(false);
    expect(CAN.view('viewer')).toBe(true);
  });
});

// ----------------------------------------------------- no data loss: the log

describe('the event log — no data loss', () => {
  it('hands a reconnecting client everything it missed', () => {
    const start = latestEventId(MAP, db);

    appendEvent(MAP, alice.userId, 'node_changed', { nodeId: 'n1' }, db);
    appendEvent(MAP, bob.userId, 'node_changed', { nodeId: 'n2' }, db);
    appendEvent(MAP, alice.userId, 'node_changed', { nodeId: 'n3' }, db);

    const { events } = eventsSince(bob, MAP, start, db);
    expect(events.map((e) => e.payload.nodeId)).toEqual(['n1', 'n2', 'n3']);
  });

  /**
   * The precise reconnect case: a client saw event 1, dropped, and two more
   * happened while it was away. It must get exactly those two.
   */
  it('resumes from the middle without repeating or skipping', () => {
    const a = appendEvent(MAP, alice.userId, 'message', { n: 1 }, db);
    appendEvent(MAP, alice.userId, 'message', { n: 2 }, db);
    appendEvent(MAP, alice.userId, 'message', { n: 3 }, db);

    const { events } = eventsSince(bob, MAP, a, db);
    expect(events.map((e) => e.payload.n)).toEqual([2, 3]);
  });

  it('gives ids that only ever increase', () => {
    const ids = [1, 2, 3, 4].map(() => appendEvent(MAP, alice.userId, 'x', {}, db));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * A client back after a week must not be handed ten thousand rows in one
   * response — it would stall the tab it is trying to restore. Reporting the
   * truncation is what lets the caller reload from scratch instead of
   * silently missing the excess.
   */
  it('reports truncation rather than quietly dropping events', () => {
    for (let i = 0; i < 250; i++) appendEvent(MAP, alice.userId, 'x', { i }, db);

    const { events, truncated } = eventsSince(bob, MAP, 0, db);
    expect(truncated).toBe(true);
    expect(events).toHaveLength(200);
  });

  it("does not leak another map's events to a stranger", () => {
    appendEvent(MAP, alice.userId, 'message', { secret: true }, db);
    expect(eventsSince(carol, MAP, 0, db).events).toEqual([]);
  });

  it('scopes events to their own map', () => {
    const other = createDraft('m_other', 'Other', 'create');
    createMap(alice, other, db);
    appendEvent('m_other', alice.userId, 'message', {}, db);
    appendEvent(MAP, alice.userId, 'message', {}, db);

    expect(eventsSince(alice, MAP, 0, db).events).toHaveLength(1);
  });

  /** A message must be durable BEFORE anyone is told about it. */
  it('persists a message and its event together', () => {
    const message = postMessage(alice, MAP, 'hello there', null, db);
    expect(message).not.toBeNull();

    const { events } = eventsSince(bob, MAP, 0, db);
    const messageEvent = events.find((e) => e.kind === 'message');
    expect(messageEvent?.payload.messageId).toBe(message!.id);

    // And it is readable from storage, not only from the event.
    expect(listMessages(bob, MAP, 50, db).map((m) => m.body)).toContain(
      'hello there',
    );
  });
});

// -------------------------------------------------------------------- chat

describe('chat', () => {
  it('posts and reads back in order', () => {
    postMessage(alice, MAP, 'first', null, db);
    postMessage(bob, MAP, 'second', null, db);

    expect(listMessages(alice, MAP, 50, db).map((m) => m.body)).toEqual([
      'first',
      'second',
    ]);
  });

  it('carries the author so the bubble can be attributed', () => {
    postMessage(bob, MAP, 'from bob', null, db);
    const message = listMessages(alice, MAP, 50, db)[0]!;
    expect(message.authorName).toBe('Bob');
    expect(message.authorHandle).toBe('bob');
  });

  /** §15: a Viewer may read but not post. */
  it('refuses a viewer on a public map', () => {
    db.prepare(`UPDATE maps SET visibility = 'public' WHERE id = ?`).run(MAP);
    expect(postMessage(carol, MAP, 'let me in', null, db)).toBeNull();
    expect(listMessages(carol, MAP, 50, db)).toEqual([]);
  });

  it('refuses a stranger entirely', () => {
    expect(postMessage(carol, MAP, 'hello', null, db)).toBeNull();
  });

  it('refuses an empty message', () => {
    expect(postMessage(alice, MAP, '   ', null, db)).toBeNull();
  });

  it('truncates rather than storing an unbounded body', () => {
    const message = postMessage(alice, MAP, 'x'.repeat(5000), null, db);
    expect(message!.body.length).toBe(2000);
  });

  it('keeps only the most recent messages under a limit', () => {
    for (let i = 0; i < 10; i++) postMessage(alice, MAP, `m${i}`, null, db);
    const recent = listMessages(alice, MAP, 3, db);
    expect(recent.map((m) => m.body)).toEqual(['m7', 'm8', 'm9']);
  });

  /**
   * §15: "Typing # mentions a node and posts a chip that recentres the map —
   * this is what makes it map chat rather than a chat box."
   */
  describe('node mentions', () => {
    const nodes = {
      n_abc: { id: 'n_abc', title: 'Research plan' },
      n_def: { id: 'n_def', title: 'Budget' },
    };

    it('resolves a mention by id', () => {
      expect(extractNodeRef('look at #n_abc please', nodes)).toBe('n_abc');
    });

    it('resolves a mention by slugified title', () => {
      expect(extractNodeRef('see #research-plan', nodes)).toBe('n_abc');
    });

    it('is null when nothing matches', () => {
      expect(extractNodeRef('see #nothing-here', nodes)).toBeNull();
      expect(extractNodeRef('no mention at all', nodes)).toBeNull();
    });

    /**
     * The reference is stored as an id, so the chip keeps working after the
     * node is renamed. Storing the typed text would leave a chip pointing at
     * a title that no longer exists.
     */
    it('survives the node being renamed', () => {
      const root = rootId();
      postMessage(alice, MAP, `check #${root}`, root, db);

      db.prepare('UPDATE map_nodes SET title = ? WHERE id = ?').run(
        'Renamed',
        root,
      );

      const message = listMessages(alice, MAP, 50, db)[0]!;
      expect(message.nodeRef).toBe(root);
      expect(message.nodeTitle).toBe('Renamed');
    });
  });
});

// ------------------------------------------------------ no lockout: the locks

describe('soft locks — no lockout', () => {
  it('grants a lock and refuses a second holder', () => {
    const first = acquireLock(alice, MAP, 'n1', db);
    expect(first.ok).toBe(true);

    const second = acquireLock(bob, MAP, 'n1', db);
    expect(second.ok).toBe(false);
    // §15: "your edit is refused with 'Sam is editing this.'" — the caller
    // needs the name, not just a refusal.
    expect(second.holder?.name).toBe('Alice');
  });

  it('lets the holder renew their own lock', () => {
    expect(acquireLock(alice, MAP, 'n1', db).ok).toBe(true);
    expect(acquireLock(alice, MAP, 'n1', db).ok).toBe(true);
  });

  it('frees the node on release', () => {
    acquireLock(alice, MAP, 'n1', db);
    releaseLock(alice, MAP, 'n1', db);
    expect(lockHolder(MAP, 'n1', db)).toBeNull();
    expect(acquireLock(bob, MAP, 'n1', db).ok).toBe(true);
  });

  it('does not let someone else release your lock', () => {
    acquireLock(alice, MAP, 'n1', db);
    releaseLock(bob, MAP, 'n1', db);
    expect(lockHolder(MAP, 'n1', db)?.userId).toBe(alice.userId);
  });

  /**
   * THE lockout test.
   *
   * A lock is a lease. If a held lock could outlive the tab that took it, one
   * closed laptop lid would make a node permanently uneditable and there would
   * be no code path to recover it.
   */
  it('EXPIRES, so a vanished editor cannot lock a node forever', () => {
    acquireLock(alice, MAP, 'n1', db);
    expect(acquireLock(bob, MAP, 'n1', db).ok).toBe(false);

    // Alice's browser goes away. Nothing releases the lock.
    db.prepare(
      `UPDATE node_locks SET expires_at = datetime('now', '-1 second')
        WHERE map_id = ? AND node_id = ?`,
    ).run(MAP, 'n1');

    expect(lockHolder(MAP, 'n1', db)).toBeNull();
    expect(acquireLock(bob, MAP, 'n1', db).ok).toBe(true);
  });

  it('keeps the lease short enough to be survivable', () => {
    // A long lease is the same lockout, just slower.
    expect(LOCK_TTL_SECONDS).toBeLessThanOrEqual(60);
  });

  it('locks one node without locking the map', () => {
    acquireLock(alice, MAP, 'n1', db);
    expect(acquireLock(bob, MAP, 'n2', db).ok).toBe(true);
  });

  it('refuses a lock to someone who cannot edit', () => {
    db.prepare(`UPDATE map_members SET role = 'commenter' WHERE user_id = ?`).run(
      bob.userId,
    );
    expect(acquireLock(bob, MAP, 'n1', db).ok).toBe(false);
    expect(acquireLock(carol, MAP, 'n1', db).ok).toBe(false);
  });

  it('lists live locks and omits expired ones', () => {
    acquireLock(alice, MAP, 'n1', db);
    acquireLock(bob, MAP, 'n2', db);
    expect(listLocks(alice, MAP, db)).toHaveLength(2);

    db.prepare(
      `UPDATE node_locks SET expires_at = datetime('now', '-1 second') WHERE node_id = 'n1'`,
    ).run();
    expect(listLocks(alice, MAP, db).map((l) => l.nodeId)).toEqual(['n2']);
  });

  it('does not show a stranger who is editing what', () => {
    acquireLock(alice, MAP, 'n1', db);
    expect(listLocks(carol, MAP, db)).toEqual([]);
  });
});

// ---------------------------------------------------------------- presence

describe('presence', () => {
  it('reports who is here and what they have selected', () => {
    heartbeat(alice, MAP, 'n1', db);
    heartbeat(bob, MAP, 'n2', db);

    const present = listPresence(alice, MAP, db);
    expect(present).toHaveLength(2);
    expect(present.find((p) => p.userId === bob.userId)?.selectedId).toBe('n2');
  });

  it('updates rather than duplicating on every heartbeat', () => {
    heartbeat(alice, MAP, 'n1', db);
    heartbeat(alice, MAP, 'n2', db);
    const present = listPresence(alice, MAP, db);
    expect(present).toHaveLength(1);
    expect(present[0]!.selectedId).toBe('n2');
  });

  /** A crashed tab must drop out on its own; nothing else will remove it. */
  it('drops someone who stops sending heartbeats', () => {
    heartbeat(alice, MAP, null, db);
    heartbeat(bob, MAP, null, db);

    db.prepare(
      `UPDATE map_presence SET last_seen = datetime('now', @old) WHERE user_id = ?`,
    ).run({ old: `-${PRESENCE_TTL_SECONDS + 10} seconds` }, bob.userId);

    expect(listPresence(alice, MAP, db).map((p) => p.userId)).toEqual([
      alice.userId,
    ]);
  });

  it('gives the TTL enough slack to survive one dropped request', () => {
    // Otherwise people flicker out of the avatar stack and back in.
    expect(PRESENCE_TTL_SECONDS).toBeGreaterThanOrEqual(30);
  });

  it('refuses to record a stranger as present', () => {
    heartbeat(carol, MAP, null, db);
    expect(listPresence(alice, MAP, db)).toEqual([]);
  });

  it('does not show presence to a stranger', () => {
    heartbeat(alice, MAP, null, db);
    expect(listPresence(carol, MAP, db)).toEqual([]);
  });
});

// ---------------------------------------------------------------- activity

describe('activity', () => {
  it('records who did what, newest first', () => {
    recordActivity(
      alice,
      MAP,
      'node_added',
      { targetId: 'n1', detail: 'Budget' },
      db,
    );
    recordActivity(
      bob,
      MAP,
      'node_renamed',
      { targetId: 'n1', detail: 'Costs' },
      db,
    );

    const rows = listActivity(alice, MAP, {}, db);
    expect(rows[0]!.action).toBe('node_renamed');
    expect(rows[0]!.actorName).toBe('Bob');
    expect(rows[1]!.actorName).toBe('Alice');
  });

  // §15: "Activity: append-only log with filters by person and action."
  it('filters by person', () => {
    recordActivity(alice, MAP, 'node_added', {}, db);
    recordActivity(bob, MAP, 'node_added', {}, db);

    const rows = listActivity(alice, MAP, { actorId: bob.userId }, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorName).toBe('Bob');
  });

  it('filters by action', () => {
    recordActivity(alice, MAP, 'node_added', {}, db);
    recordActivity(alice, MAP, 'map_shared', {}, db);

    expect(listActivity(alice, MAP, { action: 'map_shared' }, db)).toHaveLength(1);
  });

  it('survives the actor being deleted', () => {
    recordActivity(bob, MAP, 'node_added', {}, db);
    db.prepare('DELETE FROM users WHERE id = ?').run(bob.userId);

    // Append-only means the entry stays; it just loses the name.
    const rows = listActivity(alice, MAP, {}, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorName).toBe('Someone');
  });

  it('is not readable by a stranger', () => {
    recordActivity(alice, MAP, 'node_added', {}, db);
    expect(listActivity(carol, MAP, {}, db)).toEqual([]);
  });
});

// ----------------------------------------------------------- notifications

describe('notifications', () => {
  it('fans out to the other members but not the actor', () => {
    fanOut(alice, MAP, 'message', 'hello', `/maps/${MAP}`, db);

    expect(listNotifications(bob, db)).toHaveLength(1);
    expect(listNotifications(alice, db)).toHaveLength(0);
  });

  it('names the actor', () => {
    fanOut(alice, MAP, 'message', 'hello', `/maps/${MAP}`, db);
    expect(listNotifications(bob, db)[0]!.actorName).toBe('Alice');
  });

  it('does not reach someone who is not on the map', () => {
    fanOut(alice, MAP, 'message', 'hello', `/maps/${MAP}`, db);
    expect(listNotifications(carol, db)).toEqual([]);
  });

  it('counts and clears unread', () => {
    fanOut(alice, MAP, 'message', 'one', '/x', db);
    fanOut(alice, MAP, 'message', 'two', '/x', db);
    expect(unreadCount(bob, db)).toBe(2);

    markRead(bob, 'all', db);
    expect(unreadCount(bob, db)).toBe(0);
    // Marking read does not delete: the row stays in the list.
    expect(listNotifications(bob, db)).toHaveLength(2);
  });

  it('marks one at a time', () => {
    fanOut(alice, MAP, 'message', 'one', '/x', db);
    fanOut(alice, MAP, 'message', 'two', '/x', db);

    const first = listNotifications(bob, db)[0]!;
    markRead(bob, [first.id], db);
    expect(unreadCount(bob, db)).toBe(1);
  });

  /**
   * Scoped by user as well as id. Without it, knowing an id would let anyone
   * mark someone else's notification read — a small thing that reads as the
   * app losing your unread state.
   */
  it("cannot mark another user's notification read", () => {
    fanOut(alice, MAP, 'message', 'one', '/x', db);
    const bobs = listNotifications(bob, db)[0]!;

    markRead(carol, [bobs.id], db);
    expect(unreadCount(bob, db)).toBe(1);
  });

  it('posting a message notifies the other member', () => {
    postMessage(alice, MAP, 'anyone there?', null, db);
    const notifications = listNotifications(bob, db);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.body).toContain('anyone there');
  });
});

// -------------------------------------------------- two accounts, one session

describe('two accounts co-editing', () => {
  /**
   * The acceptance criterion, end to end at the data layer: both people work
   * at once, both see everything, and neither is locked out.
   */
  it('both work at once without loss or lockout', () => {
    // Alice takes a node, Bob takes a different one — no contention.
    expect(acquireLock(alice, MAP, 'n1', db).ok).toBe(true);
    expect(acquireLock(bob, MAP, 'n2', db).ok).toBe(true);

    // They talk.
    postMessage(alice, MAP, 'taking the intro', null, db);
    postMessage(bob, MAP, 'I have the budget', null, db);

    // Both are present.
    heartbeat(alice, MAP, 'n1', db);
    heartbeat(bob, MAP, 'n2', db);
    expect(listPresence(alice, MAP, db)).toHaveLength(2);

    // Bob's tab drops and reconnects from event 0. He sees both messages.
    const { events } = eventsSince(bob, MAP, 0, db);
    expect(events.filter((e) => e.kind === 'message')).toHaveLength(2);
    expect(listMessages(bob, MAP, 50, db).map((m) => m.body)).toEqual([
      'taking the intro',
      'I have the budget',
    ]);

    // Alice tries Bob's node and is told who has it, rather than clobbering.
    const contended = acquireLock(alice, MAP, 'n2', db);
    expect(contended.ok).toBe(false);
    expect(contended.holder?.name).toBe('Bob');

    // Bob finishes; Alice can take it.
    releaseLock(bob, MAP, 'n2', db);
    expect(acquireLock(alice, MAP, 'n2', db).ok).toBe(true);

    // And each was told about the other's message.
    expect(unreadCount(bob, db)).toBe(1);
    expect(unreadCount(alice, db)).toBe(1);
  });
});
