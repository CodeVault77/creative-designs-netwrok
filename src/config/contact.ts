/**
 * Contact details — the two values most likely to be wrong at launch.
 *
 * Both are OPEN DECISIONS (OD-1, OD-2) and both are deliberately EMPTY. They
 * are not guessed, because an invented email address or phone number is worse
 * than a missing one: a missing one fails loudly and gets fixed, an invented
 * one looks correct and silently sends every enquiry nowhere.
 *
 * `contact.test.ts` fails the build if either is still empty in a deployed
 * environment, and `helpers.test.ts` fails if either value appears anywhere
 * outside this file. A launch with an empty `wa.me/` link is the most
 * expensive small bug available here, and it is entirely preventable.
 */

export interface ContactConfig {
  /** OPEN DECISION OD-1. Business email. MUST be set before launch. */
  email: string;
  whatsapp: {
    /**
     * OPEN DECISION OD-2. E.164 WITHOUT the leading `+` and with no spaces,
     * dashes or brackets — that is the format `wa.me` expects. A number stored
     * as "+1 (555) 010-0000" produces a link that silently opens WhatsApp on
     * a blank chat.
     */
    number: string;
    /** Pre-filled so the visitor does not have to open with "hi". */
    prefill: string;
  };
  /** OPEN DECISION OD-3. Only promise what can actually be met. */
  responseTime: string;
}

export const contact: ContactConfig = {
  email: '',

  whatsapp: {
    number: '',
    prefill: "Hi CDN — I'd like to talk about a project.",
  },

  responseTime: 'within 2 working days',
};

/** True when a channel is configured. Components hide what is not set up. */
export const hasEmail = (): boolean => contact.email.trim().length > 0;
export const hasWhatsApp = (): boolean => contact.whatsapp.number.trim().length > 0;

/**
 * The WhatsApp deep link.
 *
 * Built here rather than at call sites so the number exists in exactly one
 * place and the message is always encoded. Returns null when unconfigured, so
 * a caller has to decide what to render rather than shipping `wa.me/`.
 */
export function whatsappUrl(message?: string): string | null {
  if (!hasWhatsApp()) return null;
  const text = encodeURIComponent(message ?? contact.whatsapp.prefill);
  return `https://wa.me/${contact.whatsapp.number}?text=${text}`;
}

/** The mailto link, with an optional subject. Null when unconfigured. */
export function emailUrl(subject?: string): string | null {
  if (!hasEmail()) return null;
  return subject
    ? `mailto:${contact.email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${contact.email}`;
}
