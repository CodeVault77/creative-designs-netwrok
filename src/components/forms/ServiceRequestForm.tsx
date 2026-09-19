'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styled from 'styled-components';
import { Button, Checkbox, Select, Textarea, TextField } from '@/components/ui';
import {
  budgetOptions,
  heardFromOptions,
  projectTypeOptions,
  serviceOptions,
  timelineOptions,
} from '@/config';
import { track } from '@/lib/analytics';

/**
 * C4/C6 — the service request form.
 *
 * ── The one behaviour that matters most ─────────────────────────────────────
 *
 * §9.2: "failure preserves every entered value". Nothing is cleared until the
 * server has confirmed. Somebody who has just written six sentences about
 * their project must not lose them because a rate limit fired or the network
 * blinked — and this is the form standing between the business and its
 * revenue, so that loss is the most expensive bug available here.
 *
 * State therefore lives in ONE object that is never reset on error, and the
 * submit handler's failure path touches `error` only.
 */

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 640px;
`;

const Row = styled.div`
  display: grid;
  gap: var(--space-4);
  grid-template-columns: 1fr;

  @media (min-width: 600px) {
    grid-template-columns: 1fr 1fr;
  }
`;

/**
 * The honeypot.
 *
 * Hidden three ways at once — off-screen, zero opacity, `aria-hidden` with
 * `tabIndex={-1}` — because a bot that checks only one of them still fills it
 * in. Deliberately NOT `display: none`, which some bots specifically skip.
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

const ErrorBox = styled.p`
  margin: 0;
  padding: var(--space-4);
  background: var(--ground-raised);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-card);
  font-size: var(--text-body);
  color: var(--ground-ink);
`;

const Required = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

interface FormState {
  name: string;
  email: string;
  phone: string;
  company: string;
  serviceSlug: string;
  projectType: string;
  message: string;
  budget: string;
  timeline: string;
  heardFrom: string;
  consent: boolean;
  website: string;
}

const EMPTY: FormState = {
  name: '',
  email: '',
  phone: '',
  company: '',
  serviceSlug: '',
  projectType: '',
  message: '',
  budget: '',
  timeline: '',
  heardFrom: '',
  consent: false,
  website: '',
};

const MESSAGE_MAX = 4000;

export function ServiceRequestForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>(
    {},
  );
  const errorRef = useRef<HTMLParagraphElement>(null);

  /** Timing signal for the spam scorer. */
  const openedAt = useRef(Date.now());
  useEffect(() => {
    openedAt.current = Date.now();
    track('service_request_started', {});
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  /**
   * Validated on BLUR, never on every keystroke.
   *
   * Marking a field invalid while someone is halfway through typing an address
   * means it is red for most of the time they spend in it.
   */
  const blur = (key: keyof FormState) => setTouched((t) => ({ ...t, [key]: true }));

  const errors = {
    name:
      touched.name && form.name.trim().length < 2 ? 'Tell us your name' : undefined,
    email:
      touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
        ? 'Check that email address'
        : undefined,
    serviceSlug:
      touched.serviceSlug && !form.serviceSlug ? 'Choose what you need' : undefined,
    message:
      touched.message && form.message.trim().length < 20
        ? 'A sentence or two about the project, please'
        : undefined,
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    // Show every error at once on submit, rather than one field at a time.
    setTouched({ name: true, email: true, serviceSlug: true, message: true });

    const clientInvalid =
      form.name.trim().length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ||
      !form.serviceSlug ||
      form.message.trim().length < 20 ||
      !form.consent;

    if (clientInvalid) {
      setError(
        !form.consent
          ? 'Please confirm you are happy for us to reply.'
          : 'Some details are missing — check the highlighted fields.',
      );
      errorRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/service-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, elapsedMs: Date.now() - openedAt.current }),
      });

      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok) {
        /**
         * §9.2 / AC-11. `form` is NOT touched here — every value the person
         * typed is still on screen, and they can correct one field and resend.
         */
        setError(data.error ?? 'That did not send. Try again.');
        track('service_request_failed', { reason: data.error ?? 'unknown' });
        errorRef.current?.focus();
        return;
      }

      track('service_request_submitted', {
        service_id: form.serviceSlug,
        budget_range: form.budget || 'unstated',
      });

      router.push(`/request/success?ref=${encodeURIComponent(data.id ?? '')}`);
    } catch {
      setError('That did not send. Check your connection and try again.');
      track('service_request_failed', { reason: 'network' });
      errorRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form onSubmit={submit} noValidate>
      {error && (
        /*
         * `tabIndex={-1}` so the handler can move focus here: a keyboard user
         * who submits from the bottom of a long form would otherwise never
         * learn that an error appeared at the top.
         */
        <ErrorBox ref={errorRef} role="alert" tabIndex={-1}>
          {error}
        </ErrorBox>
      )}

      <Required>Fields marked * are required.</Required>

      <Row>
        <TextField
          label="Your name *"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          onBlur={() => blur('name')}
          autoComplete="name"
          maxLength={120}
          {...(errors.name ? { error: errors.name } : {})}
        />
        <TextField
          label="Email *"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          onBlur={() => blur('email')}
          autoComplete="email"
          maxLength={200}
          {...(errors.email ? { error: errors.email } : {})}
        />
      </Row>

      <Row>
        <TextField
          label="Phone or WhatsApp"
          type="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          autoComplete="tel"
          maxLength={40}
          hint="Optional"
        />
        <TextField
          label="Company"
          value={form.company}
          onChange={(e) => set('company', e.target.value)}
          autoComplete="organization"
          maxLength={160}
          hint="Optional"
        />
      </Row>

      <Row>
        <Select
          label="What do you need? *"
          options={serviceOptions()}
          placeholder="Choose a service"
          value={form.serviceSlug}
          onChange={(e) => set('serviceSlug', e.target.value)}
          onBlur={() => blur('serviceSlug')}
          {...(errors.serviceSlug ? { error: errors.serviceSlug } : {})}
        />
        <Select
          label="Project type"
          options={projectTypeOptions}
          placeholder="Optional"
          value={form.projectType}
          onChange={(e) => set('projectType', e.target.value)}
        />
      </Row>

      <Textarea
        label="About the project *"
        value={form.message}
        onChange={(e) => set('message', e.target.value)}
        onBlur={() => blur('message')}
        maxLength={MESSAGE_MAX}
        showCount
        rows={7}
        placeholder="What are you building, and what does done look like?"
        {...(errors.message
          ? { error: errors.message }
          : { hint: 'What you are building, and what done looks like.' })}
      />

      <Row>
        <Select
          label="Budget"
          options={budgetOptions}
          placeholder="Prefer not to say"
          value={form.budget}
          onChange={(e) => set('budget', e.target.value)}
          hint="A range helps us answer usefully."
        />
        <Select
          label="Timeline"
          options={timelineOptions}
          placeholder="Optional"
          value={form.timeline}
          onChange={(e) => set('timeline', e.target.value)}
        />
      </Row>

      <Select
        label="How did you hear about CDN?"
        options={heardFromOptions}
        placeholder="Optional"
        value={form.heardFrom}
        onChange={(e) => set('heardFrom', e.target.value)}
      />

      <Honeypot aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => set('website', e.target.value)}
          />
        </label>
      </Honeypot>

      <Checkbox
        checked={form.consent}
        onChange={(e) => set('consent', e.target.checked)}
        label={
          <>
            I am happy for CDN to store these details and reply to me. See our{' '}
            <Link href="/privacy">privacy policy</Link>. *
          </>
        }
      />

      <div>
        <Button type="submit" size="lg" loading={busy} disabled={busy}>
          Send request
        </Button>
      </div>
    </Form>
  );
}
