'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, TextField, useToast } from '@/components/ui';

/**
 * The global agent kill switch.
 *
 * ── Designed for the worst five minutes ─────────────────────────────────────
 *
 * Someone reaches this screen when an agent is doing damage and they need it
 * to stop. Everything follows from that:
 *
 *   - the current state is the largest thing on the screen, so nobody has to
 *     work out whether the last click landed;
 *   - stopping takes ONE click and no confirmation, because a confirmation
 *     dialog is a second thing to get right while panicking, and the action is
 *     trivially reversible;
 *   - RESUMING asks for nothing extra either, but it is the secondary button —
 *     the asymmetry is in the visual weight, not in the number of steps.
 *
 * ── The reason is asked for, not required ───────────────────────────────────
 *
 * Whoever finds agents stopped tomorrow needs to know why. Blocking the stop
 * until someone types a sentence would be exactly the wrong trade.
 */

const Status = styled.p<{ $stopped: boolean }>`
  margin: 0 0 var(--space-4);
  font-family: var(--face-display);
  font-size: var(--text-display-m);
  color: ${({ $stopped }) =>
    $stopped ? 'var(--color-danger)' : 'var(--fam-create-core)'};
`;

const Detail = styled.p`
  margin: 0 0 var(--space-4);
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Row = styled.div`
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  align-items: flex-end;
`;

interface Control {
  enabled: boolean;
  reason: string | null;
  updatedAt: string;
}

export function KillSwitchPanel() {
  const toast = useToast();
  const [control, setControl] = useState<Control | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/agent-controls');
    if (response.ok) {
      const body = (await response.json()) as { control: Control };
      setControl(body.control);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      try {
        const response = await fetch('/api/admin/agent-controls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, reason }),
        });

        if (!response.ok) {
          toast.show({ tone: 'danger', message: 'That did not work.' });
          return;
        }

        const body = (await response.json()) as { control: Control };
        setControl(body.control);
        setReason('');

        toast.show({
          tone: enabled ? 'success' : 'warning',
          message: enabled ? 'Agents can run again.' : 'Every agent is stopped.',
        });
      } finally {
        setBusy(false);
      }
    },
    [reason, toast],
  );

  if (!control) return <Detail>Loading…</Detail>;

  return (
    <Card>
      <Status $stopped={!control.enabled}>
        {control.enabled ? 'Agents are running' : 'Agents are STOPPED'}
      </Status>

      <Detail>
        {control.enabled
          ? 'Stopping halts every agent everywhere, including runs already in progress. It takes effect immediately and needs no deploy.'
          : (control.reason ?? 'No reason was recorded.')}
      </Detail>

      <Row>
        <div style={{ flex: '1 1 18rem' }}>
          <TextField
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="Optional, but whoever finds this tomorrow will want it."
          />
        </div>

        {control.enabled ? (
          <Button disabled={busy} onClick={() => set(false)}>
            Stop all agents
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => set(true)}>
            Let agents run
          </Button>
        )}
      </Row>
    </Card>
  );
}
