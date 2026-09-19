'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, TextField, useToast } from '@/components/ui';
import { PersonRow } from './PersonRow';
import { PendingInvite } from './PendingInvite';
import { RoleMenu } from './RoleMenu';
import { EmptyState } from '@/components/account/EmptyState';
import { track } from '@/lib/analytics';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@/lib/sharing/roles';

/** Screen 12 — collaborators. */

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

const List = styled.ul`
  margin: 0;
  padding: 0;
`;

const InviteRow = styled.form`
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
  flex-wrap: wrap;
`;

const Grow = styled.div`
  flex: 1 1 220px;
  min-width: 0;
`;

const Legend = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-3);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
`;

const LegendRow = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);

  strong {
    color: var(--ground-ink);
    font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
  }
`;

const Note = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  line-height: 1.5;
`;

interface Member {
  userId: string;
  handle: string;
  displayName: string;
  role: Role;
}

interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

export interface CollaboratorsProps {
  mapId: string;
  currentUserId: string;
  actorRole: Role | null;
}

export function Collaborators({
  mapId,
  currentUserId,
  actorRole,
}: CollaboratorsProps) {
  const { show } = useToast();

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}/members`);
    if (!response.ok) return;
    const data = await response.json();
    setMembers(data.members ?? []);
    setInvites(data.invites ?? []);
  }, [mapId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canInvite = actorRole === 'owner' || actorRole === 'admin';

  const invite = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;

      setBusy(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/maps/${encodeURIComponent(mapId)}/members`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), role }),
          },
        );

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          setError(body.error ?? "Couldn't send that invitation");
          return;
        }

        track('collaborator_invited', { map_id: mapId, role });
        setEmail('');
        // No mail provider yet, so the link is handed back for the inviter to
        // send. Saying so is better than a "sent!" that is not true.
        setLastLink(body.url ?? null);
        show({ message: 'Invitation created. Copy the link to send it.' });
        void load();
      } catch {
        setError("Couldn't reach the server");
      } finally {
        setBusy(false);
      }
    },
    [busy, mapId, email, role, show, load],
  );

  const changeRole = useCallback(
    async (userId: string, next: Role) => {
      const response = await fetch(
        `/api/maps/${encodeURIComponent(mapId)}/members`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, role: next }),
        },
      );

      if (!response.ok) {
        show({ message: "You can't change that person's role", tone: 'danger' });
        return;
      }

      track('collaborator_role_changed', {
        map_id: mapId,
        from: 'unknown',
        to: next,
      });
      void load();
    },
    [mapId, show, load],
  );

  const removeMember = useCallback(
    async (userId: string) => {
      const response = await fetch(
        `/api/maps/${encodeURIComponent(mapId)}/members?userId=${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        show({ message: "You can't remove that person", tone: 'danger' });
        return;
      }

      track('collaborator_removed', { map_id: mapId });

      // Removing yourself means you can no longer see the map.
      if (userId === currentUserId) {
        window.location.href = '/maps';
        return;
      }
      void load();
    },
    [mapId, currentUserId, show, load],
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      await fetch(
        `/api/maps/${encodeURIComponent(mapId)}/members?inviteId=${encodeURIComponent(inviteId)}`,
        { method: 'DELETE' },
      );
      show({ message: 'Invitation revoked' });
      void load();
    },
    [mapId, show, load],
  );

  return (
    <Wrap>
      {canInvite && (
        <Section>
          <SectionTitle>Invite someone</SectionTitle>
          <InviteRow onSubmit={invite}>
            <Grow>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="them@example.com"
                required
                {...(error ? { error } : {})}
              />
            </Grow>
            <RoleMenu value={role} actorRole={actorRole} onChange={setRole} />
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!email.trim()}
            >
              Invite
            </Button>
          </InviteRow>

          {lastLink && (
            <Note>
              We have queued the email, but no mail provider is configured yet —
              send this link yourself:{' '}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(lastLink);
                  show({ message: 'Invitation link copied', tone: 'success' });
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--fam-discover-core)',
                  cursor: 'pointer',
                  font: 'inherit',
                  textDecoration: 'underline',
                }}
              >
                copy link
              </button>
            </Note>
          )}
        </Section>
      )}

      <Section>
        <SectionTitle>People</SectionTitle>
        <List>
          {members.map((member) => (
            <PersonRow
              key={member.userId}
              displayName={member.displayName}
              handle={member.handle}
              role={member.role}
              isYou={member.userId === currentUserId}
              actorRole={actorRole}
              onChangeRole={(next) => changeRole(member.userId, next)}
              {...(member.role !== 'owner'
                ? { onRemove: () => removeMember(member.userId) }
                : {})}
            />
          ))}
        </List>
      </Section>

      {canInvite && (
        <Section>
          <SectionTitle>Pending invitations</SectionTitle>
          {invites.length === 0 ? (
            <EmptyState
              title="No invitations waiting"
              body="Anyone you invite appears here until they accept."
            />
          ) : (
            <List>
              {invites.map((item) => (
                <PendingInvite
                  key={item.id}
                  email={item.email}
                  role={item.role}
                  expiresAt={item.expiresAt}
                  onRevoke={() => revokeInvite(item.id)}
                />
              ))}
            </List>
          )}
        </Section>
      )}

      <Legend>
        {(['admin', 'editor', 'commenter', 'viewer'] as Role[]).map((r) => (
          <LegendRow key={r}>
            <strong>{ROLE_LABELS[r]}</strong> — {ROLE_DESCRIPTIONS[r]}
          </LegendRow>
        ))}
      </Legend>
    </Wrap>
  );
}
