import type { Metadata } from 'next';
import { Section } from '@/components/marketing';
import { ServiceRequestForm } from '@/components/forms';
import { pageMetadata } from '@/config/seo';
import { contact } from '@/config';

export const metadata: Metadata = pageMetadata({
  path: '/request',
  title: 'Request a project',
  description:
    'Tell Creative Design Networks about your project — web, mobile, AI or custom software — and we will come back with a real answer.',
});

/** Screen: the service request (roadmap §9.2). */
export default function RequestPage() {
  return (
    <Section
      id="request"
      title="Request a project"
      intro={`Tell us what you need. A person reads every request and replies ${contact.responseTime}.`}
      as="h1"
      width="narrow"
    >
      <ServiceRequestForm />
    </Section>
  );
}
