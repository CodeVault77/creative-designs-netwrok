'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, useToast } from '@/components/ui';

/**
 * The billing screen.
 *
 * ── Nothing here is a payment form ──────────────────────────────────────────
 *
 * Every button that touches money navigates to a Stripe-hosted page. There is
 * no card field on this screen and there never will be — the application stays
 * out of PCI scope by not having one.
 *
 * ── The balance is the headline ─────────────────────────────────────────────
 *
 * People arrive here for one of two reasons: something was refused and they
 * want to know why, or they want to change plan. The credit balance answers
 * the first before they have to read anything, which is why it is the largest
 * element rather than the plan name.
 */

interface Plan {
  id: string;
  name: string;
  centsPerMonth: number;
  monthlyCredits: number;
  maxMaps: number;
  maxAgents: number;
  stripePriceId: string | null;
}

interface Ledger {
  id: string;
  amount: number;
  kind: string;
  note: string;
  createdAt: string;
}

interface Invoice {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  hostedUrl: string | null;
  createdAt: string;
}

interface Data {
  subscription: { planId: string; status: string; cancelAtPeriodEnd: boolean };
  plan: Plan;
  plans: Plan[];
  usage: { balance: number; grantedThisPeriod: number; spentThisPeriod: number };
  ledger: Ledger[];
  invoices: Invoice[];
  configured: boolean;
}

/**
 * Integer cents to a readable amount.
 *
 * Division happens HERE, at the edge, and only for display. The value that
 * travelled and the value that was stored are both integers; turning it into a
 * float any earlier is how a rounding error reaches an invoice.
 */
function money(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

const Balance = styled.p<{ $low: boolean }>`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-l);
  line-height: 1.1;
  color: ${({ $low }) => ($low ? 'var(--color-warning)' : 'var(--ground-ink)')};
`;

const Caption = styled.p`
  margin: var(--space-2) 0 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Bar = styled.div`
  height: 6px;
  margin-top: var(--space-4);
  border-radius: var(--radius-pill);
  background: var(--ground-border);
  overflow: hidden;
`;

const Fill = styled.div<{ $percent: number }>`
  height: 100%;
  width: ${({ $percent }) => $percent}%;
  background: var(--fam-create-core);
`;

const Grid = styled.div`
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
`;

const PlanCard = styled.div<{ $current: boolean }>`
  padding: var(--space-4);
  border: 1px solid
    ${({ $current }) => ($current ? 'var(--fam-create-core)' : 'var(--ground-border)')};
  border-radius: var(--radius-card);
  background: var(--ground-surface);
`;

const PlanName = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
`;

const Price = styled.p`
  margin: var(--space-2) 0;
  font-family: var(--face-mono);
  font-size: var(--text-body);
  color: var(--ground-ink);
`;

const Features = styled.ul`
  margin: 0 0 var(--space-4);
  padding-left: var(--space-4);
  color: var(--ground-muted);
  font-size: var(--text-label);
  line-height: 1.7;
`;

const List = styled.ul`
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
`;

const Entry = styled.li`
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--ground-border);
  font-size: var(--text-label);
`;

const Amount = styled.span<{ $positive: boolean }>`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  color: ${({ $positive }) =>
    $positive ? 'var(--fam-create-core)' : 'var(--ground-muted)'};
`;

const Muted = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Section = styled.section`
  margin-top: var(--space-12);
`;

const Heading = styled.h2`
  font-size: var(--text-title);
  margin: 0 0 var(--space-3);
`;

export function BillingPanel() {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/billing');
    if (response.ok) setData((await response.json()) as Data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const go = useCallback(
    async (action: 'checkout' | 'portal', planId?: string) => {
      setBusy(true);
      try {
        const response = await fetch('/api/billing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, planId }),
        });

        const body = (await response.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
        };

        if (!response.ok || !body.url) {
          toast.show({
            tone: 'danger',
            message: body.error ?? 'That did not work.',
          });
          return;
        }

        /*
         * A full navigation, not a new tab.
         *
         * Stripe sends the browser back to a return URL when the flow ends, and
         * a popup would leave the original page stale behind it — showing the
         * old plan after a successful upgrade.
         */
        window.location.href = body.url;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  if (!data) return <Muted>Loading…</Muted>;

  const { usage, plan, subscription } = data;
  const granted = usage.grantedThisPeriod || plan.monthlyCredits || 1;
  const used = Math.min(100, Math.round((usage.spentThisPeriod / granted) * 100));

  return (
    <>
      <Card>
        <Balance $low={usage.balance <= 0}>
          {usage.balance.toLocaleString()}
        </Balance>
        <Caption>
          AI CREDITS REMAINING · {plan.name.toUpperCase()} PLAN
          {subscription.status !== 'active' &&
            ` · ${subscription.status.toUpperCase()}`}
        </Caption>

        <Bar
          role="img"
          aria-label={`${usage.spentThisPeriod} of ${granted} credits used this month`}
        >
          <Fill $percent={used} />
        </Bar>

        <Caption>
          {usage.spentThisPeriod.toLocaleString()} used ·{' '}
          {usage.grantedThisPeriod.toLocaleString()} granted this month
        </Caption>

        {usage.balance <= 0 && (
          <Caption>
            AI features are paused until your credits renew or you change plan.
          </Caption>
        )}

        {subscription.cancelAtPeriodEnd && (
          <Caption>
            Your plan ends at the end of this period. You keep everything until
            then.
          </Caption>
        )}

        {/*
          The portal only appears for someone who actually has a subscription
          to manage. Offering it to a free user sends them to a Stripe page
          with nothing on it.
        */}
        {data.configured && plan.id !== 'free' && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => go('portal')}
            >
              Manage payment and invoices
            </Button>
          </div>
        )}
      </Card>

      <Section>
        <Heading>Plans</Heading>

        {!data.configured && (
          /*
            Said plainly rather than hiding the section. An environment with no
            Stripe key should look unconfigured, not look like a product with
            no paid plans.
          */
          <Muted>
            Payments are not set up in this environment, so plans cannot be
            purchased here.
          </Muted>
        )}

        <Grid>
          {data.plans.map((candidate) => {
            const current = candidate.id === plan.id;

            return (
              <PlanCard key={candidate.id} $current={current}>
                <PlanName>{candidate.name}</PlanName>
                <Price>
                  {candidate.centsPerMonth === 0
                    ? 'Free'
                    : `${money(candidate.centsPerMonth)} / month`}
                </Price>

                <Features>
                  <li>{candidate.monthlyCredits.toLocaleString()} AI credits</li>
                  <li>{candidate.maxMaps} maps</li>
                  <li>
                    {candidate.maxAgents === 0
                      ? 'No agents'
                      : `${candidate.maxAgents} agents`}
                  </li>
                </Features>

                {current ? (
                  <Muted>Your current plan.</Muted>
                ) : (
                  <Button
                    disabled={busy || !data.configured || !candidate.stripePriceId}
                    onClick={() => go('checkout', candidate.id)}
                  >
                    Choose {candidate.name}
                  </Button>
                )}
              </PlanCard>
            );
          })}
        </Grid>
      </Section>

      <Section>
        <Heading>Invoices</Heading>

        {data.invoices.length === 0 ? (
          <Muted>No invoices yet.</Muted>
        ) : (
          <List>
            {data.invoices.map((invoice) => (
              <Entry key={invoice.id}>
                <span>
                  {new Date(invoice.createdAt).toLocaleDateString()} ·{' '}
                  {invoice.status}
                </span>
                <span>
                  {money(invoice.amountCents, invoice.currency)}
                  {invoice.hostedUrl && (
                    <>
                      {' · '}
                      {/* Stripe's own hosted invoice. We never render one. */}
                      <a href={invoice.hostedUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    </>
                  )}
                </span>
              </Entry>
            ))}
          </List>
        )}
      </Section>

      <Section>
        <Heading>Credit history</Heading>

        {data.ledger.length === 0 ? (
          <Muted>Nothing yet.</Muted>
        ) : (
          <List>
            {data.ledger.map((entry) => (
              <Entry key={entry.id}>
                <span>
                  {new Date(entry.createdAt).toLocaleDateString()} ·{' '}
                  {entry.note || entry.kind}
                </span>
                <Amount $positive={entry.amount > 0}>
                  {entry.amount > 0 ? '+' : ''}
                  {entry.amount.toLocaleString()}
                </Amount>
              </Entry>
            ))}
          </List>
        )}
      </Section>
    </>
  );
}
