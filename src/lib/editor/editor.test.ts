import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  canCoalesce,
  coalesce,
  invertCommand,
  COALESCE_MS,
  type Command,
} from './commands';
import {
  breakCoalescing,
  canRedo,
  canUndo,
  createStack,
  describeLast,
  push,
  redo,
  undo,
  MAX_DEPTH,
} from './stack';
import {
  addNodeCommand,
  createDraft,
  deleteNodeCommand,
  descendantsOf,
  childrenOf,
  isDirty,
  markSaved,
  moveNodeCommand,
  nextFreeSlot,
  toGraph,
  updateMapCommand,
  updateNodeCommand,
} from './draft';
import { draftFromTemplate, TEMPLATES, templateById } from './templates';
import { MVP_NODE_TYPES, SOON_NODE_TYPES, isMvpType, type MapDraft } from './types';

function seed(): MapDraft {
  return createDraft('m1', 'Test map', 'create');
}

/** Builds a draft with a root and two children, for structural tests. */
function withChildren(): { draft: MapDraft; a: string; b: string } {
  let draft = seed();

  const first = addNodeCommand(draft, draft.rootId, { title: 'A' });
  draft = applyCommand(draft, first);
  const a = first.kind === 'add_node' ? first.node.id : '';

  const second = addNodeCommand(draft, draft.rootId, { title: 'B' });
  draft = applyCommand(draft, second);
  const b = second.kind === 'add_node' ? second.node.id : '';

  return { draft, a, b };
}

// ------------------------------------------------------------------ commands

describe('command inversion', () => {
  it('inverts add into delete and back', () => {
    const draft = seed();
    const add = addNodeCommand(draft, draft.rootId, { title: 'X' });

    const added = applyCommand(draft, add);
    expect(Object.keys(added.nodes)).toHaveLength(2);

    const removed = applyCommand(added, invertCommand(add));
    expect(Object.keys(removed.nodes)).toHaveLength(1);
  });

  it('inverts delete into a restore of the whole subtree', () => {
    const { draft: base, a } = withChildren();
    let draft = base;

    const child = addNodeCommand(draft, a, { title: 'A1' });
    draft = applyCommand(draft, child);

    const del = deleteNodeCommand(draft, a)!;
    const deleted = applyCommand(draft, del);
    expect(Object.keys(deleted.nodes)).toHaveLength(2);

    const restored = applyCommand(deleted, invertCommand(del));
    expect(Object.keys(restored.nodes)).toHaveLength(4);
  });

  it('makes inversion an involution', () => {
    // invert(invert(c)) must behave like c. If it does not, undo/redo drift
    // apart after a few cycles and the stack quietly corrupts the map.
    const draft = seed();
    const command = updateNodeCommand(draft, draft.rootId, 'title', 'New')!;
    const twice = invertCommand(invertCommand(command));

    expect(applyCommand(draft, twice)).toEqual(applyCommand(draft, command));
  });

  it('computes the inverse from the command alone, not from current state', () => {
    // The reason `before` is stored: an inverse derived at undo time would
    // reverse whatever the value happens to be NOW, which is wrong the moment
    // another command has touched the same node in between.
    const draft = seed();
    const rename = updateNodeCommand(draft, draft.rootId, 'title', 'Second')!;

    const changedElsewhere = applyCommand(
      applyCommand(draft, rename),
      updateNodeCommand(draft, draft.rootId, 'description', 'note')!,
    );

    const undone = applyCommand(changedElsewhere, invertCommand(rename));
    expect(undone.nodes[draft.rootId]!.title).toBe('Test map');
    // The unrelated edit survives the undo.
    expect(undone.nodes[draft.rootId]!.description).toBe('note');
  });
});

describe('no-op commands', () => {
  it('returns null when a field is set to its current value', () => {
    // A no-op in the stack is an undo step that appears to do nothing, which
    // makes people press undo again and lose real work.
    const draft = seed();
    expect(updateNodeCommand(draft, draft.rootId, 'title', 'Test map')).toBeNull();
    expect(updateMapCommand(draft, 'title', 'Test map')).toBeNull();
  });

  it('returns null for a move that changes nothing', () => {
    const { draft, a } = withChildren();
    const node = draft.nodes[a]!;
    expect(
      moveNodeCommand(draft, a, { parentId: node.parent_id, slot: node.slot }),
    ).toBeNull();
  });

  it('refuses to delete the root', () => {
    const draft = seed();
    expect(deleteNodeCommand(draft, draft.rootId)).toBeNull();
  });

  it('refuses a move that would make a node its own descendant', () => {
    // Otherwise the subtree detaches from the map and there is no way back to
    // it — the node still exists but nothing renders it.
    const { draft: base, a } = withChildren();
    let draft = base;
    const child = addNodeCommand(draft, a, { title: 'A1' });
    draft = applyCommand(draft, child);
    const childId = child.kind === 'add_node' ? child.node.id : '';

    expect(moveNodeCommand(draft, a, { parentId: childId })).toBeNull();
  });
});

// --------------------------------------------------------------- coalescing

describe('coalescing — the form half of the undo risk', () => {
  const base = (at: number, after: string): Command => ({
    kind: 'update_node',
    nodeId: 'n1',
    field: 'title',
    before: '',
    after,
    at,
    focus: 'n1',
    undoFocus: 'n1',
  });

  it('merges consecutive edits to the same field', () => {
    // Without this, typing "Hello" is five undo steps.
    expect(canCoalesce(base(0, 'H'), base(100, 'He'))).toBe(true);
  });

  it('does not merge across the time window', () => {
    expect(canCoalesce(base(0, 'H'), base(COALESCE_MS + 1, 'He'))).toBe(false);
  });

  it('does not merge different fields', () => {
    // Built explicitly rather than spread: spreading a discriminated union
    // widens it, and the widened type would let a nonsense command compile.
    const description: Command = {
      kind: 'update_node',
      nodeId: 'n1',
      field: 'description',
      before: '',
      after: 'x',
      at: 100,
      focus: 'n1',
      undoFocus: 'n1',
    };
    expect(canCoalesce(base(0, 'H'), description)).toBe(false);
  });

  it('does not merge different nodes', () => {
    // The cross-surface bug: type in one node, tab to another, type again.
    const other: Command = {
      kind: 'update_node',
      nodeId: 'n2',
      field: 'title',
      before: '',
      after: 'x',
      at: 100,
      focus: 'n2',
      undoFocus: 'n2',
    };
    expect(canCoalesce(base(0, 'H'), other)).toBe(false);
  });

  it('never merges moves', () => {
    // Two deliberate repositions are two things the user did.
    const move: Command = {
      kind: 'move_node',
      nodeId: 'n1',
      before: { parentId: 'r', slot: 0 },
      after: { parentId: 'r', slot: 1 },
      focus: 'n1',
      undoFocus: 'n1',
    };
    expect(canCoalesce(move, move)).toBe(false);
  });

  it('keeps the ORIGINAL before value when merging', () => {
    // This is what makes one undo reverse the whole word rather than the last
    // letter.
    const merged = coalesce(base(0, 'H'), base(100, 'Hello'));
    expect(merged.kind).toBe('update_node');
    if (merged.kind === 'update_node') {
      expect(merged.before).toBe('');
      expect(merged.after).toBe('Hello');
    }
  });
});

// -------------------------------------------------------------------- stack

describe('command stack', () => {
  it('undoes a typed run as one step', () => {
    const draft = seed();
    let state = createStack(draft);

    for (const title of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      state = push(
        state,
        updateNodeCommand(state.draft, draft.rootId, 'title', title)!,
      );
    }

    expect(state.past).toHaveLength(1);
    state = undo(state);
    expect(state.draft.nodes[draft.rootId]!.title).toBe('Test map');
  });

  it('keeps canvas and form edits as separate steps', () => {
    // The interleaving case §20 warns about: a drag then a rename must undo
    // in two steps, in the right order.
    const { draft, a } = withChildren();
    let state = createStack(draft);

    state = push(state, moveNodeCommand(draft, a, { slot: 5 })!);
    state = push(state, updateNodeCommand(state.draft, a, 'title', 'Renamed')!);

    expect(state.past).toHaveLength(2);

    state = undo(state);
    expect(state.draft.nodes[a]!.title).toBe('A');
    expect(state.draft.nodes[a]!.slot).toBe(5);

    state = undo(state);
    expect(state.draft.nodes[a]!.slot).toBe(0);
  });

  it('redoes what it undid', () => {
    const draft = seed();
    let state = createStack(draft);
    state = push(
      state,
      updateNodeCommand(draft, draft.rootId, 'title', 'Changed')!,
    );

    state = undo(state);
    expect(state.draft.nodes[draft.rootId]!.title).toBe('Test map');

    state = redo(state);
    expect(state.draft.nodes[draft.rootId]!.title).toBe('Changed');
  });

  it('clears redo when a new command arrives', () => {
    const draft = seed();
    let state = createStack(draft);

    state = push(state, updateNodeCommand(draft, draft.rootId, 'title', 'A')!);
    state = undo(state);
    expect(canRedo(state)).toBe(true);

    state = push(
      state,
      updateNodeCommand(state.draft, draft.rootId, 'description', 'x')!,
    );
    expect(canRedo(state)).toBe(false);
  });

  it('survives a long undo/redo cycle without drifting', () => {
    const { draft, a } = withChildren();
    let state = createStack(draft);

    state = push(state, updateNodeCommand(draft, a, 'title', 'One')!);
    state = push(state, moveNodeCommand(state.draft, a, { slot: 3 })!);
    state = push(state, updateNodeCommand(state.draft, a, 'type', 'note')!);

    const after = state.draft;

    for (let i = 0; i < 3; i++) state = undo(state);
    for (let i = 0; i < 3; i++) state = redo(state);

    expect(state.draft.nodes[a]).toEqual(after.nodes[a]);
  });

  it('bounds its depth', () => {
    const draft = seed();
    let state = createStack(draft);

    for (let i = 0; i < MAX_DEPTH + 30; i++) {
      state = push(state, {
        kind: 'update_node',
        nodeId: draft.rootId,
        field: 'title',
        before: String(i),
        after: String(i + 1),
        // Spaced beyond the window so they do not coalesce into one.
        at: i * (COALESCE_MS + 10),
        focus: draft.rootId,
        undoFocus: draft.rootId,
      });
    }

    expect(state.past.length).toBeLessThanOrEqual(MAX_DEPTH);
  });

  it('does nothing when there is nothing to undo', () => {
    const state = createStack(seed());
    expect(canUndo(state)).toBe(false);
    expect(undo(state)).toBe(state);
    expect(redo(state)).toBe(state);
  });

  it('names the last action for the undo bar', () => {
    const { draft, a } = withChildren();
    let state = createStack(draft);

    state = push(state, deleteNodeCommand(draft, a)!);
    expect(describeLast(state)).toBe('delete node');

    state = push(
      state,
      updateNodeCommand(state.draft, draft.rootId, 'title', 'X')!,
    );
    expect(describeLast(state)).toBe('rename');
  });
});

describe('focus follows the stack', () => {
  it('selects the new node after add, and the parent after undo', () => {
    // Undo that changes something off-screen reads as the app losing work.
    const draft = seed();
    let state = createStack(draft);

    const add = addNodeCommand(draft, draft.rootId);
    state = push(state, add);
    expect(state.focusId).toBe(add.kind === 'add_node' ? add.node.id : '');

    state = undo(state);
    expect(state.focusId).toBe(draft.rootId);
  });

  it('selects the deleted node again when a delete is undone', () => {
    const { draft, a } = withChildren();
    let state = createStack(draft);

    state = push(state, deleteNodeCommand(draft, a)!);
    expect(state.focusId).toBe(draft.rootId);

    state = undo(state);
    expect(state.focusId).toBe(a);
  });
});

describe('breakCoalescing', () => {
  it('stops a later edit merging with an earlier one', () => {
    // Called on blur and on selection change.
    const draft = seed();
    let state = createStack(draft);

    state = push(state, updateNodeCommand(draft, draft.rootId, 'title', 'A')!);
    state = breakCoalescing(state);
    state = push(
      state,
      updateNodeCommand(state.draft, draft.rootId, 'title', 'AB')!,
    );

    expect(state.past).toHaveLength(2);
  });

  it('is a no-op on an empty stack', () => {
    const state = createStack(seed());
    expect(breakCoalescing(state)).toBe(state);
  });
});

// -------------------------------------------------------------------- draft

describe('draft operations', () => {
  it('gives a new node the next free slot', () => {
    const { draft } = withChildren();
    expect(nextFreeSlot(draft, draft.rootId)).toBe(2);
  });

  it('reuses a slot freed by a deletion', () => {
    // Otherwise an edited map ends up with slots 0, 3, 7 and a lopsided ring.
    const { draft: base, a } = withChildren();
    let draft = base;
    draft = applyCommand(draft, deleteNodeCommand(draft, a)!);
    expect(nextFreeSlot(draft, draft.rootId)).toBe(0);
  });

  it('inherits the parent family so a branch reads as one branch', () => {
    let draft = seed();
    const parent = addNodeCommand(draft, draft.rootId, { family: 'commerce' });
    draft = applyCommand(draft, parent);
    const parentId = parent.kind === 'add_node' ? parent.node.id : '';

    const child = addNodeCommand(draft, parentId);
    expect(child.kind === 'add_node' && child.node.family).toBe('commerce');
  });

  it('collects every descendant for a delete', () => {
    let draft = seed();
    const a = addNodeCommand(draft, draft.rootId);
    draft = applyCommand(draft, a);
    const aId = a.kind === 'add_node' ? a.node.id : '';

    const b = addNodeCommand(draft, aId);
    draft = applyCommand(draft, b);
    const bId = b.kind === 'add_node' ? b.node.id : '';

    const c = addNodeCommand(draft, bId);
    draft = applyCommand(draft, c);

    expect(descendantsOf(draft, aId)).toHaveLength(2);
  });

  it('sorts children by slot', () => {
    const { draft, a, b } = withChildren();
    const kids = childrenOf(draft, draft.rootId).map((n) => n.id);
    expect(kids).toEqual([a, b]);
  });

  it('renders through the same graph shape the map canvas uses', () => {
    const { draft } = withChildren();
    const graph = toGraph(draft);
    expect(graph.rootId).toBe(draft.rootId);
    expect(graph.childrenOf.get(draft.rootId)).toHaveLength(2);
  });

  it('tracks dirtiness and clears it on save', () => {
    let draft = seed();
    expect(isDirty(draft)).toBe(false);

    draft = applyCommand(draft, addNodeCommand(draft, draft.rootId));
    expect(isDirty(draft)).toBe(true);

    draft = markSaved(draft, 3, '2026-01-01T00:00:00.000Z');
    expect(isDirty(draft)).toBe(false);
    expect(draft.version).toBe(3);
  });

  it('gives every node a unique id', () => {
    let draft = seed();
    for (let i = 0; i < 50; i++) {
      draft = applyCommand(draft, addNodeCommand(draft, draft.rootId));
    }
    expect(new Set(Object.keys(draft.nodes)).size).toBe(51);
  });

  it('clears a free position when a node is snapped back', () => {
    const { draft, a } = withChildren();
    const freed = applyCommand(
      draft,
      moveNodeCommand(draft, a, { freeX: 10, freeY: 20 })!,
    );
    expect(freed.nodes[a]!.freeX).toBe(10);

    const snapped = applyCommand(freed, moveNodeCommand(freed, a, { slot: 4 })!);
    expect(snapped.nodes[a]!.freeX).toBeUndefined();
  });
});

// ----------------------------------------------------------------- templates

describe('templates', () => {
  it('offers blank plus the five from §14', () => {
    expect(TEMPLATES).toHaveLength(6);
    for (const id of [
      'blank',
      'project',
      'research',
      'business',
      'learning',
      'personal',
    ]) {
      expect(templateById(id), id).toBeTruthy();
    }
  });

  it('creates only a root for blank', () => {
    expect(Object.keys(draftFromTemplate('m', 'X', 'blank').nodes)).toHaveLength(1);
  });

  it('creates a root plus branches for a template', () => {
    const draft = draftFromTemplate('m', 'X', 'project');
    expect(Object.keys(draft.nodes)).toHaveLength(6);
    expect(childrenOf(draft, draft.rootId).map((n) => n.title)).toEqual([
      'Goals',
      'Tasks',
      'People',
      'Timeline',
      'Risks',
    ]);
  });

  it('gives template branches contiguous slots', () => {
    const draft = draftFromTemplate('m', 'X', 'research');
    expect(childrenOf(draft, draft.rootId).map((n) => n.slot)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it('falls back to blank for an unknown template', () => {
    expect(Object.keys(draftFromTemplate('m', 'X', 'nope').nodes)).toHaveLength(1);
  });

  it('marks every template node dirty so the first save persists them', () => {
    const draft = draftFromTemplate('m', 'X', 'business');
    expect(draft.dirty.length).toBe(Object.keys(draft.nodes).length);
  });
});

describe('node types', () => {
  it('ships the five MVP types first and badges the rest', () => {
    /*
     * The list is a PREFIX check, not an equality one. Phase 7 registered the
     * commerce, CRM and project-management packages through the same public
     * `defineNodeType` any extension uses, so the creatable set legitimately
     * grows. What must not change is that the five original types are there
     * and come first — the picker's opening row is what a new user sees.
     */
    expect(MVP_NODE_TYPES.slice(0, 5)).toEqual([
      'topic',
      'link',
      'note',
      'image',
      'date',
    ]);
    expect(SOON_NODE_TYPES.length).toBeGreaterThan(0);
  });

  it('never overlaps MVP and Soon types', () => {
    for (const type of SOON_NODE_TYPES) {
      expect(isMvpType(type), type).toBe(false);
    }
  });
});
