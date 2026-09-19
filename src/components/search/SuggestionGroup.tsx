'use client';

import styled from 'styled-components';
import { highlight } from './ResultCard';
import {
  GROUP_LABELS,
  type ResultGroup,
  type SearchResult,
} from '@/lib/search/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * SuggestionGroup — one labelled block in the suggestion dropdown.
 *
 * §11 groups suggestions and caps them at 4 per group. The cap matters more
 * than it looks: an ungrouped list of twenty is a wall, and one group with
 * fifteen entries buries the other three groups entirely.
 */

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Label = styled.p`
  margin: 0;
  padding: var(--space-2) var(--space-3) var(--space-1);
  font-size: var(--text-caption);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ground-muted);
`;

const Item = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;

  padding: var(--space-2) var(--space-3);
  background: ${({ $active }) => ($active ? 'rgba(255,255,255,0.06)' : 'transparent')};
  border: none;
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
`;

const Dot = styled.span<{ $family: FamilyName; $dim: boolean }>`
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  opacity: ${({ $dim }) => ($dim ? 0.45 : 1)};
`;

const Text = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const Title = styled.span`
  font-size: var(--text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  mark {
    background: none;
    color: ${({ theme }) => theme.tokens.familyRamp.discover.core};
    font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  }
`;

/** §11: "path is what makes a result trustworthy in a spatial product." */
const Path = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export function SuggestionGroup({
  group,
  results,
  query,
  activeId,
  onSelect,
}: {
  group: ResultGroup;
  results: SearchResult[];
  query: string;
  activeId?: string | undefined;
  onSelect: (result: SearchResult) => void;
}) {
  if (results.length === 0) return null;

  return (
    <Group role="group" aria-label={GROUP_LABELS[group]}>
      <Label>{GROUP_LABELS[group]}</Label>
      {results.map((result) => (
        <Item
          key={`${result.group}:${result.id}`}
          id={`suggestion-${result.group}-${result.id}`}
          role="option"
          aria-selected={activeId === `${result.group}:${result.id}`}
          $active={activeId === `${result.group}:${result.id}`}
          onClick={() => onSelect(result)}
        >
          <Dot
            $family={result.family}
            $dim={result.status === 'coming_soon'}
            aria-hidden="true"
          />
          <Text>
            <Title>{highlight(result.title, query)}</Title>
            {result.path.length > 0 && <Path>{result.path.join(' › ')}</Path>}
          </Text>
        </Item>
      ))}
    </Group>
  );
}
