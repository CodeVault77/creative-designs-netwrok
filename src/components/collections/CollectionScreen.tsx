'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import styled from 'styled-components';
import { Card, Chip } from '@/components/ui';

/**
 * A cross-map collection: Work, Commerce or Contacts.
 *
 * ── One screen, three destinations ──────────────────────────────────────────
 *
 * Tasks and invoices differ in which columns matter and in nothing else. Three
 * screens would have been three empty states to write, three filter bars to
 * keep in step and three places to fix the next layout bug. What actually
 * varies is a title, a type list and which payload fields are worth a column —
 * so that is what is passed in.
 *
 * ── Every row links back to its map ─────────────────────────────────────────
 *
 * This is a lens, not a second place where work lives. There is deliberately
 * no editing here: a task is a node, and nodes are edited on the map, where
 * their context is. An edit form on this screen would be a second way to
 * change a thing — and the two would drift.
 */

export interface CollectionItem {
  id: string;
  mapId: string;
  mapTitle: string;
  title: string;
  description: string | null;
  type: string;
  family: string;
  status: string;
  payload: Record<string, unknown>;
}

export interface CollectionScreenProps {
  title: string;
  blurb: string;
  items: CollectionItem[];
  counts: { type: string; count: number }[];
  totals: { valueCents: number; overdue: number; items: number };
  /** Show the money headline. False for Work, where it would always be zero. */
  showValue: boolean;
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** A payload string field, or empty. Payloads are validated but still loose. */
function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function amountOf(payload: Record<string, unknown>): number | null {
  for (const key of ['totalCents', 'amountCents', 'valueCents', 'priceCents']) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Whether an item's own date has passed.
 *
 * Repeated from the server's `totalsFor` rather than passed down, because the
 * server computed a COUNT and this needs it per row. Both read the same two
 * payload keys, and the shared rule — a finished item is never late — is
 * asserted on the server side where the number people act on is produced.
 */
function isLate(item: CollectionItem): boolean {
  const due = text(item.payload, 'dueAt');
  if (!due) return false;

  const status = text(item.payload, 'status');
  if (status === 'done' || status === 'paid' || status === 'met') return false;

  const at = new Date(due).getTime();
  return Number.isFinite(at) && at <= Date.now();
}

const Head = styled.header`
  margin-bottom: var(--space-6);
`;

const Title = styled.h1`
  margin: 0;
  font-size: var(--text-display-m);
`;

const Blurb = styled.p`
  margin: var(--space-2) 0 0;
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Stats = styled.div`
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  margin-bottom: var(--space-6);
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

const Tabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
`;

const TabButton = styled.button<{ $active: boolean }>`
  appearance: none;
  cursor: pointer;
  font: inherit;
  font-size: var(--text-label);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-pill);
  border: 1px solid
    ${({ $active }) => ($active ? 'var(--fam-create-core)' : 'var(--ground-border)')};
  background: ${({ $active }) =>
    $active ? 'var(--fam-create-core)' : 'transparent'};
  color: ${({ $active }) => ($active ? 'var(--ground-bg)' : 'var(--ground-ink)')};
`;

const Row = styled.li<{ $late: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--ground-border);
  border-left: 2px solid
    ${({ $late }) => ($late ? 'var(--color-warning)' : 'transparent')};
  padding-left: ${({ $late }) => ($late ? 'var(--space-3)' : '0')};
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const Name = styled.span`
  flex: 1 1 14rem;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const Meta = styled.span`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow-wrap: anywhere;
`;

const Amount = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
`;

const Muted = styled.p`
  color: var(--ground-muted);
  line-height: 1.7;
  max-width: 42rem;
`;

export function CollectionScreen({
  title,
  blurb,
  items,
  counts,
  totals,
  showValue,
}: CollectionScreenProps) {
  const [type, setType] = useState<string>('');

  const shown = useMemo(
    () => (type ? items.filter((item) => item.type === type) : items),
    [items, type],
  );

  /*
   * Late items first, then everything else in the order the server sent.
   *
   * Sorted here rather than in SQL because "late" is derived from a JSON
   * payload, which SQLite cannot index without a generated column. At these
   * volumes — a person's own nodes — the array is small and the sort is free.
   */
  const ordered = useMemo(
    () => [...shown].sort((a, b) => Number(isLate(b)) - Number(isLate(a))),
    [shown],
  );

  return (
    <div style={{ maxWidth: '56rem', margin: '0 auto', width: '100%' }}>
      <Head>
        <Title>{title}</Title>
        <Blurb>{blurb}</Blurb>
      </Head>

      <Stats>
        <Card>
          <Big>{totals.items}</Big>
          <Label>items</Label>
        </Card>

        {showValue && (
          <Card>
            <Big>{money(totals.valueCents)}</Big>
            <Label>recorded value</Label>
          </Card>
        )}

        {totals.overdue > 0 && (
          <Card>
            <Big>{totals.overdue}</Big>
            <Label>past their date</Label>
          </Card>
        )}
      </Stats>

      <Tabs>
        <TabButton $active={type === ''} onClick={() => setType('')}>
          All {items.length}
        </TabButton>

        {counts.map((entry) => (
          <TabButton
            key={entry.type}
            $active={type === entry.type}
            onClick={() => setType(entry.type)}
          >
            {entry.type} {entry.count}
          </TabButton>
        ))}
      </Tabs>

      {ordered.length === 0 ? (
        /*
         * The empty state says where these come from, because that is the
         * actual question. "No items yet" on a screen for a node type most
         * people have never created is a dead end — this names the type and
         * where to make one.
         */
        <Muted>
          Nothing here yet. These are node types, so you create them on a map: open
          any map, add a node, and choose{' '}
          {counts.map((entry, index) => (
            <span key={entry.type}>
              {index > 0 && index === counts.length - 1
                ? ' or '
                : index > 0
                  ? ', '
                  : ''}
              <strong>{entry.type}</strong>
            </span>
          ))}
          . They will all appear here, from every map you own or share.{' '}
          <Link href="/maps">Go to your maps →</Link>
        </Muted>
      ) : (
        <List>
          {ordered.map((item) => {
            const amount = amountOf(item.payload);
            const status = text(item.payload, 'status');
            const due = text(item.payload, 'dueAt');
            const assignee = text(item.payload, 'assignee');

            return (
              <Row key={item.id} $late={isLate(item)}>
                <Name>
                  {/* Back to the node on its own map — the only place it edits. */}
                  <Link
                    href={`/maps/${item.mapId}?node=${encodeURIComponent(item.id)}`}
                  >
                    {item.title || 'Untitled'}
                  </Link>
                </Name>

                <Chip>{item.type}</Chip>

                {status && <Meta>{status}</Meta>}
                {assignee && <Meta>@{assignee}</Meta>}
                {due && (
                  <Meta>
                    {isLate(item) ? 'was due ' : 'due '}
                    {due.slice(0, 10)}
                  </Meta>
                )}

                {amount !== null && <Amount>{money(amount)}</Amount>}

                <Meta>{item.mapTitle}</Meta>
              </Row>
            );
          })}
        </List>
      )}
    </div>
  );
}
