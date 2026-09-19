import type { DraftNode, MapDraft } from './types';

/**
 * The command model.
 *
 * §20 rates "undo across canvas + form" as this phase's High risk, and the
 * risk is real but specific. Four things make it subtle, and each is handled
 * by a decision in this file:
 *
 * 1. **A drag is one command, not sixty.** Canvas gestures fire continuously;
 *    if every pointermove pushed a command, one drag would take sixty undos to
 *    reverse. Commands are pushed on DROP, carrying the position the drag
 *    started from.
 *
 * 2. **Typing is one command, not one per keystroke.** Same problem, opposite
 *    surface. `update_node` commands on the same node and field coalesce
 *    within a time window, so undo reverses "the rename" rather than "the
 *    letter y".
 *
 * 3. **Every command carries `before` AND `after`.** Inversion is then total
 *    and needs no knowledge of the current state. A command that recomputed
 *    its inverse at undo time would be wrong the moment commands interleave
 *    across the two surfaces — which is exactly what happens when someone
 *    drags a node and then renames it.
 *
 * 4. **Every command names the node to focus after apply and after undo.**
 *    Undo that silently changes something off-screen reads as the app losing
 *    work. The user must SEE what was reversed, so the stack tells the editor
 *    what to select.
 */

export type Command =
  | {
      kind: 'add_node';
      node: DraftNode;
      /** Focus goes to the new node; undo returns it to the parent. */
      focus: string;
      undoFocus: string;
    }
  | {
      kind: 'delete_nodes';
      /** The node plus every descendant, so undo restores the whole subtree. */
      nodes: DraftNode[];
      focus: string;
      undoFocus: string;
    }
  | {
      kind: 'restore_nodes';
      /**
       * The inverse of a delete. A first-class kind rather than a cast,
       * because it is genuinely a different operation — it re-adds several
       * nodes at once, which `add_node` cannot express.
       */
      nodes: DraftNode[];
      focus: string;
      undoFocus: string;
    }
  | {
      kind: 'update_node';
      nodeId: string;
      /** Which field, so consecutive edits to the same field can coalesce. */
      field: keyof DraftNode;
      before: unknown;
      after: unknown;
      /** Wall-clock ms, used only for coalescing. */
      at: number;
      focus: string;
      undoFocus: string;
    }
  | {
      kind: 'move_node';
      nodeId: string;
      before: {
        parentId: string | null;
        slot: number;
        freeX?: number;
        freeY?: number;
      };
      after: {
        parentId: string | null;
        slot: number;
        freeX?: number;
        freeY?: number;
      };
      focus: string;
      undoFocus: string;
    }
  | {
      kind: 'update_map';
      field: 'title' | 'family' | 'visibility';
      before: unknown;
      after: unknown;
      at: number;
      focus: string;
      undoFocus: string;
    };

/** Consecutive edits to the same field within this window merge into one. */
export const COALESCE_MS = 900;

// ---------------------------------------------------------------------- apply

export function applyCommand(draft: MapDraft, command: Command): MapDraft {
  switch (command.kind) {
    case 'add_node':
      return {
        ...draft,
        nodes: { ...draft.nodes, [command.node.id]: command.node },
        dirty: addDirty(draft.dirty, command.node.id),
      };

    case 'delete_nodes': {
      const nodes = { ...draft.nodes };
      for (const node of command.nodes) delete nodes[node.id];
      return {
        ...draft,
        nodes,
        dirty: command.nodes.reduce((acc, n) => addDirty(acc, n.id), draft.dirty),
      };
    }

    case 'restore_nodes':
      return applyRestore(draft, command.nodes);

    case 'update_node': {
      const node = draft.nodes[command.nodeId];
      if (!node) return draft;
      return {
        ...draft,
        nodes: {
          ...draft.nodes,
          [command.nodeId]: {
            ...node,
            [command.field]: command.after,
          } as DraftNode,
        },
        dirty: addDirty(draft.dirty, command.nodeId),
      };
    }

    case 'move_node':
      return applyMove(draft, command.nodeId, command.after);

    case 'update_map':
      return {
        ...draft,
        [command.field]: command.after,
        metaDirty: true,
      } as MapDraft;

    default:
      return draft;
  }
}

// --------------------------------------------------------------------- invert

/**
 * The inverse of a command.
 *
 * Total, and computed from the command alone. That is what lets undo stay
 * correct when canvas and form commands interleave — the classic failure mode
 * is an inverse that reads current state and reverses the wrong thing because
 * something else changed in between.
 */
export function invertCommand(command: Command): Command {
  switch (command.kind) {
    case 'add_node':
      return {
        kind: 'delete_nodes',
        nodes: [command.node],
        focus: command.undoFocus,
        undoFocus: command.focus,
      };

    case 'delete_nodes':
      return {
        kind: 'restore_nodes',
        nodes: command.nodes,
        focus: command.undoFocus,
        undoFocus: command.focus,
      };

    case 'restore_nodes':
      return {
        kind: 'delete_nodes',
        nodes: command.nodes,
        focus: command.undoFocus,
        undoFocus: command.focus,
      };

    case 'update_node':
      return {
        ...command,
        before: command.after,
        after: command.before,
        focus: command.undoFocus,
        undoFocus: command.focus,
      };

    case 'move_node':
      return {
        ...command,
        before: command.after,
        after: command.before,
        focus: command.undoFocus,
        undoFocus: command.focus,
      };

    case 'update_map':
      return {
        ...command,
        before: command.after,
        after: command.before,
        focus: command.undoFocus,
        undoFocus: command.focus,
      };

    default:
      return command;
  }
}

// ------------------------------------------------------------------ coalesce

/**
 * Whether a new command should merge into the previous one.
 *
 * Only text-ish field edits coalesce. A drag never merges with another drag:
 * two deliberate repositions are two things the user did, and merging them
 * would make undo skip one.
 */
export function canCoalesce(previous: Command, next: Command): boolean {
  if (previous.kind !== next.kind) return false;

  if (previous.kind === 'update_node' && next.kind === 'update_node') {
    return (
      previous.nodeId === next.nodeId &&
      previous.field === next.field &&
      next.at - previous.at < COALESCE_MS
    );
  }

  if (previous.kind === 'update_map' && next.kind === 'update_map') {
    return previous.field === next.field && next.at - previous.at < COALESCE_MS;
  }

  return false;
}

/** Merges `next` into `previous`, keeping the ORIGINAL before value. */
export function coalesce(previous: Command, next: Command): Command {
  if (
    (previous.kind === 'update_node' && next.kind === 'update_node') ||
    (previous.kind === 'update_map' && next.kind === 'update_map')
  ) {
    return { ...previous, after: next.after, at: next.at } as Command;
  }
  return next;
}

// ------------------------------------------------------------------- helpers

function addDirty(dirty: readonly string[], id: string): string[] {
  return dirty.includes(id) ? [...dirty] : [...dirty, id];
}

function applyMove(
  draft: MapDraft,
  nodeId: string,
  to: { parentId: string | null; slot: number; freeX?: number; freeY?: number },
): MapDraft {
  const node = draft.nodes[nodeId];
  if (!node) return draft;

  const moved: DraftNode = {
    ...node,
    parent_id: to.parentId,
    slot: to.slot,
  };

  // Free position is set or cleared, never left stale — a node dragged freely
  // and then snapped back must actually snap.
  if (to.freeX === undefined) delete moved.freeX;
  else moved.freeX = to.freeX;
  if (to.freeY === undefined) delete moved.freeY;
  else moved.freeY = to.freeY;

  return {
    ...draft,
    nodes: { ...draft.nodes, [nodeId]: moved },
    dirty: addDirty(draft.dirty, nodeId),
  };
}

/** Re-adds a deleted subtree. Used by the `restore_nodes` command. */
export function applyRestore(draft: MapDraft, nodes: DraftNode[]): MapDraft {
  const next = { ...draft.nodes };
  for (const node of nodes) next[node.id] = node;
  return {
    ...draft,
    nodes: next,
    dirty: nodes.reduce((acc, n) => addDirty(acc, n.id), draft.dirty),
  };
}
