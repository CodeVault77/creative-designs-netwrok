import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The Page Watcher seed.
 *
 * §20 rates this phase's risk as "cold-start emptiness", and §13 names the
 * mitigation outright: "seed 60–100 pages from existing CDN and partner
 * projects before launch, and let the empty state say honestly that the
 * community is new."
 *
 * So this file IS the mitigation, and it is a product decision rather than
 * test fixtures. Two rules follow from that:
 *
 *   - Every seeded item is real CDN-shaped content — a public map, a service,
 *     a project, a guide — not lorem ipsum. A feed of placeholders is worse
 *     than an empty one, because it teaches people the feed is worthless.
 *   - Seeded items are marked as such (no owner) and the feed says where
 *     things come from. Passing off seeds as community activity is the kind of
 *     thing that is very hard to walk back.
 */

export interface InterestTag {
  tag: string;
  label: string;
  family: FamilyName;
}

/**
 * The interest vocabulary — §13 step 2's "grid of chips, family-tinted".
 *
 * Fixed rather than free text. A chip grid needs a known set with known
 * families and countable membership; free tags give you a long tail of
 * single-item interests and a picker nobody can scan.
 *
 * Spread across all six families deliberately, so the picker itself teaches
 * the colour system before the user has seen a map.
 */
export const INTEREST_TAGS: InterestTag[] = [
  { tag: 'design', label: 'Design', family: 'create' },
  { tag: 'branding', label: 'Branding', family: 'create' },
  { tag: 'writing', label: 'Writing', family: 'create' },
  { tag: 'motion', label: 'Motion & video', family: 'create' },
  { tag: 'illustration', label: 'Illustration', family: 'create' },

  { tag: 'research', label: 'Research', family: 'discover' },
  { tag: 'learning', label: 'Learning', family: 'discover' },
  { tag: 'ai', label: 'AI & tools', family: 'discover' },
  { tag: 'engineering', label: 'Engineering', family: 'discover' },
  { tag: 'data', label: 'Data', family: 'discover' },

  { tag: 'freelancing', label: 'Freelancing', family: 'services' },
  { tag: 'studios', label: 'Studios', family: 'services' },
  { tag: 'consulting', label: 'Consulting', family: 'services' },

  { tag: 'community', label: 'Community', family: 'people' },
  { tag: 'mentoring', label: 'Mentoring', family: 'people' },
  { tag: 'hiring', label: 'Hiring', family: 'people' },

  { tag: 'productivity', label: 'Productivity', family: 'organise' },
  { tag: 'planning', label: 'Planning', family: 'organise' },
  { tag: 'process', label: 'Process', family: 'organise' },

  { tag: 'startups', label: 'Startups', family: 'commerce' },
  { tag: 'pricing', label: 'Pricing', family: 'commerce' },
  { tag: 'marketing', label: 'Marketing', family: 'commerce' },
];

export interface SeedItem {
  id: string;
  kind: 'map' | 'service' | 'project' | 'page';
  title: string;
  excerpt: string;
  source: string;
  family: FamilyName;
  href: string;
  tags: string[];
  /** Days ago, so the seed spreads across a plausible recent window. */
  age: number;
}

/**
 * Eighty seeded items.
 *
 * Spread across every interest tag so that no single-interest selection lands
 * on an empty feed — the specific way cold start bites. The relevance ranker
 * is only as good as this coverage, and a tag with two items is a tag that
 * looks broken the first time someone picks it.
 */
/**
 * Declared above SEED_ITEMS on purpose. Function declarations hoist but `let`
 * does not, so a counter defined below the array it numbers is in the temporal
 * dead zone when the array initialises.
 */
let counter = 0;

export const SEED_ITEMS: SeedItem[] = [
  // ---------------------------------------------------------------- create
  item(
    'Designing a radial map that stays readable',
    'How ring spacing, angular slots and label collision were resolved on the Community Map.',
    'CDN Studio',
    'create',
    ['design', 'process'],
    1,
  ),
  item(
    'A brand system built as a map, not a PDF',
    'Turning a 90-page brand book into a navigable set of nodes teams actually open.',
    'Northlight',
    'create',
    ['branding', 'design'],
    2,
  ),
  item(
    'Naming things: a working method',
    'The naming process one studio uses, written up as a repeatable checklist.',
    'Fieldwork',
    'create',
    ['branding', 'writing'],
    3,
  ),
  item(
    'Writing microcopy for empty states',
    'Why the empty state is the highest-leverage copy in a product, with examples.',
    'Plainspoken',
    'create',
    ['writing', 'design'],
    4,
  ),
  item(
    'Motion that explains rather than decorates',
    'A short guide to using movement to show causality in interfaces.',
    'Loop Lab',
    'create',
    ['motion', 'design'],
    5,
  ),
  item(
    'Storyboarding a 30-second product film',
    'From script to animatic, with the actual boards.',
    'Loop Lab',
    'create',
    ['motion'],
    7,
  ),
  item(
    'Illustration systems for small teams',
    'Building a drawing style that survives more than one illustrator.',
    'Penfold',
    'create',
    ['illustration', 'branding'],
    8,
  ),
  item(
    'Type scales that survive real content',
    'Choosing seven steps instead of twelve, and why.',
    'Northlight',
    'create',
    ['design'],
    9,
  ),
  item(
    'A colour system for dark interfaces',
    'Six families, three glow levels, and the rule that stops it blowing out.',
    'CDN Studio',
    'create',
    ['design', 'branding'],
    11,
  ),
  item(
    'The case against the style guide',
    'Why a static guide rots, and what to build instead.',
    'Fieldwork',
    'create',
    ['branding', 'process'],
    13,
  ),
  item(
    'Editing your own writing',
    'A three-pass method for cutting a draft in half without losing the argument.',
    'Plainspoken',
    'create',
    ['writing'],
    15,
  ),
  item(
    'Drawing diagrams that show the mechanism',
    'Most diagrams show boxes. The useful ones show what moves.',
    'Penfold',
    'create',
    ['illustration', 'design'],
    17,
  ),

  // -------------------------------------------------------------- discover
  item(
    'How we ran 40 user interviews in three weeks',
    'Recruiting, scripting, and the spreadsheet that made synthesis bearable.',
    'Fieldwork',
    'discover',
    ['research', 'process'],
    1,
  ),
  item(
    'Reading a research paper without a PhD',
    'A practical order to read sections in, and what to skip.',
    'Open Lab',
    'discover',
    ['research', 'learning'],
    2,
  ),
  item(
    'Building a personal knowledge map',
    'One person’s five-year system, and what they would do differently.',
    'Open Lab',
    'discover',
    ['learning', 'productivity'],
    3,
  ),
  item(
    'Spaced repetition for practical skills',
    'Applying a memory technique to things that are not facts.',
    'Open Lab',
    'discover',
    ['learning'],
    4,
  ),
  item(
    'What LLMs are actually good at in a design process',
    'An honest inventory after a year of trying, including the failures.',
    'CDN Studio',
    'discover',
    ['ai', 'design'],
    5,
  ),
  item(
    'Structured output beats prompt engineering',
    'Why a tool schema is more reliable than asking nicely for JSON.',
    'Signal',
    'discover',
    ['ai', 'engineering'],
    6,
  ),
  item(
    'A canvas renderer that holds 60fps',
    'Pre-baked sprites, culling and clustering, measured rather than assumed.',
    'CDN Studio',
    'discover',
    ['engineering', 'data'],
    7,
  ),
  item(
    'SQLite is probably enough',
    'Where a single-file database stops being enough, with numbers.',
    'Signal',
    'discover',
    ['engineering', 'data'],
    9,
  ),
  item(
    'Instrumenting a product without drowning in events',
    'Twelve events, named once, that answered every question we had.',
    'Signal',
    'discover',
    ['data', 'process'],
    10,
  ),
  item(
    'Charting for people who are not looking closely',
    'Defaults that make a chart readable at a glance.',
    'Open Lab',
    'discover',
    ['data', 'design'],
    12,
  ),
  item(
    'Interviewing for research, not confirmation',
    'The five questions that invite a real answer.',
    'Fieldwork',
    'discover',
    ['research'],
    14,
  ),
  item(
    'Learning in public, carefully',
    'How to share work in progress without it costing you.',
    'Open Lab',
    'discover',
    ['learning', 'community'],
    16,
  ),
  item(
    'Evaluating an AI feature honestly',
    'Building the eval before building the feature.',
    'Signal',
    'discover',
    ['ai', 'research'],
    18,
  ),
  item(
    'Where our search index nearly leaked',
    'An index authorises nothing — a post-mortem on a near miss.',
    'CDN Studio',
    'discover',
    ['engineering'],
    20,
  ),

  // -------------------------------------------------------------- services
  item(
    'Northlight — brand and identity',
    'A four-person studio working on identity systems for technical products.',
    'Northlight',
    'services',
    ['studios', 'branding'],
    2,
  ),
  item(
    'Fieldwork — product research',
    'Discovery, interviews and synthesis for teams without a researcher.',
    'Fieldwork',
    'services',
    ['studios', 'research'],
    3,
  ),
  item(
    'Loop Lab — motion and film',
    'Product films, explainers and motion systems.',
    'Loop Lab',
    'services',
    ['studios', 'motion'],
    4,
  ),
  item(
    'Penfold — illustration',
    'Editorial and product illustration, systems and one-offs.',
    'Penfold',
    'services',
    ['studios', 'illustration'],
    5,
  ),
  item(
    'Signal — data and engineering',
    'Analytics, pipelines and the occasional rescue.',
    'Signal',
    'services',
    ['consulting', 'data'],
    6,
  ),
  item(
    'Plainspoken — writing and content',
    'UX writing, documentation and naming.',
    'Plainspoken',
    'services',
    ['studios', 'writing'],
    7,
  ),
  item(
    'Setting your first freelance rate',
    'A method that starts from your costs, not from what feels bold.',
    'Plainspoken',
    'services',
    ['freelancing', 'pricing'],
    8,
  ),
  item(
    'The contract clauses that actually matter',
    'Six clauses worth arguing over, and the rest you can accept.',
    'Fieldwork',
    'services',
    ['freelancing'],
    10,
  ),
  item(
    'Scoping a project so it can be finished',
    'Writing a scope that survives contact with a client.',
    'Northlight',
    'services',
    ['consulting', 'planning'],
    11,
  ),
  item(
    'Going from freelance to a studio of three',
    'What changed, what broke, and the month it nearly ended.',
    'Loop Lab',
    'services',
    ['freelancing', 'studios'],
    13,
  ),
  item(
    'Saying no to the wrong project',
    'A short checklist used before every proposal.',
    'Fieldwork',
    'services',
    ['consulting', 'freelancing'],
    15,
  ),
  item(
    'Running a retainer that both sides like',
    'Structuring ongoing work so it does not quietly become unpaid.',
    'Signal',
    'services',
    ['consulting', 'pricing'],
    17,
  ),

  // ---------------------------------------------------------------- people
  item(
    'Running a design critique that helps',
    'Structure, roles and the one rule that changed ours.',
    'Northlight',
    'people',
    ['community', 'process'],
    1,
  ),
  item(
    'Mentoring without taking over',
    'How to give feedback on work you would have done differently.',
    'Fieldwork',
    'people',
    ['mentoring'],
    3,
  ),
  item(
    'What we look for in a portfolio',
    'Three hiring managers on what they actually read.',
    'CDN Studio',
    'people',
    ['hiring', 'community'],
    4,
  ),
  item(
    'A first-90-days plan for a design hire',
    'What to hand someone so they can be useful in week one.',
    'Northlight',
    'people',
    ['hiring', 'planning'],
    6,
  ),
  item(
    'Building a small community that lasts',
    'Why most fail in month four, and what the survivors did.',
    'Open Lab',
    'people',
    ['community'],
    8,
  ),
  item(
    'Pair-working across time zones',
    'Making asynchronous collaboration feel less lonely.',
    'Signal',
    'people',
    ['community', 'process'],
    10,
  ),
  item(
    'Giving feedback that can be acted on',
    'Replacing "I don’t like it" with something useful.',
    'Plainspoken',
    'people',
    ['mentoring', 'community'],
    12,
  ),
  item(
    'Interviewing designers with a real exercise',
    'A take-home that respects people’s time.',
    'Loop Lab',
    'people',
    ['hiring'],
    14,
  ),
  item(
    'Finding a mentor when you have no network',
    'Practical steps that do not involve cold-emailing strangers.',
    'Open Lab',
    'people',
    ['mentoring', 'learning'],
    16,
  ),
  item(
    'The studio meeting we deleted',
    'What happened when we cut the weekly all-hands.',
    'Penfold',
    'people',
    ['community', 'process'],
    19,
  ),

  // -------------------------------------------------------------- organise
  item(
    'Planning a quarter without a Gantt chart',
    'A one-page format that survived eight quarters.',
    'Signal',
    'organise',
    ['planning', 'productivity'],
    1,
  ),
  item(
    'The weekly review, minimised',
    'Twenty minutes, four questions.',
    'Open Lab',
    'organise',
    ['productivity'],
    2,
  ),
  item(
    'Writing a decision record',
    'Why the reasoning is the artefact, not the decision.',
    'CDN Studio',
    'organise',
    ['process', 'planning'],
    3,
  ),
  item(
    'Estimating work you have never done',
    'Ranges, reference classes, and admitting uncertainty.',
    'Fieldwork',
    'organise',
    ['planning'],
    5,
  ),
  item(
    'A file naming convention that stuck',
    'Boring, and it has outlasted three tools.',
    'Penfold',
    'organise',
    ['process', 'productivity'],
    6,
  ),
  item(
    'Running a project with one document',
    'Everything in one place, updated in public.',
    'Northlight',
    'organise',
    ['planning', 'process'],
    8,
  ),
  item(
    'Handover notes that actually work',
    'What to write down before you go on holiday.',
    'Plainspoken',
    'organise',
    ['process', 'writing'],
    9,
  ),
  item(
    'Deep work in a studio that talks a lot',
    'Protecting focus without becoming unreachable.',
    'Loop Lab',
    'organise',
    ['productivity'],
    11,
  ),
  item(
    'Templates are a trap, mostly',
    'When a template helps and when it stops thinking.',
    'Fieldwork',
    'organise',
    ['process'],
    13,
  ),
  item(
    'Archiving a finished project',
    'A closing checklist so it can be found in two years.',
    'Signal',
    'organise',
    ['process', 'planning'],
    15,
  ),
  item(
    'Inbox zero is not the goal',
    'Handling a shared studio inbox without losing enquiries.',
    'Plainspoken',
    'organise',
    ['productivity'],
    18,
  ),

  // -------------------------------------------------------------- commerce
  item(
    'Pricing creative work by value',
    'Working through three real projects and what each was worth.',
    'Northlight',
    'commerce',
    ['pricing', 'freelancing'],
    1,
  ),
  item(
    'The proposal template we send',
    'Annotated, including the parts clients skip.',
    'Fieldwork',
    'commerce',
    ['pricing', 'consulting'],
    2,
  ),
  item(
    'Marketing a studio without posting daily',
    'Where our last twenty projects actually came from.',
    'Loop Lab',
    'commerce',
    ['marketing', 'studios'],
    3,
  ),
  item(
    'A landing page that explains one thing',
    'Cutting a page to a single claim, with before and after.',
    'Plainspoken',
    'commerce',
    ['marketing', 'writing'],
    4,
  ),
  item(
    'Bootstrapping a product alongside client work',
    'Two years of splitting time, honestly accounted.',
    'Signal',
    'commerce',
    ['startups', 'freelancing'],
    6,
  ),
  item(
    'When to raise your rates',
    'Three signals, and how to tell existing clients.',
    'Penfold',
    'commerce',
    ['pricing'],
    7,
  ),
  item(
    'Building an audience from a body of work',
    'Publishing what you already made instead of making content.',
    'CDN Studio',
    'commerce',
    ['marketing', 'community'],
    9,
  ),
  item(
    'The first ten customers',
    'How five small products found theirs.',
    'Open Lab',
    'commerce',
    ['startups'],
    10,
  ),
  item(
    'Subscription pricing for tools people use weekly',
    'Matching price to frequency of value.',
    'Signal',
    'commerce',
    ['pricing', 'startups'],
    12,
  ),
  item(
    'Positioning against a bigger competitor',
    'Choosing the ground you can win on.',
    'Northlight',
    'commerce',
    ['marketing', 'startups'],
    14,
  ),
  item(
    'An invoice that gets paid on time',
    'Small changes that measurably shortened our payment cycle.',
    'Fieldwork',
    'commerce',
    ['freelancing', 'pricing'],
    16,
  ),
  item(
    'Turning a side project into a service',
    'What changed when it had to support someone.',
    'Loop Lab',
    'commerce',
    ['startups', 'consulting'],
    19,
  ),

  // ----------------------------------------------------- maps and projects
  map(
    'The CDN design system, as a map',
    'Tokens, primitives and the rules behind them.',
    'CDN Studio',
    'create',
    ['design', 'process'],
    2,
  ),
  map(
    'Research method library',
    'Every method we use, when to use it, and what it costs.',
    'Fieldwork',
    'discover',
    ['research', 'learning'],
    4,
  ),
  map(
    'Freelance operating manual',
    'Rates, contracts, scoping and chasing invoices.',
    'Plainspoken',
    'services',
    ['freelancing', 'pricing'],
    5,
  ),
  map(
    'A studio’s first year',
    'Decisions, mistakes and numbers, laid out as a map.',
    'Loop Lab',
    'commerce',
    ['startups', 'studios'],
    8,
  ),
  map(
    'Learning front-end in public',
    'Six months of notes, structured.',
    'Open Lab',
    'discover',
    ['learning', 'engineering'],
    11,
  ),
  map(
    'Community programme plan',
    'How a 400-person community is actually run.',
    'Open Lab',
    'people',
    ['community', 'planning'],
    14,
  ),
  project(
    'Northlight identity refresh',
    'The full case study, including what the client rejected.',
    'Northlight',
    'create',
    ['branding', 'design'],
    6,
  ),
  project(
    'Signal analytics rebuild',
    'Replacing an event pipeline without losing history.',
    'Signal',
    'discover',
    ['data', 'engineering'],
    12,
  ),
  project(
    'Penfold editorial series',
    'Twelve illustrations for a long-running column.',
    'Penfold',
    'create',
    ['illustration'],
    17,
  ),
  project(
    'Loop Lab product film',
    'A 40-second film, from brief to delivery.',
    'Loop Lab',
    'create',
    ['motion', 'marketing'],
    20,
  ),
];

function base(
  kind: SeedItem['kind'],
  title: string,
  excerpt: string,
  source: string,
  family: FamilyName,
  tags: string[],
  age: number,
): SeedItem {
  counter += 1;
  const id = `c_seed_${String(counter).padStart(3, '0')}`;
  return {
    id,
    kind,
    title,
    excerpt,
    source,
    family,
    // Seeded items are readable inside CDN, at a stable in-app route. They
    // deliberately do NOT link out to a third-party URL: §13's assumption is
    // that Page Watcher browses CDN community content, and a feed that mostly
    // bounces people to other websites is a different product.
    href: `/watch/item/${id}`,
    tags,
    age,
  };
}

function item(
  title: string,
  excerpt: string,
  source: string,
  family: FamilyName,
  tags: string[],
  age: number,
): SeedItem {
  return base('page', title, excerpt, source, family, tags, age);
}

function map(
  title: string,
  excerpt: string,
  source: string,
  family: FamilyName,
  tags: string[],
  age: number,
): SeedItem {
  return base('map', title, excerpt, source, family, tags, age);
}

function project(
  title: string,
  excerpt: string,
  source: string,
  family: FamilyName,
  tags: string[],
  age: number,
): SeedItem {
  return base('project', title, excerpt, source, family, tags, age);
}

/** Every tag that appears on at least one seeded item. Used by the seed test. */
export function seededTagCoverage(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const seed of SEED_ITEMS) {
    for (const tag of seed.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}
