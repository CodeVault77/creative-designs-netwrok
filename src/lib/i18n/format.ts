import { DEFAULT_LOCALE, type Locale } from './locales';

/**
 * Messages, interpolation and the Intl formatters.
 *
 * ── Why interpolation is not string concatenation ───────────────────────────
 *
 * The tempting shortcut is `"Deleted " + count + " nodes"`. It is wrong in
 * every language whose word order differs from English, and there are a lot of
 * them — Japanese puts the verb last, German splits it, Arabic reads the other
 * way. A message must be ONE string with named holes, so a translator can move
 * the holes.
 *
 * ── Plurals are not "1 or many" ─────────────────────────────────────────────
 *
 * English has two plural forms and this is why English-speaking developers
 * write `n === 1 ? 'node' : 'nodes'`. Polish has four. Arabic has six. Russian
 * has three, chosen by the last TWO digits. `Intl.PluralRules` knows all of
 * this from CLDR data the browser already ships, so a message declares forms
 * by CATEGORY — `one`, `few`, `many`, `other` — and the platform picks.
 */

export type PluralCategory = Intl.LDMLPluralRule;

/** A message is a string, or a set of plural forms. */
export type Message = string | Partial<Record<PluralCategory, string>>;

export type Catalogue = Record<string, Message>;

export type Values = Record<string, string | number>;

/**
 * The keys every catalogue must define.
 *
 * A union rather than a loose string, so a typo in a message key is a
 * compile error rather than a screen that renders its own key at somebody in
 * production. It is also what makes the completeness test possible.
 */
export type MessageKey =
  | 'app.name'
  | 'nav.map'
  | 'nav.search'
  | 'nav.maps'
  | 'nav.you'
  | 'action.open'
  | 'action.edit'
  | 'action.expand'
  | 'action.cancel'
  | 'action.save'
  | 'action.delete'
  | 'action.retry'
  | 'map.empty'
  | 'map.nodeCount'
  | 'map.selected'
  | 'map.participants'
  | 'search.placeholder'
  | 'search.resultCount'
  | 'search.none'
  | 'auth.signIn'
  | 'auth.signOut'
  | 'auth.mfaPrompt'
  | 'error.generic'
  | 'error.offline'
  | 'lifemap.title'
  | 'lifemap.private'
  | 'lifemap.importing'
  | 'lifemap.itemCount';

const en: Record<MessageKey, Message> = {
  'app.name': 'Creative Design Networks',
  'nav.map': 'Map',
  'nav.search': 'Search',
  'nav.maps': 'My Maps',
  'nav.you': 'You',
  'action.open': 'Open',
  'action.edit': 'Edit',
  'action.expand': 'Expand',
  'action.cancel': 'Cancel',
  'action.save': 'Save',
  'action.delete': 'Delete',
  'action.retry': 'Try again',
  'map.empty': 'Nothing here yet.',
  'map.nodeCount': { one: '{count} node', other: '{count} nodes' },
  'map.selected': 'Selected: {title}',
  'map.participants': { one: '{count} person here', other: '{count} people here' },
  'search.placeholder': 'Search the network',
  'search.resultCount': { one: '{count} result', other: '{count} results' },
  'search.none': 'Nothing matched “{query}”.',
  'auth.signIn': 'Sign in',
  'auth.signOut': 'Sign out',
  'auth.mfaPrompt': 'Enter your code',
  'error.generic': 'Something went wrong.',
  'error.offline': 'You are offline.',
  'lifemap.title': 'LifeMap',
  'lifemap.private': 'Private to you',
  'lifemap.importing': 'Reading your archive…',
  'lifemap.itemCount': { one: '{count} item', other: '{count} items' },
};

/**
 * Catalogues, by locale.
 *
 * ── Partial catalogues are expected, not a failure ──────────────────────────
 *
 * Translation lags development. A key added on Tuesday will not be translated
 * into ten languages by Wednesday, and a system that required completeness
 * would either block the feature or ship ten copies of the English string
 * labelled as translated — which is worse, because it looks finished.
 *
 * So a missing key falls back to English and is COUNTED, and `coverage()`
 * reports the gap. The screen keeps working and somebody can see what needs
 * doing.
 */
const catalogues: Partial<Record<Locale, Partial<Record<MessageKey, Message>>>> = {
  en,

  'en-GB': {
    // Only what genuinely differs. A full copy would be a second file to keep
    // in step for no benefit, and the differences are the point.
    'search.placeholder': 'Search the network',
    'action.retry': 'Try again',
  },

  es: {
    'nav.map': 'Mapa',
    'nav.search': 'Buscar',
    'nav.maps': 'Mis mapas',
    'nav.you': 'Tú',
    'action.open': 'Abrir',
    'action.edit': 'Editar',
    'action.expand': 'Expandir',
    'action.cancel': 'Cancelar',
    'action.save': 'Guardar',
    'action.delete': 'Eliminar',
    'action.retry': 'Reintentar',
    'map.empty': 'Aquí no hay nada todavía.',
    'map.nodeCount': { one: '{count} nodo', other: '{count} nodos' },
    'map.participants': {
      one: '{count} persona aquí',
      other: '{count} personas aquí',
    },
    'search.placeholder': 'Buscar en la red',
    'search.resultCount': {
      one: '{count} resultado',
      other: '{count} resultados',
    },
    'search.none': 'Nada coincide con «{query}».',
    'auth.signIn': 'Iniciar sesión',
    'auth.signOut': 'Cerrar sesión',
    'error.generic': 'Algo ha salido mal.',
    'error.offline': 'Estás sin conexión.',
    'lifemap.private': 'Privado para ti',
  },

  fr: {
    'nav.map': 'Carte',
    'nav.search': 'Rechercher',
    'nav.maps': 'Mes cartes',
    'nav.you': 'Vous',
    'action.open': 'Ouvrir',
    'action.edit': 'Modifier',
    'action.expand': 'Développer',
    'action.cancel': 'Annuler',
    'action.save': 'Enregistrer',
    'action.delete': 'Supprimer',
    'action.retry': 'Réessayer',
    'map.empty': 'Rien ici pour le moment.',
    'map.nodeCount': { one: '{count} nœud', other: '{count} nœuds' },
    'search.placeholder': 'Rechercher dans le réseau',
    'search.resultCount': { one: '{count} résultat', other: '{count} résultats' },
    'auth.signIn': 'Se connecter',
    'auth.signOut': 'Se déconnecter',
    'error.generic': 'Une erreur est survenue.',
    'error.offline': 'Vous êtes hors ligne.',
  },

  de: {
    'nav.map': 'Karte',
    'nav.search': 'Suchen',
    'nav.maps': 'Meine Karten',
    'action.open': 'Öffnen',
    'action.edit': 'Bearbeiten',
    'action.cancel': 'Abbrechen',
    'action.save': 'Speichern',
    'action.delete': 'Löschen',
    'map.nodeCount': { one: '{count} Knoten', other: '{count} Knoten' },
    'search.placeholder': 'Netzwerk durchsuchen',
    'auth.signIn': 'Anmelden',
    'error.generic': 'Etwas ist schiefgelaufen.',
  },

  ja: {
    'nav.map': 'マップ',
    'nav.search': '検索',
    'nav.maps': 'マイマップ',
    // Japanese has ONE plural category. Writing `other` alone is correct here
    // and is what CLDR specifies — not an unfinished translation.
    'map.nodeCount': { other: '{count}件のノード' },
    'search.resultCount': { other: '{count}件の結果' },
    'auth.signIn': 'サインイン',
    'error.generic': '問題が発生しました。',
  },

  ar: {
    'nav.map': 'الخريطة',
    'nav.search': 'بحث',
    'nav.maps': 'خرائطي',
    /*
     * Arabic has SIX plural categories, and this is the case that breaks any
     * `n === 1` implementation. All six are declared because CLDR selects
     * between them by rules English speakers have no intuition for.
     */
    'map.nodeCount': {
      zero: 'لا عقد',
      one: 'عقدة واحدة',
      two: 'عقدتان',
      few: '{count} عقد',
      many: '{count} عقدة',
      other: '{count} عقدة',
    },
    'auth.signIn': 'تسجيل الدخول',
    'error.generic': 'حدث خطأ ما.',
  },
};

export interface Translator {
  locale: Locale;
  t: (key: MessageKey, values?: Values) => string;
  /** Keys that fell back to English on this render. */
  missing: () => MessageKey[];
}

/**
 * Interpolate `{name}` holes.
 *
 * Values are inserted verbatim, NOT escaped — this returns a string that
 * React renders as text, and React escapes it. Escaping here as well would
 * double-encode an ampersand in somebody's map title, which is the classic
 * way "Tom & Jerry" becomes "Tom &amp;amp; Jerry".
 */
function interpolate(template: string, values: Values, locale: Locale): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) return whole;

    // Numbers go through Intl so a German reader sees 1.234 and a French one
    // 1 234 — a raw `String(n)` would show 1234 to everybody.
    return typeof value === 'number' ? formatNumber(value, locale) : String(value);
  });
}

/** Build a translator for a locale. */
export function translator(locale: Locale): Translator {
  const catalogue = catalogues[locale] ?? {};
  const missed = new Set<MessageKey>();

  const plural = new Intl.PluralRules(locale);

  const t = (key: MessageKey, values: Values = {}): string => {
    let message = catalogue[key];

    if (message === undefined) {
      missed.add(key);
      message = en[key];
    }

    if (typeof message === 'string') return interpolate(message, values, locale);

    /*
     * A plural message with no count is a bug in the CALL, not the catalogue —
     * so it resolves to `other` rather than throwing. A screen that crashed
     * because somebody forgot a value would be a worse outcome than a slightly
     * wrong string.
     */
    const count = typeof values.count === 'number' ? values.count : 0;
    const category = plural.select(count);

    /*
     * `other` is the fallback for a category this language declares but this
     * message does not. CLDR guarantees every language has `other`, which is
     * what makes it a safe last resort.
     */
    const form = message[category] ?? message.other ?? en[key];

    return interpolate(
      typeof form === 'string' ? form : String(form),
      values,
      locale,
    );
  };

  return { locale, t, missing: () => [...missed] };
}

// ------------------------------------------------------------------- Intl

/**
 * Formatters are cached.
 *
 * Constructing an `Intl.NumberFormat` is genuinely expensive — it loads and
 * resolves locale data — and a list rendering a thousand numbers would build a
 * thousand of them. The cache is keyed by locale and options, and is the
 * reason these are functions rather than inline `new Intl…` at call sites.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

export function formatNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberFormats.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, formatter);
  }

  return formatter.format(value);
}

/**
 * Money.
 *
 * Takes integer CENTS, as everything in this codebase does, and divides here
 * at the boundary. `Intl` places the symbol correctly per locale — €1.234,56
 * in German, 1 234,56 € in French — which string concatenation cannot do.
 */
export function formatMoney(
  cents: number,
  locale: string,
  currency = 'USD',
): string {
  return formatNumber(cents / 100, locale, { style: 'currency', currency });
}

export function formatDate(
  value: Date | string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormats.get(key);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, formatter);
  }

  const date = typeof value === 'string' ? new Date(value) : value;

  // An unparseable date renders as an em dash rather than "Invalid Date",
  // which is a developer's string appearing in front of a user.
  return Number.isNaN(date.getTime()) ? '—' : formatter.format(date);
}

/**
 * "3 days ago", in the reader's language.
 *
 * Hand-rolled relative time is the other classic English-only bug: the plural,
 * the preposition and the word order all differ, and `Intl.RelativeTimeFormat`
 * knows all three.
 */
export function formatRelative(value: Date | string, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = (date.getTime() - Date.now()) / 1000;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }

  return formatter.format(Math.round(seconds), 'second');
}

/** "A, B and C" — the conjunction and the commas differ by language. */
export function formatList(items: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
    items,
  );
}

export interface Coverage {
  locale: Locale;
  translated: number;
  total: number;
  missing: MessageKey[];
}

/**
 * How complete a catalogue is.
 *
 * Reported rather than enforced. A gap is a translation task, not a build
 * failure — blocking a deploy on it would mean either holding features for
 * translators or shipping English strings marked as translated, and the second
 * is worse because nobody can then tell what still needs doing.
 */
export function coverage(locale: Locale): Coverage {
  const catalogue = catalogues[locale] ?? {};
  const keys = Object.keys(en) as MessageKey[];
  const missing = keys.filter((key) => catalogue[key] === undefined);

  return {
    locale,
    translated: keys.length - missing.length,
    total: keys.length,
    missing,
  };
}

/** Every key, for the completeness test and for an export to translators. */
export function messageKeys(): MessageKey[] {
  return Object.keys(en) as MessageKey[];
}

export { DEFAULT_LOCALE };
