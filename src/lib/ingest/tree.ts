/**
 * The node tree, and the limits that shape it.
 *
 * ── Why this is a separate file ─────────────────────────────────────────────
 *
 * All of this lived in `structure.ts`, which is the right home for it by
 * subject and the wrong one by dependency. `structure.ts` imports the AI
 * gateway, the gateway is `server-only`, and Screen 14 is a client component
 * that legitimately needs to count nodes and trim a tree for its checklist.
 *
 * The result was a build error with a confusing message — "you're importing a
 * component that needs server-only" pointing at `ai/gateway.ts`, from a
 * component that has never heard of it. The chain was four hops long:
 *
 *     SearchScreen (use client)
 *       → components/link          (the barrel)
 *         → LinkScreen             `import { countNodes }`
 *           → ingest/structure     `import { toolCall }`
 *             → ai/gateway         `import 'server-only'`   ✗
 *
 * A `import type` would have been erased and cost nothing. A VALUE import
 * pulls the whole module graph, so one call to a four-line pure function
 * dragged an AI client, a database handle and better-sqlite3 toward the
 * browser bundle.
 *
 * So the pure, isomorphic core lives here and depends on nothing. Server code
 * is unaffected — `structure.ts` re-exports every name below, so existing
 * imports keep working and there was no call-site churn to get this.
 *
 * ── The rule this file encodes ──────────────────────────────────────────────
 *
 * A module a client component imports for VALUES must not, transitively, reach
 * anything marked `server-only`. `ingest/no-server-only.test.ts` walks the
 * import graph and fails when one does, because the next person to add a
 * helper to `structure.ts` and call it from a screen will not have read this
 * comment.
 */

/** Deepest level the generated tree may reach. §12 step 5's depth control. */
export const MAX_DEPTH = 3;

/** Widest a single ring may be. Matches the map's ring-one budget. */
export const MAX_CHILDREN = 8;

/** Total node cap for one generated map, root included. */
export const MAX_NODES = 40;

export interface StructuredNode {
  title: string;
  summary: string;
  children: StructuredNode[];
}

/** Total nodes including the root — used for the node cap and the checklist. */
export function countNodes(node: StructuredNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/** Trim a tree to `depth` levels, for §12 step 5's "depth control: 2 or 3". */
export function atDepth(node: StructuredNode, depth: number): StructuredNode {
  if (depth <= 1) return { ...node, children: [] };
  return {
    ...node,
    children: node.children.map((child) => atDepth(child, depth - 1)),
  };
}
