/**
 * Site-wide identity and launch state.
 *
 * One of six files under `src/config`. The rule the roadmap sets (§15) is that
 * changing the company name, the tagline, the launch status, the WhatsApp
 * number, the contact email or the service list must mean editing exactly one
 * typed file — never hunting through components. A structural test enforces the
 * half of that rule a human would otherwise erode (§25.5).
 */

export type LaunchStatus = 'coming-soon' | 'live';

export interface SiteConfig {
  name: string;
  shortName: string;
  /** The logo lockup tagline. See the note below before moving this. */
  tagline: string;
  /** One sentence. Used as the SEO description default and the hero sub-line. */
  description: string;
  /** Bare domain, no scheme. OPEN DECISION OD-7 — empty until chosen. */
  domain: string;
  launch: {
    status: LaunchStatus;
    /** OPEN DECISION OD-9. Recommendation: stay false until a date is certain. */
    showDate: boolean;
    /** ISO date, or null. Never displayed while `showDate` is false. */
    date: string | null;
  };
}

export const site: SiteConfig = {
  name: 'Creative Design Networks',
  shortName: 'CDN',

  /**
   * OPEN DECISION OD-13.
   *
   * This is a real brand asset — it is set in the logo lockup and already
   * appears in the application's own metadata. It is also a faith-based
   * statement, which is a positioning choice with real audience consequences,
   * so it is recorded here rather than being scattered or silently dropped.
   *
   * Roadmap recommendation: keep it in the logo lockup and the footer; do NOT
   * make it the hero headline. The hero has to explain the product, and this
   * is an identity statement rather than an explanation.
   */
  tagline: 'God Gives the Vision. We Build the Connections.',

  /**
   * The one-sentence explanation (§7.1).
   *
   * The second clause is load-bearing: it is what makes this a business
   * rather than only a product. Do not cut it for brevity.
   */
  description:
    'Creative Design Networks is a visual platform where ideas, people and projects connect as an expandable network — and alongside it, we design and build software for other people.',

  domain: '',

  launch: {
    status: 'live',
    showDate: false,
    date: null,
  },
};

/** True while the platform is unreleased. Drives copy, CTAs and the app entry. */
export const isPreLaunch = (): boolean => site.launch.status === 'coming-soon';
