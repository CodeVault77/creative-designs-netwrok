'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, TextField, useToast } from '@/components/ui';

/**
 * Plan configuration, for staff.
 *
 * â”€â”€ This screen records a decision; it does not make one â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * The price already exists in Stripe by the time anyone opens this. The form
 * copies its id and its amount across so the application can show a price and
 * send someone to the right checkout. Nothing here creates a price, and no
 * paid plan is shipped pre-filled â€” what to charge is the business's decision
 * to make, and a price id only exists once someone has created it.
 *
 * The order matters and is printed on the screen, because getting it backwards
 * leaves a plan on the pricing page that cannot be bought.
 */

interface Plan {
  id: string;
  name: string;
  stripePriceId: string | null;
  centsPerMonth: number;
  monthlyCredits: number;
  maxMaps: number;
  maxAgents: number;
  active: boolean;
  subscribers: number;
}

const empty = {
  id: '',
  name: '',
  stripePriceId: '',
  dollars: '',
  monthlyCredits: '',
  maxMaps: '',
  maxAgents: '',
};

const Steps = styled.ol`
  margin: 0 0 var(--space-6);
  padding-left: var(--space-6);
  color: var(--ground-muted);
  line-height: 1.8;
`;

const Table = styled.div`
  overflow-x: auto;
`;

const Grid = styled.div`
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  margin-bottom: var(--space-4);
`;

const PlanRow = styled.div<{ $retired: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--ground-border);
  opacity: ${({ $retired }) => ($retired ? 0.55 : 1)};
`;

const Name = styled.span`
  flex: 1 1 10rem;
  min-width: 0;
  font-family: var(--face-display);
  font-size: var(--text-body);
`;

const Mono = styled.span`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow-wrap: anywhere;
`;

const Warn = styled.span`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--color-warning);
`;

const Heading = styled.h2`
  font-size: var(--text-title);
  margin: 0 0 var(--space-3);
`;

const Section = styled.section`
  margin-top: var(--space-8);
`;

const Muted = styled.p`
  color: var(--ground-muted);
  line-height: 1.6;
`;

export function PlansPanel() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/plans');
    if (!response.ok) return;
    const body = (await response.json()) as { plans: Plan[] };
    setPlans(body.plans);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const field = (key: keyof typeof empty) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [key]: event.target.value })),
  });

  const submit = useCallback(async () => {
    const dollars = Number(form.dollars || '0');

    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.show({ tone: 'danger', message: 'That price is not a number.' });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id.trim(),
          name: form.name.trim(),
          stripePriceId: form.stripePriceId.trim() || null,
          // Dollars typed, cents stored. Rounded at the boundary so a price
          // can never be a fraction of a cent adrift from Stripe's.
          centsPerMonth: Math.round(dollars * 100),
          monthlyCredits: Number(form.monthlyCredits || '0'),
          maxMaps: Number(form.maxMaps || '0'),
          maxAgents: Number(form.maxAgents || '0'),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        plans?: Plan[];
        error?: string;
      };

      if (!response.ok || !body.plans) {
        toast.show({ tone: 'danger', message: body.error ?? 'Could not save.' });
        return;
      }

      setPlans(body.plans);
      setForm(empty);
      toast.show({ tone: 'success', message: 'Plan saved.' });
    } finally {
      setBusy(false);
    }
  }, [form, toast]);

  const retire = useCallback(
    async (plan: Plan) => {
      setBusy(true);
      try {
        const response = await fetch(
          `/api/admin/plans?id=${encodeURIComponent(plan.id)}`,
          { method: 'DELETE' },
        );

        const body = (await response.json().catch(() => ({}))) as {
          plans?: Plan[];
          error?: string;
        };

        if (!response.ok || !body.plans) {
          toast.show({
            tone: 'danger',
            message: body.error ?? 'Could not retire.',
          });
          return;
        }

        setPlans(body.plans);
        toast.show({
          tone: 'success',
          message: 'Off sale. Existing subscribers keep it.',
        });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  return (
    <>
      <Card>
        <Heading>Before you add a paid plan</Heading>
        <Steps>
          <li>
            Create the product and its recurring price in the Stripe dashboard.
          </li>
          <li>
            Copy the <Mono>price_â€¦</Mono> id. Not the <Mono>prod_â€¦</Mono> id â€”
            checkout needs the price.
          </li>
          <li>Enter it below with the same amount you set in Stripe.</li>
        </Steps>
        <Muted>
          Stripe stays the authority on what is actually charged. The amount below
          is what the pricing page displays, so if the two drift you get a wrong
          label rather than a wrong charge.
        </Muted>
      </Card>

      <Section>
        <Heading>Add or update a plan</Heading>

        <Grid>
          <TextField label="Plan id" hint="lower case, e.g. pro" {...field('id')} />
          <TextField label="Name" {...field('name')} />
          <TextField
            label="Stripe price id"
            placeholder="price_â€¦"
            {...field('stripePriceId')}
          />
          <TextField
            label="Price per month (USD)"
            inputMode="decimal"
            {...field('dollars')}
          />
          <TextField
            label="Monthly credits"
            inputMode="numeric"
            {...field('monthlyCredits')}
          />
          <TextField label="Max maps" inputMode="numeric" {...field('maxMaps')} />
          <TextField
            label="Max agents"
            inputMode="numeric"
            {...field('maxAgents')}
          />
        </Grid>

        <Button onClick={() => void submit()} disabled={busy || !form.id.trim()}>
          Save plan
        </Button>
      </Section>

      <Section>
        <Heading>Plans</Heading>

        <Table>
          {plans.map((plan) => (
            <PlanRow key={plan.id} $retired={!plan.active}>
              <Name>
                {plan.name}
                {!plan.active && ' (off sale)'}
              </Name>

              <Mono>
                {plan.centsPerMonth === 0
                  ? 'free'
                  : `$${(plan.centsPerMonth / 100).toFixed(2)}/mo`}
                {' Â· '}
                {plan.monthlyCredits.toLocaleString()} credits
                {' Â· '}
                {plan.subscribers} subscriber{plan.subscribers === 1 ? '' : 's'}
              </Mono>

              {/*
                A paid plan with no price id is called out rather than left to
                be discovered at checkout by a customer. It is the one
                misconfiguration this screen exists to prevent.
              */}
              {plan.centsPerMonth > 0 && !plan.stripePriceId ? (
                <Warn>NO PRICE ID â€” CANNOT BE BOUGHT</Warn>
              ) : (
                <Mono>{plan.stripePriceId ?? 'â€”'}</Mono>
              )}

              {plan.active && plan.id !== 'free' && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void retire(plan)}
                >
                  Take off sale
                </Button>
              )}
            </PlanRow>
          ))}
        </Table>

        {plans.length === 1 && (
          <Muted style={{ marginTop: 'var(--space-4)' }}>
            Only the free plan exists. That is the shipped state â€” no paid plan is
            seeded, because its price has to be created in Stripe first.
          </Muted>
        )}
      </Section>
    </>
  );
}
