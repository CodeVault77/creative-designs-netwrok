'use client';

import { useCallback, useState } from 'react';
import styled from 'styled-components';
import { transition } from '@/lib/styles/motion';

/**
 * The lens pill (§06): All · Active only · Trending · Mine.
 *
 * ── Why this component matters more than it looks ───────────────────────────
 *
 * ADR-0002 refused the original requirement that popular nodes pull toward
 * the centre, because position is the only durable thing a spatial interface
 * has. The Trending lens is the other half of that decision — the explicit,
 * temporary, clearly-labelled way to get the sorted view.
 *
 * Two properties make it read as a temporary VIEW rather than as the map
 * having rearranged itself, and both are required by ADR-0002:
 *
 *   1. the pill stays lit for as long as a non-default lens is active;
 *   2. a persistent "Back to layout" control sits beside it.
 *
 * Without those, Trending is indistinguishable from the auto-reposition
 * behaviour the ADR rejected, and the map stops being learnable.
 */

export type LensId = 'all' | 'active' | 'trending' | 'mine';

export interface Lens {
  id: LensId;
  label: string;
  description: string;
  /** Whether this lens changes node POSITIONS rather than just visibility. */
  relayout: boolean;
  requiresAuth: boolean;
}

export const LENSES: readonly Lens[] = [
  {
    id: 'all',
    label: 'All',
    description: 'Everything, in its fixed position',
    relayout: false,
    requiresAuth: false,
  },
  {
    id: 'active',
    label: 'Active only',
    description: 'Hide what is not built yet',
    relayout: false,
    requiresAuth: false,
  },
  {
    id: 'trending',
    label: 'Trending',
    description: 'Re-laid by popularity — a temporary view',
    relayout: true,
    requiresAuth: false,
  },
  {
    id: 'mine',
    label: 'Mine',
    description: 'Nodes from your own maps',
    relayout: false,
    requiresAuth: true,
  },
] as const;

const Wrap = styled.div`
  position: absolute;
  left: var(--space-3);
  /*
   * The bottom-left corner, as the design canvas places it.
   *
   * It used to be pushed 108px up to clear the layer stepper. The stepper is
   * vertically centred on the left edge now, so the corner is free and the
   * offset was only holding the pill in mid-air.
   */
  bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-mapControls);

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
`;

/** The pill and any adjacent control share a row above the caption. */
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
`;

/**
 * The state line under the pill — "DEFAULT · 8 OF 12" in the design canvas.
 *
 * It answers a question the map itself cannot: whether what you are looking at
 * is everything. Ring one is capped by viewport width, so on a phone four of
 * the twelve are folded into a cluster — without this line the only clue is a
 * "+5" bubble that could as easily be a node.
 */
const Caption = styled.p`
  margin: 0;
  padding-left: var(--space-1);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.7px;
  color: var(--ground-muted);
`;

const Pill = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);

  height: 32px;
  padding: 0 var(--space-3);

  background: ${({ $active }) =>
    $active ? 'var(--fam-discover-wash)' : 'rgba(13, 14, 23, 0.72)'};
  backdrop-filter: blur(12px);
  border: 1px solid
    ${({ $active }) => ($active ? 'var(--fam-discover-core)' : 'var(--ground-border)')};
  border-radius: var(--radius-pill);
  color: ${({ $active }) => ($active ? 'var(--fam-discover-core)' : 'var(--ground-muted)')};

  font-family: var(--face-body);
  font-size: var(--text-label);
  cursor: pointer;

  /* The lit state is what tells the user the map is not in its normal
     arrangement. It is load-bearing, not decoration. */
  box-shadow: ${({ theme, $active }) => ($active ? theme.tokens.glow.discover[1] : 'none')};

  ${transition('selection', 'background-color', 'border-color', 'color', 'box-shadow')}

  &:hover {
    color: var(--ground-ink);
  }

  @supports not (backdrop-filter: blur(12px)) {
    background: ${({ $active }) => ($active ? 'var(--fam-discover-wash)' : 'var(--ground-surface)')};
  }
`;

const BackButton = styled.button`
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 var(--space-3);

  background: rgba(13, 14, 23, 0.72);
  backdrop-filter: blur(12px);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  color: var(--ground-ink);

  font-family: var(--face-body);
  font-size: var(--text-label);
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    border-color: var(--fam-discover-core);
  }
`;

const Menu = styled.div`
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 0;
  min-width: 220px;

  display: flex;
  flex-direction: column;
  padding: var(--space-1);

  background: var(--ground-surface);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  box-shadow: var(--elev-menu);
`;

const MenuItem = styled.button<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;

  padding: var(--space-2) var(--space-3);
  background: ${({ $active }) => ($active ? 'rgba(255,255,255,0.05)' : 'transparent')};
  border: none;
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  text-align: left;
  cursor: pointer;
  font: inherit;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const ItemLabel = styled.span`
  font-size: var(--text-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.medium};
`;

const ItemDescription = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export interface LensPillProps {
  lens: LensId;
  onChange: (lens: LensId) => void;
  /** Signed-out users see "Mine" but cannot select it. */
  signedIn?: boolean;
  /** The state line under the pill, e.g. "DEFAULT · 8 OF 12". */
  caption?: string;
}

export function LensPill({
  lens,
  onChange,
  signedIn = false,
  caption,
}: LensPillProps) {
  const [open, setOpen] = useState(false);
  const current = LENSES.find((l) => l.id === lens) ?? LENSES[0]!;
  const isDefault = current.id === 'all';

  const select = useCallback(
    (next: LensId) => {
      setOpen(false);
      onChange(next);
    },
    [onChange],
  );

  return (
    <Wrap>
      <Row>
        <div style={{ position: 'relative' }}>
          <Pill
            $active={!isDefault}
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Lens: ${current.label}`}
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="7"
                cy="7"
                r="4.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M10.5 10.5 14 14"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            {current.label}
          </Pill>

          {open && (
            <Menu role="menu">
              {LENSES.map((item) => (
                <MenuItem
                  key={item.id}
                  role="menuitemradio"
                  aria-checked={item.id === lens}
                  $active={item.id === lens}
                  disabled={item.requiresAuth && !signedIn}
                  onClick={() => select(item.id)}
                >
                  <ItemLabel>{item.label}</ItemLabel>
                  <ItemDescription>
                    {item.requiresAuth && !signedIn
                      ? 'Sign in to use this'
                      : item.description}
                  </ItemDescription>
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>

        {/*
          ADR-0002 requires this to persist while a relayout lens is active, so
          the user always has a one-tap way back to the arrangement they
          learned.
        */}
        {current.relayout && (
          <BackButton onClick={() => select('all')}>Back to layout</BackButton>
        )}
      </Row>

      {caption && <Caption>{caption}</Caption>}
    </Wrap>
  );
}
