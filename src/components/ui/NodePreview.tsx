'use client';

import styled from 'styled-components';
import {
  tokens,
  type FamilyName,
  type NodeStateName,
} from '@/lib/styles/tokens.generated';

/**
 * SVG preview of a map node in any of the nine §10 visual states.
 *
 * IMPORTANT — this is a SPECIFICATION ARTIFACT, not the map renderer.
 *
 * The real nodes in P3 are drawn to a canvas with pre-baked glow sprites,
 * because live `box-shadow`/`filter` per node is the performance mistake §23
 * calls out by name. This component exists so that:
 *
 *   1. the nine states can be reviewed, compared and signed off in Storybook
 *      before anyone writes renderer code;
 *   2. there is an unambiguous visual reference for the renderer to match;
 *   3. the "every state differs in at least two channels" rule can be
 *      verified by eye and by test.
 *
 * Do not use it inside MapCanvas.
 */

export interface NodePreviewProps {
  state: NodeStateName;
  family?: FamilyName;
  label?: string;
  /** Ring-one node number. Rendered in the mono face, as in the reference. */
  index?: number;
  size?: number;
}

const Root = styled.figure<{ $opacity: number; $scale: number }>`
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  opacity: ${({ $opacity }) => $opacity};
  transform: scale(${({ $scale }) => $scale});
`;

const Label = styled.figcaption`
  /* §16: node labels are ALWAYS ink, never the family hue. The hue is
     carried by the ring; colouring the text as well makes small labels
     fail contrast on black. */
  color: var(--ground-ink);
  font-family: var(--face-display);
  font-size: var(--text-node-label);
  font-weight: ${({ theme }) => theme.tokens.typography.weight.semibold};
  text-align: center;
  max-width: 96px;
`;

const Index = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

/** Truncates to the canvas label budget from §10. */
export function truncateLabel(
  label: string,
  max = tokens.map.labelTruncate.canvas,
) {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

export function NodePreview({
  state,
  family = 'discover',
  label,
  index,
  size = 64,
}: NodePreviewProps) {
  const spec = tokens.nodeState[state];
  const ramp = tokens.familyRamp[family];

  // Root and the explicitly-coloured states override the family hue.
  const stroke =
    spec.stroke === 'family' || spec.stroke === 'multi-hue'
      ? ramp.core
      : spec.stroke;
  const fill = spec.stroke === 'family' ? ramp.core : stroke;

  const opacity = 'opacity' in spec ? spec.opacity : 1;
  const scale = 'scale' in spec ? spec.scale : 1;
  const dash = 'strokeDash' in spec ? spec.strokeDash : undefined;
  const badge = spec.badge;
  const glowLevel = spec.glow as 0 | 1 | 2 | 3;

  const gradientId = `glow-${state}-${family}`;
  const box = size + 48;
  const centre = box / 2;
  const radius = size / 2;

  return (
    <Root $opacity={opacity} $scale={scale}>
      <svg
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        role="img"
        aria-label={`${state} node`}
      >
        <defs>
          {/* Stands in for the pre-baked sprite the canvas renderer composites. */}
          <radialGradient id={gradientId}>
            <stop
              offset="55%"
              stopColor={fill}
              stopOpacity={glowLevel === 0 ? 0 : 0.001}
            />
            <stop
              offset="72%"
              stopColor={fill}
              stopOpacity={glowLevel === 0 ? 0 : 0.1 * glowLevel}
            />
            <stop offset="100%" stopColor={fill} stopOpacity="0" />
          </radialGradient>
        </defs>

        {glowLevel > 0 && (
          <circle
            cx={centre}
            cy={centre}
            r={radius + 22}
            fill={`url(#${gradientId})`}
          />
        )}

        {/* Selected: white ring outside the family stroke — channel two. */}
        {state === 'selected' && (
          <circle
            cx={centre}
            cy={centre}
            r={radius + 4}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={4}
          />
        )}

        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill={fill}
          fillOpacity={spec.fillAlpha}
          stroke={stroke}
          strokeWidth={spec.strokeWidth}
          strokeDasharray={dash}
        />

        {badge === 'lock' && (
          <g transform={`translate(${centre - 6}, ${centre - 7})`}>
            <rect
              x="1"
              y="5"
              width="10"
              height="8"
              rx="1.5"
              fill="none"
              stroke={stroke}
              strokeWidth="1.3"
            />
            <path
              d="M3.5 5V3.5a2.5 2.5 0 0 1 5 0V5"
              fill="none"
              stroke={stroke}
              strokeWidth="1.3"
            />
          </g>
        )}
        {badge === 'clock' && (
          <g transform={`translate(${centre - 7}, ${centre - 7})`}>
            <circle
              cx="7"
              cy="7"
              r="6"
              fill="none"
              stroke={stroke}
              strokeWidth="1.3"
            />
            <path
              d="M7 3.5V7l2.5 1.5"
              fill="none"
              stroke={stroke}
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </g>
        )}
        {badge === 'shield' && (
          <g transform={`translate(${centre - 7}, ${centre - 7})`}>
            <path
              d="M7 1 12 3v4c0 3-2.2 5.3-5 6.2C4.2 12.3 2 10 2 7V3L7 1Z"
              fill="none"
              stroke={stroke}
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </g>
        )}
      </svg>

      {typeof index === 'number' && <Index data-numeric>{index}</Index>}
      {label && <Label>{truncateLabel(label)}</Label>}
    </Root>
  );
}
