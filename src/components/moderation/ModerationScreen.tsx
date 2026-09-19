'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button } from '@/components/ui';

/**
 * Screen 21 — the moderation queue (§15).
 *
 * "Moderation queue with actions: dismiss, warn, unpublish, remove, suspend.
 * Every action written to an audit trail."
 *
 * The queue is ordered by how many people reported the same thing, not by
 * time. Ten reports on one node is the signal; the oldest report in the list
 * usually is not.
 */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-6);
  max-width: 940px;
  margin: 0 auto;
  width: 100%;
`;

const Title = styled.h1`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-l);
  color: var(--ground-ink);
`;

const Tabs = styled.div`
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
`;

const List = styled.ul`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Card = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
`;

const Tag = styled.span`
  padding: 1px var(--space-2);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Loud = styled.span`
  padding: 1px var(--space-2);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-pill);
  font-size: var(--text-caption);
  color: var(--color-warning);
`;

const Detail = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-ink);
  overflow-wrap: anywhere;
`;

const Meta = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  font-family: var(--face-mono);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding-top: var(--space-2);
  border-top: 1px solid var(--ground-border);
`;

const Empty = styled.p`
  margin: 0;
  padding: var(--space-6);
  text-align: center;
  color: var(--ground-muted);
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-sheet);
`;

const AuditList = styled.ol`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const AuditRowItem = styled.li`
  display: flex;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--ground-border);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

interface Report {
  id: string;
  targetType: string;
  targetId: string;
  reporterName: string;
  reason: string;
  detail: string;
  status: string;
  createdAt: string;
  reportCount: number;
}

interface Audit {
  id: string;
  moderatorName: string;
  action: string;
  targetType: string;
  targetId: string;
  note: string;
  createdAt: string;
}

/**
 * §15's five actions, ordered least to most destructive, with the reversible
 * ones first. A queue that puts Remove next to Dismiss gets Remove pressed by
 * accident on a tired afternoon.
 */
const ACTIONS: { value: string; label: string; destructive?: boolean }[] = [
  { value: 'dismiss', label: 'Dismiss' },
  { value: 'warn', label: 'Warn' },
  { value: 'unpublish', label: 'Unpublish' },
  { value: 'remove', label: 'Remove', destructive: true },
  { value: 'suspend', label: 'Suspend', destructive: true },
];

export function ModerationScreen() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [status, setStatus] = useState('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'queue' | 'audit'>('queue');

  const load = useCallback(async () => {
    const response = await fetch(`/api/moderation?status=${status}`);
    if (!response.ok) {
      setReports([]);
      return;
    }
    const data = (await response.json()) as { reports: Report[]; audit: Audit[] };
    setReports(data.reports);
    setAudit(data.audit);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (reportId: string, action: string) => {
      const destructive = ACTIONS.find((a) => a.value === action)?.destructive;
      if (
        destructive &&
        !window.confirm(
          `${action === 'remove' ? 'Remove this content' : 'Suspend this account'}? This cannot be undone.`,
        )
      ) {
        return;
      }

      setBusy(reportId);
      try {
        await fetch('/api/moderation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId, action }),
        });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  return (
    <Page>
      <Title>Moderation</Title>

      <Tabs>
        <Button
          size="sm"
          variant={tab === 'queue' ? 'primary' : 'ghost'}
          aria-pressed={tab === 'queue'}
          onClick={() => setTab('queue')}
        >
          Queue
        </Button>
        <Button
          size="sm"
          variant={tab === 'audit' ? 'primary' : 'ghost'}
          aria-pressed={tab === 'audit'}
          onClick={() => setTab('audit')}
        >
          Audit trail
        </Button>
      </Tabs>

      {tab === 'queue' && (
        <>
          <Tabs>
            {['open', 'actioned', 'dismissed'].map((value) => (
              <Button
                key={value}
                size="sm"
                variant={status === value ? 'secondary' : 'ghost'}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {value[0]!.toUpperCase() + value.slice(1)}
              </Button>
            ))}
          </Tabs>

          {reports === null && <Empty>Loading…</Empty>}
          {reports?.length === 0 && <Empty>Nothing in the {status} queue.</Empty>}

          {reports && reports.length > 0 && (
            <List>
              {reports.map((report) => (
                <Card key={report.id}>
                  <Head>
                    <Tag>{report.targetType}</Tag>
                    <Tag>{report.reason}</Tag>
                    {/* Ordered by this, so it is the thing shown loudest. */}
                    {report.reportCount > 1 && (
                      <Loud>{report.reportCount} reports on this</Loud>
                    )}
                    <Tag>by {report.reporterName}</Tag>
                  </Head>

                  {report.detail && <Detail>{report.detail}</Detail>}

                  <Meta>
                    {report.targetType}:{report.targetId} · {report.createdAt}
                  </Meta>

                  {report.status === 'open' && (
                    <Actions>
                      {ACTIONS.map((action) => (
                        <Button
                          key={action.value}
                          size="sm"
                          variant={action.destructive ? 'destructive' : 'secondary'}
                          disabled={busy === report.id}
                          onClick={() => void act(report.id, action.value)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </Actions>
                  )}
                </Card>
              ))}
            </List>
          )}
        </>
      )}

      {tab === 'audit' && (
        <>
          {audit.length === 0 ? (
            <Empty>No moderation actions recorded yet.</Empty>
          ) : (
            <AuditList>
              {audit.map((entry) => (
                <AuditRowItem key={entry.id}>
                  <strong>{entry.moderatorName}</strong>
                  <span>{entry.action}</span>
                  <span>
                    {entry.targetType}:{entry.targetId}
                  </span>
                  <span>{entry.createdAt}</span>
                </AuditRowItem>
              ))}
            </AuditList>
          )}
        </>
      )}
    </Page>
  );
}
