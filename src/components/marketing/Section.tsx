'use client';

import type { ReactNode } from 'react';
import styled, { css } from 'styled-components';

/**
 * Marketing layout primitives: Container and Section.
 *
 * Two components carry the whole page rhythm, so vertical spacing is decided
 * once rather than negotiated per section. Every landing section is a
 * `<Section>` containing a `<Container>`; nothing sets its own page padding.
 *
 * The app has no equivalent because it does not need one — app screens are
 * full-height panels with their own chrome. This is the marketing counterpart
 * and it deliberately does not live in `components/ui`, which is the shared
 * design system for both.
 */

/**
 * Horizontal bounds and gutters.
 *
 * 1200px matches §13's stated max content width. The gutter grows with the
 * viewport rather than staying at 16px, because full-width text on a laptop
 * reads as an unstyled document.
 */
export const Container = styled.div<{ $width?: 'default' | 'narrow' }>`
  width: 100%;
  max-width: ${({ $width }) => ($width === 'narrow' ? '760px' : '1200px')};
  margin: 0 auto;
  padding-inline: var(--space-4);

  @media (min-width: 600px) {
    padding-inline: var(--space-6);
  }

  @media (min-width: 1024px) {
    padding-inline: var(--space-8);
  }
`;

/**
 * Vertical rhythm.
 *
 * Uses the two large steps added to the token scale for this purpose
 * (`--space-24` = 96px, `--space-32` = 128px). Section spacing is the single
 * biggest driver of whether a marketing page reads as considered or cramped,
 * and it is the thing most often fiddled with per-component until nothing
 * lines up.
 */
const Wrapper = styled.section<{ $tone: Tone; $flush: boolean }>`
  position: relative;
  padding-block: ${({ $flush }) => ($flush ? '0' : 'var(--space-12)')};

  @media (min-width: 600px) {
    padding-block: ${({ $flush }) => ($flush ? '0' : 'var(--space-16)')};
  }

  @media (min-width: 1024px) {
    padding-block: ${({ $flush }) => ($flush ? '0' : 'var(--space-24)')};
  }

  ${({ $tone }) => TONES[$tone]}
`;

type Tone = 'default' | 'raised' | 'bordered';

/**
 * Three tones, not a colour prop.
 *
 * A section may sit on the page ground, on a slightly raised ground, or be
 * separated by a hairline. Allowing arbitrary backgrounds is how a dark
 * palette turns into eleven not-quite-identical greys.
 */
const TONES: Record<Tone, ReturnType<typeof css>> = {
  default: css``,
  raised: css`
    background: var(--ground-surface);
  `,
  bordered: css`
    border-top: 1px solid var(--ground-border);
  `,
};

const Header = styled.header<{ $align: 'start' | 'center' }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-bottom: var(--space-8);
  text-align: ${({ $align }) => ($align === 'center' ? 'center' : 'left')};
  align-items: ${({ $align }) => ($align === 'center' ? 'center' : 'flex-start')};
`;

const Title = styled.h2`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-display-m);
  line-height: 1.15;
  color: var(--ground-ink);

  @media (min-width: 1024px) {
    font-size: var(--text-display-l);
  }
`;

const Intro = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.6;
  /*
   * Muted, but never dimmed with opacity — a token that passes contrast at
   * full opacity fails at 75%, and the failure is invisible in review. This
   * has already happened once in this codebase (roadmap §21).
   */
  color: var(--ground-muted);
  max-width: 62ch;
`;

export interface SectionProps {
  children: ReactNode;
  /** Anchor target, so header links like `/#what` land here. */
  id?: string;
  title?: string;
  intro?: string;
  tone?: Tone;
  align?: 'start' | 'center';
  width?: 'default' | 'narrow';
  /** Removes vertical padding — for a hero that manages its own. */
  flush?: boolean;
  /**
   * Renders the title as the page `h1`.
   *
   * Exactly one section per page may set this, and §20 requires exactly one
   * `h1` per page. Sections default to `h2` because a marketing page is a
   * sequence of peers under one title, not a nested outline.
   */
  as?: 'h1' | 'h2';
}

export function Section({
  children,
  id,
  title,
  intro,
  tone = 'default',
  align = 'start',
  width = 'default',
  flush = false,
  as = 'h2',
}: SectionProps) {
  return (
    <Wrapper
      id={id}
      $tone={tone}
      $flush={flush}
      /*
       * Associates the region with its heading for screen readers. Only when
       * there IS a heading — an aria-labelledby pointing at nothing is worse
       * than no label.
       */
      {...(title && id ? { 'aria-labelledby': `${id}-title` } : {})}
    >
      <Container $width={width}>
        {(title || intro) && (
          <Header $align={align}>
            {title && (
              <Title as={as} {...(id ? { id: `${id}-title` } : {})}>
                {title}
              </Title>
            )}
            {intro && <Intro>{intro}</Intro>}
          </Header>
        )}
        {children}
      </Container>
    </Wrapper>
  );
}
