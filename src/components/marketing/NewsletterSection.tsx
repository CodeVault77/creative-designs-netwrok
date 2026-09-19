'use client';

import { flags } from '@/config';
import { newsletter } from '@/content/landing';
import { NewsletterForm } from '@/components/forms';
import { Section } from './Section';

/**
 * Section H of §9.1 — launch updates.
 *
 * Placed after the vision section: someone who is interested but not hiring
 * has just read what is coming, and this is the natural thing to offer them.
 * Before it, they have not yet been given a reason to care.
 *
 * Gated on the flag, so it can be switched off in an incident without a code
 * change (§15.5).
 */
export function NewsletterSection() {
  if (!flags.newsletter) return null;

  return (
    <Section
      id={newsletter.id}
      title={newsletter.title}
      intro={newsletter.body}
      tone="bordered"
      width="narrow"
    >
      <NewsletterForm source="landing" />
    </Section>
  );
}
