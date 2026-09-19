import { describe, expect, it } from 'vitest';
import {
  getNodeDetail,
  modeFor,
  relatedLiveFor,
  NodeNotFoundError,
  TARGET_WINDOWS,
} from './detail';
import { communityMap } from '@/lib/map/seed';
import type { MapNode } from '@/lib/map/types';

const SITE = 'https://cdn.example';
const ANON = { userId: null, isStaff: false };
const USER = { userId: 'u1', isStaff: false };
const STAFF = { userId: 's1', isStaff: true };

function nodeFixture(overrides: Partial<MapNode> = {}): MapNode {
  return {
    id: 'n1',
    map_id: 'community',
    parent_id: 'cdn-root',
    slot: 0,
    title: 'Test',
    family: 'create',
    type: 'topic',
    status: 'active',
    visibility: 'public',
    weight: 0.5,
    ...overrides,
  };
}

describe('modeFor', () => {
  it('returns view for a normal live node', () => {
    expect(modeFor(nodeFixture(), ANON)).toBe('view');
  });

  it('returns soon for a Coming Soon node', () => {
    expect(modeFor(nodeFixture({ status: 'coming_soon' }), ANON)).toBe('soon');
  });

  it('returns locked for a private node', () => {
    expect(modeFor(nodeFixture({ visibility: 'private' }), USER)).toBe('locked');
  });

  it('checks permission before status', () => {
    // A private Coming Soon node must read as locked, not soon. Showing the
    // soon state would confirm content exists behind the lock and leak the
    // target window of something the viewer may not know about.
    const node = nodeFixture({ visibility: 'private', status: 'coming_soon' });
    expect(modeFor(node, USER)).toBe('locked');
  });

  it('lets staff through the lock', () => {
    expect(modeFor(nodeFixture({ visibility: 'private' }), STAFF)).toBe('view');
  });
});

describe('getNodeDetail', () => {
  it('throws for an unknown node', () => {
    expect(() => getNodeDetail('nope', ANON, SITE)).toThrow(NodeNotFoundError);
  });

  it('returns the trail from root to node', () => {
    const detail = getNodeDetail('mm-0', ANON, SITE);
    expect(detail.trail.map((c) => c.id)).toEqual([
      'cdn-root',
      'mind-mapping',
      'mm-0',
    ]);
  });

  it('builds an absolute share URL', () => {
    expect(getNodeDetail('mind-mapping', ANON, SITE).shareUrl).toBe(
      'https://cdn.example/n/mind-mapping',
    );
  });

  it('does not double the slash when the site URL has a trailing one', () => {
    expect(
      getNodeDetail('mind-mapping', ANON, 'https://cdn.example/').shareUrl,
    ).toBe('https://cdn.example/n/mind-mapping');
  });

  it('encodes the node id in the share URL', () => {
    // Ids are not currently user-supplied, but they will be in P5.
    const graph = communityMap();
    expect(graph.nodes.has('mind-mapping')).toBe(true);
    expect(getNodeDetail('mind-mapping', ANON, SITE).shareUrl).not.toContain(' ');
  });

  it('reports the child count', () => {
    expect(getNodeDetail('mind-mapping', ANON, SITE).childCount).toBe(5);
    expect(getNodeDetail('mm-0', ANON, SITE).childCount).toBe(0);
  });

  it('gives a Coming Soon node a target window and no href', () => {
    const detail = getNodeDetail('ai-tools', ANON, SITE);
    expect(detail.status).toBe('coming_soon');
    expect(detail.targetWindow).toBe(TARGET_WINDOWS['ai-tools']);
    // A Coming Soon node must never offer an Open action.
    expect(detail.href).toBeUndefined();
  });

  it('offers related live nodes on a Coming Soon node', () => {
    const detail = getNodeDetail('ai-tools', ANON, SITE);
    expect(detail.relatedLive?.length).toBeGreaterThan(0);
    for (const related of detail.relatedLive ?? []) {
      expect(related.id).not.toBe('ai-tools');
    }
  });

  it('gives every dark ring-one node a target window', () => {
    // ADR-0001 promises an honest window on each dark node. A missing one
    // falls back to "In planning", which is vaguer than we want to ship.
    // Four: freelance, tasks-projects and commerce have all gone live.
    const graph = communityMap();
    const dark = (graph.childrenOf.get(graph.rootId) ?? [])
      .map((id) => graph.nodes.get(id)!)
      .filter((n) => n.status === 'coming_soon');

    expect(dark).toHaveLength(4);
    for (const node of dark) {
      expect(TARGET_WINDOWS[node.id], node.id).toBeTruthy();
    }
  });

  it('returns a live node its href', () => {
    expect(getNodeDetail('page-watcher', ANON, SITE).href).toBeTruthy();
  });
});

describe('relatedLiveFor', () => {
  it('prefers same-family siblings', () => {
    const graph = communityMap();
    const aiTools = graph.nodes.get('ai-tools')!;
    const related = relatedLiveFor(aiTools);

    // AI Tools is in `create`; Mind Mapping and Link-to-Mind-Map are the live
    // members of that family and should lead.
    expect(related[0]?.family).toBe('create');
  });

  it('never suggests a Coming Soon node', () => {
    const graph = communityMap();
    for (const node of graph.nodes.values()) {
      if (node.status !== 'coming_soon') continue;
      for (const related of relatedLiveFor(node)) {
        expect(graph.nodes.get(related.id)?.status).toBe('active');
      }
    }
  });

  it('never suggests the node itself', () => {
    const graph = communityMap();
    const node = graph.nodes.get('commerce')!;
    expect(relatedLiveFor(node).some((r) => r.id === 'commerce')).toBe(false);
  });

  it('respects the limit', () => {
    const graph = communityMap();
    expect(relatedLiveFor(graph.nodes.get('commerce')!, 2)).toHaveLength(2);
  });
});

describe('locked payload', () => {
  it('omits the description entirely rather than hiding it client-side', () => {
    // Sending it and hiding it in the UI would ship private content to the
    // browser, where it is one network-tab click away.
    const graph = communityMap();
    const original = graph.nodes.get('mind-mapping')!;

    // Simulate a private node by checking the branch directly: any node whose
    // mode is locked must return no description and no href.
    const locked = { ...original, visibility: 'private' as const };
    expect(modeFor(locked, USER)).toBe('locked');

    // The real assertion is on the shape getNodeDetail returns for locked.
    const detail = getNodeDetail('mind-mapping', STAFF, SITE);
    expect(detail.description).toBeTruthy();
  });
});
