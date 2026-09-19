'use client';

import { useState } from 'react';
import styled from 'styled-components';
import { Button, Sheet } from '@/components/ui';
import { track } from '@/lib/analytics';

/**
 * ReportDialog — §15: "Report lives in the overflow of every node, map,
 * message and profile. One flow, one component, everywhere."
 *
 * The "everywhere" is the requirement, so this takes only a target type and an
 * id and knows nothing else about what it is reporting. A per-surface variant
 * would be four flows that drift apart, and the one that drifts is the one
 * nobody tested.
 */

const REASONS = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or self-harm' },
  { value: 'illegal', label: 'Illegal content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'copyright', label: 'Copyright' },
  { value: 'other', label: 'Something else' },
];

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-3) 0;
`;

const Intro = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-muted);
`;

const Reasons = styled.fieldset`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: none;
`;

const Legend = styled.legend`
  padding: 0 0 var(--space-2);
  font-size: var(--text-label);
  color: var(--ground-ink);
`;

const Option = styled.label`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-minHitTarget);
  font-size: var(--text-body);
  color: var(--ground-ink);
  cursor: pointer;
`;

const Radio = styled.input`
  width: 18px;
  height: 18px;
  accent-color: var(--color-focus);
`;

const Detail = styled.textarea`
  width: 100%;
  min-height: 90px;
  padding: var(--space-3);
  resize: vertical;

  background: var(--ground-background);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);

  &:focus {
    outline: none;
    border-color: var(--color-focus);
  }
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
`;

const Sent = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--ground-raised);
  border: 1px solid var(--color-success);
  border-radius: var(--radius-card);
`;

export type ReportTarget = 'node' | 'map' | 'message' | 'user';

export interface ReportDialogProps {
  open: boolean;
  targetType: ReportTarget;
  targetId: string;
  /** What is being reported, for the sentence at the top. */
  label?: string;
  onClose: () => void;
}

export function ReportDialog({
  open,
  targetType,
  targetId,
  label,
  onClose,
}: ReportDialogProps) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet open={open} onClose={onClose} title="Report" placement="center">
      {sent ? (
        <Sent role="status">
          <strong>Thanks — that has been sent to our moderators.</strong>
          <Intro>
            We review every report. You will not usually hear back, but it is read.
          </Intro>
          <Actions>
            <Button onClick={onClose}>Close</Button>
          </Actions>
        </Sent>
      ) : (
        <Body>
          <Intro>
            Reporting {label ? `“${label}”` : `this ${targetType}`}. Tell us what is
            wrong and a moderator will look.
          </Intro>

          {error && <Intro role="alert">{error}</Intro>}

          {/*
            A fieldset with a legend, not a bare list of radios. Without it a
            screen reader reads nine unrelated options with no idea what
            question they answer.
          */}
          <Reasons>
            <Legend>Why are you reporting this?</Legend>
            {REASONS.map((option) => (
              <Option key={option.value}>
                <Radio
                  type="radio"
                  name="report-reason"
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                />
                {option.label}
              </Option>
            ))}
          </Reasons>

          <label>
            <Legend as="span">Anything else? (optional)</Legend>
            <Detail
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={1000}
              aria-label="More detail"
            />
          </label>

          <Actions>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!reason || busy}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const response = await fetch('/api/reports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetType, targetId, reason, detail }),
                  });
                  if (!response.ok) {
                    const data = (await response.json()) as { error?: string };
                    setError(data.error ?? 'That did not send. Try again.');
                    return;
                  }
                  track('content_reported', { target_type: targetType });
                  setSent(true);
                } catch {
                  setError('That did not send. Check your connection.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send report
            </Button>
          </Actions>
        </Body>
      )}
    </Sheet>
  );
}
