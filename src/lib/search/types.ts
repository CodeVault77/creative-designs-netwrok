import type { FamilyName } from '@/lib/styles/tokens.generated';
import type { NodeStatus, NodeType } from '@/lib/map/types';

/** Result groups from §11: Nodes · Maps · People · Pages. */
export type ResultGroup = 'nodes' | 'maps' | 'people' | 'pages';

export interface SearchResult {
  group: ResultGroup;
  id: string;
  title: string;
  /** One-line snippet with the matched terms marked. Never the full body. */
  snippet?: string;
  /** Root → this result. §11: "path is what makes a result trustworthy." */
  path: string[];
  family: FamilyName;
  status: NodeStatus;
  type?: NodeType;
  href: string;
  /** Which map it belongs to, for the result map's grouping arcs. */
  mapId?: string;
  parentId?: string | null;
  /** Lower is better. Comes from FTS ranking, then group weighting. */
  rank: number;
}

export interface SearchFilters {
  /** Empty means all families. */
  families: FamilyName[];
  types: NodeType[];
  /** §11: excludes Coming Soon, "which will otherwise pollute early search". */
  liveOnly: boolean;
  group?: ResultGroup | 'all';
}

export const EMPTY_FILTERS: SearchFilters = {
  families: [],
  types: [],
  liveOnly: false,
  group: 'all',
};

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  /** Grouped and capped for the suggestion dropdown. */
  grouped: Record<ResultGroup, SearchResult[]>;
  total: number;
  /** Server-side timing, so the §20 budget can be measured rather than assumed. */
  ms: number;
}

/** §11 caps suggestions at 4 per group. */
export const SUGGESTIONS_PER_GROUP = 4;
export const MAX_RESULTS = 60;
/** §11: suggestions appear after 2 characters. */
export const MIN_QUERY_LENGTH = 2;
/** §11: debounced 180ms. */
export const SUGGEST_DEBOUNCE_MS = 180;

export const GROUP_LABELS: Record<ResultGroup, string> = {
  nodes: 'Nodes',
  maps: 'Maps',
  people: 'People',
  pages: 'Pages',
};
