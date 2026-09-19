'use client';

import styled from 'styled-components';
import { ICON_VIEWBOX, iconPathsFor } from '@/lib/map/icons';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * A node's glyph in a family-coloured disc.
 *
 * The same paths the map canvas strokes (`lib/map/icons.ts`), drawn here as
 * DOM SVG. One source of artwork, two renderers — which is the point: the
 * symbol someone tapped on the map is the symbol at the top of the sheet that
 * opens, and a second hand-kept copy would eventually disagree.
 *
 * Falls back to a plain disc when the node has no icon. That is deliberate and
 * matches `iconPathsFor`: a stand-in glyph would read as a node type and
 * invent meaning the data does not carry.
 */

const Disc = styled.span<{ $family: FamilyName; $size: number; $dim: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;

  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  box-sizing: border-box;
  border-radius: var(--radius-circle);

  /*
   * A wash, never a solid — the same rule the canvas renderer follows. A
   * saturated fill at this size swallows a 1.8px stroke.
   */
  background: ${({ theme, $family, $dim }) =>
    $dim ? 'rgba(255,255,255,0.02)' : theme.tokens.familyRamp[$family].wash};

  /*
   * Dashed and unlit when dimmed, so Coming Soon and locked differ from live
   * in two channels here exactly as they do on the map (§10).
   */
  border: 2px ${({ $dim }) => ($dim ? 'dashed' : 'solid')}
    ${({ theme, $family, $dim }) =>
      $dim ? 'var(--ground-border)' : theme.tokens.familyRamp[$family].core};

  box-shadow: ${({ theme, $family, $dim }) =>
    $dim ? 'none' : theme.tokens.glow[$family][1]};

  color: ${({ theme, $family, $dim }) =>
    $dim ? 'var(--ground-muted)' : theme.tokens.familyRamp[$family].core};
`;

export interface NodeGlyphProps {
  family: FamilyName;
  icon?: string;
  /** Diameter in px. 44 is the sheet's avatar; smaller suits list rows. */
  size?: number;
  /** Coming Soon and locked nodes are drawn unlit. */
  dim?: boolean;
  className?: string;
}

export function NodeGlyph({
  family,
  icon,
  size = 44,
  dim = false,
  className,
}: NodeGlyphProps) {
  const paths = iconPathsFor(icon);

  return (
    <Disc $family={family} $size={size} $dim={dim} className={className}>
      {paths.length > 0 && (
        <svg
          width={size * 0.45}
          height={size * 0.45}
          viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          /*
           * Decorative: the node's title sits beside it in every use, so
           * naming the glyph would make a screen reader say the node twice.
           */
          aria-hidden="true"
          focusable="false"
        >
          {paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      )}
    </Disc>
  );
}
