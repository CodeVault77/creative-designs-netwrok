/**
 * The CDN route registry and deep-link scheme.
 *
 * SINGLE SOURCE OF TRUTH for every navigable location. The shell, the guards,
 * the tests and the screen scaffolds all read from here, so a route cannot
 * exist without appearing in navigation, and a nav item cannot point at a
 * route that does not exist.
 *
 * ── Two scheme decisions worth understanding ────────────────────────────────
 *
 * 1. NODE DETAIL IS A QUERY PARAM, NOT A ROUTE.
 *
 *    §08 is explicit that "Expanded radial map", "Selected node state" and
 *    "Node detail panel" are STATES of one screen, not three screens. A
 *    separate `/map/node/<id>` route would unmount and remount MapCanvas on
 *    every selection — destroying the camera position, the expansion state and
 *    any in-flight animation, and forcing a fresh WebGL/canvas context.
 *
 *    So selection lives in `?node=<id>`: the map stays mounted, the sheet
 *    opens over it, and Back closes the sheet rather than leaving the map.
 *    F2's rule — "no state is reachable that cannot be exited in one tap" —
 *    depends on this.
 *
 * 2. `/n/<id>` IS THE CANONICAL SHARE URL.
 *
 *    §10 makes every node shareable at `/n/<id>`. That short form is what gets
 *    pasted into a message; it resolves server-side to the right map and
 *    redirects to `/map?node=<id>` (or `/maps/<mapId>?node=<id>`). Keeping the
 *    public URL short and the internal URL explicit means we can change the
 *    internal structure later without breaking links already in the wild.
 */

export type ScreenNumber =
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16'
  | '17'
  | '18'
  | '19'
  | '20'
  | '21'
  | '22';

/** Which primary tab owns a route. Drives the active state in TabBar/NavRail. */
export type TabId = 'map' | 'search' | 'maps' | 'you';

/** Who may reach a route. Enforced in src/lib/auth/guard.ts. */
export type Access =
  /** Anyone, signed in or not. */
  | 'public'
  /** Signed-in users. Redirects to sign-in with a return path. */
  | 'authed'
  /**
   * Staff only. Renders 404 rather than 403 — §08 state matrix, screen 21:
   * a 403 confirms the route exists, which tells an attacker where to look.
   */
  | 'staff';

export interface ScreenMeta {
  screen: ScreenNumber;
  name: string;
  purpose: string;
  /** Which phase actually builds it. P2 only wires the route and the shell. */
  phase: string;
  tab: TabId | null;
  access: Access;
  /** Hides the app chrome — used by the entry transition and the editor. */
  chrome: 'full' | 'none' | 'minimal';
}

// ---------------------------------------------------------------- static paths

export const routes = {
  /**
   * ── Phase 0: the public marketing site owns the root ────────────────────
   *
   * `/` was the application's entry transition until Milestone A. The public
   * site needs the root, so the app moved behind `/app` and everything below
   * `marketing` is new. Doing this now was far cheaper than doing it after
   * launch, when the URLs would be in circulation (roadmap §16.2).
   *
   * What did NOT move: the canonical share URLs (`/n/`, `/s/`, `/soon/`,
   * `/u/`). §10 makes those short on purpose — they are what gets pasted into
   * a message — and burying them under `/app` would undo that decision for no
   * gain. The rule is: anything designed to be shared stays at the root;
   * anything that is a place you go inside the product sits under `/app`.
   */
  home: '/',
  services: '/services',
  request: '/request',
  requestSuccess: '/request/success',
  contact: '/contact',
  privacy: '/privacy',
  terms: '/terms',

  /** The application entry transition. Was `/` before Milestone A. */
  entry: '/app',

  map: '/map',
  tree: '/map/tree',

  search: '/search',

  maps: '/maps',
  newMap: '/maps/new',

  linkToMindMap: '/create/link',

  /**
   * The marketplace. Public: a catalogue nobody can see before they have an
   * account is a catalogue that sells nothing.
   */
  marketplace: '/marketplace',

  /*
   * The three package collections (§Phase 7's "node type packages, not
   * separate applications").
   *
   * Each is a LENS over nodes the viewer already owns, filtered by type — not
   * an application with its own storage. They are routes rather than states of
   * the map because the whole point is to see across every map at once, which
   * a single map's canvas cannot show.
   */
  work: '/work',
  commerce: '/commerce',
  contacts: '/contacts',

  watcher: '/watch',
  watcherFeed: '/watch/feed',

  notifications: '/notifications',
  settings: '/settings',
  you: '/you',

  moderation: '/admin/moderation',
} as const;

// -------------------------------------------------------------- path builders

/**
 * Builders rather than template literals at call sites: one place to change
 * a URL shape, and impossible to forget encoding a user-supplied segment.
 */
export const buildRoute = {
  /** Community Map with a node selected. The sheet opens; the map stays mounted. */
  mapNode: (nodeId: string) => `${routes.map}?node=${encodeURIComponent(nodeId)}`,

  /** Canonical public share URL for a node (§10). */
  shareNode: (nodeId: string) => `/n/${encodeURIComponent(nodeId)}`,

  /** Coming Soon, deep-linkable so "notify me" links can be shared. */
  comingSoon: (nodeId: string) => `/soon/${encodeURIComponent(nodeId)}`,

  mapEditor: (mapId: string) => `/maps/${encodeURIComponent(mapId)}`,
  mapEditorNode: (mapId: string, nodeId: string) =>
    `/maps/${encodeURIComponent(mapId)}?node=${encodeURIComponent(nodeId)}`,
  shareMap: (mapId: string) => `/maps/${encodeURIComponent(mapId)}/share`,
  collaborators: (mapId: string) =>
    `/maps/${encodeURIComponent(mapId)}/collaborators`,
  mapChat: (mapId: string) => `/maps/${encodeURIComponent(mapId)}/chat`,

  /**
   * A service detail page. Public marketing surface, not application surface —
   * which is why it lives in the `(marketing)` group alongside the services
   * index rather than under `/app`.
   */
  service: (slug: string) => `${routes.services}/${encodeURIComponent(slug)}`,
  profile: (handle: string) => `/u/${encodeURIComponent(handle)}`,

  /** Sign-in with a return path, so a guard never loses where you were going. */
  signIn: (returnTo?: string) =>
    returnTo ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : '/sign-in',
  signUp: (returnTo?: string) =>
    returnTo ? `/sign-up?returnTo=${encodeURIComponent(returnTo)}` : '/sign-up',
} as const;

// ------------------------------------------------------------ screen registry

/**
 * All 22 MVP screens. `path` is the route pattern as Next.js sees it.
 *
 * The count is asserted in routes.test.ts. §08 fixed it at 22 deliberately —
 * the reference list of 24 collapsed because three of them are states of one
 * screen and one is a system behaviour. If this list grows, that is a scope
 * change and needs a decision record, not just a new file.
 */
export const screens: readonly (ScreenMeta & { path: string })[] = [
  {
    screen: '01',
    path: routes.entry,
    name: 'Entry transition',
    purpose: 'Brand moment; preload map data',
    phase: 'P3',
    tab: null,
    access: 'public',
    chrome: 'none',
  },
  {
    screen: '02',
    path: routes.map,
    name: 'Community Map',
    purpose: 'The product. Browse the network',
    phase: 'P3',
    tab: 'map',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '03',
    path: `${routes.map}?node=:id`,
    name: 'Node detail',
    purpose: 'Explain a node, offer its actions',
    phase: 'P4',
    tab: 'map',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '04',
    path: routes.tree,
    name: 'Tree view',
    purpose: 'Accessible, scannable equivalent of the map',
    phase: 'P3',
    tab: 'map',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '05',
    path: routes.search,
    name: 'Search',
    purpose: 'Find anything; second navigation model',
    phase: 'P8',
    tab: 'search',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '06',
    path: `${routes.search}?q=:query`,
    name: 'Search results',
    purpose: 'Show matches as list or map',
    phase: 'P8',
    tab: 'search',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '07',
    path: routes.maps,
    name: 'My Maps',
    purpose: 'Own and shared maps',
    phase: 'P6',
    tab: 'maps',
    access: 'authed',
    chrome: 'full',
  },
  {
    screen: '08',
    path: routes.newMap,
    name: 'New map',
    purpose: 'Name it, choose a starting point',
    phase: 'P5',
    tab: 'maps',
    access: 'authed',
    chrome: 'full',
  },
  {
    screen: '09',
    path: '/maps/:mapId',
    name: 'Map editor',
    purpose: 'Build and arrange a map',
    phase: 'P5',
    tab: 'maps',
    access: 'authed',
    // The editor owns the whole viewport; the tab bar would cover the canvas.
    chrome: 'minimal',
  },
  {
    screen: '10',
    path: '/maps/:mapId?node=:nodeId',
    name: 'Node editor',
    purpose: "Set a node's content and behaviour",
    phase: 'P5',
    tab: 'maps',
    access: 'authed',
    chrome: 'minimal',
  },
  {
    screen: '11',
    path: '/maps/:mapId/share',
    name: 'Share map',
    purpose: 'Produce a link with the right exposure',
    phase: 'P7',
    tab: 'maps',
    access: 'authed',
    chrome: 'full',
  },
  {
    screen: '12',
    path: '/maps/:mapId/collaborators',
    name: 'Collaborators',
    purpose: 'Who has access and at what level',
    phase: 'P7',
    tab: 'maps',
    access: 'authed',
    chrome: 'full',
  },
  {
    screen: '13',
    path: '/maps/:mapId/chat',
    name: 'Map chat',
    purpose: 'Coordinate without leaving the map',
    phase: 'P11',
    tab: 'maps',
    access: 'authed',
    chrome: 'full',
  },
  {
    screen: '14',
    path: routes.linkToMindMap,
    name: 'Link-to-Mind-Map',
    purpose: 'URL to generated map',
    phase: 'P9',
    tab: 'map',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '15',
    path: routes.watcher,
    name: 'Page Watcher setup',
    purpose: 'Pick interests',
    phase: 'P10',
    tab: 'map',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '16',
    path: routes.watcherFeed,
    name: 'Page Watcher feed',
    purpose: 'Browse matched community content',
    phase: 'P10',
    tab: 'map',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '17',
    path: '/services/:slug',
    name: 'Service node',
    purpose: 'Sell a service; capture enquiries',
    phase: 'P12',
    tab: 'map',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '18',
    path: '/u/:handle',
    name: 'Profile',
    purpose: 'Identity and public maps',
    phase: 'P6',
    tab: 'you',
    access: 'public',
    chrome: 'full',
  },
  {
    screen: '19',
    path: routes.notifications,
    name: 'Notifications',
    purpose: 'Invites, roles, mentions',
    phase: 'P11',
    tab: 'you',
    access: 'authed',
    chrome: 'full',
  },
  {
    screen: '20',
    path: routes.settings,
    name: 'Settings',
    purpose: 'Account, privacy, appearance',
    phase: 'P6',
    tab: 'you',
    access: 'authed',
    chrome: 'full',
  },
  {
    screen: '21',
    path: routes.moderation,
    name: 'Moderation',
    purpose: 'Review reports; act',
    phase: 'P13',
    tab: 'you',
    access: 'staff',
    chrome: 'full',
  },
  {
    screen: '22',
    path: '/soon/:nodeId',
    name: 'Coming Soon',
    purpose: 'Honest placeholder that captures demand',
    phase: 'P4',
    tab: 'map',
    access: 'public',
    chrome: 'full',
  },
] as const;

export function screenByNumber(screen: ScreenNumber) {
  return screens.find((s) => s.screen === screen);
}

/**
 * Which tab should appear active for a given pathname.
 *
 * Longest-prefix wins, so `/maps/abc/share` activates My Maps rather than
 * matching some shorter route first. Falls back to the Map tab because the
 * map is the product's home base (§critical design principles).
 */
export function activeTabFor(pathname: string): TabId {
  const prefixes: Array<[string, TabId]> = [
    ['/maps', 'maps'],
    // The marketplace sells maps, plugins, agents and people's time. It sits
    // under the Maps tab because everything you take from it lands there.
    ['/marketplace', 'maps'],
    // Collections are views over your own maps, so they light the Maps tab.
    ['/work', 'maps'],
    ['/commerce', 'maps'],
    ['/contacts', 'maps'],
    ['/search', 'search'],
    ['/you', 'you'],
    ['/u/', 'you'],
    ['/notifications', 'you'],
    ['/settings', 'you'],
    ['/admin', 'you'],
    ['/map', 'map'],
    ['/watch', 'map'],
    ['/create', 'map'],
    ['/services', 'map'],
    ['/soon', 'map'],
    ['/n/', 'map'],
  ];

  const match = prefixes
    .filter(([prefix]) => pathname === prefix || pathname.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length)[0];

  return match ? match[1] : 'map';
}

/**
 * Whether a route paints edge to edge, with no padding from the shell.
 *
 * The map is the product interface, not content inside a page — §critical
 * design principles. Padding around it wastes the scarcest resource the
 * design has (canvas area on a phone) and makes the canvas smaller than the
 * viewport, which is visible as a hairline of background at the edges.
 */
export function bleedsFor(pathname: string): boolean {
  if (pathname === routes.map || pathname === routes.tree) return true;
  // The map editor, once P5 builds it.
  if (/^\/maps\/(?!new$)[^/]+$/.test(pathname)) return true;
  return false;
}

/** Chrome mode for a pathname. Editor and entry suppress the tab bar. */
export function chromeFor(pathname: string): ScreenMeta['chrome'] {
  if (pathname === routes.entry) return 'none';
  // /maps/<id> is the editor, but /maps and /maps/new are not.
  if (/^\/maps\/(?!new$)[^/]+$/.test(pathname)) return 'minimal';
  return 'full';
}
