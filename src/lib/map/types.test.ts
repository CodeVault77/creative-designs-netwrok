import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from './types';
import { PACKAGE_TYPES } from '@/lib/nodes/packages';
import { allNodeTypes } from '@/lib/nodes/registry';

/**
 * The drift guard `NODE_TYPES`'s own comment promises.
 *
 * `packages.test.ts` proves the registry knows about every package type. It
 * cannot prove anything about THIS file, because it never imports it — which
 * is exactly how `product`, `order`, `invoice`, `contact`, `deal`, `task` and
 * `milestone` passed every registry test while being invisible to the type
 * picker and rejected by the save route's validator. Both of those trust
 * `NodeType`, not the registry, so this is the one place that has to check
 * the two agree.
 */

describe('NODE_TYPES', () => {
  it('has no duplicate entries', () => {
    expect(new Set(NODE_TYPES).size).toBe(NODE_TYPES.length);
  });

  it('includes every package type', () => {
    for (const type of PACKAGE_TYPES) {
      expect(
        NODE_TYPES as readonly string[],
        `${type} is registered in packages.ts but missing from NODE_TYPES`,
      ).toContain(type);
    }
  });

  it('includes every id the registry has ever defined', () => {
    // The general form of the check above. A ninth node type registered next
    // year and forgotten here fails this test on the first run, rather than
    // shipping a picker tile with no label the way the first seven did.
    for (const definition of allNodeTypes()) {
      expect(
        NODE_TYPES as readonly string[],
        `${definition.id} is registered but missing from NODE_TYPES`,
      ).toContain(definition.id);
    }
  });
});
