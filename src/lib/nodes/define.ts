import type { z } from 'zod';
import type { IconName } from '@/lib/map/icons';

/**
 * The registry's core: the definition type, the store, and the way in.
 *
 * ── Why this is not inside registry.ts ──────────────────────────────────────
 *
 * It used to be. `registry.ts` declares the built-in types and then loads the
 * commerce, CRM and project-management packages, and `packages.ts` needs
 * `defineNodeType` — so the two imported each other. ES modules hoist imports,
 * so whichever file was entered first ran the other to completion before its
 * own top-level bindings existed, and the symptom depended on which test
 * imported which module first: a temporal-dead-zone crash one way,
 * `registerPackages is not a function` the other.
 *
 * A cycle whose behaviour depends on entry order is not a cycle to be careful
 * with; it is one to remove. Now both files depend on THIS one and neither
 * depends on the other:
 *
 *     define.ts  ←  registry.ts  →  packages.ts  →  define.ts
 *
 * There is no path back into `registry.ts`, so there is no order in which
 * anything can observe it half-built.
 */

/**
 * What a node can do, declared rather than hardcoded.
 *
 * The vision calls for nodes that trigger actions, expose permissions and gain
 * capabilities from external APIs. An action is the unit of that: a verb, what
 * it needs, and who may do it. This describes the action; running it belongs to
 * the caller (a route, an agent, a workflow step), because a registry that also
 * executed would need the database, the session and the network.
 */
export interface NodeAction {
  /** Stable identifier, e.g. `open`, `run`, `sync`. */
  id: string;
  /** What a person sees on the button. */
  label: string;
  /**
   * The capability the actor needs on the node's map.
   *
   * Deliberately reuses the existing `Capabilities` keys from
   * `lib/sharing/roles` rather than inventing a parallel permission
   * vocabulary — two permission systems that must agree eventually will not.
   */
  requires: 'view' | 'editNodes' | 'comment';
  /**
   * Whether the action changes anything.
   *
   * A read-only action is safe to offer on a public map to a signed-out
   * visitor; a mutating one is not. Making this explicit means a new action
   * cannot quietly become the first destructive thing on a viewer's screen.
   */
  mutates: boolean;
}

export interface NodeTypeDefinition<TPayload = unknown> {
  /** The stored `map_nodes.type` value. */
  id: string;
  /** Human label, lower case — used in the detail sheet's meta table. */
  label: string;
  /** One line explaining what this type is for, shown in the type picker. */
  description: string;
  /** Default glyph when a node carries no `icon` of its own. */
  icon: IconName;
  /**
   * Whether the type can be created today.
   *
   * `available` appears in the picker and can be chosen. `soon` appears
   * disabled — §14 wants the ambition visible without it becoming a promise.
   * `internal` never appears: `cluster` is synthesised by the layout and is not
   * something a person makes.
   */
  availability: 'available' | 'soon' | 'internal';
  /**
   * Shape of `map_nodes.payload` for this type.
   *
   * The column has been free-form since the first migration, described in its
   * own comment as "a forward-compatible slot for the eventual behaviour
   * engine". This is that engine's half of the bargain: a payload is validated
   * against the type that owns it, so a malformed one is rejected at the
   * boundary instead of crashing a renderer three screens later.
   */
  payload: z.ZodType<TPayload>;
  /** What this type can do. */
  actions: readonly NodeAction[];
}

const definitions = new Map<string, NodeTypeDefinition>();

/**
 * Register a node type.
 *
 * This is the extension point the vision needs: a new type is one call in one
 * file, with no edit to the renderer, the picker, the detail sheet or any
 * union. Re-registering an id replaces it, so a deployment can override a
 * built-in without patching this file.
 */
export function defineNodeType<TPayload>(
  definition: NodeTypeDefinition<TPayload>,
): void {
  definitions.set(definition.id, definition as NodeTypeDefinition);
}

/**
 * A type's definition, or undefined.
 *
 * Returns undefined rather than throwing or substituting a default. A row whose
 * type is unknown — written by a newer deployment, or by an extension that is
 * no longer loaded — must still be readable; callers decide what to show, and
 * `labelFor` degrades to the raw string.
 */
export function nodeTypeDef(type: string): NodeTypeDefinition | undefined {
  return definitions.get(type);
}

export function allNodeTypes(): NodeTypeDefinition[] {
  return [...definitions.values()];
}
