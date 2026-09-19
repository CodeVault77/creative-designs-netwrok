import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createUser, getMap, listOwnedMaps } from '@/lib/db/repo';
import {
  MAX_DEPTH,
  detectSource,
  parseArchiveJson,
  parseTimestamp,
  repairMojibake,
} from './archive';
import {
  buildTimeline,
  clusterEntries,
  extractEntities,
  proposeMap,
} from './entities';
import {
  applyImport,
  deleteImport,
  entitiesFor,
  entriesFor,
  getImport,
  importArchive,
  importsFor,
  previewImport,
  searchLifeMap,
  timelineFor,
  MAX_IMPORTS,
} from './repo';

/**
 * LifeMap tests.
 *
 * ── What is actually at stake ───────────────────────────────────────────────
 *
 * This is the most personal data the product will ever hold: years of
 * somebody's messages, photographs and relationships. The privacy block below
 * is the most important in the file, and it asserts something stronger than
 * "the permission check works" — it asserts that there is no path to another
 * account's LifeMap at all, INCLUDING for staff.
 *
 * Moderation reaches across ownership everywhere else in this codebase. It
 * deliberately does not reach here, and that is tested rather than trusted.
 */

let db: Database;
let owner: { userId: string; isStaff: boolean };
let stranger: { userId: string; isStaff: boolean };
let staff: { userId: string; isStaff: boolean };

const FACEBOOK = JSON.stringify([
  {
    timestamp: 1_700_000_000,
    title: 'Adepoju shared a post',
    data: [{ post: 'Started work on the mapping project today.' }],
    tags: [{ name: 'Santiago Rueda' }],
    attachments: [{ data: [{ place: { name: 'Lagos' } }] }],
  },
  {
    timestamp: 1_705_000_000,
    data: [{ post: 'The mapping project is going well. Met Santiago again.' }],
    tags: [{ name: 'Santiago Rueda' }],
  },
  {
    timestamp: 1_710_000_000,
    data: [{ post: 'Mapping project milestone reached.' }],
  },
]);

beforeEach(() => {
  db = createTestDb();

  for (const [id, handle] of [
    ['u_owner', 'owner'],
    ['u_stranger', 'stranger'],
    ['u_staff', 'staffer'],
  ] as const) {
    createUser(
      {
        id,
        email: `${handle}@example.com`,
        passwordHash: 'x',
        handle,
        displayName: handle,
      },
      db,
    );
  }

  owner = { userId: 'u_owner', isStaff: false };
  stranger = { userId: 'u_stranger', isStaff: false };
  staff = { userId: 'u_staff', isStaff: true };
});

// -------------------------------------------------------------- parsing

describe('parsing an archive', () => {
  it('reads Facebook posts', () => {
    const result = parseArchiveJson(FACEBOOK, 'facebook');

    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]?.body).toContain('mapping project');
    expect(result.entries[0]?.people).toEqual(['Santiago Rueda']);
    expect(result.entries[0]?.place).toBe('Lagos');
  });

  it('detects the source from structure, not the filename', () => {
    // People rename downloads. A filename is a guess; the shape is evidence.
    expect(detectSource(FACEBOOK)).toBe('facebook');
    expect(detectSource('{"items":[{"text":"hi"}]}')).toBe('generic');
  });

  it('reads a generic archive with forgiving field names', () => {
    /*
     * A partial import of somebody's own data beats refusing the file. Field
     * names vary between exporters and none of them is wrong.
     */
    const result = parseArchiveJson(
      JSON.stringify({
        items: [
          { date: '2024-05-01', text: 'A note' },
          { time: 1_700_000_000_000, body: 'Another' },
        ],
      }),
      'generic',
    );

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.at).toContain('2024-05-01');
  });

  it('skips entries with neither text nor title, and says how many', () => {
    // Importing them would add blank nodes to somebody's map.
    const result = parseArchiveJson(
      JSON.stringify([{ timestamp: 1_700_000_000 }, ...JSON.parse(FACEBOOK)]),
      'facebook',
    );

    expect(result.entries).toHaveLength(3);
    expect(result.skipped).toBe(1);
  });

  it('refuses something that is not JSON', () => {
    expect(parseArchiveJson('<html>nope</html>', 'generic').ok).toBe(false);
  });

  it('refuses a nesting bomb', () => {
    // Whatever produced it was not a genuine export.
    let bomb: unknown = { text: 'deep' };
    for (let depth = 0; depth < MAX_DEPTH + 5; depth += 1) bomb = { child: bomb };

    expect(parseArchiveJson(JSON.stringify([bomb]), 'generic').ok).toBe(false);
  });

  it('survives hostile shapes without throwing', () => {
    for (const bad of ['[]', '{}', 'null', '[null,1,"x"]', '{"posts":"nope"}']) {
      expect(() => parseArchiveJson(bad, 'facebook')).not.toThrow();
    }
  });
});

describe('the Facebook mojibake defect', () => {
  it('repairs UTF-8 that was encoded as Latin-1', () => {
    /*
     * A real, well-known defect in Facebook's exporter: "café" arrives as
     * "cafÃ©". Leaving it would mean importing somebody's life story with the
     * accents broken.
     */
    expect(repairMojibake('cafÃ©')).toBe('café');
    expect(repairMojibake('ð')).toBe('😀');
  });

  it('leaves correctly encoded text alone', () => {
    // The repair must never make text worse than it was.
    expect(repairMojibake('café')).toBe('café');
    expect(repairMojibake('日本語')).toBe('日本語');
    expect(repairMojibake('plain ascii')).toBe('plain ascii');
  });
});

describe('timestamps', () => {
  it('reads seconds and milliseconds correctly', () => {
    /*
     * Guessing wrong by a factor of a thousand puts somebody's 2019 holiday
     * in 1970 or in the year 51,000.
     */
    expect(parseTimestamp(1_700_000_000)).toContain('2023');
    expect(parseTimestamp(1_700_000_000_000)).toContain('2023');
  });

  it('reads ISO strings', () => {
    expect(parseTimestamp('2024-05-01T00:00:00Z')).toContain('2024-05-01');
  });

  it('refuses a date outside a plausible window', () => {
    // A wrong date is worse than none: it puts a memory in the wrong decade.
    expect(parseTimestamp(1)).toBeNull();
    expect(parseTimestamp(99_999_999_999_999)).toBeNull();
    expect(parseTimestamp(-1)).toBeNull();
  });

  it('returns null rather than throwing on nonsense', () => {
    for (const bad of [null, undefined, {}, [], 'not a date', NaN]) {
      expect(parseTimestamp(bad)).toBeNull();
    }
  });
});

// -------------------------------------------------------------- entities

describe('finding entities', () => {
  const entries = parseArchiveJson(FACEBOOK, 'facebook').entries;

  it('finds people the archive names', () => {
    const people = extractEntities(entries).filter((e) => e.kind === 'person');

    expect(people[0]?.label).toBe('Santiago Rueda');
    expect(people[0]?.count).toBe(2);
  });

  it('finds places', () => {
    expect(extractEntities(entries).some((e) => e.kind === 'place')).toBe(true);
  });

  it('finds a theme that recurs across entries', () => {
    const themes = extractEntities(entries).filter((e) => e.kind === 'theme');

    // "mapping" and "project" appear in all three.
    expect(themes.some((theme) => theme.label === 'project')).toBe(true);
  });

  it('counts a theme once per entry, not once per occurrence', () => {
    /*
     * A post saying "launch" nine times is one entry about a launch. Counting
     * occurrences would let one enthusiastic post outrank a theme that ran
     * through somebody's year.
     */
    const repetitive = parseArchiveJson(
      JSON.stringify([
        { timestamp: 1_700_000_000, data: [{ post: 'launch '.repeat(9) }] },
        { timestamp: 1_700_100_000, data: [{ post: 'launch day' }] },
        { timestamp: 1_700_200_000, data: [{ post: 'the launch' }] },
      ]),
      'facebook',
    ).entries;

    const theme = extractEntities(repetitive).find((e) => e.label === 'launch');

    expect(theme?.count).toBe(3);
  });

  it('tracks the span an entity covers', () => {
    const person = extractEntities(entries).find((e) => e.kind === 'person');

    expect(person?.firstSeen).not.toBeNull();
    expect(person?.lastSeen).not.toBeNull();
    expect(person!.firstSeen! <= person!.lastSeen!).toBe(true);
  });

  it('handles a non-Latin archive without dropping every word', () => {
    // `\w` would split "café" and delete Japanese entirely, which is why the
    // tokeniser is Unicode-aware.
    const japanese = parseArchiveJson(
      JSON.stringify([
        { timestamp: 1_700_000_000, data: [{ post: 'プロジェクト開始' }] },
        { timestamp: 1_700_100_000, data: [{ post: 'プロジェクト進捗' }] },
      ]),
      'facebook',
    ).entries;

    expect(japanese[0]?.body).toContain('プロジェクト');
    expect(() => extractEntities(japanese)).not.toThrow();
  });

  it('groups entries that share an entity', () => {
    const clusters = clusterEntries(entries, extractEntities(entries));

    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0]!.entryIndexes.length).toBeGreaterThanOrEqual(2);
  });

  it('builds a timeline', () => {
    const timeline = buildTimeline(entries);

    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0]!.period).toMatch(/^\d{4}(-\d{2})?$/);
    // Ordered oldest first, which is how a timeline reads.
    expect(timeline).toEqual(
      [...timeline].sort((a, b) => a.period.localeCompare(b.period)),
    );
  });

  it('returns an empty timeline when nothing is dated', () => {
    // Plenty of exported items are undated. That is not an error.
    expect(buildTimeline([{ ...entries[0]!, at: null }])).toEqual([]);
  });
});

describe('the proposed map', () => {
  const entries = parseArchiveJson(FACEBOOK, 'facebook').entries;

  it('has one root and clusters beneath it', () => {
    const proposed = proposeMap(entries);

    expect(proposed[0]?.key).toBe('root');
    expect(proposed[0]?.parentKey).toBeNull();
    expect(proposed.some((node) => node.parentKey === 'root')).toBe(true);
  });

  it('makes a person a contact node, reusing the CRM package', () => {
    // Rather than inventing LifeMap-only types nothing else understands.
    const proposed = proposeMap(entries);
    const person = proposed.find((node) => node.key.startsWith('person:'));

    expect(person?.type).toBe('contact');
  });

  it('is deterministic, so a re-run proposes the same thing', () => {
    expect(JSON.stringify(proposeMap(entries))).toBe(
      JSON.stringify(proposeMap(entries)),
    );
  });

  it('weights clusters relative to the biggest', () => {
    // So weight means "how much of this archive" rather than an absolute that
    // depends on archive size.
    const weights = proposeMap(entries)
      .filter((node) => node.parentKey === 'root')
      .map((node) => node.weight);

    expect(Math.max(...weights)).toBeLessThanOrEqual(1);
  });
});

// --------------------------------------------------------------- privacy

describe('a LifeMap is private, structurally', () => {
  function imported() {
    return importArchive(owner, { text: FACEBOOK, label: 'My archive' }, db);
  }

  it('is invisible to another account', () => {
    const result = imported();

    expect(getImport(stranger, result.import!.id, db)).toBeNull();
    expect(entriesFor(stranger, result.import!.id, 100, db)).toEqual([]);
    expect(entitiesFor(stranger, result.import!.id, 100, db)).toEqual([]);
    expect(importsFor(stranger, db)).toEqual([]);
  });

  it('is invisible to STAFF', () => {
    /*
     * The assertion that matters most in this file.
     *
     * Moderation reaches across ownership everywhere else in this codebase.
     * It deliberately does not reach here: a LifeMap is somebody's private
     * messages and photographs, and there is no support question worth
     * building a door for.
     */
    const result = imported();

    expect(getImport(staff, result.import!.id, db)).toBeNull();
    expect(entriesFor(staff, result.import!.id, 100, db)).toEqual([]);
    expect(searchLifeMap(staff, 'mapping', {}, db)).toEqual([]);
    expect(importsFor(staff, db)).toEqual([]);
  });

  it('cannot be deleted by anybody else', () => {
    const result = imported();

    expect(deleteImport(stranger, result.import!.id, db).ok).toBe(false);
    expect(deleteImport(staff, result.import!.id, db).ok).toBe(false);
    expect(getImport(owner, result.import!.id, db)).not.toBeNull();
  });

  it('cannot be applied by anybody else', () => {
    const result = imported();

    expect(applyImport(stranger, result.import!.id, db).ok).toBe(false);
    expect(applyImport(staff, result.import!.id, db).ok).toBe(false);
    expect(listOwnedMaps(stranger, db)).toHaveLength(0);
  });

  it('never stores the archive file itself', () => {
    /*
     * Parsed in memory, entries kept, upload discarded. Retaining the
     * original would mean holding a second complete copy of somebody's
     * Facebook history indefinitely.
     */
    imported();

    const columns = db
      .prepare("SELECT name FROM pragma_table_info('lifemap_imports')")
      .all() as { name: string }[];

    const names = columns.map((column) => column.name);

    expect(names).not.toContain('raw');
    expect(names).not.toContain('archive');
    expect(names).not.toContain('file');
  });

  it('does not let one person search another’s entries', () => {
    imported();

    expect(searchLifeMap(owner, 'mapping', {}, db).length).toBeGreaterThan(0);
    expect(searchLifeMap(stranger, 'mapping', {}, db)).toEqual([]);
  });
});

// ---------------------------------------------------------------- import

describe('importing', () => {
  it('stores entries and entities', () => {
    const result = importArchive(owner, { text: FACEBOOK }, db);

    expect(result.ok).toBe(true);
    expect(result.import?.entryCount).toBe(3);
    expect(entriesFor(owner, result.import!.id, 100, db)).toHaveLength(3);
    expect(entitiesFor(owner, result.import!.id, 100, db).length).toBeGreaterThan(
      0,
    );
  });

  it('reports what it could not read', () => {
    // "812 of your 940 posts" is actionable; silently dropping 128 is not.
    const withJunk = JSON.stringify([
      { timestamp: 1_700_000_000 },
      ...JSON.parse(FACEBOOK),
    ]);

    expect(importArchive(owner, { text: withJunk }, db).import?.skippedCount).toBe(
      1,
    );
  });

  it('refuses an archive it could read nothing from', () => {
    expect(importArchive(owner, { text: '[]' }, db).ok).toBe(false);
  });

  it('caps how many archives one account may hold', () => {
    for (let index = 0; index < MAX_IMPORTS; index += 1) {
      expect(importArchive(owner, { text: FACEBOOK }, db).ok).toBe(true);
    }

    expect(importArchive(owner, { text: FACEBOOK }, db).ok).toBe(false);
  });

  it('builds a timeline from stored entries', () => {
    const result = importArchive(owner, { text: FACEBOOK }, db);

    expect(timelineFor(owner, result.import!.id, db).length).toBeGreaterThan(0);
  });
});

describe('searching', () => {
  beforeEach(() => {
    importArchive(owner, { text: FACEBOOK }, db);
  });

  it('matches text, people and places', () => {
    expect(searchLifeMap(owner, 'milestone', {}, db)).toHaveLength(1);
    expect(searchLifeMap(owner, 'Santiago', {}, db)).toHaveLength(2);
    expect(searchLifeMap(owner, 'Lagos', {}, db)).toHaveLength(1);
  });

  it('filters by date range', () => {
    // "Show me every photo from 2024" — the shape of question the business
    // plan describes.
    const early = searchLifeMap(owner, '', { to: '2024-01-01' }, db);

    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan(3);
  });

  it('does not let a wildcard match everything', () => {
    // An unescaped % turns a filter into "return all rows".
    expect(searchLifeMap(owner, '%', {}, db)).toEqual([]);
  });

  it('returns everything for an empty query', () => {
    expect(searchLifeMap(owner, '', {}, db)).toHaveLength(3);
  });
});

// ----------------------------------------------------------------- apply

describe('applying an import', () => {
  it('creates a map only when asked', () => {
    /*
     * Importing analyses; applying creates. The clustering will have got some
     * of it wrong, and a map generated silently would present that as fact
     * about somebody's life.
     */
    const result = importArchive(owner, { text: FACEBOOK }, db);

    expect(listOwnedMaps(owner, db)).toHaveLength(0);
    expect(result.import?.status).toBe('analysed');

    applyImport(owner, result.import!.id, db);

    expect(listOwnedMaps(owner, db)).toHaveLength(1);
  });

  it('makes the map private, always', () => {
    // "LifeMap data is private by default." Not a parameter a caller can set.
    const result = importArchive(owner, { text: FACEBOOK }, db);
    const applied = applyImport(owner, result.import!.id, db);

    expect(getMap(owner, applied.mapId!, db)?.visibility).toBe('private');
  });

  it('is idempotent', () => {
    // A repeated apply must not make a second copy of somebody's life.
    const result = importArchive(owner, { text: FACEBOOK }, db);

    const first = applyImport(owner, result.import!.id, db);
    const second = applyImport(owner, result.import!.id, db);

    expect(second.mapId).toBe(first.mapId);
    expect(listOwnedMaps(owner, db)).toHaveLength(1);
  });

  it('builds a connected tree with fresh node ids', () => {
    const result = importArchive(owner, { text: FACEBOOK }, db);
    const applied = applyImport(owner, result.import!.id, db);
    const map = getMap(owner, applied.mapId!, db)!;

    const nodes = Object.values(map.nodes);

    expect(nodes.length).toBeGreaterThan(1);
    // Exactly one root, and every other node reachable from it.
    expect(nodes.filter((node) => node.parent_id === null)).toHaveLength(1);

    for (const node of nodes) {
      if (node.parent_id) expect(map.nodes[node.parent_id]).toBeDefined();
    }
  });

  it('previews without writing anything', () => {
    const result = importArchive(owner, { text: FACEBOOK }, db);

    expect(previewImport(owner, result.import!.id, db).length).toBeGreaterThan(0);
    expect(listOwnedMaps(owner, db)).toHaveLength(0);
  });

  it('leaves the map alone when the import is deleted', () => {
    /*
     * Once applied it is an ordinary map the person owns and may have edited.
     * Deleting it because they tidied an import would destroy later work.
     */
    const result = importArchive(owner, { text: FACEBOOK }, db);
    const applied = applyImport(owner, result.import!.id, db);

    expect(deleteImport(owner, result.import!.id, db).ok).toBe(true);

    expect(getMap(owner, applied.mapId!, db)).not.toBeNull();
    expect(entriesFor(owner, result.import!.id, 100, db)).toEqual([]);
  });

  it('removes entries and entities with the import', () => {
    // ON DELETE CASCADE, so no orphan rows a later query could still find.
    const result = importArchive(owner, { text: FACEBOOK }, db);
    deleteImport(owner, result.import!.id, db);

    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM lifemap_entries')
      .get() as { n: number };

    expect(remaining.n).toBe(0);
  });
});
