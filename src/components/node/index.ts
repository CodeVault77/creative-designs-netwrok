/**
 * P4 node interaction.
 *
 * NodeDetailContainer is the entry point — it picks the presentation. The
 * pieces are exported for Storybook and for the Coming Soon page, which
 * composes ComingSoonBlock directly.
 *
 * §18: DetailSheet and InspectorPanel are two PRESENTATIONS of one component.
 * If you ever find yourself adding a third sheet, the thing you actually need
 * is probably a fifth mode in NodeDetailBody.
 */
export { NodeDetailContainer } from './NodeDetailContainer';
export { NodeDetailBody, type NodeDetailBodyProps } from './NodeDetailBody';
export { DetailSheet, type DetailSheetProps, DETENT } from './DetailSheet';
export { InspectorPanel, type InspectorPanelProps } from './InspectorPanel';
export { ActionRow, type ActionRowProps } from './ActionRow';
export { ComingSoonBlock } from './ComingSoonBlock';
export { ComingSoonScreen } from './ComingSoonScreen';
export { NodeHeader, type NodeHeaderProps } from './NodeHeader';
export { MetaList } from './MetaList';
