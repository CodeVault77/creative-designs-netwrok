'use client';

import Link from 'next/link';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * ContentCard — §13 step 4.
 *
 * "source, title, excerpt, thumbnail, family dot, and three actions — Save,
 * Add to map, Share. Cards are ~72% viewport height so one is always
 * dominant."
 *
 * That height is the whole reading model of this screen: one card at a time,
 * deliberately unlike an infinite grid of thumbnails. It makes the feed feel
 * considered rather than endless, which matters more when the corpus is small
 * (§20's cold-start risk) — eighty items in a dense grid look sparse, and
 * eighty items one at a time do not.
 */

const Card = styled.article`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);

  /*
   * §13: "~72% viewport height so one is always dominant". A min rather than
   * a fixed height, so a long excerpt grows instead of clipping, and capped
   * on short viewports where 72% would leave no room for the actions.
   */
  min-height: min(72vh, 640px);
  padding: var(--space-6);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-sheet);

  scroll-snap-align: start;
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
`;

const Dot = styled.span<{ $family: FamilyName }>`
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  background: ${({ $family }) => `var(--fam-${$family}-core)`};
  box-shadow: ${({ $family }) => `0 0 10px var(--fam-${$family}-glow)`};
`;

const Source = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Badge = styled.span`
  margin-left: auto;
  padding: 2px var(--space-2);
  border: 1px dashed var(--ground-border);
  border-radius: var(--radius-pill);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Title = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  line-height: 1.2;
  color: var(--ground-ink);
`;

const TitleLink = styled(Link)`
  color: inherit;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const Excerpt = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-muted);
  line-height: 1.55;
`;

const Thumb = styled.div<{ $family: FamilyName }>`
  flex: 1;
  min-height: 120px;
  border-radius: var(--radius-card);

  /*
   * A generated field rather than a stock photograph. Most community content
   * has no image, and a placeholder graphic repeated down the feed reads as
   * broken; a family-tinted field reads as intentional and reinforces the
   * colour system at the same time.
   */
  background:
    radial-gradient(
      120% 90% at 20% 0%,
      ${({ $family }) => `var(--fam-${$family}-wash)`},
      transparent 70%
    ),
    var(--ground-background);
  border: 1px solid var(--ground-border);
`;

const Tags = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Tag = styled.li<{ $matched: boolean }>`
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--text-caption);

  background: ${({ $matched }) => ($matched ? 'rgba(255, 255, 255, 0.08)' : 'transparent')};
  border: 1px solid
    ${({ $matched }) => ($matched ? 'var(--color-focus)' : 'var(--ground-border)')};
  color: ${({ $matched }) => ($matched ? 'var(--ground-ink)' : 'var(--ground-muted)')};
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding-top: var(--space-2);
  border-top: 1px solid var(--ground-border);
`;

const Action = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-minHitTarget);
  padding: var(--space-2) var(--space-3);

  background: ${({ $active }) => ($active ? 'rgba(255, 255, 255, 0.08)' : 'none')};
  border: 1px solid
    ${({ $active }) => ($active ? 'var(--color-focus)' : 'var(--ground-border)')};
  border-radius: var(--radius-pill);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-label);
  cursor: pointer;

  ${transition('selection', 'background', 'border-color')}

  &:hover {
    border-color: var(--color-focus);
  }
`;

export interface ContentCardItem {
  id: string;
  kind: string;
  title: string;
  excerpt: string;
  source: string;
  family: FamilyName;
  href: string;
  tags: string[];
  matchedTags: string[];
  saved: boolean;
  seeded: boolean;
}

export interface ContentCardProps {
  item: ContentCardItem;
  onSave: (item: ContentCardItem) => void;
  onAddToMap: (item: ContentCardItem) => void;
  onShare: (item: ContentCardItem) => void;
  onOpen?: (item: ContentCardItem) => void;
}

export function ContentCard({
  item,
  onSave,
  onAddToMap,
  onShare,
  onOpen,
}: ContentCardProps) {
  return (
    <Card aria-labelledby={`card-${item.id}`}>
      <Head>
        <Dot $family={item.family} aria-hidden="true" />
        <Source>{item.source}</Source>
        {/*
          §13's honesty rule about cold start: seeded content is ours, not the
          community's, and saying so is better than letting the feed imply a
          busier network than exists.
        */}
        {item.seeded && <Badge>Seeded by CDN</Badge>}
      </Head>

      <Title id={`card-${item.id}`}>
        <TitleLink href={item.href} onClick={() => onOpen?.(item)}>
          {item.title}
        </TitleLink>
      </Title>

      <Excerpt>{item.excerpt}</Excerpt>

      <Thumb $family={item.family} aria-hidden="true" />

      {item.tags.length > 0 && (
        <Tags aria-label="Topics">
          {item.tags.map((tag) => (
            <Tag key={tag} $matched={item.matchedTags.includes(tag)}>
              {tag}
            </Tag>
          ))}
        </Tags>
      )}

      <Actions>
        <Action
          onClick={() => onSave(item)}
          $active={item.saved}
          aria-pressed={item.saved}
        >
          {item.saved ? 'Saved' : 'Save'}
        </Action>

        {/*
          §13: "the design risk is that it becomes a generic feed and stops
          being CDN. The fix is that every card can become a node." This is
          that fix, and it is why it sits in the middle rather than in an
          overflow menu.
        */}
        <Action onClick={() => onAddToMap(item)}>Add to map</Action>

        <Action onClick={() => onShare(item)}>Share</Action>
      </Actions>
    </Card>
  );
}
