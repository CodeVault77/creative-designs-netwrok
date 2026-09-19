import { site } from '@/config/site';

/**
 * Landing page copy.
 *
 * Every word the landing page renders lives here. Components take this as
 * props or read it directly; none of them contain a sentence. That is what
 * makes AC-18 testable — changing the hero headline means editing this file
 * and nothing else.
 *
 * ── The messaging rules are binding, not advisory (roadmap §7.2) ────────────
 *
 * The platform launched, and `config/site.ts`'s `launch.status` is `'live'` —
 * so both halves of the business now speak in the present tense:
 *
 *   Services      → present tense.  "We build web applications."
 *   The platform  → present tense.  "A visual platform where…"
 *
 * What stays future tense is anything GENUINELY not built yet — the AI
 * assistant has no interface, and three ring-one destinations on the map
 * itself are still marked Coming Soon. Those are named honestly in `vision`
 * below rather than folded into the present-tense claims above them. Say
 * "we are building" only about something that is actually still being built.
 */

export const hero = {
  /**
   * Explains the product. NOT the tagline — see OD-13 in config/site.ts.
   * Kept short enough to hold together on a 320px screen without hyphenation.
   */
  headline: 'One node. Infinite connections.',

  /**
   * The sub-line does the actual explaining, and it must survive being read
   * alone: many visitors read a headline and a first line, then decide.
   */
  subline:
    'A visual platform where your ideas, projects and people connect as an expandable network — built and free to explore. We also design and build software for other people alongside it.',

  /**
   * The status pill (§7.2's slot). It used to carry the pre-launch notice;
   * live, it carries the equivalent true statement — that there is no
   * waitlist standing between a visitor and the product.
   */
  status: 'The network is live. The studio is open for work.',

  /**
   * Unreachable while `isPreLaunch()` is false — Hero.tsx sends a live
   * visitor straight to `/app` instead. Kept rather than deleted: a rollback
   * to `coming-soon` should not also mean reconstructing this CTA from
   * scratch, and MarketingHeader still uses the identical pair.
   */
  primaryCta: { label: 'Request a project', href: '/request' },
  secondaryCta: { label: 'What is CDN?', href: '#what' },
} as const;

export const what = {
  id: 'what',
  title: 'What is Creative Design Networks?',
  body: [
    'Most tools ask you to organise your work as lists inside folders. CDN starts somewhere else: with a single node, and everything you connect to it.',
    'Ideas, projects, people, tools and information sit on a map you can move through — expanding outward as far as it needs to go, so related things stay near each other instead of scattered across separate apps.',
    `The platform is live today. ${site.shortName} is also a working studio: we take on design and development projects for other people, and that work continues to fund and sharpen what we build.`,
  ],
} as const;

/**
 * The interactive demonstration inside "What is CDN?".
 *
 * The paragraph above it makes a claim a picture cannot: that a map *expands
 * outward as far as it needs to go*. A static diagram asserts that; this lets
 * the reader do it once, on six nodes, in about four seconds.
 *
 * Deliberately generic. These are the shapes of things a person already has —
 * not features, not screens, and not a claim that any of it is available. The
 * families and their colours are the product's real ones, so the illustration
 * and the thing being built do not disagree.
 */
export const whatDemo = {
  /** Sits under the diagram and is read out; see ExpandingMap. */
  caption:
    'An illustration of the idea — select a node to expand it. The real map works the same way.',
  centre: { label: 'A project' },
  branches: [
    {
      id: 'ideas',
      label: 'Ideas',
      family: 'create',
      angle: -90,
      children: ['Sketches', 'Notes'],
    },
    {
      id: 'information',
      label: 'Information',
      family: 'discover',
      angle: -30,
      children: ['Research', 'Links'],
    },
    {
      id: 'work',
      label: 'Work',
      family: 'organise',
      angle: 30,
      children: ['Brief', 'Timeline'],
    },
    {
      id: 'people',
      label: 'People',
      family: 'people',
      angle: 90,
      children: ['Client', 'Studio'],
    },
    {
      id: 'tools',
      label: 'Tools',
      family: 'services',
      angle: 150,
      children: ['Files', 'Repo'],
    },
    {
      id: 'money',
      label: 'Money',
      family: 'commerce',
      angle: 210,
      children: ['Budget', 'Invoices'],
    },
  ],
} as const;

export const howItWorks = {
  id: 'how',
  title: 'How it works',
  intro: 'Three ideas hold the whole thing together.',
  steps: [
    {
      number: '01',
      title: 'Start with one node',
      body: 'A single point on a dark canvas. Everything grows from it, so there is never an empty screen asking you to invent a structure.',
    },
    {
      number: '02',
      title: 'Expand outward',
      body: 'Related things sit in rings around what they belong to. Move outward for detail, inward for context — the shape of the map is the shape of the work.',
    },
    {
      number: '03',
      title: 'Connect and share',
      body: 'Maps can be built with other people and shared as a link — so a plan is something you send, not something you describe.',
    },
  ],
} as const;

export const servicesSection = {
  id: 'services',
  title: 'What we do',
  intro:
    'The network is live. The studio remains open alongside it — we design and build software for clients today.',
  cta: { label: 'See all services', href: '/services' },
} as const;

export const audiences = {
  id: 'who',
  title: 'Who it is for',
  items: [
    {
      title: 'Founders and small teams',
      body: 'You have a product in your head and need someone who can build it properly the first time.',
      family: 'create' as const,
    },
    {
      title: 'Businesses with a stalled build',
      body: 'Something was started and never finished. We are comfortable picking up work someone else began.',
      family: 'services' as const,
    },
    {
      title: 'People who think in maps',
      body: 'If lists have never quite fitted the way you work, CDN is built squarely for you.',
      family: 'discover' as const,
    },
    {
      title: 'Partners and collaborators',
      body: 'Studios, agencies and specialists we can build alongside.',
      family: 'people' as const,
    },
  ],
} as const;

export const vision = {
  id: 'vision',
  /** The section title says "vision" so the framing is unmissable. */
  title: 'Where this is going',
  lead: 'The map is real. Here is what we are building next.',
  body: [
    'An assistant that helps you organise a map rather than deciding for you — proposing structure you review and approve, never writing over your work unasked.',
    'More of the network switched on: places for people, partners and ideas that today sit marked Coming Soon inside the map itself, honestly, where you can see exactly what is left.',
  ],
  note: 'We will say clearly when each part is ready. Until then it is a plan, not a promise.',
} as const;

/**
 * The blueprint beside "Where this is going".
 *
 * Every label here is a paraphrase of a phrase already in `vision.body` — no
 * capability appears in the diagram that the prose has not already named, and
 * nothing is added that we have not said we are building toward. If the copy
 * changes, these change with it.
 *
 * Drawn unbuilt on purpose; see VisionSketch.
 */
export const visionSketch = {
  centre: 'A map',
  /** From "assistance that helps you organise rather than deciding for you". */
  branches: [
    { id: 'assist', label: 'Helped along', family: 'create', angle: -90 },
    /** From "more of the network switched on". */
    { id: 'expand', label: 'New parts of the ring', family: 'people', angle: 90 },
  ],
  caption:
    'The same map, sketched rather than built. Dashed because these two are not live yet.',
} as const;

export const newsletter = {
  id: 'updates',
  title: 'Get product updates',
  body: 'One email when we ship something worth knowing about. No newsletter, no sequence.',
  cta: 'Keep me posted',
  consent: 'I agree to receive occasional product updates by email.',
  success: "You're on the list. We'll email when there is something worth showing.",
} as const;

export const contactSection = {
  id: 'contact',
  title: 'Talk to us',
  body: 'A real person reads every message.',
} as const;
