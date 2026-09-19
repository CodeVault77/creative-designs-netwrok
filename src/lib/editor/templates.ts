import { createDraft, newNodeId } from './draft';
import type { DraftNode, MapDraft } from './types';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The five templates from §14: Project, Research, Business, Learning, Personal.
 *
 * They exist to serve the §20 acceptance criterion — blank to a ten-node map
 * in under three minutes, unaided. A blank canvas is the slowest possible
 * start: the user has to invent both the structure and the content. A template
 * supplies the structure so they only have to supply the content, and the
 * branches are deliberately generic enough to rename rather than delete.
 *
 * Blank stays the default, because a template that does not fit is worse than
 * none — someone editing a template into shape does more work than someone
 * starting empty.
 */

export interface Template {
  id: string;
  name: string;
  description: string;
  family: FamilyName;
  /** Ring-one branch titles. Ring two is left to the user. */
  branches: string[];
  /** Set when the template is not built yet — §08 screen 08 Coming Soon state. */
  soon?: boolean;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Just a centre node. Build outward however you like.',
    family: 'create',
    branches: [],
  },
  {
    id: 'project',
    name: 'Project',
    description: 'Goals, tasks, people, timeline, risks.',
    family: 'organise',
    branches: ['Goals', 'Tasks', 'People', 'Timeline', 'Risks'],
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Questions, sources, findings, gaps, next steps.',
    family: 'discover',
    branches: ['Questions', 'Sources', 'Findings', 'Gaps', 'Next steps'],
  },
  {
    id: 'business',
    name: 'Business',
    description: 'Customers, offer, channels, costs, revenue.',
    family: 'commerce',
    branches: ['Customers', 'Offer', 'Channels', 'Costs', 'Revenue'],
  },
  {
    id: 'learning',
    name: 'Learning',
    description: 'Topics, resources, practice, questions, progress.',
    family: 'create',
    branches: ['Topics', 'Resources', 'Practice', 'Questions', 'Progress'],
  },
  {
    id: 'personal',
    name: 'Personal',
    description: 'Now, next, someday, people, notes.',
    family: 'people',
    branches: ['Now', 'Next', 'Someday', 'People', 'Notes'],
  },
] as const;

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Builds a draft from a template.
 *
 * Branch titles are filled in but left otherwise empty, so the map is
 * immediately editable rather than something to read. Every node is a
 * `topic` — type is a decision the user makes when they have content.
 */
export function draftFromTemplate(
  mapId: string,
  title: string,
  templateId: string,
): MapDraft {
  const template = templateById(templateId) ?? TEMPLATES[0]!;
  const draft = createDraft(mapId, title, template.family);

  if (template.branches.length === 0) return draft;

  const nodes: Record<string, DraftNode> = { ...draft.nodes };

  template.branches.forEach((branchTitle, index) => {
    const id = newNodeId();
    nodes[id] = {
      id,
      map_id: mapId,
      parent_id: draft.rootId,
      slot: index,
      title: branchTitle,
      family: template.family,
      type: 'topic',
      status: 'active',
      visibility: 'inherit',
      weight: 0.5,
    };
  });

  return { ...draft, nodes, dirty: Object.keys(nodes) };
}
