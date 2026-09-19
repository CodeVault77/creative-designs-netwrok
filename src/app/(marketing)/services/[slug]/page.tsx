import { notFound } from 'next/navigation';
import { ServiceScreen } from '@/components/services';
import { SERVICES, serviceBySlug } from '@/lib/services/catalogue';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const service = serviceBySlug(slug);
  return {
    title: service ? service.name : 'Service',
    description: service?.tagline,
  };
}

/** Every service is statically known, so the routes can be pre-declared. */
export function generateStaticParams() {
  return SERVICES.map((service) => ({ slug: service.slug }));
}

/**
 * Screen 17 — the service node (§20 P12, "the first money path").
 *
 * Public: this page exists to be found by people who do not have an account.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const service = serviceBySlug(slug);
  if (!service) notFound();

  return <ServiceScreen service={service} />;
}
