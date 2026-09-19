'use client';

import Link from 'next/link';
import styled from 'styled-components';
import {
  contact,
  emailUrl,
  enabled,
  flags,
  footerNav,
  hasEmail,
  hasWhatsApp,
  site,
  socialLinks,
  whatsappUrl,
} from '@/config';
import { track } from '@/lib/analytics';
import { Logo } from './Logo';
import { Container } from './Section';

/**
 * The marketing footer.
 *
 * Every contact route here is CONDITIONAL on its configuration being present.
 * An unconfigured channel renders nothing rather than a dead `mailto:` or a
 * `wa.me/` link with no number — which is the failure mode the whole
 * configuration guard in `config/contact.ts` exists to prevent, and it would
 * be undone by a footer that renders the link anyway.
 */

const Wrapper = styled.footer`
  margin-top: var(--space-16);
  padding-block: var(--space-12) var(--space-8);
  border-top: 1px solid var(--ground-border);
  background: var(--ground-surface);
`;

const Top = styled.div`
  display: grid;
  gap: var(--space-8);
  grid-template-columns: 1fr;

  @media (min-width: 600px) {
    grid-template-columns: 1fr 1fr;
  }

  /*
   * FIVE columns, not four: the brand block plus three nav groups plus
   * contact. A four-column grid orphaned the contact column onto a row of its
   * own, which looked like a rendering fault rather than a layout.
   */
  @media (min-width: 1024px) {
    grid-template-columns: 1.6fr repeat(4, 1fr);
  }
`;

const Brand = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 34ch;
`;

/**
 * The tagline (OD-13).
 *
 * Here and in the logo lockup — not in the hero, where the job is to explain
 * the product rather than state an identity.
 */
const Tagline = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-muted);
  line-height: 1.5;
`;

const Group = styled.nav`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const GroupTitle = styled.h2`
  margin: 0;
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ground-muted);
`;

const Items = styled.ul`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const FooterLink = styled(Link)`
  display: inline-block;
  padding-block: var(--space-1);
  color: var(--ground-ink);
  font-size: var(--text-label);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const External = styled.a`
  display: inline-block;
  padding-block: var(--space-1);
  color: var(--ground-ink);
  font-size: var(--text-label);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const Bottom = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;

  margin-top: var(--space-12);
  padding-top: var(--space-6);
  border-top: 1px solid var(--ground-border);
`;

const Fine = styled.p`
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export function MarketingFooter() {
  const year = new Date().getFullYear();
  const mail = emailUrl();
  const whatsapp = whatsappUrl();

  return (
    <Wrapper>
      <Container>
        <Top>
          <Brand>
            <Logo size={26} glow={false} />
            <Tagline>{site.tagline}</Tagline>
          </Brand>

          {footerNav.map((group) => {
            const items = enabled(group.items);
            // A heading over an empty list reads as a page that failed to load.
            if (items.length === 0) return null;

            return (
              <Group key={group.title} aria-label={group.title}>
                <GroupTitle>{group.title}</GroupTitle>
                <Items>
                  {items.map((item) => (
                    <li key={item.href}>
                      <FooterLink href={item.href}>{item.label}</FooterLink>
                    </li>
                  ))}
                </Items>
              </Group>
            );
          })}

          <Group aria-label="Contact">
            <GroupTitle>Contact</GroupTitle>
            <Items>
              {hasEmail() && mail && (
                <li>
                  <External
                    href={mail}
                    onClick={() => track('email_clicked', { location: 'footer' })}
                  >
                    {contact.email}
                  </External>
                </li>
              )}

              {flags.whatsapp && hasWhatsApp() && whatsapp && (
                <li>
                  <External
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      track('whatsapp_clicked', { location: 'footer' })
                    }
                  >
                    WhatsApp
                  </External>
                </li>
              )}

              {socialLinks.length > 0 &&
                enabled(socialLinks).map((item) => (
                  <li key={item.href}>
                    <External
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.label}
                    </External>
                  </li>
                ))}

              {/*
                Neither channel configured. Said plainly rather than leaving an
                empty column — and it is the visible symptom of OD-1/OD-2 being
                unanswered, which is exactly when someone should notice.
              */}
              {!hasEmail() && !hasWhatsApp() && (
                <li>
                  <Fine>Contact details coming soon.</Fine>
                </li>
              )}
            </Items>
          </Group>
        </Top>

        <Bottom>
          <Fine>
            © {year} {site.name}. All rights reserved.
          </Fine>
          <Fine>
            {site.launch.status === 'coming-soon'
              ? 'The platform is in development.'
              : null}
          </Fine>
        </Bottom>
      </Container>
    </Wrapper>
  );
}
