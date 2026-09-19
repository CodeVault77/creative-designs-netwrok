import 'server-only';
import type { Database } from 'better-sqlite3';
import type { AuthContext } from '@/lib/db/repo';

/**
 * The registry of catalogues.
 *
 * ── The whole argument for one marketplace ──────────────────────────────────
 *
 * A template, a plugin, an agent and a freelancer's time are the same object
 * in every way a marketplace cares about: they are listed, described, priced,
 * submitted for review, published, browsed, ordered, delivered, rated and
 * moderated. Four marketplaces would have meant four review queues to staff,
 * four rating implementations to get right, four moderation paths to secure,
 * and four copies of every bug found in any of them.
 *
 * What actually differs between them is two questions:
 *
 *   1. may this author list this target?     `ownsTarget`
 *   2. what does the buyer receive?          `fulfil`
 *
 * Two functions per catalogue. Everything else — `repo.ts` — is shared, and
 * keeping the difference visibly this small is what stops a fifth catalogue
 * from being a project.
 *
 * ── Why a registry rather than a switch ─────────────────────────────────────
 *
 * The adapters live in `catalogues.ts` and register themselves here. A `switch`
 * on kind would have put the four implementations inside the shared machinery,
 * which is the arrangement that makes people add a fifth branch to a function
 * that was supposed to be kind-agnostic — and then a sixth somewhere else.
 */

export const LISTING_KINDS = [
  'template',
  'plugin',
  'agent',
  'freelancing',
] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];

export function isListingKind(value: string): value is ListingKind {
  return (LISTING_KINDS as readonly string[]).includes(value);
}

/** Everything an adapter needs to deliver an order. */
export interface FulfilContext {
  /** The buyer. Everything created belongs to them. */
  buyer: AuthContext;
  /** The seller, for the rare read that must happen with their authority. */
  authorId: string;
  targetId: string;
  listingId: string;
  title: string;
  db: Database;
}

export interface FulfilResult {
  ok: boolean;
  /** What delivery produced: a map id, a plugin id, an enquiry id. */
  resultId?: string;
  error?: string;
}

export interface KindAdapter {
  kind: ListingKind;
  /** Catalogue heading. */
  label: string;
  /** One line under it. */
  blurb: string;
  /**
   * May this author list this target?
   *
   * Answered with the AUTHOR's context through the ordinary repositories, so
   * ownership is decided by the same code as everywhere else rather than by a
   * parallel notion of ownership that could disagree with it.
   *
   * Called three times in a listing's life — at create, at submit, and again
   * at delivery — because a listing outlives its target and the world moves
   * under a long-lived row.
   */
  ownsTarget: (ctx: AuthContext, targetId: string, db: Database) => boolean;
  fulfil: (ctx: FulfilContext) => FulfilResult;
}

const adapters = new Map<ListingKind, KindAdapter>();

export function defineKind(adapter: KindAdapter): void {
  adapters.set(adapter.kind, adapter);
}

export function adapterFor(kind: ListingKind): KindAdapter | undefined {
  return adapters.get(kind);
}

/** Every registered catalogue, in the declared order. */
export function allKinds(): KindAdapter[] {
  return LISTING_KINDS.map((kind) => adapters.get(kind)).filter(
    (adapter): adapter is KindAdapter => adapter !== undefined,
  );
}
