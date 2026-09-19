'use client';

import styled from 'styled-components';

/**
 * B2 — the static network diagram.
 *
 * "Node-based expandable network" is abstract until someone sees one. This is
 * the cheapest honest way to show it: a centre, a ring of six, and a second
 * ring fading outward.
 *
 * STATIC by decision. The real thing is a canvas renderer that already exists
 * in this repository, and importing it here would be both the easiest and the
 * worst option available — it would pull the layout engine, the sprite cache
 * and the gesture model into the landing page bundle to draw a picture that
 * never moves. §22 budgets this page at 120KB of JavaScript; the renderer
 * alone exceeds that. Hence the structural test in `marketing.test.ts`.
 *
 * Roughly 2KB of inline SVG, no JavaScript, no layout shift.
 */

const Figure = styled.figure`
  margin: 0;
  width: 100%;

  svg {
    display: block;
    width: 100%;
    height: auto;
  }
`;

/** Ring one, at fixed angles. Hues are the product's own families. */
const RING_ONE = [
  { angle: -90, colour: '#A3E635' },
  { angle: -30, colour: '#2FD9F5' },
  { angle: 30, colour: '#8B5CF6' },
  { angle: 90, colour: '#FF4D97' },
  { angle: 150, colour: '#FF8A3D' },
  { angle: 210, colour: '#2DD4BF' },
];

const CENTRE = { x: 200, y: 150 };
const R1 = 92;
const R2 = 138;

/**
 * Rounded, and that rounding is load-bearing.
 *
 * Node and the browser disagree with each other about the last bit of
 * `Math.cos` — 104.13714487665834 against 104.13714487665835 — so the server
 * HTML and the first client render produced different `x2` attributes and
 * React reported a hydration mismatch on every page load. Two decimal places
 * is far below a pixel at any width this renders at, and it is identical
 * everywhere.
 */
const round = (value: number) => Math.round(value * 100) / 100;

const at = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180;
  return {
    x: round(CENTRE.x + Math.cos(rad) * radius),
    y: round(CENTRE.y + Math.sin(rad) * radius),
  };
};

export function NetworkDiagram({ caption }: { caption?: string }) {
  return (
    <Figure>
      <svg
        viewBox="0 0 400 300"
        fill="none"
        /*
         * Labelled rather than hidden: the shape IS the explanation here, so a
         * screen reader gets a sentence describing what a sighted reader sees.
         * `role="img"` stops it announcing every child element.
         */
        role="img"
        aria-label="A central node with six nodes in a ring around it, and a further ring of smaller nodes beyond that, fading outward."
      >
        <defs>
          <radialGradient id="cdn-diagram-centre">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ring two, drawn first so ring one sits over it. */}
        {RING_ONE.map((node, index) => {
          const inner = at(node.angle, R1);
          return [-16, 16].map((offset) => {
            const outer = at(node.angle + offset, R2);
            return (
              <g key={`${index}-${offset}`} opacity="0.4">
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={node.colour}
                  strokeWidth="1"
                  strokeOpacity="0.5"
                />
                <circle
                  cx={outer.x}
                  cy={outer.y}
                  r="4"
                  fill={node.colour}
                  fillOpacity="0.6"
                />
              </g>
            );
          });
        })}

        {/* Spokes from the centre. */}
        {RING_ONE.map((node, index) => {
          const point = at(node.angle, R1);
          return (
            <line
              key={`spoke-${index}`}
              x1={CENTRE.x}
              y1={CENTRE.y}
              x2={point.x}
              y2={point.y}
              stroke={node.colour}
              strokeWidth="1.4"
              strokeOpacity="0.65"
            />
          );
        })}

        {/* Ring one. */}
        {RING_ONE.map((node, index) => {
          const point = at(node.angle, R1);
          return (
            <g key={`node-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r="15"
                fill="#0D0E17"
                stroke={node.colour}
                strokeWidth="2"
              />
              <circle cx={point.x} cy={point.y} r="4.5" fill={node.colour} />
            </g>
          );
        })}

        {/* The centre. */}
        <circle
          cx={CENTRE.x}
          cy={CENTRE.y}
          r="62"
          fill="url(#cdn-diagram-centre)"
        />
        <circle
          cx={CENTRE.x}
          cy={CENTRE.y}
          r="30"
          fill="#07070C"
          stroke="#8B5CF6"
          strokeWidth="2.5"
        />
        <circle cx={CENTRE.x} cy={CENTRE.y} r="7" fill="#FF4D97" />
      </svg>

      {caption && <figcaption>{caption}</figcaption>}
    </Figure>
  );
}
