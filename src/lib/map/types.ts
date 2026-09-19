import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The node schema from §10.
 *
 * Field names are snake_case because these arrive from the database
 * unchanged. Renaming at the boundary buys nothing and creates two
 * vocabularies for the same object.
 */

/**
 * Every node type this app has ever stored a row for.
 *
 * A runtime array rather than a bare union, so something can check membership
 * against it rather than only the compiler. `map/types.test.ts` uses that to
 * assert every id `lib/nodes/packages.ts` registers also appears here — the
 * exact drift that let `product`, `order`, `invoice`, `contact`, `deal`,
 * `task` and `milestone` exist in the registry, pass every registry test, and
 * still be uncreatable: the type picker and the save route both validated
 * against THIS union, which packages.ts was never added to.
 *
 * Listed by hand rather than imported from `packages.ts`, because that would
 * be circular: `nodes/registry.ts` imports `NodeType` from here, and
 * `packages.ts` is imported BY `registry.ts`. This file has to stay a leaf.
 */
export const NODE_TYPES = [
  // The original five, creatable from the first version of the editor.
  'topic',
  'link',
  'note',
  'image',
  'date',
  // Registered but not yet built; the picker shows and disables these.
  'service',
  'page',
  // Synthesised by the layout when a ring overflows. Never created by hand.
  'cluster',
  // lib/nodes/packages.ts — commerce, CRM and project management.
  'product',
  'order',
  'invoice',
  'contact',
  'deal',
  'task',
  'milestone',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export type NodeStatus = 'active' | 'inactive' | 'coming_soon';

export type NodeVisibility = 'inherit' | 'public' | 'private';

export interface MapNode {
  id: string;
  map_id: string;
  /** null for the root. Adjacency list; ring depth is derived, never stored. */
  parent_id: string | null;
  /** Fixed angular position among siblings. Assigned once, persisted (ADR-0002). */
  slot: number;
  /** Capped at 60 chars; truncates to 18 on canvas. */
  title: string;
  description?: string;
  family: FamilyName;
  type: NodeType;
  status: NodeStatus;
  visibility: NodeVisibility;
  icon?: string;
  /**
   * Forward-compatible slot for the eventual behaviour engine. Ship it empty
   * rather than schema-migrating later (§10).
   */
  payload?: Record<string, unknown>;
  /** Popularity 0–1. Drives size and glow ONLY, never position (ADR-0002). */
  weight: number;
  /** Destination for `Open`. Absent means the node only expands. */
  href?: string;
}

/**
 * A node placed in the world by the layout pass.
 *
 * `x`/`y` are world coordinates — camera-independent. The renderer converts
 * to screen space; nothing else should.
 */
export interface PlacedNode {
  node: MapNode;
  /** 0 for root, 1 for ring one, and so on. Derived from the tree. */
  depth: number;
  /** World coordinates. */
  x: number;
  y: number;
  /** Angle in radians used to place it, kept for edge drawing. */
  theta: number;
  /** Ring radius. */
  radius: number;
  /** Drawn diameter in world units, before camera scale. */
  size: number;
  /** 0–1 opacity from the focus model. */
  opacity: number;
  /** Cluster nodes stand in for several real siblings. */
  cluster?: {
    /** How many nodes this stands for. */
    count: number;
    /** The ids it replaced, so tapping it can expand them. */
    memberIds: string[];
  };
}

export interface Edge {
  fromId: string;
  toId: string;
  /** Both endpoints in world coordinates. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  family: FamilyName;
  opacity: number;
  /** Search results connect by dashed edges to a temporary outer ring (§09). */
  dashed: boolean;
  /**
   * What the line MEANS.
   *
   * `contains` is the parent/child spine, derived from `parent_id`.
   * `relation` is an explicit typed link from `node_edges` — an association,
   * not a hierarchy. They are drawn differently on purpose: without that, a
   * "depends on" line and a "is inside" line look identical and the map claims
   * a containment that does not exist.
   */
  kind: 'contains' | 'relation';
  /** The relationship type, for `relation` edges only. */
  relationType?: string;
}

/** An explicit relationship, as the layout receives it. */
export interface RelationInput {
  fromNodeId: string;
  toNodeId: string;
  type: string;
}

/** A whole map: its nodes indexed for the operations the renderer performs. */
export interface MapGraph {
  id: string;
  title: string;
  rootId: string;
  nodes: ReadonlyMap<string, MapNode>;
  /** parent id -> child ids, in slot order. */
  childrenOf: ReadonlyMap<string, readonly string[]>;
}

export interface Viewport {
  width: number;
  height: number;
}
