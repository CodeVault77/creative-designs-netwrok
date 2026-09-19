'use client';

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, TextField } from '@/components/ui';
import { track } from '@/lib/analytics';
import type { Service } from '@/lib/services/catalogue';

/**
 * EnquiryForm — §20 P12's "first money path".
 *
 * Two rules shape this component, and both are about not losing a customer:
 *
 *   - **§08 screen 17: "Form submit failure preserves entries."** Nothing is
 *     cleared until the server has confirmed. Someone who has just written six
 *     sentences about their project must not lose them to a flaky connection.
 *   - **No CAPTCHA.** It taxes every real customer to stop a bot that solves it
 *     anyway. Spam is handled by a honeypot and a timing check, neither of
 *     which a person ever sees.
 */

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 560px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-label);
  color: var(--ground-muted);
`;

const Textarea = styled.textarea`
  width: 100%;
  min-height: 140px;
  padding: var(--space-3);
  resize: vertical;

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);
  line-height: 1.5;

  &:focus {
    outline: none;
    border-color: var(--color-focus);
  }
`;

const Select = styled.select`
  min-height: var(--control-inputHeight);
  padding: 0 var(--space-3);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);

  &:focus {
    outline: none;
    border-color: var(--color-focus);
  }
`;

/**
 * The honeypot.
 *
 * Hidden from people in three ways at once — off-screen, zero opacity, and
 * `aria-hidden` with `tabIndex={-1}` — because a bot that only checks one of
 * them still fills it in, and a screen reader must never announce it. It is
 * NOT `display: none`, which some bots specifically skip.
 */
const Honeypot = styled.div`
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
`;

const Error = styled.p`
  margin: 0;
  padding: var(--space-3);
  background: var(--ground-raised);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-card);
  font-size: var(--text-body);
  color: var(--ground-ink);
`;

const Done = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-6);

  background: var(--ground-raised);
  border: 1px solid var(--color-success);
  border-radius: var(--radius-sheet);
`;

const DoneTitle = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const DoneBody = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-muted);
`;

const Reference = styled.code`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export function EnquiryForm({ service }: { service: Service }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [budget, setBudget] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  /**
   * When the form was first rendered. A submit within three seconds of this is
   * not someone who read a service page and described a project.
   */
  const openedAt = useRef(Date.now());

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  if (sent) {
    return (
      <Done role="status">
        <DoneTitle>Thanks — that reached us.</DoneTitle>
        <DoneBody>
          We reply to every enquiry within two working days. Check your inbox for a
          copy of what you sent.
        </DoneBody>
        <Reference>Reference {sent}</Reference>
      </Done>
    );
  }

  return (
    <Form
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;

        setBusy(true);
        setError(null);

        try {
          const response = await fetch('/api/enquiries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serviceSlug: service.slug,
              name,
              email,
              company,
              budget,
              message,
              website,
              elapsedMs: Date.now() - openedAt.current,
            }),
          });

          const data = (await response.json()) as { id?: string; error?: string };

          if (!response.ok) {
            // §08 screen 17: "Form submit failure preserves entries." Nothing
            // is cleared — the fields keep everything the person typed.
            setError(data.error ?? 'That did not send. Try again.');
            return;
          }

          track('service_enquiry_submitted', { service_id: service.slug });
          setSent(data.id ?? 'sent');
        } catch {
          setError('That did not send. Check your connection and try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Error role="alert">{error}</Error>}

      <Row>
        <TextField
          label="Your name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="name"
          maxLength={120}
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          maxLength={200}
        />
      </Row>

      <Row>
        <TextField
          label="Company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          autoComplete="organization"
          maxLength={160}
          hint="Optional"
        />
        <Field>
          Budget
          <Select
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            aria-label="Budget"
          >
            <option value="">Prefer not to say</option>
            {service.budgets.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
      </Row>

      <Field>
        About the project
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
          minLength={10}
          maxLength={4000}
          aria-label="About the project"
          placeholder="What are you building, and what does done look like?"
        />
      </Field>

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

      <div>
        <Button type="submit" size="lg" loading={busy} disabled={busy}>
          Send enquiry
        </Button>
      </div>
    </Form>
  );
}
