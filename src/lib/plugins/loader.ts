import { defineNodeType } from '@/lib/nodes/define';
import type { IconName } from '@/lib/map/icons';
import { iconPathsFor } from '@/lib/map/icons';
import { namespacedType, payloadSchemaFor, type PluginManifest } from './manifest';

/**
 * Registering a plugin's declarative contributions.
 *
 * "Loading" here means READING DATA AND BUILDING OBJECTS FROM IT. No module is
 * imported, no string is evaluated, and nothing the plugin wrote runs. The word
 * is used because it is what the operation is called; the thing it usually
 * means is precisely what `manifest.ts` explains we do not do.
 *
 * ── What a registered plugin type can and cannot reach ──────────────────────
 *
 * It is a label, a glyph chosen from our own set, and a payload schema we
 * compiled. Specifically a plugin cannot:
 *
 *   - shadow a built-in type, or another plugin's — every id is namespaced;
 *   - name a verb the platform would then execute — the action list is fixed
 *     here, not taken from the manifest;
 *   - render anything — no markup, no SVG, no styles cross this boundary;
 *   - see anything — registration reads the manifest and returns nothing to it.
 *
 * ── Idempotent, and safe on every boot ──────────────────────────────────────
 *
 * `defineNodeType` replaces by id, so loading twice registers once. That
 * matters because Next.js evaluates a module more than once across dev reloads
 * and route workers.
 */

/** Separates a plugin's namespace from its type id. */
export const PLUGIN_TYPE_SEPARATOR = '.';

/** Drawn when a manifest names a glyph this deployment does not have. */
export const FALLBACK_ICON: IconName = 'grid';

/**
 * The fixed action list every plugin type gets.
 *
 * Read and edit, and nothing else — not taken from the manifest at all. An
 * action is EXECUTED by our own route code, so a manifest-supplied verb would
 * be a stranger naming something the platform then runs. There is no version
 * of that which is safe enough to be worth the feature.
 */
const PLUGIN_ACTIONS = [
  { id: 'open', label: 'Open', requires: 'view', mutates: false },
  { id: 'edit', label: 'Edit', requires: 'editNodes', mutates: true },
] as const;

export interface LoadResult {
  registered: string[];
}

/**
 * Register one plugin's node types.
 *
 * Returns the namespaced ids so a caller can report what a plugin contributed
 * — which is what an author needs to see after publishing, and what a reviewer
 * needs to see before approving.
 */
export function loadPlugin(slug: string, manifest: PluginManifest): LoadResult {
  const registered: string[] = [];

  for (const type of manifest.nodeTypes) {
    const id = namespacedType(slug, type.id);

    /*
     * An unknown glyph FALLS BACK rather than failing the load.
     *
     * A manifest naming an icon we have since renamed would otherwise take a
     * whole plugin's types out of the registry — and the symptom is a node
     * rendering its raw type string on someone's map, which nobody traces back
     * to a renamed glyph. A recognisable wrong icon is a far smaller problem.
     */
    const icon: IconName =
      iconPathsFor(type.icon).length > 0 ? (type.icon as IconName) : FALLBACK_ICON;

    defineNodeType({
      id,
      label: type.label,
      description: type.description,
      icon,
      /*
       * `available`, so the type appears in the picker. WHETHER a given person
       * sees it is answered from their installations by the caller: the
       * registry is process-wide and shared by every request, so it cannot
       * hold a per-user answer.
       */
      availability: 'available',
      payload: payloadSchemaFor(type),
      actions: [...PLUGIN_ACTIONS],
    });

    registered.push(id);
  }

  return { registered };
}

/** Whether a stored type id was contributed by a plugin. */
export function isPluginType(typeId: string): boolean {
  return typeId.includes(PLUGIN_TYPE_SEPARATOR);
}

/** The plugin slug that owns a type id, or null for a built-in. */
export function pluginSlugOf(typeId: string): string | null {
  const index = typeId.indexOf(PLUGIN_TYPE_SEPARATOR);
  return index > 0 ? typeId.slice(0, index) : null;
}

export { namespacedType };
