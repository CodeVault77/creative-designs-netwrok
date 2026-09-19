import { z } from 'zod';
import type { NodeType } from '@/lib/map/types';
import type { IconName } from '@/lib/map/icons';
import {
  allNodeTypes,
  defineNodeType,
  nodeTypeDef,
  type NodeAction,
  type NodeTypeDefinition,
} from './define';
import { registerPackages } from './packages';

/*
 * Re-exported so every existing import of `@/lib/nodes/registry` keeps
 * working. `define.ts` exists to break an import cycle, not to become a second
 * public entry point — the registry is still the thing you import.
 */
export {
  allNodeTypes,
  defineNodeType,
  nodeTypeDef,
  type NodeAction,
  type NodeTypeDefinition,
};

/**
 * The node type registry.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * Everything a node type "is" was scattered. The union lived in
 * `map/types.ts`, which types were offered lived in `editor/types.ts`, the
 * human label lived in a `TYPE_LABELS` map inside `MetaList.tsx`, and the
 * `payload` column was typed `Record<string, unknown>` and validated nowhere.
 * Adding a ninth type meant finding all four and remembering the fifth.
 *
 * More importantly it did not scale. The platform vision needs nodes that ARE
 * agents, workflows, applications and services — "hundreds of future node
 * capabilities" — and each of those would have been another edit to a union
 * that every renderer switches on.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 *
 * One definition per type, in one place, declaring everything the rest of the
 * system needs to know: its label, its icon, whether it is offered yet, the
 * shape of its payload, and what it can DO. Core code asks the registry; it
 * never switches on a literal.
 *
 * ── Why the union still exists ──────────────────────────────────────────────
 *
 * `NodeType` remains a union because 30 tables and a database's worth of rows
 * already use those strings, and TypeScript's exhaustiveness checking is worth
 * keeping for the built-in set. `defineNodeType` accepts any string, so an
 * extension is not blocked by it — the union is the *known* set, not the
 * *possible* set.
 */

/** Every node can be looked at. Declared once rather than repeated eight times. */
const OPEN_ACTION: NodeAction = {
  id: 'open',
  label: 'Open',
  requires: 'view',
  mutates: false,
};

const EDIT_ACTION: NodeAction = {
  id: 'edit',
  label: 'Edit',
  requires: 'editNodes',
  mutates: true,
};

/**
 * For types that declare no payload shape of their own.
 *
 * ── Why every schema here is `passthrough`, not `strict` ────────────────────
 *
 * Strict schemas looked right and were wrong. `map_nodes.payload` has been a
 * free-form column since the first migration, so rows already carry keys no
 * schema written today knows about — a `link` node with a `note` on it, for
 * instance. Under `strict` that payload fails validation and is DESTROYED on
 * the next save.
 *
 * Validation is worth having, but not at the price of deleting a user's data
 * because a key predates its schema. `passthrough` keeps the value that
 * matters — a `url` that is not a URL is still rejected — while preserving
 * anything it does not recognise.
 */
const NO_PAYLOAD = z.object({}).passthrough();

// ---------------------------------------------------------------- built-ins

defineNodeType({
  id: 'topic',
  label: 'topic',
  description: 'An idea, a heading, a place to hang other things.',
  icon: 'note',
  availability: 'available',
  payload: NO_PAYLOAD,
  actions: [OPEN_ACTION, EDIT_ACTION],
});

defineNodeType({
  id: 'link',
  label: 'link',
  description: 'Points somewhere on the web.',
  icon: 'link',
  availability: 'available',
  payload: z
    .object({
      url: z.string().url().optional(),
      /** Where the link was captured from, when it came via ingest. */
      source: z.string().max(200).optional(),
    })
    .passthrough(),
  actions: [
    OPEN_ACTION,
    EDIT_ACTION,
    {
      id: 'visit',
      label: 'Visit',
      requires: 'view',
      mutates: false,
    },
  ],
});

defineNodeType({
  id: 'note',
  label: 'note',
  description: 'Text you wrote yourself.',
  icon: 'note',
  availability: 'available',
  payload: z.object({ body: z.string().max(10_000).optional() }).passthrough(),
  actions: [OPEN_ACTION, EDIT_ACTION],
});

defineNodeType({
  id: 'image',
  label: 'image',
  description: 'A picture, with the text that describes it.',
  icon: 'file',
  availability: 'available',
  payload: z
    .object({
      url: z.string().url().optional(),
      /*
       * Not optional in spirit: an image without a description is invisible to
       * anyone using a screen reader. It is optional in the SCHEMA only so an
       * older row does not fail validation — new ones are prompted for it in
       * the editor.
       */
      alt: z.string().max(500).optional(),
    })
    .passthrough(),
  actions: [OPEN_ACTION, EDIT_ACTION],
});

defineNodeType({
  id: 'date',
  label: 'date',
  description: 'A moment or a deadline.',
  icon: 'cal',
  availability: 'available',
  payload: z
    .object({
      /** ISO 8601. Stored as text, like every other timestamp here. */
      at: z.string().max(40).optional(),
      allDay: z.boolean().optional(),
    })
    .passthrough(),
  actions: [OPEN_ACTION, EDIT_ACTION],
});

defineNodeType({
  id: 'service',
  label: 'service',
  description: 'Something the studio offers.',
  icon: 'bag',
  availability: 'soon',
  payload: z.object({ slug: z.string().max(80).optional() }).passthrough(),
  actions: [OPEN_ACTION],
});

defineNodeType({
  id: 'page',
  label: 'page',
  description: 'A destination inside the product.',
  icon: 'grid',
  availability: 'soon',
  payload: z.object({ route: z.string().max(200).optional() }).passthrough(),
  actions: [OPEN_ACTION],
});

defineNodeType({
  id: 'cluster',
  label: 'group',
  description: 'Several nodes folded into one because the ring is full.',
  icon: 'grid',
  /*
   * Internal: a cluster is synthesised by the layout when ring one exceeds its
   * budget. It is not something a person creates, so it must never appear in
   * the picker — but it IS a stored type the detail sheet has to be able to
   * label, which is why it is registered rather than special-cased.
   */
  availability: 'internal',
  payload: NO_PAYLOAD,
  actions: [],
});

// ------------------------------------------------------------------ lookups

/** Types a person may create, in registration order. */
export function availableNodeTypes(): NodeTypeDefinition[] {
  return allNodeTypes().filter((d) => d.availability === 'available');
}

/** Types shown in the picker but disabled (§14). */
export function soonNodeTypes(): NodeTypeDefinition[] {
  return allNodeTypes().filter((d) => d.availability === 'soon');
}

export function isCreatableType(type: string): boolean {
  return nodeTypeDef(type)?.availability === 'available';
}

/**
 * The label for a stored type.
 *
 * Falls back to the raw value so an unknown type reads as itself rather than as
 * "undefined" — the row exists, and refusing to name it helps nobody.
 */
export function labelFor(type: string): string {
  return nodeTypeDef(type)?.label ?? type;
}

/** The glyph to draw when a node carries no `icon` of its own. */
export function defaultIconFor(type: string): IconName | undefined {
  return nodeTypeDef(type)?.icon;
}

// ---------------------------------------------------------------- behaviour

export interface PayloadResult {
  ok: boolean;
  /** The parsed payload, present only when `ok`. */
  value?: Record<string, unknown>;
  error?: string;
}

/**
 * Validate a payload against the type that owns it.
 *
 * An UNKNOWN type passes with its payload untouched. That is deliberate: the
 * alternative is that a newer deployment writing a type this one does not know
 * makes every one of its rows unreadable here. Rejecting unknown payloads
 * would turn a rolling deploy into an outage.
 */
export function validatePayload(type: string, payload: unknown): PayloadResult {
  const definition = nodeTypeDef(type);
  if (!definition) {
    return {
      ok: true,
      value:
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {},
    };
  }

  const parsed = definition.payload.safeParse(payload ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `${issue.path.join('.') || 'payload'}: ${issue.message}`
        : 'Invalid payload',
    };
  }

  return { ok: true, value: parsed.data as Record<string, unknown> };
}

/**
 * The actions a type offers, filtered by what the actor may do.
 *
 * One place decides whether a button is offered, so a viewer on a public map
 * cannot be shown an action they will be refused when they press it — and, more
 * importantly, a new action cannot accidentally default to being visible to
 * everyone.
 */
export function actionsFor(
  type: string,
  capabilities: { view: boolean; editNodes: boolean; comment: boolean },
): NodeAction[] {
  const definition = nodeTypeDef(type);
  if (!definition) return [];

  return definition.actions.filter((action) => capabilities[action.requires]);
}

/**
 * Every registered id, for tests and for the type picker.
 *
 * Typed as `NodeType[]` where the ids are built-ins; an extension's id is a
 * plain string and is still returned.
 */
export function registeredTypeIds(): string[] {
  return allNodeTypes().map((d) => d.id);
}

/** Narrow a stored string to the built-in union, when it is one. */
export function isBuiltInType(type: string): type is NodeType {
  const definition = nodeTypeDef(type);
  return definition !== undefined;
}

/*
 * The commerce, CRM and project-management packages.
 *
 * Called HERE, at the bottom of the module, rather than left to whoever
 * happens to import the registry first. A node type that exists only if some
 * unrelated file was loaded is a type that renders in one process and not in
 * another — and the symptom is a node showing its raw type string on a map,
 * which nobody would trace back to an import.
 *
 * The call sits after every definition above it because `definitions` is only
 * initialised once module evaluation reaches it.
 */
registerPackages();
