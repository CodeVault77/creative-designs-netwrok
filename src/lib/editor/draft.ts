import { indexChildren } from '@/lib/map/geometry';
import type { MapGraph, MapNode } from '@/lib/map/types';
import type { Command } from './commands';
import type { DraftNode, MapDraft } from './types';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * Draft helpers: building commands, and turning a draft into a renderable
 * graph.
 *
 * The editor renders through the SAME MapCanvas as the Community Map. §14 is
 * explicit that "the editor must feel like the same world" — a second renderer
 * would drift within a sprint, and every performance decision from P3 would
 * have to be made twice.
 */

let counter = 0;

export function newNodeId(): string {
  // Client-generated so a node exists the instant it is created, with no
  // round trip. The server accepts the id rather than assigning one; a
  // server-assigned id would mean the node has no identity until the save
  // returns, and every command referencing it would need rewriting.
  counter += 1;
  return `n_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function toGraph(draft: MapDraft): MapGraph {
  const nodes = Object.values(draft.nodes) as MapNode[];
  return {
    id: draft.id,
    title: draft.title,
    rootId: draft.rootId,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    childrenOf: indexChildren(nodes),
  };
}

export function childrenOf(draft: MapDraft, parentId: string): DraftNode[] {
  return Object.values(draft.nodes)
    .filter((n) => n.parent_id === parentId)
    .sort((a, b) => a.slot - b.slot);
}

/** Every descendant of a node, so a delete takes its subtree with it. */
export function descendantsOf(draft: MapDraft, nodeId: string): DraftNode[] {
  const result: DraftNode[] = [];
  const queue = [nodeId];
  const seen = new Set<string>([nodeId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenOf(draft, current)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

/**
 * The next free angular slot under a parent (§14: "New node auto-slots into
 * the next free angular position").
 *
 * Reuses a gap left by a deletion rather than always appending, so a map that
 * has been edited for a while does not end up with slots 0, 3, 7, 12 and a
 * lopsided ring.
 */
export function nextFreeSlot(draft: MapDraft, parentId: string): number {
  const taken = new Set(childrenOf(draft, parentId).map((n) => n.slot));
  let slot = 0;
  while (taken.has(slot)) slot += 1;
  return slot;
}

// ------------------------------------------------------------------ commands

export function addNodeCommand(
  draft: MapDraft,
  parentId: string,
  overrides: Partial<DraftNode> = {},
): Command {
  const parent = draft.nodes[parentId];

  const node: DraftNode = {
    id: newNodeId(),
    map_id: draft.id,
    parent_id: parentId,
    slot: nextFreeSlot(draft, parentId),
    title: '',
    // Inherits the parent's family so a new branch reads as part of its
    // branch rather than as a stray colour the user has to fix.
    family: parent?.family ?? draft.family,
    type: 'topic',
    status: 'active',
    visibility: 'inherit',
    weight: 0.5,
    ...overrides,
  };

  return {
    kind: 'add_node',
    node,
    focus: node.id,
    undoFocus: parentId,
  };
}

export function deleteNodeCommand(draft: MapDraft, nodeId: string): Command | null {
  const node = draft.nodes[nodeId];
  // The root is the map. Deleting it would leave an editor with nothing to
  // edit, so it is simply not deletable.
  if (!node || nodeId === draft.rootId) return null;

  const subtree = [node, ...descendantsOf(draft, nodeId)];

  return {
    kind: 'delete_nodes',
    nodes: subtree,
    focus: node.parent_id ?? draft.rootId,
    undoFocus: nodeId,
  };
}

export function updateNodeCommand(
  draft: MapDraft,
  nodeId: string,
  field: keyof DraftNode,
  value: unknown,
): Command | null {
  const node = draft.nodes[nodeId];
  if (!node) return null;

  const before = node[field];
  // A no-op edit must not enter the stack, or undo has silent steps that
  // appear to do nothing.
  if (Object.is(before, value)) return null;

  return {
    kind: 'update_node',
    nodeId,
    field,
    before,
    after: value,
    at: Date.now(),
    focus: nodeId,
    undoFocus: nodeId,
  };
}

export function moveNodeCommand(
  draft: MapDraft,
  nodeId: string,
  to: { parentId?: string | null; slot?: number; freeX?: number; freeY?: number },
): Command | null {
  const node = draft.nodes[nodeId];
  if (!node || nodeId === draft.rootId) return null;

  const parentId = to.parentId === undefined ? node.parent_id : to.parentId;

  // A node cannot become its own descendant's child — that would detach the
  // subtree from the map entirely and there would be no way back to it.
  if (parentId && wouldCycle(draft, nodeId, parentId)) return null;

  const before = {
    parentId: node.parent_id,
    slot: node.slot,
    ...(node.freeX !== undefined ? { freeX: node.freeX } : {}),
    ...(node.freeY !== undefined ? { freeY: node.freeY } : {}),
  };

  const after = {
    parentId,
    slot:
      to.slot ??
      (parentId === node.parent_id ? node.slot : nextFreeSlot(draft, parentId!)),
    ...(to.freeX !== undefined ? { freeX: to.freeX } : {}),
    ...(to.freeY !== undefined ? { freeY: to.freeY } : {}),
  };

  if (
    before.parentId === after.parentId &&
    before.slot === after.slot &&
    before.freeX === after.freeX &&
    before.freeY === after.freeY
  ) {
    return null;
  }

  return {
    kind: 'move_node',
    nodeId,
    before,
    after,
    focus: nodeId,
    undoFocus: nodeId,
  };
}

export function updateMapCommand(
  draft: MapDraft,
  field: 'title' | 'family' | 'visibility',
  value: unknown,
): Command | null {
  if (Object.is(draft[field], value)) return null;

  return {
    kind: 'update_map',
    field,
    before: draft[field],
    after: value,
    at: Date.now(),
    focus: draft.rootId,
    undoFocus: draft.rootId,
  };
}

function wouldCycle(draft: MapDraft, nodeId: string, newParentId: string): boolean {
  let current: string | null | undefined = newParentId;
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    if (current === nodeId) return true;
    seen.add(current);
    current = draft.nodes[current]?.parent_id;
  }
  return false;
}

// -------------------------------------------------------------------- create

export function createDraft(
  id: string,
  title: string,
  family: FamilyName,
  rootTitle = title,
): MapDraft {
  const rootId = newNodeId();

  return {
    id,
    title,
    family,
    visibility: 'private',
    rootId,
    nodes: {
      [rootId]: {
        id: rootId,
        map_id: id,
        parent_id: null,
        slot: 0,
        title: rootTitle,
        family,
        type: 'topic',
        status: 'active',
        visibility: 'inherit',
        weight: 1,
      },
    },
    version: 0,
    updatedAt: new Date().toISOString(),
    dirty: [],
    metaDirty: false,
  };
}

/** Marks everything clean after a successful save. */
export function markSaved(
  draft: MapDraft,
  version: number,
  updatedAt: string,
): MapDraft {
  return { ...draft, version, updatedAt, dirty: [], metaDirty: false };
}

export function isDirty(draft: MapDraft): boolean {
  return draft.dirty.length > 0 || draft.metaDirty;
}
