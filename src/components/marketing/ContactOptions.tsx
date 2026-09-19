'use client';

import Link from 'next/link';
import styled from 'styled-components';
import {
  contact,
  emailUrl,
  flags,
  hasEmail,
  hasWhatsApp,
  whatsappUrl,
} from '@/config';
import { contactSection } from '@/content/landing';
import { track } from '@/lib/analytics';
import { Section } from './Section';

/**
 * B5 — contact options.
 *
 * Every channel here is CONDITIONAL on being configured. OD-1 and OD-2 are
 * unanswered, so today this section renders the fallback — and that is the
 * correct behaviour, not a gap to paper over. A `mailto:` with no address or a
 * `wa.me/` with no number both look like working links and silently do
 * nothing, which is the worst possible outcome for the two controls the whole
 * page exists to drive.
 *
 * `config/contact.ts` returns null when unset; this component decides what to
 * show instead. The build guard in `contact.test.ts` fails a deployed build
 * while either is still empty.
 */

const Options = styled.div`
  display: grid;
  gap: var(--space-4);
  grid-template-columns: 1fr;

  @media (min-width: 600px) {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }
`;

const card = `
  display: flex;
  flex-direction: column;
  gap: var(--space-2);

  /* A generous target — this is the point of the page, not a footnote link. */
  min-height: 116px;
  padding: var(--space-6);

  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  background: var(--ground-surface);
  color: var(--ground-ink);
  text-decoration: none;

  transition: border-color 200ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const WhatsAppCard = styled.a`
  ${card}
  &:hover {
    border-color: var(--fam-create-core);
  }
`;

const EmailCard = styled.a`
  ${card}
  &:hover {
    border-color: var(--fam-discover-core);
  }
`;

const RequestCard = styled(Link)`
  ${card}
  &:hover {
    border-color: var(--fam-services-core);
  }
`;

const Label = styled.span`
  font-family: var(--face-display);
  font-size: var(--text-title);
`;

const Detail = styled.span`
  font-size: var(--text-body);
  color: var(--ground-muted);
  /* A long address must not push the card wider than its column. */
  overflow-wrap: anywhere;
`;

const Meta = styled.p`
  margin: var(--space-6) 0 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Fallback = styled.div`
  ${card}
  border-style: dashed;
`;

export function ContactOptions() {
  const mail = emailUrl('Enquiry from the CDN website');
  const whatsapp = whatsappUrl();
  const showWhatsApp = flags.whatsapp && hasWhatsApp() && whatsapp;

  return (
    <Section
      id={contactSection.id}
      title={contactSection.title}
      intro={contactSection.body}
    >
      <Options>
        {showWhatsApp && (
          <WhatsAppCard
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('whatsapp_clicked', { location: 'landing' })}
          >
            <Label>WhatsApp</Label>
            <Detail>The fastest way to reach us.</Detail>
          </WhatsAppCard>
        )}

        {hasEmail() && mail && (
          <EmailCard
            href={mail}
            onClick={() => track('email_clicked', { location: 'landing' })}
          >
            <Label>Email</Label>
            <Detail>{contact.email}</Detail>
          </EmailCard>
        )}

        {flags.serviceRequest && (
          <RequestCard
            href="/request"
            onClick={() =>
              track('marketing_cta_clicked', {
                cta_id: 'contact-request',
                section: 'contact',
              })
            }
          >
            <Label>Request a project</Label>
            <Detail>
              Tell us what you need and we will come back with a real number.
            </Detail>
          </RequestCard>
        )}

        {/*
          Neither direct channel is configured yet. Said plainly rather than
          rendering a link that goes nowhere — and it is the visible symptom of
          OD-1/OD-2, which is exactly who should notice it.
        */}
        {!showWhatsApp && !hasEmail() && (
          <Fallback>
            <Label>Direct contact coming soon</Label>
            <Detail>
              Use the project request form and we will reply to the address you give
              us.
            </Detail>
          </Fallback>
        )}
      </Options>

      <Meta>We reply {contact.responseTime}.</Meta>
    </Section>
  );
}
