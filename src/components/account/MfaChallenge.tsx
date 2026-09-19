'use client';

import { useCallback, useState } from 'react';
import styled from 'styled-components';
import { Button, TextField } from '@/components/ui';

/**
 * The second-factor challenge.
 *
 * ── It greets nobody ────────────────────────────────────────────────────────
 *
 * No name, no avatar, no email. Whoever is holding this laptop has already
 * proved they know a password; showing them whose account it is would confirm
 * that the password was right and tell them who to impersonate. The screen
 * asks for a code and says nothing else.
 *
 * ── One field for both kinds of code ────────────────────────────────────────
 *
 * A TOTP code and a recovery code go in the same box. Making the person choose
 * puts a decision in front of somebody who has just lost their phone and is
 * already having a bad day — and the two shapes are unambiguous to the server.
 */

const Wrap = styled.main`
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: var(--space-6);
`;

const Panel = styled.form`
  width: 100%;
  max-width: 24rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const Title = styled.h1`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-m);
`;

const Muted = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Error = styled.p`
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-label);
`;

export function MfaChallenge({ returnTo }: { returnTo: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;

      setBusy(true);
      setError(null);

      try {
        const response = await fetch('/api/mfa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify', code }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };

          // One message for a wrong code and for an expired attempt. Telling
          // them apart would say whether the password half is still valid.
          setError(body.error ?? 'That code is not right');
          return;
        }

        // A full navigation: the session is only now complete, and every
        // server component has to re-render with it.
        window.location.href = returnTo.startsWith('/') ? returnTo : '/app';
      } catch {
        setError("Couldn't reach the server. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, code, returnTo],
  );

  return (
    <Wrap>
      <Panel onSubmit={(event) => void submit(event)}>
        <Title>Enter your code</Title>

        <Muted>
          From your authenticator app. If you have lost your phone, use one of your
          recovery codes instead.
        </Muted>

        <TextField
          label="Code"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={error ?? undefined}
        />

        {error && <Error role="alert">{error}</Error>}

        <Button type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>

        <Muted style={{ fontSize: 'var(--text-caption)' }}>
          <a href="/sign-in">Start again</a>
        </Muted>
      </Panel>
    </Wrap>
  );
}
