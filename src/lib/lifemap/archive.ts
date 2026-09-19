/**
 * Reading a personal data archive.
 *
 * ── The constraint that shapes everything here ──────────────────────────────
 *
 * The business plan is unusually explicit, and it is worth quoting because it
 * is a design constraint rather than a marketing line:
 *
 *   "CDN does not assume that having a URL grants permission to collect
 *    private data. Access always requires explicit user authorization, API
 *    permissions, or user-provided exports."
 *
 * So there is no scraping here, no crawling, and no "connect your account and
 * we'll fetch everything". The only input is a file the person exported from a
 * service themselves and handed to us. That is the strongest possible consent
 * signal: they had to go and get it.
 *
 * ── Parsing is pure, and separate from storing ──────────────────────────────
 *
 * Nothing in this file touches the database, the network or the filesystem. It
 * turns bytes into typed records and nothing else — which means the whole of
 * it can be tested against real archive shapes with no fixtures beyond a
 * string, and means a parsing bug cannot become a storage bug.
 *
 * ── Everything is treated as hostile input ──────────────────────────────────
 *
 * An archive is a file from the internet, assembled by a third party, that a
 * person downloaded and forwarded to us. Sizes are capped, depth is capped,
 * counts are capped, and nothing is trusted to be the shape it claims.
 */

export type ArchiveSource = 'facebook' | 'instagram' | 'google' | 'generic';

export type EntryKind =
  'post' | 'photo' | 'video' | 'message' | 'event' | 'place' | 'person' | 'file';

export interface ArchiveEntry {
  kind: EntryKind;
  /** Title or first line. Truncated for display, never for storage. */
  title: string;
  body: string;
  /** ISO 8601. Null when the archive gave no usable timestamp. */
  at: string | null;
  /** People named in the entry, as the archive spelled them. */
  people: string[];
  place: string | null;
  source: ArchiveSource;
}

export interface ParseResult {
  ok: boolean;
  entries: ArchiveEntry[];
  /** Entries the parser recognised but could not use, with a reason. */
  skipped: number;
  error?: string;
}

/** Hard ceilings. An archive is untrusted input assembled by somebody else. */
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRIES = 50_000;
export const MAX_DEPTH = 12;
export const MAX_TEXT = 20_000;

function asString(value: unknown, limit = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

/**
 * Facebook's exports encode UTF-8 as Latin-1.
 *
 * A real, well-known defect in their exporter: "café" arrives as "cafÃ©" and
 * every emoji as three mojibake characters. Anybody who has imported one of
 * these archives has seen it, and leaving it uncorrected would mean importing
 * somebody's life story with the accents broken.
 *
 * The repair is to reinterpret the bytes as UTF-8. It is applied only when the
 * text actually contains the tell-tale sequences, so correctly encoded text is
 * left alone.
 */
export function repairMojibake(text: string): string {
  /*
   * The signature of double-encoded UTF-8: a lead byte in C2-F4 followed by
   * a continuation byte in 80-BF, both read as Latin-1.
   *
   * Written with explicit escapes rather than literal characters. The first
   * version used a literal class, which silently covered only the two-byte
   * leads — so accents were repaired and every emoji, which is four bytes
   * starting F0, was left broken. A character class made of invisible
   * high-Latin-1 characters is also unreadable in a diff and impossible to
   * review, which is how it went unnoticed.
   */
  if (!/[\u00C2-\u00F4][\u0080-\u00BF]/.test(text)) return text;

  try {
    const bytes = Uint8Array.from(
      text,
      (character) => character.charCodeAt(0) & 0xff,
    );
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    // Not actually double-encoded. Better to leave it than to mangle it
    // further — the repair must never make text worse than it was.
    return text;
  }
}

/**
 * Timestamps, from the several shapes archives use.
 *
 * Facebook uses seconds, most JSON uses milliseconds, and Google uses ISO
 * strings. Guessing wrong by a factor of a thousand puts somebody's 2019
 * holiday in 1970 or in the year 51,000 — so the magnitude is checked rather
 * than assumed.
 */
export function parseTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return null;

  /*
   * Seconds or milliseconds, decided by magnitude. A value below ~10^11 as
   * milliseconds would be 1973 or earlier, which no digital archive contains;
   * as seconds it is a plausible recent date. The boundary is chosen so both
   * readings cannot be plausible at once.
   */
  const millis = value < 100_000_000_000 ? value * 1000 : value;
  const date = new Date(millis);

  if (Number.isNaN(date.getTime())) return null;

  // Anything outside a plausible window is a unit we guessed wrong, and a
  // wrong date is worse than none: it puts a memory in the wrong decade.
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;

  return date.toISOString();
}

/** Guard against a hostile deeply-nested document exhausting the stack. */
function tooDeep(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (!value || typeof value !== 'object') return false;

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (tooDeep(child, depth + 1)) return true;
  }

  return false;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) =>
      typeof item === 'string'
        ? item
        : asString((item as Record<string, unknown>)?.name, 200),
    )
    .map((name) => repairMojibake(name).trim())
    .filter(Boolean)
    .slice(0, 100);
}

/**
 * Facebook's `posts.json` shape.
 *
 * Written against the real export format: an array of objects with
 * `timestamp`, an optional `title`, `data[].post` for the text, and
 * `attachments[].data[]` for media and places. Their exporter is inconsistent
 * about which fields appear, so every one is optional here.
 */
function parseFacebookPosts(input: unknown, source: ArchiveSource): ArchiveEntry[] {
  if (!Array.isArray(input)) return [];

  const entries: ArchiveEntry[] = [];

  for (const raw of input.slice(0, MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') continue;

    const post = raw as Record<string, unknown>;

    const body = Array.isArray(post.data)
      ? post.data
          .map((item) => asString((item as Record<string, unknown>)?.post))
          .filter(Boolean)
          .join('\n\n')
      : '';

    const title = repairMojibake(asString(post.title, 300));

    let place: string | null = null;
    let kind: EntryKind = 'post';

    if (Array.isArray(post.attachments)) {
      for (const attachment of post.attachments) {
        const data = (attachment as Record<string, unknown>)?.data;
        if (!Array.isArray(data)) continue;

        for (const item of data) {
          const record = item as Record<string, unknown>;

          if (record.place && typeof record.place === 'object') {
            place = repairMojibake(
              asString((record.place as Record<string, unknown>).name, 200),
            );
          }

          if (record.media) kind = 'photo';
        }
      }
    }

    // An entry with neither text nor a title carries nothing a person would
    // recognise, and importing it would add a blank node to their map.
    if (!body && !title) continue;

    entries.push({
      kind,
      title: title || body.slice(0, 120),
      body: repairMojibake(body),
      at: parseTimestamp(post.timestamp),
      people: names(post.tags),
      place,
      source,
    });
  }

  return entries;
}

/**
 * A generic shape, for archives we have no specific reader for.
 *
 * Deliberately forgiving about field names — `date`/`time`/`timestamp`,
 * `text`/`body`/`content` — because the alternative is refusing an archive
 * outright, and a partial import of somebody's own data is far better than
 * none.
 */
function parseGeneric(input: unknown, source: ArchiveSource): ArchiveEntry[] {
  const rows = Array.isArray(input)
    ? input
    : Array.isArray((input as Record<string, unknown>)?.items)
      ? ((input as Record<string, unknown>).items as unknown[])
      : [];

  const entries: ArchiveEntry[] = [];

  for (const raw of rows.slice(0, MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') continue;

    const item = raw as Record<string, unknown>;

    const body = repairMojibake(
      asString(item.text) || asString(item.body) || asString(item.content),
    );
    const title = repairMojibake(asString(item.title, 300) || body.slice(0, 120));

    if (!title && !body) continue;

    entries.push({
      kind: 'post',
      title,
      body,
      at:
        parseTimestamp(item.timestamp) ??
        parseTimestamp(item.date) ??
        parseTimestamp(item.time),
      people: names(item.people ?? item.tags),
      place: asString(item.place, 200) || null,
      source,
    });
  }

  return entries;
}

/**
 * Parse one JSON file from an archive.
 *
 * Takes TEXT rather than a file handle, so this stays pure and testable. The
 * caller reads the upload and decides which files inside a zip to hand over.
 */
export function parseArchiveJson(text: string, source: ArchiveSource): ParseResult {
  if (text.length > MAX_ARCHIVE_BYTES) {
    return {
      ok: false,
      entries: [],
      skipped: 0,
      error: 'That archive is too large',
    };
  }

  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch {
    return { ok: false, entries: [], skipped: 0, error: 'That file is not JSON' };
  }

  if (tooDeep(document)) {
    // A nesting bomb. Rejected rather than partially read, because whatever
    // produced it was not a genuine export.
    return {
      ok: false,
      entries: [],
      skipped: 0,
      error: 'That archive is malformed',
    };
  }

  const before = Array.isArray(document)
    ? document.length
    : Array.isArray((document as Record<string, unknown>)?.items)
      ? ((document as Record<string, unknown>).items as unknown[]).length
      : 0;

  const entries =
    source === 'facebook' || source === 'instagram'
      ? parseFacebookPosts(
          Array.isArray(document)
            ? document
            : ((document as Record<string, unknown>)?.posts ?? []),
          source,
        )
      : parseGeneric(document, source);

  return {
    ok: true,
    entries,
    // Reported honestly. "We imported 812 of your 940 posts" is information
    // somebody can act on; silently dropping 128 is not.
    skipped: Math.max(0, before - entries.length),
  };
}

/**
 * Detect which service an archive came from.
 *
 * Structure, not filename. People rename downloads, and a filename is a
 * guess where the shape of the document is evidence.
 */
export function detectSource(text: string): ArchiveSource {
  const head = text.slice(0, 4000);

  if (/"attachments"|"uri":\s*"posts\//.test(head)) return 'facebook';
  if (/"ig_data"|"media_metadata"/.test(head)) return 'instagram';
  if (/"activity_type"|"titleUrl"/.test(head)) return 'google';

  return 'generic';
}
