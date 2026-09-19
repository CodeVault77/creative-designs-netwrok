'use client';

import Link from 'next/link';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';
import { buildRoute } from '@/lib/routes';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * MapCard — one map in the My Maps grid.
 *
 * Its own component rather than a generic Card because it carries information
 * a generic card has no concept of: who owns it, how exposed it is, and how
 * long ago it changed. Visibility in particular has to be visible at a glance
 * — someone scanning for "which of these is public" should not have to open
 * each one.
 */

const Root = styled(Link)<{ $family: FamilyName }>`
  display: flex;
  align-items: center;
  gap: var(--space-3);

  padding: var(--space-3);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  color: inherit;
  text-decoration: none;

  ${transition('selection', 'border-color', 'background-color')}

  &:hover {
    border-color: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
    background: rgba(255, 255, 255, 0.03);
  }
`;

/**
 * The node count, set inside a family-coloured ring.
 *
 * It replaces both the old family dot and the "24 nodes" text: one mark that
 * says how big a map is AND which family it belongs to, in the same visual
 * language the map itself uses for a node. Scanning a list, size is the thing
 * that distinguishes one map from another far more than its family does.
 */
const Gauge = styled.span<{ $family: FamilyName }>`
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 44px;
  height: 44px;
  box-sizing: border-box;
  border-radius: var(--radius-circle);

  background: var(--ground-canvas);
  border: 2px solid ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  box-shadow: ${({ theme, $family }) => theme.tokens.glow[$family][1]};

  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-label);
  color: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
`;

const Body = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Title = styled.span`
  font-family: var(--face-display);
  font-size: var(--text-body);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
  color: var(--ground-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/**
 * Visibility as a bordered chip on the right, in the reference's mono caps.
 *
 * Private is quiet; anything more exposed is tinted. Same principle as §10's
 * "public nodes carry no decoration, because decorating the norm makes the map
 * noisy" — inverted here, because on a list of your OWN maps the exposed ones
 * are the exception worth catching.
 */
const Badge = styled.span<{ $tone: 'quiet' | 'link' | 'open' }>`
  flex: none;
  padding: 2px 7px;
  border-radius: var(--radius-chip);

  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;

  border: 1px solid
    ${({ $tone }) =>
      $tone === 'open'
        ? 'var(--fam-create-core)'
        : $tone === 'link'
          ? 'var(--fam-discover-core)'
          : 'var(--fam-organise-core)'};
  color: ${({ $tone }) =>
    $tone === 'open'
      ? 'var(--fam-create-core)'
      : $tone === 'link'
        ? 'var(--fam-discover-core)'
        : 'var(--fam-organise-core)'};
`;

export interface MapCardData {
  id: string;
  title: string;
  family: FamilyName;
  visibility: 'private' | 'link' | 'public';
  nodeCount: number;
  updatedAt: string;
  relation: 'owner' | 'member';
  ownerHandle: string;
  role?: string;
}

const VISIBILITY: Record<
  MapCardData['visibility'],
  { label: string; tone: 'quiet' | 'link' | 'open' }
> = {
  private: { label: 'Private', tone: 'quiet' },
  link: { label: 'Link', tone: 'link' },
  public: { label: 'Public', tone: 'open' },
};

export function MapCard({ map }: { map: MapCardData }) {
  const visibility = VISIBILITY[map.visibility];
  const shared = map.relation === 'member';

  return (
    <Root href={buildRoute.mapEditor(map.id)} $family={map.family}>
      {/*
        The count is announced with its unit, because "24" alone tells a
        screen-reader user nothing about what it counts.
      */}
      <Gauge
        $family={map.family}
        aria-label={`${map.nodeCount} ${map.nodeCount === 1 ? 'node' : 'nodes'}`}
      >
        <span aria-hidden="true" data-numeric>
          {map.nodeCount}
        </span>
      </Gauge>

      <Body>
        <Title>{map.title}</Title>
        <Meta>
          Edited {relativeTime(map.updatedAt)} · {map.nodeCount}{' '}
          {map.nodeCount === 1 ? 'node' : 'nodes'}
        </Meta>
      </Body>

      {/*
        A shared map shows WHOSE it is rather than how exposed it is: its
        visibility is the owner's business, and the fact you can see it at all
        is already the answer to "can I".
      */}
      {shared ? (
        <Badge $tone="quiet">@{map.ownerHandle}</Badge>
      ) : (
        <Badge $tone={visibility.tone}>{visibility.label}</Badge>
      )}
    </Root>
  );
}

/**
 * Coarse relative time, in words.
 *
 * "3 days ago" is what someone scanning a list actually wants; an exact
 * timestamp is noise until they care, and by then the map itself has the
 * history.
 *
 * Spelled out rather than abbreviated ("12 min ago", not "12m ago") because it
 * is read as part of a sentence — "Edited 12 min ago · 24 nodes" — and the
 * compressed form reads as a code beside prose. `yesterday` is a special case
 * for the same reason: nobody says "1 day ago".
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  return new Date(iso).toLocaleDateString();
}
