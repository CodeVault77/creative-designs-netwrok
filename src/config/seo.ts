import type { Metadata } from 'next';
import { clientEnv } from '@/lib/env';
import { site } from './site';

/**
 * SEO defaults and the per-page metadata builder.
 *
 * One builder rather than hand-written metadata per page, so no page can ship
 * without a canonical or an Open Graph image by forgetting — the omission
 * would be invisible until someone shares a link and gets a blank card.
 */

export interface SeoConfig {
  titleTemplate: string;
  defaultTitle: string;
  defaultDescription: string;
  ogImage: string;
  ogImageAlt: string;
  locale: string;
  twitterCard: 'summary' | 'summary_large_image';
}

export const seo: SeoConfig = {
  titleTemplate: `%s · ${site.name}`,

  /**
   * Leads with the explanation, not the tagline. Someone scanning a search
   * result needs to know what this is; the identity statement can wait for
   * the page itself. Kept under 60 characters so it is not truncated.
   */
  defaultTitle: 'Creative Design Networks — software design and development',

  /**
   * A meta description, not the hero sub-line.
   *
   * `site.description` is written to be READ on the page and runs to 192
   * characters; a search result truncates around 160. Keeping them separate
   * means the page copy can grow without silently degrading the snippet —
   * they are the same claim written for two different places.
   */
  defaultDescription:
    'We design and build web, mobile and AI software — and we are building CDN, a visual platform where ideas, people and projects connect as a network.',

  ogImage: '/brand/og-default.png',
  ogImageAlt: `${site.name} — ${site.tagline}`,
  locale: 'en',
  twitterCard: 'summary_large_image',
};

export interface PageMetaInput {
  title?: string;
  description?: string;
  /** Path with a leading slash, e.g. '/services'. Used for the canonical. */
  path: string;
  /** Success and thank-you pages should not be indexed. */
  noIndex?: boolean;
  image?: string;
}

/**
 * Build a page's metadata.
 *
 * `metadataBase` is already set on the root layout, so relative paths resolve
 * to absolute URLs for Open Graph without repeating the origin here.
 */
export function pageMetadata(input: PageMetaInput): Metadata {
  const title = input.title ?? seo.defaultTitle;
  const description = input.description ?? seo.defaultDescription;
  const image = input.image ?? seo.ogImage;

  /**
   * The root layout sets `title.template` = "%s · Creative Design Networks".
   * A page that supplies its own title gets the suffix appended, which is what
   * we want for "Services" — but the landing page's title already ends in the
   * company name, so the template would produce it twice and blow past 60
   * characters. `absolute` opts that one page out.
   */
  const titleField = input.title ? title : { absolute: title };

  return {
    title: titleField,
    description,
    alternates: { canonical: input.path },
    ...(input.noIndex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: 'website',
      siteName: site.name,
      title,
      description,
      url: input.path,
      locale: seo.locale,
      images: [{ url: image, width: 1200, height: 630, alt: seo.ogImageAlt }],
    },
    twitter: {
      card: seo.twitterCard,
      title,
      description,
      images: [image],
    },
  };
}

/**
 * `Organization` structured data for the landing page.
 *
 * Deliberately NOT `Product`, `Review` or `AggregateRating` (§20): the product
 * is unreleased and there are no reviews. Marking up things that do not exist
 * is both a penalty risk and a lie.
 *
 * Fields that depend on unset configuration are omitted rather than emitted
 * empty — an empty `url` is worse than no `url`.
 */
export function organizationJsonLd(): Record<string, unknown> {
  const url = clientEnv.NEXT_PUBLIC_SITE_URL;

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    alternateName: site.shortName,
    description: site.description,
    ...(url ? { url } : {}),
    logo: `${url}/brand/logo-mark.svg`,
  };
}
