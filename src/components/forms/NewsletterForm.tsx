'use client';

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, Checkbox, TextField } from '@/components/ui';
import { newsletter } from '@/content/landing';
import { track } from '@/lib/analytics';

/**
 * C2 — newsletter capture.
 *
 * One field, one checkbox. Every additional field on a low-intent form costs
 * subscribers, and there is nothing else we need: a name would only be used to
 * write "Hi Dana" in an email we have already promised to send rarely.
 *
 * Like the request form, a failure preserves what was typed.
 */

const Wrap = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 520px;
`;

const Row = styled.div`
  display: flex;
  gap: var(--space-3);
  align-items: flex-end;
  flex-wrap: wrap;

  > *:first-child {
    flex: 1;
    min-width: 220px;
  }
`;

const Honeypot = styled.div`
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
`;

const Done = styled.p`
  margin: 0;
  padding: var(--space-4);
  background: var(--ground-raised);
  border: 1px solid var(--color-success);
  border-radius: var(--radius-card);
  font-size: var(--text-body);
  color: var(--ground-ink);
`;

export function NewsletterForm({ source = 'landing' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const openedAt = useRef(Date.now());
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  if (done) {
    // role="status" so a screen reader hears the confirmation without the
    // focus jump an alert would cause.
    return <Done role="status">{newsletter.success}</Done>;
  }

  return (
    <Wrap
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          setError('Check that email address');
          return;
        }
        if (!consent) {
          setError('Please agree to receive updates first');
          return;
        }

        setBusy(true);
        setError(null);
        track('newsletter_subscribe_started', { source });

        try {
          const response = await fetch('/api/newsletter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              source,
              consent,
              website,
              elapsedMs: Date.now() - openedAt.current,
            }),
          });

          const data = (await response.json()) as { error?: string };

          if (!response.ok) {
            // The address stays in the field — see the note on the request form.
            setError(data.error ?? 'That did not send. Try again.');
            track('newsletter_subscribe_failed', {
              reason: data.error ?? 'unknown',
            });
            return;
          }

          track('newsletter_subscribed', { source });
          setDone(true);
        } catch {
          setError('That did not send. Check your connection.');
          track('newsletter_subscribe_failed', { reason: 'network' });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Row>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          maxLength={200}
          {...(error ? { error } : {})}
        />
        <Button type="submit" loading={busy} disabled={busy}>
          {newsletter.cta}
        </Button>
      </Row>

      <Honeypot aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </Honeypot>

      <Checkbox
        checked={consent}
        onChange={(event) => setConsent(event.target.checked)}
        label={newsletter.consent}
      />
    </Wrap>
  );
}
