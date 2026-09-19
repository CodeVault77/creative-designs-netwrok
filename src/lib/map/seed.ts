import { buildGraph } from './geometry';
import { routes, buildRoute } from '@/lib/routes';
import type { MapGraph, MapNode } from './types';

/**
 * Community Map seed data.
 *
 * Ring one is the re-cut from ADR-0003 — destinations, not platform features —
 * and the live/Coming Soon split is ADR-0001: five live, seven dark, all
 * twelve rendered. The scale of the network is the pitch, so the dark nodes
 * are present and honest rather than absent.
 *
 * Slots are FIXED and assigned here once. Slot 0 is twelve o'clock. Changing
 * a slot moves a node for every user who has learned where it is, so treat
 * these numbers as a published interface, not as configuration.
 *
 * P6 moves this into the database. The shape stays identical.
 */

const MAP_ID = 'community';
const ROOT_ID = 'cdn-root';

function node(
  partial: Omit<MapNode, 'map_id' | 'visibility'> & {
    visibility?: MapNode['visibility'];
  },
): MapNode {
  return { map_id: MAP_ID, visibility: 'public', ...partial };
}

const root: MapNode = node({
  id: ROOT_ID,
  parent_id: null,
  slot: 0,
  title: 'Creative Design Networks',
  description: 'The central node. God gives the vision. We build the connections.',
  family: 'discover',
  type: 'topic',
  status: 'active',
  weight: 1,
  /**
   * The community map's root IS the brand, so it is drawn as the full lockup
   * rather than as a title in a circle — the same treatment as the entry
   * screen, so arriving at the map feels like the same place.
   *
   * Flagged on the NODE rather than assumed by the renderer from an id,
   * because it is a property of this one map. Every other root — a user's own
   * map, a shared map — draws the ordinary way, and should: "Studio Relaunch"
   * set in three brand colours would be nonsense.
   */
  payload: { wordmark: true, tagline: 'THE CENTRAL NODE' },
});

/** Ring one — twelve destinations, five live (ADR-0001). */
const ringOne: MapNode[] = [
  node({
    id: 'mind-mapping',
    parent_id: ROOT_ID,
    slot: 0,
    title: 'Mind Mapping',
    icon: 'map',
    description: 'Map ideas, projects and everything. Build your own network.',
    family: 'create',
    type: 'topic',
    status: 'active',
    weight: 1,
    href: routes.maps,
  }),
  node({
    id: 'link-to-mind-map',
    parent_id: ROOT_ID,
    slot: 1,
    title: 'Link-to-Mind-Map',
    icon: 'link',
    description: 'Paste any public article and get a structured, interactive map.',
    family: 'create',
    type: 'topic',
    status: 'active',
    weight: 0.9,
    href: routes.linkToMindMap,
  }),
  node({
    id: 'ai-tools',
    parent_id: ROOT_ID,
    slot: 2,
    title: 'AI Tools',
    icon: 'spark',
    description: 'Assistive tools for building, summarising and expanding maps.',
    family: 'create',
    type: 'topic',
    status: 'coming_soon',
    weight: 0.5,
  }),
  node({
    id: 'commerce',
    parent_id: ROOT_ID,
    slot: 3,
    title: 'Commerce & Payments',
    icon: 'card',
    /*
     * The description was "Wallets, payments, invoicing and reports", which
     * promised more than shipped. Narrowed to what the node actually opens:
     * products, orders and invoices as node types, collected across maps.
     * A live node whose description overshoots is a Coming Soon promise
     * wearing a live badge.
     */
    description: 'Track products, orders and invoices across your maps.',
    family: 'commerce',
    type: 'topic',
    status: 'active',
    weight: 0.4,
    href: routes.commerce,
  }),
  node({
    id: 'tasks-projects',
    parent_id: ROOT_ID,
    slot: 4,
    title: 'Tasks & Projects',
    icon: 'cal',
    description: 'Plan, schedule and complete work across your maps.',
    family: 'organise',
    type: 'topic',
    status: 'active',
    weight: 0.45,
    href: routes.work,
  }),
  node({
    id: 'active-projects',
    parent_id: ROOT_ID,
    slot: 5,
    title: 'Active Projects',
    icon: 'layers',
    description: 'What the network is building right now.',
    family: 'services',
    type: 'topic',
    status: 'active',
    weight: 0.7,
  }),
  node({
    id: 'build-with-us',
    parent_id: ROOT_ID,
    slot: 6,
    title: 'Build With Us',
    icon: 'code',
    description: 'Full-stack, web, mobile and game development from the CDN team.',
    family: 'services',
    type: 'service',
    status: 'active',
    weight: 0.85,
    href: buildRoute.service('build-with-us'),
  }),
  node({
    id: 'freelance',
    parent_id: ROOT_ID,
    slot: 7,
    title: 'Freelance & Marketplace',
    icon: 'bag',
    description: 'Hire and be hired across the network.',
    family: 'services',
    type: 'topic',
    /*
     * Went live when the marketplace shipped: four catalogues on one
     * framework, with the freelancing one raising an enquiry straight into the
     * services pipeline.
     *
     * It is live because it has somewhere to go, which is the bar the seed
     * tests enforce — not because library code exists behind it. Six of its
     * former neighbours still say SOON for exactly that reason: the node types
     * for commerce, tasks and CRM are real and usable inside the map editor,
     * but none of them has a destination of its own yet, and a node that
     * opens nothing is a promise rather than a feature.
     */
    status: 'active',
    weight: 0.55,
    href: routes.marketplace,
  }),
  node({
    id: 'page-watcher',
    parent_id: ROOT_ID,
    slot: 8,
    title: 'Page Watcher',
    icon: 'eye',
    description: 'Pick your interests and browse what the community is publishing.',
    family: 'discover',
    type: 'page',
    status: 'active',
    weight: 0.75,
    href: routes.watcher,
  }),
  node({
    id: 'ideas-innovation',
    parent_id: ROOT_ID,
    slot: 9,
    title: 'Ideas & Innovation',
    icon: 'bulb',
    description: 'Capture, organise and expand ideas with others.',
    family: 'discover',
    type: 'topic',
    status: 'coming_soon',
    weight: 0.5,
  }),
  node({
    id: 'people-networks',
    parent_id: ROOT_ID,
    slot: 10,
    title: 'People & Networks',
    icon: 'users',
    description: 'Connect, collaborate and grow together.',
    family: 'people',
    type: 'topic',
    status: 'coming_soon',
    weight: 0.6,
  }),
  node({
    id: 'partners',
    parent_id: ROOT_ID,
    slot: 11,
    title: 'Partners & Sponsors',
    icon: 'heart',
    description: 'Organisations building alongside the network.',
    family: 'people',
    type: 'topic',
    status: 'coming_soon',
    weight: 0.35,
  }),
];

/**
 * Ring two for the live branches only.
 *
 * A Coming Soon node with children would be dishonest — expanding it would
 * promise structure behind something that does not exist yet.
 */
const ringTwo: MapNode[] = [
  // Mind Mapping
  ...['Start a blank map', 'Templates', 'My Maps', 'Shared with me', 'Recent'].map(
    (title, i) =>
      node({
        id: `mm-${i}`,
        parent_id: 'mind-mapping',
        slot: i,
        title,
        icon: ['note', 'file', 'grid', 'users', 'cal'][i],
        family: 'create',
        type: 'topic',
        status: 'active',
        weight: 0.5 - i * 0.05,
        href: routes.maps,
      }),
  ),

  // Link-to-Mind-Map
  ...['Paste a URL', 'How it works', 'Examples'].map((title, i) =>
    node({
      id: `ltm-${i}`,
      parent_id: 'link-to-mind-map',
      slot: i,
      title,
      icon: ['link', 'connect', 'note'][i],
      family: 'create',
      type: 'topic',
      status: 'active',
      weight: 0.5,
      href: routes.linkToMindMap,
    }),
  ),

  // Page Watcher
  ...['Choose interests', 'Latest', 'Most saved'].map((title, i) =>
    node({
      id: `pw-${i}`,
      parent_id: 'page-watcher',
      slot: i,
      title,
      icon: ['eye', 'spark', 'heart'][i],
      family: 'discover',
      type: 'page',
      status: 'active',
      weight: 0.5,
      href: routes.watcher,
    }),
  ),

  // Build With Us — the revenue branch (ADR-0005).
  ...[
    'Full-stack development',
    'Web applications',
    'Mobile applications',
    'Game development',
    'Start a project',
  ].map((title, i) =>
    node({
      id: `bwu-${i}`,
      parent_id: 'build-with-us',
      slot: i,
      title,
      icon: ['code', 'grid', 'connect', 'spark', 'bag'][i],
      family: 'services',
      type: 'service',
      status: 'active',
      weight: 0.6,
      href: buildRoute.service('build-with-us'),
    }),
  ),

  // Active Projects
  ...['Creative Design Networks', 'Partner builds', 'Case studies'].map(
    (title, i) =>
      node({
        id: `ap-${i}`,
        parent_id: 'active-projects',
        slot: i,
        title,
        icon: ['layers', 'users', 'file'][i],
        family: 'services',
        type: 'topic',
        status: 'active',
        weight: 0.5,
      }),
  ),
];

export const COMMUNITY_NODES: readonly MapNode[] = [root, ...ringOne, ...ringTwo];

export function communityMap(): MapGraph {
  return buildGraph(MAP_ID, 'Community Map', ROOT_ID, COMMUNITY_NODES);
}

/**
 * A synthetic map for performance testing.
 *
 * §24 requires 60fps with 150 nodes on a mid-range Android. A generator lets
 * that be measured against a known node count rather than against whatever
 * the seed happens to contain today.
 */
export function syntheticMap(nodeCount: number): MapGraph {
  const families = [
    'create',
    'discover',
    'services',
    'people',
    'organise',
    'commerce',
  ] as const;
  const nodes: MapNode[] = [
    node({
      id: 'root',
      parent_id: null,
      slot: 0,
      title: 'Synthetic',
      family: 'discover',
      type: 'topic',
      status: 'active',
      weight: 1,
    }),
  ];

  const ringOneCount = Math.min(12, Math.max(1, Math.floor(nodeCount / 12)));

  for (let i = 0; i < ringOneCount; i++) {
    nodes.push(
      node({
        id: `r1-${i}`,
        parent_id: 'root',
        slot: i,
        title: `Branch ${i + 1}`,
        family: families[i % families.length]!,
        type: 'topic',
        status: 'active',
        weight: Math.random(),
      }),
    );
  }

  let created = nodes.length;
  let parentIndex = 0;
  while (created < nodeCount) {
    const parent = `r1-${parentIndex % ringOneCount}`;
    const slot = Math.floor(created / ringOneCount);
    nodes.push(
      node({
        id: `r2-${created}`,
        parent_id: parent,
        slot,
        title: `Leaf ${created}`,
        family: families[created % families.length]!,
        type: 'note',
        status: created % 7 === 0 ? 'coming_soon' : 'active',
        weight: Math.random(),
      }),
    );
    created++;
    parentIndex++;
  }

  return buildGraph('synthetic', 'Synthetic', 'root', nodes);
}
