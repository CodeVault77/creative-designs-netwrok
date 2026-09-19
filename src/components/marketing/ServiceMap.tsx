'use client';

import { Fragment, useId, useState } from 'react';
import Link from 'next/link';
import styled from 'styled-components';
import { activeServices, featuredServices } from '@/config';
import { servicesSection } from '@/content/landing';
import { track } from '@/lib/analytics';
import { tokens, type FamilyName } from '@/lib/styles/tokens.generated';
import { Section } from './Section';

/**
 * B3 — the service map. Replaces `ServiceGrid` on the landing page.
 *
 * Two halves of one control, and neither is decoration:
 *
 *   index   the scannable list. Six buttons, numbered, keyboard operable.
 *           This is what a reader who never touches the map still gets.
 *   map     the same six services as a centre and a ring, in the product's
 *           own polar language, plus the six non-featured services as an
 *           outer ring — which is what "6 more services" now looks like.
 *
 * The numbers are the join between them. Nodes are UNLABELLED on purpose:
 * six service names around a 460-unit circle either collide or shrink below
 * the 12px canvas-legibility floor, and the index already carries them.
 *
 * ── Why this is SVG and not the real renderer ───────────────────────────────
 *
 * Same argument as `NetworkDiagram`: §22 budgets this page at 120KB of JS and
 * `lib/map` alone exceeds it. This is ~3KB of markup, one piece of state, and
 * no layout engine. It is a picture of the map, not the map.
 *
 * ── Selection is the only state ─────────────────────────────────────────────
 *
 * No hover state drives content — a hover-only readout is invisible on touch
 * and to a keyboard. Hover paints the row and nothing else.
 */

// --------------------------------------------------------------------- data

/**
 * The stage chain shown in the readout.
 *
 * Every step is a phrase already present in that service's `summary` or
 * `detail` in `config/services.ts` — the readout paraphrases nothing and adds
 * no capability the catalogue has not already claimed. Services with no entry
 * render the sentence alone, which is the correct fallback rather than an
 * invented chain.
 *
 * Lives here rather than in config because it is a presentation of the copy,
 * not part of the catalogue: adding a service must not require inventing one.
 */
const CHAINS: Record<string, readonly string[]> = {
  'full-stack-web': ['Data model', 'Server', 'Interface', 'Deploy'],
  'web-applications': ['Dashboards', 'Tools', 'Platforms'],
  'ui-ux-design': ['Research', 'Flows', 'Interface', 'Real data'],
  'ai-development': ['Evaluation', 'Approach', 'Feature'],
  'api-integrations': ['Systems you pay for', 'One place'],
  'custom-software': ['One business', 'One build'],
};

// ----------------------------------------------------------------- geometry

const CENTRE = { x: 230, y: 230 };
const R_RING = 150;
const R_OUTER = 200;

/** Fixed angular slots, as §09 requires — position never encodes weight. */
const RING_SLOTS = [-90, -30, 30, 90, 150, 210];
const OUTER_SLOTS = [-60, 0, 60, 120, 180, 240];

/**
 * Rounded to two decimals, and that rounding is load-bearing.
 *
 * Node and the browser disagree on the last bit of `Math.cos`, so an unrounded
 * `cx` differs between the server HTML and the first client render and React
 * reports a hydration mismatch on every load. Identical to `NetworkDiagram`,
 * for the identical reason.
 */
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A slot angle that is always in range.
 *
 * The slot arrays are sized for the six services featured today. Indexing them
 * directly is an unchecked assumption about `config/services.ts` — feature a
 * seventh and `RING_SLOTS[6]` is undefined, which becomes NaN coordinates and
 * a node that silently vanishes. Wrapping keeps every service on the ring; it
 * would double up a position before it would lose one, which is the better
 * failure of the two.
 */
const slotAt = (slots: readonly number[], index: number) =>
  slots[index % slots.length]!;

const at = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180;
  return {
    x: round(CENTRE.x + Math.cos(rad) * radius),
    y: round(CENTRE.y + Math.sin(rad) * radius),
  };
};

const hue = (family: FamilyName) => tokens.familyRamp[family].core;
const wash = (family: FamilyName) => tokens.familyRamp[family].wash;

// -------------------------------------------------------------------- layout

/**
 * The hairline under the section header, carrying the catalogue count.
 *
 * `Section` owns the title and intro and deliberately has no slot beside
 * them; a first child is the correct place for this rather than a new prop on
 * a primitive two other sections share.
 */
const Rule = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: calc(var(--space-8) * -1);
  margin-bottom: var(--space-12);
  padding-bottom: var(--space-6);
  border-bottom: 1px solid var(--ground-border);
`;

const Split = styled.div`
  display: grid;
  gap: var(--space-8);
  align-items: start;

  /*
   * One column until there is room for both halves side by side. The map is
   * useless at 300px and the index is what matters on a phone, so the index
   * comes first in the DOM and stays first when it wraps.
   */
  @media (min-width: 900px) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    gap: var(--space-16);
  }
`;

const Eyebrow = styled.p`
  margin: 0 0 var(--space-4);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: ${tokens.typography.tracking.uppercase};
  text-transform: uppercase;
  color: var(--ground-muted);
`;

const Index = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`;

/**
 * A row is a button, not a link.
 *
 * It changes what is displayed beside it; it does not navigate. `aria-pressed`
 * rather than `aria-selected` because these are not tabs — the readout is not
 * a tabpanel and calling it one would promise arrow-key navigation that a
 * six-item list does not need.
 */
const Row = styled.button<{ $family: FamilyName; $on: boolean }>`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  column-gap: var(--space-4);
  align-items: baseline;

  width: 100%;
  text-align: left;
  appearance: none;
  cursor: pointer;

  padding: var(--space-4) var(--space-4) var(--space-4) 14px;
  border: 0;
  /* Selection differs in three channels, never hue alone (§10). */
  border-left: 2px solid
    ${({ $family, $on }) => ($on ? hue($family) : 'var(--ground-border)')};
  background: ${({ $family, $on }) => ($on ? wash($family) : 'transparent')};

  transition:
    background-color 200ms ease,
    border-color 200ms ease;

  &:hover {
    background: ${({ $family, $on }) =>
      $on ? wash($family) : 'rgba(255, 255, 255, 0.03)'};
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const RowNumber = styled.span<{ $family: FamilyName; $on: boolean }>`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: ${({ $family, $on }) => ($on ? hue($family) : 'var(--ground-muted)')};
`;

const RowText = styled.span`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`;

/* Labels are always ink, never the family hue (§11.1). */
const RowName = styled.span`
  font-family: var(--face-display);
  font-weight: ${tokens.typography.weight.semibold};
  font-size: var(--text-title);
  line-height: 1.3;
  color: var(--ground-ink);
`;

const RowSummary = styled.span`
  font-size: var(--text-label);
  line-height: 1.5;
  color: var(--ground-muted);
`;

const Foot = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-6);
  padding-left: var(--space-4);
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

// ----------------------------------------------------------------------- map

const Figure = styled.div`
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
`;

/**
 * The one ambient animation the tokens allow, on the one element allowed to
 * have it: the centre. 4000ms, 0.04 opacity delta, stopped under reduced
 * motion by `GlobalStyle`'s global rule.
 */
const Centre = styled.g`
  /*
   * duration.breathe is a plain string in tokens.generated, not an object
   * with a value field. Reading .value put undefined into the shorthand,
   * which browsers drop silently — no animation, and no error to notice.
   */
  animation: cdn-service-breathe ${tokens.motion.duration.breathe} ease-in-out
    infinite;

  @keyframes cdn-service-breathe {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: ${1 - tokens.motion.breatheOpacityDelta};
    }
  }
`;

const Node = styled.g`
  cursor: pointer;
`;

// -------------------------------------------------------------------- readout

const Readout = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-8);
  padding-top: var(--space-6);
  border-top: 1px solid var(--ground-border);
`;

const ReadoutHead = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
`;

const ReadoutIndex = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  letter-spacing: ${tokens.typography.tracking.uppercase};
  color: var(--ground-muted);
`;

const ReadoutName = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-m);
  line-height: 1.2;
  color: var(--ground-ink);
`;

const Chain = styled.ol`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Step = styled.li`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: ${tokens.typography.tracking.uppercase};
  text-transform: uppercase;
  color: var(--ground-ink);

  padding: 6px 10px;
  background: var(--ground-surface);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-chip);
`;

const Arrow = styled.li<{ $family: FamilyName }>`
  color: ${({ $family }) => hue($family)};
  font-size: var(--text-caption);
  line-height: 1;
`;

const Detail = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.6;
  color: var(--ground-muted);
  max-width: 54ch;
  text-wrap: pretty;
`;

const Meta = styled.p`
  margin: 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: ${tokens.typography.tracking.uppercase};
  text-transform: uppercase;
  color: var(--ground-muted);
  white-space: nowrap;
`;

// ------------------------------------------------------------------ component

export function ServiceMap() {
  const shown = featuredServices();
  const total = activeServices().length;
  const rest = activeServices().filter((service) => !service.featured);
  const remaining = rest.length;

  const [selected, setSelected] = useState(0);

  /*
   * Falls back to the first service rather than trusting the index.
   *
   * `selected` is only ever set from this list, but the list comes from
   * config: switching a featured service off between renders would leave the
   * index pointing past the end, and every read of `current` below would
   * throw. A section that quietly shows the first service beats one that
   * takes the page down.
   */
  const current = shown[selected] ?? shown[0];

  /**
   * SVG ids must be unique per document, and this component is rendered on
   * both `/` and `/services`. A hardcoded `#halo-discover` would make the
   * second instance reference the first one's gradient.
   */
  const uid = useId().replace(/:/g, '');
  const halo = (family: FamilyName) => `svc-halo-${family}-${uid}`;
  const ringId = `svc-ring-${uid}`;

  const label = (index: number) => String(index + 1).padStart(2, '0');

  // Nothing featured means nothing to map. Rendering the frame around an empty
  // ring would be a section announcing that there is no answer to its title.
  if (!current) return null;

  const chain = CHAINS[current.id] ?? [];

  return (
    <Section
      id={servicesSection.id}
      title={servicesSection.title}
      intro={servicesSection.intro}
    >
      {/*
        Honest count, not a boast: six of the twelve enabled services are
        featured here, and both numbers come from the catalogue.
      */}
      <Rule>
        <Meta>
          Studio · {label(shown.length - 1)} of {total} active
        </Meta>
      </Rule>

      <Split>
        {/* ------------------------------------------------------- the index */}
        <div>
          <Eyebrow>Featured services</Eyebrow>

          <Index>
            {shown.map((service, index) => (
              <li key={service.id}>
                <Row
                  type="button"
                  $family={service.family}
                  $on={index === selected}
                  aria-pressed={index === selected}
                  onClick={() => setSelected(index)}
                >
                  <RowNumber $family={service.family} $on={index === selected}>
                    {label(index)}
                  </RowNumber>
                  <RowText>
                    <RowName>{service.name}</RowName>
                    <RowSummary>{service.summary}</RowSummary>
                  </RowText>
                </Row>
              </li>
            ))}
          </Index>

          {remaining > 0 && (
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
        </div>

        {/* --------------------------------------------- the map and readout */}
        <div>
          <Figure>
            <svg
              viewBox="0 0 460 460"
              fill="none"
              /*
               * Labelled, not hidden: the arrangement is part of the
               * explanation. `role="img"` stops a screen reader announcing
               * fifty circles. The nodes are a pointer shortcut to a control
               * the index already exposes to the keyboard, so they are not
               * separately focusable — there is nothing here that cannot be
               * reached from the list beside it.
               */
              role="img"
              aria-label={`A radial map of the studio: a centre node with the ${shown.length} featured services in a ring around it, and the ${remaining} remaining services on an outer ring.`}
            >
              <defs>
                {shown.map((service) => (
                  <radialGradient key={service.id} id={halo(service.family)}>
                    <stop
                      offset="0%"
                      stopColor={hue(service.family)}
                      stopOpacity="0.55"
                    />
                    <stop
                      offset="100%"
                      stopColor={hue(service.family)}
                      stopOpacity="0"
                    />
                  </radialGradient>
                ))}

                <radialGradient id={`svc-centre-${uid}`}>
                  <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
                </radialGradient>

                {/* The mark's gradient, so the centre reads as the brand. */}
                <linearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#2FD9F5" />
                  <stop offset="35%" stopColor="#8B5CF6" />
                  <stop offset="70%" stopColor="#FF4D97" />
                  <stop offset="100%" stopColor="#FF8A3D" />
                </linearGradient>
              </defs>

              {/* Orbits. Hairlines, so the rings read as structure not decoration. */}
              <circle
                cx={CENTRE.x}
                cy={CENTRE.y}
                r={R_RING}
                stroke="var(--ground-border)"
                strokeWidth="1"
              />
              <circle
                cx={CENTRE.x}
                cy={CENTRE.y}
                r={R_OUTER}
                stroke="var(--ground-raised)"
                strokeWidth="1"
              />

              {/* The six non-featured services, each tethered to its neighbour. */}
              <g opacity="0.45">
                {rest.map((service, index) => {
                  const outer = at(slotAt(OUTER_SLOTS, index), R_OUTER);
                  const inner = at(slotAt(RING_SLOTS, index), R_RING);
                  return (
                    <g key={service.id}>
                      <line
                        x1={inner.x}
                        y1={inner.y}
                        x2={outer.x}
                        y2={outer.y}
                        stroke={hue(service.family)}
                        strokeWidth="1"
                      />
                      <circle
                        cx={outer.x}
                        cy={outer.y}
                        r="5"
                        fill={hue(service.family)}
                        fillOpacity="0.6"
                      />
                    </g>
                  );
                })}
              </g>

              {/* Spokes. */}
              {shown.map((service, index) => {
                const point = at(slotAt(RING_SLOTS, index), R_RING);
                return (
                  <line
                    key={`spoke-${service.id}`}
                    x1={CENTRE.x}
                    y1={CENTRE.y}
                    x2={point.x}
                    y2={point.y}
                    stroke={hue(service.family)}
                    strokeWidth="1.4"
                    strokeOpacity="0.65"
                  />
                );
              })}

              {/*
                Selection: a pre-baked radial halo plus the white ring from
                glow-3. NEVER a `filter` or `box-shadow` on the node — the same
                rule the canvas renderer lives by (§16, ADR-0008).
              */}
              {(() => {
                const point = at(slotAt(RING_SLOTS, selected), R_RING);
                return (
                  <>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="62"
                      fill={`url(#${halo(current.family)})`}
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="32"
                      stroke="rgba(255,255,255,0.10)"
                      strokeWidth="4"
                    />
                  </>
                );
              })()}

              {/* The featured six. */}
              {shown.map((service, index) => {
                const point = at(slotAt(RING_SLOTS, index), R_RING);
                return (
                  <Node
                    key={service.id}
                    onClick={() => setSelected(index)}
                    aria-hidden="true"
                  >
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="26"
                      fill="var(--ground-surface)"
                      stroke={hue(service.family)}
                      strokeWidth="2"
                    />
                    <text
                      x={point.x}
                      y={point.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="var(--ground-ink)"
                      fontFamily="var(--face-mono)"
                      fontSize="13"
                    >
                      {label(index)}
                    </text>
                  </Node>
                );
              })}

              <Centre>
                <circle
                  cx={CENTRE.x}
                  cy={CENTRE.y}
                  r="96"
                  fill={`url(#svc-centre-${uid})`}
                />
                <circle
                  cx={CENTRE.x}
                  cy={CENTRE.y}
                  r="54"
                  fill="var(--ground-background)"
                  stroke={`url(#${ringId})`}
                  strokeWidth="2.5"
                />
                <text
                  x={CENTRE.x}
                  y={CENTRE.y - 7}
                  textAnchor="middle"
                  fill="var(--ground-ink)"
                  fontFamily="var(--face-display)"
                  fontWeight="700"
                  fontSize="15"
                  letterSpacing="1.6"
                >
                  STUDIO
                </text>
                <text
                  x={CENTRE.x}
                  y={CENTRE.y + 13}
                  textAnchor="middle"
                  fill="var(--ground-muted)"
                  fontFamily="var(--face-mono)"
                  fontSize="10"
                  letterSpacing="1.4"
                >
                  {total} SERVICES
                </text>
              </Centre>
            </svg>
          </Figure>

          {/*
            `aria-live="polite"` so a screen-reader user who presses a row is
            told what changed. Polite, not assertive: it is a readout, not an
            alert, and it must not interrupt the row label being read.
          */}
          <Readout aria-live="polite">
            <ReadoutHead>
              <ReadoutIndex>
                {label(selected)} / {label(shown.length - 1)}
              </ReadoutIndex>
              <ReadoutName>{current.name}</ReadoutName>
            </ReadoutHead>

            {chain.length > 0 && (
              <Chain>
                {chain.map((step, index) => (
                  <Fragment key={step}>
                    <Step>{step}</Step>
                    {index < chain.length - 1 && (
                      <Arrow $family={current.family} aria-hidden="true">
                        →
                      </Arrow>
                    )}
                  </Fragment>
                ))}
              </Chain>
            )}

            <Detail>{current.detail ?? current.summary}</Detail>
          </Readout>
        </div>
      </Split>
    </Section>
  );
}
