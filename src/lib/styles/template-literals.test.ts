import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A backtick inside a comment inside a template literal ends the literal.
 *
 * ── Why this test exists ────────────────────────────────────────────────────
 *
 * This exact mistake was made four separate times while building this project:
 * in `AppShell`, in `InfiniteList`, in `ChipGrid`, in a SQL string in
 * `migrations.ts`, in `Hero`, in `ProfileHeader`, in `ServiceMap`, and in a
 * SQL comment in `collab/repo.ts`. Every time it was written for the same
 * innocent reason — quoting an identifier the way one does everywhere else in
 * this codebase's prose — and every time it produced a syntax error dozens of
 * lines away from the cause.
 *
 * The failure is slow to diagnose because the error surfaces wherever the
 * parser finally gives up, which is never where the backtick is. Twice it took
 * the dev server down and the reported symptom was an unrelated page failing
 * to compile.
 *
 * A habit that has been broken eight times is not a habit; it is a missing
 * check. This is the check.
 *
 * ── What is allowed ─────────────────────────────────────────────────────────
 *
 * Backticks in template literal COMMENTS. That is all. Prose comments outside
 * literals still quote identifiers with backticks freely, which is why the
 * scanner tracks literal boundaries rather than grepping for the character.
 */

const SRC = join(process.cwd(), 'src');
const BACKTICK = '`';
const BACKSLASH = '\\';

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

interface Offence {
  file: string;
  comment: string;
}

/**
 * Find template literals that were terminated inside a comment.
 *
 * ── Why it detects the SYMPTOM, not the backtick ────────────────────────────
 *
 * The obvious implementation — find a literal, look for a comment inside it
 * containing a backtick — cannot work, and the self-test below is what proved
 * it. The stray backtick IS the terminator: by the time the scanner reaches
 * it, the literal has already ended, so there is no "comment inside the
 * literal" left to find. The parser has the same problem, which is why its
 * error lands so far from the cause.
 *
 * So this looks for the wreckage instead. A literal whose body ends with an
 * unclosed block comment, or on a line still inside a SQL comment, was
 * terminated somewhere it should not have been — and a backtick in a comment
 * is overwhelmingly the reason.
 */
function scan(source: string, file: string): Offence[] {
  const offences: Offence[] = [];

  /*
   * A small state machine, because a plain search is not sufficient.
   *
   * The first version treated every backtick as the start of a template
   * literal. That flagged two files immediately, and both were false: a
   * backtick quoting an identifier inside an ordinary JSDoc comment, and one
   * inside a single-quoted string in this very file. Backticks appear in
   * prose all over this codebase, so the scanner has to know whether it is
   * looking at code before it can judge anything.
   */
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let state: State = 'code';
  let literalStart = 0;
  let index = 0;

  const check = (body: string) => {
    // A block comment opened and never closed: the literal ended inside it.
    const opened = body.lastIndexOf('/*');
    const closed = body.lastIndexOf('*/');
    if (opened > closed) {
      offences.push({
        file,
        comment: body.slice(opened, opened + 90).replace(/\s+/g, ' '),
      });
      return;
    }

    /*
     * A SQL line comment still open on the final line.
     *
     * Requires two dashes followed by a space. CSS custom properties start
     * with two dashes and no space, and matching those would flag every
     * styled component in the codebase.
     */
    const lastLine = body.slice(body.lastIndexOf('\n') + 1);
    if (/(^|\s)--\s/.test(lastLine)) {
      offences.push({ file, comment: lastLine.trim().slice(0, 90) });
    }
  };

  while (index < source.length) {
    const two = source.slice(index, index + 2);
    const char = source[index];

    if (state === 'code') {
      if (two === '//') {
        state = 'line';
        index += 2;
      } else if (two === '/*') {
        state = 'block';
        index += 2;
      } else if (char === "'") {
        state = 'single';
        index++;
      } else if (char === '"') {
        state = 'double';
        index++;
      } else if (char === BACKTICK) {
        state = 'template';
        literalStart = index + 1;
        index++;
      } else {
        index++;
      }
      continue;
    }

    if (state === 'line') {
      if (char === '\n') state = 'code';
      index++;
      continue;
    }

    if (state === 'block') {
      if (two === '*/') {
        state = 'code';
        index += 2;
      } else index++;
      continue;
    }

    // Strings and template bodies all honour backslash escapes.
    if (char === BACKSLASH) {
      index += 2;
      continue;
    }

    if (state === 'single' && char === "'") state = 'code';
    else if (state === 'double' && char === '"') state = 'code';
    else if (state === 'template' && char === BACKTICK) {
      check(source.slice(literalStart, index));
      state = 'code';
    }

    index++;
  }

  return offences;
}

describe('template literals', () => {
  const files = walk(SRC).map((file) => ({
    path: relative(SRC, file).replace(/\\/g, '/'),
    source: readFileSync(file, 'utf8'),
  }));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no backticks inside template-literal comments', () => {
    const offences = files.flatMap((file) => scan(file.source, file.path));

    expect(
      offences,
      offences.length === 0
        ? ''
        : `A backtick inside a comment inside a template literal ENDS the literal.\n` +
            `Rewrite the comment without backticks:\n\n` +
            offences.map((o) => `  ${o.file}\n    ${o.comment}`).join('\n\n'),
    ).toEqual([]);
  });

  /**
   * The scanner has to actually catch the thing, or it is decoration.
   *
   * Written as a string the parser never sees as source, so this file cannot
   * fail its own test.
   */
  it('detects the pattern it exists to prevent', () => {
    const bad = ['const x = styled.div`', '  /* see `foo` */', '`;'].join('\n');
    expect(scan(bad, 'fixture.ts')).toHaveLength(1);

    const good = ['const x = styled.div`', '  /* see foo */', '`;'].join('\n');
    expect(scan(good, 'fixture.ts')).toHaveLength(0);

    // Prose outside a literal is untouched.
    const prose = '/** See `foo` for details. */\nexport const y = 1;';
    expect(scan(prose, 'fixture.ts')).toHaveLength(0);
  });
});
