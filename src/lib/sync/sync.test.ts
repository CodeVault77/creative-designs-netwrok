import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser } from '@/lib/db/repo';
import {
  ClockDrift,
  compare,
  create,
  decode,
  encode,
  isAfter,
  receive,
  tick,
  MAX_DRIFT_MS,
  type Hlc,
} from './hlc';
import {
  apply,
  applyAll,
  digest,
  emptyState,
  materialise,
  merge,
  type MapState,
  type Operation,
} from './crdt';
import { materialiseMap, pull, push, MAX_BATCH } from './repo';

/**
 * Offline sync tests.
 *
 * ── The one property everything else serves ─────────────────────────────────
 *
 * **Two replicas that have seen the same operations, in any order, hold the
 * same state.** That is what "conflict-free" means, and it is the only thing
 * that makes offline editing safe rather than a way to lose work quietly.
 *
 * So the important tests below apply the same operations in shuffled orders
 * and compare digests. A sync layer that passes its happy-path tests and fails
 * that one is a sync layer that will silently diverge in production, and
 * nobody will find out until two people are looking at different maps and both
 * believe they are looking at the same one.
 */

// ------------------------------------------------------------- the clock

describe('the hybrid logical clock', () => {
  it('advances with the wall clock', () => {
    const start = create('device-a', 1000);
    expect(tick(start, 2000)).toMatchObject({ millis: 2000, count: 0 });
  });

  it('uses the counter when the wall clock has not moved', () => {
    const start = create('device-a', 1000);
    const next = tick(start, 1000);

    expect(next).toMatchObject({ millis: 1000, count: 1 });
    expect(tick(next, 1000)).toMatchObject({ millis: 1000, count: 2 });
  });

  it('stays monotonic when the clock goes BACKWARDS', () => {
    /*
     * NTP correction moves a clock backwards, and it happens on real machines.
     * A timestamp that went back would let an edit made later sort earlier —
     * so the physical part is held and the counter carries the ordering.
     */
    const start = create('device-a', 5000);
    const next = tick(start, 1000);

    expect(next.millis).toBe(5000);
    expect(isAfter(next, start)).toBe(true);
  });

  it('is strictly greater than anything it receives', () => {
    // The heart of the algorithm: a reply always sorts after the thing it
    // replies to, on every device, whatever their clocks say.
    const local = create('device-a', 1000);
    const remote: Hlc = { millis: 9000, count: 3, deviceId: 'device-b' };

    const after = receive(local, remote, 1000);

    expect(isAfter(after, local)).toBe(true);
    expect(isAfter(after, remote)).toBe(true);
  });

  it('steps past a remote counter in the same millisecond', () => {
    const local: Hlc = { millis: 1000, count: 1, deviceId: 'device-a' };
    const remote: Hlc = { millis: 1000, count: 7, deviceId: 'device-b' };

    expect(receive(local, remote, 1000).count).toBe(8);
  });

  it('refuses a timestamp absurdly far in the future', () => {
    /*
     * One device with a broken clock would otherwise poison the map forever:
     * its timestamp wins every future conflict and no correct clock can ever
     * displace it. Refusing keeps the damage on the device that is wrong.
     */
    const local = create('device-a', 1000);
    const wild: Hlc = { millis: 1000 + MAX_DRIFT_MS + 1, count: 0, deviceId: 'b' };

    expect(() => receive(local, wild, 1000)).toThrow(ClockDrift);
  });

  it('orders totally, breaking ties on the device id', () => {
    /*
     * Without a total order, two truly simultaneous edits could sort
     * differently on two devices — and the replicas would diverge permanently
     * while both believed they had merged.
     */
    const a: Hlc = { millis: 1000, count: 0, deviceId: 'device-a' };
    const b: Hlc = { millis: 1000, count: 0, deviceId: 'device-b' };

    expect(compare(a, b)).toBeLessThan(0);
    expect(compare(b, a)).toBeGreaterThan(0);
    expect(compare(a, a)).toBe(0);
  });

  it('round-trips through its string form', () => {
    const clock: Hlc = { millis: 1717171717171, count: 42, deviceId: 'device-a' };
    expect(decode(encode(clock))).toEqual(clock);
  });

  it('sorts correctly as a string', () => {
    // The encoding is padded so lexical order matches numeric order — which is
    // what makes it usable as an index key.
    const early = encode({ millis: 999, count: 0, deviceId: 'a' });
    const late = encode({ millis: 1000, count: 0, deviceId: 'a' });

    expect(early < late).toBe(true);
  });
});

// --------------------------------------------------------------- the CRDT

function clock(millis: number, count: number, deviceId: string): Hlc {
  return { millis, count, deviceId };
}

function setField(
  nodeId: string,
  field: string,
  value: unknown,
  at: Hlc,
): Operation {
  return { kind: 'set_field', nodeId, field, value, clock: at };
}

/** Every ordering of a small array. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];

  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

describe('convergence', () => {
  const ops: Operation[] = [
    {
      kind: 'create_node',
      nodeId: 'n1',
      field: '',
      value: null,
      clock: clock(100, 0, 'a'),
    },
    setField('n1', 'title', 'From A', clock(200, 0, 'a')),
    setField('n1', 'title', 'From B', clock(200, 0, 'b')),
    setField('n1', 'weight', 0.8, clock(150, 0, 'b')),
  ];

  it('reaches the same state in every possible order', () => {
    /*
     * The definitive test. 24 orderings of four operations, all compared
     * against the first. If this ever fails, two devices can hold different
     * maps while both believing they are synchronised.
     */
    const orders = permutations(ops);
    const expected = digest(applyAll(emptyState(), orders[0]!));

    for (const order of orders) {
      expect(digest(applyAll(emptyState(), order))).toBe(expected);
    }
  });

  it('is idempotent — applying an operation twice changes nothing', () => {
    // Offline clients retry constantly. Without this, every retry would be a
    // second edit.
    const once = applyAll(emptyState(), ops);
    const twice = applyAll(once, ops);

    expect(digest(twice)).toBe(digest(once));
  });

  it('lets the higher device id win a dead tie', () => {
    const state = applyAll(emptyState(), ops);
    const node = materialise(state)[0]!;

    // 'b' > 'a' with identical clocks, and every replica agrees.
    expect(node.title).toBe('From B');
  });

  it('merges two states exactly as replaying would', () => {
    const left = applyAll(emptyState(), ops.slice(0, 2));
    const right = applyAll(emptyState(), ops.slice(2));

    expect(digest(merge(left, right))).toBe(digest(applyAll(emptyState(), ops)));
    // Merge is commutative too, which is what makes it safe to run on either
    // side of a connection.
    expect(digest(merge(right, left))).toBe(digest(merge(left, right)));
  });
});

describe('fields', () => {
  it('keeps the later write', () => {
    let state = emptyState();
    state = apply(state, setField('n1', 'title', 'Old', clock(100, 0, 'a')));
    state = apply(state, setField('n1', 'title', 'New', clock(200, 0, 'a')));

    expect(materialise(state)[0]!.title).toBe('New');
  });

  it('ignores an earlier write that arrives late', () => {
    // The whole point: arrival order must not decide the winner, or the result
    // depends on network latency.
    let state = emptyState();
    state = apply(state, setField('n1', 'title', 'New', clock(200, 0, 'a')));
    state = apply(state, setField('n1', 'title', 'Old', clock(100, 0, 'a')));

    expect(materialise(state)[0]!.title).toBe('New');
  });

  it('treats different fields independently', () => {
    // A record of independent registers, not one blob. Two people editing
    // different fields of the same node must both keep their work.
    let state = emptyState();
    state = apply(state, setField('n1', 'title', 'Title', clock(200, 0, 'a')));
    state = apply(state, setField('n1', 'weight', 0.9, clock(100, 0, 'b')));

    const node = materialise(state)[0]!;
    expect(node.title).toBe('Title');
    expect(node.weight).toBe(0.9);
  });

  it('records the write that lost', () => {
    /*
     * Converging is not the same as nobody losing work. When two people set a
     * title offline, one of those titles is gone from the map — and the person
     * who typed it deserves to be told rather than to find out next week.
     */
    let state = emptyState();
    state = apply(state, setField('n1', 'title', 'Mine', clock(100, 0, 'a')));
    state = apply(state, setField('n1', 'title', 'Theirs', clock(200, 0, 'b')));

    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0]!.value).toBe('Mine');
  });

  it('records a losing write that arrived late, too', () => {
    let state = emptyState();
    state = apply(state, setField('n1', 'title', 'Theirs', clock(200, 0, 'b')));
    state = apply(state, setField('n1', 'title', 'Mine', clock(100, 0, 'a')));

    // From the other device's point of view its work has just vanished, so it
    // is recorded even though it never became the value.
    expect(state.conflicts[0]!.value).toBe('Mine');
  });

  it('does not call an identical rewrite a conflict', () => {
    let state = emptyState();
    state = apply(state, setField('n1', 'title', 'Same', clock(100, 0, 'a')));
    state = apply(state, setField('n1', 'title', 'Same', clock(200, 0, 'b')));

    expect(state.conflicts).toHaveLength(0);
  });

  it('stores null as a value rather than as absence', () => {
    let state = emptyState();
    state = apply(
      state,
      setField('n1', 'href', 'https://example.com', clock(100, 0, 'a')),
    );
    state = apply(state, setField('n1', 'href', null, clock(200, 0, 'a')));

    expect(materialise(state)[0]!.href).toBeNull();
  });
});

describe('deletion', () => {
  const created: Operation = {
    kind: 'create_node',
    nodeId: 'n1',
    field: '',
    value: null,
    clock: clock(100, 0, 'a'),
  };

  const deleted: Operation = {
    kind: 'delete_node',
    nodeId: 'n1',
    field: '',
    value: null,
    clock: clock(200, 0, 'a'),
  };

  it('removes a node from the rendered state', () => {
    const state = applyAll(emptyState(), [created, deleted]);
    expect(materialise(state)).toHaveLength(0);
  });

  it('keeps a tombstone so the node cannot resurrect', () => {
    /*
     * Without the tombstone, "no entry" and "deleted" are indistinguishable —
     * and an operation arriving later from an offline device recreates the
     * node. This is the observed-remove part, and it is the difference between
     * a set that converges and one that resurrects.
     */
    const state = applyAll(emptyState(), [created, deleted]);

    expect(state.nodes.n1).toBeDefined();
    expect(state.nodes.n1!.deletedAt).not.toBeNull();
  });

  it('is not undone by a set_field that arrives afterwards', () => {
    const late = setField('n1', 'title', 'Late edit', clock(150, 0, 'b'));
    const state = applyAll(emptyState(), [created, deleted, late]);

    expect(materialise(state)).toHaveLength(0);
  });

  it('is add-wins: a later create revives the node', () => {
    /*
     * A real decision, not a fallout. Someone deleting offline and someone
     * editing offline both did something intentional; remove-wins throws the
     * edit away silently. Add-wins keeps the work and leaves a node the
     * deleter can delete again — a conversation rather than a loss.
     */
    const revive: Operation = { ...created, clock: clock(300, 0, 'b') };
    const state = applyAll(emptyState(), [created, deleted, revive]);

    expect(materialise(state)).toHaveLength(1);
  });

  it('converges however the delete is ordered', () => {
    const orders = permutations([
      created,
      deleted,
      setField('n1', 'title', 'X', clock(150, 0, 'b')),
    ]);
    const expected = digest(applyAll(emptyState(), orders[0]!));

    for (const order of orders) {
      expect(digest(applyAll(emptyState(), order))).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------- the server

describe('the sync endpoint', () => {
  let db: Database;
  let owner: { userId: string; isStaff: boolean };
  let stranger: { userId: string; isStaff: boolean };

  beforeEach(() => {
    db = createTestDb();

    createUser(
      {
        id: 'u_owner',
        email: 'owner@example.com',
        passwordHash: 'x',
        handle: 'owner',
        displayName: 'Owner',
      },
      db,
    );

    createUser(
      {
        id: 'u_stranger',
        email: 'stranger@example.com',
        passwordHash: 'x',
        handle: 'stranger',
        displayName: 'Stranger',
      },
      db,
    );

    owner = { userId: 'u_owner', isStaff: false };
    stranger = { userId: 'u_stranger', isStaff: false };

    createMap(
      owner,
      {
        id: 'map_1',
        title: 'A map',
        family: 'create',
        visibility: 'private',
        rootId: 'root',
        version: 1,
        updatedAt: new Date().toISOString(),
        dirty: [],
        metaDirty: false,
        nodes: {
          root: {
            id: 'root',
            map_id: 'map_1',
            parent_id: null,
            slot: 0,
            title: 'Root',
            family: 'create',
            type: 'topic',
            status: 'active',
            visibility: 'public',
            weight: 0.5,
          },
        },
      },
      db,
    );
  });

  const op = (millis: number, device: string, value: string): Operation =>
    setField('n1', 'title', value, clock(millis, 0, device));

  it('accepts a batch and assigns sequence numbers', () => {
    const result = push(
      owner,
      { mapId: 'map_1', deviceId: 'dev-a', ops: [op(100, 'dev-a', 'One')] },
      db,
    );

    expect(result.ok).toBe(true);
    expect(result.accepted).toBe(1);
    expect(result.seq).toBe(1);
  });

  it('is idempotent — a re-sent batch writes nothing', () => {
    // Offline clients retry. A device that pushes, loses connectivity before
    // the response and pushes again must not double-apply.
    const batch = [op(100, 'dev-a', 'One'), op(200, 'dev-a', 'Two')];

    push(owner, { mapId: 'map_1', deviceId: 'dev-a', ops: batch }, db);
    const again = push(
      owner,
      { mapId: 'map_1', deviceId: 'dev-a', ops: batch },
      db,
    );

    expect(again.accepted).toBe(0);
    expect(again.seq).toBe(2);
  });

  it('refuses a push from somebody who cannot edit the map', () => {
    const result = push(
      stranger,
      { mapId: 'map_1', deviceId: 'dev-x', ops: [op(100, 'dev-x', 'Injected')] },
      db,
    );

    expect(result.ok).toBe(false);
    expect(materialiseMap(owner, 'map_1', db).nodes.n1).toBeUndefined();
  });

  it('refuses a pull from somebody who cannot see the map', () => {
    push(
      owner,
      { mapId: 'map_1', deviceId: 'dev-a', ops: [op(100, 'dev-a', 'X')] },
      db,
    );

    expect(
      pull(stranger, { mapId: 'map_1', deviceId: 'dev-x', after: 0 }, db).ok,
    ).toBe(false);
  });

  it('drops an operation whose clock names another device', () => {
    /*
     * The device id is the tie-break that makes the order total. One device
     * forging operations attributed to another would break that, and with it
     * the guarantee that every replica sorts identically.
     */
    const result = push(
      owner,
      { mapId: 'map_1', deviceId: 'dev-a', ops: [op(100, 'dev-b', 'Forged')] },
      db,
    );

    expect(result.accepted).toBe(0);
  });

  it('drops an operation from an absurd future', () => {
    const future = Date.now() + MAX_DRIFT_MS + 60_000;

    const result = push(
      owner,
      { mapId: 'map_1', deviceId: 'dev-a', ops: [op(future, 'dev-a', 'Poison')] },
      db,
    );

    expect(result.accepted).toBe(0);
  });

  it('refuses an oversized batch outright', () => {
    const ops = Array.from({ length: MAX_BATCH + 1 }, (_, index) =>
      op(100 + index, 'dev-a', `v${index}`),
    );

    expect(push(owner, { mapId: 'map_1', deviceId: 'dev-a', ops }, db).ok).toBe(
      false,
    );
  });

  it('returns only what a device has not seen', () => {
    push(
      owner,
      {
        mapId: 'map_1',
        deviceId: 'dev-a',
        ops: [op(100, 'dev-a', 'One'), op(200, 'dev-a', 'Two')],
      },
      db,
    );

    const first = pull(owner, { mapId: 'map_1', deviceId: 'dev-b', after: 0 }, db);
    expect(first.ops).toHaveLength(2);

    const second = pull(
      owner,
      { mapId: 'map_1', deviceId: 'dev-b', after: first.seq! },
      db,
    );
    expect(second.ops).toHaveLength(0);
  });

  it('reports when more remain', () => {
    const ops = Array.from({ length: 5 }, (_, index) =>
      op(100 + index, 'dev-a', `v${index}`),
    );

    push(owner, { mapId: 'map_1', deviceId: 'dev-a', ops }, db);

    const page = pull(
      owner,
      { mapId: 'map_1', deviceId: 'dev-b', after: 0, limit: 2 },
      db,
    );

    expect(page.ops).toHaveLength(2);
    expect(page.more).toBe(true);
  });

  it('converges two devices that edited offline', () => {
    /*
     * The end-to-end version of the property this whole subsystem exists for.
     * Two devices push independently, then each pulls; both must end up with
     * the same map.
     */
    push(
      owner,
      { mapId: 'map_1', deviceId: 'dev-a', ops: [op(500, 'dev-a', 'From A')] },
      db,
    );
    push(
      owner,
      { mapId: 'map_1', deviceId: 'dev-b', ops: [op(400, 'dev-b', 'From B')] },
      db,
    );

    const server = materialiseMap(owner, 'map_1', db);

    const asDeviceA: MapState = applyAll(
      emptyState(),
      pull(owner, { mapId: 'map_1', deviceId: 'dev-a', after: 0 }, db).ops!,
    );
    const asDeviceB: MapState = applyAll(
      emptyState(),
      // Deliberately reversed: arrival order must not change the answer.
      [
        ...pull(owner, { mapId: 'map_1', deviceId: 'dev-b', after: 0 }, db).ops!,
      ].reverse(),
    );

    expect(digest(asDeviceA)).toBe(digest(server));
    expect(digest(asDeviceB)).toBe(digest(server));
    // The later clock wins, whichever arrived first.
    expect(materialise(server)[0]!.title).toBe('From A');
  });
});
