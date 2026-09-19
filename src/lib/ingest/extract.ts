/**
 * Readability extraction.
 *
 * Deliberately NOT a port of Mozilla Readability. That library optimises for
 * reproducing an article's prose for reading; a mind map needs the opposite —
 * the skeleton. Headings, their nesting, and a sentence of context each.
 *
 * Written against raw HTML with regular expressions rather than a DOM, because
 * the alternative is shipping jsdom into a server bundle to extract six
 * headings. The parsing is tolerant by design: malformed markup should degrade
 * to fewer headings, never to an exception.
 *
 * Pure and dependency-free, so the whole failure taxonomy can be tested with
 * string literals and no network.
 */

export interface Heading {
  level: number; // 1..6
  text: string;
  /** First paragraph following this heading, trimmed. Context for the node. */
  blurb: string;
}

export interface ExtractedPage {
  title: string;
  /** og:description or the first substantial paragraph. */
  description: string;
  siteName: string;
  headings: Heading[];
  /** Whole-page visible text, collapsed. Used for the thin-page test. */
  text: string;
  wordCount: number;
  /** Signals a login wall or paywall rather than a public page. */
  paywalled: boolean;
  lang: string;
}

/**
 * Below this, §12 calls the page "too thin" and we deliver a 3-node starter
 * map rather than a bad map. 120 words is roughly a short blog intro — enough
 * to structure. Under it, an LLM invents rather than summarises.
 */
export const THIN_WORD_COUNT = 120;

/** Elements whose content is never page content. */
const STRIP_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'form',
  'nav',
  'header',
  'footer',
  'aside',
];

function stripElements(html: string): string {
  let out = html;
  for (const tag of STRIP_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
    // Unclosed or self-closing forms of the same tags.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }
  return out.replace(/<!--[\s\S]*?-->/g, ' ');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  amp39: "'",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(parseInt(dec, 10)))
    .replace(
      /&([a-z][a-z0-9]*);/gi,
      (match, name) => ENTITIES[name.toLowerCase()] ?? match,
    );
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Tags to plain text: strip markup, decode entities, collapse whitespace. */
export function toText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const value = toText(match[1]);
      if (value) return value;
    }
  }
  return '';
}

/**
 * Paywall and login detection.
 *
 * §12 needs "Login or paywall" separated from "unreachable", because the
 * messages and the offered fallbacks differ. A 200 response with a login form
 * is the common case — the site would rather serve a wall than a 403.
 *
 * Kept to high-confidence signals. A false positive here tells the user their
 * public page is paywalled, which is worse than missing one.
 */
const PAYWALL_MARKERS = [
  /<meta[^>]+name=["']article:content_tier["'][^>]+content=["']locked["']/i,
  /\bisAccessibleForFree["']?\s*:\s*["']?false/i,
  /class=["'][^"']*\b(paywall|piano-|meter-|subscribe-wall|regwall)/i,
  /\b(subscribe to (?:continue|read)|already a subscriber|create a free account to (?:read|continue)|sign in to (?:read|continue))\b/i,
];

export function detectPaywall(html: string, text: string): boolean {
  const hits = PAYWALL_MARKERS.filter(
    (pattern) => pattern.test(html) || pattern.test(text),
  ).length;

  if (hits === 0) return false;
  // A structured signal (schema.org / meta) is trustworthy on its own.
  if (PAYWALL_MARKERS.slice(0, 2).some((p) => p.test(html))) return true;
  /**
   * A prose signal on a long page is usually a footer promo, not a wall. Only
   * treat it as a wall when there is very little else — which is what a real
   * wall looks like.
   */
  return text.split(/\s+/).length < 400;
}

export function extract(html: string, url: string): ExtractedPage {
  const cleaned = stripElements(html);

  const rawTitle =
    metaContent(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']*)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]) || '';

  const h1 = cleaned.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const title = rawTitle || (h1 ? toText(h1[1]!) : '') || hostnameOf(url);

  const description = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  ]);

  const siteName =
    metaContent(html, [
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i,
    ]) || hostnameOf(url);

  const lang = html.match(/<html[^>]+lang=["']([a-z-]{2,10})["']/i)?.[1] ?? 'en';

  const headings = extractHeadings(cleaned);
  const text = toText(cleaned);
  const wordCount = text ? text.split(/\s+/).length : 0;

  return {
    title: title.slice(0, 200),
    description: (description || firstParagraph(cleaned)).slice(0, 400),
    siteName,
    headings,
    text,
    wordCount,
    paywalled: detectPaywall(html, text),
    lang,
  };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Untitled page';
  }
}

function firstParagraph(html: string): string {
  const matches = html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi);
  for (const match of matches) {
    const text = toText(match[1]!);
    if (text.length > 60) return text;
  }
  return '';
}

/**
 * Headings with the paragraph that follows each.
 *
 * The blurb is what makes a generated node useful rather than a bare label,
 * and it also gives the model something to compress instead of inventing.
 */
export function extractHeadings(html: string): Heading[] {
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const found: Heading[] = [];

  let match: RegExpExecArray | null;
  const positions: { level: number; text: string; end: number }[] = [];

  while ((match = pattern.exec(html)) !== null) {
    const text = toText(match[2]!);
    if (!text || text.length > 160) continue; // a 200-char "heading" is a layout div
    positions.push({
      level: Number(match[1]),
      text,
      end: match.index + match[0].length,
    });
  }

  for (let i = 0; i < positions.length; i++) {
    const here = positions[i]!;
    const next = positions[i + 1];
    const between = html.slice(here.end, next ? next.end - 0 : here.end + 4000);
    found.push({
      level: here.level,
      text: here.text,
      blurb: firstParagraph(between).slice(0, 300),
    });
  }

  return dedupeHeadings(found);
}

/**
 * Navigation and cookie banners survive as repeated headings even after the
 * nav/header/footer strip, because plenty of sites do not use those elements.
 * A heading whose text repeats is structure, not content.
 */
function dedupeHeadings(headings: Heading[]): Heading[] {
  const seen = new Map<string, number>();
  for (const heading of headings) {
    const key = heading.text.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const out: Heading[] = [];
  const used = new Set<string>();
  for (const heading of headings) {
    const key = heading.text.toLowerCase();
    if ((seen.get(key) ?? 0) > 1 && used.has(key)) continue;
    used.add(key);
    out.push(heading);
  }
  return out;
}
