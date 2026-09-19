import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_INFO,
  directionFor,
  isSupported,
  negotiate,
} from './locales';
import {
  coverage,
  formatDate,
  formatList,
  formatMoney,
  formatNumber,
  formatRelative,
  messageKeys,
  translator,
} from './format';
import {
  classify,
  describeSurface,
  estimateDiagonalInches,
  handSpanPx,
  inferViewingDistanceMm,
  isBoardMode,
  minimumTargetMm,
  minimumTargetPx,
  scaleFor,
  surfaceVariables,
} from '@/lib/display/surfaces';

/**
 * Internationalisation and display tests.
 *
 * The i18n bugs worth testing for are all the same shape: **English is not the
 * general case.** Two plural forms, left-to-right, a comma for thousands and
 * a full stop for decimals are all English-specific, and code written without
 * thinking about that fails silently — it produces output that looks fine to
 * the person who wrote it and is wrong for most of the world.
 */

// ------------------------------------------------------------ negotiation

describe('locale negotiation', () => {
  it('takes an exact match', () => {
    expect(negotiate('fr')).toBe('fr');
    expect(negotiate('pt-BR')).toBe('pt-BR');
  });

  it('falls back from a region to the language', () => {
    /*
     * The single most common i18n bug. Somebody asking for fr-CA when only
     * `fr` exists should get French — falling through to English because the
     * REGION did not match feels like the product ignoring them.
     */
    expect(negotiate('fr-CA')).toBe('fr');
    expect(negotiate('es-MX')).toBe('es');
    expect(negotiate('de-AT')).toBe('de');
  });

  it('falls forward from a language to a variant', () => {
    // `pt` should find `pt-BR`, which is much better than English.
    expect(negotiate('pt')).toBe('pt-BR');
  });

  it('honours quality values', () => {
    // Somebody who ranked their preferences deserves to have them read.
    expect(negotiate('en;q=0.8, fr;q=0.9')).toBe('fr');
    expect(negotiate('de;q=0.2, ja;q=0.9, en;q=0.5')).toBe('ja');
  });

  it('is case-insensitive about tags', () => {
    expect(negotiate('PT-br')).toBe('pt-BR');
    expect(negotiate('FR')).toBe('fr');
  });

  it('prefers a script subtag over a bare language', () => {
    expect(negotiate('zh-Hans-CN')).toBe('zh-Hans');
  });

  it('lets an explicit choice override the browser', () => {
    /*
     * Somebody who picked Spanish on a machine configured for English chose
     * Spanish. Re-negotiating over that would keep overriding them.
     */
    expect(negotiate('en-GB,en;q=0.9', 'es')).toBe('es');
  });

  it('ignores a stored locale it does not support', () => {
    expect(negotiate('fr', 'klingon')).toBe('fr');
  });

  it('falls back to the default for nothing, or for anything unknown', () => {
    expect(negotiate(null)).toBe(DEFAULT_LOCALE);
    expect(negotiate('')).toBe(DEFAULT_LOCALE);
    expect(negotiate('xx-YY')).toBe(DEFAULT_LOCALE);
    expect(negotiate('*')).toBe(DEFAULT_LOCALE);
  });

  it('does not crash on a malformed header', () => {
    // Headers arrive from the internet.
    for (const bad of [';;;', 'en;q=', 'en;q=abc', ',,,', 'a'.repeat(5000)]) {
      expect(() => negotiate(bad)).not.toThrow();
    }
  });
});

describe('text direction', () => {
  it('knows the right-to-left scripts', () => {
    expect(directionFor('ar')).toBe('rtl');
    expect(directionFor('he')).toBe('rtl');
    expect(directionFor('fa-IR')).toBe('rtl');
  });

  it('knows the left-to-right ones', () => {
    expect(directionFor('en')).toBe('ltr');
    expect(directionFor('ja')).toBe('ltr');
    expect(directionFor('zh-Hans')).toBe('ltr');
  });

  it('agrees with the picker', () => {
    for (const info of LOCALE_INFO) {
      expect(directionFor(info.code)).toBe(info.direction);
    }
  });

  it('does not throw on nonsense', () => {
    expect(() => directionFor('!!!')).not.toThrow();
  });
});

describe('the locale list', () => {
  it('has an entry in the picker for every supported locale', () => {
    // A supported locale missing from the picker is one nobody can choose.
    for (const locale of LOCALES) {
      expect(LOCALE_INFO.some((info) => info.code === locale)).toBe(true);
    }
  });

  it('names each language in its own words', () => {
    /*
     * Endonyms, not English names. Somebody looking for their language scans
     * for the word they recognise — a picker written in English is usable
     * only by people who already read English, which is the one group that
     * does not need it.
     */
    expect(LOCALE_INFO.find((i) => i.code === 'de')?.endonym).toBe('Deutsch');
    expect(LOCALE_INFO.find((i) => i.code === 'ja')?.endonym).toBe('日本語');
    expect(LOCALE_INFO.find((i) => i.code === 'ar')?.endonym).toBe('العربية');
  });

  it('recognises what it supports', () => {
    expect(isSupported('fr')).toBe(true);
    expect(isSupported('kl')).toBe(false);
  });
});

// --------------------------------------------------------------- messages

describe('messages', () => {
  it('returns a translated string', () => {
    expect(translator('es').t('nav.map')).toBe('Mapa');
    expect(translator('fr').t('nav.map')).toBe('Carte');
  });

  it('falls back to English for a missing key, and records it', () => {
    /*
     * Translation lags development, and a system that required completeness
     * would either block features or ship English strings labelled as
     * translated — which is worse, because it looks finished.
     */
    const de = translator('de');

    expect(de.t('lifemap.title')).toBe('LifeMap');
    expect(de.missing()).toContain('lifemap.title');
  });

  it('interpolates named holes', () => {
    expect(translator('en').t('map.selected', { title: 'Ideas' })).toBe(
      'Selected: Ideas',
    );
  });

  it('leaves an unfilled hole visible rather than printing undefined', () => {
    // "Selected: undefined" is a developer's bug shown to a user.
    expect(translator('en').t('map.selected')).toBe('Selected: {title}');
  });

  it('formats interpolated numbers for the locale', () => {
    // A raw String(n) would show 1234 to everybody.
    expect(translator('de').t('map.nodeCount', { count: 1234 })).toContain('1.234');
    expect(translator('en').t('map.nodeCount', { count: 1234 })).toContain('1,234');
  });
});

describe('plurals', () => {
  it('picks the English forms', () => {
    const en = translator('en');

    expect(en.t('map.nodeCount', { count: 1 })).toBe('1 node');
    expect(en.t('map.nodeCount', { count: 5 })).toBe('5 nodes');
    expect(en.t('map.nodeCount', { count: 0 })).toBe('0 nodes');
  });

  it('uses the single form for Japanese', () => {
    /*
     * Japanese has ONE plural category. Declaring only `other` is correct and
     * is what CLDR specifies — not an unfinished translation.
     */
    const ja = translator('ja');

    expect(ja.t('map.nodeCount', { count: 1 })).toBe('1件のノード');
    expect(ja.t('map.nodeCount', { count: 42 })).toBe('42件のノード');
  });

  it('selects among Arabic’s six categories', () => {
    /*
     * The case that breaks every `n === 1 ? x : y` implementation. Arabic
     * distinguishes zero, one, two, few, many and other, and CLDR chooses
     * between them by rules an English speaker has no intuition for.
     */
    const ar = translator('ar');

    expect(ar.t('map.nodeCount', { count: 0 })).toBe('لا عقد');
    expect(ar.t('map.nodeCount', { count: 1 })).toBe('عقدة واحدة');
    expect(ar.t('map.nodeCount', { count: 2 })).toBe('عقدتان');
    // 3–10 is `few`; 11+ is `many`. Different strings, and neither is "one".
    expect(ar.t('map.nodeCount', { count: 3 })).not.toBe(
      ar.t('map.nodeCount', { count: 11 }),
    );
  });

  it('falls back to `other` for a category a message omits', () => {
    // CLDR guarantees every language has `other`, which is what makes it a
    // safe last resort.
    expect(translator('es').t('map.nodeCount', { count: 7 })).toBe('7 nodos');
  });

  it('does not throw when a plural message gets no count', () => {
    // A bug in the CALL, not the catalogue. A crashed screen would be worse
    // than a slightly wrong string.
    expect(() => translator('en').t('map.nodeCount')).not.toThrow();
  });
});

describe('catalogue coverage', () => {
  it('is complete for the default locale', () => {
    const report = coverage(DEFAULT_LOCALE);

    expect(report.missing).toEqual([]);
    expect(report.translated).toBe(report.total);
  });

  it('reports the gap for a partial catalogue rather than failing', () => {
    const report = coverage('de');

    expect(report.total).toBe(messageKeys().length);
    expect(report.translated).toBeLessThan(report.total);
    expect(report.missing.length).toBeGreaterThan(0);
  });

  it('reports every supported locale without throwing', () => {
    for (const locale of LOCALES) {
      expect(() => coverage(locale)).not.toThrow();
    }
  });
});

// ------------------------------------------------------------- formatting

describe('Intl formatting', () => {
  it('formats numbers per locale', () => {
    expect(formatNumber(1234.5, 'en-US')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
  });

  it('places the currency symbol where the locale puts it', () => {
    // String concatenation cannot do this: German puts the euro after.
    const german = formatMoney(123456, 'de', 'EUR');

    expect(german).toContain('1.234,56');
    expect(german.trimEnd().endsWith('€')).toBe(true);
  });

  it('takes integer cents, like everything else here', () => {
    expect(formatMoney(1999, 'en-US', 'USD')).toBe('$19.99');
  });

  it('formats dates per locale', () => {
    const iso = '2026-03-09T12:00:00Z';

    // Different order, not merely different separators.
    expect(formatDate(iso, 'en-US')).not.toBe(formatDate(iso, 'ja'));
  });

  it('renders an unparseable date as a dash, not "Invalid Date"', () => {
    expect(formatDate('not a date', 'en')).toBe('—');
  });

  it('formats relative time in the reader’s language', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

    expect(formatRelative(threeDaysAgo, 'en')).toMatch(/3 days ago/);
    expect(formatRelative(threeDaysAgo, 'es')).not.toMatch(/ago/);
  });

  it('joins lists with the right conjunction', () => {
    expect(formatList(['A', 'B', 'C'], 'en')).toBe('A, B, and C');
    expect(formatList(['A', 'B', 'C'], 'de')).toBe('A, B und C');
  });
});

// ---------------------------------------------------------------- surfaces

describe('display surfaces', () => {
  it('infers viewing distance from physical size', () => {
    // A phone is held; a wall is stood back from.
    expect(inferViewingDistanceMm(6)).toBeLessThan(inferViewingDistanceMm(13));
    expect(inferViewingDistanceMm(13)).toBeLessThan(inferViewingDistanceMm(86));
  });

  it('recognises a board from its touch-point count', () => {
    /*
     * The one strong signal available. An 86-inch 4K board and a 27-inch
     * monitor both report about 1920 CSS pixels — no amount of pixel
     * arithmetic separates them, and 20+ contacts does.
     */
    const diagonal = estimateDiagonalInches({
      width: 1920,
      height: 1080,
      dpr: 1,
      coarsePointer: true,
      maxTouchPoints: 20,
    });

    expect(diagonal).toBeGreaterThan(50);
  });

  it('prefers a measurement over the inference', () => {
    expect(
      estimateDiagonalInches({
        width: 1920,
        height: 1080,
        dpr: 1,
        coarsePointer: true,
        diagonalInches: 86,
      }),
    ).toBe(86);
  });

  it('classifies the four surfaces', () => {
    expect(classify(6, true)).toBe('handheld');
    expect(classify(11, true)).toBe('tablet');
    expect(classify(27, false)).toBe('desktop');
    expect(classify(86, true)).toBe('wall');
  });

  it('does not call a large monitor a board without touch', () => {
    // A 50-inch television used as a desk monitor is not a shared surface.
    expect(classify(50, false)).toBe('desktop');
  });

  it('never scales a laptop or smaller', () => {
    // The type scale is already at its legible floor; shrinking it would fail
    // contrast and touch minimums.
    expect(scaleFor(6, 350)).toBe(1);
    expect(scaleFor(13, 600)).toBe(1);
  });

  it('scales a wall up, but not by full angular parity', () => {
    /*
     * Strict optics says 2.5m needs 4.2x. That is correct and wrong: at that
     * size a wall shows as much as a phone, which defeats having a wall.
     */
    const wall = scaleFor(86, 2500);

    expect(wall).toBeGreaterThan(1.5);
    expect(wall).toBeLessThanOrEqual(2.4);
  });

  it('gives a board a larger minimum target than a phone', () => {
    // An extended arm is less accurate than a thumb: same finger, worse aim.
    const phone = describeSurface({
      width: 390,
      height: 844,
      dpr: 3,
      coarsePointer: true,
      maxTouchPoints: 5,
    });

    const wall = describeSurface({
      width: 3840,
      height: 2160,
      dpr: 1,
      coarsePointer: true,
      maxTouchPoints: 40,
      diagonalInches: 86,
    });

    /*
     * The PHYSICAL minimum is larger on a board. The CSS-pixel one can be
     * smaller, and that inversion is not a bug: a board has few CSS pixels
     * per millimetre, so its 14mm computes to fewer pixels than a dense
     * phone's 9mm — while the 44px platform floor there is already ~22mm,
     * comfortably above what is required.
     *
     * Asserting the pixel ordering was the first version of this test, and it
     * failed for exactly that reason.
     */
    expect(minimumTargetMm(wall)).toBeGreaterThan(minimumTargetMm(phone));

    expect(minimumTargetPx(wall) / wall.pixelsPerMm).toBeGreaterThanOrEqual(
      minimumTargetMm(wall),
    );
    expect(minimumTargetPx(phone) / phone.pixelsPerMm).toBeGreaterThanOrEqual(
      minimumTargetMm(phone),
    );

    // And neither ever falls below the platform floor.
    expect(minimumTargetPx(phone)).toBeGreaterThanOrEqual(44);
    expect(minimumTargetPx(wall)).toBeGreaterThanOrEqual(44);
  });

  it('gives a board a hand span in real millimetres', () => {
    const wall = describeSurface({
      width: 3840,
      height: 2160,
      dpr: 1,
      coarsePointer: true,
      maxTouchPoints: 40,
      diagonalInches: 86,
    });

    // A hand is 200mm wherever it is. On this board that is a few hundred
    // pixels — the number `multitouch.ts` could not compute for itself.
    expect(handSpanPx(wall)).toBeGreaterThan(100);
    expect(handSpanPx(wall)).toBeLessThan(1000);
  });

  it('turns board mode on only for a wall', () => {
    const wall = describeSurface({
      width: 3840,
      height: 2160,
      dpr: 1,
      coarsePointer: true,
      maxTouchPoints: 40,
      diagonalInches: 86,
    });

    const laptop = describeSurface({
      width: 1440,
      height: 900,
      dpr: 2,
      coarsePointer: false,
    });

    expect(isBoardMode(wall)).toBe(true);
    expect(wall.shared).toBe(true);
    expect(isBoardMode(laptop)).toBe(false);
  });

  it('emits one scale variable rather than forty overridden sizes', () => {
    /*
     * The design system expresses every size in terms of its tokens, so
     * multiplying one variable rescales the product coherently. Forty
     * overrides would drift from the tokens the moment either changed.
     */
    const wall = describeSurface({
      width: 3840,
      height: 2160,
      dpr: 1,
      coarsePointer: true,
      diagonalInches: 86,
    });

    const variables = surfaceVariables(wall);

    expect(Object.keys(variables)).toEqual([
      '--surface-scale',
      '--surface-min-target',
    ]);
  });
});
