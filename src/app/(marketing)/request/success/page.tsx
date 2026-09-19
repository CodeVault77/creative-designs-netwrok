import type { Metadata } from 'next';
import Link from 'next/link';
import { Section } from '@/components/marketing';
import { pageMetadata } from '@/config/seo';
import { contact, hasWhatsApp, whatsappUrl } from '@/config';

export const metadata: Metadata = pageMetadata({
  path: '/request/success',
  title: 'Request received',
  // A confirmation page has no business in an index — it is not a destination
  // anyone should arrive at from a search result.
  noIndex: true,
});

/**
 * C5 — the confirmation (roadmap §9.4).
 *
 * Four jobs: confirm it arrived, give a reference the sender can quote, say
 * what happens next and when, and offer a route onward. A page that only says
 * "thanks" leaves someone wondering whether to send it again.
 */
export default async function RequestSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const whatsapp = whatsappUrl();

  return (
    <Section
      id="success"
      title="That reached us"
      as="h1"
      width="narrow"
      intro={`A person will read it and reply ${contact.responseTime}. Check your inbox for a copy of what you sent.`}
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {ref && (
          <p style={{ margin: 0, color: 'var(--ground-muted)' }}>
            Your reference is{' '}
            <code
              style={{ fontFamily: 'var(--face-mono)', color: 'var(--ground-ink)' }}
            >
              {ref}
            </code>
            . Quote it if you need to follow up.
          </p>
        )}

        <p style={{ margin: 0, color: 'var(--ground-muted)' }}>
          {hasWhatsApp() && whatsapp ? (
            <>
              In a hurry?{' '}
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                Message us on WhatsApp
              </a>
              .
            </>
          ) : (
            'We will be in touch at the address you gave us.'
          )}
        </p>

        <p style={{ margin: 0 }}>
          <Link href="/">Back to the homepage</Link>
        </p>
      </div>
    </Section>
  );
}
