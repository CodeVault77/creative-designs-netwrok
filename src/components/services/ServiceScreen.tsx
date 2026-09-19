'use client';

import styled from 'styled-components';
import type { Service } from '@/lib/services/catalogue';
import { EnquiryForm } from './EnquiryForm';

/**
 * Screen 17 — the service node (§08).
 *
 * "Sell a service; capture enquiries." §20 calls P12 "the first money path"
 * and notes: do it early if cash matters more than polish. So the page is
 * arranged around the one action that produces revenue — the form is reachable
 * from the top, repeated at the bottom, and never more than a scroll away.
 *
 * ServiceHero, CapabilityList, WorkGrid and EnquiryForm are the four named
 * components; the first three are simple enough to live here rather than
 * become four files that are each one styled block.
 */

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-6) var(--space-8);
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
`;

// ---------------------------------------------------------------- ServiceHero

const Hero = styled.header`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`;

const Eyebrow = styled.span<{ $family: string }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;

  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  border: 1px solid ${({ $family }) => `var(--fam-${$family}-core)`};
  background: ${({ $family }) => `var(--fam-${$family}-wash)`};

  font-size: var(--text-caption);
  color: var(--ground-ink);
`;

const Title = styled.h1`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-l);
  line-height: 1.1;
  color: var(--ground-ink);
`;

const Tagline = styled.p`
  margin: 0;
  font-size: var(--text-title);
  color: var(--ground-ink);
  max-width: 34ch;
`;

const Intro = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.6;
  color: var(--ground-muted);
  max-width: 62ch;
`;

const Actions = styled.div`
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  align-items: center;
  padding-top: var(--space-2);
`;

const Primary = styled.a<{ $family: string }>`
  display: inline-flex;
  align-items: center;
  min-height: var(--control-buttonHeight);
  padding: 0 var(--space-6);

  border-radius: var(--radius-control);
  border: 1.5px solid ${({ $family }) => `var(--fam-${$family}-core)`};
  background: ${({ $family }) => `var(--fam-${$family}-wash)`};

  color: var(--ground-ink);
  font-family: var(--face-body);
  font-size: var(--control-fontSize);
  text-decoration: none;
`;

// ------------------------------------------------------------- CapabilityList

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const Capabilities = styled.ul`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Capability = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
`;

const CapabilityTitle = styled.h3`
  margin: 0;
  font-size: var(--text-label);
  color: var(--ground-ink);
`;

const CapabilityDetail = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.55;
  color: var(--ground-muted);
`;

// ------------------------------------------------------------------- WorkGrid

const Work = styled.ul`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const WorkItem = styled.li<{ $family: string }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);

  background: var(--ground-raised);
  border: 1px solid var(--ground-border);
  border-left: 3px solid ${({ $family }) => `var(--fam-${$family}-core)`};
  border-radius: var(--radius-card);
`;

const Client = styled.span`
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Outcome = styled.p`
  margin: 0;
  font-size: var(--text-body);
  color: var(--ground-ink);
`;

// ------------------------------------------------------------------- TrustRow

const Trust = styled.ul`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const TrustItem = styled.li`
  font-size: var(--text-body);
  color: var(--ground-muted);
`;

const PriceNote = styled.p`
  margin: 0;
  padding: var(--space-4);
  background: var(--ground-raised);
  border: 1px dashed var(--ground-border);
  border-radius: var(--radius-card);
  font-size: var(--text-body);
  color: var(--ground-ink);
`;

const SoonBadge = styled.span`
  margin-left: var(--space-2);
  padding: 1px var(--space-2);
  border: 1px dashed var(--ground-border);
  border-radius: var(--radius-pill);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export function ServiceScreen({ service }: { service: Service }) {
  return (
    <Page>
      <Hero>
        <Eyebrow $family={service.family}>Service</Eyebrow>
        <Title>{service.name}</Title>
        <Tagline>{service.tagline}</Tagline>
        <Intro>{service.intro}</Intro>
        <Actions>
          {/* §08 screen 17's primary action: "Start a project". */}
          <Primary href="#enquiry" $family={service.family}>
            Start a project
          </Primary>
        </Actions>
      </Hero>

      <Section>
        <SectionTitle>What we do</SectionTitle>
        <Capabilities>
          {service.capabilities.map((capability) => (
            <Capability key={capability.title}>
              <CapabilityTitle>{capability.title}</CapabilityTitle>
              <CapabilityDetail>{capability.detail}</CapabilityDetail>
            </Capability>
          ))}
        </Capabilities>
      </Section>

      {/*
        §08 screen 17's empty state: "No case studies: capability list only."
        The section is absent rather than present-and-empty, because a heading
        over nothing reads as a page that failed to load.
      */}
      {service.work.length > 0 && (
        <Section>
          <SectionTitle>Selected work</SectionTitle>
          <Work>
            {service.work.map((item) => (
              <WorkItem key={item.title} $family={item.family}>
                <Client>{item.client}</Client>
                <CapabilityTitle as="h3">{item.title}</CapabilityTitle>
                <CapabilityDetail>{item.summary}</CapabilityDetail>
                <Outcome>{item.outcome}</Outcome>
              </WorkItem>
            ))}
          </Work>
        </Section>
      )}

      <Section>
        <SectionTitle>
          What it costs
          {/* §08 screen 17: "Pricing and checkout marked Soon; enquiry is live." */}
          <SoonBadge>Checkout soon</SoonBadge>
        </SectionTitle>
        <PriceNote>{service.priceNote}</PriceNote>
        <Trust>
          {service.trust.map((line) => (
            <TrustItem key={line}>{line}</TrustItem>
          ))}
        </Trust>
      </Section>

      <Section id="enquiry">
        <SectionTitle>Start a project</SectionTitle>
        <EnquiryForm service={service} />
      </Section>
    </Page>
  );
}
