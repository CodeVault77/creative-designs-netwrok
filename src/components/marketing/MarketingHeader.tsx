'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styled from 'styled-components';
import { Button } from '@/components/ui';
import { enabled, flags, headerNav, isPreLaunch } from '@/config';
import { track } from '@/lib/analytics';
import { Logo } from './Logo';
import { Container } from './Section';

/**
 * The marketing header.
 *
 * Reads its links from `config/navigation.ts`, so Phase 1 turns on About and
 * Projects with a boolean rather than editing this file (roadmap §28.4). The
 * primary CTA switches from "Request a project" to "Enter the network" purely
 * on launch status — that switch is the whole migration, and it lives here.
 */

const Bar = styled.header<{ $scrolled: boolean }>`
  position: sticky;
  top: 0;
  z-index: var(--z-chrome);

  background: ${({ $scrolled }) =>
    $scrolled ? 'rgba(7, 7, 12, 0.88)' : 'transparent'};
  border-bottom: 1px solid
    ${({ $scrolled }) => ($scrolled ? 'var(--ground-border)' : 'transparent')};
  backdrop-filter: ${({ $scrolled }) => ($scrolled ? 'blur(12px)' : 'none')};

  transition:
    background 200ms ease,
    border-color 200ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 64px;
  padding-block: var(--space-2);
`;

const Brand = styled(Link)`
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  flex-shrink: 0;

  /* The mark alone below 400px — the words do not fit beside a menu button. */
  .cdn-words {
    display: none;
  }
  @media (min-width: 400px) {
    .cdn-words {
      display: inline-flex;
    }
  }
`;

const Nav = styled.nav`
  display: none;
  margin-left: auto;

  /*
   * The inline nav appears at 900px rather than at the tablet breakpoint: with
   * five links plus a CTA there is not room at 768 without crowding the logo.
   */
  @media (min-width: 900px) {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }
`;

const NavLink = styled(Link)`
  color: var(--ground-muted);
  font-size: var(--text-label);
  text-decoration: none;
  padding-block: var(--space-2);

  &:hover {
    color: var(--ground-ink);
  }
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;

  @media (min-width: 900px) {
    margin-left: 0;
  }
`;

const MenuButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;

  background: none;
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-control);
  color: var(--ground-ink);
  cursor: pointer;

  @media (min-width: 900px) {
    display: none;
  }
`;

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4) 0 var(--space-6);
  border-top: 1px solid var(--ground-border);

  @media (min-width: 900px) {
    display: none;
  }
`;

const PanelLink = styled(Link)`
  padding: var(--space-3) 0;
  color: var(--ground-ink);
  font-size: var(--text-title);
  text-decoration: none;
  min-height: 44px;
`;

const DesktopCta = styled.div`
  display: none;
  @media (min-width: 600px) {
    display: block;
  }
`;

export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const links = enabled(headerNav);

  /**
   * The bar only gains its background once the page has moved. Over a dark
   * hero a permanent bar reads as a seam; over content it is needed for
   * legibility.
   */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 64);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /**
   * Escape closes the panel and returns focus to the button that opened it.
   * Without the focus return, closing the menu drops a keyboard user at the
   * top of the document (AC-2).
   */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // A route change must not leave the panel open behind the new page.
  const close = () => setOpen(false);

  const cta = isPreLaunch()
    ? { label: 'Request a project', href: '/request' }
    : { label: 'Enter the network', href: '/app' };

  return (
    <Bar $scrolled={scrolled || open}>
      <Container>
        <Row>
          <Brand href="/" aria-label="Creative Design Networks — home">
            <Logo size={26} glow={false} />
          </Brand>

          <Nav aria-label="Main">
            {links.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </Nav>

          <Actions>
            {(flags.serviceRequest || !isPreLaunch()) && (
              <DesktopCta>
                <Button
                  size="sm"
                  onClick={() => {
                    track('marketing_cta_clicked', {
                      cta_id: 'header-primary',
                      section: 'header',
                    });
                    window.location.href = cta.href;
                  }}
                >
                  {cta.label}
                </Button>
              </DesktopCta>
            )}

            <MenuButton
              ref={buttonRef}
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="marketing-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                aria-hidden="true"
              >
                {open ? (
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M4 7h16M4 12h16M4 17h16"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </MenuButton>
          </Actions>
        </Row>

        {open && (
          <Panel id="marketing-menu" ref={panelRef}>
            {links.map((item) => (
              <PanelLink key={item.href} href={item.href} onClick={close}>
                {item.label}
              </PanelLink>
            ))}
            <PanelLink href={cta.href} onClick={close}>
              {cta.label}
            </PanelLink>
          </Panel>
        )}
      </Container>
    </Bar>
  );
}
