'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styled from 'styled-components';
import { Button, useToast } from '@/components/ui';
import { track } from '@/lib/analytics';
import { routes } from '@/lib/routes';
import { ContentCard, type ContentCardItem } from './ContentCard';
import { InfiniteList } from './InfiniteList';
import { AddToMapPicker } from './AddToMapPicker';

/**
 * Screen 16 — the feed (§13 steps 4–7).
 *
 * The empty state is the important part of this component, not the happy path.
 * §20 names cold-start emptiness as this phase's risk and §13 says the fix is
 * to "let the empty state say honestly that the community is new" — so the
 * empty branch below is written as carefully as the feed itself, and offers
 * the two things that actually help: widen the interests, or make the missing
 * content yourself.
 */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
`;

const Header = styled.header`
  position: sticky;
  top: 0;
  z-index: 2;

  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;

  padding: var(--space-3) 0;
  background: var(--ground-background);
  border-bottom: 1px solid var(--ground-border);
`;

const Title = styled.h1`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const Spacer = styled.span`
  margin-left: auto;
`;

const Note = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const EmptyBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;

  padding: var(--space-6);
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-sheet);
`;

const EmptyTitle = styled.h2`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
`;

interface FeedResponse {
  items: ContentCardItem[];
  nextCursor: string | null;
  total: number;
  tags: string[];
}

export function FeedScreen({
  initialTags,
  initialSavedOnly = false,
  signedIn,
}: {
  initialTags: string[];
  /** Read from `?saved=1`, so the view is linkable and survives a reload. */
  initialSavedOnly?: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const { show: showToast } = useToast();

  const [items, setItems] = useState<ContentCardItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savedOnly, setSavedOnly] = useState(initialSavedOnly);
  const [picking, setPicking] = useState<ContentCardItem | null>(null);

  const tagsParam = initialTags.join(',');

  // Guards the very first load against React 18's double-invoked effects in
  // development, which would otherwise append page one twice.
  const loadedRef = useRef('');

  const load = useCallback(
    async (nextCursor: string | null, replace: boolean) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (tagsParam) params.set('tags', tagsParam);
        if (nextCursor) params.set('cursor', nextCursor);
        if (savedOnly) params.set('saved', '1');
        params.set('limit', '6');

        const response = await fetch(`/api/watch/feed?${params}`);
        const data = (await response.json()) as FeedResponse;

        setItems((current) => (replace ? data.items : [...current, ...data.items]));
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
        setTotal(data.total);
      } finally {
        setLoading(false);
      }
    },
    [tagsParam, savedOnly],
  );

  useEffect(() => {
    const key = `${tagsParam}|${savedOnly}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    void load(null, true);
  }, [tagsParam, savedOnly, load]);

  /**
   * Toggling the filter rewrites the URL as well as the state.
   *
   * Without it, reloading or sharing the page silently drops the filter and
   * shows the whole feed — the two views look similar enough that the reader
   * would not necessarily notice they were looking at something else.
   * `replace` rather than `push`, because a filter toggle is not a place a
   * back button should have to walk through.
   */
  const toggleSaved = useCallback(
    (next: boolean) => {
      setSavedOnly(next);
      const params = new URLSearchParams();
      if (tagsParam) params.set('tags', tagsParam);
      if (next) params.set('saved', '1');
      const query = params.toString();
      router.replace(query ? `${routes.watcherFeed}?${query}` : routes.watcherFeed);
    },
    [tagsParam, router],
  );

  const onSave = useCallback(
    async (item: ContentCardItem) => {
      if (!signedIn) {
        showToast({ tone: 'neutral', message: 'Sign in to save items' });
        return;
      }

      const next = !item.saved;
      // Optimistic: the button is a toggle and waiting for a round trip to
      // reflect a press is the difference between responsive and sluggish.
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, saved: next } : row)),
      );

      const response = await fetch('/api/watch/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, saved: next }),
      });

      if (!response.ok) {
        setItems((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, saved: !next } : row,
          ),
        );
        showToast({ tone: 'danger', message: 'Could not save that' });
        return;
      }

      if (next) track('page_watcher_item_saved', { item_id: item.id });
    },
    [signedIn, showToast],
  );

  const onShare = useCallback(
    async (item: ContentCardItem) => {
      const url = new URL(item.href, window.location.origin).toString();
      try {
        // The platform sheet where it exists; the clipboard everywhere else.
        if (navigator.share) await navigator.share({ title: item.title, url });
        else {
          await navigator.clipboard.writeText(url);
          showToast({ tone: 'success', message: 'Link copied' });
        }
      } catch {
        // A cancelled share sheet rejects. That is not an error worth showing.
      }
    },
    [showToast],
  );

  const addToMap = useCallback(
    async (mapId: string, parentId: string) => {
      if (!picking) return;

      const response = await fetch('/api/watch/add-to-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: picking.id, mapId, parentId }),
      });

      const data = (await response.json()) as {
        error?: string;
        href?: string;
        mapTitle?: string;
        mapId?: string;
      };

      if (!response.ok) {
        showToast({
          tone: 'danger',
          message: data.error ?? 'Could not add that node',
        });
        return;
      }

      track('page_watcher_node_created', {
        item_id: picking.id,
        map_id: data.mapId ?? mapId,
      });

      // §13 step 6: 'a toast: Added to "Research" · View in map'.
      showToast({
        tone: 'success',
        message: `Added to “${data.mapTitle}”`,
        action: { label: 'View in map', onPress: () => router.push(data.href!) },
      });
      setPicking(null);
    },
    [picking, router, showToast],
  );

  const empty = !loading && items.length === 0;

  return (
    <Page>
      <Header>
        <Title>{savedOnly ? 'Saved' : 'Page Watcher'}</Title>
        <Note>
          {total} item{total === 1 ? '' : 's'}
          {initialTags.length > 0 && ` · ${initialTags.length} interests`}
        </Note>
        <Spacer />
        {/*
          "Saved items", not "Saved". Every card also carries a Save button
          that reads "Saved" once pressed, and two controls with the same
          accessible name on one screen is a real ambiguity for anyone
          navigating by name rather than by position — it was found by a test
          harness clicking the wrong one.
        */}
        <Button
          size="sm"
          variant={savedOnly ? 'primary' : 'ghost'}
          aria-pressed={savedOnly}
          onClick={() => toggleSaved(!savedOnly)}
        >
          Saved items
        </Button>
        {/* §13 step 2: "editable later from the feed header". */}
        <Link href={routes.watcher}>
          <Button size="sm" variant="secondary">
            Interests
          </Button>
        </Link>
      </Header>

      {empty ? (
        <EmptyBox>
          {/*
            §13: "let the empty state say honestly that the community is new."
            No pretending, no fake activity — and two real ways forward.
          */}
          <EmptyTitle>
            {savedOnly ? 'Nothing saved yet' : 'Nothing here yet'}
          </EmptyTitle>
          <Note>
            {savedOnly
              ? 'Save an item from the feed and it will show up here.'
              : 'CDN is new, and these interests have no published content yet. That will change as people publish maps — and you can be first.'}
          </Note>
          <Actions>
            {savedOnly ? (
              <Button onClick={() => toggleSaved(false)}>Back to the feed</Button>
            ) : (
              <>
                <Link href={routes.watcher}>
                  <Button>Choose more interests</Button>
                </Link>
                <Link href={routes.linkToMindMap}>
                  <Button variant="secondary">Turn a web page into a map</Button>
                </Link>
              </>
            )}
          </Actions>
        </EmptyBox>
      ) : (
        <InfiniteList
          hasMore={hasMore}
          loading={loading}
          onLoadMore={() => void load(cursor, false)}
          endNote={`That is all ${total} item${total === 1 ? '' : 's'} for these interests.`}
        >
          {items.map((item, index) => (
            <ContentCard
              key={item.id}
              item={item}
              onSave={onSave}
              onAddToMap={setPicking}
              onShare={onShare}
              onOpen={() =>
                track('page_watcher_item_opened', {
                  item_id: item.id,
                  position: index,
                })
              }
            />
          ))}
        </InfiniteList>
      )}

      <AddToMapPicker
        open={picking !== null}
        itemTitle={picking?.title ?? ''}
        onClose={() => setPicking(null)}
        onConfirm={addToMap}
      />
    </Page>
  );
}
