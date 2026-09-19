'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styled from 'styled-components';
import { Button, useToast } from '@/components/ui';
import { track } from '@/lib/analytics';
import { routes } from '@/lib/routes';
import { ChipGrid, type InterestOption } from './ChipGrid';

/**
 * Screen 15 — the interest picker (§13 steps 1–3).
 *
 * §13 step 1 asks for the map to recede rather than cut: "the panel rises over
 * a dimmed, still-visible map so the user never loses their place." That is
 * implemented as a route with the map behind it in the layout rather than a
 * modal over a live canvas — a second canvas rendering underneath a panel is
 * a second renderer running for something nobody is looking at, and P3's
 * budget does not have room for it.
 */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-6);
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
`;

const Title = styled.h1`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-l);
  color: var(--ground-ink);
`;

const Lede = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-muted);
  max-width: 60ch;
`;

const Foot = styled.div`
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) 0;
  background: var(--ground-background);
  border-top: 1px solid var(--ground-border);
`;

export function WatchScreen({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const { show: showToast } = useToast();

  const [options, setOptions] = useState<InterestOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    track('page_watcher_opened', {});

    (async () => {
      const response = await fetch('/api/watch/interests');
      const data = (await response.json()) as {
        interests: (InterestOption & { selected: boolean })[];
      };
      setOptions(data.interests);
      setSelected(
        new Set(data.interests.filter((i) => i.selected).map((i) => i.tag)),
      );
    })();
  }, []);

  const toggle = useCallback((tag: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const go = useCallback(async () => {
    const tags = [...selected];
    setSaving(true);

    /**
     * A signed-out visitor still gets a feed — the selection travels in the
     * URL instead of the profile. Requiring an account to look at community
     * content would put a sign-up wall in front of the discovery feature,
     * which is the one thing that might make someone want an account.
     */
    if (signedIn) {
      const response = await fetch('/api/watch/interests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      if (!response.ok) {
        showToast({ tone: 'danger', message: 'Could not save your interests' });
        setSaving(false);
        return;
      }
    }

    track('page_watcher_interests_set', { count: tags.length });
    setSaving(false);
    router.push(`${routes.watcherFeed}?tags=${encodeURIComponent(tags.join(','))}`);
  }, [selected, signedIn, router, showToast]);

  const totalAvailable = options
    ? options
        .filter((option) => selected.has(option.tag))
        .reduce((sum, option) => sum + option.count, 0)
    : 0;

  return (
    <Page>
      <Title>Page Watcher</Title>
      <Lede>
        Pick what you want to see. Everything here comes from inside CDN — public
        maps, services and projects the community has published.
      </Lede>

      {options === null ? (
        <Lede>Loading interests…</Lede>
      ) : (
        <ChipGrid options={options} selected={selected} onToggle={toggle} />
      )}

      <Foot>
        {/*
          §13 step 3: "One full-width button, disabled until a selection
          exists, showing the count: Go · 4 interests."
        */}
        <Button
          fullWidth
          size="lg"
          disabled={selected.size === 0 || saving}
          onClick={go}
        >
          {selected.size === 0
            ? 'Pick at least one interest'
            : `Go · ${selected.size} interest${selected.size === 1 ? '' : 's'}`}
        </Button>

        {selected.size > 0 && (
          <Lede
            as="p"
            style={{ fontSize: 'var(--text-caption)', textAlign: 'center' }}
          >
            {/*
              The honest count, up front. §20's risk here is cold-start
              emptiness, and telling someone what is waiting beats letting the
              feed be the thing that tells them.
            */}
            {totalAvailable} item{totalAvailable === 1 ? '' : 's'} match your picks
            {!signedIn && ' · sign in to remember these'}
          </Lede>
        )}
      </Foot>
    </Page>
  );
}
