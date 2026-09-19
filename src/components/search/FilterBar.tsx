'use client';

import styled from 'styled-components';
import { Chip } from '@/components/ui';
import { tokens, type FamilyName } from '@/lib/styles/tokens.generated';
import type { SearchFilters } from '@/lib/search/types';

/**
 * FilterBar — §11: "A single horizontal bar: All · family chips · Type · Live
 * only."
 *
 * Scrolls rather than wraps. A filter bar that grows to two rows on a phone
 * pushes the first result below the fold, and the results are the point.
 */

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);

  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const Divider = styled.span`
  flex-shrink: 0;
  width: 1px;
  height: 20px;
  background: var(--ground-border);
`;

const FAMILIES = Object.keys(tokens.color.family) as FamilyName[];

export function FilterBar({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const allOff = filters.families.length === 0 && !filters.liveOnly;

  const toggleFamily = (family: FamilyName) => {
    const next = filters.families.includes(family)
      ? filters.families.filter((f) => f !== family)
      : [...filters.families, family];
    onChange({ ...filters, families: next });
  };

  return (
    <Bar role="group" aria-label="Filter results">
      <Chip
        selected={allOff}
        onClick={() => onChange({ ...filters, families: [], liveOnly: false })}
      >
        All
      </Chip>

      <Divider aria-hidden="true" />

      {FAMILIES.map((family) => (
        <Chip
          key={family}
          family={family}
          showDot
          selected={filters.families.includes(family)}
          onClick={() => toggleFamily(family)}
        >
          {family}
        </Chip>
      ))}

      <Divider aria-hidden="true" />

      {/*
        §11: "Live only is important — it lets a user exclude Coming Soon
        results, which will otherwise pollute early search badly." Seven of
        twelve ring-one nodes are dark at launch (ADR-0001), so without this a
        search for almost anything is mostly things that do not exist yet.
      */}
      <Chip
        selected={filters.liveOnly}
        onClick={() => onChange({ ...filters, liveOnly: !filters.liveOnly })}
      >
        Live only
      </Chip>
    </Bar>
  );
}
