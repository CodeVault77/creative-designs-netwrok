'use client';

import styled from 'styled-components';
import { visionSketch } from '@/content/landing';
import { tokens } from '@/lib/styles/tokens.generated';

/**
 * The blueprint beside "Where this is going".
 *
 * The section above it has a working demonstration you can click. This one is
 * the same map and is deliberately the opposite of that: dashed edges, hollow
 * nodes, nothing to press. The visual language carries the honesty, so a
 * reader who skims the pictures and never reads a word still cannot come away
 * believing this part exists — which is the exact failure the tense rules in
 * `content/landing.ts` were written to prevent.
 *
 * The section already uses a dashed border on its "none of this is available
 * yet" label. This extends that, rather than introducing a second visual idea
 * for the same meaning.
 *
 * NOT interactive, and that is the point. Something you can expand is
 * something that works; a plan you can click is a promise.
 */

// ————————————————————————————————————————————————————— geometry

const VIEW = { w: 420, h: 272 };
const CENTRE = { x: 210, y: 138 };
const R = 100;

/**
 * Rounded for the same reason as the other two diagrams on this page: Node and
 * the browser disagree about the last bit of `Math.cos`, and an unrounded
 * coordinate serialises differently on the server and the client, which React
 * reports as a hydration mismatch on every page load.
 */
const round = (value: number) => Math.round(value * 100) / 100;

function at(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return {
    x: round(CENTRE.x + Math.cos(rad) * radius),
    y: round(CENTRE.y + Math.sin(rad) * radius),
  };
}

function percent(point: { x: number; y: number }) {
  return {
    left: `${round((point.x / VIEW.w) * 100)}%`,
    top: `${round((point.y / VIEW.h) * 100)}%`,
  };
}

const familyColour = (family: string) =>
  tokens.color.family[family as keyof typeof tokens.color.family];

// ————————————————————————————————————————————————————— layout

const Figure = styled.figure`
  margin: 0;
  width: 100%;
  max-width: 30rem;
`;

const Stage = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: ${VIEW.w} / ${VIEW.h};

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
`;

/**
 * Opaque fills, dashed borders.
 *
 * Opaque because edges run to each node's centre point and a transparent pill
 * has its own spoke printed across its label — the bug that cost two rounds on
 * the demo above. `--ground-raised` here rather than `--ground-background`,
 * because this section is toned `raised` and the pill must match what is
 * actually behind it.
 */
const Node = styled.span<{ $colour: string }>`
  position: absolute;
  transform: translate(-50%, -50%);

  display: inline-flex;
  align-items: center;
  justify-content: center;

  min-height: 34px;
  padding: 0 var(--space-3);

  background: var(--ground-raised);
  border: 1px dashed ${({ $colour }) => `${$colour}aa`};
  border-radius: var(--radius-pill);

  font-family: var(--face-body);
  font-size: var(--text-caption);
  white-space: nowrap;
  color: var(--ground-muted);
`;

const Centre = styled(Node)`
  border-style: dashed;
  border-width: 1.5px;
  color: var(--ground-ink);
  font-size: var(--text-label);
`;

const Caption = styled.figcaption`
  margin-top: var(--space-4);
  font-size: var(--text-caption);
  line-height: 1.5;
  color: var(--ground-muted);
`;

// ————————————————————————————————————————————————————— component

export function VisionSketch() {
  return (
    <Figure>
      <Stage>
        <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} fill="none" aria-hidden="true">
          {visionSketch.branches.map((branch) => {
            const point = at(branch.angle, R);
            return (
              <line
                key={branch.id}
                x1={CENTRE.x}
                y1={CENTRE.y}
                x2={point.x}
                y2={point.y}
                stroke={familyColour(branch.family)}
                strokeWidth="1.2"
                strokeOpacity="0.5"
                /* Dashed, like the borders and like the section's own label. */
                strokeDasharray="5 5"
              />
            );
          })}
        </svg>

        <Centre style={percent(CENTRE)} $colour={familyColour('organise')}>
          {visionSketch.centre}
        </Centre>

        {visionSketch.branches.map((branch) => (
          <Node
            key={branch.id}
            style={percent(at(branch.angle, R))}
            $colour={familyColour(branch.family)}
          >
            {branch.label}
          </Node>
        ))}
      </Stage>

      <Caption>{visionSketch.caption}</Caption>
    </Figure>
  );
}
