import { capabilitiesFor, type Capabilities, type Role } from './roles';
import type { DraftNode } from '@/lib/editor/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * THE SHARE PAYLOAD FILTER.
 *
 * §20 names this phase's High risk precisely: "Node-viewable-off must filter
 * server-side". §15 is blunter — "**Never** ship a client-side filter for
 * this — the data must not leave the server."
 *
 * The failure this prevents is specific and easy to reach. Send the whole map
 * and hide fields in the UI, and every hidden description sits in the network
 * tab, in the SSR payload, in a `view-source`, and in any cache in between.
 * A lock icon over data you already sent is decoration.
 *
 * So this module is the ONLY thing that turns a stored map into something a
 * viewer receives. Two rules make it hard to get wrong:
 *
 *   1. **It builds a NEW object, field by field.** Never a spread of the
 *      stored node with deletions on top. A spread means the default is
 *      "include", so any field added later leaks until someone remembers to
 *      exclude it. Here the default is "omit", and a new field has to be
 *      deliberately added to be shared.
 *
 *   2. **A private node takes its whole subtree with it.** Excluding the node
 *      but keeping its children would leave orphans dangling from a parent
 *      that is not there — visible structure the owner intended to hide.
 *
 * Pure, so it can be tested exhaustively without a database or a request.
 */

export type Visibility = 'private' | 'link' | 'public';

export interface StoredMap {
  id: string;
  title: string;
  family: FamilyName;
  visibility: Visibility;
  /** §15: off means viewers see structure, titles and shape — but no detail. */
  nodeViewable: boolean;
  rootId: string;
  nodes: Record<string, DraftNode>;
  version: number;
  updatedAt: string;
  ownerId: string;
  ownerHandle: string;
}

export interface Viewer {
  userId: string | null;
  isStaff: boolean;
  /** The viewer's membership role, if any. */
  role: Role | null;
  /** True when they arrived through a valid share link rather than membership. */
  viaShareLink: boolean;
}

/** A node as it appears to a viewer. Deliberately NOT DraftNode. */
export interface SharedNode {
  id: string;
  parent_id: string | null;
  slot: number;
  title: string;
  family: FamilyName;
  type: DraftNode['type'];
  status: DraftNode['status'];
  weight: number;
  /** Present only when the viewer may see node detail. */
  description?: string;
  href?: string;
  icon?: string;
  payload?: Record<string, unknown>;
  freeX?: number;
  freeY?: number;
  /** True when this node is private and the viewer may not open it (§10). */
  locked?: boolean;
}

export interface SharePayload {
  id: string;
  title: string;
  family: FamilyName;
  visibility: Visibility;
  nodeViewable: boolean;
  rootId: string;
  nodes: Record<string, SharedNode>;
  version: number;
  updatedAt: string;
  ownerHandle: string;
  /** What this viewer may do. Drives the UI; the server never trusts it back. */
  can: Capabilities;
  /** How many nodes were withheld, so the UI can say so honestly. */
  hiddenCount: number;
}

export class NotVisibleError extends Error {
  constructor() {
    super('Not visible');
    this.name = 'NotVisibleError';
  }
}

/**
 * Whether the viewer may see the map at all.
 *
 * Separate from the payload build so a caller can 404 before doing any work,
 * and so the decision is one boolean rather than an emergent property of the
 * filtering below.
 */
export function canViewMap(map: StoredMap, viewer: Viewer): boolean {
  if (viewer.userId && viewer.userId === map.ownerId) return true;
  if (viewer.isStaff) return true;
  if (viewer.role) return true;
  if (map.visibility === 'public') return true;
  // A link-viewable map is reachable ONLY with the token, never by knowing
  // the id — otherwise "link" and "public" are the same setting.
  if (map.visibility === 'link' && viewer.viaShareLink) return true;
  return false;
}

/**
 * Whether the viewer may open node detail.
 *
 * Owners, staff and members always can — node-viewable is a setting about
 * people you shared WITH, not about people who are already inside.
 */
export function canSeeNodeDetail(map: StoredMap, viewer: Viewer): boolean {
  if (viewer.userId && viewer.userId === map.ownerId) return true;
  if (viewer.isStaff) return true;
  if (viewer.role) return true;
  return map.nodeViewable;
}

/**
 * Builds exactly what this viewer is allowed to receive.
 *
 * Throws rather than returning null so a caller cannot forget to check — an
 * ignored null renders an empty map; an ignored throw is a 500 someone
 * notices.
 */
export function buildSharePayload(map: StoredMap, viewer: Viewer): SharePayload {
  if (!canViewMap(map, viewer)) throw new NotVisibleError();

  const isInsider =
    viewer.isStaff || (viewer.userId !== null && viewer.userId === map.ownerId);
  const withDetail = canSeeNodeDetail(map, viewer);

  const hiddenIds = privateSubtreeIds(map, viewer, isInsider);

  const nodes: Record<string, SharedNode> = {};

  for (const node of Object.values(map.nodes)) {
    if (hiddenIds.has(node.id)) continue;

    // Built field by field. See rule 1 above: the default is omit.
    const shared: SharedNode = {
      id: node.id,
      parent_id: node.parent_id,
      slot: node.slot,
      title: node.title,
      family: node.family,
      type: node.type,
      status: node.status,
      weight: node.weight,
    };

    // Position is structure, not content — a node-viewable-off map still has
    // to render in the right shape.
    if (node.freeX !== undefined) shared.freeX = node.freeX;
    if (node.freeY !== undefined) shared.freeY = node.freeY;

    if (withDetail) {
      if (node.description) shared.description = node.description;
      if (node.href) shared.href = node.href;
      if (node.icon) shared.icon = node.icon;
      if (node.payload) shared.payload = node.payload;
    } else {
      // §15: "taps do not open detail". The UI needs to know, and the data it
      // would have shown is simply not here.
      shared.locked = true;
    }

    nodes[node.id] = shared;
  }

  return {
    id: map.id,
    title: map.title,
    family: map.family,
    visibility: map.visibility,
    nodeViewable: map.nodeViewable,
    rootId: map.rootId,
    nodes,
    version: map.version,
    updatedAt: map.updatedAt,
    ownerHandle: map.ownerHandle,
    can:
      viewer.userId === map.ownerId
        ? capabilitiesFor('owner')
        : capabilitiesFor(viewer.role),
    hiddenCount: hiddenIds.size,
  };
}

/**
 * Ids of nodes marked private, plus everything beneath them.
 *
 * §15: "Individual nodes may override to Private inside an otherwise shared
 * map… their subtree is excluded from the share payload server-side."
 *
 * Insiders — the owner and staff — see everything, so the set is empty for
 * them. Members do NOT: a private node is private to the owner even from
 * people they invited, which is the whole point of a per-node override inside
 * an already-shared map.
 */
export function privateSubtreeIds(
  map: StoredMap,
  viewer: Viewer,
  isInsider = false,
): Set<string> {
  const hidden = new Set<string>();
  if (isInsider) return hidden;

  const roots = Object.values(map.nodes).filter((n) => n.visibility === 'private');
  if (roots.length === 0) return hidden;

  // Children indexed once; walking the whole node list per level would be
  // quadratic on a large map.
  const childrenOf = new Map<string, string[]>();
  for (const node of Object.values(map.nodes)) {
    if (!node.parent_id) continue;
    const list = childrenOf.get(node.parent_id);
    if (list) list.push(node.id);
    else childrenOf.set(node.parent_id, [node.id]);
  }

  const queue = roots.map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (hidden.has(id)) continue;
    hidden.add(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }

  // The root is never hidden: a map with no root renders as nothing at all,
  // which reads as broken rather than as private.
  hidden.delete(map.rootId);
  return hidden;
}

/**
 * Every field name that must never appear in a payload without detail access.
 *
 * Exported so the security test can assert on the list rather than restating
 * it — a new sensitive field is then added in one place and the test starts
 * covering it immediately.
 */
export const DETAIL_FIELDS = ['description', 'href', 'icon', 'payload'] as const;
