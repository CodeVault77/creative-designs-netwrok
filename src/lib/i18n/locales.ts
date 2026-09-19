/**
 * Locales, negotiation and text direction.
 *
 * ── No i18n library ─────────────────────────────────────────────────────────
 *
 * Consistent with the rest of this codebase, and for a specific reason rather
 * than a preference: almost everything an i18n library does is now in the
 * platform. `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.PluralRules`,
 * `Intl.RelativeTimeFormat` and `Intl.ListFormat` handle the hard parts —
 * plural categories for Polish, date order for Japanese, the Arabic comma —
 * and they do it with the CLDR data the browser already ships.
 *
 * What a library adds on top is a message catalogue and interpolation, which
 * is `format.ts` and is small. The trade is worth taking here because the
 * alternative is a dependency in the render path of every screen.
 *
 * ── Locale is negotiated, never guessed from the IP ─────────────────────────
 *
 * A person in Belgium may want French, Dutch, German or English, and their
 * location says nothing about which. `Accept-Language` is the browser telling
 * us what they chose; a stored preference is them telling us directly. Both
 * beat geography, which is why geography is not consulted at all.
 */

export const LOCALES = [
  'en',
  'en-GB',
  'es',
  'fr',
  'de',
  'pt-BR',
  'ja',
  'zh-Hans',
  'ar',
  'he',
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Right-to-left scripts.
 *
 * Kept as a list of LANGUAGE codes rather than derived from the region,
 * because direction is a property of the script: Arabic is RTL in Egypt and
 * in France alike. `Intl.Locale.prototype.textInfo` reports this natively but
 * is not in every runtime this has to work in, so the list is explicit and
 * the API is used when present.
 */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ps']);

export type Direction = 'ltr' | 'rtl';

export function directionFor(locale: string): Direction {
  const language = locale.split('-')[0]?.toLowerCase() ?? '';

  /*
   * The platform's own answer is preferred where available: it covers scripts
   * this list does not, and it is right about the cases where a language can
   * be written in either direction depending on script subtag.
   */
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      textInfo?: { direction?: string };
      getTextInfo?: () => { direction?: string };
    };

    const direction =
      info.textInfo?.direction ?? info.getTextInfo?.().direction ?? null;

    if (direction === 'rtl' || direction === 'ltr') return direction;
  } catch {
    // An unparseable tag falls through to the list.
  }

  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

export function isSupported(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Choose the best supported locale for a request.
 *
 * ── Language before region ──────────────────────────────────────────────────
 *
 * Somebody asking for `fr-CA` when only `fr` exists should get French, not
 * English. Falling straight through to the default because the region did not
 * match is the single most common i18n bug, and it is the one people notice
 * because it feels like the product ignoring them.
 *
 * Quality values are honoured, so `en;q=0.8, fr;q=0.9` yields French — a
 * person who ranked their preferences deserves to have them read.
 */
export function negotiate(
  acceptLanguage: string | null,
  stored?: string | null,
): Locale {
  // An explicit choice wins outright. It is the least ambiguous signal there
  // is, and re-negotiating over it would override somebody's decision.
  if (stored && isSupported(stored)) return stored;

  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const quality = params
        .map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param))
        .find(Boolean);

      return {
        tag: (tag ?? '').trim(),
        q: quality?.[1] ? Number(quality[1]) : 1,
      };
    })
    .filter((entry) => entry.tag.length > 0 && Number.isFinite(entry.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    if (tag === '*') return DEFAULT_LOCALE;

    // Exact match, case-insensitively — `PT-br` is `pt-BR`.
    const exact = LOCALES.find(
      (locale) => locale.toLowerCase() === tag.toLowerCase(),
    );
    if (exact) return exact;

    // Then the language alone: `fr-CA` finds `fr`, `zh-Hans-CN` finds
    // `zh-Hans` before it would find a bare `zh`.
    const language = tag.split('-')[0]?.toLowerCase() ?? '';

    const byScript = LOCALES.find((locale) =>
      tag.toLowerCase().startsWith(`${locale.toLowerCase()}-`),
    );
    if (byScript) return byScript;

    const byLanguage = LOCALES.find((locale) => locale.toLowerCase() === language);
    if (byLanguage) return byLanguage;

    // Finally any variant of the same language: `pt` finds `pt-BR`, which is
    // much better than English for a Portuguese speaker.
    const anyVariant = LOCALES.find((locale) =>
      locale.toLowerCase().startsWith(`${language}-`),
    );
    if (anyVariant) return anyVariant;
  }

  return DEFAULT_LOCALE;
}

export interface LocaleInfo {
  code: Locale;
  direction: Direction;
  /** The language's own name for itself. What a picker must show. */
  endonym: string;
}

/**
 * The list for a language picker.
 *
 * Endonyms, not English names. Somebody looking for their language scans for
 * the word they recognise — "Deutsch", not "German" — and a picker written in
 * English is only usable by people who already read English, which is the one
 * group that does not need it.
 */
export const LOCALE_INFO: readonly LocaleInfo[] = [
  { code: 'en', direction: 'ltr', endonym: 'English' },
  { code: 'en-GB', direction: 'ltr', endonym: 'English (UK)' },
  { code: 'es', direction: 'ltr', endonym: 'Español' },
  { code: 'fr', direction: 'ltr', endonym: 'Français' },
  { code: 'de', direction: 'ltr', endonym: 'Deutsch' },
  { code: 'pt-BR', direction: 'ltr', endonym: 'Português (Brasil)' },
  { code: 'ja', direction: 'ltr', endonym: '日本語' },
  { code: 'zh-Hans', direction: 'ltr', endonym: '简体中文' },
  { code: 'ar', direction: 'rtl', endonym: 'العربية' },
  { code: 'he', direction: 'rtl', endonym: 'עברית' },
];

/** The cookie a chosen locale is remembered in. */
export const LOCALE_COOKIE = 'cdn_locale';
