'use client';

import { useCallback } from 'react';
import styled from 'styled-components';
import { ProfileHeader } from './ProfileHeader';
import { AccountPanel, type AccountSummary } from './AccountPanel';
import { MapCard, type MapCardData } from './MapCard';
import { EmptyState } from './EmptyState';
import { routes } from '@/lib/routes';

/** Screen 18 — profile and public maps. */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 64rem;
  margin: 0 auto;
  width: 100%;
`;

const SectionTitle = styled.h2`
  margin: 0 0 var(--space-3);
  font-size: var(--text-title);
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--space-3);
`;

export interface ProfileScreenProps {
  displayName: string;
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  isStaff: boolean;
  publicMaps: MapCardData[];
  /**
   * Owner-only counts and rows. Absent for a visitor, which is what keeps a
   * profile's private totals private — the panel cannot render what it was
   * never given.
   */
  account?: AccountSummary;
}

export function ProfileScreen({
  publicMaps,
  account,
  ...profile
}: ProfileScreenProps) {
  const signOut = useCallback(async () => {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    window.location.href = routes.map;
  }, []);

  return (
    <Wrap>
      <ProfileHeader
        {...profile}
        onSignOut={profile.isOwner ? signOut : undefined}
        hasAccountPanel={Boolean(account)}
      />

      {account && (
        <AccountPanel
          account={account}
          handle={profile.handle}
          isStaff={profile.isStaff}
          onSignOut={signOut}
        />
      )}

      <section>
        <SectionTitle>Public maps</SectionTitle>
        {publicMaps.length === 0 ? (
          <EmptyState
            title="No public maps yet"
            body={
              profile.isOwner
                ? 'Maps are private by default. Set one to public in its share settings and it will show up here.'
                : 'When this person publishes a map, it will appear here.'
            }
          />
        ) : (
          <Grid>
            {publicMaps.map((map) => (
              <MapCard key={map.id} map={map} />
            ))}
          </Grid>
        )}
      </section>
    </Wrap>
  );
}
