'use client';

import styled from 'styled-components';
import type { NodeDetail } from '@/lib/nodes/detail';
import { labelFor } from '@/lib/nodes/registry';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The facts about a node, as a framed table.
 *
 * The design reference sets these as banded rows inside one rounded frame,
 * label left in mono caps and value right in ink — a spec sheet rather than a
 * paragraph. That is the right shape for it: every row is the same kind of
 * thing, and the alignment lets someone find STATUS without reading FAMILY.
 *
 * Rows that carry no information are still omitted. A row reading
 * "Visibility: public" on every node in a public map is noise that trains
 * people to skip the list — the same reasoning as §10's "there is no public
 * decoration, because decorating the norm makes the map noisy".
 */

const Frame = styled.dl`
  margin: 0;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  overflow: hidden;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);

  padding: var(--space-3) var(--space-3);
  background: var(--ground-raised);

  & + & {
    border-top: 1px solid var(--ground-border);
  }

  dt {
    font-family: var(--face-mono);
    font-size: var(--text-caption);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ground-muted);
  }

  dd {
    margin: 0;
    font-size: var(--text-label);
    color: var(--ground-ink);
    text-align: right;
  }
`;

const Numeric = styled.dd`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
`;

/** Live and Coming Soon are stated in words, and tinted to match the map. */
const Status = styled.dd<{ $tone: 'live' | 'soon' | 'off' }>`
  color: ${({ $tone }) =>
    $tone === 'live'
      ? 'var(--fam-create-core)'
      : $tone === 'soon'
        ? 'var(--fam-services-core)'
        : 'var(--ground-muted)'};
`;

const FamilyValue = styled.dd<{ $family: FamilyName }>`
  color: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
`;

/*
 * Labels come from the node type registry.
 *
 * This was a hand-maintained map that had to be updated in step with a union
 * in `map/types.ts` and two lists in `editor/types.ts`. `labelFor` degrades to
 * the raw type string for anything unregistered, so a row written by a newer
 * deployment reads as itself rather than as "undefined".
 */

const FAMILY_LABELS: Record<FamilyName, string> = {
  create: 'Create',
  discover: 'Discover',
  services: 'Services',
  people: 'People',
  organise: 'Organise',
  commerce: 'Commerce',
};

const STATUS_LABELS: Record<
  NodeDetail['status'],
  [string, 'live' | 'soon' | 'off']
> = {
  active: ['Live', 'live'],
  coming_soon: ['Coming soon', 'soon'],
  inactive: ['Inactive', 'off'],
};

export function MetaList({ detail }: { detail: NodeDetail }) {
  const [statusLabel, statusTone] = STATUS_LABELS[detail.status];

  const rows: Array<[string, React.ReactNode, boolean]> = [
    [
      'Family',
      <FamilyValue key="f" $family={detail.family}>
        {FAMILY_LABELS[detail.family]}
      </FamilyValue>,
      true,
    ],
    ['Type', <dd key="t">{labelFor(detail.type)}</dd>, true],
    [
      'Children',
      <Numeric key="c">{detail.childCount}</Numeric>,
      detail.childCount > 0,
    ],
    [
      'Status',
      <Status key="s" $tone={statusTone}>
        {statusLabel}
      </Status>,
      true,
    ],
    ['Visibility', <dd key="v">Private</dd>, detail.visibility === 'private'],
  ];

  const visible = rows.filter(([, , show]) => show);
  if (visible.length === 0) return null;

  return (
    <Frame>
      {visible.map(([label, value]) => (
        <Row key={label}>
          <dt>{label}</dt>
          {value}
        </Row>
      ))}
    </Frame>
  );
}
