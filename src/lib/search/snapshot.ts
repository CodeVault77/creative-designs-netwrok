'use client';

import type { Camera } from '@/lib/map/camera';

/**
 * The camera snapshot store.
 *
 * §11: "Every search entry captures a camera snapshot… restoring camera,
 * zoom, expansion set and selection exactly. **Without this, search becomes a
 * trapdoor.**"
 *
 * That is the whole design rationale. Someone exploring a map, three levels
 * deep, taps search to check something — and if returning drops them at the
 * root with everything collapsed, they have lost their place and the work of
 * getting there. They learn not to use search, which is expensive because §11
 * expects search to become the primary navigation for many people.
 *
 * ── Why sessionStorage ──────────────────────────────────────────────────────
 *
 * Not React state: search is a route change, and the map unmounts.
 * Not localStorage: a snapshot from last Tuesday is not where you were, and
 * restoring to it would be worse than not restoring at all. sessionStorage is
 * scoped to the tab and dies with it, which matches the lifetime of "where I
 * was just now".
 */

export interface MapSnapshot {
  /** Which map this snapshot belongs to. */
  mapId: string;
  camera: Camera;
  /** Which branches were open. */
  expandedIds: string[];
  selectedId: string | null;
  /** Which node was at the centre after descending (§09). */
  centreId: string;
  /** Where to go back to. */
  returnHref: string;
  /** Shown on the back bar — "Back to Central Node" or the map name. */
  label: string;
  takenAt: number;
}

const KEY = 'cdn.search.snapshot';

/**
 * Snapshots older than this are discarded on read.
 *
 * A tab left open overnight and returned to should not restore a camera from
 * before lunch — by then "where I was" is not where the person thinks they
 * were, and a surprising jump is worse than landing at the root.
 */
const MAX_AGE_MS = 60 * 60 * 1000;

export function captureSnapshot(snapshot: Omit<MapSnapshot, 'takenAt'>): void {
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...snapshot, takenAt: Date.now() }),
    );
  } catch {
    // Private mode or a full quota. Search still works; the back bar simply
    // falls back to the map root, which is a degraded return rather than a
    // broken one.
  }
}

export function readSnapshot(): MapSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;

    const snapshot = JSON.parse(raw) as MapSnapshot;

    if (!snapshot.mapId || !snapshot.camera) return null;
    if (Date.now() - snapshot.takenAt > MAX_AGE_MS) {
      clearSnapshot();
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * The URL that restores a snapshot.
 *
 * The snapshot id travels in the URL rather than the payload: the whole
 * camera in a query string is long, ugly, and would be shared by anyone who
 * copies the link — pasting someone else's exact zoom level is meaningless to
 * them. The URL says "restore", and the tab's own storage supplies what.
 */
export function restoreHref(snapshot: MapSnapshot): string {
  const url = new URL(snapshot.returnHref, 'http://local');
  url.searchParams.set('restore', '1');
  return `${url.pathname}${url.search}`;
}

/** Whether this navigation is a restore, so the map applies the snapshot. */
export function isRestoring(searchParams: URLSearchParams): boolean {
  return searchParams.get('restore') === '1';
}
