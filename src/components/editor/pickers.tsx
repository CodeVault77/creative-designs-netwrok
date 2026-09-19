'use client';

import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';
import { MVP_NODE_TYPES, SOON_NODE_TYPES } from '@/lib/editor/types';
import { tokens, type FamilyName } from '@/lib/styles/tokens.generated';
import type { NodeType } from '@/lib/map/types';
import { icons, ICON_VIEWBOX, type IconName } from '@/lib/map/icons';

/**
 * TypePicker, ColorFamilyPicker, IconPicker.
 *
 * Grouped in one file because they are the same control with three datasets —
 * a labelled grid of single-select options. Three near-identical files would
 * be the same sprawl §20 warns about on the sheet side.
 */

const Group = styled.fieldset`
  border: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const Legend = styled.legend`
  padding: 0;
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  color: var(--ground-muted);
`;

const Grid = styled.div<{ $columns: number }>`
  display: grid;
  grid-template-columns: repeat(${({ $columns }) => $columns}, minmax(0, 1fr));
  gap: var(--space-2);
`;

const Option = styled.button<{ $selected: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;

  min-height: 56px;
  padding: var(--space-2);

  background: ${({ $selected }) => ($selected ? 'rgba(255,255,255,0.05)' : 'transparent')};
  border: 1px solid
    ${({ theme, $selected }) =>
      $selected
        ? theme.tokens.familyRamp[theme.family].core
        : 'var(--ground-border)'};
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  font: inherit;
  font-size: var(--text-caption);
  cursor: pointer;

  ${transition('selection', 'background-color', 'border-color')}

  &:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SoonTag = styled.span`
  position: absolute;
  top: 2px;
  right: 2px;
  font-family: var(--face-mono);
  font-size: 8px;
  letter-spacing: 0.08em;
  color: var(--fam-services-core);
  border: 1px solid var(--fam-services-core);
  border-radius: 3px;
  padding: 0 3px;
`;

// ------------------------------------------------------------------ TypePicker

/**
 * Labels and glyphs for `lib/nodes/packages.ts`'s seven types.
 *
 * Hand-written rather than pulled from `nodeTypeDef(type)!.label`, even
 * though the registry already carries one. Two reasons: `TYPE_LABELS` wants
 * Title Case for a picker tile ("Product") where the registry's `label` is
 * lower case for a sentence ("this node is a product") — same string, wrong
 * case for this spot — and the glyphs are a closed unicode set that has
 * nothing in the registry to derive from (its `icon` field names an SVG path
 * in `map/icons.ts`, which this lightweight grid does not render). Committing
 * to hand-written entries is exactly what let these drift out of sync with
 * the registry for a full phase — `map/types.test.ts` is what stops that
 * happening silently again: it fails the moment a type in `NODE_TYPES` has no
 * matching key here, because `Record<NodeType, string>` below cannot compile
 * with one missing.
 */
const TYPE_LABELS: Record<NodeType, string> = {
  topic: 'Topic',
  link: 'Link',
  note: 'Note',
  image: 'Image',
  date: 'Date',
  service: 'Service',
  page: 'Page',
  cluster: 'Group',
  product: 'Product',
  order: 'Order',
  invoice: 'Invoice',
  contact: 'Contact',
  deal: 'Deal',
  task: 'Task',
  milestone: 'Milestone',
};

const TYPE_GLYPHS: Record<NodeType, string> = {
  topic: '◎',
  link: '↗',
  note: '▤',
  image: '▣',
  date: '▦',
  service: '◈',
  page: '▥',
  cluster: '⊕',
  product: '◆',
  order: '▧',
  invoice: '▨',
  contact: '◐',
  deal: '✧',
  task: '☐',
  milestone: '⬦',
};

/**
 * §14: "MVP: topic, link, note, image, date. Everything else in the picker is
 * badged Soon — this is where the 'limitless node' vision lands honestly."
 *
 * Showing the unbuilt types communicates the ambition; badging and disabling
 * them stops it being a promise. The same bargain as the dark ring-one nodes
 * in ADR-0001.
 */
export function TypePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: NodeType;
  onChange: (type: NodeType) => void;
  disabled?: boolean;
}) {
  return (
    <Group>
      <Legend>Type</Legend>
      <Grid $columns={5}>
        {MVP_NODE_TYPES.map((type) => (
          <Option
            key={type}
            type="button"
            $selected={value === type}
            onClick={() => onChange(type)}
            disabled={disabled}
            aria-pressed={value === type}
          >
            <span aria-hidden="true" style={{ fontSize: 16 }}>
              {TYPE_GLYPHS[type]}
            </span>
            {TYPE_LABELS[type]}
          </Option>
        ))}

        {SOON_NODE_TYPES.map((type) => (
          <Option
            key={type}
            type="button"
            $selected={false}
            disabled
            title={`${TYPE_LABELS[type]} nodes are coming soon`}
          >
            <SoonTag>SOON</SoonTag>
            <span aria-hidden="true" style={{ fontSize: 16 }}>
              {TYPE_GLYPHS[type]}
            </span>
            {TYPE_LABELS[type]}
          </Option>
        ))}
      </Grid>
    </Group>
  );
}

// ----------------------------------------------------------- ColorFamilyPicker

const Swatch = styled.span<{ $family: FamilyName }>`
  width: 20px;
  height: 20px;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].wash};
  border: 2px solid ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  box-shadow: ${({ theme, $family }) => theme.tokens.glow[$family][1]};
`;

const FAMILY_LABELS: Record<FamilyName, string> = {
  create: 'Create',
  discover: 'Discover',
  services: 'Services',
  people: 'People',
  organise: 'Organise',
  commerce: 'Commerce',
};

export function ColorFamilyPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: FamilyName;
  onChange: (family: FamilyName) => void;
  disabled?: boolean;
}) {
  const families = Object.keys(tokens.color.family) as FamilyName[];

  return (
    <Group>
      <Legend>Colour</Legend>
      <Grid $columns={6}>
        {families.map((family) => (
          <Option
            key={family}
            type="button"
            $selected={value === family}
            onClick={() => onChange(family)}
            disabled={disabled}
            aria-pressed={value === family}
            // The swatch is the visible label, so the accessible name has to
            // carry the family name in words.
            aria-label={FAMILY_LABELS[family]}
            title={FAMILY_LABELS[family]}
          >
            <Swatch $family={family} aria-hidden="true" />
          </Option>
        ))}
      </Grid>
    </Group>
  );
}

// ------------------------------------------------------------------ IconPicker

/**
 * The real icon set — `map/icons.ts`, the same names the canvas renderer
 * draws.
 *
 * This used to be sixteen plain unicode characters (★, ✦, ▲…) with no
 * relationship to that set at all. A node could be given `icon: '★'`, the
 * save would succeed, and the map would draw NOTHING for it: the renderer's
 * `iconPathsFor` only recognises the named keys below, an unrecognised name
 * returns no paths by design (see that file's own comment — a wrong icon is
 * worse than no icon), and there is no character in that old list that
 * happens to match a real key. Every icon anyone had ever picked through
 * this control was silently invisible on the actual map.
 *
 * `Object.keys(icons)` rather than a second hand-typed list, for the reason
 * this file keeps relearning: a name added to `icons.ts` and not to a copy
 * here is exactly how that happened in the first place.
 */
const ICON_NAMES = Object.keys(icons) as IconName[];

/**
 * Display names for the picker. `Record<IconName, string>` rather than a
 * `.map(capitalise)` — TypeScript refuses to compile this object literal if
 * `icons.ts` ever gains a key with no matching label here, which is the
 * property that stopped the label and glyph maps in `TYPE_LABELS` above from
 * drifting after `packages.ts` shipped.
 */
const ICON_LABELS: Record<IconName, string> = {
  map: 'Map',
  link: 'Link',
  eye: 'Eye',
  code: 'Code',
  layers: 'Layers',
  users: 'People',
  bag: 'Bag',
  spark: 'Spark',
  bulb: 'Idea',
  cal: 'Calendar',
  card: 'Card',
  heart: 'Heart',
  file: 'File',
  note: 'Note',
  search: 'Search',
  grid: 'Grid',
  user: 'Person',
  connect: 'Connect',
  chat: 'Chat',
};

/**
 * One icon's paths, drawn small — the SAME path data `Path2D` strokes on the
 * canvas, so what this button shows is what the node will actually look
 * like, rather than a stand-in that might not match.
 */
function IconGlyph({ name }: { name: IconName }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      fill="none"
      aria-hidden="true"
    >
      {icons[name].map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export function IconPicker({
  value,
  onChange,
  disabled = false,
}: {
  value?: string | undefined;
  onChange: (icon: string | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <Group>
      <Legend>Icon</Legend>
      <Grid $columns={6}>
        <Option
          type="button"
          $selected={!value}
          onClick={() => onChange(undefined)}
          disabled={disabled}
          aria-pressed={!value}
          aria-label="No icon"
          title="No icon"
        >
          <span aria-hidden="true" style={{ color: 'var(--ground-muted)' }}>
            —
          </span>
          Default
        </Option>

        {ICON_NAMES.map((name) => (
          <Option
            key={name}
            type="button"
            $selected={value === name}
            onClick={() => onChange(name)}
            disabled={disabled}
            aria-pressed={value === name}
            title={ICON_LABELS[name]}
          >
            <IconGlyph name={name} />
            {ICON_LABELS[name]}
          </Option>
        ))}
      </Grid>
    </Group>
  );
}
