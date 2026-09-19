'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styled from 'styled-components';
import { Button, TextField, useToast } from '@/components/ui';
import { track } from '@/lib/analytics';
import type { StructuredNode } from '@/lib/ingest/tree';
import type {
  IngestEvent,
  FailureCopy,
  IngestFailure,
  Stage,
} from '@/lib/ingest/contract';
/*
 * `@/lib/ingest/tree`, never `@/lib/ingest/structure`.
 *
 * This is a client component, and `structure.ts` imports the AI gateway,
 * which is `server-only`. A VALUE import from it pulls that whole graph
 * toward the browser bundle and fails the build with an error naming a
 * module this file has never heard of.
 */
import { countNodes } from '@/lib/ingest/tree';
import { bake, merge as mergeNodes, reparent } from '@/lib/ingest/edits';
import { countIncluded } from '@/lib/ingest/to-draft';
import { UrlField, looksLikeUrl, type UrlPreview } from './UrlField';
import { ProgressStages } from './ProgressStages';
import { StructurePreview } from './StructurePreview';
import { NodeChecklist } from './NodeChecklist';

/**
 * Screen 14 — Link-to-Mind-Map.
 *
 * §12 walks nine steps; this component is the state machine behind them. One
 * screen with four phases rather than four routes, because the URL, the
 * progress and the preview are one continuous act — routing between them would
 * put a back button in the middle of a fifteen-second operation.
 */

type Phase = 'paste' | 'running' | 'preview' | 'failed';

/**
 * §12's failure taxonomy is finer than the analytics one — the plan asks for
 * five reasons so we can fix the common one, and several transport-level
 * causes collapse into "unreachable" for that purpose.
 */
const ANALYTICS_REASON: Record<
  IngestFailure,
  'unreachable' | 'robots' | 'paywall' | 'thin' | 'model_timeout'
> = {
  unreachable: 'unreachable',
  'blocked-address': 'unreachable',
  'rate-limited': 'unreachable',
  'blocked-by-robots': 'robots',
  'auth-required': 'paywall',
  'too-thin': 'thin',
  'model-failed': 'model_timeout',
};

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-6);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
`;

const Header = styled.header`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 560px;
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
`;

const Split = styled.div`
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: var(--space-6);
  min-height: 480px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const Side = styled.aside`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
`;

const Confirm = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid var(--ground-border);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
`;

const DepthRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Failure = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 520px;
  padding: var(--space-6);
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-sheet);
`;

const FailureTitle = styled.h2`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const FailureBody = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-muted);
`;

const Private = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Textarea = styled.textarea`
  width: 100%;
  min-height: 160px;
  padding: var(--space-3);
  background: var(--ground-background);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);
  resize: vertical;

  &:focus {
    outline: none;
    border-color: var(--color-focus);
  }
`;

export function LinkScreen({
  initialUrl = '',
  entrySource = 'ring_node',
}: {
  initialUrl?: string;
  /** Which of §12 step 1's three entries brought the user here. */
  entrySource?: 'ring_node' | 'editor' | 'search_empty';
}) {
  const router = useRouter();
  const { show: showToast } = useToast();

  const [phase, setPhase] = useState<Phase>('paste');
  const [url, setUrl] = useState(initialUrl);
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [resolving, setResolving] = useState(false);

  const [stage, setStage] = useState<Stage | null>(null);
  const [pageTitle, setPageTitle] = useState<string>('');

  const [structure, setStructure] = useState<StructuredNode | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [degraded, setDegraded] = useState<IngestFailure | null>(null);

  const [depth, setDepth] = useState<2 | 3>(3);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [renamed, setRenamed] = useState<ReadonlyMap<string, string>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [mapName, setMapName] = useState('');
  const [saving, setSaving] = useState(false);

  const [failure, setFailure] = useState<{
    failure: IngestFailure;
    copy: FailureCopy;
  } | null>(null);
  const [pastedText, setPastedText] = useState('');

  const sourceRef = useRef<EventSource | null>(null);
  const startedAt = useRef(0);

  // ------------------------------------------------------------- step 3
  /**
   * §12: "Resolving the title before processing is the trust moment. Do it in
   * <800 ms." Debounced, because it fires while the user is still typing and
   * a request per keystroke would neither be fast nor polite.
   */
  useEffect(() => {
    if (!looksLikeUrl(url)) {
      setPreview(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setResolving(true);
      try {
        const response = await fetch('/api/ingest/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
        const data = (await response.json()) as UrlPreview;
        setPreview(data);
        if (data.ok && data.title && !mapName) setMapName(data.title.slice(0, 60));
      } catch {
        // An aborted or failed preview is not worth an error: the run itself
        // will produce a specific message, and this is only a reassurance.
        setPreview(null);
      } finally {
        setResolving(false);
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ------------------------------------------------------------- step 4
  const start = useCallback(() => {
    if (!looksLikeUrl(url)) return;

    setPhase('running');
    startedAt.current = performance.now();
    setStage(null);
    setFailure(null);
    setDegraded(null);
    track('link_to_map_started', { source: entrySource });

    const source = new EventSource(
      `/api/ingest/run?url=${encodeURIComponent(url)}`,
    );
    sourceRef.current = source;

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as IngestEvent;

      if (event.type === 'stage') setStage(event.stage);

      if (event.type === 'meta') {
        setPageTitle(event.title);
        // §12 step 7: "Name field prefilled with the page title."
        setMapName((current) => current || event.title.slice(0, 60));
      }

      if (event.type === 'done') {
        setStructure(event.result.root);
        setSourceUrl(event.sourceUrl);
        setDegraded(event.degraded ?? null);
        setMapName((current) => current || event.result.title.slice(0, 60));
        setExcluded(new Set());
        setRenamed(new Map());
        setPhase('preview');
        track('link_to_map_generated', {
          node_count: countNodes(event.result.root),
          depth: 3,
          ms: Math.round(performance.now() - startedAt.current),
        });
        source.close();
      }

      if (event.type === 'error') {
        setFailure({ failure: event.failure, copy: event.copy });
        setPhase('failed');
        track('link_to_map_failed', { reason: ANALYTICS_REASON[event.failure] });
        source.close();
      }
    };

    /**
     * A transport error — the connection dropped, not a failure the pipeline
     * reported. Without this the screen would sit on "Fetching" for ever.
     */
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return;
      source.close();
      setFailure(
        (current) =>
          current ?? {
            failure: 'unreachable',
            copy: {
              title: 'The connection dropped',
              body: 'Check your network and try again.',
              retryable: true,
              fallback: 'retry',
            },
          },
      );
      setPhase((current) => (current === 'running' ? 'failed' : current));
    };
  }, [url, entrySource]);

  // §12: "Cancel available throughout." Closing the EventSource aborts the
  // request, which aborts the pipeline between stages and the model mid-call.
  const cancel = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setPhase('paste');
    setStage(null);
  }, []);

  useEffect(() => () => sourceRef.current?.close(), []);

  // ------------------------------------------------------------- step 6
  const toggle = useCallback((id: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rename = useCallback((id: string, title: string) => {
    setRenamed((current) => new Map(current).set(id, title));
  }, []);

  /**
   * Structural edits bake the pending toggles and renames into the tree first,
   * then clear them — positional ids shift when a node moves, so keeping the
   * side tables would silently re-point every one of them. See edits.ts.
   */
  const applyStructural = useCallback((next: StructuredNode | null) => {
    if (!next) return;
    setStructure(next);
    setExcluded(new Set());
    setRenamed(new Map());
    setSelectedId(null);
  }, []);

  const handleReparent = useCallback(
    (nodeId: string, newParentId: string) => {
      if (!structure) return;
      applyStructural(
        reparent({ root: structure, excluded, renamed }, nodeId, newParentId),
      );
    },
    [structure, excluded, renamed, applyStructural],
  );

  const handleMerge = useCallback(
    (nodeId: string) => {
      if (!structure) return;
      applyStructural(mergeNodes({ root: structure, excluded, renamed }, nodeId));
    },
    [structure, excluded, renamed, applyStructural],
  );

  // ------------------------------------------------------------- step 8
  const save = useCallback(async () => {
    if (!structure || !mapName.trim()) return;
    setSaving(true);

    try {
      const response = await fetch('/api/ingest/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: mapName.trim(),
          sourceUrl,
          depth,
          excluded: [],
          // Baked, so the server receives exactly the tree the user approved
          // rather than a tree plus a set of instructions to reapply.
          structure: bake({ root: structure, excluded, renamed }),
        }),
      });

      const data = (await response.json()) as {
        id?: string;
        error?: string;
        editorHref?: string;
      };

      if (!response.ok) {
        if (response.status === 401) {
          router.push(`/sign-in?next=${encodeURIComponent('/link')}`);
          return;
        }
        showToast({
          tone: 'danger',
          message: data.error ?? 'That map could not be saved',
        });
        return;
      }

      track('link_to_map_saved', {
        map_id: data.id ?? '',
        nodes_kept: countIncluded(structure, excluded, depth),
        nodes_dropped:
          countNodes(structure) - countIncluded(structure, excluded, depth),
      });
      showToast({ tone: 'success', message: 'Map saved' });
      router.push(data.editorHref ?? `/maps/${data.id}`);
    } catch {
      showToast({ tone: 'danger', message: 'That map could not be saved' });
    } finally {
      setSaving(false);
    }
  }, [structure, mapName, sourceUrl, depth, excluded, renamed, router, showToast]);

  // ------------------------------------------------------------------ views

  if (phase === 'running') {
    return (
      <Page>
        <Header>
          <Title>Turning that page into a map</Title>
        </Header>
        <ProgressStages current={stage} pageTitle={pageTitle} onCancel={cancel} />
      </Page>
    );
  }

  if (phase === 'failed' && failure) {
    return (
      <Page>
        <Header>
          <Title>Link to Mind Map</Title>
        </Header>

        <Failure role="alert">
          <FailureTitle>{failure.copy.title}</FailureTitle>
          <FailureBody>{failure.copy.body}</FailureBody>

          <Actions>
            {/*
             * Retry is offered ONLY where retrying could work. §12 is explicit
             * that robots.txt gets no retry — the answer will not change, and
             * offering the button invites the user to argue with it.
             */}
            {failure.copy.retryable && <Button onClick={start}>Try again</Button>}

            {failure.copy.fallback === 'manual' && (
              <Link href="/maps/new">
                <Button variant="secondary">Build a map by hand</Button>
              </Link>
            )}

            {failure.failure === 'rate-limited' && (
              <Link href="/sign-up">
                <Button variant="secondary">Create an account</Button>
              </Link>
            )}

            <Button variant="ghost" onClick={() => setPhase('paste')}>
              Try another link
            </Button>
          </Actions>

          {/* §12: "Login or paywall — offer paste-text fallback." */}
          {failure.copy.fallback === 'paste-text' && (
            <>
              <FailureBody>Paste the text of the page instead:</FailureBody>
              <Textarea
                value={pastedText}
                aria-label="Page text"
                placeholder="Paste the article text here"
                onChange={(event) => setPastedText(event.target.value)}
              />
              <Actions>
                <Button
                  disabled={pastedText.trim().length < 120}
                  onClick={() => {
                    /**
                     * Structured client-side from the pasted text: we cannot
                     * fetch the page, and sending the text to the server would
                     * make us the store of someone's paywalled article.
                     */
                    setStructure(
                      structureFromText(pastedText, mapName || 'Pasted page'),
                    );
                    setSourceUrl('');
                    setDegraded(null);
                    setExcluded(new Set());
                    setRenamed(new Map());
                    setPhase('preview');
                  }}
                >
                  Use this text
                </Button>
              </Actions>
            </>
          )}
        </Failure>
      </Page>
    );
  }

  if (phase === 'preview' && structure) {
    const nodeCount = countIncluded(structure, excluded, depth);

    return (
      <Page>
        <Header>
          <Title>Check the map</Title>
          <Lede>
            {degraded === 'too-thin'
              ? "There wasn't much text on that page, so here's a starter map to build on."
              : 'Switch off anything you do not want, rename inline, or drag a node onto another to reparent it.'}
          </Lede>
        </Header>

        <Split>
          <StructurePreview
            root={structure}
            depth={depth}
            excluded={excluded}
            renamed={renamed}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReparent={handleReparent}
            note={degraded === 'too-thin' ? 'Starter map' : undefined}
          />

          <Side>
            <DepthRow>
              {/* §12 step 5: "Depth control: 2 or 3 levels." */}
              <span id="depth-label">Depth</span>
              <Button
                size="sm"
                variant={depth === 2 ? 'primary' : 'ghost'}
                onClick={() => setDepth(2)}
                aria-pressed={depth === 2}
              >
                2 levels
              </Button>
              <Button
                size="sm"
                variant={depth === 3 ? 'primary' : 'ghost'}
                onClick={() => setDepth(3)}
                aria-pressed={depth === 3}
              >
                3 levels
              </Button>
            </DepthRow>

            <NodeChecklist
              root={structure}
              depth={depth}
              excluded={excluded}
              renamed={renamed}
              onToggle={toggle}
              onRename={rename}
              onMerge={handleMerge}
              onSelect={setSelectedId}
            />

            <Confirm>
              <TextField
                label="Map name"
                value={mapName}
                onChange={(event) => setMapName(event.target.value)}
                maxLength={60}
              />

              {/*
               * §12 step 7: "visibility defaults to Private... Private by
               * default is non-negotiable — the source may be paywalled or
               * personal." Stated rather than offered: there is no control
               * here to get wrong, and sharing is one click away afterwards.
               */}
              <Private>
                Saved as private. You can share it once you have looked it over.
              </Private>

              <Actions>
                <Button
                  onClick={save}
                  disabled={saving || !mapName.trim()}
                  loading={saving}
                >
                  Save {nodeCount} nodes
                </Button>
                <Button variant="ghost" onClick={() => setPhase('paste')}>
                  Start over
                </Button>
              </Actions>
            </Confirm>
          </Side>
        </Split>
      </Page>
    );
  }

  return (
    <Page>
      <Header>
        <Title>Link to Mind Map</Title>
        <Lede>Paste a link to a public web page and get a map you can edit.</Lede>
      </Header>

      <UrlField
        value={url}
        onChange={setUrl}
        onSubmit={start}
        preview={preview}
        resolving={resolving}
      />
    </Page>
  );
}

/**
 * The paste-text fallback's structurer.
 *
 * Deliberately crude — it splits on blank lines and takes the first sentence
 * of each block as a node. Someone who has pasted text has already been told
 * we could not read the page; a rough map they can edit beats a second
 * failure, and the real editor is one save away.
 */
function structureFromText(text: string, title: string): StructuredNode {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 40)
    .slice(0, 8);

  return {
    title,
    summary: '',
    children: blocks.map((block) => {
      const firstSentence = block.split(/(?<=[.!?])\s/)[0] ?? block;
      return {
        title: firstSentence.slice(0, 60),
        summary: block.slice(0, 240),
        children: [],
      };
    }),
  };
}
