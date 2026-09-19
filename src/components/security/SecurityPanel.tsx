'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, TextField, useToast } from '@/components/ui';

/**
 * Two-factor authentication, from the account holder's side.
 *
 * ── The recovery codes screen is the important one ──────────────────────────
 *
 * Everything else here is a form. The recovery codes are shown exactly once,
 * and if somebody closes the page without saving them their account has a
 * single point of failure they do not know about. So the panel is large,
 * unmissable, cannot be dismissed by accident, and asks for an explicit
 * confirmation rather than fading away.
 */

interface Status {
  enrolled: boolean;
  confirmed: boolean;
  recoveryRemaining: number;
}

const Section = styled.section`
  margin-top: var(--space-12);
`;

const Heading = styled.h2`
  font-size: var(--text-title);
  margin: 0 0 var(--space-3);
`;

const Muted = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Warn = styled.p`
  margin: var(--space-3) 0 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--color-warning);
`;

const Codes = styled.ul`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--space-2);
  margin: var(--space-4) 0;
  padding: 0;
  list-style: none;
`;

const Code = styled.li`
  padding: var(--space-2);
  border-radius: var(--radius-card);
  background: var(--ground-raised);
  font-family: var(--face-mono);
  text-align: center;
  letter-spacing: 0.05em;
`;

const Secret = styled.pre`
  margin: var(--space-3) 0;
  padding: var(--space-3);
  border-radius: var(--radius-card);
  background: var(--ground-raised);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: end;
  margin-top: var(--space-3);
`;

const Badge = styled.span<{ $on: boolean }>`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  text-transform: uppercase;
  color: ${({ $on }) => ($on ? 'var(--fam-create-core)' : 'var(--ground-muted)')};
`;

export function SecurityPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [enrolment, setEnrolment] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/mfa');
    if (!response.ok) return;

    const body = (await response.json()) as { status: Status };
    setStatus(body.status);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      try {
        const response = await fetch('/api/mfa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => ({}))) as {
          enrolment?: { secret: string; uri: string };
          recoveryCodes?: string[];
          error?: string;
        };

        if (!response.ok) {
          toast.show({
            tone: 'danger',
            message: body.error ?? 'That did not work.',
          });
          return null;
        }

        return body;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const begin = useCallback(async () => {
    const body = await post({ action: 'begin' });
    if (body?.enrolment) setEnrolment(body.enrolment);
  }, [post]);

  const confirm = useCallback(async () => {
    const body = await post({ action: 'confirm', code });
    if (!body?.recoveryCodes) return;

    setCodes(body.recoveryCodes);
    setEnrolment(null);
    setCode('');
    await load();
  }, [code, load, post]);

  const turnOff = useCallback(async () => {
    const body = await post({ action: 'disable', code });
    if (!body) return;

    setCode('');
    toast.show({ tone: 'success', message: 'Two-factor is off.' });
    await load();
  }, [code, load, post, toast]);

  const regenerate = useCallback(async () => {
    const body = await post({ action: 'regenerate', code });
    if (!body?.recoveryCodes) return;

    setCodes(body.recoveryCodes);
    setCode('');
    await load();
  }, [code, load, post]);

  if (!status) return <Muted>Loading…</Muted>;

  return (
    <>
      {codes && (
        <Card>
          <Heading>Save these recovery codes</Heading>
          <Muted>
            Each one signs you in once if you lose your phone. Keep them somewhere
            other than the device with your authenticator on it.
          </Muted>

          <Codes>
            {codes.map((recovery) => (
              <Code key={recovery}>{recovery}</Code>
            ))}
          </Codes>

          <Warn>
            THIS IS THE ONLY TIME THEY WILL BE SHOWN. They are stored hashed and
            cannot be recovered.
          </Warn>

          <Row>
            <Button onClick={() => setCodes(null)}>I have saved them</Button>
          </Row>
        </Card>
      )}

      <Section>
        <Heading>
          Two-factor authentication{' '}
          <Badge $on={status.confirmed}>{status.confirmed ? 'on' : 'off'}</Badge>
        </Heading>

        <Muted>
          A code from your phone, on top of your password. It is what stops somebody
          who has your password from getting in.
        </Muted>

        {!status.confirmed && !enrolment && (
          <Row>
            <Button onClick={() => void begin()} disabled={busy}>
              Turn on two-factor
            </Button>
          </Row>
        )}

        {enrolment && (
          <>
            <Muted style={{ marginTop: 'var(--space-4)' }}>
              Add this to your authenticator app, then enter the code it shows.
            </Muted>

            {/*
              The secret in text, as well as the URI. Not everyone can scan a
              QR code — a second device, a screen reader, a desktop
              authenticator — and typing 32 characters is a worse experience
              than scanning but a much better one than being unable to enrol.
            */}
            <Secret>{enrolment.secret}</Secret>
            <Muted style={{ fontSize: 'var(--text-caption)' }}>
              Or open: <code>{enrolment.uri}</code>
            </Muted>

            <Row>
              <TextField
                label="Code from your app"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button
                onClick={() => void confirm()}
                disabled={busy || !code.trim()}
              >
                Confirm
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setEnrolment(null);
                  setCode('');
                }}
              >
                Cancel
              </Button>
            </Row>
          </>
        )}

        {status.confirmed && (
          <>
            <Muted style={{ marginTop: 'var(--space-4)' }}>
              {status.recoveryRemaining} recovery{' '}
              {status.recoveryRemaining === 1 ? 'code' : 'codes'} left.
              {status.recoveryRemaining <= 2 &&
                ' Generate a new set before you run out.'}
            </Muted>

            <Row>
              <TextField
                label="Current code"
                hint="From your app, or a recovery code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />

              <Button
                variant="secondary"
                disabled={busy || !code.trim()}
                onClick={() => void regenerate()}
              >
                New recovery codes
              </Button>

              {/*
                Turning it off needs a current code, for the same reason
                changing it does: a stolen session is exactly what this
                protects against, so a stolen session must not be able to
                remove the protection.
              */}
              <Button
                variant="secondary"
                disabled={busy || !code.trim()}
                onClick={() => void turnOff()}
              >
                Turn off
              </Button>
            </Row>
          </>
        )}
      </Section>
    </>
  );
}
