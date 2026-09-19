import { describe, expect, it } from 'vitest';
import type { StructuredNode } from './structure';
import { bake, merge, reparent } from './edits';
import { countIncluded, pathId, toDraft, walk } from './to-draft';

/**
 * The edit layer, and the draft it produces.
 *
 * These tests exist because of one design decision: node ids in the preview
 * are POSITIONAL. That buys stability across depth changes and re-renders, and
 * it costs correctness the moment a node moves — every id below and after it
 * now means something different.
 *
 * So the tests below are mostly about that seam: bake before you move, and
 * never let a stale id survive a structural edit.
 */

function tree(): StructuredNode {
  return {
    title: 'Root',
    summary: 'root summary',
    children: [
      {
        title: 'Alpha',
        summary: 'a',
        children: [
          { title: 'Alpha One', summary: 'a1', children: [] },
          { title: 'Alpha Two', summary: 'a2', children: [] },
        ],
      },
      { title: 'Beta', summary: 'b', children: [] },
      { title: 'Gamma', summary: 'g', children: [] },
    ],
  };
}

const NO_EDITS = {
  excluded: new Set<string>(),
  renamed: new Map<string, string>(),
};

describe('positional ids', () => {
  it('names each node by its position', () => {
    const ids = [...walk(tree())].map((entry) => entry.id);
    expect(ids).toEqual(['root', 'p0', 'p0-0', 'p0-1', 'p1', 'p2']);
  });
});

describe('bake', () => {
  it('drops excluded nodes and applies renames', () => {
    const baked = bake({
      root: tree(),
      excluded: new Set(['p1']),
      renamed: new Map([['p2', 'Renamed Gamma']]),
    });

    expect(baked.children.map((c) => c.title)).toEqual(['Alpha', 'Renamed Gamma']);
  });

  /**
   * Excluding a parent must take its children with it. Keeping them would
   * reparent content the user explicitly removed, which reads as the toggle
   * being broken.
   */
  it('takes the whole subtree when a parent is excluded', () => {
    const baked = bake({
      root: tree(),
      excluded: new Set(['p0']),
      renamed: new Map(),
    });
    expect([...walk(baked)].map((e) => e.node.title)).toEqual([
      'Root',
      'Beta',
      'Gamma',
    ]);
  });

  it('does not mutate the input', () => {
    const original = tree();
    bake({ root: original, excluded: new Set(['p0']), renamed: new Map() });
    expect(original.children).toHaveLength(3);
  });
});

describe('reparent', () => {
  it('moves a node under a new parent', () => {
    const moved = reparent({ root: tree(), ...NO_EDITS }, 'p1', 'p0')!;
    expect(moved.children.map((c) => c.title)).toEqual(['Alpha', 'Gamma']);
    expect(moved.children[0]!.children.map((c) => c.title)).toEqual([
      'Alpha One',
      'Alpha Two',
      'Beta',
    ]);
  });

  /**
   * The reason this module exists. A pending exclusion is keyed by position;
   * after a move that position belongs to a different node, so the exclusion
   * must be BAKED IN before the move, not carried across it.
   */
  it('bakes pending edits before moving, so no exclusion re-points', () => {
    const moved = reparent(
      {
        root: tree(),
        excluded: new Set(['p0-0']),
        renamed: new Map([['p1', 'Beta!']]),
      },
      'p1',
      'p0',
    )!;

    // "Alpha One" was excluded and is gone; the rename survived the move.
    const titles = [...walk(moved)].map((e) => e.node.title);
    expect(titles).not.toContain('Alpha One');
    expect(titles).toContain('Beta!');
  });

  it('refuses to move a node into its own subtree', () => {
    // Moving Alpha under Alpha One would detach both from the root.
    expect(reparent({ root: tree(), ...NO_EDITS }, 'p0', 'p0-0')).toBeNull();
  });

  it('refuses to move a node onto itself', () => {
    expect(reparent({ root: tree(), ...NO_EDITS }, 'p0', 'p0')).toBeNull();
  });

  it('refuses to move the root', () => {
    expect(reparent({ root: tree(), ...NO_EDITS }, 'root', 'p0')).toBeNull();
  });

  it('can move a node up to the root', () => {
    const moved = reparent({ root: tree(), ...NO_EDITS }, 'p0-0', 'root')!;
    expect(moved.children.map((c) => c.title)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
      'Alpha One',
    ]);
  });
});

describe('merge', () => {
  it('folds a node into the sibling above it', () => {
    const merged = merge({ root: tree(), ...NO_EDITS }, 'p2')!;
    expect(merged.children.map((c) => c.title)).toEqual(['Alpha', 'Beta & Gamma']);
  });

  it('keeps the children of both', () => {
    const merged = merge({ root: tree(), ...NO_EDITS }, 'p1')!;
    // Alpha absorbs Beta, so Alpha's two children remain.
    expect(merged.children[0]!.children.map((c) => c.title)).toEqual([
      'Alpha One',
      'Alpha Two',
    ]);
    expect(merged.children[0]!.title).toBe('Alpha & Beta');
  });

  it('joins the summaries', () => {
    const merged = merge({ root: tree(), ...NO_EDITS }, 'p2')!;
    expect(merged.children[1]!.summary).toBe('b g');
  });

  it('refuses to merge the first child, which has nothing above it', () => {
    expect(merge({ root: tree(), ...NO_EDITS }, 'p0')).toBeNull();
  });

  it('refuses to merge the root', () => {
    expect(merge({ root: tree(), ...NO_EDITS }, 'root')).toBeNull();
  });

  it('keeps the original title when the joined one would exceed the cap', () => {
    const long: StructuredNode = {
      title: 'Root',
      summary: '',
      children: [
        { title: 'x'.repeat(40), summary: '', children: [] },
        { title: 'y'.repeat(40), summary: '', children: [] },
      ],
    };
    const merged = merge(
      { root: long, excluded: new Set(), renamed: new Map() },
      'p1',
    )!;
    expect(merged.children[0]!.title).toBe('x'.repeat(40));
  });
});

describe('toDraft', () => {
  const options = {
    mapId: 'm_test',
    title: 'My map',
    sourceUrl: 'https://example.com/article',
  };

  it('produces a connected tree with one root', () => {
    const draft = toDraft(tree(), options);
    const nodes = Object.values(draft.nodes);
    const roots = nodes.filter((n) => n.parent_id === null);

    expect(roots).toHaveLength(1);
    expect(roots[0]!.id).toBe(draft.rootId);
    // Every non-root parent must exist, or the layout has an orphan.
    for (const node of nodes) {
      if (node.parent_id) expect(draft.nodes[node.parent_id]).toBeDefined();
    }
  });

  /**
   * §12 step 7: "Private by default is non-negotiable — the source may be
   * paywalled or personal."
   */
  it('is private, always', () => {
    expect(toDraft(tree(), options).visibility).toBe('private');
  });

  /** §12 step 8: "every node carries a source-link chip back to the origin URL". */
  it('puts the source URL on every node', () => {
    const draft = toDraft(tree(), options);
    for (const node of Object.values(draft.nodes)) {
      expect(node.href).toBe('https://example.com/article');
    }
    expect(draft.sourceUrl).toBe('https://example.com/article');
  });

  it('honours the depth control', () => {
    const deep = toDraft(tree(), { ...options, depth: 3 });
    const shallow = toDraft(tree(), { ...options, depth: 2 });

    // depth counts levels INCLUDING the root: 2 means root + one ring.
    expect(Object.keys(shallow.nodes)).toHaveLength(4); // root + 3
    expect(Object.keys(deep.nodes)).toHaveLength(6); // + Alpha's two children
  });

  it('agrees with countIncluded', () => {
    for (const depth of [2, 3]) {
      for (const excluded of [
        new Set<string>(),
        new Set(['p0']),
        new Set(['p0-0', 'p2']),
      ]) {
        const draft = toDraft(tree(), { ...options, depth, excluded });
        expect(Object.keys(draft.nodes)).toHaveLength(
          countIncluded(tree(), excluded, depth),
        );
      }
    }
  });

  it('closes the gap in a ring when a node is switched off', () => {
    const draft = toDraft(tree(), { ...options, excluded: new Set(['p1']) });
    const children = Object.values(draft.nodes)
      .filter((n) => n.parent_id === draft.rootId)
      .map((n) => n.slot)
      .sort((a, b) => a - b);

    // Slots must be contiguous from zero, or the ring has a hole in it.
    expect(children).toEqual([0, 1]);
  });

  it('applies renames', () => {
    const draft = toDraft(tree(), {
      ...options,
      renamed: new Map([
        ['root', 'New root'],
        ['p1', 'New beta'],
      ]),
    });
    const titles = Object.values(draft.nodes).map((n) => n.title);
    expect(titles).toContain('New root');
    expect(titles).toContain('New beta');
    expect(titles).not.toContain('Beta');
  });

  it('truncates titles to the node cap rather than storing an over-long one', () => {
    const long: StructuredNode = {
      title: 'z'.repeat(200),
      summary: '',
      children: [{ title: 'w'.repeat(200), summary: '', children: [] }],
    };
    for (const node of Object.values(toDraft(long, options).nodes)) {
      expect(node.title.length).toBeLessThanOrEqual(60);
    }
  });

  it('assigns every node a distinct id', () => {
    const draft = toDraft(tree(), options);
    const ids = Object.values(draft.nodes).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * An empty source URL is what the save route substitutes when the URL fails
   * the SSRF check — the map is still saved, just without a link out.
   */
  it('accepts an empty source URL without producing a broken href', () => {
    const draft = toDraft(tree(), { ...options, sourceUrl: '' });
    for (const node of Object.values(draft.nodes)) {
      expect(node.href).toBe('');
    }
  });
});

describe('pathId', () => {
  it('is stable and collision-free across shapes', () => {
    expect(pathId([])).toBe('root');
    expect(pathId([0])).toBe('p0');
    expect(pathId([0, 1])).toBe('p0-1');
    // p1-1 and p11 must not collide.
    expect(pathId([1, 1])).not.toBe(pathId([11]));
  });
});
