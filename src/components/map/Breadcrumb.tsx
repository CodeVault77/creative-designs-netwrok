'use client';

import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * `CDN › Create › Mind Mapping` — every segment tappable (§06).
 *
 * This is the answer to the design principle "the user should always
 * understand where they are in the network", and it is what makes §09's
 * centre-slide mechanic safe: when a focused parent slides into the centre,
 * the true root does not vanish, it becomes the first segment here.
 *
 * A `<nav>` with an ordered list, not a row of buttons — the structure is the
 * information, and a screen reader should announce it as a path.
 */

/**
 * Left-aligned with room reserved on the right for the view toggle.
 *
 * It was centred, which collided with the toggle on a phone — the trail and
 * the Map/Tree control overlapped and both became unreadable. Centring only
 * works when nothing shares the row, and something always ends up sharing
 * the row.
 */
const Bar = styled.nav`
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  /* 150px clears the view toggle plus its own right offset. */
  right: calc(150px + var(--space-3));
  z-index: var(--z-mapControls);

  display: flex;
  justify-content: flex-start;

  @media (min-width: 1024px) {
    /* Room enough to centre without colliding. */
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    max-width: 640px;
  }
`;

const List = styled.ol`
  display: flex;
  max-width: 100%;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-1) var(--space-3);
  list-style: none;

  background: rgba(13, 14, 23, 0.72);
  backdrop-filter: blur(12px);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);

  /* A deep trail scrolls rather than wrapping — a two-line breadcrumb over a
     map costs more vertical space than it is worth. */
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }

  @supports not (backdrop-filter: blur(12px)) {
    background: var(--ground-surface);
  }
`;

/**
 * Ancestors give way; the current node does not.
 *
 * Every item used to be `flex-shrink: 0`, so when the trail outgrew the bar it
 * was the END that got cut — "Creative Design N… › Mind Mapp". That truncates
 * the one segment the reader needs most: where they are now. The ancestors are
 * context, and context is what you abbreviate.
 */
const Item = styled.li<{ $current: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  flex-shrink: ${({ $current }) => ($current ? 0 : 1)};
`;

const Segment = styled.button<{ $current: boolean }>`
  background: none;
  border: none;
  padding: var(--space-1) var(--space-1);
  border-radius: var(--radius-chip);

  font-family: var(--face-display);
  font-size: var(--text-label);
  font-weight: ${({ theme, $current }) =>
    $current
      ? theme.tokens.typography.weight.semibold
      : theme.tokens.typography.weight.regular};
  color: ${({ $current }) => ($current ? 'var(--ground-ink)' : 'var(--ground-muted)')};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: ${({ $current }) => ($current ? 'default' : 'pointer')};

  ${transition('selection', 'color')}

  &:hover:not(:disabled) {
    color: var(--ground-ink);
  }
`;

const Separator = styled.span`
  color: var(--ground-border);
  font-size: var(--text-caption);
  user-select: none;
`;

export interface BreadcrumbProps {
  trail: { id: string; title: string }[];
  onNavigate: (nodeId: string) => void;
  /** Shortens long titles. The full text stays in the accessible name. */
  maxChars?: number;
}

export function Breadcrumb({ trail, onNavigate, maxChars = 18 }: BreadcrumbProps) {
  if (trail.length === 0) return null;

  return (
    <Bar aria-label="Map location">
      <List>
        {trail.map((segment, index) => {
          const current = index === trail.length - 1;
          const shortened =
            segment.title.length > maxChars
              ? `${segment.title.slice(0, maxChars - 1)}…`
              : segment.title;

          return (
            <Item key={segment.id} $current={current}>
              {index > 0 && <Separator aria-hidden="true">›</Separator>}
              <Segment
                $current={current}
                onClick={() => !current && onNavigate(segment.id)}
                disabled={current}
                aria-current={current ? 'location' : undefined}
                // The visible text may be truncated; the accessible name is not.
                aria-label={segment.title}
                title={segment.title}
              >
                {shortened}
              </Segment>
            </Item>
          );
        })}
      </List>
    </Bar>
  );
}
