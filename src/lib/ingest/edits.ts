import type { StructuredNode } from './tree';
import { pathId } from './to-draft';

/**
 * The four edits §12 step 6 permits, applied to the proposed structure.
 *
 * The subtlety this module exists for: node ids in the preview are POSITIONAL
 * (`p0-2` is "third child of the first child"). That is deliberate — a
 * positional id survives a depth change and a re-render, so a node the user
 * switched off stays off. But it means any edit that MOVES a node renames
 * every id below and after it.
 *
 * So the two kinds of edit are handled differently:
 *
 *   - Toggle and rename are non-structural. They live in a set and a map
 *     beside the tree, and the tree is never touched.
 *   - Reparent and merge are structural. They BAKE the pending toggles and
 *     renames into a new tree first, then move the node, then hand back an
 *     empty set and map.
 *
 * Skipping the bake is the bug this design is built around: reparent one node
 * and every previously-excluded id silently points at a different node.
 */

export interface EditState {
  root: StructuredNode;
  excluded: ReadonlySet<string>;
  renamed: ReadonlyMap<string, string>;
}

/**
 * Fold the pending toggles and renames into the tree itself, returning a
 * structure that needs no side tables to interpret.
 */
export function bake(state: EditState): StructuredNode {
  const { root, excluded, renamed } = state;

  const visit = (node: StructuredNode, path: number[]): StructuredNode => ({
    title: renamed.get(pathId(path)) ?? node.title,
    summary: node.summary,
    children: node.children
      .map((child, index) => ({ child, childPath: [...path, index] }))
      .filter(({ childPath }) => !excluded.has(pathId(childPath)))
      .map(({ child, childPath }) => visit(child, childPath)),
  });

  return visit(root, []);
}

/** Find a node by its positional id, returning it and its parent. */
function locate(
  root: StructuredNode,
  id: string,
): { node: StructuredNode; parent: StructuredNode | null; index: number } | null {
  if (id === 'root') return { node: root, parent: null, index: -1 };

  const search = (
    node: StructuredNode,
    path: number[],
  ): { node: StructuredNode; parent: StructuredNode; index: number } | null => {
    for (let i = 0; i < node.children.length; i++) {
      const childPath = [...path, i];
      if (pathId(childPath) === id) {
        return { node: node.children[i]!, parent: node, index: i };
      }
      const found = search(node.children[i]!, childPath);
      if (found) return found;
    }
    return null;
  };

  return search(root, []);
}

/** Is `candidate` inside `node`'s subtree? Moving a node into its own subtree
 * would detach both from the root and produce a cycle. */
function contains(node: StructuredNode, candidate: StructuredNode): boolean {
  if (node === candidate) return true;
  return node.children.some((child) => contains(child, candidate));
}

/**
 * §12 step 6: "drag to reparent".
 *
 * Returns a fresh baked tree, or null when the move is not legal — in which
 * case the caller leaves the structure alone rather than showing an error, the
 * same way the editor treats an impossible drop.
 */
export function reparent(
  state: EditState,
  nodeId: string,
  newParentId: string,
): StructuredNode | null {
  const root = bake(state);

  const target = locate(root, nodeId);
  const destination = locate(root, newParentId);
  if (!target || !destination || !target.parent) return null;
  if (target.node === destination.node) return null;

  // A node cannot be moved inside itself.
  if (contains(target.node, destination.node)) return null;

  target.parent.children.splice(target.index, 1);
  destination.node.children.push(target.node);

  return root;
}

/**
 * §12 step 6: "merge two into one".
 *
 * Merging folds a node into its previous sibling: the titles join, the
 * summaries join, and the children are concatenated. It is the edit for when
 * the page split one idea across two headings, which is the common case this
 * exists to fix.
 */
export function merge(state: EditState, nodeId: string): StructuredNode | null {
  const root = bake(state);
  const target = locate(root, nodeId);
  if (!target || !target.parent || target.index <= 0) return null;

  const into = target.parent.children[target.index - 1]!;
  const from = target.node;

  // The combined title stays inside the node title cap; beyond that the map
  // just truncates, and two full headings joined is rarely readable anyway.
  const joined = `${into.title} & ${from.title}`;
  into.title = joined.length <= 60 ? joined : into.title;

  into.summary = [into.summary, from.summary]
    .filter(Boolean)
    .join(' ')
    .slice(0, 240);
  into.children = [...into.children, ...from.children];

  target.parent.children.splice(target.index, 1);

  return root;
}
