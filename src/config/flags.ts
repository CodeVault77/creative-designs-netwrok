/**
 * Feature flags.
 *
 * Read at render, so a form can be switched off during an incident without a
 * code change or a deploy that touches component logic. Every flag is a
 * deliberate on/off for a whole surface — not a place to hide half-built work.
 */
export interface Flags {
  /** Newsletter capture on the landing page. */
  newsletter: boolean;
  /** The /request form. Off means the page explains how to email instead. */
  serviceRequest: boolean;
  /** WhatsApp CTAs. Also gated on the number actually being configured. */
  whatsapp: boolean;
  /** OPEN DECISION OD-11 — footer link only, per the roadmap recommendation. */
  partnerCta: boolean;

  // ---- Phase 1. Off until the pages exist. ----
  blog: boolean;
  pricing: boolean;
  /** Reveals the "Enter the network" CTA and links /app. See §28.4. */
  appEntry: boolean;
}

export const flags: Flags = {
  newsletter: true,
  serviceRequest: true,
  whatsapp: true,
  partnerCta: true,

  blog: false,
  pricing: false,
  appEntry: false,
};
