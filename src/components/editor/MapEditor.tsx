'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { MapCanvas, type MapCameraHandle } from '@/components/map/MapCanvas';
import { MapControls } from '@/components/map/MapControls';
import { DetailSheet } from '@/components/node/DetailSheet';
import { InspectorPanel } from '@/components/node/InspectorPanel';
import { EditToolbar, EDIT_TOOLBAR_HEIGHT } from './EditToolbar';
import { NodeEditor } from './NodeEditor';
import { UndoBar } from './UndoBar';
import { useEditor } from '@/lib/editor/useEditor';
import {
  addNodeCommand,
  deleteNodeCommand,
  descendantsOf,
  moveNodeCommand,
  nextFreeSlot,
  updateMapCommand,
  updateNodeCommand,
} from '@/lib/editor/draft';
import { useIsRailLayout } from '@/lib/useBreakpoint';
import { useMapChannel } from '@/lib/collab/useMapChannel';
import { ActivityPanel, ChatPanel, PresenceStack } from '@/components/collab';
import { Button } from '@/components/ui';
import { MAX_SCALE, MIN_SCALE } from '@/lib/map/camera';
import { track } from '@/lib/analytics';
import type { LayoutResult } from '@/lib/map/layout';
import type { DraftNode, MapDraft } from '@/lib/editor/types';
import type { PlacedNode } from '@/lib/map/types';

/**
 * Screen 09 (map editor) and screen 10 (node editor) as its panel.
 *
 * The same MapCanvas as the Community Map, with `editable` on. §14: "The
 * editor must feel like the same world as the Community Map. Same canvas
 * component, same node visuals, edit affordances layered on top."
 */

const Frame = styled.div`
  position: relative;
  width: 100%;
  height: calc(100dvh - 56px);
`;

const CanvasLayer = styled.div`
  position: absolute;
  top: ${EDIT_TOOLBAR_HEIGHT}px;
  left: 0;
  right: 0;
  bottom: 0;
`;

/**
 * §14: "Never present an empty canvas — the centre node is the prompt."
 *
 * A blank canvas asks the user to invent both structure and content. This
 * points at the one thing to do next.
 */
const EmptyPrompt = styled.div`
  position: absolute;
  left: 50%;
  bottom: calc(var(--space-16) + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: var(--z-mapControls);

  padding: var(--space-2) var(--space-4);
  background: rgba(13, 14, 23, 0.86);
  border: 1px dashed var(--ground-border);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(12px);

  color: var(--ground-muted);
  font-size: var(--text-label);
  text-align: center;
  pointer-events: none;

  /*
   * Capped so it cannot reach the FAB or the save pill.
   *
   * It is centred on the full width, so the limit has to be symmetrical: 56px
   * (the FAB) plus a gap is reserved on BOTH sides and the pill uses what is
   * left. With nowrap and no cap it ran to roughly 290px on a 390px phone and
   * slid under whatever shared its z-index, so which one won was down to DOM
   * order rather than intent.
   *
   * Wrapping rather than truncating: this is the only instruction on an empty
   * editor, and half of it is no use to anyone.
   */
  max-width: calc(100% - 2 * (56px + var(--space-6)));
`;

/**
 * Sits ABOVE the zoom column, not beside it.
 *
 * Both are bottom-right and both shift left to clear the inspector, so at the
 * same vertical offset the + landed exactly on top of Recentre. Stacking them
 * keeps the primary action thumb-reachable without burying a map control
 * under it.
 *
 * 156px = three 44px controls plus their two 8px gaps, then a gap of its own.
 */
const Fab = styled.button`
  position: absolute;
  right: var(--space-3);
  /*
   * The bottom-right corner, as the design canvas places it.
   *
   * It used to be pushed 156px up to clear the zoom column, which put an
   * identical "+" glyph 8px below it — two plus buttons in a stack, one adding
   * a node and one zooming. The zoom column is vertically centred now, so the
   * corner is free and the FAB can sit where a FAB belongs.
   */
  bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-mapControls);

  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;

  background: ${({ theme }) => theme.tokens.familyRamp[theme.family].wash};
  border: 1.5px solid ${({ theme }) => theme.tokens.familyRamp[theme.family].core};
  border-radius: var(--radius-circle);
  box-shadow: ${({ theme }) => theme.tokens.glow[theme.family][2]};
  color: var(--ground-ink);
  cursor: pointer;

  &:active {
    transform: translateY(1px);
  }
`;

/**
 * §15 collaboration, layered onto the editor rather than built beside it.
 *
 * Chat, presence and the soft lock all hang off ONE channel hook, so there is
 * a single connection per open map — three features each opening their own
 * stream is exactly the "realtime cost" §20 warns about.
 */
const ChatDock = styled.div`
  position: absolute;
  top: ${EDIT_TOOLBAR_HEIGHT}px;
  right: 0;
  bottom: 0;
  width: 340px;
  z-index: 3;

  /* §15: docked right on desktop, a bottom sheet on mobile. */
  @media (max-width: 900px) {
    left: 0;
    width: auto;
    top: auto;
    height: 60dvh;
  }
`;

const CollabBar = styled.div`
  position: absolute;
  top: calc(${EDIT_TOOLBAR_HEIGHT}px + var(--space-2));
  left: var(--space-3);
  z-index: 3;

  display: flex;
  align-items: center;
  gap: var(--space-2);

  padding: var(--space-1) var(--space-2);
  background: rgba(13, 14, 23, 0.82);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(12px);
`;

const EditingNote = styled.span`
  font-size: var(--text-caption);
  color: var(--color-warning);
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const LockNote = styled.p`
  margin: 0 0 var(--space-2);
  padding: var(--space-2);
  background: var(--ground-raised);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-chip);
  font-size: var(--text-caption);
  color: var(--ground-ink);
`;

export interface MapEditorProps {
  initial: MapDraft;
  /** §08 screen 09: a viewer gets read-only chrome with edit tools absent. */
  readOnly?: boolean;
  /** The signed-in viewer. Empty when signed out, which disables the channel. */
  selfId?: string;
  /** §15: a Viewer may read the thread but not post. */
  canChat?: boolean;
}

export function MapEditor({
  initial,
  readOnly = false,
  selfId = '',
  canChat = true,
}: MapEditorProps) {
  const editor = useEditor(initial);
  const channel = useMapChannel(initial.id, Boolean(selfId));
  const [chatOpen, setChatOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [lockNote, setLockNote] = useState<string | null>(null);
  const isDesktop = useIsRailLayout();
  const cameraRef = useRef<MapCameraHandle | null>(null);

  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [undoAction, setUndoAction] = useState<{
    id: number;
    label: string;
  } | null>(null);
  const undoSeq = useRef(0);

  const { draft, graph, selectedId, run, commit } = editor;
  const selected = selectedId ? draft.nodes[selectedId] : undefined;

  /**
   * Selection is what presence and the soft lock both hang off.
   *
   * §15: "a coloured ring on nodes another person has selected", and "a node
   * being edited by someone else shows their avatar ... and your edit is
   * refused with 'Sam is editing this.'" Both follow from the selected node,
   * so this is the one place that has to be right.
   */
  useEffect(() => {
    channel.setSelected(selectedId);
    setLockNote(null);

    if (!selectedId || readOnly || !selfId) return;

    let cancelled = false;
    void channel.lock(selectedId).then((refusal) => {
      if (!cancelled) setLockNote(refusal);
    });

    /**
     * The lease is renewed while the node stays selected. Half the TTL, so a
     * single dropped request does not hand the node to someone else mid-edit.
     */
    const renew = setInterval(() => {
      void channel.lock(selectedId);
    }, 12_000);

    return () => {
      cancelled = true;
      clearInterval(renew);
      // Released on deselect rather than left to expire, so the next person
      // is not made to wait out a lease nobody is using.
      channel.unlock(selectedId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, readOnly, selfId]);

  /**
   * Who is holding what, right now.
   *
   * §15 wants this as "a coloured ring on nodes another person has selected".
   * That needs a renderer change, so for now it is surfaced as text in the
   * collaboration bar — which carries the same information and, unlike a ring,
   * is readable without seeing the colour. The ring is recorded as a gap in
   * docs/16-collaboration.md.
   */
  const othersEditing = useMemo(
    () =>
      channel.locks
        .filter((lock) => lock.userId !== selfId)
        .map((lock) => ({
          name: lock.name,
          title: draft.nodes[lock.nodeId]?.title || 'a node',
        })),
    [channel.locks, selfId, draft.nodes],
  );

  const mentionNodes = useMemo(
    () =>
      Object.values(draft.nodes).map((node) => ({
        id: node.id,
        title: node.title || 'Untitled',
      })),
    [draft.nodes],
  );

  const nodeCount = Object.keys(draft.nodes).length;
  const isEmpty = nodeCount <= 1;

  const createdAt = useRef(Date.now());
  const firstShareTracked = useRef(false);

  // §24: blank → 10-node map in under 3 minutes. Emitted once, when the map
  // first reaches a size worth sharing, carrying the elapsed time.
  useEffect(() => {
    if (firstShareTracked.current || nodeCount < 10) return;
    firstShareTracked.current = true;
    track('map_first_share_reached', {
      map_id: draft.id,
      node_count: nodeCount,
      ms_since_create: Date.now() - createdAt.current,
    });
  }, [nodeCount, draft.id]);

  // ------------------------------------------------------------------ actions

  const addNode = useCallback(
    (parentId: string, method: 'fab' | 'canvas' | 'keyboard') => {
      const command = addNodeCommand(draft, parentId);
      run(command);
      track('map_node_added', { map_id: draft.id, node_type: 'topic', method });
    },
    [draft, run],
  );

  /**
   * Add a SIBLING of the selection — what + and Enter do.
   *
   * Focus follows each new node, so adding a child of the selection every time
   * builds a nine-deep chain from nine presses. Almost nobody wants that: a
   * map is usually a root with branches, and the common motion is "another
   * one at this level".
   *
   * So the two gestures split the way every mind-map editor splits them, and
   * the way §14 implies with "select parent → Tab":
   *
   *   +  /  Enter   sibling — another one alongside
   *   Tab           child   — go a level deeper
   */
  const addSibling = useCallback(
    (method: 'fab' | 'keyboard') => {
      const selected = selectedId ? draft.nodes[selectedId] : undefined;
      const parentId =
        selected && selected.id !== draft.rootId
          ? (selected.parent_id ?? draft.rootId)
          : draft.rootId;
      addNode(parentId, method);
    },
    [draft, selectedId, addNode],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const command = deleteNodeCommand(draft, nodeId);
      if (!command) return;

      const count = command.kind === 'delete_nodes' ? command.nodes.length : 1;
      run(command);

      undoSeq.current += 1;
      setUndoAction({
        id: undoSeq.current,
        label: count > 1 ? `${count} nodes deleted` : 'Node deleted',
      });

      track('map_node_deleted', { map_id: draft.id, had_children: count > 1 });
    },
    [draft, run],
  );

  const updateField = useCallback(
    (field: keyof DraftNode, value: unknown) => {
      if (!selectedId) return;
      run(updateNodeCommand(draft, selectedId, field, value));
      track('map_node_edited', { map_id: draft.id, field: String(field) });
    },
    [draft, selectedId, run],
  );

  /**
   * Drop handling.
   *
   * Dropped on another node → reparent. Dropped on empty canvas → keep the
   * parent and take the next free slot, or hold a free position if Alt was
   * held. `moveNodeCommand` refuses a drop that would make a node its own
   * descendant, so an accidental drag into a child cannot detach the subtree.
   */
  const handleDrop = useCallback(
    (
      nodeId: string,
      drop: { targetId: string | null; freeX?: number; freeY?: number },
    ) => {
      const command = moveNodeCommand(draft, nodeId, {
        ...(drop.targetId
          ? { parentId: drop.targetId, slot: nextFreeSlot(draft, drop.targetId) }
          : {}),
        ...(drop.freeX !== undefined
          ? { freeX: drop.freeX, freeY: drop.freeY }
          : {}),
      });

      if (!command) return;
      run(command);

      if (drop.targetId) {
        track('map_nodes_connected', { map_id: draft.id, edge_type: 'parent' });
      }
    },
    [draft, run],
  );

  // ----------------------------------------------------------------- keyboard

  useEffect(() => {
    if (readOnly) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      // §14: "select parent → Tab" adds a child. Only outside a field, where
      // Tab must keep meaning "next control".
      // Tab goes deeper; Enter stays at the same level. Only outside a field,
      // where both keys must keep their normal meaning.
      if (event.key === 'Tab' && !inField && selectedId) {
        event.preventDefault();
        addNode(selectedId, 'keyboard');
        return;
      }

      if (event.key === 'Enter' && !inField) {
        event.preventDefault();
        addSibling('keyboard');
        return;
      }

      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !inField &&
        selectedId
      ) {
        event.preventDefault();
        deleteNode(selectedId);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, addNode, addSibling, deleteNode, readOnly]);

  // ------------------------------------------------------------------- render

  const descendantCount = useMemo(
    () => (selectedId ? descendantsOf(draft, selectedId).length : 0),
    [draft, selectedId],
  );

  /**
   * The editor always shows the whole map.
   *
   * Collapsing is a reading affordance for a network you did not build. While
   * editing, a hidden branch is a branch you forget you have — and the node
   * you cannot see is the one you accidentally duplicate.
   */
  const allExpanded = useMemo(
    () => new Set(Object.keys(draft.nodes)),
    [draft.nodes],
  );

  const panel = selected ? (
    <>
      {/*
        §15's exact words. Shown ABOVE the fields rather than as a toast,
        because a toast is gone by the time someone starts typing into a node
        their edit will be refused on.
      */}
      {lockNote && <LockNote role="status">{lockNote}</LockNote>}
      <NodeEditor
        node={selected}
        descendantCount={descendantCount}
        isRoot={selected.id === draft.rootId}
        onChange={updateField}
        onCommit={commit}
        onDelete={() => deleteNode(selected.id)}
        readOnly={readOnly || Boolean(lockNote)}
      />
    </>
  ) : null;

  const currentScale = layout?.scale ?? 1;

  return (
    <Frame>
      <EditToolbar
        title={draft.title}
        onTitleChange={(title) => run(updateMapCommand(draft, 'title', title))}
        onTitleCommit={commit}
        status={editor.status}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onRetry={
          editor.status === 'conflict' ? editor.reloadFromServer : editor.retry
        }
        readOnly={readOnly}
      />

      <CanvasLayer>
        <MapCanvas
          graph={graph}
          expandedIds={allExpanded}
          focus={NO_FOCUS}
          centreId={draft.rootId}
          selectedId={selectedId}
          editable={!readOnly}
          onSelect={(node: PlacedNode | null) =>
            editor.select(node?.node.id ?? null)
          }
          onExpand={() => {}}
          onOpen={(node) => editor.select(node.node.id)}
          onNodeDrop={handleDrop}
          onLayout={setLayout}
          cameraRef={cameraRef}
        />
      </CanvasLayer>

      {isEmpty && !readOnly && (
        <EmptyPrompt>Add your first branch — tap +, or press Tab</EmptyPrompt>
      )}

      <MapControls
        canZoomIn={currentScale < MAX_SCALE}
        canZoomOut={currentScale > MIN_SCALE}
        onZoomIn={() => cameraRef.current?.zoomBy(1.4)}
        onZoomOut={() => cameraRef.current?.zoomBy(1 / 1.4)}
        onRecentre={() => cameraRef.current?.recentre()}
        insetRight={isDesktop && selected ? 360 : 0}
      />

      {!readOnly && (
        <Fab
          onClick={() => addSibling('fab')}
          aria-label="Add a node"
          title="Add a node (Enter). Tab adds one underneath the selection."
          style={
            isDesktop && selected
              ? { right: 'calc(360px + var(--space-3))' }
              : undefined
          }
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </Fab>
      )}

      {/*
        §15: "Presence: avatar stack in the top bar." It sits over the canvas
        rather than inside EditToolbar because the toolbar is already at its
        width budget on a phone, and presence is the first thing to drop there.
      */}
      {selfId && (
        <CollabBar>
          <PresenceStack
            present={channel.present}
            state={channel.state}
            selfId={selfId}
          />
          {othersEditing.length > 0 && (
            <EditingNote role="status">
              {othersEditing[0]!.name} is editing “{othersEditing[0]!.title}”
              {othersEditing.length > 1 ? ` +${othersEditing.length - 1}` : ''}
            </EditingNote>
          )}

          <Button
            size="sm"
            variant={chatOpen ? 'primary' : 'ghost'}
            aria-pressed={chatOpen}
            onClick={() => setChatOpen((open) => !open)}
          >
            Chat
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setActivityOpen(true)}>
            Activity
          </Button>
        </CollabBar>
      )}

      {chatOpen && selfId && (
        <ChatDock>
          <ChatPanel
            messages={channel.messages}
            nodes={mentionNodes}
            selfId={selfId}
            canPost={canChat}
            onSend={channel.send}
            onOpenNode={(nodeId) => {
              // §15: the chip "recentres the map when tapped".
              editor.select(nodeId);
              setChatOpen(false);
            }}
            headerSlot={
              <Button size="sm" variant="ghost" onClick={() => setChatOpen(false)}>
                Close
              </Button>
            }
          />
        </ChatDock>
      )}

      <ActivityPanel
        mapId={draft.id}
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
      />

      <UndoBar action={undoAction} onUndo={editor.undo} />

      {isDesktop ? (
        <InspectorPanel
          open={Boolean(selected)}
          onClose={() => editor.select(null)}
          label={selected?.title || 'Node'}
        >
          {panel}
        </InspectorPanel>
      ) : (
        <DetailSheet
          open={Boolean(selected)}
          onClose={() => editor.select(null)}
          label={selected?.title || 'Node'}
        >
          {panel}
        </DetailSheet>
      )}
    </Frame>
  );
}

const NO_FOCUS = {
  selectedId: null,
  ancestorIds: new Set<string>(),
  siblingIds: new Set<string>(),
};
