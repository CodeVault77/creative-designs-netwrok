import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  actionsFor,
  allNodeTypes,
  availableNodeTypes,
  defineNodeType,
  isCreatableType,
  labelFor,
  nodeTypeDef,
  soonNodeTypes,
  validatePayload,
} from './registry';
import { MVP_NODE_TYPES, SOON_NODE_TYPES, isMvpType } from '@/lib/editor/types';

/**
 * The node type registry.
 *
 * The test that matters most is the last one: a new type must be addable in one
 * file with no core edits. That is the whole reason this module exists — the
 * previous arrangement scattered a type's facts across a union, two lists and a
 * label map, and would not have scaled to the "hundreds of node capabilities"
 * the platform needs.
 */

/**
 * The eight types this module was written with. Named explicitly because the
 * registry no longer holds only these: Phase 7 registered the commerce, CRM
 * and project-management packages through the same public `defineNodeType`,
 * which is the whole claim those packages make. Asserting a total count here
 * would break every time an extension was added and would say nothing about
 * the core set — so these tests name what they mean instead.
 */
const CORE_TYPES = [
  'topic',
  'link',
  'note',
  'image',
  'date',
  'service',
  'page',
  'cluster',
];

describe('built-in types', () => {
  it('registers all eight core types', () => {
    const registered = allNodeTypes().map((d) => d.id);

    for (const type of CORE_TYPES) {
      expect(registered, `${type} is missing`).toContain(type);
    }
  });

  it('separates what can be created from what is only shown', () => {
    const available = availableNodeTypes().map((d) => d.id);
    const soon = soonNodeTypes().map((d) => d.id);

    // The core five come first, in registration order, ahead of anything a
    // package or an extension adds later.
    expect(available.slice(0, 5)).toEqual([
      'topic',
      'link',
      'note',
      'image',
      'date',
    ]);
    // §14: visible but disabled, so the ambition shows without promising.
    expect(soon).toEqual(['service', 'page']);
  });

  /**
   * `cluster` is synthesised by the layout when ring one exceeds its budget.
   * It must never appear in a picker, but it IS a stored type the detail sheet
   * has to label — which is why it is registered as `internal` rather than
   * special-cased somewhere.
   */
  it('keeps cluster out of the picker but still labels it', () => {
    expect(isCreatableType('cluster')).toBe(false);
    expect(availableNodeTypes().map((d) => d.id)).not.toContain('cluster');
    expect(soonNodeTypes().map((d) => d.id)).not.toContain('cluster');
    expect(labelFor('cluster')).toBe('group');
  });

  it('names an unregistered type as itself rather than as undefined', () => {
    // The row exists; refusing to name it helps nobody.
    expect(labelFor('some_future_type')).toBe('some_future_type');
    expect(nodeTypeDef('some_future_type')).toBeUndefined();
  });
});

describe('the editor lists derive from the registry', () => {
  /**
   * These were three hand-maintained lists that had to agree with a union and a
   * label map. They now read from one source, so this asserts they cannot drift
   * rather than asserting their contents twice.
   */
  it('matches the registry exactly', () => {
    expect([...MVP_NODE_TYPES]).toEqual(availableNodeTypes().map((d) => d.id));
    expect([...SOON_NODE_TYPES]).toEqual(soonNodeTypes().map((d) => d.id));
  });

  it('agrees about what is creatable', () => {
    for (const type of MVP_NODE_TYPES) expect(isMvpType(type)).toBe(true);
    for (const type of SOON_NODE_TYPES) expect(isMvpType(type)).toBe(false);
  });
});

describe('payload validation', () => {
  it('accepts a payload that matches its type', () => {
    const result = validatePayload('link', { url: 'https://example.com' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ url: 'https://example.com' });
  });

  it('rejects one that does not', () => {
    const result = validatePayload('link', { url: 'not-a-url' });
    expect(result.ok).toBe(false);
    // Names the field, so the message is actionable rather than "invalid".
    expect(result.error).toContain('url');
  });

  /**
   * Unknown keys are PRESERVED, not rejected.
   *
   * `map_nodes.payload` has been free-form since the first migration, so rows
   * already carry keys no schema knows about. Rejecting them would destroy a
   * user's data on the next save — a validation rule turning into data loss.
   * The value that remains is real: a declared field with the wrong type is
   * still caught.
   */
  it('keeps keys it does not recognise', () => {
    const result = validatePayload('note', { body: 'hi', legacyKey: 'kept' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ body: 'hi', legacyKey: 'kept' });
  });

  it('treats a missing payload as an empty one', () => {
    expect(validatePayload('topic', undefined).ok).toBe(true);
    expect(validatePayload('topic', null).ok).toBe(true);
  });

  /**
   * An unknown type PASSES. The alternative is that a newer deployment writing
   * a type this one does not know makes every one of its rows unreadable —
   * which turns a rolling deploy into an outage.
   */
  it('passes through the payload of an unknown type', () => {
    const result = validatePayload('from_the_future', { anything: true });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ anything: true });
  });
});

describe('actions', () => {
  const ALL = { view: true, editNodes: true, comment: true };
  const READ_ONLY = { view: true, editNodes: false, comment: false };

  it('offers what the type declares', () => {
    expect(actionsFor('link', ALL).map((a) => a.id)).toEqual([
      'open',
      'edit',
      'visit',
    ]);
  });

  /**
   * One place decides whether a button is offered, so a viewer is never shown
   * an action they will be refused when they press it.
   */
  it('hides actions the actor lacks the capability for', () => {
    const ids = actionsFor('link', READ_ONLY).map((a) => a.id);
    expect(ids).toEqual(['open', 'visit']);
    expect(ids).not.toContain('edit');
  });

  it('marks which actions change something', () => {
    const edit = actionsFor('note', ALL).find((a) => a.id === 'edit');
    const open = actionsFor('note', ALL).find((a) => a.id === 'open');

    // Explicit, so a new action cannot quietly become the first destructive
    // thing on a viewer's screen.
    expect(edit?.mutates).toBe(true);
    expect(open?.mutates).toBe(false);
  });

  it('returns nothing for an unknown type', () => {
    expect(actionsFor('unknown', ALL)).toEqual([]);
  });
});

describe('extensibility', () => {
  /**
   * The definition of done for this phase.
   *
   * A new type is one call: no union edit, no picker edit, no label map, no
   * renderer change. Everything below is what the rest of the system reads.
   */
  it('adds a new type in one call, with no core edits', () => {
    defineNodeType({
      id: 'agent',
      label: 'agent',
      description: 'Runs work on your behalf.',
      icon: 'spark',
      availability: 'available',
      payload: z
        .object({ model: z.string(), temperature: z.number().optional() })
        .strict(),
      actions: [
        { id: 'open', label: 'Open', requires: 'view', mutates: false },
        { id: 'run', label: 'Run', requires: 'editNodes', mutates: true },
      ],
    });

    // Labelled.
    expect(labelFor('agent')).toBe('agent');
    // Offered in the picker.
    expect(isCreatableType('agent')).toBe(true);
    expect(availableNodeTypes().map((d) => d.id)).toContain('agent');
    // Its payload is validated.
    expect(validatePayload('agent', { model: 'x' }).ok).toBe(true);
    expect(validatePayload('agent', { model: 42 }).ok).toBe(false);
    // Its actions are permission-filtered like any other.
    expect(
      actionsFor('agent', { view: true, editNodes: false, comment: false }).map(
        (a) => a.id,
      ),
    ).toEqual(['open']);
  });
});
