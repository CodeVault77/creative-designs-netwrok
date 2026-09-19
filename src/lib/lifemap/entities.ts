import type { ArchiveEntry, EntryKind } from './archive';

/**
 * Turning archive entries into a personal knowledge graph.
 *
 * The business plan describes the intent: "every mention of a business idea —
 * across posts, photos, documents, and conversations spanning years — could be
 * automatically grouped into a single evolving narrative".
 *
 * ── Deterministic first, AI second ──────────────────────────────────────────
 *
 * The obvious build is to send everything to a model and ask for a knowledge
 * graph. That is wrong here for three reasons that all point the same way:
 *
 *   cost      somebody's archive is tens of thousands of entries. Model calls
 *             over all of it, per import, is real money for a feature people
 *             will try once out of curiosity.
 *
 *   privacy   this is the most personal data the product will ever hold —
 *             years of somebody's messages and photographs. Sending all of it
 *             to a third party to find out that Tuesday appears often is a
 *             poor trade, and it is one the person would have to be asked for.
 *
 *   quality   dates, participants, places and co-occurrence are FACTS in the
 *             archive. Asking a model to infer what is already written down
 *             invites it to be creative about somebody's life.
 *
 * So structure is extracted deterministically here, and `lib/ai` is used for
 * the genuinely interpretive step — naming a cluster, summarising a narrative
 * — on the small amount of text that survives clustering. Human-in-the-loop
 * as everywhere else: nothing is written to a map without confirmation.
 */

export type EntityKind = 'person' | 'place' | 'theme' | 'period';

export interface Entity {
  kind: EntityKind;
  /** Stable within one import; used to link entries to entities. */
  key: string;
  label: string;
  /** How many entries mention it. Drives node weight. */
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface Cluster {
  key: string;
  label: string;
  entryIndexes: number[];
  entities: string[];
  firstSeen: string | null;
  lastSeen: string | null;
}

/**
 * Words that carry no meaning as a theme.
 *
 * English-only, and that is a limitation stated rather than hidden: an archive
 * in another language will produce weaker themes until this list is
 * localised. It is not a correctness problem — the clustering still works on
 * people, places and time, which are language-independent — but the themes
 * will be worse, and somebody reading their own Spanish archive deserves to
 * know why.
 */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'you',
  'was',
  'are',
  'have',
  'from',
  'not',
  'but',
  'all',
  'his',
  'her',
  'they',
  'them',
  'been',
  'has',
  'had',
  'were',
  'what',
  'when',
  'where',
  'who',
  'will',
  'would',
  'could',
  'just',
  'like',
  'get',
  'got',
  'out',
  'about',
  'into',
  'over',
  'some',
  'more',
  'very',
  'can',
  'one',
  'now',
  'day',
  'today',
  'time',
  'good',
  'great',
  'love',
  'know',
  'think',
  'going',
  'here',
  'there',
  'back',
]);

const MIN_TERM_LENGTH = 4;
const MIN_THEME_COUNT = 3;

function terms(text: string): string[] {
  return (
    text
      .toLowerCase()
      // Unicode-aware, so accented and non-Latin scripts survive. `\w` would
      // split "café" into "caf" and drop every Japanese character entirely.
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(word))
  );
}

function extend(entity: Entity, at: string | null): void {
  entity.count += 1;
  if (!at) return;

  if (!entity.firstSeen || at < entity.firstSeen) entity.firstSeen = at;
  if (!entity.lastSeen || at > entity.lastSeen) entity.lastSeen = at;
}

/**
 * Extract entities from a set of entries.
 *
 * People and places are read directly — they are facts the archive states.
 * Themes are terms that recur across several entries, which is a weak signal
 * on its own and a useful one in aggregate: a word appearing in forty entries
 * spanning three years is something that mattered.
 */
export function extractEntities(entries: readonly ArchiveEntry[]): Entity[] {
  const found = new Map<string, Entity>();

  const upsert = (kind: EntityKind, label: string, at: string | null): void => {
    const cleaned = label.trim();
    if (!cleaned) return;

    const key = `${kind}:${cleaned.toLowerCase()}`;
    const existing = found.get(key);

    if (existing) {
      extend(existing, at);
      return;
    }

    found.set(key, {
      kind,
      key,
      label: cleaned,
      count: 1,
      firstSeen: at,
      lastSeen: at,
    });
  };

  const termCounts = new Map<string, { count: number; label: string }>();

  for (const entry of entries) {
    for (const person of entry.people) upsert('person', person, entry.at);
    if (entry.place) upsert('place', entry.place, entry.at);

    /*
     * Terms are counted per ENTRY, not per occurrence.
     *
     * A post that says "launch" nine times is one entry about a launch, not
     * nine. Counting occurrences would make one enthusiastic post outrank a
     * theme that genuinely ran through somebody's year.
     */
    const seen = new Set(terms(`${entry.title} ${entry.body}`));

    for (const term of seen) {
      const existing = termCounts.get(term);
      if (existing) existing.count += 1;
      else termCounts.set(term, { count: 1, label: term });
    }
  }

  for (const [term, { count, label }] of termCounts) {
    if (count < MIN_THEME_COUNT) continue;

    const themeEntries = entries.filter((entry) =>
      terms(`${entry.title} ${entry.body}`).includes(term),
    );

    const dates = themeEntries
      .map((entry) => entry.at)
      .filter((at): at is string => at !== null)
      .sort();

    found.set(`theme:${term}`, {
      kind: 'theme',
      key: `theme:${term}`,
      label,
      count,
      firstSeen: dates[0] ?? null,
      lastSeen: dates[dates.length - 1] ?? null,
    });
  }

  return [...found.values()].sort((a, b) => b.count - a.count);
}

/**
 * Group entries into narratives.
 *
 * ── Co-occurrence, not similarity ───────────────────────────────────────────
 *
 * Two entries belong together when they share entities — the same people, the
 * same place, the same recurring term. That is a fact about the archive rather
 * than a judgement about meaning, so it is stable, explainable and free.
 *
 * Semantic similarity would find pairs this misses, and it needs an embedding
 * per entry, which is the cost and privacy problem above. The right order is
 * this first, then embeddings offered as an explicit, paid, consented step.
 */
export function clusterEntries(
  entries: readonly ArchiveEntry[],
  entities: readonly Entity[],
  minSize = 2,
): Cluster[] {
  const byEntity = new Map<string, number[]>();
  const entityByKey = new Map(entities.map((entity) => [entity.key, entity]));

  entries.forEach((entry, index) => {
    const keys = new Set<string>();

    for (const person of entry.people) keys.add(`person:${person.toLowerCase()}`);
    if (entry.place) keys.add(`place:${entry.place.toLowerCase()}`);

    for (const term of new Set(terms(`${entry.title} ${entry.body}`))) {
      if (entityByKey.has(`theme:${term}`)) keys.add(`theme:${term}`);
    }

    for (const key of keys) {
      if (!entityByKey.has(key)) continue;
      const bucket = byEntity.get(key) ?? [];
      bucket.push(index);
      byEntity.set(key, bucket);
    }
  });

  const clusters: Cluster[] = [];

  for (const [key, indexes] of byEntity) {
    if (indexes.length < minSize) continue;

    const entity = entityByKey.get(key);
    if (!entity) continue;

    const dates = indexes
      .map((index) => entries[index]?.at ?? null)
      .filter((at): at is string => at !== null)
      .sort();

    clusters.push({
      key,
      label: entity.label,
      entryIndexes: indexes,
      entities: [key],
      firstSeen: dates[0] ?? null,
      lastSeen: dates[dates.length - 1] ?? null,
    });
  }

  // Biggest first: the narratives that ran longest through somebody's archive
  // are the ones worth putting near the centre of their map.
  return clusters.sort((a, b) => b.entryIndexes.length - a.entryIndexes.length);
}

export interface TimelineBucket {
  /** `YYYY` or `YYYY-MM`. */
  period: string;
  count: number;
  kinds: Partial<Record<EntryKind, number>>;
}

/**
 * A timeline.
 *
 * By month when the archive spans a few years, by year when it spans many.
 * A fixed granularity is wrong at one end or the other: monthly over fifteen
 * years is 180 buckets nobody can read, and yearly over eight months is one.
 */
export function buildTimeline(entries: readonly ArchiveEntry[]): TimelineBucket[] {
  const dated = entries.filter((entry) => entry.at !== null);
  if (dated.length === 0) return [];

  const times = dated.map((entry) => new Date(entry.at!).getTime()).sort();
  const spanYears =
    (times[times.length - 1]! - times[0]!) / (365.25 * 24 * 60 * 60 * 1000);

  const byYear = spanYears > 6;
  const buckets = new Map<string, TimelineBucket>();

  for (const entry of dated) {
    const at = entry.at!;
    const period = byYear ? at.slice(0, 4) : at.slice(0, 7);

    const bucket = buckets.get(period) ?? { period, count: 0, kinds: {} };
    bucket.count += 1;
    bucket.kinds[entry.kind] = (bucket.kinds[entry.kind] ?? 0) + 1;

    buckets.set(period, bucket);
  }

  return [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export interface ProposedNode {
  /** Stable within one import, so a re-run produces the same proposal. */
  key: string;
  title: string;
  type: string;
  /** The centre, a cluster, or a leaf. */
  parentKey: string | null;
  weight: number;
  payload: Record<string, unknown>;
}

/**
 * Turn an analysed archive into a PROPOSED map.
 *
 * ── A proposal, not a map ───────────────────────────────────────────────────
 *
 * Nothing here writes anything. It returns what a map WOULD look like, so the
 * person can see their own life laid out and decide before it becomes real.
 *
 * That is the same human-in-the-loop rule the AI assistant follows, and it
 * matters more here than anywhere else in the product: this is somebody's
 * personal history, and generating it silently — with whatever the clustering
 * got wrong — would be presenting a distorted account of their life as fact.
 */
export function proposeMap(
  entries: readonly ArchiveEntry[],
  options: { rootTitle?: string; maxClusters?: number; maxLeaves?: number } = {},
): ProposedNode[] {
  const entities = extractEntities(entries);
  const clusters = clusterEntries(entries, entities);

  const maxClusters = options.maxClusters ?? 12;
  const maxLeaves = options.maxLeaves ?? 8;

  const nodes: ProposedNode[] = [
    {
      key: 'root',
      title: options.rootTitle ?? 'My LifeMap',
      type: 'topic',
      parentKey: null,
      weight: 1,
      payload: { lifemap: true, entries: entries.length },
    },
  ];

  const busiest = clusters.slice(0, maxClusters);
  const largest = busiest[0]?.entryIndexes.length ?? 1;

  for (const cluster of busiest) {
    const kind = cluster.key.split(':')[0] ?? 'theme';

    nodes.push({
      key: cluster.key,
      title: cluster.label,
      // People become `contact` nodes and places become `topic`s, reusing the
      // CRM package from Phase 7 rather than inventing LifeMap-only types.
      type: kind === 'person' ? 'contact' : 'topic',
      parentKey: 'root',
      // Relative to the biggest cluster, so weight means "how much of this
      // archive" rather than an absolute that depends on archive size.
      weight: Math.min(1, cluster.entryIndexes.length / largest),
      payload: {
        lifemap: true,
        entryCount: cluster.entryIndexes.length,
        firstSeen: cluster.firstSeen,
        lastSeen: cluster.lastSeen,
      },
    });

    /*
     * The most RECENT entries under each cluster, not the first.
     *
     * A person opening their LifeMap recognises last year before they
     * recognise 2011, and recognition is what makes the map navigable at all.
     */
    const leaves = cluster.entryIndexes
      .map((index) => ({ index, entry: entries[index]! }))
      .sort((a, b) => (b.entry.at ?? '').localeCompare(a.entry.at ?? ''))
      .slice(0, maxLeaves);

    for (const { index, entry } of leaves) {
      nodes.push({
        key: `${cluster.key}#${index}`,
        title: entry.title.slice(0, 60) || 'Untitled',
        type: entry.kind === 'photo' ? 'image' : 'note',
        parentKey: cluster.key,
        weight: 0.4,
        payload: {
          lifemap: true,
          at: entry.at,
          source: entry.source,
          body: entry.body.slice(0, 2000),
        },
      });
    }
  }

  return nodes;
}
