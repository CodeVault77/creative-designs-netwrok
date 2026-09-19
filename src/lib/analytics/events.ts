/**
 * CDN analytics taxonomy.
 *
 * This is the executable half of the P0 analytics plan (docs/03-analytics-plan.md).
 * Every event the product will ever emit is declared here, typed, before any
 * feature is built. Two reasons this belongs in P0 rather than P14:
 *
 *   1. §24 defines the MVP's success in terms of specific numbers — 3-tap
 *      reach, activation, share rate, Coming Soon interest per dark node.
 *      None of them are measurable unless the events exist when the feature
 *      ships. "Launching without instrumentation" is a High risk in §23.
 *   2. Naming events once, centrally, prevents the usual drift into
 *      `node_click`, `nodeClicked` and `click_node` meaning the same thing.
 *
 * Naming convention: `object_verb_past_tense`, snake_case. The object comes
 * first so events sort into groups alphabetically in any analytics UI.
 *
 * Events marked PHASE Pn are declared now and emitted when that phase lands.
 */

/** Ring-one node families (§03). Kept as a literal union so a typo fails typecheck. */
export type NodeFamily =
  'create' | 'discover' | 'services' | 'people' | 'organise' | 'commerce';

export type NodeStatus = 'active' | 'inactive' | 'coming_soon';

export type MapSurface = 'community' | 'user_map' | 'shared_map' | 'search_result';

/**
 * The full event map: event name -> its payload.
 *
 * A payload of `Record<string, never>` means the event takes no properties.
 */
export interface AnalyticsEventMap {
  // ---------------------------------------------------------------- P3 map
  /** Map became interactive. `ms` measures against the §24 2.5s budget. */
  map_loaded: { surface: MapSurface; node_count: number; ms: number };
  map_panned: { surface: MapSurface };
  map_zoomed: {
    surface: MapSurface;
    scale: number;
    method: 'pinch' | 'scroll' | 'button';
  };
  map_recentred: { surface: MapSurface };
  /** The "visual telescope" (§09). Tracks whether it is used at all. */
  map_layer_stepped: { direction: 'inward' | 'outward'; depth: number };
  map_breadcrumb_used: { depth_from: number; depth_to: number };
  /** Map <-> Tree. High usage means the map is failing someone. */
  map_view_toggled: { to: 'map' | 'tree' };

  // --------------------------------------------------------------- P4 node
  node_selected: {
    node_id: string;
    family: NodeFamily;
    status: NodeStatus;
    depth: number;
    surface: MapSurface;
  };
  node_opened: { node_id: string; family: NodeFamily; depth: number };
  node_expanded: { node_id: string; child_count: number; depth: number };
  node_collapsed: { node_id: string; depth: number };
  node_link_copied: { node_id: string };
  /** §24: the primary funnel metric. Emitted once per session on first arrival. */
  destination_reached: { node_id: string; taps: number; ms_since_load: number };

  // ------------------------------------------------------- P4 Coming Soon
  coming_soon_viewed: { node_id: string; family: NodeFamily };
  /** §24 target: >=10 per dark node in month one. This is the build-order data. */
  coming_soon_interest_registered: { node_id: string; family: NodeFamily };

  // ------------------------------------------------------------- P5 editor
  map_created: {
    source: 'blank' | 'template' | 'link_to_mind_map';
    template_id?: string;
  };
  map_node_added: {
    map_id: string;
    node_type: string;
    method: 'fab' | 'canvas' | 'keyboard';
  };
  map_node_edited: { map_id: string; field: string };
  map_node_deleted: { map_id: string; had_children: boolean };
  map_nodes_connected: { map_id: string; edge_type: 'parent' | 'reference' };
  map_autosaved: { map_id: string; node_count: number };
  map_save_failed: { map_id: string; reason: string };
  /** §24: blank -> 10-node map in under 3 minutes. */
  map_first_share_reached: {
    map_id: string;
    node_count: number;
    ms_since_create: number;
  };

  // ------------------------------------------------------ P6 accounts
  account_signed_up: { method: 'email' | 'oauth' };
  account_signed_in: { method: 'email' | 'oauth' };
  account_signed_out: Record<string, never>;

  // ------------------------------------------------- P7 sharing and roles
  map_shared: {
    map_id: string;
    visibility: 'private' | 'link' | 'public';
    node_viewable: boolean;
  };
  map_visibility_changed: { map_id: string; from: string; to: string };
  collaborator_invited: { map_id: string; role: string };
  collaborator_role_changed: { map_id: string; from: string; to: string };
  collaborator_removed: { map_id: string };

  // ------------------------------------------------------------- P8 search
  search_opened: { from: 'tab' | 'map' | 'keyboard' };
  search_submitted: { query_length: number; filters: string[] };
  search_result_opened: { result_type: string; position: number };
  search_view_toggled: { to: 'list' | 'map' };
  search_returned_to_map: { restored: boolean };
  search_empty: { query_length: number };

  // ---------------------------------------------- P9 Link-to-Mind-Map
  link_to_map_started: { source: 'ring_node' | 'editor' | 'search_empty' };
  link_to_map_url_validated: { ok: boolean; ms: number };
  link_to_map_generated: { node_count: number; depth: number; ms: number };
  /** Distinguishes the five failure modes in §12 so we can fix the common one. */
  link_to_map_failed: {
    reason: 'unreachable' | 'robots' | 'paywall' | 'thin' | 'model_timeout';
  };
  link_to_map_saved: { map_id: string; nodes_kept: number; nodes_dropped: number };

  // ------------------------------------------------------ P10 Page Watcher
  page_watcher_opened: Record<string, never>;
  page_watcher_interests_set: { count: number };
  page_watcher_item_opened: { item_id: string; position: number };
  page_watcher_item_saved: { item_id: string };
  page_watcher_node_created: { item_id: string; map_id: string };

  // ---------------------------------------------------- P11 collaboration
  map_message_sent: { map_id: string; has_node_mention: boolean };
  notification_opened: { type: string };
  invite_accepted: { map_id: string; role: string };

  // -------------------------------------------- Phase 0 marketing site
  /**
   * The public site (roadmap §23). Two funnels have to be readable from these:
   * landing → newsletter, and landing → services → request → success.
   *
   * No personal data in any property — no email addresses, no names, no free
   * text. Enums, ids and counts only, which is the §03 rule and is also what
   * the ingestion endpoint strips to.
   */
  marketing_page_viewed: { page: string };
  marketing_cta_clicked: { cta_id: string; section: string };
  newsletter_subscribe_started: { source: string };
  newsletter_subscribed: { source: string };
  newsletter_subscribe_failed: { reason: string };
  whatsapp_clicked: { location: string };
  email_clicked: { location: string };
  service_request_started: Record<string, never>;
  service_request_submitted: { service_id: string; budget_range: string };
  service_request_failed: { reason: string };

  // ------------------------------------------------------- P12 revenue
  service_node_viewed: { service_id: string };
  /** §24 target: >=3 in month one. The only event tied to revenue. */
  service_enquiry_submitted: { service_id: string };

  // ------------------------------------------------------- P13 trust
  content_reported: { target_type: 'node' | 'map' | 'message' | 'user' };
  moderation_action_taken: { action: string; target_type: string };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

/**
 * Every declared event name, for the taxonomy test and for the docs table.
 * Kept in sync with AnalyticsEventMap by a compile-time exhaustiveness check.
 */
export const ANALYTICS_EVENTS = [
  'map_loaded',
  'map_panned',
  'map_zoomed',
  'map_recentred',
  'map_layer_stepped',
  'map_breadcrumb_used',
  'map_view_toggled',
  'node_selected',
  'node_opened',
  'node_expanded',
  'node_collapsed',
  'node_link_copied',
  'destination_reached',
  'coming_soon_viewed',
  'coming_soon_interest_registered',
  'map_created',
  'map_node_added',
  'map_node_edited',
  'map_node_deleted',
  'map_nodes_connected',
  'map_autosaved',
  'map_save_failed',
  'map_first_share_reached',
  'account_signed_up',
  'account_signed_in',
  'account_signed_out',
  'map_shared',
  'map_visibility_changed',
  'collaborator_invited',
  'collaborator_role_changed',
  'collaborator_removed',
  'search_opened',
  'search_submitted',
  'search_result_opened',
  'search_view_toggled',
  'search_returned_to_map',
  'search_empty',
  'link_to_map_started',
  'link_to_map_url_validated',
  'link_to_map_generated',
  'link_to_map_failed',
  'link_to_map_saved',
  'page_watcher_opened',
  'page_watcher_interests_set',
  'page_watcher_item_opened',
  'page_watcher_item_saved',
  'page_watcher_node_created',
  'map_message_sent',
  'notification_opened',
  'invite_accepted',
  'marketing_page_viewed',
  'marketing_cta_clicked',
  'newsletter_subscribe_started',
  'newsletter_subscribed',
  'newsletter_subscribe_failed',
  'whatsapp_clicked',
  'email_clicked',
  'service_request_started',
  'service_request_submitted',
  'service_request_failed',
  'service_node_viewed',
  'service_enquiry_submitted',
  'content_reported',
  'moderation_action_taken',
] as const satisfies readonly AnalyticsEventName[];

/**
 * Compile-time guard: if an event is added to AnalyticsEventMap but not to
 * ANALYTICS_EVENTS, this line fails to typecheck.
 */
type _AllEventsListed =
  Exclude<AnalyticsEventName, (typeof ANALYTICS_EVENTS)[number]> extends never
    ? true
    : [
        'Missing from ANALYTICS_EVENTS:',
        Exclude<AnalyticsEventName, (typeof ANALYTICS_EVENTS)[number]>,
      ];

export const _allEventsListed: _AllEventsListed = true;
