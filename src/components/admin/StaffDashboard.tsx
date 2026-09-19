'use client';

import Link from 'next/link';
import styled from 'styled-components';
import type {
  ActivationReport,
  DemandRow,
  ThreeTapReport,
} from '@/lib/analytics/store';
import type { ErrorRow } from '@/lib/launch/errors';
import type { SupportRow } from '@/lib/launch/support';
import type { ReadinessReport } from '@/lib/launch/readiness';
import type { QueueStats } from '@/lib/jobs/queue';

/**
 * Operations, on one screen.
 *
 * Answers three questions in the order an operator asks them: **is it
 * healthy**, **what is broken**, **who is waiting for a reply**. The funnels
 * come last on purpose — they matter weekly, the other two matter now.
 *
 * Presentational only. Every number is computed and permission-checked on the
 * server (`admin/dashboard/page.tsx`); nothing here fetches.
 */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-4) var(--space-16);
  max-width: 72rem;
  margin: 0 auto;
`;

const Title = styled.h1`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-m);
  color: var(--ground-ink);
`;

const Nav = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  text-transform: uppercase;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const Heading = styled.h2`
  margin: 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  font-weight: 400;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--ground-muted);
`;

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
`;

const Card = styled.div<{ $tone?: 'ok' | 'warn' | 'bad' }>`
  padding: var(--space-4);
  background: var(--ground-surface);
  border: 1px solid
    ${({ $tone }) =>
      $tone === 'bad'
        ? 'var(--color-danger)'
        : $tone === 'warn'
          ? 'var(--color-warning)'
          : 'var(--ground-border)'};
  border-radius: var(--radius-card);
`;

const Value = styled.p<{ $tone?: 'ok' | 'warn' | 'bad' }>`
  margin: 0;
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-display-m);
  color: ${({ $tone }) =>
    $tone === 'bad'
      ? 'var(--color-danger)'
      : $tone === 'warn'
        ? 'var(--color-warning)'
        : 'var(--ground-ink)'};
`;

const Label = styled.p`
  margin: var(--space-1) 0 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  overflow: hidden;
`;

const Row = styled.li`
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--ground-surface);

  & + & {
    border-top: 1px solid var(--ground-border);
  }
`;

const RowMain = styled.span`
  flex: 1;
  min-width: 0;
  font-size: var(--text-label);
  color: var(--ground-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowMeta = styled.span`
  flex: none;
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Empty = styled.p`
  margin: 0;
  padding: var(--space-4);
  border: 1px dashed var(--ground-border);
  border-radius: var(--radius-card);
  font-size: var(--text-label);
  color: var(--ground-muted);
`;

/** A percentage that never divides by zero and never invents precision. */
function percent(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

export interface StaffDashboardProps {
  readiness: ReadinessReport;
  queue: QueueStats;
  threeTap: ThreeTapReport;
  activation: ActivationReport;
  demand: DemandRow[];
  volume: { name: string; count: number }[];
  errors: ErrorRow[];
  support: SupportRow[];
}

export function StaffDashboard({
  readiness,
  queue,
  threeTap,
  activation,
  demand,
  volume,
  errors,
  support,
}: StaffDashboardProps) {
  return (
    <Page>
      <Title>Operations</Title>

      {/*
        The other staff surfaces. They are separate screens because each is a
        working tool with its own state, not a panel to glance at — but a tool
        nothing links to is a tool nobody opens.
      */}
      <Nav>
        <Link href="/admin/pipeline">Pipeline</Link>
        <Link href="/admin/moderation">Moderation</Link>
        <Link href="/admin/agents">Agent controls</Link>
        <Link href="/admin/plans">Plans</Link>
      </Nav>

      {/* ---------------------------------------------- is it healthy */}
      <Section>
        <Heading>Health</Heading>
        <Cards>
          <Card $tone={readiness.ready ? 'ok' : 'bad'}>
            <Value $tone={readiness.ready ? 'ok' : 'bad'}>
              {readiness.ready ? 'READY' : 'NOT READY'}
            </Value>
            <Label>
              {readiness.checks.filter((c) => c.ok).length} of{' '}
              {readiness.checks.length} checks passing
            </Label>
          </Card>

          {/*
            Dead jobs are the number that matters. Pending fluctuates with
            traffic and means nothing on its own; dead means work was requested
            and will never happen unless someone intervenes.
          */}
          <Card $tone={queue.dead > 0 ? 'bad' : 'ok'}>
            <Value $tone={queue.dead > 0 ? 'bad' : 'ok'}>{queue.dead}</Value>
            <Label>dead jobs</Label>
          </Card>

          <Card $tone={queue.pending > 50 ? 'warn' : 'ok'}>
            <Value>{queue.pending}</Value>
            <Label>jobs pending</Label>
          </Card>

          <Card $tone={errors.length > 0 ? 'warn' : 'ok'}>
            <Value $tone={errors.length > 0 ? 'warn' : 'ok'}>{errors.length}</Value>
            <Label>unresolved errors</Label>
          </Card>
        </Cards>

        {readiness.checks.some((check) => !check.ok) && (
          <List>
            {readiness.checks
              .filter((check) => !check.ok)
              .map((check) => (
                <Row key={check.name}>
                  <RowMain>{check.name}</RowMain>
                  <RowMeta>{check.detail}</RowMeta>
                </Row>
              ))}
          </List>
        )}
      </Section>

      {/* ---------------------------------------------- what is broken */}
      <Section>
        <Heading>Errors</Heading>
        {errors.length === 0 ? (
          <Empty>Nothing unresolved.</Empty>
        ) : (
          <List>
            {errors.slice(0, 15).map((error) => (
              <Row key={error.fingerprint}>
                <RowMain title={error.message}>{error.message}</RowMain>
                {/* The count is what separates a one-off from a fire. */}
                <RowMeta>
                  ×{error.count} · {error.route || 'unknown route'}
                </RowMeta>
              </Row>
            ))}
          </List>
        )}
      </Section>

      {/* ------------------------------------------ who is waiting */}
      <Section>
        <Heading>Support queue</Heading>
        {support.length === 0 ? (
          <Empty>Nobody is waiting.</Empty>
        ) : (
          <List>
            {support.slice(0, 15).map((message) => (
              <Row key={message.id}>
                <RowMain title={message.message}>
                  {message.email} — {message.message}
                </RowMain>
                <RowMeta>{message.topic}</RowMeta>
              </Row>
            ))}
          </List>
        )}
      </Section>

      {/* ---------------------------------------------------- funnels */}
      <Section>
        <Heading>Activation · last 30 days</Heading>
        <Cards>
          <Card>
            <Value>{activation.visitors}</Value>
            <Label>arrived</Label>
          </Card>
          <Card>
            <Value>{activation.exploredNode}</Value>
            <Label>
              opened a node ·{' '}
              {percent(activation.exploredNode, activation.visitors)}
            </Label>
          </Card>
          <Card>
            <Value>{activation.signedUp}</Value>
            <Label>
              signed up · {percent(activation.signedUp, activation.visitors)}
            </Label>
          </Card>
          <Card>
            <Value>{activation.activated}</Value>
            <Label>
              activated · {percent(activation.activated, activation.visitors)}
            </Label>
          </Card>
        </Cards>
      </Section>

      <Section>
        <Heading>Three taps to a destination · §24</Heading>
        <Cards>
          <Card>
            <Value>{threeTap.sessions}</Value>
            <Label>sessions that arrived somewhere</Label>
          </Card>
          <Card>
            <Value>{percent(threeTap.withinBoth, threeTap.sessions)}</Value>
            {/* Both conditions together — the actual criterion, not either. */}
            <Label>≤3 taps AND ≤25s</Label>
          </Card>
          <Card>
            <Value>{threeTap.medianTaps}</Value>
            <Label>median taps</Label>
          </Card>
          <Card>
            <Value>{threeTap.medianSeconds}s</Value>
            <Label>median time</Label>
          </Card>
        </Cards>
      </Section>

      <Section>
        <Heading>Coming Soon demand</Heading>
        {demand.length === 0 ? (
          <Empty>Nobody has registered interest yet.</Empty>
        ) : (
          <List>
            {demand.slice(0, 12).map((row) => (
              <Row key={row.nodeId}>
                <RowMain>{row.nodeId}</RowMain>
                <RowMeta>{row.count}</RowMeta>
              </Row>
            ))}
          </List>
        )}
      </Section>

      <Section>
        <Heading>Event volume · last 7 days</Heading>
        {volume.length === 0 ? (
          <Empty>
            No events recorded. If that is unexpected, check that
            NEXT_PUBLIC_ANALYTICS_PROVIDER is set to “beacon” — “console” logs to
            the browser and stores nothing.
          </Empty>
        ) : (
          <List>
            {volume.slice(0, 20).map((row) => (
              <Row key={row.name}>
                <RowMain>{row.name}</RowMain>
                <RowMeta>{row.count}</RowMeta>
              </Row>
            ))}
          </List>
        )}
      </Section>
    </Page>
  );
}
