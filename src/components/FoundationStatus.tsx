'use client';

import styled from 'styled-components';
import { clientEnv } from '@/lib/env';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { Button, Card, Chip } from '@/components/ui';
import { tokens } from '@/lib/styles/tokens.generated';

const Page = styled.main`
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-8) var(--space-4);
`;

const Stack = styled.div`
  width: 100%;
  max-width: 34rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const Eyebrow = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  letter-spacing: var(--tracking-uppercase, 0.16em);
  text-transform: uppercase;
  color: var(--ground-muted);
`;

const Title = styled.h1`
  font-size: var(--text-display-m);
`;

const Rows = styled.dl`
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-6);
  font-size: var(--text-label);

  dt {
    color: var(--ground-muted);
  }

  dd {
    margin: 0;
    color: var(--ground-ink);
  }
`;

const Row = styled.div`
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
`;

/**
 * P1 status card. Replaced by screen 01 in P2 and screen 02 in P3.
 *
 * It renders live configuration and a few real primitives, so a broken token
 * pipeline or provider stack is visible the moment the page loads rather than
 * on the first real screen.
 */
export function FoundationStatus() {
  return (
    <Page>
      <Stack>
        <Eyebrow>Creative Design Networks</Eyebrow>
        <Title>Phase P1 — design system is live</Title>

        <Card header="Foundation">
          <Rows>
            <dt>Site URL</dt>
            <dd>{clientEnv.NEXT_PUBLIC_SITE_URL}</dd>
            <dt>Analytics sink</dt>
            <dd>{clientEnv.NEXT_PUBLIC_ANALYTICS_PROVIDER}</dd>
            <dt>Events declared</dt>
            <dd data-numeric>{ANALYTICS_EVENTS.length}</dd>
            <dt>Families</dt>
            <dd data-numeric>{Object.keys(tokens.color.family).length}</dd>
            <dt>Node states</dt>
            <dd data-numeric>{Object.keys(tokens.nodeState).length}</dd>
          </Rows>
        </Card>

        <Row>
          {(
            [
              'create',
              'discover',
              'services',
              'people',
              'organise',
              'commerce',
            ] as const
          ).map((family) => (
            <Chip key={family} family={family} showDot readOnly>
              {family}
            </Chip>
          ))}
        </Row>

        <Row>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </Row>
      </Stack>
    </Page>
  );
}
