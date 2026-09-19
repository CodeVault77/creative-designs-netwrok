import type { Metadata } from 'next';
import {
  AudienceGrid,
  ContactOptions,
  Hero,
  HowItWorks,
  NewsletterSection,
  ServiceMap,
  VisionBlock,
  WhatIsCdn,
} from '@/components/marketing';
import { organizationJsonLd, pageMetadata } from '@/config/seo';

export const metadata: Metadata = pageMetadata({ path: '/' });

/**
 * The landing page (roadmap §9.1).
 *
 * Section order is the argument the page makes, and it is deliberate:
 *
 *   Hero        explain, and say plainly that the platform is not out yet
 *   What        expand the one-liner into prose
 *   How         make "node network" concrete with a diagram
 *   Services    the revenue path — this is a business today
 *   Who         let a reader recognise themselves
 *   Vision      what is coming, labelled as a plan
 *   Contact     the two things we want someone to do
 *
 * Services sits BEFORE vision on purpose. A visitor who can hire us should
 * reach that before the section about what does not exist yet.
 *
 * The newsletter sits after the vision section: a reader who is interested but
 * not hiring has just been told what is coming, which is the moment to offer
 * to tell them when it arrives.
 */
export default function LandingPage() {
  return (
    <>
      {/*
        Organization only. Not Product or AggregateRating — the platform is
        unreleased and there are no reviews, and marking up things that do not
        exist is both a penalty risk and a lie (§20).
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }}
      />

      <Hero />
      <WhatIsCdn />
      <HowItWorks />
      <ServiceMap />
      <AudienceGrid />
      <VisionBlock />
      <NewsletterSection />
      <ContactOptions />
    </>
  );
}
