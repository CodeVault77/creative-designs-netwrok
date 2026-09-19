import type { Metadata } from 'next';
import { Section } from '@/components/marketing';
import { pageMetadata } from '@/config/seo';
import { activeServices } from '@/config';

export const metadata: Metadata = pageMetadata({
  path: '/services',
  title: 'Services',
  description:
    'Design and development services from Creative Design Networks — web, mobile, AI and custom platforms.',
});

/**
 * The services index — Milestone A skeleton.
 *
 * Lists from `config/services.ts`, so switching a service off or reordering
 * the catalogue is a config edit (AC-18). Milestone B gives each entry a card;
 * this proves the data path.
 */
export default function ServicesPage() {
  return (
    <Section
      id="services"
      title="What we do"
      intro="The platform is coming. The studio is here now."
      as="h1"
    >
      <ul>
        {activeServices().map((service) => (
          <li key={service.id}>
            <strong>{service.name}</strong> — {service.summary}
          </li>
        ))}
      </ul>
    </Section>
  );
}
