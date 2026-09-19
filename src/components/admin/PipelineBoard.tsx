'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, Select, TextField, useToast } from '@/components/ui';

/**
 * The services pipeline, for staff.
 *
 * â”€â”€ A list, not a drag-and-drop board â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Columns of draggable cards look like a pipeline and work badly as one: the
 * common operation is "move this on AND record what I quoted AND say when I
 * will chase it", which a drag cannot express. So each deal is a row that
 * edits in place, and the stage totals sit above it.
 *
 * â”€â”€ Overdue work is at the top â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Not marked red somewhere in a long list. The question this screen answers is
 * "what needs doing today", and an answer you have to scroll for is not one.
 */

const STAGES = ['lead', 'contacted', 'qualified', 'quoted', 'won', 'lost'] as const;
type Stage = (typeof STAGES)[number];

interface Entry {
  id: string;
  serviceSlug: string;
  name: string;
  email: string;
  company: string;
  message: string;
  budget: string;
  stage: Stage;
  ownerId: string | null;
  ownerHandle: string | null;
  quotedCents: number | null;
  nextActionAt: string | null;
  status: string;
  createdAt: string;
}

interface Summary {
  stage: Stage;
  count: number;
  quotedCents: number;
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const Totals = styled.div`
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  margin-bottom: var(--space-6);
`;

const Total = styled.div`
  padding: var(--space-3);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  background: var(--ground-surface);
`;

const Big = styled.p`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-m);
  line-height: 1;
`;

const Label = styled.p`
  margin: var(--space-1) 0 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
  text-transform: uppercase;
`;

const Row = styled.div<{ $late: boolean }>`
  padding: var(--space-4);
  margin-bottom: var(--space-3);
  border: 1px solid
    ${({ $late }) => ($late ? 'var(--color-warning)' : 'var(--ground-border)')};
  border-radius: var(--radius-card);
  background: var(--ground-surface);
`;

const Who = styled.h3`
  margin: 0;
  font-size: var(--text-title);
  overflow-wrap: anywhere;
`;

const Meta = styled.p`
  margin: var(--space-1) 0 var(--space-3);
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow-wrap: anywhere;
`;

const Message = styled.p`
  margin: 0 0 var(--space-3);
  color: var(--ground-muted);
  line-height: 1.6;
  overflow-wrap: anywhere;
`;

const Fields = styled.div`
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  align-items: end;
`;

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
  align-items: end;
`;

const Muted = styled.p`
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Heading = styled.h2`
  font-size: var(--text-title);
  margin: 0 0 var(--space-3);
`;

const Section = styled.section`
  margin-top: var(--space-8);
`;

/** Whether a follow-up date has passed. A closed deal is never late. */
function isLate(entry: Entry): boolean {
  if (!entry.nextActionAt) return false;
  if (entry.stage === 'won' || entry.stage === 'lost') return false;
  return new Date(entry.nextActionAt).getTime() <= Date.now();
}

/**
 * A stored timestamp to the `YYYY-MM-DD` a date input wants.
 *
 * Sliced rather than passed through `Date`, on purpose: the value is already a
 * calendar day, and round-tripping it through a Date shifts it by one for
 * anyone west of UTC â€” a follow-up quietly landing a day early.
 */
function asDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function EntryRow({
  entry,
  staffId,
  onSaved,
}: {
  entry: Entry;
  staffId: string;
  onSaved: (entry: Entry) => void;
}) {
  const toast = useToast();
  const [stage, setStage] = useState<Stage>(entry.stage);
  const [quote, setQuote] = useState(
    entry.quotedCents === null ? '' : String(entry.quotedCents / 100),
  );
  const [next, setNext] = useState(asDateInput(entry.nextActionAt));
  const [busy, setBusy] = useState(false);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const response = await fetch('/api/admin/pipeline', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: entry.id, ...body }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          entry?: Entry;
          error?: string;
        };

        if (!response.ok || !payload.entry) {
          toast.show({
            tone: 'danger',
            message: payload.error ?? 'Could not save.',
          });
          return;
        }

        onSaved(payload.entry);
        toast.show({ tone: 'success', message: 'Saved.' });
      } finally {
        setBusy(false);
      }
    },
    [entry.id, onSaved, toast],
  );

  const save = useCallback(() => {
    const trimmed = quote.trim();
    const amount = trimmed === '' ? null : Number(trimmed);

    if (amount !== null && !Number.isFinite(amount)) {
      toast.show({ tone: 'danger', message: 'That quote is not a number.' });
      return;
    }

    return patch({
      stage,
      // Dollars in the field, cents on the wire. Rounded here so a typed
      // "1200.005" cannot become a fraction of a cent in the database.
      quotedCents: amount === null ? null : Math.round(amount * 100),
      nextActionAt: next.trim() === '' ? null : next,
    });
  }, [next, patch, quote, stage, toast]);

  const mine = entry.ownerId === staffId;

  return (
    <Row $late={isLate(entry)}>
      <Who>
        {entry.name || 'No name given'}
        {entry.company && ` Â· ${entry.company}`}
      </Who>

      <Meta>
        {entry.serviceSlug} Â· <a href={`mailto:${entry.email}`}>{entry.email}</a>
        {entry.budget && ` Â· budget: ${entry.budget}`} Â·{' '}
        {new Date(entry.createdAt).toLocaleDateString()}
        {entry.ownerHandle ? ` Â· owner @${entry.ownerHandle}` : ' Â· unassigned'}
        {isLate(entry) && ' Â· OVERDUE'}
      </Meta>

      <Message>{entry.message}</Message>

      <Fields>
        <Select
          label="Stage"
          value={stage}
          onChange={(event) => setStage(event.target.value as Stage)}
          options={STAGES.map((value) => ({ value, label: value }))}
        />

        <TextField
          label="Quoted (USD)"
          inputMode="decimal"
          value={quote}
          onChange={(event) => setQuote(event.target.value)}
          placeholder="0.00"
        />

        <TextField
          label="Next action"
          type="date"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />

        <Button onClick={() => void save()} disabled={busy}>
          Save
        </Button>

        {/*
          Assignment is its own button rather than a field, because it is a
          single unambiguous act â€” I am taking this â€” and pairing it with the
          unsaved quote box would make claiming a deal also commit a number
          someone was still typing.
        */}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void patch({ ownerId: mine ? null : staffId })}
        >
          {mine ? 'Release' : 'Assign to me'}
        </Button>
      </Fields>
    </Row>
  );
}

export function PipelineBoard({ staffId }: { staffId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState<Summary[]>([]);
  const [late, setLate] = useState<Entry[]>([]);
  const [stage, setStage] = useState<'' | Stage>('');
  const [mine, setMine] = useState(false);
  const [closed, setClosed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (stage) params.set('stage', stage);
    if (mine) params.set('mine', '1');
    if (closed) params.set('closed', '1');

    const response = await fetch(`/api/admin/pipeline?${params.toString()}`);
    if (!response.ok) return;

    const body = (await response.json()) as {
      entries: Entry[];
      summary: Summary[];
      overdue: Entry[];
    };

    setEntries(body.entries);
    setTotals(body.summary);
    setLate(body.overdue);
    setLoaded(true);
  }, [closed, mine, stage]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * A saved row is patched in place rather than triggering a refetch. The
   * active filter can exclude what was just edited â€” moving a deal to `won`
   * while viewing the open list â€” and having the row you just saved vanish
   * reads as the save having failed.
   */
  const onSaved = useCallback((saved: Entry) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === saved.id ? saved : entry)),
    );
    setLate((current) =>
      current
        .map((entry) => (entry.id === saved.id ? saved : entry))
        .filter((entry) => isLate(entry)),
    );
  }, []);

  const openValue = totals
    .filter((total) => total.stage !== 'won' && total.stage !== 'lost')
    .reduce((sum, total) => sum + total.quotedCents, 0);

  return (
    <>
      <Totals>
        {totals.map((total) => (
          <Total key={total.stage}>
            <Big>{total.count}</Big>
            <Label>
              {total.stage}
              {total.quotedCents > 0 && ` Â· ${money(total.quotedCents)}`}
            </Label>
          </Total>
        ))}
      </Totals>

      <Card>
        <Big>{money(openValue)}</Big>
        <Label>quoted and still open</Label>
      </Card>

      {late.length > 0 && (
        <Section>
          <Heading>Overdue ({late.length})</Heading>
          {late.map((entry) => (
            <EntryRow
              key={`late-${entry.id}`}
              entry={entry}
              staffId={staffId}
              onSaved={onSaved}
            />
          ))}
        </Section>
      )}

      <Section>
        <Heading>Pipeline</Heading>

        <Toolbar>
          <Select
            label="Stage"
            value={stage}
            onChange={(event) => setStage(event.target.value as '' | Stage)}
            options={[
              { value: '', label: 'All open' },
              ...STAGES.map((value) => ({ value, label: value })),
            ]}
          />

          <Button
            variant={mine ? 'primary' : 'secondary'}
            onClick={() => setMine((value) => !value)}
          >
            {mine ? 'Mine only' : 'Everyone'}
          </Button>

          <Button
            variant={closed ? 'primary' : 'secondary'}
            onClick={() => setClosed((value) => !value)}
          >
            {closed ? 'Including closed' : 'Open only'}
          </Button>
        </Toolbar>

        {!loaded && <Muted>Loadingâ€¦</Muted>}

        {loaded && entries.length === 0 && (
          <Muted>
            Nothing here. Enquiries arrive from the service pages and start at the
            lead stage.
          </Muted>
        )}

        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            staffId={staffId}
            onSaved={onSaved}
          />
        ))}
      </Section>
    </>
  );
}
