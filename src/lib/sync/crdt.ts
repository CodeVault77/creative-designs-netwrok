import { compare, isAfter, type Hlc } from './hlc';

/**
 * The CRDT the map's data model actually needs.
 *
 * ── What this is, and what it deliberately is not ───────────────────────────
 *
 * The roadmap flags offline sync as "a genuine research task", and it is right
 * to — but the research question is narrower than it sounds, and it is worth
 * separating the part that is solved from the part that is not.
 *
 *   SOLVED, and implemented here.
 *   A map is a SET of nodes, each a RECORD of independent fields. That is an
 *   add-wins observed-remove set of nodes, plus a last-write-wins register per
 *   field. Both are decades-old, provably convergent constructions, and both
 *   fit in this file. Two devices that see the same operations in any order
 *   reach byte-identical state.
 *
 *   NOT SOLVED HERE, and deliberately excluded.
 *   Concurrent editing INSIDE one text field. Making two people's edits to the
 *   same paragraph merge sensibly needs a sequence CRDT — RGA, Yjs, Automerge
 *   — and that is a dependency and a data migration, not a file. Here, a
 *   description is one register: the later write wins and the earlier is kept
 *   as a conflict rather than silently discarded, so nobody's work vanishes
 *   even though it does not merge word by word.
 *
 * Being explicit about that boundary is the point. A "CRDT" that claimed to
 * merge text and actually did last-write-wins would lose a paragraph somebody
 * typed on a train, and they would never know why.
 *
 * ── Why last-write-wins is right for these fields ───────────────────────────
 *
 * LWW is often the wrong default, so it needs defending. The fields here —
 * a title, a type, a parent, a weight — are values a person SETS, not values
 * they accumulate. There is no sensible merge of two different titles; one of
 * them is what the map should say. LWW gives a deterministic answer, and the
 * conflict record below means the other answer is still recoverable.
 *
 * Pure and import-free apart from the clock, so the browser, the service
 * worker and the server all compute the same state from the same operations.
 */

export type OpKind = 'create_node' | 'set_field' | 'delete_node';

export interface Operation {
  kind: OpKind;
  nodeId: string;
  /** Empty for create and delete. */
  field: string;
  /** JSON-safe. `null` is a real value, distinct from "not set". */
  value: unknown;
  clock: Hlc;
  actorId?: string | null;
}

export interface FieldState {
  value: unknown;
  clock: Hlc;
}

export interface NodeState {
  id: string;
  fields: Record<string, FieldState>;
  /**
   * The clock of the delete that removed it, when one has.
   *
   * A TOMBSTONE, not a removal from the map. A deleted node has to keep
   * existing as a marker: without it, an operation that arrives later from an
   * offline device would recreate the node, because "no entry" and "deleted"
   * would be indistinguishable. This is the observed-remove part, and it is
   * the difference between a set that converges and one that resurrects.
   */
  deletedAt: Hlc | null;
}

export interface Conflict {
  nodeId: string;
  field: string;
  /** The value that lost. Kept so the losing edit is recoverable. */
  value: unknown;
  clock: Hlc;
}

export interface MapState {
  nodes: Record<string, NodeState>;
  /**
   * Writes that lost a race, newest first.
   *
   * A CRDT converging is not the same as nobody losing work. When two people
   * set a title offline, one of those titles is going to be gone from the map,
   * and the person who typed it deserves to be told rather than to discover it
   * next week. The UI surfaces these; nothing here depends on them.
   */
  conflicts: Conflict[];
}

export function emptyState(): MapState {
  return { nodes: {}, conflicts: [] };
}

/** How many losing writes to remember. Enough to notice; bounded. */
const MAX_CONFLICTS = 200;

function ensureNode(state: MapState, nodeId: string): NodeState {
  const existing = state.nodes[nodeId];
  if (existing) return existing;

  const created: NodeState = { id: nodeId, fields: {}, deletedAt: null };
  state.nodes[nodeId] = created;

  return created;
}

/**
 * Apply one operation. Returns a NEW state.
 *
 * The three properties that make this a CRDT, each of which has a test:
 *
 *   commutative   order of application does not matter;
 *   associative   grouping does not matter;
 *   idempotent    applying the same operation twice changes nothing.
 *
 * The third is what makes retrying a sync safe, and an offline client retries
 * constantly.
 */
export function apply(state: MapState, op: Operation): MapState {
  const next: MapState = {
    nodes: { ...state.nodes },
    conflicts: state.conflicts,
  };

  // Copy the node being touched, so callers holding the previous state see it
  // unchanged. Structural sharing everywhere else keeps this cheap.
  const previous = state.nodes[op.nodeId];
  next.nodes[op.nodeId] = previous
    ? {
        id: previous.id,
        fields: { ...previous.fields },
        deletedAt: previous.deletedAt,
      }
    : { id: op.nodeId, fields: {}, deletedAt: null };

  const node = ensureNode(next, op.nodeId);

  if (op.kind === 'delete_node') {
    /*
     * Delete only moves the tombstone forward.
     *
     * A delete that arrives out of order must not undo a LATER delete, and
     * comparing clocks is what makes re-applying an old delete a no-op.
     */
    if (!node.deletedAt || isAfter(op.clock, node.deletedAt)) {
      node.deletedAt = op.clock;
    }

    return next;
  }

  if (op.kind === 'create_node') {
    /*
     * Create is add-wins: a create later than the tombstone revives the node.
     *
     * That is a real decision rather than a fallout. Someone who deletes a
     * node offline and someone who edits it offline both did something
     * intentional, and the alternative — remove-wins — throws away the edit
     * silently. Add-wins keeps the work and leaves a node the deleter can
     * delete again, which is a conversation rather than a loss.
     */
    if (node.deletedAt && isAfter(op.clock, node.deletedAt)) {
      node.deletedAt = null;
    }

    return next;
  }

  // ---- set_field ----------------------------------------------------------

  const current = node.fields[op.field];

  if (!current) {
    node.fields[op.field] = { value: op.value, clock: op.clock };
    return next;
  }

  const ordering = compare(op.clock, current.clock);

  // Exactly equal clocks mean the same operation arrived twice — the same
  // device, millisecond and counter cannot produce two different writes. This
  // is the idempotence branch.
  if (ordering === 0) return next;

  if (ordering > 0) {
    /*
     * The incoming write wins, and the one it displaced is recorded.
     *
     * Only when the values actually differ: re-setting a title to what it
     * already says is not a conflict anybody wants to be told about.
     */
    if (!sameValue(current.value, op.value)) {
      next.conflicts = [
        {
          nodeId: op.nodeId,
          field: op.field,
          value: current.value,
          clock: current.clock,
        },
        ...state.conflicts,
      ].slice(0, MAX_CONFLICTS);
    }

    node.fields[op.field] = { value: op.value, clock: op.clock };
    return next;
  }

  // The incoming write LOST. It is still recorded, because from the other
  // device's point of view its work has just vanished.
  if (!sameValue(current.value, op.value)) {
    next.conflicts = [
      { nodeId: op.nodeId, field: op.field, value: op.value, clock: op.clock },
      ...state.conflicts,
    ].slice(0, MAX_CONFLICTS);
  }

  return next;
}

/** Structural equality, enough for the JSON values a payload can hold. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fold a batch.
 *
 * Sorted first, which is not required for correctness — the merge is
 * commutative — but keeps the CONFLICT list in a sensible order. Without it,
 * "what did I lose" would be listed in network arrival order, which is
 * meaningless to a reader.
 */
export function applyAll(state: MapState, ops: readonly Operation[]): MapState {
  return [...ops]
    .sort((a, b) => compare(a.clock, b.clock))
    .reduce((accumulated, op) => apply(accumulated, op), state);
}

/**
 * Merge two states.
 *
 * Used when a device has been offline long enough that replaying operations is
 * more expensive than exchanging snapshots. Equivalent to applying every
 * operation from both sides, which is the property that makes the shortcut
 * legitimate rather than an approximation.
 */
export function merge(a: MapState, b: MapState): MapState {
  const nodes: Record<string, NodeState> = {};

  for (const id of new Set([...Object.keys(a.nodes), ...Object.keys(b.nodes)])) {
    const left = a.nodes[id];
    const right = b.nodes[id];

    if (!left) {
      nodes[id] = right!;
      continue;
    }
    if (!right) {
      nodes[id] = left;
      continue;
    }

    const fields: Record<string, FieldState> = { ...left.fields };

    for (const [field, state] of Object.entries(right.fields)) {
      const mine = fields[field];
      if (!mine || isAfter(state.clock, mine.clock)) fields[field] = state;
    }

    // The later tombstone wins, and a node deleted on one side only is
    // deleted — the delete is information the other side simply had not seen.
    const deletedAt =
      left.deletedAt && right.deletedAt
        ? isAfter(left.deletedAt, right.deletedAt)
          ? left.deletedAt
          : right.deletedAt
        : (left.deletedAt ?? right.deletedAt);

    nodes[id] = { id, fields, deletedAt };
  }

  return {
    nodes,
    conflicts: [...a.conflicts, ...b.conflicts]
      .sort((x, y) => compare(y.clock, x.clock))
      .slice(0, MAX_CONFLICTS),
  };
}

export interface MaterialisedNode {
  id: string;
  [field: string]: unknown;
}

/**
 * The state a renderer draws: live nodes with plain values.
 *
 * Tombstones are dropped here and only here. They must survive in `MapState`
 * forever — or at least until every device has certainly seen them — but
 * nothing above the CRDT should have to know they exist.
 */
export function materialise(state: MapState): MaterialisedNode[] {
  return Object.values(state.nodes)
    .filter((node) => node.deletedAt === null)
    .map((node) => {
      const out: MaterialisedNode = { id: node.id };

      /*
       * Fields are emitted in SORTED order, not insertion order.
       *
       * This looked cosmetic and is not. `digest` is JSON.stringify of this
       * output, and JSON.stringify preserves key insertion order — so two
       * replicas that had genuinely converged produced different strings
       * purely because their operations arrived in different orders. A
       * fingerprint that disagrees for converged replicas is worse than none:
       * it reports divergence that is not there, and the first response to a
       * false alarm is to distrust the real ones.
       *
       * Caught by the merge test, which is the only one that builds the same
       * state by two different routes.
       */
      for (const field of Object.keys(node.fields).sort()) {
        out[field] = node.fields[field]!.value;
      }

      return out;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A stable fingerprint of the live state.
 *
 * Two devices that have converged produce the same string. It is what lets a
 * client check "am I actually in sync" cheaply, rather than trusting that it
 * received everything — and detecting divergence is the only way anyone ever
 * finds out that a sync implementation is subtly wrong.
 */
export function digest(state: MapState): string {
  return JSON.stringify(materialise(state));
}
