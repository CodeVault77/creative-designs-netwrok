'use client';

import styled from 'styled-components';
import { NodeGlyph } from './NodeGlyph';
import type { NodeDetail, NodeDetailMode } from '@/lib/nodes/detail';
import type { FamilyName } from '@/lib/styles/tokens.generated';

/**
 * Title, family, path.
 *
 * The path line is the sheet's answer to "where am I" — the same job the map
 * breadcrumb does, repeated here because the sheet can cover the breadcrumb
 * on a phone and a user reading the sheet has lost sight of the map.
 */

const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const Path = styled.nav`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Crumb = styled.button`
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-decoration: none;

  &:hover {
    color: var(--ground-ink);
    text-decoration: underline;
  }

  &:disabled {
    cursor: default;
    color: var(--ground-muted);
  }
`;

const TitleRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
`;

/** Slot number and badge share a line above the title, as on the canvas. */
const Meta = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 14px;
`;

/**
 * "NODE 07" rather than a bare "7".
 *
 * §10's numbering is how people say which node they mean out loud, and the
 * word is what makes the number legible as one — on its own beside a title, a
 * lone digit reads as a count or a rank.
 */
const Slot = styled.span`
  font-family: var(--face-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  color: var(--ground-muted);
  white-space: nowrap;
`;

/**
 * The family chip, in the family's own hue.
 *
 * §16 keeps hue off body copy, but this is a label whose entire content IS the
 * family — the one place the colour is the information rather than decoration,
 * and it sits at chip size on a raised ground where it passes contrast.
 */
const FamilyChip = styled.span<{ $family: FamilyName }>`
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: var(--radius-chip);

  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;

  color: ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
  border: 1px solid ${({ theme, $family }) => theme.tokens.familyRamp[$family].core};
`;

const TitleCol = styled.div`
  flex: 1;
  min-width: 0;
`;

const Title = styled.h2`
  margin: 4px 0 0;
  font-family: var(--face-display);
  font-size: var(--text-display-m);
  line-height: 1.2;
  color: var(--ground-ink);
  text-wrap: pretty;
`;

const Badge = styled.span`
  flex-shrink: 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  color: var(--fam-services-core);
  border: 1px solid var(--fam-services-core);
  border-radius: var(--radius-chip);
  padding: 2px 6px;
`;

export interface NodeHeaderProps {
  detail: NodeDetail;
  mode: NodeDetailMode;
  onNavigateCrumb?: (nodeId: string) => void;
}

export function NodeHeader({ detail, mode, onNavigateCrumb }: NodeHeaderProps) {
  // The node itself is the last crumb and is already the title.
  const path = detail.trail.slice(0, -1);

  return (
    <Head>
      {path.length > 0 && (
        <Path aria-label="Path">
          {path.map((crumb, index) => (
            <span key={crumb.id}>
              {index > 0 && <span aria-hidden="true"> › </span>}
              <Crumb
                onClick={() => onNavigateCrumb?.(crumb.id)}
                disabled={!onNavigateCrumb}
              >
                {crumb.title}
              </Crumb>
            </span>
          ))}
        </Path>
      )}

      <TitleRow>
        {/*
         * The same glyph the map drew, at avatar size. It is the thread
         * between the node someone tapped and the panel that opened — without
         * it the sheet is just a title, and on a phone the map is covered.
         */}
        <NodeGlyph
          family={detail.family}
          {...(detail.icon ? { icon: detail.icon } : {})}
          dim={mode === 'soon' || mode === 'locked'}
        />

        <TitleCol>
          <Meta>
            {/*
             * §10's numbering, and the reason it is worth repeating here: it
             * is how someone says which node they mean out loud. The root has
             * no ring position, so it gets none.
             */}
            {detail.trail.length > 1 && (
              <Slot>NODE {String(detail.slot + 1).padStart(2, '0')}</Slot>
            )}

            {/*
             * Coming Soon replaces the family chip rather than joining it.
             * Two chips side by side compete, and "not built yet" is the more
             * urgent of the two facts — the family is still in the meta table
             * below.
             */}
            {mode === 'soon' ? (
              <Badge>COMING SOON</Badge>
            ) : (
              <FamilyChip $family={detail.family}>{detail.family}</FamilyChip>
            )}
          </Meta>

          <Title>{detail.title}</Title>
        </TitleCol>
      </TitleRow>
    </Head>
  );
}
