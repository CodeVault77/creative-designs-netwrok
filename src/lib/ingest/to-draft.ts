import { newNodeId } from '@/lib/editor/draft';
import type { MapDraft, DraftNode } from '@/lib/editor/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';
// From `./tree`, not `./structure`: this module is reached from a client
// component, and `structure.ts` imports the server-only AI gateway.
import { MAX_NODES, type StructuredNode } from './tree';

/**
 * Structure → draft.
 *
 * The bridge between the ingest pipeline and the map the user actually gets.
 * Deliberately a pure function over the same MapDraft the editor already
 * understands, so a generated map is not a special kind of map: it opens in
 * the P5 editor, undoes, autosaves and shares exactly like a hand-built one.
 *
 * Kept out of `pipeline.ts` because the preview screen runs it in the BROWSER,
 * on the user's edits, before anything is saved. §12 step 5 renders the
 * proposal "in the real renderer, not a list — the user must see it is a
 * _map_", and that means turning the structure into a draft client-side.
 */

/**
 * Generated maps take the Create family.
 *
 * §06 gives a user map a single hue for its centre ring, and Link-to-Mind-Map
 * is ring node 2, which is Create/Lime (§05). Inheriting the family of the
 * feature that made the map keeps the visual link.
 */
export const INGEST_FAMILY: FamilyName = 'create';

export interface ToDraftOptions {
  mapId: string;
  title: string;
  sourceUrl: string;
  /** Ids the user switched OFF in the checklist. Their subtrees go too. */
  excluded?: ReadonlySet<string>;
  /** Overrides from inline renaming, keyed by the same synthetic id. */
  renamed?: ReadonlyMap<string, string>;
  depth?: number;
}

/**
 * A stable id for a node in the proposed structure.
 *
 * Positional rather than random, so the checklist's "off" set survives a
 * depth change or a re-render. A random id per render would silently re-enable
 * everything the user had just switched off.
 */
export function pathId(path: number[]): string {
  return path.length === 0 ? 'root' : `p${path.join('-')}`;
}

/** Walk the proposal, yielding each node with its stable id and depth. */
export function* walk(
  node: StructuredNode,
  path: number[] = [],
): Generator<{ id: string; node: StructuredNode; path: number[]; depth: number }> {
  yield { id: pathId(path), node, path, depth: path.length };
  for (let i = 0; i < node.children.length; i++) {
    yield* walk(node.children[i]!, [...path, i]);
  }
}

export function toDraft(root: StructuredNode, options: ToDraftOptions): MapDraft {
  const { mapId, title, sourceUrl } = options;
  const excluded = options.excluded ?? new Set<string>();
  const renamed = options.renamed ?? new Map<string, string>();
  const maxDepth = options.depth ?? 3;

  const nodes: Record<string, DraftNode> = {};
  const rootId = newNodeId();

  nodes[rootId] = {
    id: rootId,
    map_id: mapId,
    parent_id: null,
    slot: 0,
    title: (renamed.get('root') ?? root.title).slice(0, 60),
    description: root.summary || undefined,
    family: INGEST_FAMILY,
    type: 'topic',
    status: 'active',
    visibility: 'inherit',
    weight: 1,
    // §12 step 8: "every node carries a source-link chip back to the origin
    // URL". The href makes Open work; the chip reads it from here.
    href: sourceUrl,
  };

  let count = 1;

  const addChildren = (
    parent: StructuredNode,
    parentId: string,
    path: number[],
  ) => {
    // `depth` counts levels INCLUDING the root, so depth 3 means levels 0, 1
    // and 2. A node at `path` sits at level path.length and its children at
    // level path.length + 1, which must stay under `depth`.
    if (path.length >= maxDepth - 1) return;

    let slot = 0;
    for (let i = 0; i < parent.children.length; i++) {
      const childPath = [...path, i];
      const id = pathId(childPath);

      /**
       * An excluded node takes its whole subtree with it. Keeping orphaned
       * grandchildren would reparent content the user explicitly removed,
       * which reads as the toggle not working.
       */
      if (excluded.has(id)) continue;
      if (count >= MAX_NODES) return;

      const child = parent.children[i]!;
      const nodeId = newNodeId();

      nodes[nodeId] = {
        id: nodeId,
        map_id: mapId,
        parent_id: parentId,
        // Slots are assigned over the SURVIVING children, so switching one off
        // closes the gap rather than leaving a hole in the ring (ADR-0002:
        // slots are fixed once assigned, and these are being assigned now).
        slot: slot++,
        title: (renamed.get(id) ?? child.title).slice(0, 60),
        description: child.summary || undefined,
        family: INGEST_FAMILY,
        type: 'topic',
        status: 'active',
        visibility: 'inherit',
        weight: 0.5,
        href: sourceUrl,
      };
      count++;

      addChildren(child, nodeId, childPath);
    }
  };

  addChildren(root, rootId, []);

  return {
    id: mapId,
    title: title.slice(0, 60),
    family: INGEST_FAMILY,
    // §12 step 7: "Private by default is non-negotiable — the source may be
    // paywalled or personal."
    visibility: 'private',
    rootId,
    nodes,
    version: 0,
    updatedAt: new Date().toISOString(),
    dirty: [],
    metaDirty: false,
    sourceUrl,
  };
}

/** How many nodes a given set of exclusions will actually produce. */
export function countIncluded(
  root: StructuredNode,
  excluded: ReadonlySet<string>,
  depth: number,
): number {
  let count = 0;
  const visit = (node: StructuredNode, path: number[]) => {
    if (path.length > 0) {
      if (excluded.has(pathId(path))) return;
      if (path.length >= depth) return;
    }
    count++;
    node.children.forEach((child, i) => visit(child, [...path, i]));
  };
  visit(root, []);
  return Math.min(count, MAX_NODES);
}
