'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styled from 'styled-components';
import { Button } from '@/components/ui';

/**
 * InfiniteList — the scroll container behind §13 step 4.
 *
 * Two decisions worth stating, because both are easy to get wrong in a way
 * that only shows up for some people:
 *
 * 1. **There is always a real button.** The sentinel loads the next page
 *    automatically, but "Load more" is present and focusable, not a hidden
 *    fallback. An infinite list with no control cannot be operated from a
 *    keyboard and cannot be reached at all by someone who never scrolls with
 *    a mouse — and it strands anyone whose browser does not fire the observer.
 *
 * 2. **The end is announced.** A feed that simply stops is indistinguishable
 *    from a feed that is broken, which matters more here than usual: §20's
 *    risk for this phase is cold-start emptiness, and "you have reached the
 *    end of 80 items" reads very differently from silence.
 */

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  /*
   * Snapping makes the ~72% card height mean something: one card settles into
   * view rather than two halves. Proximity rather than mandatory, so a
   * deliberate long scroll is not fought.
   */
  scroll-snap-type: y proximity;
`;

const Foot = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) 0;
  min-height: 80px;
`;

const Note = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  text-align: center;
`;

export interface InfiniteListProps {
  children: ReactNode;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** Shown when the list has run out. */
  endNote?: string;
}

export function InfiniteList({
  children,
  hasMore,
  loading,
  onLoadMore,
  endNote,
}: InfiniteListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  /**
   * `onLoadMore` is read through a ref inside the observer callback.
   *
   * Without it the effect re-subscribes on every render, because the callback
   * is a new function each time — and re-subscribing while the sentinel is on
   * screen fires another load immediately, which is how one scroll turns into
   * four pages.
   */
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  const busyRef = useRef(loading);
  busyRef.current = loading;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !busyRef.current) {
          loadMoreRef.current();
        }
      },
      // Start fetching a screen early, so the next card is usually there
      // before the user arrives at it.
      { rootMargin: '600px 0px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  return (
    <>
      <List>{children}</List>

      <Foot>
        <div ref={sentinelRef} aria-hidden="true" />

        {hasMore ? (
          <Button variant="secondary" onClick={onLoadMore} loading={loading}>
            Load more
          </Button>
        ) : (
          endNote && <Note role="status">{endNote}</Note>
        )}
      </Foot>
    </>
  );
}
