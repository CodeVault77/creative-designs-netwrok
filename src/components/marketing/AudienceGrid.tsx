'use client';

import styled from 'styled-components';
import type { FamilyName } from '@/lib/styles/tokens.generated';
import { audiences, vision } from '@/content/landing';
import { Section } from './Section';
import { VisionSketch } from './VisionSketch';

/**
 * B4 — "Who it is for" and "Where this is going".
 *
 * Paired because they do opposite halves of the same job: the first helps a
 * reader recognise themselves, the second says what is coming without
 * pretending it has arrived.
 */

const Grid = styled.ul`
  display: grid;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
`;

const Card = styled.li<{ $family: FamilyName }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-6);

  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  background: var(--ground-surface);

  /* A hairline of hue, so four cards read as a set rather than a wall. */
  box-shadow: inset 3px 0 0 ${({ $family }) => `var(--fam-${$family}-core)`};
`;

const Title = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  color: var(--ground-ink);
`;

const Body = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.55;
  color: var(--ground-muted);
`;

// ---------------------------------------------------------------- the vision

/**
 * The prose and the blueprint, side by side on a wide screen.
 *
 * The sketch comes second in source order so a screen reader and a phone both
 * get the words — including "none of this is available yet" — before the
 * picture of it.
 */
const VisionSplit = styled.div`
  display: grid;
  gap: var(--space-8);
  align-items: center;
  grid-template-columns: 1fr;

  @media (min-width: 900px) {
    grid-template-columns: 1.1fr 1fr;
    gap: var(--space-12);
  }
`;

const VisionWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 68ch;
`;

/**
 * The vision framing (§7.2).
 *
 * A visible label, not a footnote. Everything in this section is a plan, and a
 * reader who skims must not come away believing any of it already works —
 * which is exactly the failure the tense rules exist to prevent.
 */
const Label = styled.p`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  margin: 0;

  padding: var(--space-1) var(--space-3);
  border: 1px dashed var(--fam-organise-core);
  border-radius: var(--radius-pill);

  font-size: var(--text-caption);
  color: var(--ground-ink);
`;

const VisionText = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.65;
  color: var(--ground-muted);
`;

const Note = styled.p`
  margin: 0;
  padding-top: var(--space-4);
  border-top: 1px solid var(--ground-border);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

export function AudienceGrid() {
  return (
    <Section id={audiences.id} title={audiences.title}>
      <Grid>
        {audiences.items.map((item) => (
          <Card key={item.title} $family={item.family}>
            <Title>{item.title}</Title>
            <Body>{item.body}</Body>
          </Card>
        ))}
      </Grid>
    </Section>
  );
}

export function VisionBlock() {
  return (
    <Section id={vision.id} title={vision.title} tone="raised">
      <VisionSplit>
        <VisionWrap>
          <Label>{vision.lead}</Label>

          {vision.body.map((paragraph) => (
            <VisionText key={paragraph.slice(0, 32)}>{paragraph}</VisionText>
          ))}

          <Note>{vision.note}</Note>
        </VisionWrap>

        <VisionSketch />
      </VisionSplit>
    </Section>
  );
}
