import { describe, expect, it } from 'vitest';
import {
  screens,
  routes,
  buildRoute,
  activeTabFor,
  bleedsFor,
  chromeFor,
  screenByNumber,
} from './routes';
import { NAV_ITEMS } from '@/components/shell/navItems';

describe('screen registry', () => {
  it('contains exactly 22 screens', () => {
    // §08 fixed this at 22. Growth here is a scope change and needs a
    // decision record, not just a new file.
    expect(screens).toHaveLength(22);
  });

  it('numbers them 01 through 22 with no gaps or duplicates', () => {
    const numbers = screens.map((s) => s.screen).sort();
    const expected = Array.from({ length: 22 }, (_, i) =>
      String(i + 1).padStart(2, '0'),
    );
    expect(numbers).toEqual(expected);
  });

  it('gives every screen a purpose and an owning phase', () => {
    for (const screen of screens) {
      expect(screen.name, screen.screen).toBeTruthy();
      expect(screen.purpose, screen.screen).toBeTruthy();
      expect(screen.phase, screen.screen).toMatch(/^P\d{1,2}$/);
    }
  });

  it('looks a screen up by number', () => {
    expect(screenByNumber('02')?.name).toBe('Community Map');
    expect(screenByNumber('21')?.access).toBe('staff');
  });
});

describe('access levels', () => {
  it('keeps the map, search and Coming Soon publicly reachable', () => {
    // The 3-tap arrival target in §24 is measured on first visit, before any
    // account exists. Gating the map behind sign-up would make it unmeasurable
    // and the funnel meaningless.
    for (const number of ['02', '03', '04', '05', '06', '22'] as const) {
      expect(screenByNumber(number)?.access, number).toBe('public');
    }
  });

  it('requires an account for anything that owns or edits data', () => {
    for (const number of [
      '07',
      '08',
      '09',
      '10',
      '11',
      '12',
      '13',
      '19',
      '20',
    ] as const) {
      expect(screenByNumber(number)?.access, number).toBe('authed');
    }
  });

  it('restricts moderation to staff', () => {
    expect(screenByNumber('21')?.access).toBe('staff');
  });
});

describe('deep-link scheme', () => {
  it('keeps node detail a query param so the map never unmounts', () => {
    // If this becomes a path segment, MapCanvas remounts on every selection
    // and the camera, expansion state and animations are all lost.
    expect(buildRoute.mapNode('abc')).toBe('/map?node=abc');
    expect(buildRoute.mapEditorNode('m1', 'n1')).toBe('/maps/m1?node=n1');
  });

  it('uses the short canonical form for public node links', () => {
    expect(buildRoute.shareNode('abc')).toBe('/n/abc');
  });

  it('encodes user-supplied segments', () => {
    // A map id or handle containing a slash or a space must not be able to
    // forge a path.
    expect(buildRoute.mapEditor('a/b')).toBe('/maps/a%2Fb');
    expect(buildRoute.profile('some one')).toBe('/u/some%20one');
    expect(buildRoute.mapNode('a&b=c')).toBe('/map?node=a%26b%3Dc');
  });

  it('carries a return path through sign-in', () => {
    expect(buildRoute.signIn('/maps')).toBe('/sign-in?returnTo=%2Fmaps');
    expect(buildRoute.signIn()).toBe('/sign-in');
  });
});

describe('activeTabFor', () => {
  it.each([
    ['/map', 'map'],
    ['/map/tree', 'map'],
    ['/watch', 'map'],
    ['/watch/feed', 'map'],
    ['/create/link', 'map'],
    ['/services/full-stack', 'map'],
    ['/soon/node-1', 'map'],
    ['/search', 'search'],
    ['/maps', 'maps'],
    ['/maps/new', 'maps'],
    ['/maps/abc', 'maps'],
    ['/maps/abc/share', 'maps'],
    ['/notifications', 'you'],
    ['/settings', 'you'],
    ['/u/someone', 'you'],
    ['/admin/moderation', 'you'],
  ])('activates the right tab for %s', (pathname, expected) => {
    expect(activeTabFor(pathname)).toBe(expected);
  });

  it('prefers the longest matching prefix', () => {
    // '/maps/abc' starts with '/map' too. Without longest-prefix ordering the
    // editor would light up the Map tab.
    expect(activeTabFor('/maps/abc/collaborators')).toBe('maps');
  });

  it('falls back to the map for an unknown path', () => {
    expect(activeTabFor('/something-else')).toBe('map');
  });
});

describe('chromeFor', () => {
  it('gives the entry transition no chrome', () => {
    expect(chromeFor(routes.entry)).toBe('none');
  });

  it('gives the map editor minimal chrome so the canvas owns the viewport', () => {
    expect(chromeFor('/maps/abc')).toBe('minimal');
  });

  it('does not treat the maps list or new-map as the editor', () => {
    expect(chromeFor('/maps')).toBe('full');
    expect(chromeFor('/maps/new')).toBe('full');
  });

  it('gives the editor sub-routes full chrome', () => {
    // Share and collaborators are sheets over the editor conceptually, but as
    // routes they are ordinary screens and need the nav back out.
    expect(chromeFor('/maps/abc/share')).toBe('full');
  });
});

describe('bleedsFor', () => {
  it('lets the map paint edge to edge', () => {
    // The map is the product interface, not content inside a page. Shell
    // padding around it makes the canvas smaller than the viewport, which
    // shows as a hairline of background at the screen edges.
    expect(bleedsFor(routes.map)).toBe(true);
    expect(bleedsFor(routes.tree)).toBe(true);
  });

  it('lets the map editor paint edge to edge', () => {
    expect(bleedsFor('/maps/abc')).toBe(true);
  });

  it('keeps ordinary screens padded', () => {
    expect(bleedsFor(routes.maps)).toBe(false);
    expect(bleedsFor(routes.newMap)).toBe(false);
    expect(bleedsFor(routes.settings)).toBe(false);
    expect(bleedsFor('/maps/abc/share')).toBe(false);
  });
});

describe('navigation items', () => {
  it('has exactly four primary destinations', () => {
    // §06. A fifth means one of these is not primary — a scope conversation,
    // not a layout tweak.
    expect(NAV_ITEMS).toHaveLength(4);
  });

  it('points every nav item at a real route', () => {
    const paths = new Set(screens.map((s) => s.path));
    for (const item of NAV_ITEMS) {
      // /you is an alias that redirects to /u/<handle>, so it is legitimately
      // absent from the screen registry.
      if (item.href === routes.you) continue;
      expect(paths.has(item.href), `${item.id} -> ${item.href}`).toBe(true);
    }
  });

  it('marks each nav item active on its own route', () => {
    for (const item of NAV_ITEMS) {
      expect(activeTabFor(item.href), item.id).toBe(item.id);
    }
  });

  it('uses a unique id, label and href per item', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.label)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
  });
});
