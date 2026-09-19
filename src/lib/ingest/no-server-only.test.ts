import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * No client component may reach `server-only`, however many hops it takes.
 *
 * ── The bug this exists because of ──────────────────────────────────────────
 *
 * Screen 14 imported one four-line pure function, `countNodes`, from
 * `ingest/structure.ts`. That module imports the AI gateway; the gateway is
 * `server-only`. Because it was a VALUE import rather than `import type`, the
 * whole graph came with it and the dev server returned 500 on eleven routes at
 * once, with an error naming `ai/gateway.ts` — a module the failing component
 * has never heard of.
 *
 * It took four hops to get there:
 *
 *     SearchScreen (use client) → components/link → LinkScreen
 *       → ingest/structure → ai/gateway
 *
 * ── Why the existing guard did not catch it ─────────────────────────────────
 *
 * `chokepoint.test.ts` has a test called "never ships the database into a
 * client component". It looks for `@/lib/db/` in a file that begins with
 * `'use client'` — DIRECT imports only, and only that one prefix. Every hop
 * above is invisible to it, and so is every server-only module that is not the
 * database.
 *
 * So this walks the graph. It is the difference between a guard that catches
 * the mistake nobody makes and one that catches the mistake that was actually
 * made.
 *
 * ── Why `import type` is not a violation ────────────────────────────────────
 *
 * TypeScript erases it; nothing reaches the bundle. Treating it as a violation
 * would ban a component from naming the shape of its own props, which is both
 * useful and free. The scanner therefore skips `import type` and the inline
 * `type` specifier — that distinction is the entire point of the rule.
 */

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

const ALL = walk(SRC);

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Resolve a specifier to a file on disk, or null when it is a package.
 *
 * Extensionless and directory (`/index`) forms are both tried, because both
 * appear in this codebase and a resolver that handles one silently stops
 * following the graph at the other — which would make the whole test pass by
 * seeing nothing.
 */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;

  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null; // a package, not ours

  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this one. A missing path is normal while trying candidates.
    }
  }

  return null;
}

/**
 * VALUE imports only.
 *
 * `import type { X } from '...'` and `import { type X } from '...'` are erased
 * at compile time and carry nothing into the bundle, so neither is followed.
 * A default or namespace import is a value and is.
 */
function valueImportsOf(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /import\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const clause = match[1] ?? '';
    const specifier = match[2];
    if (!specifier) continue;

    // `import type { ... } from` — erased entirely.
    if (/^type\b/.test(clause.trim())) continue;

    /*
     * A brace clause whose every named binding is prefixed with `type` is also
     * fully erased. Anything else in the clause — a default binding, a
     * namespace, or one untyped name — makes it a value import.
     */
    const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());

    if (braces) {
      const names = (braces[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);

      if (names.length > 0 && names.every((name) => /^type\s/.test(name))) {
        continue;
      }
    }

    specifiers.push(specifier);
  }

  // `import './side-effect'` has no clause and still pulls the module in.
  const bare = /import\s+['"]([^'"]+)['"]/g;
  while ((match = bare.exec(source)) !== null) {
    if (match[1]) specifiers.push(match[1]);
  }

  return specifiers;
}

function isServerOnly(path: string): boolean {
  return /^\s*import\s+['"]server-only['"]/m.test(read(path));
}

function isClientComponent(path: string): boolean {
  return /^['"]use client['"]/.test(read(path).trimStart());
}

/**
 * Follow value imports from a file until a `server-only` module is reached.
 *
 * Returns the chain, so a failure names every hop. A test that said only
 * "SearchScreen reaches server-only" would leave someone to rediscover the
 * four hops by hand, which is most of the work.
 */
function pathToServerOnly(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: { file: string; chain: string[] }[] = [
    { file: entry, chain: [entry] },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;

    if (seen.has(current.file)) continue;
    seen.add(current.file);

    // The entry itself is a client component and cannot be server-only, so
    // the check starts one hop in.
    if (current.file !== entry && isServerOnly(current.file)) {
      return current.chain;
    }

    for (const specifier of valueImportsOf(read(current.file))) {
      const resolved = resolveImport(current.file, specifier);
      if (resolved && !seen.has(resolved)) {
        stack.push({ file: resolved, chain: [...current.chain, resolved] });
      }
    }
  }

  return null;
}

function show(path: string): string {
  return relative(SRC, path).replace(/\\/g, '/');
}

describe('client components never reach server-only code', () => {
  const clients = ALL.filter(
    (file) => isClientComponent(file) && !file.endsWith('.test.ts'),
  );

  it('finds client components to check', () => {
    // A resolver that quietly matched nothing would make every assertion below
    // pass by checking an empty list.
    expect(clients.length).toBeGreaterThan(10);
  });

  it('resolves the aliases this codebase actually uses', () => {
    expect(resolveImport(join(SRC, 'x.ts'), '@/lib/ingest/tree')).not.toBeNull();
    expect(resolveImport(join(SRC, 'x.ts'), '@/components/ui')).not.toBeNull();
    expect(resolveImport(join(SRC, 'x.ts'), 'react')).toBeNull();
  });

  it('knows a value import from a type-only one', () => {
    expect(valueImportsOf("import type { A } from './a';")).toEqual([]);
    expect(valueImportsOf("import { type A, type B } from './a';")).toEqual([]);
    expect(valueImportsOf("import { a } from './a';")).toEqual(['./a']);
    expect(valueImportsOf("import { type A, b } from './a';")).toEqual(['./a']);
    expect(valueImportsOf("import './a';")).toEqual(['./a']);
  });

  it('reaches no server-only module from any of them', () => {
    const offenders = clients
      .map((file) => ({ file, chain: pathToServerOnly(file) }))
      .filter((result) => result.chain !== null)
      .map((result) => (result.chain ?? []).map(show).join('\n  → '));

    expect(
      offenders,
      `A client component reaches server-only code. Every hop below is a VALUE\n` +
        `import; making the one that only needs a type into \`import type\`\n` +
        `usually fixes it.\n\n${offenders.join('\n\n')}`,
    ).toEqual([]);
  });
});
