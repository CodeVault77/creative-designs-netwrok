import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';
import { adapterFor, isListingKind, type ListingKind } from './kinds';

/**
 * The marketplace: one lifecycle, four catalogues.
 *
 * Every function here is kind-agnostic. Where a kind matters it is delegated
 * to its adapter, and that happens in exactly three places — create, submit
 * and deliver — all of which are ownership or delivery. If a fourth appears,
 * the abstraction has stopped paying for itself and should be reconsidered
 * rather than extended.
 */

export type ListingStatus = 'draft' | 'review' | 'published' | 'suspended';

export interface Listing {
  id: string;
  kind: ListingKind;
  slug: string;
  title: string;
  summary: string;
  description: string;
  authorId: string;
  authorHandle: string;
  targetId: string;
  priceCents: number;
  status: ListingStatus;
  reviewNote: string | null;
  orders: number;
  /** Mean out of 5, or null when nobody has rated it. */
  rating: number | null;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ListingRow {
  id: string;
  kind: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  author_id: string;
  author_handle: string | null;
  target_id: string;
  price_cents: number;
  status: string;
  review_note: string | null;
  orders: number;
  rating_sum: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
}

function hydrate(row: ListingRow): Listing {
  return {
    id: row.id,
    kind: isListingKind(row.kind) ? row.kind : 'template',
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    authorId: row.author_id,
    authorHandle: row.author_handle ?? '',
    targetId: row.target_id,
    priceCents: row.price_cents,
    status: row.status as ListingStatus,
    reviewNote: row.review_note,
    orders: row.orders,
    /*
     * The mean is computed on READ from the sum and the count, never stored.
     * A stored average cannot be corrected when a review is edited without
     * also keeping the sum — at which point the average is redundant, and two
     * numbers that must agree eventually will not.
     */
    rating: row.rating_count > 0 ? row.rating_sum / row.rating_count : null,
    ratingCount: row.rating_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `
  SELECT listings.*, users.handle AS author_handle
    FROM listings
    LEFT JOIN users ON users.id = listings.author_id
`;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface ListingResult {
  ok: boolean;
  listing?: Listing;
  error?: string;
}

export interface ListingInput {
  kind: string;
  title: string;
  slug?: string;
  summary?: string;
  description?: string;
  targetId?: string;
  priceCents?: number;
}

/**
 * Create a listing.
 *
 * The ownership check is the first thing that matters here: without it, anyone
 * can list anyone's map. It runs with the author's own context so that "is
 * this yours" is decided by the same repositories that decide it everywhere
 * else — and it is checked twice more later, because a listing outlives its
 * target.
 */
export function createListing(
  ctx: AuthContext,
  input: ListingInput,
  db: Database = getDb(),
): ListingResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };
  if (!isListingKind(input.kind)) return { ok: false, error: 'Unknown catalogue' };

  const adapter = adapterFor(input.kind);
  if (!adapter) return { ok: false, error: 'That catalogue is not available' };

  const title = input.title.trim().slice(0, 120);
  if (title.length < 3) return { ok: false, error: 'Give it a title' };

  const slug = slugify(input.slug?.trim() || title);
  if (slug.length < 3) return { ok: false, error: 'That name will not make a URL' };

  const targetId = (input.targetId ?? '').trim();
  if (!targetId) return { ok: false, error: 'Choose what you are listing' };

  if (!adapter.ownsTarget(ctx, targetId, db)) {
    // "Not yours" and "does not exist" get the same answer: distinguishing
    // them tells a stranger which ids are real.
    return { ok: false, error: 'That is not yours to list' };
  }

  const id = `lst_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  try {
    db.prepare(
      `INSERT INTO listings
         (id, kind, slug, title, summary, description, author_id, target_id,
          price_cents, status)
       VALUES (@id, @kind, @slug, @title, @summary, @description, @authorId,
               @targetId, @priceCents, 'draft')`,
    ).run({
      id,
      kind: input.kind,
      slug,
      title,
      summary: (input.summary ?? '').slice(0, 300),
      description: (input.description ?? '').slice(0, 8000),
      authorId: ctx.userId,
      targetId,
      priceCents: Math.max(0, Math.round(input.priceCents ?? 0)),
    });
  } catch (cause) {
    if (String(cause).includes('UNIQUE')) {
      return { ok: false, error: 'Another listing already uses that name' };
    }
    throw cause;
  }

  const listing = getListing(id, db);
  return listing ? { ok: true, listing } : { ok: false, error: 'Not found' };
}

/**
 * Edit a listing. Returns it to draft.
 *
 * Without that, review is theatre: get a harmless listing approved, then
 * rewrite the description into something that would never have passed while
 * keeping the approval. It is the oldest trick in app-store history and it
 * costs one line to prevent.
 */
export function updateListing(
  ctx: AuthContext,
  listingId: string,
  patch: Partial<Omit<ListingInput, 'kind'>>,
  db: Database = getDb(),
): ListingResult {
  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId) as
    ListingRow | undefined;

  if (!row || row.author_id !== ctx.userId)
    return { ok: false, error: 'Not found' };
  if (row.status === 'suspended') {
    return { ok: false, error: 'This listing is suspended. Contact us.' };
  }

  const title = patch.title?.trim().slice(0, 120) ?? row.title;
  if (title.length < 3) return { ok: false, error: 'Give it a title' };

  try {
    db.prepare(
      `UPDATE listings SET
         slug = @slug, title = @title, summary = @summary,
         description = @description, price_cents = @priceCents,
         status = 'draft', updated_at = datetime('now')
       WHERE id = @id`,
    ).run({
      id: listingId,
      slug: patch.slug ? slugify(patch.slug) : row.slug,
      title,
      summary: patch.summary?.slice(0, 300) ?? row.summary,
      description: patch.description?.slice(0, 8000) ?? row.description,
      // Rounded here, at the boundary, so a price can never be a fraction of
      // a cent — the same rule every other money value in this codebase obeys.
      priceCents:
        patch.priceCents === undefined
          ? row.price_cents
          : Math.max(0, Math.round(patch.priceCents)),
    });
  } catch (cause) {
    if (String(cause).includes('UNIQUE')) {
      return { ok: false, error: 'Another listing already uses that name' };
    }
    throw cause;
  }

  const listing = getListing(listingId, db);
  return listing ? { ok: true, listing } : { ok: false, error: 'Not found' };
}

export function getListing(
  listingId: string,
  db: Database = getDb(),
): Listing | null {
  const row = db.prepare(`${SELECT} WHERE listings.id = ?`).get(listingId) as
    ListingRow | undefined;

  return row ? hydrate(row) : null;
}

export function getListingBySlug(
  kind: ListingKind,
  slug: string,
  db: Database = getDb(),
): Listing | null {
  const row = db
    .prepare(`${SELECT} WHERE listings.kind = ? AND listings.slug = ?`)
    .get(kind, slug) as ListingRow | undefined;

  return row ? hydrate(row) : null;
}

export interface BrowseOptions {
  kind?: ListingKind;
  query?: string;
  price?: 'free' | 'paid';
  sort?: 'recent' | 'popular' | 'rating';
  limit?: number;
}

/**
 * The public catalogue. Published listings only.
 *
 * There is deliberately no "include drafts" flag. A single function that
 * sometimes returns unpublished rows depending on an argument is a function
 * whose one forgotten call site leaks them; `listingsBy` is separate for that
 * reason.
 */
export function browse(
  options: BrowseOptions = {},
  db: Database = getDb(),
): Listing[] {
  const clauses = ["listings.status = 'published'"];
  const params: Record<string, string | number> = {};

  if (options.kind) {
    clauses.push('listings.kind = @kind');
    params.kind = options.kind;
  }

  const query = options.query?.trim();

  if (query) {
    clauses.push(
      "(listings.title LIKE @q ESCAPE '\\' OR listings.summary LIKE @q ESCAPE '\\')",
    );
    /*
     * `%` and `_` are escaped before the wildcards are added.
     *
     * Without this a search for `%` matches every listing in the catalogue —
     * not an injection, since the value is still bound, but a search box that
     * returns everything for a single character is a search box nobody trusts.
     */
    const escaped = query.slice(0, 60).replace(/[\\%_]/g, (char) => `\\${char}`);
    params.q = `%${escaped}%`;
  }

  if (options.price === 'free') clauses.push('listings.price_cents = 0');
  if (options.price === 'paid') clauses.push('listings.price_cents > 0');

  const order =
    options.sort === 'popular'
      ? 'listings.orders DESC, listings.updated_at DESC'
      : options.sort === 'rating'
        ? /*
           * Unrated listings sort LAST rather than first. A listing with no
           * reviews has no average, and ordering on the raw value would put
           * everything nobody has tried at the top of a list sorted by how
           * good things are.
           */
          `listings.rating_count = 0,
           CAST(listings.rating_sum AS REAL) / MAX(listings.rating_count, 1) DESC,
           listings.updated_at DESC`
        : 'listings.updated_at DESC';

  params.limit = Math.min(100, Math.max(1, options.limit ?? 50));

  const rows = db
    .prepare(
      `${SELECT} WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT @limit`,
    )
    .all(params) as ListingRow[];

  return rows.map(hydrate);
}

/** The caller's own listings, at every status. */
export function listingsBy(ctx: AuthContext, db: Database = getDb()): Listing[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `${SELECT} WHERE listings.author_id = ? ORDER BY listings.updated_at DESC`,
    )
    .all(ctx.userId) as ListingRow[];

  return rows.map(hydrate);
}

/**
 * Submit for review. The target's ownership is checked AGAIN.
 *
 * The second of three checks. A listing can sit in draft for months, and in
 * that time the map it points at may have been deleted or transferred — so the
 * question is asked again at the moment it would become visible to buyers.
 */
export function submitListing(
  ctx: AuthContext,
  listingId: string,
  db: Database = getDb(),
): ListingResult {
  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId) as
    ListingRow | undefined;

  if (!row || row.author_id !== ctx.userId || row.status !== 'draft') {
    return { ok: false, error: 'Not found' };
  }

  const adapter = isListingKind(row.kind) ? adapterFor(row.kind) : undefined;
  if (!adapter) return { ok: false, error: 'That catalogue is not available' };

  if (!adapter.ownsTarget(ctx, row.target_id, db)) {
    return { ok: false, error: 'That is no longer yours to list' };
  }

  db.prepare(
    `UPDATE listings SET status = 'review', updated_at = datetime('now')
      WHERE id = ?`,
  ).run(listingId);

  const listing = getListing(listingId, db);
  return listing ? { ok: true, listing } : { ok: false, error: 'Not found' };
}

/** Approve, return to draft, or suspend. Staff only — one queue, four kinds. */
export function reviewListing(
  ctx: AuthContext,
  listingId: string,
  decision: 'published' | 'draft' | 'suspended',
  note = '',
  db: Database = getDb(),
): ListingResult {
  if (!ctx.isStaff) return { ok: false, error: 'Not found' };

  const changed = db
    .prepare(
      `UPDATE listings SET status = @status, review_note = @note,
              updated_at = datetime('now')
        WHERE id = @id`,
    )
    .run({ id: listingId, status: decision, note: note.slice(0, 500) }).changes;

  if (changed === 0) return { ok: false, error: 'Not found' };

  const listing = getListing(listingId, db);
  return listing ? { ok: true, listing } : { ok: false, error: 'Not found' };
}

/** Everything awaiting review, across all four catalogues. Staff only. */
export function listingReviewQueue(
  ctx: AuthContext,
  db: Database = getDb(),
): Listing[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `${SELECT} WHERE listings.status = 'review' ORDER BY listings.updated_at`,
    )
    .all() as ListingRow[];

  return rows.map(hydrate);
}

// ---------------------------------------------------------------- ordering

export interface Order {
  id: string;
  listingId: string;
  listingTitle: string;
  kind: ListingKind;
  buyerId: string;
  priceCents: number;
  status: 'pending' | 'fulfilled' | 'refunded' | 'cancelled';
  resultId: string | null;
  createdAt: string;
}

interface OrderRow {
  id: string;
  listing_id: string;
  title: string;
  kind: string;
  buyer_id: string;
  price_cents: number;
  status: string;
  result_id: string | null;
  created_at: string;
}

function hydrateOrder(row: OrderRow): Order {
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.title,
    kind: isListingKind(row.kind) ? row.kind : 'template',
    buyerId: row.buyer_id,
    priceCents: row.price_cents,
    status: row.status as Order['status'],
    resultId: row.result_id,
    createdAt: row.created_at,
  };
}

const ORDER_SELECT = `
  SELECT listing_orders.*, listings.title, listings.kind
    FROM listing_orders
    JOIN listings ON listings.id = listing_orders.listing_id
`;

export function getOrder(orderId: string, db: Database = getDb()): Order | null {
  const row = db
    .prepare(`${ORDER_SELECT} WHERE listing_orders.id = ?`)
    .get(orderId) as OrderRow | undefined;

  return row ? hydrateOrder(row) : null;
}

export interface OrderResult {
  ok: boolean;
  order?: Order;
  error?: string;
}

/**
 * Order a listing.
 *
 * ── What this does NOT do ───────────────────────────────────────────────────
 *
 * It does not take money. A paid listing produces a `pending` order and the
 * caller sends the buyer to Stripe; `fulfilOrder` runs when the webhook says
 * the money arrived. Charging here would mean this codebase moving money, and
 * migration 16 settled that: do not build a payment processor.
 *
 * A FREE listing is delivered immediately, because there is nothing to wait
 * for and sending someone to a checkout for a zero-value transaction is
 * ceremony.
 */
export function order(
  ctx: AuthContext,
  listingId: string,
  db: Database = getDb(),
): OrderResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const listing = getListing(listingId, db);
  if (!listing) return { ok: false, error: 'Not found' };

  if (listing.status !== 'published') {
    return { ok: false, error: 'That listing is not available' };
  }

  if (listing.authorId === ctx.userId) {
    /*
     * An author cannot order their own listing. Not a moral rule: the order
     * count sorts the catalogue, and a ranking anyone can move by clicking
     * their own listing is a ranking that means nothing.
     */
    return { ok: false, error: 'This is your own listing' };
  }

  const orderId = `ord_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  db.prepare(
    `INSERT INTO listing_orders (id, listing_id, buyer_id, price_cents, status)
     VALUES (?, ?, ?, ?, 'pending')`,
  ).run(orderId, listing.id, ctx.userId, listing.priceCents);

  if (listing.priceCents > 0) {
    const placed = getOrder(orderId, db);
    return placed ? { ok: true, order: placed } : { ok: false, error: 'Not found' };
  }

  return fulfilOrder(ctx, orderId, db);
}

/**
 * Deliver an order.
 *
 * Exported so the billing webhook can call it once payment settles, and
 * written to be safe to call twice — Stripe retries, and a retry that
 * delivered again would give away a second copy and count a second order.
 */
export function fulfilOrder(
  ctx: AuthContext,
  orderId: string,
  db: Database = getDb(),
): OrderResult {
  const existing = db
    .prepare('SELECT * FROM listing_orders WHERE id = ? AND buyer_id = ?')
    .get(orderId, ctx.userId) as
    { id: string; listing_id: string; status: string } | undefined;

  if (!existing) return { ok: false, error: 'Not found' };

  if (existing.status === 'fulfilled') {
    /*
     * Already delivered. Reported as SUCCESS with the original order, so a
     * retried webhook is idempotent rather than an error the caller has to
     * interpret — and, crucially, so it does not deliver again.
     */
    const already = getOrder(orderId, db);
    return already
      ? { ok: true, order: already }
      : { ok: false, error: 'Not found' };
  }

  const listing = getListing(existing.listing_id, db);
  if (!listing) return { ok: false, error: 'Not found' };

  const adapter = adapterFor(listing.kind);
  if (!adapter) return { ok: false, error: 'That catalogue is not available' };

  /*
   * THE THIRD OWNERSHIP CHECK, and the most important one.
   *
   * A listing outlives its target. Between publication and payment the author
   * may have deleted the map, transferred it, or had the plugin suspended.
   * Delivering regardless would hand the buyer something the author no longer
   * has the right to give — which for a template means copying a map that is
   * now somebody else's.
   */
  if (
    !adapter.ownsTarget(
      { userId: listing.authorId, isStaff: false },
      listing.targetId,
      db,
    )
  ) {
    return { ok: false, error: 'That is no longer available' };
  }

  const delivered = adapter.fulfil({
    buyer: ctx,
    authorId: listing.authorId,
    targetId: listing.targetId,
    listingId: listing.id,
    title: listing.title,
    db,
  });

  if (!delivered.ok) return { ok: false, error: delivered.error };

  db.transaction(() => {
    db.prepare(
      `UPDATE listing_orders SET status = 'fulfilled', result_id = ? WHERE id = ?`,
    ).run(delivered.resultId ?? null, orderId);

    db.prepare('UPDATE listings SET orders = orders + 1 WHERE id = ?').run(
      listing.id,
    );
  })();

  const done = getOrder(orderId, db);
  return done ? { ok: true, order: done } : { ok: false, error: 'Not found' };
}

export function ordersFor(ctx: AuthContext, db: Database = getDb()): Order[] {
  if (!ctx.userId) return [];

  const rows = db
    .prepare(
      `${ORDER_SELECT} WHERE listing_orders.buyer_id = ?
        ORDER BY listing_orders.created_at DESC LIMIT 100`,
    )
    .all(ctx.userId) as OrderRow[];

  return rows.map(hydrateOrder);
}

// ----------------------------------------------------------------- ratings

export interface RateResult {
  ok: boolean;
  error?: string;
}

/**
 * Rate a listing.
 *
 * ── You must have received it ───────────────────────────────────────────────
 *
 * The single most important line in this function. Without it a rating is an
 * opinion from someone who never used the thing, which makes the whole score
 * worth nothing: a competitor can bury a listing and an author can inflate
 * their own. The unique index does the rest by holding each buyer to one.
 */
export function rate(
  ctx: AuthContext,
  listingId: string,
  input: { rating: number; body?: string },
  db: Database = getDb(),
): RateResult {
  if (!ctx.userId) return { ok: false, error: 'Sign in first' };

  const score = Math.round(input.rating);
  if (score < 1 || score > 5) return { ok: false, error: 'Rate it from 1 to 5' };

  const ordered = db
    .prepare(
      `SELECT 1 FROM listing_orders
        WHERE listing_id = ? AND buyer_id = ? AND status = 'fulfilled' LIMIT 1`,
    )
    .get(listingId, ctx.userId);

  if (!ordered) return { ok: false, error: 'Only people who got it can rate it' };

  return db.transaction(() => {
    const previous = db
      .prepare(
        'SELECT rating FROM listing_reviews WHERE listing_id = ? AND author_id = ?',
      )
      .get(listingId, ctx.userId) as { rating: number } | undefined;

    db.prepare(
      `INSERT INTO listing_reviews (id, listing_id, author_id, rating, body)
       VALUES (@id, @listingId, @authorId, @rating, @body)
       ON CONFLICT(listing_id, author_id) DO UPDATE SET
         rating = excluded.rating,
         body = excluded.body,
         created_at = datetime('now')`,
    ).run({
      id: `rev_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      listingId,
      authorId: ctx.userId,
      rating: score,
      body: (input.body ?? '').slice(0, 2000),
    });

    /*
     * On an EDIT the counters move by the delta, and the count does not move
     * at all. Adding the new score without subtracting the old one is how a
     * listing slowly acquires an average nobody ever gave it — the count stays
     * right, which is what makes the drift so hard to notice.
     */
    if (previous) {
      db.prepare(
        'UPDATE listings SET rating_sum = rating_sum + ? WHERE id = ?',
      ).run(score - previous.rating, listingId);
    } else {
      db.prepare(
        `UPDATE listings SET rating_sum = rating_sum + ?,
                rating_count = rating_count + 1
          WHERE id = ?`,
      ).run(score, listingId);
    }

    return { ok: true };
  })();
}

export interface ListingReview {
  id: string;
  authorHandle: string;
  rating: number;
  body: string;
  createdAt: string;
}

export function reviewsFor(
  listingId: string,
  limit = 25,
  db: Database = getDb(),
): ListingReview[] {
  const rows = db
    .prepare(
      `SELECT listing_reviews.*, users.handle
         FROM listing_reviews
         LEFT JOIN users ON users.id = listing_reviews.author_id
        WHERE listing_id = ?
        ORDER BY listing_reviews.created_at DESC LIMIT ?`,
    )
    .all(listingId, limit) as {
    id: string;
    handle: string | null;
    rating: number;
    body: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    authorHandle: row.handle ?? 'someone',
    rating: row.rating,
    body: row.body,
    createdAt: row.created_at,
  }));
}
