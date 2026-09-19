/**
 * Screen 14 — Link-to-Mind-Map (§12).
 *
 * Import from '@/components/link', not the individual files, for the same
 * reason as the design system: the public surface stays visible in one place.
 */
export { LinkScreen } from './LinkScreen';
export {
  UrlField,
  looksLikeUrl,
  EXAMPLES,
  type UrlPreview,
  type UrlFieldProps,
} from './UrlField';
export { ProgressStages, type ProgressStagesProps } from './ProgressStages';
export { StructurePreview, type StructurePreviewProps } from './StructurePreview';
export { NodeChecklist, type NodeChecklistProps } from './NodeChecklist';
