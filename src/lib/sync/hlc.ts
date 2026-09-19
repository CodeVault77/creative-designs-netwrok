/**
 * Hybrid logical clocks — Kulkarni et al., 2014.
 *
 * ── The problem a wall clock cannot solve ───────────────────────────────────
 *
 * Offline sync needs to answer "which of these two edits happened later" for
 * edits made on different devices that never spoke. Two obvious answers both
 * fail:
 *
 *   Wall clock       Device clocks are wrong. A phone with a battery-flat
 *                    clock reads 1970; a laptop with a bad NTP server can be
 *                    minutes ahead. Last-write-wins on a wrong clock means a
 *                    device that is fast wins every conflict forever, and a
 *                    device that is slow can never make an edit stick.
 *
 *   Lamport clock    Correct for causality and useless for a person. It has
 *                    no relation to real time, so "your version from this
 *                    morning" cannot be found, and a merge cannot be explained.
 *
 * A hybrid keeps both. The physical part tracks real time closely enough to be
 * meaningful to a human; the logical counter guarantees that a message
 * received always yields a timestamp strictly greater than the one it carried,
 * even when the local clock is behind. Order is therefore consistent with
 * causality regardless of how wrong any single clock is.
 *
 * ── Deliberately dependency-free and pure ───────────────────────────────────
 *
 * No imports at all, so this runs identically on the server, in the browser
 * and in a service worker. It has to: the whole point is that a device
 * computes the same ordering offline that the server will compute later.
 */

export interface Hlc {
  /** Milliseconds since the epoch, as agreed rather than as observed. */
  millis: number;
  /** Ticks within the same millisecond, or ahead of a lagging local clock. */
  count: number;
  /** Tie-breaker. Two clocks can be exactly equal; two devices cannot. */
  deviceId: string;
}

/**
 * How far ahead of local time a received timestamp may be before it is
 * refused.
 *
 * Without a ceiling, one device with a clock set to 2099 poisons the whole
 * map: every subsequent local edit inherits that timestamp and loses to it
 * forever, and there is no way back short of editing the database. Refusing
 * the message keeps the damage to the device that is broken.
 */
export const MAX_DRIFT_MS = 60_000;

export function create(deviceId: string, millis = Date.now()): Hlc {
  return { millis, count: 0, deviceId };
}

/**
 * Total order over timestamps.
 *
 * Physical time first, then the counter, then the device id. The device id is
 * not a fairness mechanism and does not need to be — it exists so the order is
 * TOTAL, meaning every replica sorts a set of operations identically. Without
 * it two truly simultaneous edits could sort differently on two devices, and
 * the replicas would diverge permanently while both believing they had merged.
 */
export function compare(a: Hlc, b: Hlc): number {
  if (a.millis !== b.millis) return a.millis - b.millis;
  if (a.count !== b.count) return a.count - b.count;
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}

export function isAfter(a: Hlc, b: Hlc): boolean {
  return compare(a, b) > 0;
}

/**
 * The timestamp for a locally originated event.
 *
 * When the wall clock has moved on, it is adopted and the counter resets. When
 * it has not — two edits in the same millisecond, or a clock that has gone
 * BACKWARDS, which happens on NTP correction — the previous physical time is
 * kept and the counter increments. That second branch is what makes the clock
 * monotonic despite the machine's not being.
 */
export function tick(previous: Hlc, now = Date.now()): Hlc {
  if (now > previous.millis) {
    return { millis: now, count: 0, deviceId: previous.deviceId };
  }

  return {
    millis: previous.millis,
    count: previous.count + 1,
    deviceId: previous.deviceId,
  };
}

export class ClockDrift extends Error {
  constructor(readonly aheadBy: number) {
    super(`Refusing a timestamp ${aheadBy}ms ahead of local time`);
    this.name = 'ClockDrift';
  }
}

/**
 * The timestamp after receiving a remote event.
 *
 * The heart of the algorithm: the result is strictly greater than both the
 * local clock and the received one. That is what guarantees a reply always
 * sorts after the thing it replies to, on every device, whatever their clocks
 * say.
 */
export function receive(local: Hlc, remote: Hlc, now = Date.now()): Hlc {
  if (remote.millis - now > MAX_DRIFT_MS) {
    throw new ClockDrift(remote.millis - now);
  }

  const millis = Math.max(local.millis, remote.millis, now);

  // Three cases, and each needs its own counter rule.
  if (millis === local.millis && millis === remote.millis) {
    // Both clocks agree on the millisecond: take the higher counter and add.
    return {
      millis,
      count: Math.max(local.count, remote.count) + 1,
      deviceId: local.deviceId,
    };
  }

  if (millis === local.millis) {
    // Local is ahead of both the remote and the wall clock.
    return { millis, count: local.count + 1, deviceId: local.deviceId };
  }

  if (millis === remote.millis) {
    // The remote is ahead: adopt its time and step past its counter.
    return { millis, count: remote.count + 1, deviceId: local.deviceId };
  }

  // The wall clock is ahead of both — the ordinary case — so the counter is
  // no longer needed to disambiguate anything.
  return { millis, count: 0, deviceId: local.deviceId };
}

/** Sortable string form, for logs and for a stable index key. */
export function encode(clock: Hlc): string {
  return `${clock.millis.toString().padStart(15, '0')}:${clock.count
    .toString()
    .padStart(5, '0')}:${clock.deviceId}`;
}

export function decode(encoded: string): Hlc | null {
  const parts = encoded.split(':');
  if (parts.length < 3) return null;

  const millis = Number(parts[0]);
  const count = Number(parts[1]);
  const deviceId = parts.slice(2).join(':');

  if (!Number.isFinite(millis) || !Number.isFinite(count) || !deviceId) return null;

  return { millis, count, deviceId };
}
