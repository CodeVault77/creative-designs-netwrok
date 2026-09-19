'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, useToast } from '@/components/ui';

/**
 * The approval queue.
 *
 * â”€â”€ Reject is not the destructive option â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Both buttons are ordinary. Approving lets automated work proceed on a map;
 * rejecting stops it and costs nothing. Styling reject as the dangerous one â€”
 * the reflex â€” would push people toward approving to avoid the scary button,
 * which is exactly backwards for a gate that exists to slow things down.
 *
 * â”€â”€ A decided approval disappears from the list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Deliberately not "greyed out with a tick". Someone working through a queue
 * needs to know what is left, and a list where finished items linger makes the
 * remaining count something you have to work out by eye.
 */

export interface Approval {
  id: string;
  prompt: string;
  runId: string;
  createdAt: string;
}

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const Prompt = styled.p`
  margin: 0 0 var(--space-4);
  font-size: var(--text-body);
  line-height: 1.6;
  color: var(--ground-ink);
  text-wrap: pretty;
`;

const Meta = styled.p`
  margin: 0 0 var(--space-2);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Row = styled.div`
  display: flex;
  gap: var(--space-3);
`;

const Empty = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: 1.6;
`;

export function ApprovalQueue({ mapId }: { mapId: string }) {
  const toast = useToast();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/approvals?mapId=${encodeURIComponent(mapId)}`,
    );
    if (response.ok) {
      const body = (await response.json()) as { approvals: Approval[] };
      setApprovals(body.approvals);
    }
    setLoading(false);
  }, [mapId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (approvalId: string, approved: boolean) => {
      setBusy(approvalId);
      try {
        const response = await fetch('/api/approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approvalId, approved }),
        });

        if (!response.ok) {
          /*
           * A 409 means someone else decided first. Reloading is the right
           * response, and saying so beats an error the user cannot act on.
           */
          toast.show({
            tone: 'danger',
            message:
              response.status === 409
                ? 'Someone else already decided that one.'
                : 'That did not work.',
          });
          await load();
          return;
        }

        toast.show({
          tone: 'success',
          message: approved ? 'Approved â€” the run continues.' : 'Rejected.',
        });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load, toast],
  );

  if (loading) return <Empty>Loadingâ€¦</Empty>;

  if (approvals.length === 0) {
    return <Empty>Nothing is waiting for a decision.</Empty>;
  }

  return (
    <List>
      {approvals.map((approval) => (
        <li key={approval.id}>
          <Card>
            <Meta>Run {approval.runId}</Meta>
            <Prompt>{approval.prompt}</Prompt>

            <Row>
              <Button
                disabled={busy === approval.id}
                onClick={() => decide(approval.id, true)}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={busy === approval.id}
                onClick={() => decide(approval.id, false)}
              >
                Reject
              </Button>
            </Row>
          </Card>
        </li>
      ))}
    </List>
  );
}
