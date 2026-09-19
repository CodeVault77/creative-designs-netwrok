'use client';

import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Sheet } from '@/components/ui';

/**
 * AddToMapPicker — §13 step 6.
 *
 * "Add to map opens a compact picker: which map, which parent node. On
 * confirm, a toast: Added to 'Research' · View in map."
 *
 * Compact is the requirement. This is a decision taken mid-scroll, and a
 * full map browser here would break the reading flow the ~72% cards exist to
 * create. Two selects and a button.
 */

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) 0;
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-label);
  color: var(--ground-muted);
`;

const Select = styled.select`
  width: 100%;
  min-height: var(--control-inputHeight);
  padding: 0 var(--space-3);

  background: var(--ground-background);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--text-body);

  &:focus {
    outline: none;
    border-color: var(--color-focus);
  }
`;

const Empty = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-muted);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
`;

interface MapOption {
  id: string;
  title: string;
  nodeCount: number;
}

interface NodeOption {
  id: string;
  title: string;
  depth: number;
}

export interface AddToMapPickerProps {
  open: boolean;
  itemTitle: string;
  onClose: () => void;
  onConfirm: (mapId: string, parentId: string) => Promise<void> | void;
}

export function AddToMapPicker({
  open,
  itemTitle,
  onClose,
  onConfirm,
}: AddToMapPickerProps) {
  const [maps, setMaps] = useState<MapOption[] | null>(null);
  const [mapId, setMapId] = useState('');
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);

  // The map list is fetched when the sheet opens rather than on mount: this
  // component lives inside every card, and a request per card would be one
  // request per item in the feed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const response = await fetch('/api/watch/add-to-map');
      if (!response.ok) {
        if (!cancelled) setMaps([]);
        return;
      }
      const data = (await response.json()) as { maps: MapOption[] };
      if (cancelled) return;
      setMaps(data.maps);
      if (data.maps[0]) setMapId(data.maps[0].id);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Parent options come from the chosen map, flattened with an indent so the
  // hierarchy is legible in a native select.
  useEffect(() => {
    if (!mapId) return;
    let cancelled = false;

    (async () => {
      const response = await fetch(`/api/maps/${mapId}`);
      if (!response.ok) return;
      const map = (await response.json()) as {
        rootId: string;
        nodes: Record<
          string,
          { id: string; title: string; parent_id: string | null }
        >;
      };
      if (cancelled) return;

      const flat: NodeOption[] = [];
      const walk = (id: string, depth: number) => {
        const node = map.nodes[id];
        if (!node || depth > 3) return;
        flat.push({ id: node.id, title: node.title, depth });
        for (const child of Object.values(map.nodes)) {
          if (child.parent_id === id) walk(child.id, depth + 1);
        }
      };
      walk(map.rootId, 0);

      setNodes(flat);
      setParentId(map.rootId);
    })();

    return () => {
      cancelled = true;
    };
  }, [mapId]);

  return (
    <Sheet open={open} onClose={onClose} title="Add to map">
      <Body>
        <Empty>
          Adding “{itemTitle.length > 60 ? `${itemTitle.slice(0, 60)}…` : itemTitle}
          ”
        </Empty>

        {maps === null && <Empty>Loading your maps…</Empty>}

        {maps?.length === 0 && (
          // Honest rather than a disabled control with no explanation.
          <Empty>You do not have a map to add this to yet. Create one first.</Empty>
        )}

        {maps && maps.length > 0 && (
          <>
            <Field>
              Map
              <Select
                value={mapId}
                onChange={(event) => setMapId(event.target.value)}
                aria-label="Map"
              >
                {maps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.title} ({map.nodeCount})
                  </option>
                ))}
              </Select>
            </Field>

            <Field>
              Parent node
              <Select
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
                aria-label="Parent node"
              >
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {'— '.repeat(node.depth)}
                    {node.title}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <Actions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!mapId || !parentId || busy}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(mapId, parentId);
              } finally {
                setBusy(false);
              }
            }}
          >
            Add node
          </Button>
        </Actions>
      </Body>
    </Sheet>
  );
}
