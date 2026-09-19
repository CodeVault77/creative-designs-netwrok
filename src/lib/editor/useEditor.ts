'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  breakCoalescing,
  canRedo,
  canUndo,
  createStack,
  describeLast,
  push,
  redo,
  undo,
  type StackState,
} from './stack';
import { isDirty, markSaved, toGraph } from './draft';
import type { Command } from './commands';
import type { MapDraft, SaveStatus } from './types';
import { track } from '@/lib/analytics';

/**
 * The editor: draft, command stack, autosave, local persistence.
 *
 * §14: "Autosave, debounced 800ms... No Save button. A Save button in a canvas
 * editor is a bug report waiting to happen."
 *
 * ── Why the draft is local-first ────────────────────────────────────────────
 *
 * Every command applies synchronously to the in-memory draft and is persisted
 * to localStorage immediately. The network save runs behind that. Three things
 * follow, and all three are the point:
 *
 *   - an edit is never waiting on a round trip;
 *   - closing the tab mid-edit loses nothing;
 *   - working offline is not a special mode, it is just a slow save.
 */

const AUTOSAVE_MS = 800;
const STORAGE_PREFIX = 'cdn.draft.';

export interface EditorApi {
  draft: MapDraft;
  graph: ReturnType<typeof toGraph>;
  selectedId: string | null;
  status: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  /** e.g. "delete node", for the undo bar. */
  lastAction: string | null;

  select: (nodeId: string | null) => void;
  run: (command: Command | null) => void;
  undo: () => void;
  redo: () => void;
  /** Ends the current coalescing run — call on blur and on selection change. */
  commit: () => void;
  /** Retries a failed save. */
  retry: () => void;
  /** Discards the local draft and reloads the server copy after a conflict. */
  reloadFromServer: () => void;
}

export function useEditor(initial: MapDraft): EditorApi {
  const [state, setState] = useState<StackState>(() =>
    createStack(restore(initial)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  // ------------------------------------------------------------- persistence

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_PREFIX + state.draft.id,
        JSON.stringify(state.draft),
      );
    } catch {
      // Quota or private mode. The in-memory draft still works; only the
      // survive-a-refresh guarantee is lost, and warning about it mid-edit
      // would be worse than the failure.
    }
  }, [state.draft]);

  // ---------------------------------------------------------------- autosave

  const save = useCallback(async () => {
    const draft = draftRef.current;
    if (!isDirty(draft) || saving.current) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline');
      return;
    }

    saving.current = true;
    setStatus('saving');

    try {
      const response = await fetch(`/api/maps/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: draft.version,
          title: draft.title,
          family: draft.family,
          visibility: draft.visibility,
          rootId: draft.rootId,
          nodes: draft.nodes,
        }),
      });

      if (response.status === 409) {
        // Someone else changed the map. This needs a decision from the user,
        // not a retry — retrying would either fail forever or, worse, succeed
        // and overwrite them.
        setStatus('conflict');
        return;
      }

      if (!response.ok) {
        setStatus('error');
        track('map_save_failed', {
          map_id: draft.id,
          reason: String(response.status),
        });
        return;
      }

      const { version, updatedAt } = await response.json();

      // Merge, do not replace: edits made while the request was in flight must
      // survive. Only the version and the dirty flags are taken from the
      // response.
      setState((current) => ({
        ...current,
        draft: markSaved(current.draft, version, updatedAt),
      }));

      setStatus('saved');
      track('map_autosaved', {
        map_id: draft.id,
        node_count: Object.keys(draft.nodes).length,
      });
    } catch {
      setStatus(navigator.onLine === false ? 'offline' : 'error');
      track('map_save_failed', { map_id: draft.id, reason: 'network' });
    } finally {
      saving.current = false;
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }, [save]);

  // Flush on unmount and on tab hide. `visibilitychange` rather than
  // `beforeunload`: mobile browsers frequently kill a backgrounded tab without
  // ever firing beforeunload, which is exactly when unsaved work is lost.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && isDirty(draftRef.current)) {
        void save();
      }
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [save]);

  // Coming back online retries whatever is pending.
  useEffect(() => {
    const onOnline = () => {
      if (isDirty(draftRef.current)) void save();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [save]);

  // -------------------------------------------------------------- operations

  const run = useCallback(
    (command: Command | null) => {
      // Null means "nothing to do" — a no-op edit, or a move that would create
      // a cycle. Builders return null rather than throwing so call sites stay
      // simple, and the stack must not record it.
      if (!command) return;

      setState((current) => {
        const next = push(current, command);
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const doUndo = useCallback(() => {
    setState((current) => {
      if (!canUndo(current)) return current;
      return undo(current);
    });
    scheduleSave();
  }, [scheduleSave]);

  const doRedo = useCallback(() => {
    setState((current) => {
      if (!canRedo(current)) return current;
      return redo(current);
    });
    scheduleSave();
  }, [scheduleSave]);

  const commit = useCallback(() => {
    setState((current) => breakCoalescing(current));
  }, []);

  /**
   * Undo and redo move the selection to whatever changed.
   *
   * This is the part §20 means by "subtle". Reversing an edit to a node the
   * user cannot see reads as the app losing work — they press undo, something
   * happens somewhere, and they have no way to confirm it was the right
   * something. The command carries the id; the editor follows it.
   */
  useEffect(() => {
    if (state.focusId && state.focusId !== selectedId) {
      setSelectedId(state.focusId);
    }
    // Intentionally not depending on selectedId: this reacts to stack moves,
    // not to the user selecting something.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.focusId]);

  const select = useCallback((nodeId: string | null) => {
    // Changing selection ends the coalescing run, so typing in one node and
    // then another never merges into a single undo step.
    setState((current) => breakCoalescing(current));
    setSelectedId(nodeId);
  }, []);

  // ---------------------------------------------------------------- keyboard

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== 'z') return;

      // Works while a form field has focus. That is the whole point: undo has
      // to mean the same thing on both surfaces, and the browser's native
      // field-level undo would otherwise take over inside an input and diverge
      // from the map's history.
      event.preventDefault();
      if (event.shiftKey) doRedo();
      else doUndo();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doUndo, doRedo]);

  // ------------------------------------------------------------------ derived

  const graph = useMemo(() => toGraph(state.draft), [state.draft]);

  return {
    draft: state.draft,
    graph,
    selectedId,
    status,
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    lastAction: describeLast(state),
    select,
    run,
    undo: doUndo,
    redo: doRedo,
    commit,
    retry: () => void save(),
    reloadFromServer: () => {
      try {
        window.localStorage.removeItem(STORAGE_PREFIX + draftRef.current.id);
      } catch {
        /* nothing to clear */
      }
      window.location.reload();
    },
  };
}

/**
 * Prefers a newer local draft over the server copy.
 *
 * Local-first means the buffer can legitimately be ahead — someone edited
 * offline, or closed the tab before a save landed. Taking the server copy
 * would throw that away, which is the one thing a local-first editor must
 * never do.
 *
 * A local draft on an OLDER version is stale (the server has moved on) and is
 * discarded.
 */
function restore(initial: MapDraft): MapDraft {
  if (typeof window === 'undefined') return initial;

  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + initial.id);
    if (!raw) return initial;

    const local = JSON.parse(raw) as MapDraft;
    if (local.id !== initial.id) return initial;
    if (local.version < initial.version) return initial;

    return local;
  } catch {
    return initial;
  }
}

export { AUTOSAVE_MS, STORAGE_PREFIX };
