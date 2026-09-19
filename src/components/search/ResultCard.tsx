'use client';

import Link from 'next/link';
import styled, { css } from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { SearchResult } from '@/lib/search/types';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * ResultCard — §11: "family dot, title, one-line snippet with matched terms
 * emphasised, breadcrumb path, status chip."
 *
 * The path is not decoration. In a spatial product a result without a location
 * is untrustworthy — "Goals" could be any of six maps, and knowing which one
 * is the difference between a useful result and a guess.
 */

const Card = styled(Link)<{ $family: FamilyName }>`
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3);

  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  background: var(--ground-surface);
  color: inherit;
  text-decoration: none;

  ${transition('selection', 'border-color', 'background-color')}

  &:hover {
    border-color: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
    background: rgba(255, 255, 255, 0.02);
  }
`;

const Dot = styled.span<{ $family: FamilyName; $dim: boolean }>`
  width: 8px;
  height: 8px;
  margin-top: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  opacity: ${({ $dim }) => ($dim ? 0.45 : 1)};
`;

const Body = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
`;

/**
 * How a matched term is drawn.
 *
 * Weight and ink, never a highlighter. An unstyled <mark> renders as the
 * browser's default yellow block, which is not in the palette and, on this
 * near-black ground, is the loudest thing on the screen — the emphasis ends up
 * shouting over the result it is meant to help you read.
 *
 * Shared rather than repeated: this rule previously existed only inside
 * `Snippet`, so snippet matches were styled correctly while every match in a
 * TITLE fell through to the yellow default.
 */
const matchedTerm = css`
  mark {
    background: none;
    color: var(--ground-ink);
    font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  }
`;

const Title = styled.span`
  ${matchedTerm}
  font-family: var(--face-display);
  font-size: var(--text-body);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
  color: var(--ground-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Snippet = styled.p`
  margin: 0;
  font-size: var(--text-label);
  color: var(--ground-muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;

  ${matchedTerm}
`;

const Path = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SoonChip = styled.span`
  flex-shrink: 0;
  font-family: var(--face-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--fam-services-core);
  border: 1px solid var(--fam-services-core);
  border-radius: var(--radius-chip);
  padding: 0 5px;
`;

/**
 * Emphasises matched terms.
 *
 * Splits on plain-text boundaries and renders <mark> elements — never
 * dangerouslySetInnerHTML. Result text is user content, and building HTML
 * from it is how a note titled `<img onerror=...>` becomes an XSS.
 */
export function highlight(text: string, query: string): React.ReactNode {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);

  if (terms.length === 0) return text;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);

  return parts.map((part, index) =>
    terms.includes(part.toLowerCase()) ? <mark key={index}>{part}</mark> : part,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ResultCard({
  result,
  query,
  onOpen,
}: {
  result: SearchResult;
  query: string;
  onOpen?: () => void;
}) {
  const soon = result.status === 'coming_soon';

  return (
    <Card href={result.href} $family={result.family} onClick={onOpen}>
      <Dot $family={result.family} $dim={soon} aria-hidden="true" />
      <Body>
        <TitleRow>
          <Title>{highlight(result.title, query)}</Title>
          {soon && <SoonChip>SOON</SoonChip>}
        </TitleRow>
        {result.snippet && <Snippet>{highlight(result.snippet, query)}</Snippet>}
        {result.path.length > 0 && <Path>{result.path.join(' › ')}</Path>}
      </Body>
    </Card>
  );
}
