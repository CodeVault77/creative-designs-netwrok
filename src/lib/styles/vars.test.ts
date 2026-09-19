import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cssVariables } from './cssVars.generated';

/**
 * Every `var(--…)` in the app must name a variable that exists.
 *
 * This test exists because of a real bug. P9's progress stages and node
 * checklist referenced `--family-create-core`; the generated name is
 * `--fam-create-core`. CSS does not complain about an undefined custom
 * property — it silently resolves to nothing, so the component rendered with
 * no accent colour and no error anywhere. It was found by eye, which is not a
 * process.
 *
 * A typo in a token name is invisible in TypeScript, invisible in the browser
 * console, and invisible in a screenshot unless you know what the colour was
 * meant to be. So it gets a structural test, like the authorisation choke
 * point does.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

/**
 * Variables defined outside the token pipeline.
 *
 * EMPTY, and it should stay that way.
 *
 * ── Why this list is empty, and why that matters ────────────────────────────
 *
 * It used to hold thirty-one names, and it was the reason this test gave false
 * confidence for four phases. Most of those names were generated anyway, so
 * listing them changed nothing — but seven were not generated and did not
 * exist anywhere at all:
 *
 *     --radius-sm  --radius-md  --radius-lg  --text-display
 *     --text-mono  --z-topbar   --z-modal
 *
 * They were used 33 times across P1–P13. CSS resolves an undefined custom
 * property to nothing, so every one of those rules silently did nothing: cards
 * with no corner radius, headings at inherited size. The test that existed to
 * catch exactly this had been told to ignore them, because the list was
 * written from memory of what the tokens were called rather than from the
 * generated output.
 *
 * The lesson is narrow and worth keeping: an allowlist entry is a claim that
 * something exists elsewhere, and a claim nobody checked is worse than no
 * check at all. If a genuinely hand-written variable is ever needed, add it
 * here AND add an assertion below that its definition can be found in the
 * source — never on the strength of remembering it.
 */
const HAND_WRITTEN = new Set<string>([
  /**
   * The three next/font variables.
   *
   * These are the one legitimate case the note above describes: they are real,
   * but nothing in `tokens.json` can generate them — next/font mints the name
   * at build time from `fonts.ts` and injects the value via a class on <html>.
   *
   * Entered here under the rule that governs this list: each one is asserted
   * to exist, in "the typefaces are actually applied" below, which checks both
   * that `fonts.ts` declares it and that the root layout applies the class
   * that carries it. That block exists because these three were previously
   * declared and never applied, which blanked every font in the product.
   */
  '--font-display',
  '--font-body',
  '--font-mono',
]);

/** Names built at runtime from a prop, e.g. `var(--fam-${family}-core)`. */
const INTERPOLATED = /\$\{/;

describe('CSS custom properties', () => {
  // The generated module is one CSS string; the declared names are its keys.
  const generated = new Set(
    [...cssVariables.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1]!),
  );

  it('generates the family variables under the fam- prefix', () => {
    // Pins the exact shape the bug got wrong.
    expect(generated.has('--fam-create-core')).toBe(true);
    expect(generated.has('--family-create-core')).toBe(false);
  });

  it('references no variable that does not exist', () => {
    const unknown: string[] = [];

    for (const file of walk(SRC)) {
      if (/\.(test|stories)\.tsx?$/.test(file)) continue;
      if (file.endsWith('generated.ts')) continue;

      const source = readFileSync(file, 'utf8');

      /**
       * At least one letter is required after `--`, so the `var(--…)` written
       * inside a prose comment is not read as a reference.
       *
       * The trailing group captures a fallback: `var(--x, 0.16em)` is a
       * deliberate "use this if the token is absent", which is a different
       * thing from a typo and is allowed through.
       */
      for (const match of source.matchAll(
        /var\(\s*(--[a-zA-Z][a-zA-Z0-9-]*)\s*(,?)/g,
      )) {
        const name = match[1]!;
        if (match[2] === ',') continue;

        // A partial name is the static half of an interpolated one; those are
        // checked below by expanding the family list instead.
        const line = source.slice(
          source.lastIndexOf('\n', match.index) + 1,
          source.indexOf('\n', match.index),
        );
        if (INTERPOLATED.test(line)) continue;

        if (!generated.has(name) && !HAND_WRITTEN.has(name)) {
          unknown.push(`${relative(SRC, file)}: ${name}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  /**
   * Interpolated names are expanded against every family, so
   * `var(--fam-${family}-core)` is checked as all six real names rather than
   * skipped for being dynamic — which is exactly where the original bug was.
   */
  it('resolves interpolated family variables for every family', () => {
    const families = [
      'create',
      'discover',
      'services',
      'people',
      'organise',
      'commerce',
    ];
    const unknown: string[] = [];

    for (const file of walk(SRC)) {
      if (/\.(test|stories)\.tsx?$/.test(file)) continue;
      const source = readFileSync(file, 'utf8');

      for (const match of source.matchAll(
        /var\(\s*(--[a-zA-Z0-9-]*)\$\{[^}]*\}([a-zA-Z0-9-]*)/g,
      )) {
        const prefix = match[1]!;
        const suffix = match[2]!;
        for (const family of families) {
          const name = `${prefix}${family}${suffix}`;
          if (!generated.has(name) && !HAND_WRITTEN.has(name)) {
            unknown.push(`${relative(SRC, file)}: ${name}`);
          }
        }
      }
    }

    expect(unknown).toEqual([]);
  });
});

/**
 * The typefaces have to be WIRED UP, not merely declared.
 *
 * This is a regression test for a bug that made the entire application render
 * in the browser's default serif. `fonts.ts` defined all three next/font
 * faces correctly and `--face-display` referenced them correctly — but the
 * root layout never put `fontVariables` on <html>, so `--font-display` was
 * undefined.
 *
 * The failure mode is the nasty part. A custom property whose value contains
 * an unresolvable `var()` is invalid at computed-value time and resolves to
 * the EMPTY STRING rather than falling through to the next font in the stack.
 * So `--face-display: var(--font-display), 'Chakra Petch', system-ui` did not
 * degrade to Chakra Petch; it degraded to nothing, and every heading, label
 * and node in the product silently became Times New Roman. Nothing threw,
 * nothing logged, and every other test stayed green.
 *
 * Two defences, both checked here: the layout must apply the variables, and
 * each face token must carry an in-`var()` fallback so a missing font
 * variable can only ever cost the self-hosted file, never the whole stack.
 */
describe('the typefaces are actually applied', () => {
  it('fonts.ts really declares each allow-listed --font-* variable', () => {
    const fonts = readFileSync(join(SRC, 'lib/styles/fonts.ts'), 'utf8');

    for (const face of ['display', 'body', 'mono']) {
      expect(
        fonts.includes(`variable: '--font-${face}'`),
        `fonts.ts does not declare --font-${face}`,
      ).toBe(true);
    }

    // And the three must be handed to the layout as one string, or applying
    // them becomes three things to remember instead of one.
    expect(fonts).toMatch(/export const fontVariables/);
  });

  it('the root layout puts the font variables on <html>', () => {
    const layout = readFileSync(join(SRC, 'app/layout.tsx'), 'utf8');

    expect(layout).toMatch(/fontVariables/);
    expect(layout).toMatch(/<html[^>]*className=\{fontVariables\}/);
  });

  it('every face token falls back inside the var(), not after it', () => {
    const generated = readFileSync(
      join(SRC, 'lib/styles/cssVars.generated.ts'),
      'utf8',
    );

    for (const face of ['display', 'body', 'mono']) {
      const line = generated
        .split('\n')
        .find((row) => row.includes(`--face-${face}:`));

      expect(line, `--face-${face} is missing`).toBeDefined();

      // var(--font-x, 'Fallback') — a comma INSIDE the parentheses. Checked
      // as a substring rather than a regex: the thing being asserted is
      // literal punctuation, and escaping it twice is how the assertion
      // quietly stops asserting anything.
      expect(
        line?.includes(`var(--font-${face}, '`),
        `--face-${face} has no fallback inside its var()`,
      ).toBe(true);
    }
  });
});
