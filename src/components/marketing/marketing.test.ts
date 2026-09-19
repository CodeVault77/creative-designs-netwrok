import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { contact, emailUrl, whatsappUrl } from '@/config/contact';
import {
  activeServices,
  featuredServices,
  serviceOptions,
} from '@/config/services';
import { enabled, footerNav, headerNav } from '@/config/navigation';

/**
 * Structural guards for the marketing surface.
 *
 * These do not test behaviour. They test the SHAPE the roadmap's migration
 * promise depends on (§28.5): if marketing components couple to the
 * application, or contact details leak out of configuration, then Phase 1 is a
 * rewrite rather than a flag change — and nothing else in the test suite would
 * notice.
 *
 * Modelled on `chokepoint.test.ts`, which does the same job for authorisation.
 */

const SRC = join(process.cwd(), 'src');
const MARKETING = join(SRC, 'components', 'marketing');

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

describe('marketing does not couple to the application', () => {
  /**
   * The forbidden imports.
   *
   * One convenient import of `MapCanvas` pulls the radial renderer, the layout
   * engine and the sprite cache into the landing page bundle — and §22 budgets
   * that page at 120KB of JavaScript. The failure is silent: the page still
   * works, it is just four times the size, and nobody notices until a
   * Lighthouse run months later.
   */
  const FORBIDDEN = [
    '@/lib/map',
    '@/lib/editor',
    '@/components/map',
    '@/components/editor',
    '@/components/node',
    '@/lib/collab',
    '@/components/collab',
  ];

  it('imports nothing from the map, editor or canvas modules', () => {
    const offences: string[] = [];

    for (const file of walk(MARKETING)) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const source = readFileSync(file, 'utf8');

      for (const forbidden of FORBIDDEN) {
        // Matches both `from '@/lib/map'` and `from '@/lib/map/geometry'`.
        const pattern = new RegExp(`from '${forbidden}(/[^']*)?'`);
        if (pattern.test(source)) {
          offences.push(`${relative(SRC, file)} imports ${forbidden}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});

describe('contact details live in exactly one place', () => {
  /**
   * §15.2 and AC-3/AC-4. The number and the address appear in `config/
   * contact.ts` and nowhere else, so changing one is a single edit and cannot
   * leave a stale copy behind in a component nobody thought to grep.
   */
  it('no email address or wa.me link is hardcoded outside the config', () => {
    const offences: string[] = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');

      // The config itself, and tests, are allowed to name them.
      if (rel === 'config/contact.ts') continue;
      if (/\.(test|stories)\.tsx?$/.test(rel)) continue;
      // Server-side business inboxes are a different concern (P12/P14).
      if (rel.startsWith('lib/services/') || rel.startsWith('lib/launch/'))
        continue;

      const source = readFileSync(file, 'utf8');

      if (/https:\/\/wa\.me\//.test(source)) {
        offences.push(`${rel} builds a wa.me URL by hand`);
      }
      // A literal mailto: with an address baked in, rather than emailUrl().
      if (/mailto:[a-zA-Z0-9._%+-]+@/.test(source)) {
        offences.push(`${rel} hardcodes a mailto address`);
      }
    }

    expect(offences).toEqual([]);
  });

  /**
   * OD-1 and OD-2 are unanswered, so both are empty — and every component
   * must therefore treat "not configured" as a real state rather than
   * rendering a broken link. `wa.me/` with no number silently opens WhatsApp
   * on a blank chat, which looks like it worked.
   */
  it('returns null rather than a broken link when unconfigured', () => {
    if (contact.whatsapp.number === '') expect(whatsappUrl()).toBeNull();
    if (contact.email === '') expect(emailUrl()).toBeNull();
  });

  it('builds a correctly encoded link once configured', () => {
    // Proves the shape without depending on the real number being decided.
    const sample = {
      ...contact,
      whatsapp: { number: '15550100000', prefill: 'Hi there' },
    };
    const url = `https://wa.me/${sample.whatsapp.number}?text=${encodeURIComponent(
      sample.whatsapp.prefill,
    )}`;
    expect(url).toBe('https://wa.me/15550100000?text=Hi%20there');
  });
});

describe('configuration is coherent', () => {
  it('every service has the fields a card and the request form need', () => {
    for (const service of activeServices()) {
      expect(service.id).toMatch(/^[a-z0-9-]+$/);
      expect(service.name.length).toBeGreaterThan(2);
      expect(service.summary.length).toBeGreaterThan(10);
      expect(service.order).toBeGreaterThan(0);
    }
  });

  it('has unique service ids', () => {
    const ids = activeServices().map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is sorted by order, not by declaration', () => {
    const orders = activeServices().map((service) => service.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  /**
   * §15.4 / OD-15: twelve cards on a landing page is a directory, not a pitch.
   */
  it('features a landing-page-sized subset', () => {
    const featured = featuredServices();
    expect(featured.length).toBeGreaterThanOrEqual(3);
    expect(featured.length).toBeLessThanOrEqual(6);
  });

  it('offers every active service in the request form, plus an escape hatch', () => {
    const options = serviceOptions();
    expect(options.length).toBe(activeServices().length + 1);
    expect(options.at(-1)?.value).toBe('not-sure');
  });

  /**
   * The migration mechanism (§28.4): Phase 1 destinations are declared now and
   * disabled, so turning them on is a boolean. If nothing is disabled, that
   * mechanism has quietly stopped being exercised.
   */
  it('declares Phase 1 navigation up front, disabled', () => {
    const disabled = headerNav.filter((item) => !item.enabled);
    expect(disabled.length).toBeGreaterThan(0);
    expect(enabled(headerNav).length).toBeGreaterThan(0);
  });

  it('never renders a disabled navigation entry', () => {
    for (const item of enabled(headerNav)) expect(item.enabled).toBe(true);
    for (const group of footerNav) {
      for (const item of enabled(group.items)) expect(item.enabled).toBe(true);
    }
  });

  it('points every enabled link at a real path', () => {
    const links = [
      ...enabled(headerNav),
      ...footerNav.flatMap((g) => enabled(g.items)),
    ];
    for (const item of links) {
      expect(item.href.startsWith('/') || item.href.startsWith('http')).toBe(true);
    }
  });
});
