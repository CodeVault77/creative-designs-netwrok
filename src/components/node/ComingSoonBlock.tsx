'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styled from 'styled-components';
import { Button, TextField, useToast } from '@/components/ui';
import { track } from '@/lib/analytics';
import type { NodeDetail } from '@/lib/nodes/detail';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * Screen 22 — the Coming Soon experience.
 *
 * ADR-0001 ships seven ring-one nodes dark, and the whole bet rests on this
 * component being GOOD rather than a placeholder. §08 puts it plainly: it has
 * to read as a roadmap, not as a broken link.
 *
 * Four things make that difference, and none of them are decoration:
 *
 *   1. An honest target window. Coarse on purpose — a season we can hit beats
 *      a date we might miss.
 *   2. A description of what it will actually do, so the tap was informative
 *      even if the answer is "not yet".
 *   3. Working interest capture. §24 measures ≥10 per dark node in month one,
 *      and that number is what ranks months 4–6.
 *   4. Related live nodes. The single most useful thing this screen can do is
 *      not be a dead end.
 */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

/**
 * The two facts a Coming Soon node has to lead with, side by side.
 *
 * The design reference sets them as a pair of cards: when it is expected, and
 * how many people have asked. Together they answer "is this worth waiting
 * for?" — the target alone is a promise, and the count alone is a crowd.
 */
const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-2);
`;

const Stat = styled.div`
  padding: var(--space-3);
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
`;

const StatLabel = styled.p`
  margin: 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ground-muted);
`;

const StatValue = styled.p<{ $tone?: 'soon' }>`
  margin: var(--space-1) 0 0;
  font-family: var(--face-display);
  font-size: var(--text-body);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: ${({ $tone }) =>
    $tone === 'soon' ? 'var(--fam-services-core)' : 'var(--ground-ink)'};
`;

const Description = styled.p`
  margin: 0;
  color: var(--ground-muted);
  font-size: var(--text-body);
  line-height: var(--leading-body);
`;

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
`;

const PanelTitle = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const Hint = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
  line-height: 1.5;
`;

const Registered = styled.p`
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-success);
  font-size: var(--text-body);
`;

const Count = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ground-muted);
  font-size: var(--text-caption);
`;

/**
 * Pills that wrap, not a stacked list.
 *
 * These are alternatives to try, not a menu to work through: laid out inline
 * they read as "here are three other places", which is the message. Stacked
 * full-width rows read as a list of things you are expected to do, and they
 * pushed the notify button off a small screen.
 */
const RelatedList = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const RelatedItem = styled.li<{ $family: FamilyName }>`
  a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
    padding: 0 var(--space-3);

    /*
     * Bordered in the destination's OWN family hue, so the pill is already
     * telling you where it goes before you read it — the same colour the node
     * carries on the map.
     */
    border: 1px solid
      ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
    border-radius: var(--radius-pill);
    background: var(--ground-raised);

    color: var(--ground-ink);
    text-decoration: none;
    font-size: var(--text-label);
    white-space: nowrap;

    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }
`;

const RelatedDot = styled.span<{ $family: FamilyName }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
`;

const ErrorText = styled.p`
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-caption);
`;

export function ComingSoonBlock({ detail }: { detail: NodeDetail }) {
  const { show } = useToast();
  const [email, setEmail] = useState('');
  const [registered, setRegistered] = useState(false);
  const [count, setCount] = useState(detail.interestCount ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    track('coming_soon_viewed', { node_id: detail.id, family: detail.family });
  }, [detail.id, detail.family]);

  // Whether this viewer already registered, so a returning visitor is not
  // asked again as though their first tap did nothing.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/interest?nodeId=${encodeURIComponent(detail.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setRegistered(Boolean(data.registered));
        setCount(Number(data.count) || 0);
      })
      .catch(() => {
        /* the panel still works; it just cannot pre-fill */
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  const register = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: detail.id,
          ...(email.trim() ? { email: email.trim() } : {}),
        }),
      });

      if (!response.ok) {
        // §08 screen 22: "Notify-me failure → inline retry."
        setError(
          response.status === 429
            ? 'Too many requests. Try again in a minute.'
            : "That didn't go through. Try again.",
        );
        return;
      }

      const data = await response.json();
      setRegistered(true);
      setCount(Number(data.count) || count + 1);

      track('coming_soon_interest_registered', {
        node_id: detail.id,
        family: detail.family,
      });

      show({
        message: data.created ? "We'll let you know" : 'You already asked for this',
        tone: 'success',
      });
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }, [detail.id, detail.family, email, count, show]);

  return (
    <Wrap>
      {detail.description && <Description>{detail.description}</Description>}

      <Stats>
        <Stat>
          <StatLabel>Target</StatLabel>
          <StatValue $tone="soon">{detail.targetWindow}</StatValue>
        </Stat>

        {/*
         * The interest card appears only once someone has actually asked.
         * "0 asked" is a discouragement printed next to a sign-up button, and
         * a number nobody has earned yet is worse than no number — the count
         * is real, read from the interest store, or it is absent.
         */}
        {count > 0 && (
          <Stat>
            <StatLabel>Interest</StatLabel>
            <StatValue>{count} asked</StatValue>
          </Stat>
        )}
      </Stats>

      <Panel>
        <PanelTitle>
          {registered ? "You're on the list" : 'Want this sooner?'}
        </PanelTitle>

        {registered ? (
          <>
            <Registered role="status">
              <svg
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3 8.5 6.5 12 13 4.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              We&apos;ll tell you when it ships.
            </Registered>
            {count > 0 && (
              <Count>
                {count} {count === 1 ? 'person wants' : 'people want'} this
              </Count>
            )}
          </>
        ) : (
          <>
            <Hint>
              We build what people ask for first. Registering takes one tap — the
              email is optional and only used to tell you when this is live.
            </Hint>

            <TextField
              label="Email (optional)"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              {...(error ? { error } : {})}
            />

            <Button
              variant="primary"
              family={detail.family}
              onClick={register}
              loading={busy}
            >
              Notify me
            </Button>

            {error && !email && <ErrorText role="alert">{error}</ErrorText>}

            {count > 0 && (
              <Count>
                {count} {count === 1 ? 'person has' : 'people have'} asked for this
              </Count>
            )}
          </>
        )}
      </Panel>

      {detail.relatedLive && detail.relatedLive.length > 0 && (
        <div>
          <StatLabel as="h3" style={{ marginBottom: 'var(--space-2)' }}>
            Live now instead
          </StatLabel>
          <RelatedList>
            {detail.relatedLive.map((related) => (
              <RelatedItem key={related.id} $family={related.family}>
                <Link href={related.href ?? `/map?node=${related.id}`}>
                  <RelatedDot $family={related.family} aria-hidden="true" />
                  {related.title}
                </Link>
              </RelatedItem>
            ))}
          </RelatedList>
        </div>
      )}
    </Wrap>
  );
}
