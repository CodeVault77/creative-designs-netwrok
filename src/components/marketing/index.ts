/**
 * The Phase 0 marketing surface.
 *
 * Import from '@/components/marketing', never from the individual files —
 * the same rule as the design system barrel, for the same reason.
 *
 * STRUCTURAL RULE (roadmap §25.5, enforced by marketing.test.ts): nothing in
 * this directory may import from the map, editor or canvas modules. One
 * convenient import pulls the radial renderer into the landing page bundle and
 * the performance budget in §22 is gone.
 */
export { MarketingLayout } from './MarketingLayout';
export { MarketingHeader } from './MarketingHeader';
export { MarketingFooter } from './MarketingFooter';
export { Section, Container, type SectionProps } from './Section';
export { Logo, LogoMark, type LogoProps, type LogoMarkProps } from './Logo';

// ---- Milestone B: the landing page sections (roadmap §9.1) ----
export { Hero } from './Hero';
export { WhatIsCdn, HowItWorks } from './StepList';
export { NetworkDiagram } from './NetworkDiagram';
export { ExpandingMap } from './ExpandingMap';
export { VisionSketch } from './VisionSketch';
export { ServiceGrid, type ServiceGridProps } from './ServiceGrid';
export { ServiceMap } from './ServiceMap';
export { AudienceGrid, VisionBlock } from './AudienceGrid';
export { ContactOptions } from './ContactOptions';
export { NewsletterSection } from './NewsletterSection';
