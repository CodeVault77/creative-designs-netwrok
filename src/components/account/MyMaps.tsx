'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import styled from 'styled-components';
import { Button } from '@/components/ui';
import { MapCard, type MapCardData } from './MapCard';
import { TabSegment } from './TabSegment';
import { EmptyState } from './EmptyState';
import { routes } from '@/lib/routes';
import { QUOTAS } from '@/lib/quotas';

/** Screen 07 — My Maps. */

type Tab = 'mine' | 'shared';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 64rem;
  margin: 0 auto;
  width: 100%;
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
`;

const Title = styled.h1`
  margin: 0;
  font-size: var(--text-display-m);
`;

/**
 * A LIST, not a grid.
 *
 * The design reference stacks full-width rows, and that is the right shape for
 * the content: every card is a title, a timestamp and a visibility chip, all of
 * which read left-to-right. In a 230px grid cell the same fields wrapped onto
 * three lines and the chip lost its alignment with its neighbours, so nothing
 * could be compared down the column.
 *
 * It widens rather than multiplying columns on desktop — a list of maps is
 * scanned vertically at any size.
 */
const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const QuotaNote = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M12 6v12"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M6 12h12"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MyMaps({
  owned,
  shared,
}: {
  owned: MapCardData[];
  shared: MapCardData[];
}) {
  const [tab, setTab] = useState<Tab>('mine');

  const options = useMemo(
    () =>
      [
        { id: 'mine' as const, label: 'Mine', count: owned.length },
        { id: 'shared' as const, label: 'Shared with me', count: shared.length },
      ] as const,
    [owned.length, shared.length],
  );

  const maps = tab === 'mine' ? owned : shared;
  const atQuota = owned.length >= QUOTAS.mapsPerUser;

  return (
    <Wrap>
      <Header>
        <Title>My Maps</Title>

        {/*
          §08 screen 08 permission state: the quota is surfaced BEFORE the
          action, not as an error after someone has typed a name and chosen a
          template.
        */}
        {atQuota ? (
          <Button
            variant="secondary"
            size="xs"
            disabled
            title="You have reached your map limit"
          >
            New map
          </Button>
        ) : (
          <Link href={routes.newMap}>
            {/*
              Compact and lime, with a leading plus, as the reference draws it.
              At the default size it was nearly as tall as the title beside it
              and pulled more attention than the maps themselves — which are
              what the screen is for. The plus does the work of announcing it
              as the additive action, so the button does not need the bulk.
            */}
            <Button
              variant="primary"
              family="create"
              size="xs"
              iconStart={<PlusIcon />}
            >
              New map
            </Button>
          </Link>
        )}
      </Header>

      {/*
        The tabs get their own full-width row beneath the header, as in the
        reference. Sharing a line with the title and the button left them
        squeezed into whatever space was over, and on a narrow phone the row
        wrapped into three stacked controls.
      */}
      <TabSegment
        options={options}
        value={tab}
        onChange={setTab}
        label="Map list"
      />

      {atQuota && (
        <QuotaNote>
          You have {owned.length} of {QUOTAS.mapsPerUser} maps. Delete one to make
          room.
        </QuotaNote>
      )}

      {maps.length === 0 ? (
        tab === 'mine' ? (
          <EmptyState
            /*
             * Orients before it explains the mechanics.
             *
             * The common path here starts on the Community Map — tap Mind
             * Mapping, tap Open — and arrives on an empty list with nothing
             * to compare it to. The previous copy explained the EDITOR
             * ("put it in the centre, build outward") but never said what
             * this page IS: a different, private space from the map they
             * just left. Without that one sentence, the empty list read as
             * broken rather than as "you have not made one yet".
             */
            title="Your own workspace"
            body="Different from the Community Map you were just on — maps here are private until you choose to share them. Pick New map, choose a starting point, and you will land straight in an editor with nodes already placed, ready to edit rather than a blank page."
            action={
              <Link href={routes.newMap}>
                <Button variant="primary">New map</Button>
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Nothing shared with you yet"
            body="When someone invites you to a map, it shows up here. You will get a notification too."
          />
        )
      ) : (
        <List>
          {maps.map((map) => (
            <MapCard key={map.id} map={map} />
          ))}
        </List>
      )}
    </Wrap>
  );
}
