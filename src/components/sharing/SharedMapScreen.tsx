'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import styled from 'styled-components';
import { MapView } from '@/components/map/MapView';
import { LockBadge } from './LockBadge';
import { buildGraph } from '@/lib/map/geometry';
import { routes } from '@/lib/routes';
import type { SharePayload } from '@/lib/sharing/payload';
import type { MapNode } from '@/lib/map/types';

/**
 * A map opened through a share link — read-only.
 *
 * Renders through the same MapView as everything else. The payload it receives
 * has already been filtered server-side, so this component has no filtering to
 * do and no way to reveal something it was not sent. That is the point: there
 * is nothing here to get wrong.
 */

const Frame = styled.div`
  position: relative;
  height: 100dvh;
  display: flex;
  flex-direction: column;
`;

const Bar = styled.header`
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;

  height: 52px;
  padding: 0 var(--space-3);

  background: rgba(7, 7, 12, 0.86);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--ground-border);
`;

const Title = styled.h1`
  flex: 1;
  min-width: 0;
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Owner = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
  white-space: nowrap;
`;

const Cta = styled(Link)`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 var(--space-3);
  border: 1px solid ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  border-radius: var(--radius-control);
  background: ${({ theme }) => theme.tokens.familyRamp[theme.family].wash};
  color: var(--ground-ink);
  font-size: var(--text-label);
  text-decoration: none;
  white-space: nowrap;
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  position: relative;
`;

const Notice = styled.p`
  position: absolute;
  left: 50%;
  bottom: var(--space-6);
  transform: translateX(-50%);
  z-index: var(--z-mapControls);

  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);

  background: rgba(13, 14, 23, 0.82);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(12px);

  font-size: var(--text-caption);
  color: var(--ground-muted);
  pointer-events: none;
`;

export function SharedMapScreen({
  payload,
  signedIn,
}: {
  payload: SharePayload;
  signedIn: boolean;
}) {
  /*
   * SharedNode -> MapNode for the renderer.
   *
   * The missing fields stay missing. `visibility` is set to 'inherit' because
   * the payload does not carry it — a private node is not in this object at
   * all, so there is nothing here to mark.
   */
  const graph = useMemo(() => {
    const nodes: MapNode[] = Object.values(payload.nodes).map((node) => ({
      id: node.id,
      map_id: payload.id,
      parent_id: node.parent_id,
      slot: node.slot,
      title: node.title,
      family: node.family,
      type: node.type,
      status: node.status,
      visibility: 'inherit',
      weight: node.weight,
      ...(node.description ? { description: node.description } : {}),
      ...(node.href ? { href: node.href } : {}),
      ...(node.icon ? { icon: node.icon } : {}),
    }));

    return buildGraph(payload.id, payload.title, payload.rootId, nodes);
  }, [payload]);

  return (
    <Frame>
      <Bar>
        <Title>{payload.title}</Title>
        <Owner>by @{payload.ownerHandle}</Owner>
        <Cta href={signedIn ? routes.maps : '/sign-up'}>
          {signedIn ? 'My Maps' : 'Make your own'}
        </Cta>
      </Bar>

      <Body>
        <MapView graph={graph} surface="shared_map" signedIn={signedIn} />

        {!payload.nodeViewable && (
          <Notice>
            <LockBadge label="Detail hidden" />
            The owner shared the shape of this map, not its contents.
          </Notice>
        )}

        {payload.hiddenCount > 0 && payload.nodeViewable && (
          <Notice>
            <LockBadge />
            {payload.hiddenCount} node{payload.hiddenCount === 1 ? '' : 's'} kept
            private
          </Notice>
        )}
      </Body>
    </Frame>
  );
}
