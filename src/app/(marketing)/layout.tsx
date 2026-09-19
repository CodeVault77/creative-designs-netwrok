import type { ReactNode } from 'react';
import { MarketingLayout } from '@/components/marketing';

/**
 * The public marketing site (Phase 0).
 *
 * A sibling of `(app)`, not a parent and not a child. The two groups share the
 * root layout, the design tokens and the UI primitives, and nothing else —
 * marketing pages never mount `AppShell`, so a visitor to the landing page
 * does not download the tab bar, the nav rail, or anything they reach.
 *
 * That separation is enforced by a structural test (roadmap §25.5): no file
 * under `components/marketing/**` may import from the map, editor or canvas
 * modules. Without it, one convenient import pulls the whole radial renderer
 * into the landing page bundle and the performance budget in §22 is gone.
 */
export default function MarketingRootLayout({ children }: { children: ReactNode }) {
  return <MarketingLayout>{children}</MarketingLayout>;
}
