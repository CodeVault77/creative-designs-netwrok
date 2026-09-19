'use client';

import Link from 'next/link';
import styled from 'styled-components';
import type { FamilyName } from '@/lib/styles/tokens.generated';
import { featuredServices, activeServices } from '@/config';
import { servicesSection } from '@/content/landing';
import { track } from '@/lib/analytics';
import { Section } from './Section';

/**
 * B3 — the service grid.
 *
 * Reads entirely from `config/services.ts`. Adding, renaming, reordering or
 * withdrawing a service is a config edit with no change here (AC-18), which is
 * the point: the twelve categories supplied are a starting catalogue, not a
 * fixed product architecture.
 */

const Grid = styled.ul`
  display: grid;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;

  /*
   * auto-fit with a minimum rather than fixed column counts, so the grid
   * reflows at every width instead of at three chosen breakpoints. 260px is
   * the narrowest a card can be before the summary wraps to five lines.
   */
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));

  /*
   * Capped at three on desktop. Left to auto-fit, a 1200px container makes
   * four columns, and six featured services then render as 4 + 2 with a
   * stranded pair. Three columns divides the featured set evenly and keeps
   * each summary on two lines rather than four.
   */
  @media (min-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);
  }
`;

const Card = styled.li<{ $family: FamilyName }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-6);

  background: var(--ground-surface);
  border: 1px solid var(--ground-border);
  /* The hue enters as one edge, not a fill — colour is emission (§11.1). */
  border-top: 2px solid ${({ $family }) => `var(--fam-${$family}-core)`};
  border-radius: var(--radius-card);

  transition: border-color 200ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  &:hover {
    border-color: ${({ $family }) => `var(--fam-${$family}-core)`};
  }
`;

const Name = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const Summary = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.55;
  color: var(--ground-muted);
`;

const Foot = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-6);
`;

const More = styled(Link)`
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--fam-discover-core);
  font-size: var(--text-label);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const Count = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export interface ServiceGridProps {
  /** `featured` on the landing page; `all` on /services. */
  scope?: 'featured' | 'all';
  showMoreLink?: boolean;
}

export function ServiceGrid({
  scope = 'featured',
  showMoreLink = true,
}: ServiceGridProps) {
  const shown = scope === 'featured' ? featuredServices() : activeServices();
  const total = activeServices().length;
  const remaining = total - shown.length;

  return (
    <Section
      id={servicesSection.id}
      title={servicesSection.title}
      intro={servicesSection.intro}
    >
      <Grid>
        {shown.map((service) => (
          <Card key={service.id} $family={service.family}>
            <Name>{service.name}</Name>
            <Summary>{service.summary}</Summary>
          </Card>
        ))}
      </Grid>

      {showMoreLink && remaining > 0 && (
        <Foot>
          <More
            href={servicesSection.cta.href}
            onClick={() =>
              track('marketing_cta_clicked', {
                cta_id: 'services-more',
                section: 'services',
              })
            }
          >
            {servicesSection.cta.label} →
          </More>
          <Count>
            {remaining} more {remaining === 1 ? 'service' : 'services'}
          </Count>
        </Foot>
      )}
    </Section>
  );
}
