'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, TextField, useToast } from '@/components/ui';
import { VisibilityPicker } from './VisibilityPicker';
import { track } from '@/lib/analytics';
import type { Visibility } from '@/lib/sharing/payload';

/**
 * Screen 11 — share a map.
 *
 * The link is only generated once a map is actually shareable, and it is shown
 * ONCE. Tokens are stored hashed, so there is no way to display an existing
 * one later — the same bargain as a password, and stated plainly rather than
 * discovered.
 */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: var(--text-title);
`;

const LinkRow = styled.div`
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
`;

const Note = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  line-height: 1.5;
`;

const Warning = styled.p`
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: rgba(255, 176, 32, 0.08);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-control);
  font-size: var(--text-label);
  color: var(--ground-ink);
  line-height: 1.5;
`;

export interface ShareSheetProps {
  mapId: string;
  mapTitle: string;
  initialVisibility: Visibility;
  initialNodeViewable: boolean;
  initialHasLink: boolean;
  /** False for roles that may view but not change privacy (§15). */
  canChangePrivacy: boolean;
}

export function ShareSheet({
  mapId,
  initialVisibility,
  initialNodeViewable,
  initialHasLink,
  canChangePrivacy,
}: ShareSheetProps) {
  const { show } = useToast();

  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [nodeViewable, setNodeViewable] = useState(initialNodeViewable);
  const [hasLink, setHasLink] = useState(initialHasLink);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveSettings = useCallback(
    async (next: { visibility: Visibility; nodeViewable: boolean }) => {
      const previous = { visibility, nodeViewable };

      // Optimistic: the toggle should feel instant, and the revert below makes
      // a failure visible rather than leaving the UI lying.
      setVisibility(next.visibility);
      setNodeViewable(next.nodeViewable);

      try {
        const response = await fetch(
          `/api/maps/${encodeURIComponent(mapId)}/share`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          },
        );

        if (!response.ok) {
          setVisibility(previous.visibility);
          setNodeViewable(previous.nodeViewable);
          show({ message: "Couldn't change that", tone: 'danger' });
          return;
        }

        track('map_visibility_changed', {
          map_id: mapId,
          from: previous.visibility,
          to: next.visibility,
        });
      } catch {
        setVisibility(previous.visibility);
        setNodeViewable(previous.nodeViewable);
        show({ message: "Couldn't reach the server", tone: 'danger' });
      }
    },
    [mapId, visibility, nodeViewable, show],
  );

  // Turning a map private makes any live link dead; say so where the link is.
  useEffect(() => {
    if (visibility === 'private') setLink(null);
  }, [visibility]);

  const createLink = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}/share`, {
        method: 'POST',
      });
      if (!response.ok) {
        show({ message: "Couldn't create the link", tone: 'danger' });
        return;
      }
      const { url } = await response.json();
      setLink(url);
      setHasLink(true);

      track('map_shared', {
        map_id: mapId,
        visibility,
        node_viewable: nodeViewable,
      });

      try {
        await navigator.clipboard.writeText(url);
        show({ message: 'Link copied', tone: 'success' });
      } catch {
        // Clipboard can be refused; the field below still shows the URL.
      }
    } finally {
      setBusy(false);
    }
  }, [mapId, visibility, nodeViewable, show]);

  const revokeLink = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`/api/maps/${encodeURIComponent(mapId)}/share`, {
        method: 'DELETE',
      });
      setLink(null);
      setHasLink(false);
      show({ message: 'Link revoked. It will not open for anyone now.' });
    } finally {
      setBusy(false);
    }
  }, [mapId, show]);

  return (
    <Wrap>
      <Section>
        <VisibilityPicker
          visibility={visibility}
          nodeViewable={nodeViewable}
          onChange={saveSettings}
          disabled={!canChangePrivacy}
        />
        {!canChangePrivacy && (
          <Note>Only the owner and admins can change who sees this map.</Note>
        )}
      </Section>

      {visibility !== 'private' && canChangePrivacy && (
        <Section>
          <SectionTitle>Link</SectionTitle>

          {link ? (
            <>
              <LinkRow>
                <TextField
                  label="Share link"
                  value={link}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(link);
                    show({ message: 'Link copied', tone: 'success' });
                  }}
                >
                  Copy
                </Button>
              </LinkRow>
              <Warning>
                Copy this now — it is stored hashed and cannot be shown again. You
                can always create a new one, which replaces this link.
              </Warning>
            </>
          ) : (
            <>
              <LinkRow>
                <Button variant="primary" onClick={createLink} loading={busy}>
                  {hasLink ? 'Create a new link' : 'Create link'}
                </Button>
                {hasLink && (
                  <Button
                    variant="destructive"
                    onClick={revokeLink}
                    disabled={busy}
                  >
                    Revoke
                  </Button>
                )}
              </LinkRow>
              <Note>
                {hasLink
                  ? 'A link already exists. Creating a new one revokes the old one immediately.'
                  : 'Anyone with the link can open this map. There is one link at a time, and you can revoke it whenever you like.'}
              </Note>
            </>
          )}
        </Section>
      )}
    </Wrap>
  );
}
