'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The client half of the realtime channel.
 *
 * §20's risk for this phase is "realtime cost and reconnection", and this hook
 * is where the client-side answer lives:
 *
 *   - **Reconnection is the browser's job, mostly.** `EventSource` reconnects
 *     on its own and resends the last id it saw as `Last-Event-ID`, which the
 *     server replays from. What the browser will not do is give up gracefully,
 *     so the backoff and the "reconnecting" state below exist for the case
 *     where the server is actually down.
 *
 *   - **Cost is bounded by the heartbeat, not by polling.** One presence POST
 *     every 20 seconds per open map, and no request at all when the tab is
 *     hidden — a backgrounded tab that keeps heartbeating is a bill for
 *     nothing, and it also keeps a ghost in everyone else's avatar stack.
 */

export interface ChannelMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  body: string;
  nodeRef: string | null;
  nodeTitle: string | null;
  createdAt: string;
}

export interface ChannelPresence {
  userId: string;
  name: string;
  handle: string;
  selectedId: string | null;
}

export interface ChannelLock {
  nodeId: string;
  userId: string;
  name: string;
}

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** Comfortably under the server's 45s presence TTL, so one dropped beat is survivable. */
const HEARTBEAT_MS = 20_000;

export interface MapChannel {
  messages: ChannelMessage[];
  present: ChannelPresence[];
  locks: ChannelLock[];
  state: ConnectionState;
  send: (body: string) => Promise<string | null>;
  /** Take or renew the soft lock. Resolves to null on success, or the reason. */
  lock: (nodeId: string) => Promise<string | null>;
  unlock: (nodeId: string) => void;
  setSelected: (nodeId: string | null) => void;
}

export function useMapChannel(mapId: string, enabled = true): MapChannel {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [present, setPresent] = useState<ChannelPresence[]>([]);
  const [locks, setLocks] = useState<ChannelLock[]>([]);
  const [state, setState] = useState<ConnectionState>('connecting');

  const selectedRef = useRef<string | null>(null);

  // ---------------------------------------------------------------- the log
  const loadMessages = useCallback(async () => {
    const response = await fetch(`/api/maps/${mapId}/chat`);
    if (!response.ok) return;
    const data = (await response.json()) as { messages: ChannelMessage[] };
    setMessages(data.messages);
  }, [mapId]);

  useEffect(() => {
    if (!enabled) return;
    void loadMessages();
  }, [enabled, loadMessages]);

  // ------------------------------------------------------------ the stream
  useEffect(() => {
    if (!enabled) return;

    let source: EventSource | null = null;
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      source = new EventSource(`/api/maps/${mapId}/stream`);

      source.addEventListener('ready', () => {
        attempt = 0;
        setState('live');
      });

      /**
       * A message event carries only the id. The body is fetched from the
       * REST endpoint, which is the same path a cold load takes — so there is
       * one way a message reaches the screen rather than two that can drift.
       */
      source.addEventListener('message', () => {
        void loadMessages();
      });

      source.addEventListener('node_changed', () => {
        void loadMessages();
      });

      source.onerror = () => {
        if (closed) return;

        /**
         * EventSource retries by itself and resends Last-Event-ID, so the
         * usual blip needs no help. This branch is for a server that is
         * actually gone: close it, back off, and try again — otherwise the
         * browser hammers a dead endpoint at its own fixed interval.
         */
        setState(attempt === 0 ? 'reconnecting' : 'offline');
        source?.close();
        attempt += 1;

        const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [mapId, enabled, loadMessages]);

  // --------------------------------------------------------- the heartbeat
  useEffect(() => {
    if (!enabled) return;

    const beat = async () => {
      // A hidden tab is not present. Heartbeating from one is a bill for
      // nothing, and it leaves a ghost in everyone else's avatar stack.
      if (document.visibilityState !== 'visible') return;

      const response = await fetch(`/api/maps/${mapId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedId: selectedRef.current }),
      }).catch(() => null);

      if (!response?.ok) return;
      const data = (await response.json()) as {
        present: ChannelPresence[];
        locks: ChannelLock[];
      };
      setPresent(data.present);
      setLocks(data.locks);
    };

    void beat();
    const timer = setInterval(beat, HEARTBEAT_MS);

    // Beat immediately on becoming visible, so someone returning to the tab
    // reappears at once rather than after up to twenty seconds of absence.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void beat();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mapId, enabled]);

  // ------------------------------------------------------------- actions
  const send = useCallback(
    async (body: string) => {
      const response = await fetch(`/api/maps/${mapId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });

      const data = (await response.json()) as {
        message?: ChannelMessage;
        error?: string;
      };

      if (!response.ok || !data.message) return data.error ?? 'Could not send';

      // Appended locally rather than waiting for the round trip through the
      // stream: the sender should see their own message immediately, and the
      // reload the stream triggers will reconcile it.
      setMessages((current) =>
        current.some((m) => m.id === data.message!.id)
          ? current
          : [...current, data.message!],
      );
      return null;
    },
    [mapId],
  );

  const lock = useCallback(
    async (nodeId: string) => {
      const response = await fetch(`/api/maps/${mapId}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      }).catch(() => null);

      if (!response?.ok) return 'Could not reach the server';

      const data = (await response.json()) as {
        ok: boolean;
        message: string | null;
      };
      return data.ok ? null : (data.message ?? 'Someone else is editing this.');
    },
    [mapId],
  );

  const unlock = useCallback(
    (nodeId: string) => {
      /**
       * `keepalive`, because this fires as the sheet closes and sometimes as
       * the page unloads — an ordinary fetch is cancelled on navigation, and
       * the lock would then sit until its lease expired.
       */
      void fetch(`/api/maps/${mapId}/lock?nodeId=${encodeURIComponent(nodeId)}`, {
        method: 'DELETE',
        keepalive: true,
      }).catch(() => undefined);
    },
    [mapId],
  );

  const setSelected = useCallback((nodeId: string | null) => {
    selectedRef.current = nodeId;
  }, []);

  return { messages, present, locks, state, send, lock, unlock, setSelected };
}
