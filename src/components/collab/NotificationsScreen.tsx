'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button } from '@/components/ui';
import { NotificationRow, type NotificationItem } from './NotificationRow';

/** Screen 20 — the notification list. */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-6);
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
`;

const Head = styled.header`
  display: flex;
  align-items: center;
  gap: var(--space-3);
`;

const Title = styled.h1`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-l);
  color: var(--ground-ink);
`;

const Count = styled.span`
  margin-right: auto;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const Empty = styled.p`
  margin: 0;
  padding: var(--space-6);
  text-align: center;
  font-size: var(--text-body);
  color: var(--ground-muted);
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-sheet);
`;

export function NotificationsScreen() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch('/api/notifications');
    if (!response.ok) {
      setItems([]);
      return;
    }
    const data = (await response.json()) as {
      notifications: NotificationItem[];
      unread: number;
    };
    setItems(data.notifications);
    setUnread(data.unread);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = useCallback(async (ids: string[] | 'all') => {
    /**
     * Optimistic, because this is the last thing someone does before leaving
     * the screen — often by clicking a row, which navigates away. Waiting for
     * the response to update the UI means the change is never seen.
     */
    setItems(
      (current) =>
        current?.map((item) =>
          ids === 'all' || ids.includes(item.id) ? { ...item, read: true } : item,
        ) ?? null,
    );
    setUnread((current) => (ids === 'all' ? 0 : Math.max(0, current - ids.length)));

    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  return (
    <Page>
      <Head>
        <Title>Notifications</Title>
        <Count>{unread > 0 ? `${unread} unread` : 'All caught up'}</Count>
        {unread > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void markRead('all')}
          >
            Mark all read
          </Button>
        )}
      </Head>

      {items === null && <Empty>Loading…</Empty>}

      {items?.length === 0 && (
        <Empty>Nothing yet. Activity on maps you share will show up here.</Empty>
      )}

      {items && items.length > 0 && (
        <List>
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              notification={item}
              onOpen={(id) => void markRead([id])}
            />
          ))}
        </List>
      )}
    </Page>
  );
}
