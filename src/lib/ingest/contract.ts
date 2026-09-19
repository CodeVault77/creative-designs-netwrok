import type { StructureResult } from './structure';

/**
 * The ingest contract, shared by the server pipeline and the client screen.
 *
 * Split out of `pipeline.ts` because that module is `server-only` — it opens
 * sockets and touches the database — while the stage names, the failure codes
 * and above all the MESSAGES are exactly what the UI needs to render. Without
 * this split the progress component would drag the fetcher into the browser
 * bundle, which Next refuses outright.
 *
 * Nothing here does anything. It is names, types and copy.
 */

/** §12 step 4's four stages, in order. */
export const STAGES = ['fetching', 'reading', 'structuring', 'laying-out'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * The failure modes of §12, and nothing else.
 *
 * A closed union rather than a string, so a new failure cannot be introduced
 * without the compiler demanding its message. "Every failure has a specific
 * message" is one of P9's acceptance criteria, and this type is what enforces
 * it rather than a promise to remember.
 */
export type IngestFailure =
  | 'unreachable'
  | 'blocked-by-robots'
  | 'auth-required'
  | 'too-thin'
  | 'model-failed'
  | 'rate-limited'
  | 'blocked-address';

export interface FailureCopy {
  title: string;
  body: string;
  /** Whether offering Retry makes sense. Robots does NOT — the answer is no. */
  retryable: boolean;
  /** The escape hatch §12 names for this specific failure. */
  fallback: 'manual' | 'paste-text' | 'retry' | 'none';
}

/**
 * The messages, in one place.
 *
 * Taken from §12 rather than paraphrased. These are the whole deliverable of
 * the failure half of this phase — a generic "Something went wrong" would
 * satisfy the code and fail the feature.
 */
export const FAILURE_COPY: Record<IngestFailure, FailureCopy> = {
  unreachable: {
    title: "That page didn't respond",
    body: 'Check the link or try another.',
    retryable: true,
    fallback: 'retry',
  },
  'blocked-by-robots': {
    title: 'This site asks not to be read by tools like CDN',
    // No retry. §12: "Honour robots.txt. This is a legal and reputational
    // line, not a preference." A Retry button here invites the user to argue
    // with a decision that is not ours to reverse.
    body: 'You can still build a map by hand.',
    retryable: false,
    fallback: 'manual',
  },
  'auth-required': {
    title: 'We can only read publicly visible pages',
    body: 'This one is behind a login or a paywall. You can paste the text instead.',
    retryable: false,
    fallback: 'paste-text',
  },
  'too-thin': {
    title: 'Not much text to work with',
    body: "Here's a starter map instead.",
    retryable: false,
    fallback: 'none',
  },
  'model-failed': {
    title: 'Structuring took too long',
    body: 'Try again, or build the map by hand.',
    retryable: true,
    fallback: 'retry',
  },
  'rate-limited': {
    title: 'Too many pages for now',
    body: 'Try again shortly.',
    retryable: true,
    fallback: 'retry',
  },
  'blocked-address': {
    title: "We can't read that address",
    body: 'Link-to-Mind-Map reads public web pages only.',
    retryable: false,
    fallback: 'manual',
  },
};

export type IngestEvent =
  | { type: 'stage'; stage: Stage; label: string }
  | { type: 'meta'; title: string; siteName: string; finalUrl: string }
  | {
      type: 'done';
      runId: string;
      result: StructureResult;
      sourceUrl: string;
      /** Set when we delivered a stub rather than a real structure. */
      degraded?: IngestFailure;
    }
  | {
      type: 'error';
      failure: IngestFailure;
      copy: FailureCopy;
      detail?: string;
      retryAfter?: number;
    };

export const STAGE_LABEL: Record<Stage, string> = {
  fetching: 'Fetching',
  reading: 'Reading',
  structuring: 'Structuring',
  'laying-out': 'Laying out',
};
