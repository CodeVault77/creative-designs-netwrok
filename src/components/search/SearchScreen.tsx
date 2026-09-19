'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styled from 'styled-components';
import { SearchField } from './SearchField';
import { SuggestionGroup } from './SuggestionGroup';
import { ResultCard } from './ResultCard';
import { FilterBar } from './FilterBar';
import { ResultMap } from './ResultMap';
import { ViewToggle } from '@/components/map/ViewToggle';
import { EmptyState } from '@/components/account/EmptyState';
import { Button, Skeleton } from '@/components/ui';
import { readSnapshot, restoreHref, type MapSnapshot } from '@/lib/search/snapshot';
import { routes } from '@/lib/routes';
import { looksLikeUrl } from '@/components/link';
import { COMMUNITY_NODES } from '@/lib/map/seed';
import type { FamilyName } from '@/lib/styles/tokens.generated';
import { buildRoute } from '@/lib/routes';
import { track } from '@/lib/analytics';
import {
  EMPTY_FILTERS,
  MIN_QUERY_LENGTH,
  SUGGEST_DEBOUNCE_MS,
  type ResultGroup,
  type SearchFilters,
  type SearchResponse,
} from '@/lib/search/types';

/** Screens 05 and 06 — one route, two states of the same screen. */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 52rem;
  margin: 0 auto;
  width: 100%;
  /* Room for the return bar AND, below the rail breakpoint, the tab bar it
     sits above — so the last result is never under either. */
  padding-bottom: 144px;

  @media (min-width: 1024px) {
    padding-bottom: 72px;
  }
`;

/**
 * The field and filters stay put while results scroll.
 *
 * Sticky is not decoration here — it fixes a real defect. The app's TopBar is
 * itself sticky, so anything scrolled up under it becomes unclickable: the
 * Map/Tree toggle simply stopped responding once you had scrolled past a few
 * results, because the header was on top of it.
 *
 * `top: 56px` clears the TopBar; the z-index sits below chrome so the toggle
 * is above the results but never above the app bar.
 */
/**
 * Removed from the page visually, kept in the accessibility tree.
 *
 * `display: none` and `visibility: hidden` both remove it from that tree too,
 * which would defeat the purpose — this is the standard clip-rect technique.
 */
const VisuallyHiddenH1 = styled.h1`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
`;

const Head = styled.div`
  position: sticky;
  top: 56px;
  z-index: 5;

  display: flex;
  flex-direction: column;
  gap: var(--space-3);

  /* Opaque, or results scroll visibly through the field behind it. */
  padding: var(--space-3) 0;
  margin-top: calc(var(--space-3) * -1);
  background: var(--ground-background);
`;

const Dropdown = styled.div`
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  right: 0;
  z-index: var(--z-menu);
  max-height: 60vh;
  overflow-y: auto;

  padding: var(--space-1);
  background: var(--ground-surface);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  box-shadow: var(--elev-menu);
`;

const Row = styled.div`
  position: sticky;
  /* Below Head, which is 56 + its own height. */
  top: 152px;
  z-index: 4;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;

  padding: var(--space-2) 0;
  background: var(--ground-background);
`;

const Count = styled.p`
  margin: 0;
  font-size: var(--text-label);
  color: var(--ground-muted);

  span {
    font-family: var(--face-mono);
    font-variant-numeric: tabular-nums;
    color: var(--ground-ink);
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const MapHolder = styled.div`
  height: min(70vh, 560px);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  overflow: hidden;
`;

/**
 * The mono section headings in the no-query state ("RECENT", "SUGGESTED").
 *
 * Set apart from `Count` on purpose: those are labels for a region, not a
 * sentence about the results, and the design canvas gives them the mono face
 * and wide tracking that the rest of the app uses for structural labels.
 */
const SectionLabel = styled.h2`
  margin: var(--space-6) 0 var(--space-3);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  font-weight: 400;
  letter-spacing: 1.4px;
  color: var(--ground-muted);
`;

const Suggestions = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const Suggestion = styled.li`
  & + & {
    border-top: 1px solid var(--ground-border);
  }

  a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    padding: var(--space-2) var(--space-1);
    color: inherit;
    text-decoration: none;
  }

  a:hover {
    background: rgba(255, 255, 255, 0.03);
  }
`;

const SuggestionDot = styled.span<{ $family: FamilyName }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
`;

const SuggestionText = styled.span`
  flex: 1;
  min-width: 0;

  strong {
    display: block;
    font-size: var(--text-body);
    font-weight: 500;
    color: var(--ground-ink);
  }

  small {
    display: block;
    margin-top: 2px;
    font-family: var(--face-mono);
    font-size: var(--text-caption);
    color: var(--ground-muted);
  }
`;

const SuggestionGroupName = styled.span`
  flex: none;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Recents = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`;

const RecentChip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 30px;
  padding: 0 var(--space-3);

  background: transparent;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-chip);
  color: var(--ground-muted);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;

  &:hover {
    color: var(--ground-ink);
    border-color: var(--fam-discover-core);
  }
`;

/** §11's return path: "Without this, search becomes a trapdoor." */
const ReturnBar = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  z-index: var(--z-chrome);

  /**
   * Above the tab bar, not under it.
   *
   * Both are fixed to the bottom of the viewport, so bottom:0 put the return
   * path exactly behind the tab bar on phones — invisible, and §11 requires
   * it to be there. The desktop harness never saw this because the rail
   * layout has no tab bar.
   */
  bottom: calc(72px + env(safe-area-inset-bottom, 0px));

  display: flex;
  justify-content: center;
  padding: var(--space-2) var(--space-3);
  padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px));

  background: rgba(7, 7, 12, 0.9);
  backdrop-filter: blur(16px);
  border-top: 1px solid var(--ground-border);

  @media (min-width: 1024px) {
    left: 72px;
    bottom: 0;
  }
`;

const ReturnLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ground-ink);
  font-size: var(--text-label);
  text-decoration: none;

  &:hover {
    color: ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  }
`;

const LinkToMapRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;

  padding: var(--space-3);
  border: 1px dashed var(--ground-border);
  border-radius: var(--radius-card);
`;

const RECENTS_KEY = 'cdn.search.recents';
const GROUP_ORDER: ResultGroup[] = ['pages', 'nodes', 'maps', 'people'];

export function SearchScreen({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<'map' | 'tree'>('tree');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);

  /**
   * What to offer before anyone has typed.
   *
   * Ring one of the community map, live nodes only, in the map's own slot
   * order — so the list reads in the same sequence as the ring the user just
   * came from rather than in an order invented here. Computed once: the seed
   * is a module constant and cannot change between renders.
   */
  const suggestions = useMemo(
    () =>
      COMMUNITY_NODES.filter(
        (node) =>
          node.parent_id === 'cdn-root' &&
          node.status === 'active' &&
          node.visibility === 'public',
      )
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .slice(0, 5),
    [],
  );
  const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null);

  const requestRef = useRef(0);

  useEffect(() => {
    setSnapshot(readSnapshot());
    try {
      const raw = window.localStorage.getItem(RECENTS_KEY);
      if (raw) setRecents(JSON.parse(raw) as string[]);
    } catch {
      /* recents are a convenience, not state worth recovering */
    }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    track('search_opened', { from: 'tab' });
  }, []);

  /** One fetch path for suggestions and results — same endpoint, same filters. */
  const run = useCallback(async (query: string, current: SearchFilters) => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResponse(null);
      return;
    }

    // A stale response must never overwrite a newer one; typing quickly
    // otherwise leaves the results of whichever request happened to finish
    // last.
    const requestId = ++requestRef.current;
    setLoading(true);

    const params = new URLSearchParams({ q: query });
    if (current.families.length > 0)
      params.set('families', current.families.join(','));
    if (current.liveOnly) params.set('live', '1');

    try {
      const data = (await (
        await fetch(`/api/search?${params}`)
      ).json()) as SearchResponse;
      if (requestId !== requestRef.current) return;
      setResponse(data);
    } catch {
      if (requestId === requestRef.current) setResponse(null);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  // §11: suggestions after 2 characters, debounced 180ms.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void run(value, filters);
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [value, filters, run]);

  const submit = useCallback(() => {
    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) return;

    setSubmitted(query);
    setShowSuggestions(false);

    const next = [query, ...recents.filter((r) => r !== query)].slice(0, 6);
    setRecents(next);
    try {
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }

    // replaceState, not push: every keystroke-then-submit would otherwise
    // stack history entries and Back would walk through old queries.
    window.history.replaceState(
      null,
      '',
      `${routes.search}?q=${encodeURIComponent(query)}`,
    );
    track('search_submitted', {
      query_length: query.length,
      filters: filters.families,
    });
  }, [value, recents, filters]);

  const hasQuery = submitted.trim().length >= MIN_QUERY_LENGTH;

  /**
   * §12 step 1: a URL pasted into search is carried straight through to
   * Link-to-Mind-Map, rather than making the user type it a second time.
   */
  const linkToMapHref = looksLikeUrl(submitted)
    ? `${routes.linkToMindMap}?from=search_empty&url=${encodeURIComponent(submitted.trim())}`
    : `${routes.linkToMindMap}?from=search_empty`;
  const results = response?.results ?? [];

  const suggestionsVisible =
    showSuggestions && value.trim().length >= MIN_QUERY_LENGTH && response !== null;

  const grouped = useMemo(
    () => response?.grouped ?? { nodes: [], maps: [], people: [], pages: [] },
    [response],
  );

  return (
    <Wrap>
      {/*
        Every page needs exactly one h1, and this screen had none — the field
        was the whole header. Visually hidden rather than displayed, because
        the search field IS the visible title here and a heading above it would
        be redundant to a sighted reader while remaining essential to someone
        navigating by headings.
      */}
      <VisuallyHiddenH1>
        {hasQuery ? `Search results for ${submitted}` : 'Search'}
      </VisuallyHiddenH1>

      <Head>
        <SearchField
          ref={inputRef}
          value={value}
          onChange={(next) => {
            setValue(next);
            setShowSuggestions(true);
          }}
          onSubmit={submit}
          onClose={() => router.back()}
          loading={loading}
          listboxId="search-suggestions"
          expanded={suggestionsVisible}
        />

        {suggestionsVisible && (
          <Dropdown id="search-suggestions" role="listbox" aria-label="Suggestions">
            {GROUP_ORDER.map((group) => (
              <SuggestionGroup
                key={group}
                group={group}
                results={grouped[group]}
                query={value}
                onSelect={(result) => {
                  track('search_result_opened', {
                    result_type: result.group,
                    position: 0,
                  });
                  router.push(result.href);
                }}
              />
            ))}
            {response && response.total === 0 && (
              <p
                style={{
                  padding: 'var(--space-3)',
                  margin: 0,
                  color: 'var(--ground-muted)',
                }}
              >
                Nothing yet for “{value}”.
              </p>
            )}
          </Dropdown>
        )}

        <FilterBar filters={filters} onChange={setFilters} />
      </Head>

      {!hasQuery && recents.length > 0 && (
        <div>
          <SectionLabel>RECENT</SectionLabel>
          <Recents>
            {recents.map((recent) => (
              <RecentChip
                key={recent}
                onClick={() => {
                  setValue(recent);
                  setSubmitted(recent);
                  void run(recent, filters);
                }}
              >
                {recent}
              </RecentChip>
            ))}
          </Recents>
        </div>
      )}

      {/*
       * Suggestions, so the no-query screen is never a blank void.
       *
       * These are REAL ring-one nodes from the community map, not invented
       * "popular searches" — every row leads somewhere that exists, and the
       * list is derived from the same seed the map draws, so it cannot drift
       * into advertising something that was renamed or removed.
       *
       * Coming Soon nodes are excluded: sending someone from a search box to a
       * screen that tells them the thing is not built is a worse answer than
       * not suggesting it.
       */}
      {!hasQuery && (
        <div>
          <SectionLabel>SUGGESTED</SectionLabel>
          <Suggestions>
            {suggestions.map((node, index) => (
              <Suggestion key={node.id}>
                <Link
                  href={buildRoute.mapNode(node.id)}
                  /*
                   * Reported as a result, not as a new event type. A
                   * suggestion IS a search result — one we offered rather than
                   * one the user typed toward — and `result_type` already
                   * carries that distinction, so §24's funnel keeps working
                   * without widening the taxonomy.
                   */
                  onClick={() =>
                    track('search_result_opened', {
                      result_type: 'suggestion',
                      position: index,
                    })
                  }
                >
                  <SuggestionDot $family={node.family} aria-hidden="true" />
                  <SuggestionText>
                    <strong>{node.title}</strong>
                    <small>Community Map</small>
                  </SuggestionText>
                  <SuggestionGroupName>{node.family}</SuggestionGroupName>
                </Link>
              </Suggestion>
            ))}
          </Suggestions>
        </div>
      )}

      {hasQuery && (
        <>
          <Row>
            <Count>
              <span>{results.length}</span> result{results.length === 1 ? '' : 's'}{' '}
              for “{submitted}”
              {response ? (
                <>
                  {' '}
                  · <span>{response.ms}</span>ms
                </>
              ) : null}
            </Count>
            {results.length > 0 && (
              <ViewToggle
                view={view === 'map' ? 'map' : 'tree'}
                onChange={(next) => {
                  setView(next);
                  track('search_view_toggled', {
                    to: next === 'map' ? 'map' : 'list',
                  });
                }}
              />
            )}
          </Row>

          {loading && results.length === 0 ? (
            <List>
              <Skeleton shape="block" height={72} />
              <Skeleton shape="block" height={72} />
              <Skeleton shape="block" height={72} />
            </List>
          ) : results.length === 0 ? (
            <EmptyState
              title={`No matches for “${submitted}”`}
              body="Try fewer words, or clear the filters. Private maps you cannot see are never included."
              action={
                <Button
                  variant="secondary"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  Clear filters
                </Button>
              }
            />
          ) : view === 'map' ? (
            <MapHolder>
              <ResultMap query={submitted} results={results} />
            </MapHolder>
          ) : (
            <List>
              {results.map((result, index) => (
                <ResultCard
                  key={`${result.group}:${result.id}`}
                  result={result}
                  query={submitted}
                  onOpen={() =>
                    track('search_result_opened', {
                      result_type: result.group,
                      position: index,
                    })
                  }
                />
              ))}
            </List>
          )}

          {/*
            §11's assumption made concrete: external web search is not in the
            index, so the empty-and-thin-result moment routes into
            Link-to-Mind-Map instead of into nothing.
          */}
          <LinkToMapRow>
            <span
              style={{
                color: 'var(--ground-muted)',
                fontSize: 'var(--text-label)',
              }}
            >
              {/*
                §12 step 1: "Also accept a URL pasted directly into search —
                detect and offer." Someone who pastes a link into search has
                already told us what they want; making them retype it into a
                different field is the kind of small tax that stops a feature
                being used.
              */}
              {looksLikeUrl(submitted)
                ? 'That looks like a link. Turn it into a map?'
                : 'Not in CDN? Turn a web page into a map.'}
            </span>
            <Link href={linkToMapHref}>
              <Button variant="secondary">Link-to-Mind-Map</Button>
            </Link>
          </LinkToMapRow>
        </>
      )}

      {/* §11: "Without this, search becomes a trapdoor." */}
      <ReturnBar>
        <ReturnLink
          href={snapshot ? restoreHref(snapshot) : routes.map}
          onClick={() =>
            track('search_returned_to_map', { restored: Boolean(snapshot) })
          }
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 3.5 5.5 8l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to {snapshot?.label ?? 'Central Node'}
        </ReturnLink>
      </ReturnBar>
    </Wrap>
  );
}
