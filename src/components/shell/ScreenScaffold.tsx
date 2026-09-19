'use client';

import Link from 'next/link';
import styled from 'styled-components';
import { Card } from '@/components/ui';
import { screenByNumber, type ScreenNumber } from '@/lib/routes';

/**
 * Placeholder for a route that is wired but not yet built.
 *
 * P2's deliverable is "empty screens wired" — every one of the 22 routes must
 * be reachable and correctly framed by the shell, so that navigation, guards,
 * deep links and the breakpoint chrome can all be exercised end to end before
 * a single screen is designed.
 *
 * It states the screen number, the owning phase and the purpose from §08,
 * rather than saying "coming soon". Two reasons that distinction matters:
 *
 *   1. "Coming soon" is a PRODUCT state with its own designed screen (22) and
 *      real interest capture. Using the same words for "engineering hasn't
 *      built this yet" muddles a user-facing promise with a build status.
 *   2. Anyone clicking through the app can see exactly which phase owns which
 *      surface, which makes the roadmap navigable instead of a document.
 *
 * Every use of this component is deleted by the phase that builds the screen.
 * A grep for ScreenScaffold is an accurate list of what remains.
 */

const Wrap = styled.div`
  display: grid;
  place-items: center;
  min-height: 60dvh;
  padding: var(--space-6) 0;
`;

const Inner = styled.div`
  width: 100%;
  max-width: 30rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const Number = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Phase = styled.span`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--fam-services-core);
  border: 1px solid var(--fam-services-core);
  border-radius: var(--radius-chip);
  padding: 2px 6px;
`;

const HeaderRow = styled.span`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
`;

const Name = styled.span`
  flex: 1;
  min-width: 0;
`;

const Purpose = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: var(--leading-body);
`;

const Note = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Links = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);

  a {
    font-size: var(--text-label);
    color: var(--fam-discover-core);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;

export interface ScreenScaffoldProps {
  screen: ScreenNumber;
  /** Params resolved from the URL, shown so deep links can be verified by eye. */
  params?: Record<string, string | undefined>;
  /** Onward routes worth checking from here, for manual navigation testing. */
  links?: { href: string; label: string }[];
}

export function ScreenScaffold({ screen, params, links }: ScreenScaffoldProps) {
  const meta = screenByNumber(screen);

  if (!meta) {
    return (
      <Wrap>
        <Inner>
          <Card header={`Unknown screen ${screen}`}>
            <Purpose>
              This screen number is not in the registry in{' '}
              <code>src/lib/routes.ts</code>.
            </Purpose>
          </Card>
        </Inner>
      </Wrap>
    );
  }

  const shownParams = Object.entries(params ?? {}).filter(([, value]) => value);

  return (
    <Wrap>
      <Inner>
        <Card
          header={
            <HeaderRow>
              <Number>{meta.screen}</Number>
              <Name>{meta.name}</Name>
              <Phase>{meta.phase}</Phase>
            </HeaderRow>
          }
        >
          <Purpose>{meta.purpose}.</Purpose>

          {shownParams.length > 0 && (
            <Note>
              {shownParams.map(([key, value]) => (
                <span key={key} data-numeric>
                  {key}: {value}{' '}
                </span>
              ))}
            </Note>
          )}

          <Note>
            The route, guard and shell for this screen are live. The screen itself
            is {meta.phase} work.
          </Note>
        </Card>

        {links && links.length > 0 && (
          <Links aria-label="Related routes">
            {links.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label} →
              </Link>
            ))}
          </Links>
        )}
      </Inner>
    </Wrap>
  );
}
