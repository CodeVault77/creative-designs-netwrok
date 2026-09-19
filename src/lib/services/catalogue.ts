import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The service catalogue (§08 screen 17).
 *
 * Content, not configuration — so it lives in code, is typed, and is reviewed
 * like anything else. A CMS for three services is a second system to run
 * before there is a second editor to run it.
 *
 * §20 rates P12's risk as Low and adds: "do this early if cash matters more
 * than polish." That is the whole framing here — this is the first path to
 * revenue, and it is deliberately the simplest thing that can carry one:
 * a page, a form, a row in a table, an email.
 */

export interface Capability {
  title: string;
  detail: string;
}

export interface CaseStudy {
  title: string;
  client: string;
  summary: string;
  outcome: string;
  family: FamilyName;
}

export interface Service {
  slug: string;
  name: string;
  family: FamilyName;
  /** One sentence. What this is, for whom. */
  tagline: string;
  intro: string;
  capabilities: Capability[];
  work: CaseStudy[];
  /**
   * §08 screen 17: "Pricing and checkout marked Soon; enquiry is live."
   * Shown as an honest range rather than a checkout that does not exist.
   */
  priceNote: string;
  /** Ranges offered in the form. Free text loses more enquiries than it keeps. */
  budgets: string[];
  /** Where enquiries go. §20: "reaches an inbox." */
  inbox: string;
  trust: string[];
}

export const SERVICES: Service[] = [
  {
    slug: 'build-with-us',
    name: 'Build With Us',
    family: 'services',
    tagline: 'We design and build the thing you have been describing for a year.',
    intro:
      'A small senior team that takes a product from a rough idea to something real people use. We work in short cycles, in the open, with you in the room.',
    capabilities: [
      {
        title: 'Product design',
        detail:
          'Research, flows, and interface design that survives contact with real content — not a set of screens that only works with the data in the mockup.',
      },
      {
        title: 'Design systems',
        detail:
          'Tokens, primitives and the rules behind them, delivered as working code your engineers can use on day one.',
      },
      {
        title: 'Front-end engineering',
        detail:
          'React and TypeScript, built for the performance budget you actually have rather than the one on the slide.',
      },
      {
        title: 'Technical strategy',
        detail:
          'What to build, what to defer, and what to refuse. Written down, with the reasoning, so the decision survives the meeting.',
      },
    ],
    work: [
      {
        title: 'A radial map that holds 60fps',
        client: 'Creative Design Networks',
        summary:
          'A canvas renderer for a spatial browser: pre-baked glow sprites, culling, clustering and a hard node cap.',
        outcome: '61fps with 1,200 nodes on a mid-range laptop.',
        family: 'discover',
      },
      {
        title: 'Turning a link into a mind map',
        client: 'Creative Design Networks',
        summary:
          'A guarded fetcher, a heading structurer that costs nothing, and a failure taxonomy where every mode has its own message.',
        outcome: '10 varied URLs produce useful maps; zero tokens spent on most.',
        family: 'create',
      },
      {
        title: 'Permission-aware search',
        client: 'Creative Design Networks',
        summary:
          'Full-text search across every map at once, where the index authorises nothing and the predicate lives in SQL.',
        outcome: 'Sub-10ms queries, and no path from the index to a private node.',
        family: 'organise',
      },
    ],
    priceNote:
      'Projects usually start at £12,000 for a four-week engagement. Tell us what you need and we will send a real number, not a brochure.',
    budgets: ['Under £10k', '£10k – £25k', '£25k – £50k', '£50k+', 'Not sure yet'],
    inbox: 'hello@creativedesignnetworks.com',
    trust: [
      'We reply to every enquiry within two working days.',
      'No mailing list, no follow-up sequence.',
      'If we are not the right fit we will say so, and suggest who is.',
    ],
  },
  {
    slug: 'design-system-audit',
    name: 'Design System Audit',
    family: 'organise',
    tagline: 'A fortnight to find out why your design system is not being used.',
    intro:
      'Most design systems are not broken; they are unusable at the point where someone is trying to ship. We find out where, and we write down what to do about it.',
    capabilities: [
      {
        title: 'Token and component review',
        detail:
          'Every token, every primitive, and the gap between what the library offers and what teams keep rebuilding by hand.',
      },
      {
        title: 'Adoption analysis',
        detail:
          'Where the system is used, where it is worked around, and why. Measured in the codebase, not surveyed.',
      },
      {
        title: 'Accessibility pass',
        detail:
          'WCAG 2.1 AA against the components themselves, with fixes ranked by how many screens each one repairs.',
      },
      {
        title: 'A plan you can act on',
        detail:
          'Ranked, costed, and honest about what to delete. Usually the most valuable page is the list of things to stop maintaining.',
      },
    ],
    work: [
      {
        title: 'One source, two artefacts',
        client: 'Creative Design Networks',
        summary:
          'A token pipeline emitting both a JS object for canvas and CSS variables for the DOM, because canvas cannot read custom properties.',
        outcome:
          'One place to change a colour; a test that fails if a name drifts.',
        family: 'create',
      },
    ],
    priceNote:
      'Fixed price, £6,000 for two weeks. You get the findings whether or not you hire us to fix them.',
    budgets: ['Under £10k', '£10k – £25k', 'Not sure yet'],
    inbox: 'hello@creativedesignnetworks.com',
    trust: [
      'Fixed price, fixed scope, no change requests.',
      'The report is yours to share internally however you like.',
    ],
  },
];

export function serviceBySlug(slug: string): Service | null {
  return SERVICES.find((service) => service.slug === slug) ?? null;
}
