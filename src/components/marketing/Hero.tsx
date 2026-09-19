'use client';

import Link from 'next/link';
import styled, { keyframes, css } from 'styled-components';
import { flags, isPreLaunch } from '@/config';
import { hero } from '@/content/landing';
import { track } from '@/lib/analytics';
import { LogoMark } from './Logo';
import { Container } from './Section';

/**
 * B1 — the hero.
 *
 * §9.1 sets a hard requirement: on a 375×667 phone, WITHOUT scrolling, this
 * must show the logo, a headline, the sentence explaining CDN, the pre-launch
 * statement, and one CTA. The visual may be cropped; the explanation may not.
 *
 * That constraint is why the ring is `min(58vw, …)` and sits BELOW the copy in
 * source order on mobile — the brand moment is worth a lot, but not worth
 * pushing the sentence that explains the company off the screen.
 */

const Wrapper = styled.section`
  position: relative;
  overflow: hidden;
  padding-block: var(--space-8) var(--space-12);

  @media (min-width: 1024px) {
    padding-block: var(--space-16) var(--space-24);
  }
`;

const Grid = styled.div`
  display: grid;
  gap: var(--space-8);
  align-items: center;
  grid-template-columns: 1fr;

  /*
   * Two columns only from 900px. At 768 the ring shrinks to the point where it
   * reads as a bullet next to the text rather than as the brand.
   */
  @media (min-width: 900px) {
    grid-template-columns: 1.15fr 1fr;
    gap: var(--space-12);
  }
`;

const Copy = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 46ch;
`;

/**
 * The pre-launch statement (§7.2).
 *
 * Above the headline, not buried under it — a visitor who reads two lines and
 * leaves must still have understood that the platform is not available. It is
 * a requirement, not a decoration, and it must not be removed to save space.
 */
const Status = styled.p`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  margin: 0;

  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-pill);
  background: var(--ground-surface);

  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Dot = styled.span`
  width: 7px;
  height: 7px;
  border-radius: var(--radius-circle);
  background: var(--fam-services-core);
  box-shadow: 0 0 8px var(--fam-services-glow);
  flex-shrink: 0;
`;

const Headline = styled.h1`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-hero);
  line-height: 1.06;
  letter-spacing: -0.01em;
  /* Never a family hue: body and headings stay ink (§11.1). */
  color: var(--ground-ink);
  text-wrap: balance;
`;

const Subline = styled.p`
  margin: 0;
  font-size: var(--text-body);
  line-height: 1.6;
  color: var(--ground-muted);

  @media (min-width: 1024px) {
    font-size: var(--text-title);
    line-height: 1.5;
  }
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-2);
`;

/**
 * The CTAs are links, not buttons.
 *
 * They navigate, so they must be `<a>`: middle-click, open-in-new-tab and
 * "copy link address" all work, and a screen reader announces a link rather
 * than a button that mysteriously changes the page.
 */
const cta = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 var(--space-6);

  border-radius: var(--radius-control);
  font-family: var(--face-body);
  font-size: var(--control-fontSize);
  text-decoration: none;
  white-space: nowrap;

  transition:
    border-color 200ms ease,
    background 200ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const Primary = styled(Link)`
  ${cta}
  color: var(--ground-ink);
  border: 1.5px solid var(--fam-services-core);
  background: var(--fam-services-wash);
  box-shadow: 0 0 20px var(--fam-services-glow);

  &:hover {
    background: var(--fam-services-core);
    color: var(--ground-background);
  }
`;

const Secondary = styled(Link)`
  ${cta}
  color: var(--ground-ink);
  border: 1px solid var(--ground-border);
  background: transparent;

  &:hover {
    border-color: var(--fam-discover-core);
  }
`;

// ------------------------------------------------------------------- the ring

const Stage = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
`;

const breathe = keyframes`
  0%, 100% { opacity: 0.55; transform: scale(1); }
  50%      { opacity: 0.9;  transform: scale(1.015); }
`;

/**
 * The lit ring from the reference artwork.
 *
 * Built from two elements — a gradient border and a blurred copy behind it —
 * rather than a filter over the whole stage. A `filter: blur()` across a large
 * area is one of the most expensive things a mobile GPU can be asked to do,
 * and §22 says the aesthetic must not cost performance.
 */
const Ring = styled.div`
  position: relative;
  width: min(58vw, 340px);
  height: min(58vw, 340px);
  border-radius: var(--radius-circle);

  display: grid;
  place-items: center;

  /*
   * The gradient border. The padding-box/border-box layering paints a gradient
   * ring without a pseudo-element and without a second stacking context.
   */
  border: 2px solid transparent;
  background:
    linear-gradient(var(--ground-background), var(--ground-background)) padding-box,
    conic-gradient(
        from 210deg,
        #2e7bf6,
        #2fd9f5,
        #8b5cf6,
        #ff4d97,
        #ff8a3d,
        #ff3d2e,
        #2e7bf6
      )
      border-box;

  @media (min-width: 900px) {
    width: min(38vw, 420px);
    height: min(38vw, 420px);
  }
`;

const Halo = styled.div`
  position: absolute;
  inset: -12%;
  border-radius: var(--radius-circle);
  pointer-events: none;

  background: radial-gradient(
    circle,
    rgba(139, 92, 246, 0.22) 0%,
    rgba(255, 77, 151, 0.12) 45%,
    transparent 70%
  );

  animation: ${breathe} 6s ease-in-out infinite;

  /* §21: every animation is removed, not merely slowed. */
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    opacity: 0.7;
  }
`;

const RingInner = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
`;

const RingCaption = styled.span`
  font-size: var(--text-caption);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ground-muted);
`;

export function Hero() {
  const primary = isPreLaunch()
    ? hero.primaryCta
    : { label: 'Enter the network', href: '/app' };

  return (
    <Wrapper>
      <Container>
        <Grid>
          <Copy>
            <Status>
              <Dot aria-hidden="true" />
              {hero.status}
            </Status>

            <Headline>{hero.headline}</Headline>
            <Subline>{hero.subline}</Subline>

            <Actions>
              {(flags.serviceRequest || !isPreLaunch()) && (
                <Primary
                  href={primary.href}
                  onClick={() =>
                    track('marketing_cta_clicked', {
                      cta_id: 'hero-primary',
                      section: 'hero',
                    })
                  }
                >
                  {primary.label}
                </Primary>
              )}

              <Secondary
                href={hero.secondaryCta.href}
                onClick={() =>
                  track('marketing_cta_clicked', {
                    cta_id: 'hero-secondary',
                    section: 'hero',
                  })
                }
              >
                {hero.secondaryCta.label}
              </Secondary>
            </Actions>
          </Copy>

          {/*
            Decorative. The mark is already announced by the header's brand
            link, and the caption is a visual echo of the reference rather than
            information — so the whole stage is hidden from assistive tech.
          */}
          <Stage aria-hidden="true">
            <Halo />
            <Ring>
              <RingInner>
                <LogoMark size={54} />
                <RingCaption>The Central Node</RingCaption>
              </RingInner>
            </Ring>
          </Stage>
        </Grid>
      </Container>
    </Wrapper>
  );
}
