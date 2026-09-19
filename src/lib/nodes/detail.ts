import { ancestorsOf } from '@/lib/map/geometry';
import { communityMap } from '@/lib/map/seed';
import type { MapNode } from '@/lib/map/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The node detail payload.
 *
 * One shape for all four modes (§18: "one component, four modes"). The mode
 * is derived from the node and the viewer, never passed in by a caller who
 * might get it wrong — that derivation is `modeFor` below, and it is the
 * single place the decision is made.
 */

export type NodeDetailMode =
  /** A live node the viewer may see. */
  | 'view'
  /** The viewer owns it and the editor is open. P5 builds the editing UI. */
  | 'edit'
  /** status = coming_soon. Screen 22. */
  | 'soon'
  /** Exists, but this viewer may not see its content. */
  | 'locked';

export interface NodeCrumb {
  id: string;
  title: string;
}

export interface RelatedNode {
  id: string;
  title: string;
  family: FamilyName;
  href?: string;
}

export interface NodeDetail {
  id: string;
  mapId: string;
  title: string;
  description?: string;
  family: FamilyName;
  type: MapNode['type'];
  status: MapNode['status'];
  visibility: MapNode['visibility'];
  /** Destination for `Open`. Absent means the node only expands. */
  href?: string;
  /**
   * The node's glyph, so the sheet can show the SAME symbol the map drew.
   *
   * Carried even in `locked` mode: the icon is part of the node's outline,
   * which §08 says is not secret — only its content is.
   */
  icon?: string;
  /** Position on its ring (§10's numbering). Absent for the root. */
  slot: number;
  /** Root → this node. Drives the sheet's path line. */
  trail: NodeCrumb[];
  childCount: number;
  /** Public share URL, always present (§10: every node is shareable). */
  shareUrl: string;

  // ---- soon mode only ----
  /**
   * Honest target window, e.g. "Q1 2027". Deliberately coarse: a specific
   * date we might miss is worse than a season we can hit.
   */
  targetWindow?: string;
  /**
   * Live nodes worth visiting instead. The single most useful thing a Coming
   * Soon screen can do is not be a dead end.
   */
  relatedLive?: RelatedNode[];
  /** How many people have registered interest. Shown as social proof. */
  interestCount?: number;
}

/** Target windows for the seven dark ring-one nodes (ADR-0001). */
const TARGET_WINDOWS: Record<string, string> = {
  'people-networks': 'Q1 2027',
  /*
   * `freelance` was here with a Q2 2027 window until the marketplace shipped.
   * Removed rather than kept: a target window on a live node would render a
   * date for something already available, and a stale promise is worse than
   * no promise. See ADR-0001's amendment.
   */
  'ai-tools': 'Q1 2027',
  'ideas-innovation': 'Q2 2027',
  /*
   * `tasks-projects` and `commerce` were here until their node-type packages
   * shipped with a destination. Removed for the same reason `freelance` was:
   * a target window on a live node advertises a future date for something
   * already available.
   */
  partners: 'Q3 2027',
};

export interface Viewer {
  userId: string | null;
  isStaff: boolean;
}

/**
 * Which mode a node renders in, for a given viewer.
 *
 * Order matters. Permission is checked BEFORE status: a private node the
 * viewer cannot see must read as locked even if it also happens to be Coming
 * Soon, or the locked state leaks the fact that content exists behind it.
 */
export function modeFor(node: MapNode, viewer: Viewer): NodeDetailMode {
  if (node.visibility === 'private' && !viewer.isStaff) {
    return 'locked';
  }
  if (node.status === 'coming_soon') return 'soon';
  return 'view';
}

export class NodeNotFoundError extends Error {
  constructor(nodeId: string) {
    super(`Node not found: ${nodeId}`);
    this.name = 'NodeNotFoundError';
  }
}

/**
 * Loads a node's detail.
 *
 * P6 replaces the seed lookup with a database query. The signature and the
 * returned shape do not change — that is the point of putting the derivation
 * here rather than in the route handler.
 */
export function getNodeDetail(
  nodeId: string,
  viewer: Viewer,
  siteUrl: string,
): NodeDetail {
  const graph = communityMap();
  const node = graph.nodes.get(nodeId);

  if (!node) throw new NodeNotFoundError(nodeId);

  const mode = modeFor(node, viewer);
  const trail = ancestorsOf(graph, nodeId).map((n) => ({
    id: n.id,
    title: n.title,
  }));
  const childCount = (graph.childrenOf.get(nodeId) ?? []).length;

  const base: NodeDetail = {
    id: node.id,
    mapId: node.map_id,
    title: node.title,
    family: node.family,
    type: node.type,
    status: node.status,
    visibility: node.visibility,
    trail,
    childCount,
    slot: node.slot,
    ...(node.icon ? { icon: node.icon } : {}),
    shareUrl: `${siteUrl.replace(/\/$/, '')}/n/${encodeURIComponent(node.id)}`,
  };

  // A locked node returns its title and nothing else. The structure of the
  // map is not secret; its content is (§08 screen 04). Returning the
  // description here and hiding it in the UI would ship it to the browser.
  if (mode === 'locked') {
    return base;
  }

  const detail: NodeDetail = {
    ...base,
    ...(node.description ? { description: node.description } : {}),
    ...(node.href ? { href: node.href } : {}),
  };

  if (mode === 'soon') {
    return {
      ...detail,
      // No href in soon mode, even if the data has one — a Coming Soon node
      // must not have an Open action.
      href: undefined,
      targetWindow: TARGET_WINDOWS[node.id] ?? 'In planning',
      relatedLive: relatedLiveFor(node),
    };
  }

  return detail;
}

/**
 * Live siblings in the same family, then any live sibling.
 *
 * Same-family first because a user tapping "AI Tools" is closer in intent to
 * "Mind Mapping" than to "Build With Us", and a Coming Soon screen that
 * offers something genuinely adjacent converts far better than one offering
 * a random list.
 */
export function relatedLiveFor(node: MapNode, limit = 3): RelatedNode[] {
  const graph = communityMap();
  const siblingIds = node.parent_id
    ? (graph.childrenOf.get(node.parent_id) ?? [])
    : [];

  const candidates = siblingIds
    .map((id) => graph.nodes.get(id))
    .filter((n): n is MapNode => Boolean(n))
    .filter((n) => n.id !== node.id && n.status === 'active');

  const sameFamily = candidates.filter((n) => n.family === node.family);
  const others = candidates.filter((n) => n.family !== node.family);

  return [...sameFamily, ...others].slice(0, limit).map((n) => ({
    id: n.id,
    title: n.title,
    family: n.family,
    ...(n.href ? { href: n.href } : {}),
  }));
}

export { TARGET_WINDOWS };
