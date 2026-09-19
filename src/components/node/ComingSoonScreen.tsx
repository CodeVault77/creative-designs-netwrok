'use client';

import Link from 'next/link';
import styled from 'styled-components';
import { ComingSoonBlock } from './ComingSoonBlock';
import { NodeHeader } from './NodeHeader';
import { routes } from '@/lib/routes';
import type { NodeDetail } from '@/lib/nodes/detail';

/**
 * Screen 22 as a full page.
 *
 * Wraps the same ComingSoonBlock the detail sheet uses, so the two can never
 * diverge — which is precisely the "sheet component sprawl" §20 warns about,
 * arriving through the back door of "the page needs a slightly different
 * version".
 *
 * The only things this adds are page furniture: a back link to the map, and
 * layout. Everything a user reads comes from the shared block.
 */

const Page = styled.main`
  display: flex;
  justify-content: center;
  padding: var(--space-6) 0;
`;

const Column = styled.div`
  width: 100%;
  max-width: 34rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
`;

const BackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  color: var(--ground-muted);
  font-size: var(--text-label);
  text-decoration: none;

  &:hover {
    color: var(--ground-ink);
  }
`;

export function ComingSoonScreen({ detail }: { detail: NodeDetail }) {
  return (
    <Page>
      <Column>
        <BackLink href={`${routes.map}?node=${encodeURIComponent(detail.id)}`}>
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 3.5 5.5 8l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to the map
        </BackLink>

        <NodeHeader detail={detail} mode="soon" />
        <ComingSoonBlock detail={detail} />
      </Column>
    </Page>
  );
}
