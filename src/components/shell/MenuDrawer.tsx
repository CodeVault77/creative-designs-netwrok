'use client';

import Link from 'next/link';
import styled from 'styled-components';
import { Sheet } from '@/components/ui/Sheet';
import { routes } from '@/lib/routes';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * The overflow menu behind the top bar's hamburger.
 *
 * Composition ported from the design canvas: a narrow right-hand panel, a mono
 * "MENU" label, then single-line rows of a lit dot and a destination, each
 * closed by a hairline. No header, no close button — the scrim and Escape both
 * dismiss it, and a title bar on a panel this short is a second heading above
 * a label that already says what this is.
 *
 * ── What is in it, and why that changed ─────────────────────────────────────
 *
 * The first version deliberately excluded anything already in the tab bar, on
 * the reasoning that repeating the tabs teaches people the tabs are
 * incomplete. The canvas includes them, and the canvas is right: on a phone
 * this is the only full list of where you can go, and a drawer that omits the
 * obvious destinations reads as broken rather than as disciplined.
 *
 * What it drops instead is Link-to-Mind-Map and Page Watcher. Those were in
 * the first version to rescue them from being unreachable — but they are
 * ring-one nodes on the Community Map, so they were always one tap from the
 * Map tab. Notifications and Settings genuinely have no other route on a
 * phone, which is what this panel exists for.
 */

interface MenuEntry {
  label: string;
  href: string;
  family: FamilyName;
  /** Staff-only rows are hidden outright rather than shown disabled. */
  staffOnly?: boolean;
}

const ENTRIES: readonly MenuEntry[] = [
  { label: 'Central Node', href: routes.map, family: 'organise' },
  { label: 'Search', href: routes.search, family: 'discover' },
  { label: 'My Maps', href: routes.maps, family: 'create' },
  { label: 'Notifications', href: routes.notifications, family: 'people' },
  { label: 'Settings', href: routes.settings, family: 'commerce' },
  {
    label: 'Moderation',
    href: routes.moderation,
    family: 'services',
    staffOnly: true,
  },
];

/**
 * The canvas pads the panel 64px from the top.
 *
 * That space is not decorative: it clears the phone's status bar and notch, so
 * the first row starts below the hardware rather than under it.
 */
const Panel = styled.div`
  padding: var(--space-8) 0 var(--space-4);
`;

const Label = styled.h2`
  margin: 0 0 var(--space-3);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  font-weight: 400;
  letter-spacing: 1.4px;
  color: var(--ground-muted);
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const Item = styled.li`
  border-bottom: 1px solid var(--ground-border);

  a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    /* 44px, so every row clears the minimum tap target (§17). */
    min-height: 44px;
    padding: var(--space-2) 2px;
    color: var(--ground-ink);
    font-size: var(--text-label);
    text-decoration: none;
  }

  a:hover {
    color: var(--ground-ink);
    background: rgba(255, 255, 255, 0.03);
  }
`;

/**
 * The dot is lit, not flat.
 *
 * It is the only colour in the panel, and the glow is what ties a destination
 * to its family — the same hue the tab bar and the map node use for it, so the
 * menu is a third view of one colour system rather than a decorative palette.
 */
const Dot = styled.span<{ $family: FamilyName }>`
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-circle);
  background: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  box-shadow: ${({ theme, $family }) => theme.tokens.glow[$family][1]};
`;

export interface MenuDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Staff rows appear only for staff. */
  isStaff?: boolean;
}

export function MenuDrawer({ open, onClose, isStaff = false }: MenuDrawerProps) {
  const entries = ENTRIES.filter((entry) => !entry.staffOnly || isStaff);

  return (
    /*
     * No `title`, so the Sheet renders no header — the panel supplies its own
     * label. `ariaLabel` is what names the dialog in its place.
     */
    <Sheet
      open={open}
      onClose={onClose}
      ariaLabel="Menu"
      placement="right"
      /*
       * 248px, from the canvas. Narrow enough that the screen behind stays
       * visible, so this reads as a layer over where you are rather than a
       * page you have navigated to.
       */
      width="248px"
    >
      <Panel>
        <Label>MENU</Label>

        <nav aria-label="Menu">
          <List>
            {entries.map((entry) => (
              <Item key={entry.href}>
                {/*
                 * Closes on navigate. Next keeps the drawer mounted across a
                 * client-side transition, so without this you arrive at the
                 * new screen with the menu still sitting over it.
                 */}
                <Link href={entry.href} onClick={onClose}>
                  <Dot $family={entry.family} aria-hidden="true" />
                  {entry.label}
                </Link>
              </Item>
            ))}
          </List>
        </nav>
      </Panel>
    </Sheet>
  );
}
