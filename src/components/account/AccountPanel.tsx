'use client';

import Link from 'next/link';
import styled from 'styled-components';
import { routes } from '@/lib/routes';

/**
 * The signed-in half of screen 18: counts, account rows, settings rows.
 *
 * Rendered only for the profile's owner. This route doubles as the PUBLIC
 * profile, so everything here sits behind that check — a visitor must not
 * learn how many private maps someone keeps, and must certainly not be offered
 * links into their settings.
 *
 * ── On the numbers ─────────────────────────────────────────────────────────
 *
 * Every value is real, read from the database by the route. The design
 * reference shows "5 / 78 / 2" and rows reading "3 new", "12", "Neon dark",
 * "Reduced off"; those are mock values, and the ones this app cannot actually
 * answer are NOT reproduced. A profile that overstates what you have made is a
 * lie about the one subject its reader can immediately check.
 *
 * That is why there is no "Saved items" row (nothing saves items yet) and no
 * "Appearance / Motion / Privacy defaults" values (there is one theme, motion
 * follows the OS, and maps are private by default with no per-user override).
 * Those rows would be dials connected to nothing.
 */

export interface AccountSummary {
  maps: number;
  nodes: number;
  shared: number;
  unread: number;
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);

  /*
   * Capped on wide screens rather than stretched.
   *
   * These rows are a label on the left and a short value on the right. Run to
   * a full 1000px the two ends stop being one line — the eye has to travel the
   * whole width to pair "My maps" with its count, and the section reads as a
   * mobile layout someone pulled sideways. A settings column has a natural
   * measure, and this is it.
   */
  max-width: 34rem;
`;

// ------------------------------------------------------------------- stats

const Stats = styled.ul`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Stat = styled.li`
  padding: var(--space-2) var(--space-2);
  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  text-align: center;
`;

/**
 * One hue per stat, matching the families they belong to: maps are `create`,
 * nodes are `discover`, shared is `services`. Numerals only — the label under
 * each stays muted, so the row reads as three values rather than a rainbow.
 */
const Value = styled.span<{ $tone: 'create' | 'discover' | 'services' }>`
  display: block;
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-title);
  color: ${({ $tone }) => `var(--fam-${$tone}-core)`};
`;

const Label = styled.span`
  display: block;
  margin-top: 2px;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ground-muted);
`;

// ------------------------------------------------------------------- lists

const SectionLabel = styled.h2`
  margin: 0 0 var(--space-2);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  font-weight: 400;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--ground-muted);
`;

const Rows = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  overflow: hidden;
`;

const Row = styled.li`
  & + & {
    border-top: 1px solid var(--ground-border);
  }

  a,
  button {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 48px;
    padding: var(--space-3);

    background: var(--ground-raised);
    border: none;
    color: var(--ground-ink);
    font: inherit;
    font-size: var(--text-label);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  a:hover,
  button:hover {
    background: rgba(255, 255, 255, 0.04);
  }
`;

const RowLabel = styled.span`
  flex: 1;
  min-width: 0;
`;

const RowValue = styled.span`
  flex-shrink: 0;
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Chevron = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  color: var(--ground-border);
`;

const Danger = styled.span`
  color: var(--color-danger);
`;

function ChevronIcon() {
  return (
    <Chevron aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <path
          d="m9 5 7 7-7 7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Chevron>
  );
}

export interface AccountPanelProps {
  account: AccountSummary;
  handle: string;
  isStaff: boolean;
  onSignOut: () => void;
}

export function AccountPanel({
  account,
  handle,
  isStaff,
  onSignOut,
}: AccountPanelProps) {
  return (
    <Wrap>
      <Stats>
        <Stat>
          <Value $tone="create">{account.maps}</Value>
          <Label>{account.maps === 1 ? 'Map' : 'Maps'}</Label>
        </Stat>
        <Stat>
          <Value $tone="discover">{account.nodes}</Value>
          <Label>{account.nodes === 1 ? 'Node' : 'Nodes'}</Label>
        </Stat>
        <Stat>
          <Value $tone="services">{account.shared}</Value>
          <Label>Shared</Label>
        </Stat>
      </Stats>

      <section>
        <SectionLabel>Account</SectionLabel>
        <Rows>
          <Row>
            <Link href={routes.notifications}>
              <RowLabel>Notifications</RowLabel>
              {/*
                Only shown when there is something unread. "0 new" is a row
                reporting that there is nothing to report.
              */}
              {account.unread > 0 && <RowValue>{account.unread} new</RowValue>}
              <ChevronIcon />
            </Link>
          </Row>

          <Row>
            <Link href={routes.maps}>
              <RowLabel>My maps</RowLabel>
              <RowValue>{account.maps}</RowValue>
              <ChevronIcon />
            </Link>
          </Row>

          <Row>
            {/*
              Links to this very page. It is not a no-op: this route is the
              public profile, so it answers "what do other people see?" — and
              the handle beside it is the shareable part.
            */}
            <Link href={`/u/${handle}`}>
              <RowLabel>Public profile</RowLabel>
              <RowValue>@{handle}</RowValue>
              <ChevronIcon />
            </Link>
          </Row>
        </Rows>
      </section>

      <section>
        <SectionLabel>Settings</SectionLabel>
        <Rows>
          <Row>
            <Link href={routes.settings}>
              <RowLabel>Account, privacy and data</RowLabel>
              <ChevronIcon />
            </Link>
          </Row>

          {isStaff && (
            <Row>
              <Link href={routes.moderation}>
                <RowLabel>Moderation</RowLabel>
                <ChevronIcon />
              </Link>
            </Row>
          )}

          <Row>
            <button type="button" onClick={onSignOut}>
              <RowLabel>
                <Danger>Sign out</Danger>
              </RowLabel>
            </button>
          </Row>
        </Rows>
      </section>
    </Wrap>
  );
}
