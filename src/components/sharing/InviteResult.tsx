'use client';

import Link from 'next/link';
import styled from 'styled-components';
import { routes } from '@/lib/routes';

/** Shown when an invitation cannot be accepted. */

const Wrap = styled.div`
  display: grid;
  place-items: center;
  min-height: 60dvh;
  padding: var(--space-6);
  text-align: center;
`;

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 28rem;
`;

const Title = styled.h1`
  margin: 0;
  font-size: var(--text-display-m);
`;

const Body = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: var(--leading-body);
`;

const COPY: Record<string, { title: string; body: string }> = {
  // Deliberately identical for invalid and revoked. Distinguishing them would
  // let someone probe which tokens ever existed.
  invalid: {
    title: 'This invitation is not valid',
    body: 'It may have been revoked, or the link may be incomplete. Ask whoever invited you to send a new one.',
  },
  expired: {
    title: 'This invitation has expired',
    body: 'Invitations last 14 days. Ask whoever invited you to send a new one.',
  },
  used: {
    title: 'This invitation has already been used',
    body: 'If it was you, the map is in your list already. If it was not, tell the person who invited you.',
  },
};

export function InviteResult({ reason }: { reason: string }) {
  const copy = COPY[reason] ?? COPY['invalid']!;

  return (
    <Wrap>
      <Column>
        <Title>{copy.title}</Title>
        <Body>{copy.body}</Body>
        <Link href={routes.maps} style={{ color: 'var(--fam-discover-core)' }}>
          Go to My Maps →
        </Link>
      </Column>
    </Wrap>
  );
}
