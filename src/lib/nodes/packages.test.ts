import { describe, expect, it } from 'vitest';
import {
  COMMERCE_TYPES,
  CRM_TYPES,
  PACKAGE_TYPES,
  PROJECT_TYPES,
} from './packages';
import {
  actionsFor,
  availableNodeTypes,
  nodeTypeDef,
  validatePayload,
} from './registry';
import { STAGES } from '@/lib/services/pipeline';

/**
 * Commerce, CRM and project management, as node-type packages.
 *
 * ── What is actually being tested ───────────────────────────────────────────
 *
 * The roadmap's claim is that these are "node-type packages, not separate
 * applications". The test of that is not that the file exists — it is that
 * nothing outside the registry had to change for them to work. So these tests
 * go through the ORDINARY registry functions, the same ones the editor, the
 * detail sheet and the public API use. If a package type needed special
 * handling anywhere, one of them would fail here.
 */

describe('the packages are registered', () => {
  it('registers every declared type', () => {
    for (const type of PACKAGE_TYPES) {
      expect(nodeTypeDef(type), `${type} is not registered`).toBeDefined();
    }
  });

  it('splits into three coherent packages', () => {
    expect([...COMMERCE_TYPES, ...CRM_TYPES, ...PROJECT_TYPES].sort()).toEqual(
      [...PACKAGE_TYPES].sort(),
    );
  });

  it('offers them all in the picker', () => {
    // `soon` would be the honest state for something unfinished. These work,
    // so they are available — a type nobody can create is decoration.
    const available = availableNodeTypes().map((definition) => definition.id);

    for (const type of PACKAGE_TYPES) {
      expect(available).toContain(type);
    }
  });

  it('gives each one a description worth reading in the picker', () => {
    for (const type of PACKAGE_TYPES) {
      expect(nodeTypeDef(type)!.description.length).toBeGreaterThan(15);
    }
  });

  it('finally gives the commerce family something to do', () => {
    /*
     * Part 8 of the audit lists as genuine debt: "the `commerce` family is a
     * colour with no functionality. The palette promises a capability that
     * does not exist." This is that capability arriving.
     */
    expect(COMMERCE_TYPES.length).toBeGreaterThanOrEqual(3);
    expect(nodeTypeDef('product')).toBeDefined();
    expect(nodeTypeDef('order')).toBeDefined();
  });
});

describe('money in a payload', () => {
  it('accepts whole cents', () => {
    expect(validatePayload('product', { priceCents: 1999 }).ok).toBe(true);
    expect(validatePayload('order', { totalCents: 0 }).ok).toBe(true);
  });

  it('rejects a fractional amount', () => {
    // A payload is JSON and JSON has one number type, so nothing stops a float
    // being stored except a schema that says integer.
    expect(validatePayload('product', { priceCents: 19.99 }).ok).toBe(false);
    expect(validatePayload('deal', { valueCents: 0.5 }).ok).toBe(false);
  });

  it('rejects a negative amount', () => {
    expect(validatePayload('product', { priceCents: -100 }).ok).toBe(false);
  });

  it('validates the amounts inside order items too', () => {
    expect(
      validatePayload('order', {
        items: [{ name: 'Widget', quantity: 2, unitCents: 500 }],
      }).ok,
    ).toBe(true);

    expect(
      validatePayload('order', {
        items: [{ name: 'Widget', quantity: 2, unitCents: 5.5 }],
      }).ok,
    ).toBe(false);
  });

  it('rejects an order item with no quantity', () => {
    expect(
      validatePayload('order', { items: [{ name: 'Widget', unitCents: 500 }] }).ok,
    ).toBe(false);
  });
});

describe('enumerated fields', () => {
  it('accepts a status the type knows', () => {
    expect(validatePayload('task', { status: 'doing' }).ok).toBe(true);
    expect(validatePayload('order', { status: 'shipped' }).ok).toBe(true);
    expect(validatePayload('milestone', { status: 'at-risk' }).ok).toBe(true);
  });

  it('rejects one it does not', () => {
    expect(validatePayload('task', { status: 'nearly' }).ok).toBe(false);
    expect(validatePayload('order', { status: 'lost-in-post' }).ok).toBe(false);
  });

  it('keeps deal stages identical to the services pipeline', () => {
    /*
     * `pipeline.ts` is server-only and this registry runs on both sides, so
     * the six stages are declared twice. Two vocabularies for one idea is a
     * real cost — this assertion is what makes the duplication safe, by
     * catching the drift rather than waiting for someone to notice it.
     */
    for (const stage of STAGES) {
      expect(
        validatePayload('deal', { stage }).ok,
        `the deal node type does not know the pipeline stage "${stage}"`,
      ).toBe(true);
    }

    expect(validatePayload('deal', { stage: 'negotiating' }).ok).toBe(false);
  });

  it('keeps a probability a percentage', () => {
    expect(validatePayload('deal', { probability: 60 }).ok).toBe(true);
    expect(validatePayload('deal', { probability: 0.6 }).ok).toBe(false);
    expect(validatePayload('deal', { probability: 140 }).ok).toBe(false);
  });
});

describe('payload compatibility', () => {
  it('keeps a key no schema knows about', () => {
    // Passthrough. A stored payload may carry keys written before the schema,
    // and strict validation would delete a user's data on the next save.
    const result = validatePayload('task', {
      status: 'todo',
      legacyPriorityScore: 7,
    });

    expect(result.ok).toBe(true);
    expect(result.value?.legacyPriorityScore).toBe(7);
  });

  it('distinguishes "no stock tracked" from "none in stock"', () => {
    // Absent and zero mean different things. Collapsing them would make every
    // untracked product read as out of stock.
    expect(validatePayload('product', {}).value?.stock).toBeUndefined();
    expect(validatePayload('product', { stock: 0 }).value?.stock).toBe(0);
  });
});

describe('actions', () => {
  const viewer = { view: true, editNodes: false, comment: false };
  const editor = { view: true, editNodes: true, comment: true };

  it('never offers a mutating action to a viewer', () => {
    for (const type of PACKAGE_TYPES) {
      const offered = actionsFor(type, viewer);

      expect(
        offered.every((action) => !action.mutates),
        `${type} offers a viewer something that mutates`,
      ).toBe(true);
    }
  });

  it('gives a deal its own verb for moving stage', () => {
    // Burying the operation people actually perform inside "edit" is what
    // makes a CRM go unused.
    const ids = actionsFor('deal', editor).map((action) => action.id);

    expect(ids).toContain('advance');
  });

  it('gives a task a one-tap complete', () => {
    expect(actionsFor('task', editor).map((action) => action.id)).toContain(
      'complete',
    );
  });

  it('hides those verbs from a viewer', () => {
    expect(actionsFor('deal', viewer).map((action) => action.id)).not.toContain(
      'advance',
    );
    expect(actionsFor('task', viewer).map((action) => action.id)).not.toContain(
      'complete',
    );
  });
});
