import {
  applyCommand,
  canCoalesce,
  coalesce,
  invertCommand,
  type Command,
} from './commands';
import type { MapDraft } from './types';

/**
 * The undo/redo stack.
 *
 * Holds commands, not snapshots. A snapshot stack is simpler but stores the
 * whole map per step, and §17 budgets 300 rendered nodes with maps allowed to
 * grow past that — fifty snapshots of a large map is real memory for something
 * the user rarely uses.
 *
 * More importantly, commands carry intent. A snapshot can tell you the map
 * changed; only a command can tell you the user renamed a node, which is what
 * lets undo re-select the right thing and lets consecutive keystrokes merge.
 *
 * Redo is cleared on any new command. Branching redo histories are a research
 * project, and every mainstream editor makes the same choice.
 */

/** Deep enough that undo feels unlimited; shallow enough to bound memory. */
export const MAX_DEPTH = 100;

export interface StackState {
  draft: MapDraft;
  past: Command[];
  future: Command[];
  /** The node the editor should select, set by the last apply/undo/redo. */
  focusId: string | null;
}

export function createStack(draft: MapDraft): StackState {
  return { draft, past: [], future: [], focusId: null };
}

/**
 * Applies a command and pushes it.
 *
 * Coalescing happens here rather than at the call site, so a component that
 * fires an update per keystroke does not need to know anything about it. That
 * matters: the node editor is a plain controlled form, and pushing the
 * coalescing decision into it would leak the undo model into every input.
 */
export function push(state: StackState, command: Command): StackState {
  const previous = state.past[state.past.length - 1];

  if (previous && canCoalesce(previous, command)) {
    const merged = coalesce(previous, command);
    return {
      draft: applyCommand(state.draft, command),
      past: [...state.past.slice(0, -1), merged],
      future: [],
      focusId: command.focus,
    };
  }

  const past = [...state.past, command];

  return {
    draft: applyCommand(state.draft, command),
    // Any new edit abandons the redo branch.
    past: past.length > MAX_DEPTH ? past.slice(past.length - MAX_DEPTH) : past,
    future: [],
    focusId: command.focus,
  };
}

export function undo(state: StackState): StackState {
  const command = state.past[state.past.length - 1];
  if (!command) return state;

  const inverse = invertCommand(command);

  return {
    draft: applyCommand(state.draft, inverse),
    past: state.past.slice(0, -1),
    future: [...state.future, command],
    // The node the ORIGINAL command touched, so the user sees what reverted.
    focusId: command.undoFocus,
  };
}

export function redo(state: StackState): StackState {
  const command = state.future[state.future.length - 1];
  if (!command) return state;

  return {
    draft: applyCommand(state.draft, command),
    past: [...state.past, command],
    future: state.future.slice(0, -1),
    focusId: command.focus,
  };
}

export function canUndo(state: StackState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: StackState): boolean {
  return state.future.length > 0;
}

/**
 * A human-readable name for the last command, for the undo bar.
 *
 * "Undo" alone makes the user guess what will happen. "Undo delete" does not,
 * and costs nothing.
 */
export function describeLast(state: StackState): string | null {
  const command = state.past[state.past.length - 1];
  if (!command) return null;

  switch (command.kind) {
    case 'add_node':
      return 'add node';
    case 'delete_nodes':
      return command.nodes.length > 1
        ? `delete ${command.nodes.length} nodes`
        : 'delete node';
    case 'restore_nodes':
      return 'restore';
    case 'update_node':
      return command.field === 'title' ? 'rename' : `edit ${String(command.field)}`;
    case 'move_node':
      return 'move';
    case 'update_map':
      return `map ${command.field}`;
    default:
      return 'change';
  }
}

/**
 * Ends the current coalescing run.
 *
 * Called on blur and when the selection changes. Without it, typing in a
 * title, tabbing to another node, and typing there again within the window
 * would merge two different nodes' edits into one command — the exact
 * cross-surface bug §20 warns about.
 */
export function breakCoalescing(state: StackState): StackState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  if (previous.kind !== 'update_node' && previous.kind !== 'update_map')
    return state;

  // Ageing the timestamp out of the window is enough, and avoids a separate
  // "barrier" command that undo would have to skip over.
  return {
    ...state,
    past: [...state.past.slice(0, -1), { ...previous, at: 0 }],
  };
}
