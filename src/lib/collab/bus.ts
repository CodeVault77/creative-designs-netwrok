import 'server-only';
import { EventEmitter } from 'node:events';

/**
 * The in-process notification bus.
 *
 * §20 rates this phase's risk as "realtime cost and reconnection", and this
 * module is where the cost half is answered: there is no broker, no polling
 * loop and no per-client timer. One emitter, one listener per open connection,
 * and a write wakes exactly the connections watching that map.
 *
 * What it deliberately is NOT is a message channel. Nothing that matters is
 * carried here — only the id of the event that was just written. A listener
 * that wakes up goes and reads the log. That is what makes a dropped
 * connection survivable: the socket carries a nudge, and the nudge is
 * reconstructible from the database at any time.
 *
 * SCALING NOTE, stated plainly because it is the thing that breaks first:
 * this works because the app runs as ONE process. With two instances, a write
 * on instance A does not wake a listener on instance B, and clients would fall
 * back to their reconnect interval — correct, but slow. The fix is to replace
 * the emitter with Postgres LISTEN/NOTIFY or Redis pub/sub, and nothing else
 * changes: the durable log and the catch-up query are already the contract.
 */

const emitter = new EventEmitter();

/**
 * Each map's listeners are independent, and Node warns at ten listeners on one
 * event by default — which is a sensible default for programming mistakes and
 * a wrong one for connection counts.
 */
emitter.setMaxListeners(0);

export type BusListener = (eventId: number) => void;

/** Wake every connection watching this map. */
export function publish(mapId: string, eventId: number): void {
  emitter.emit(mapId, eventId);
}

/** Returns the unsubscribe function; callers MUST call it on disconnect. */
export function subscribe(mapId: string, listener: BusListener): () => void {
  emitter.on(mapId, listener);
  return () => {
    emitter.off(mapId, listener);
  };
}

/** Open listener count, for the health endpoint and for tests. */
export function listenerCount(mapId: string): number {
  return emitter.listenerCount(mapId);
}
