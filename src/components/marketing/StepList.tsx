'use client';

import styled from 'styled-components';
import { howItWorks, what } from '@/content/landing';
import { Section } from './Section';
import { NetworkDiagram } from './NetworkDiagram';
import { ExpandingMap } from './ExpandingMap';

/**
 * B2 — "What is CDN?" and "How it works".
 *
 * Two sections in one file because they are one argument: the first says what
 * this is in prose, the second makes it concrete with a diagram and three
 * steps. Splitting them across files would mean reading two files to check one
 * explanation still holds together.
 */

const Prose = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 68ch;

  p {
    margin: 0;
    font-size: var(--text-body);
    line-height: 1.65;
    color: var(--ground-muted);
  }

  /*
   * The first paragraph carries the weight — many readers stop after it.
   * Larger and in ink rather than muted.
   */
  p:first-child {
    font-size: var(--text-title);
    line-height: 1.5;
    color: var(--ground-ink);
  }
`;

const Split = styled.div`
  display: grid;
  gap: var(--space-8);
  align-items: center;
  grid-template-columns: 1fr;

  @media (min-width: 900px) {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-12);
  }
`;

/**
 * Prose beside the demonstration.
 *
 * The demo goes SECOND in source order, so a screen reader and a phone both
 * get the explanation before the illustration of it. On a wide screen the two
 * sit side by side, because the paragraph and the thing it describes are worth
 * reading against each other.
 */
const WhatSplit = styled.div`
  display: grid;
  gap: var(--space-8);
  align-items: center;
  grid-template-columns: 1fr;

  @media (min-width: 900px) {
    grid-template-columns: 1.1fr 1fr;
    gap: var(--space-12);
  }
`;

const Steps = styled.ol`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
`;

const Step = styled.li`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-4);
  align-items: start;
`;

const Number = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;

  border: 1px solid var(--ground-border);
  border-radius: var(--radius-circle);
  background: var(--ground-surface);

  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--fam-discover-core);
`;

const StepBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`;

const StepTitle = styled.h3`
  margin: 0;
  font-size: var(--text-title);
  font-family: var(--face-display);
  color: var(--ground-ink);
`;

const StepText = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.6;
  color: var(--ground-muted);
`;

export function WhatIsCdn() {
  return (
    <Section id={what.id} title={what.title} as="h2">
      <WhatSplit>
        <Prose>
          {what.body.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
        </Prose>

        <ExpandingMap />
      </WhatSplit>
    </Section>
  );
}

export function HowItWorks() {
  return (
    <Section
      id={howItWorks.id}
      title={howItWorks.title}
      intro={howItWorks.intro}
      tone="raised"
    >
      <Split>
        <Steps>
          {howItWorks.steps.map((step) => (
            <Step key={step.number}>
              <Number aria-hidden="true">{step.number}</Number>
              <StepBody>
                <StepTitle>{step.title}</StepTitle>
                <StepText>{step.body}</StepText>
              </StepBody>
            </Step>
          ))}
        </Steps>

        <NetworkDiagram />
      </Split>
    </Section>
  );
}
