'use client';

import { useMemo } from 'react';
import { MapView } from './MapView';
import { communityMap } from '@/lib/map/seed';

/**
 * Thin client wrapper that supplies the Community Map graph.
 *
 * P6 replaces `communityMap()` with a fetch. The graph is built once and
 * memoised because rebuilding it would produce new node identities on every
 * render and invalidate every layout cache downstream.
 */
export function CommunityMapScreen({
  initialView = 'map',
  initialSelectedId = null,
  signedIn = false,
}: {
  initialView?: 'map' | 'tree';
  initialSelectedId?: string | null;
  /**
   * Whether the visitor has an account.
   *
   * Passed down from the server page rather than defaulted here. It was never
   * plumbed, so it sat at `false` for everyone — which silently disabled the
   * "Mine" lens for signed-in users and would have sent them to sign-in from
   * the new-map button they were already entitled to use.
   */
  signedIn?: boolean;
}) {
  const graph = useMemo(() => communityMap(), []);

  return (
    <MapView
      graph={graph}
      surface="community"
      initialView={initialView}
      initialSelectedId={initialSelectedId}
      signedIn={signedIn}
    />
  );
}
