'use client';

import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Sheet } from '@/components/ui';
import { relativeTime } from './NotificationRow';

/**
 * ActivityPanel — §14: "Map menu → Activity: who changed what, when. Append-only
 * log. Cheap to build, disproportionately trust-building."
 *
 * That last phrase is the reason this exists at MVP scale. On a shared map, the
 * question people ask first is not "what changed" but "who changed it" — and
 * being able to answer that is most of what makes a shared document feel safe
 * to work in.
 */

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  min-height: 0;
`;

const Filters = styled.div`
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
`;

const Select = styled.select`
  min-height: var(--control-inputHeight);
  padding: 0 var(--space-2);

  background: var(--ground-background);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-label);
`;

const List = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
  min-height: 0;
`;

const Entry = styled.li`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--ground-border);
`;

const Line = styled.span`
  font-size: var(--text-body);
  color: var(--ground-ink);
`;

const When = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Empty = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-muted);
`;

interface ActivityEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string;
  createdAt: string;
}

/** Past tense, human. An action code shown raw reads like a log file. */
const PHRASE: Record<string, string> = {
  node_added: 'added a node',
  node_removed: 'removed a node',
  node_renamed: 'renamed a node',
  node_moved: 'moved a node',
  map_created: 'created the map',
  map_renamed: 'renamed the map',
  map_shared: 'changed sharing',
  member_added: 'added a member',
  member_removed: 'removed a member',
  role_changed: 'changed a role',
  message: 'posted a message',
};

export function ActivityPanel({
  mapId,
  open,
  onClose,
}: {
  mapId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const params = new URLSearchParams();
      if (actor) params.set('actor', actor);
      if (action) params.set('action', action);

      const response = await fetch(`/api/maps/${mapId}/activity?${params}`);
      if (!response.ok) {
        if (!cancelled) setEntries([]);
        return;
      }
      const data = (await response.json()) as { activity: ActivityEntry[] };
      if (!cancelled) setEntries(data.activity);
    })();

    return () => {
      cancelled = true;
    };
  }, [mapId, open, actor, action]);

  /**
   * Filter options are derived from the entries in hand rather than fetched.
   * §15 asks for "filters by person and action"; a separate endpoint to list
   * who has ever touched a map is a second query for something the log already
   * says.
   */
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries ?? []) {
      if (entry.actorId) seen.set(entry.actorId, entry.actorName);
    }
    return [...seen.entries()];
  }, [entries]);

  const actions = useMemo(
    () => [...new Set((entries ?? []).map((entry) => entry.action))],
    [entries],
  );

  return (
    <Sheet open={open} onClose={onClose} title="Activity">
      <Body>
        <Filters>
          <Select
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            aria-label="Filter by person"
          >
            <option value="">Everyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>

          <Select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {actions.map((value) => (
              <option key={value} value={value}>
                {PHRASE[value] ?? value}
              </option>
            ))}
          </Select>
        </Filters>

        {entries === null && <Empty>Loading…</Empty>}
        {entries?.length === 0 && <Empty>Nothing recorded yet.</Empty>}

        {entries && entries.length > 0 && (
          <List>
            {entries.map((entry) => (
              <Entry key={entry.id}>
                <Line>
                  <strong>{entry.actorName}</strong>{' '}
                  {PHRASE[entry.action] ?? entry.action}
                  {entry.detail ? ` — ${entry.detail}` : ''}
                </Line>
                <When>{relativeTime(entry.createdAt)}</When>
              </Entry>
            ))}
          </List>
        )}
      </Body>
    </Sheet>
  );
}
