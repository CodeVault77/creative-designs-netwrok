'use client';

import { useCallback, useState } from 'react';
import styled from 'styled-components';
import { Avatar, Button, TextField } from '@/components/ui';

/**
 * ProfileHeader — screen 18.
 *
 * Editing happens in place rather than on a separate settings screen. A
 * profile is three short fields; sending someone to another page to change
 * their bio and back again to see it is more navigation than the task
 * deserves.
 *
 * Only the owner sees the edit control. A visitor sees the same header with
 * no affordance — not a disabled one, which would invite them to work out how
 * to enable it.
 */

/**
 * The gradient ring around the avatar, from the design reference.
 *
 * The same conic sweep as the map's root node and the entry screen, so a
 * person is presented in the same visual language as a map — this product is
 * about people and their networks, and giving both the brand ring says that
 * without a word of copy.
 *
 * A padded wrapper rather than a border, because a conic gradient cannot be a
 * border-color; the inner disc masks the middle out.
 */
const AvatarRing = styled.div`
  flex: none;
  padding: 2px;
  border-radius: var(--radius-circle);
  background: conic-gradient(
    from 200deg,
    #2fd9f5,
    #8b5cf6,
    #ff4d97,
    #ff8a3d,
    #2fd9f5
  );
  box-shadow: 0 0 18px rgba(139, 92, 246, 0.4);

  /* The disc sits on the sheet colour so the ring reads as a ring. */
  > * {
    display: block;
    border: 2px solid var(--ground-background);
    border-radius: var(--radius-circle);
  }
`;

const Header = styled.header`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--ground-border);
`;

/**
 * Wraps, so the actions drop to their own line before the name is crushed.
 *
 * Without this the avatar, name, "Edit profile" and "Sign out" all competed
 * for one 390px line; the buttons won on intrinsic width and the identity was
 * squeezed to about 90px, which is how "Design Port" ended up hyphen-less and
 * broken across two lines as "Desig / n Port".
 */
const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-4);
`;

/**
 * `flex: 1 1 12rem` rather than `flex: 1`.
 *
 * The basis is a floor: once the identity cannot hold 12rem the whole row
 * wraps instead of shrinking it further. `min-width: 0` still lets it shrink
 * BELOW that when the viewport itself is narrower, so a 280px screen degrades
 * to a narrow column rather than overflowing.
 */
const Identity = styled.div`
  flex: 1 1 12rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Name = styled.h1`
  margin: 0;
  font-size: var(--text-display-m);
  /*
   * break-word here, not anywhere. Both rescue a 40-character unbroken name,
   * but the anywhere value ALSO lets the box size below its longest word,
   * which is what allowed the flex row to crush this one in the first place —
   * the property meant to prevent overflow was enabling the squeeze.
   */
  overflow-wrap: break-word;
`;

const Handle = styled.p`
  margin: 0;
  font-family: var(--face-mono);
  font-size: var(--text-label);
  color: var(--ground-muted);
  /*
   * A handle is one token and is meaningless in pieces — better to ellipsis a
   * long one than to stack "@design-" / "port-" / "pmxi" down three lines.
   */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Bio = styled.p`
  margin: 0;
  max-width: 40rem;
  color: var(--ground-muted);
  line-height: var(--leading-body);
  overflow-wrap: anywhere;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 30rem;
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
`;

const ErrorText = styled.p`
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-caption);
`;

export interface ProfileHeaderProps {
  displayName: string;
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  isStaff: boolean;
  onSignOut?: () => void;
  /** True when an AccountPanel below is carrying Sign out instead. */
  hasAccountPanel?: boolean;
}

export function ProfileHeader({
  displayName,
  handle,
  bio,
  isOwner,
  isStaff,
  onSignOut,
  hasAccountPanel = false,
}: ProfileHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayName);
  const [nextBio, setNextBio] = useState(bio ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);

      try {
        const response = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: name, bio: nextBio || null }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setError(body.error ?? "Couldn't save that.");
          return;
        }

        // A reload rather than local state: the header, the tab bar and any
        // server-rendered copy of the name all need the new value, and one of
        // them will be missed if this updates in place.
        window.location.reload();
      } catch {
        setError("Couldn't reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [name, nextBio],
  );

  if (editing) {
    return (
      <Header>
        <Form onSubmit={save}>
          <TextField
            label="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            autoFocus
            required
          />
          <TextField
            label="Bio"
            value={nextBio}
            onChange={(event) => setNextBio(event.target.value)}
            placeholder="What are you building?"
            maxLength={280}
          />
          {error && <ErrorText role="alert">{error}</ErrorText>}
          <Actions>
            <Button type="submit" variant="primary" loading={busy}>
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setName(displayName);
                setNextBio(bio ?? '');
                setError(null);
              }}
            >
              Cancel
            </Button>
          </Actions>
        </Form>
      </Header>
    );
  }

  return (
    <Header>
      <Row>
        <AvatarRing>
          <Avatar name={displayName} size="lg" admin={isStaff} />
        </AvatarRing>
        <Identity>
          <Name>{displayName}</Name>
          <Handle>@{handle}</Handle>
        </Identity>
        {isOwner && (
          <Actions>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit profile
            </Button>
            {/*
              Sign out is NOT here for the owner: it lives at the bottom of the
              settings list, which is where the reference puts destructive and
              terminal actions and where people look for it. Keeping it beside
              "Edit profile" put the one irreversible control on the screen
              next to the most routine one.

              It stays here when there is no account panel to hold it, so no
              context can strand a signed-in user with no way out.
            */}
            {onSignOut && !hasAccountPanel && (
              <Button variant="ghost" onClick={onSignOut}>
                Sign out
              </Button>
            )}
          </Actions>
        )}
      </Row>
      {bio && <Bio>{bio}</Bio>}
    </Header>
  );
}
