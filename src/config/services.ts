import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The service catalogue.
 *
 * Content, not architecture. A service can be added, renamed, reordered,
 * featured or switched off from this file alone — §15.4. `enabled: false`
 * hides one without deleting it, which is what makes a temporary withdrawal
 * reversible.
 *
 * `family` ties each card to a hue that already exists in the token system, so
 * the page inherits the brand palette instead of inventing colours per card.
 */

export interface Service {
  id: string;
  name: string;
  /** One line. Appears on the card and in the request form's picker. */
  summary: string;
  /** Longer copy for `/services`. Optional — the card only needs the summary. */
  detail?: string;
  family: FamilyName;
  order: number;
  enabled: boolean;
  /**
   * Featured services appear on the landing page; the rest live on /services.
   *
   * OPEN DECISION OD-15. Twelve cards on a landing page is a directory, not a
   * pitch — the roadmap recommends featuring four to six. Six are featured
   * below as a starting point for the client to confirm.
   */
  featured: boolean;
}

export const services: readonly Service[] = [
  {
    id: 'full-stack-web',
    name: 'Full-Stack Web Development',
    summary: 'Complete web builds, from the database to the interface.',
    detail:
      'We take a product from an idea to something people use — data model, server, interface and deployment — and hand it over as code you own.',
    family: 'discover',
    order: 1,
    enabled: true,
    featured: true,
  },
  {
    id: 'web-applications',
    name: 'Web Application Development',
    summary: 'Interactive applications, not brochure sites.',
    detail:
      'Dashboards, tools and platforms where the interface has to do real work and stay fast while it does it.',
    family: 'discover',
    order: 2,
    enabled: true,
    featured: true,
  },
  {
    id: 'mobile-applications',
    name: 'Mobile Application Development',
    summary: 'Apps that behave properly on a phone.',
    detail:
      'Built for touch, for small screens and for unreliable networks — not a desktop layout squeezed down.',
    family: 'people',
    order: 3,
    enabled: true,
    featured: false,
  },
  {
    id: 'ui-ux-design',
    name: 'UI/UX Design',
    summary: 'Interfaces designed against real content, not placeholder text.',
    detail:
      'Research, flows and interface design that survive contact with real data — including the long names and empty states a mockup never shows.',
    family: 'create',
    order: 4,
    enabled: true,
    featured: true,
  },
  {
    id: 'ai-development',
    name: 'AI Development and Integrations',
    summary: 'AI features that are worth the cost of running them.',
    detail:
      'We build the evaluation before the feature, choose the cheapest approach that works, and are honest when a model is the wrong tool.',
    family: 'organise',
    order: 5,
    enabled: true,
    featured: true,
  },
  {
    id: 'api-integrations',
    name: 'API Integrations',
    summary: 'Connecting the systems you already pay for.',
    family: 'commerce',
    order: 6,
    enabled: true,
    /*
     * The sixth featured service. Six divides evenly into the three-column
     * grid; five left a stranded card on its own row.
     */
    featured: true,
  },
  {
    id: 'backend-development',
    name: 'Backend Development',
    summary: 'Servers, jobs and the parts nobody sees until they break.',
    family: 'organise',
    order: 7,
    enabled: true,
    featured: false,
  },
  {
    id: 'database-development',
    name: 'Database Development',
    summary: 'Data models that still make sense in two years.',
    family: 'organise',
    order: 8,
    enabled: true,
    featured: false,
  },
  {
    id: 'custom-software',
    name: 'Custom Software Development',
    summary: 'Built for one business, not configured from a template.',
    family: 'services',
    order: 9,
    enabled: true,
    featured: true,
  },
  {
    id: 'technical-consulting',
    name: 'Technical Consulting',
    summary: 'What to build, what to defer, and what to refuse.',
    detail:
      'Written down with the reasoning, so the decision survives the meeting it was made in.',
    family: 'services',
    order: 10,
    enabled: true,
    featured: false,
  },
  {
    id: 'website-deployment',
    name: 'Website Setup and Deployment',
    summary: 'Getting it live, monitored and backed up.',
    family: 'commerce',
    order: 11,
    enabled: true,
    featured: false,
  },
  {
    id: 'platform-development',
    name: 'Custom Platform Development',
    summary: 'Multi-user products with accounts, permissions and scale.',
    family: 'people',
    order: 12,
    enabled: true,
    featured: false,
  },
];

const byOrder = (a: Service, b: Service) => a.order - b.order;

export const activeServices = (): Service[] =>
  services.filter((service) => service.enabled).sort(byOrder);

export const featuredServices = (): Service[] =>
  activeServices().filter((service) => service.featured);

export const serviceById = (id: string): Service | undefined =>
  services.find((service) => service.id === id && service.enabled);

/**
 * Options for the service-request picker (§9.2).
 *
 * Derived from the same list, so a service switched off here disappears from
 * the form as well — there is no second place to remember.
 */
export const serviceOptions = (): { value: string; label: string }[] => [
  ...activeServices().map((service) => ({
    value: service.id,
    label: service.name,
  })),
  { value: 'not-sure', label: 'Not sure yet' },
];

/**
 * OPEN DECISION OD-12: ranges, never prices. Publishing a price list without
 * approval is a commitment; a range is a qualifying question.
 */
export const budgetOptions: readonly { value: string; label: string }[] = [
  { value: 'under-5k', label: 'Under $5,000' },
  { value: '5k-15k', label: '$5,000 – $15,000' },
  { value: '15k-50k', label: '$15,000 – $50,000' },
  { value: 'over-50k', label: '$50,000+' },
  { value: 'unsure', label: 'Not sure yet' },
];

export const timelineOptions: readonly { value: string; label: string }[] = [
  { value: 'asap', label: 'As soon as possible' },
  { value: '1-3-months', label: 'In 1–3 months' },
  { value: '3-6-months', label: 'In 3–6 months' },
  { value: 'exploring', label: 'Just exploring' },
];

export const projectTypeOptions: readonly { value: string; label: string }[] = [
  { value: 'new-build', label: 'A new build' },
  { value: 'existing', label: 'Work on something that exists' },
  { value: 'rescue', label: 'Fixing or finishing a stalled project' },
  { value: 'consulting', label: 'Advice rather than build' },
  { value: 'other', label: 'Something else' },
];

export const heardFromOptions: readonly { value: string; label: string }[] = [
  { value: 'search', label: 'Search' },
  { value: 'referral', label: 'Someone recommended you' },
  { value: 'social', label: 'Social media' },
  { value: 'existing-client', label: "I've worked with you before" },
  { value: 'other', label: 'Somewhere else' },
];
