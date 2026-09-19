'use client';

import { useState } from 'react';
import styled, { css } from 'styled-components';
import { whatDemo } from '@/content/landing';
import { tokens } from '@/lib/styles/tokens.generated';

/**
 * The demonstration inside "What is Creative Design Networks?".
 *
 * The section's second paragraph makes a claim that prose cannot settle and a
 * static picture only asserts: that things sit on a map which expands outward
 * as far as it needs to go. So the reader expands one. Selecting a node opens
 * its children in place — the single gesture the whole product is built on,
 * performed once, on six nodes, before anyone has signed up for anything.
 *
 * Three constraints shaped every decision below.
 *
 * 1. Section 22 budgets this page at 120KB of JavaScript. The real map
 *    renderer lives in this repository and importing it here would be the
 *    easiest and worst option available — the layout engine, sprite cache and
 *    gesture model exceed the entire budget on their own. This is hand-drawn
 *    SVG plus one piece of state, and marketing.test.ts enforces that.
 *
 * 2. The nodes are real HTML buttons layered over the SVG, not g elements
 *    wearing role="button". SVG text does not scale readably — a 12px label in
 *    a 420-unit viewBox renders at 9px on a 320px phone — and hand-rolled
 *    button semantics are a reliable way to lose focus rings, Enter/Space and
 *    target size all at once. The SVG draws edges and glow and is hidden from
 *    assistive technology; the buttons carry the meaning.
 *
 * 3. One branch open at a time. It keeps a 320px screen legible, and it is
 *    what selecting a node actually does.
 *
 * Honesty (AC-19): the caption says this is an illustration and that the
 * platform is still being built. It is a diagram of an idea, not a screenshot
 * of a product, and it must never be mistaken for one.
 */

// ————————————————————————————————————————————————————— geometry

const VIEW = { w: 420, h: 356 };
const CENTRE = { x: 210, y: 178 };

/** Ring one. */
const R1 = 96;

/**
 * Children sit on an outer arc rather than orbiting their parent: at these
 * radii an orbit puts the top branch's children off the top edge.
 *
 * The gap between the rings is set by pill height, not by taste. A pill is
 * 44px tall and the stage is only ~300px tall on a 320px phone, so a radial
 * gap under about 55 units has a child sitting on top of its own parent.
 */
const R2 = 152;

/**
 * Half the angle between a branch's two children.
 *
 * Set from the narrowest supported screen, not from what looks balanced on a
 * desktop: at 17 degrees the two labels' centres were 62px apart on a 320px
 * phone and the words overlapped. This puts them roughly 100px apart.
 */
const SPREAD = 26;

/**
 * Rounded, and that rounding is load-bearing.
 *
 * Node and the browser disagree with each other about the last bit of
 * `Math.cos`, so an unrounded coordinate serialises differently on the server
 * and on the client and React reports a hydration mismatch. Two decimals is
 * far below a pixel here and is identical everywhere.
 */
const round = (value: number) => Math.round(value * 100) / 100;

function at(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return {
    x: round(CENTRE.x + Math.cos(rad) * radius),
    y: round(CENTRE.y + Math.sin(rad) * radius),
  };
}

/** The same point as a percentage, so an HTML button can sit on it. */
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
  max-width: 34rem;
`;

/**
 * The SVG and the buttons share one coordinate space, which only holds while
 * the stage keeps the viewBox's aspect ratio. Do not make this responsive.
 */
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

const nodeBase = css`
  position: absolute;
  transform: translate(-50%, -50%);

  display: inline-flex;
  align-items: center;
  justify-content: center;

  /* WCAG 2.2 target size, and a comfortable thumb target on a phone. */
  min-height: 44px;
  padding: 0 var(--space-3);

  border-radius: 999px;
  font-family: var(--face-body);
  font-size: var(--text-caption);
  white-space: nowrap;
  cursor: pointer;

  transition:
    background-color 160ms ease,
    border-color 160ms ease;

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

/**
 * Every fill below is a flat, fully opaque token colour, and that is the whole
 * point.
 *
 * Edges run from the centre to each node's centre point, so anything with even
 * slight transparency gets its own spoke drawn across the label. `#RRGGBB22`
 * is transparent by definition, and a `color-mix` against the page colour was
 * no better — every mix collapsed because it was mixing against
 * `--ground-base`, which does not exist. An undefined variable makes the whole
 * declaration invalid, so the fill fell back to transparent and the spokes
 * came through. The variable is `--ground-background`; `vars.test.ts` exists
 * to catch exactly that mistake.
 *
 * So the open state is signalled with weight, border width and an outer glow.
 * None of them touch the fill, which stays a flat opaque token colour.
 */
const Branch = styled.button<{ $colour: string; $open: boolean }>`
  ${nodeBase}
  background: var(--ground-background);
  border: ${({ $open }) => ($open ? '2px' : '1.5px')} solid
    ${({ $colour }) => $colour};
  color: var(--ground-ink);
  font-weight: ${({ $open }) => ($open ? 600 : 500)};
  box-shadow: ${({ $open, $colour }) => ($open ? `0 0 12px 0 ${$colour}55` : 'none')};

  &:hover {
    box-shadow: 0 0 12px 0 ${({ $colour }) => `${$colour}55`};
  }
`;

const Centre = styled.div`
  ${nodeBase}
  cursor: default;
  background: var(--ground-background);
  border: 2px solid ${familyColour('organise')};
  color: var(--ground-ink);
  font-weight: 600;
  font-size: var(--text-label);
`;

/**
 * Children fade and settle outward. The reduced-motion rule is written here
 * rather than left to the global one, because this is the animation someone
 * with vestibular sensitivity would actually notice: several elements moving
 * at once, triggered by their own click.
 */
const Child = styled.span<{ $colour: string }>`
  ${nodeBase}
  /* Not a control, so the 44px target minimum does not apply — and the
     smaller pill is what buys the clearance from its parent on a phone. */
  min-height: 28px;
  background: var(--ground-surface);
  border: 1px solid ${({ $colour }) => `${$colour}99`};
  color: var(--ground-muted);
  cursor: default;

  animation: cdn-child-in 220ms ease-out both;

  @keyframes cdn-child-in {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.8);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Caption = styled.figcaption`
  margin-top: var(--space-4);
  font-size: var(--text-caption);
  line-height: 1.5;
  color: var(--ground-muted);
`;

/** Announces the change the diagram makes visually. */
const Status = styled.p`
  margin: var(--space-2) 0 0;
  min-height: 1.5em;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

// ————————————————————————————————————————————————————— component

export function ExpandingMap() {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = whatDemo.branches.find((branch) => branch.id === openId) ?? null;

  return (
    <Figure>
      <Stage>
        {/*
         * Edges and glow only. Hidden from assistive technology because the
         * buttons above it already say everything this draws.
         */}
        <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} fill="none" aria-hidden="true">
          <defs>
            <radialGradient id="cdn-demo-centre">
              <stop
                offset="0%"
                stopColor={familyColour('organise')}
                stopOpacity="0.4"
              />
              <stop
                offset="100%"
                stopColor={familyColour('organise')}
                stopOpacity="0"
              />
            </radialGradient>
          </defs>

          <circle cx={CENTRE.x} cy={CENTRE.y} r="86" fill="url(#cdn-demo-centre)" />

          {whatDemo.branches.map((branch) => {
            const colour = familyColour(branch.family);
            const point = at(branch.angle, R1);
            const isOpen = branch.id === openId;

            return (
              <g key={branch.id}>
                <line
                  x1={CENTRE.x}
                  y1={CENTRE.y}
                  x2={point.x}
                  y2={point.y}
                  stroke={colour}
                  strokeWidth={isOpen ? 2 : 1.2}
                  strokeOpacity={isOpen ? 0.9 : 0.4}
                />

                {isOpen &&
                  branch.children.map((child, index) => {
                    const outer = at(
                      branch.angle + (index === 0 ? -SPREAD : SPREAD),
                      R2,
                    );
                    return (
                      <line
                        key={child}
                        x1={point.x}
                        y1={point.y}
                        x2={outer.x}
                        y2={outer.y}
                        stroke={colour}
                        strokeWidth="1.2"
                        strokeOpacity="0.6"
                      />
                    );
                  })}
              </g>
            );
          })}
        </svg>

        <Centre style={percent(CENTRE)}>{whatDemo.centre.label}</Centre>

        {whatDemo.branches.map((branch) => {
          const isOpen = branch.id === openId;
          return (
            <Branch
              key={branch.id}
              type="button"
              style={percent(at(branch.angle, R1))}
              $colour={familyColour(branch.family)}
              $open={isOpen}
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : branch.id)}
            >
              {branch.label}
            </Branch>
          );
        })}

        {/*
         * Children are plain spans, not buttons. They show that the map keeps
         * going; making them look interactive would be a control that does
         * nothing, which is worse than no control.
         */}
        {open?.children.map((child, index) => (
          <Child
            key={child}
            style={percent(at(open.angle + (index === 0 ? -SPREAD : SPREAD), R2))}
            $colour={familyColour(open.family)}
          >
            {child}
          </Child>
        ))}
      </Stage>

      <Status role="status">
        {open
          ? `${open.label} expanded: ${open.children.join(', ')}.`
          : 'Nothing expanded yet.'}
      </Status>

      <Caption>{whatDemo.caption}</Caption>
    </Figure>
  );
}
