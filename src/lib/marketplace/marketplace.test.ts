import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser, getMap, listOwnedMaps } from '@/lib/db/repo';
import { listPipeline } from '@/lib/services/pipeline';
import { LISTING_KINDS, adapterFor, allKinds, isListingKind } from './kinds';
import { ensureCatalogues } from './catalogues';
import {
  browse,
  createListing,
  fulfilOrder,
  getListing,
  listingReviewQueue,
  listingsBy,
  order,
  ordersFor,
  rate,
  reviewListing,
  reviewsFor,
  submitListing,
  updateListing,
} from './repo';

/**
 * Marketplace tests.
 *
 * ── The claim being tested ──────────────────────────────────────────────────
 *
 * "One marketplace framework, four catalogues." That is only true if the
 * shared machinery genuinely is shared, so the review, ordering and rating
 * blocks below run against every kind rather than against templates with the
 * others assumed to follow.
 *
 * ── The thing that must never happen ────────────────────────────────────────
 *
 * Somebody listing something that is not theirs, and a buyer receiving a copy
 * of a private map. `ownsTarget` is checked at create, at submit and again at
 * delivery, and each of those has a test.
 */

let db: Database;
let author: { userId: string; isStaff: boolean };
let buyer: { userId: string; isStaff: boolean };
let staff: { userId: string; isStaff: boolean };

function makeMap(
  ctx: { userId: string; isStaff: boolean },
  id: string,
  visibility: 'private' | 'public' = 'private',
) {
  createMap(
    ctx,
    {
      id,
      title: `Source map ${id}`,
      family: 'create',
      visibility,
      rootId: `${id}-root`,
      version: 1,
      updatedAt: new Date().toISOString(),
      dirty: [],
      metaDirty: false,
      nodes: {
        [`${id}-root`]: {
          id: `${id}-root`,
          map_id: id,
          parent_id: null,
          slot: 0,
          title: 'Root',
          family: 'create',
          type: 'topic',
          status: 'active',
          visibility: 'public',
          weight: 0.5,
        },
        [`${id}-child`]: {
          id: `${id}-child`,
          map_id: id,
          parent_id: `${id}-root`,
          slot: 0,
          title: 'Child',
          family: 'create',
          type: 'note',
          status: 'active',
          visibility: 'public',
          weight: 0.5,
        },
      },
    },
    db,
  );
}

/** A published template listing, which most tests below need. */
function publishedTemplate(priceCents = 0) {
  makeMap(author, 'map_source');

  const created = createListing(
    author,
    {
      kind: 'template',
      title: 'A starter map',
      targetId: 'map_source',
      priceCents,
    },
    db,
  );

  submitListing(author, created.listing!.id, db);
  reviewListing(staff, created.listing!.id, 'published', '', db);

  return created.listing!.id;
}

beforeEach(() => {
  db = createTestDb();
  ensureCatalogues();

  for (const [id, handle] of [
    ['u_author', 'author'],
    ['u_buyer', 'buyer'],
    ['u_staff', 'staffer'],
  ] as const) {
    createUser(
      {
        id,
        email: `${handle}@example.com`,
        passwordHash: 'x',
        handle,
        displayName: handle,
      },
      db,
    );
  }

  author = { userId: 'u_author', isStaff: false };
  buyer = { userId: 'u_buyer', isStaff: false };
  staff = { userId: 'u_staff', isStaff: true };
});

// ----------------------------------------------------------------- catalogues

describe('the four catalogues', () => {
  it('are all registered', () => {
    expect(allKinds()).toHaveLength(4);
    expect(LISTING_KINDS).toEqual(['template', 'plugin', 'agent', 'freelancing']);
  });

  it('each have an adapter', () => {
    for (const kind of LISTING_KINDS) {
      expect(adapterFor(kind)).toBeDefined();
    }
  });

  it('reject a kind that is not one', () => {
    expect(isListingKind('template')).toBe(true);
    expect(isListingKind('nfts')).toBe(false);
  });
});

// ------------------------------------------------------------------ ownership

describe('you can only list what is yours', () => {
  it('refuses a map you do not own', () => {
    makeMap(author, 'map_source');

    const result = createListing(
      buyer,
      { kind: 'template', title: 'Stolen', targetId: 'map_source' },
      db,
    );

    expect(result.ok).toBe(false);
  });

  it('refuses a PUBLIC map you can merely see', () => {
    /*
     * The subtle version of the same theft. `getMap` returns any map the
     * caller may see, which includes public maps belonging to strangers, so
     * the adapter checks `canEdit` rather than visibility.
     */
    makeMap(author, 'map_public', 'public');

    expect(getMap(buyer, 'map_public', db)).not.toBeNull();
    expect(
      createListing(
        buyer,
        { kind: 'template', title: 'Not mine', targetId: 'map_public' },
        db,
      ).ok,
    ).toBe(false);
  });

  it('refuses a freelancing listing for somebody else', () => {
    expect(
      createListing(
        author,
        { kind: 'freelancing', title: 'Hire them', targetId: 'u_buyer' },
        db,
      ).ok,
    ).toBe(false);

    expect(
      createListing(
        author,
        { kind: 'freelancing', title: 'Hire me', targetId: 'u_author' },
        db,
      ).ok,
    ).toBe(true);
  });

  it('refuses submission once the target has gone', () => {
    makeMap(author, 'map_source');
    const created = createListing(
      author,
      { kind: 'template', title: 'Starter', targetId: 'map_source' },
      db,
    );

    db.prepare('DELETE FROM maps WHERE id = ?').run('map_source');

    // Re-checked at submit: the world moves under a long-lived row.
    expect(submitListing(author, created.listing!.id, db).ok).toBe(false);
  });
});

// --------------------------------------------------------------------- review

describe('the shared review queue', () => {
  it('keeps a draft out of the catalogue', () => {
    makeMap(author, 'map_source');
    createListing(
      author,
      { kind: 'template', title: 'Starter', targetId: 'map_source' },
      db,
    );

    expect(browse({}, db)).toHaveLength(0);
  });

  it('covers all four catalogues at once', () => {
    // The point of one framework: one queue, whatever the kind.
    makeMap(author, 'map_source');

    // Asserted rather than assumed: the first version of this test used
    // one-letter titles, whose slugs fell below the minimum length, and the
    // creations failed silently — leaving an empty queue that looked like a
    // bug in the queue.
    expect(
      createListing(
        author,
        { kind: 'template', title: 'Starter map', targetId: 'map_source' },
        db,
      ).ok,
    ).toBe(true);

    expect(
      createListing(
        author,
        { kind: 'freelancing', title: 'Design help', targetId: 'u_author' },
        db,
      ).ok,
    ).toBe(true);

    for (const listing of listingsBy(author, db)) {
      expect(submitListing(author, listing.id, db).ok).toBe(true);
    }

    expect(listingReviewQueue(staff, db)).toHaveLength(2);
  });

  it('is invisible to a non-staff user', () => {
    publishedTemplate();

    expect(listingReviewQueue(author, db)).toEqual([]);
  });

  it('will not let a non-staff user publish', () => {
    makeMap(author, 'map_source');
    const created = createListing(
      author,
      { kind: 'template', title: 'Starter', targetId: 'map_source' },
      db,
    );
    submitListing(author, created.listing!.id, db);

    expect(reviewListing(author, created.listing!.id, 'published', '', db).ok).toBe(
      false,
    );
    expect(browse({}, db)).toHaveLength(0);
  });

  it('lets staff suspend something already published', () => {
    const listingId = publishedTemplate();

    reviewListing(staff, listingId, 'suspended', 'Abusive', db);

    expect(browse({}, db)).toHaveLength(0);
    // And it can no longer be ordered.
    expect(order(buyer, listingId, db).ok).toBe(false);
  });
});

// ------------------------------------------------------------------- browsing

describe('browsing', () => {
  beforeEach(() => {
    publishedTemplate();

    const freelance = createListing(
      author,
      {
        kind: 'freelancing',
        title: 'Design help',
        targetId: 'u_author',
        priceCents: 50_000,
      },
      db,
    );
    submitListing(author, freelance.listing!.id, db);
    reviewListing(staff, freelance.listing!.id, 'published', '', db);
  });

  it('filters by catalogue', () => {
    expect(browse({ kind: 'template' }, db)).toHaveLength(1);
    expect(browse({ kind: 'freelancing' }, db)).toHaveLength(1);
    expect(browse({ kind: 'agent' }, db)).toHaveLength(0);
  });

  it('filters by price', () => {
    expect(browse({ price: 'free' }, db)).toHaveLength(1);
    expect(browse({ price: 'paid' }, db)).toHaveLength(1);
  });

  it('searches title and summary', () => {
    expect(browse({ query: 'starter' }, db)).toHaveLength(1);
    expect(browse({ query: 'nothing here' }, db)).toHaveLength(0);
  });

  it('does not let a wildcard in a search match everything', () => {
    // An unescaped % in user input turns a search into "return all rows",
    // which is a filter that silently stops filtering.
    expect(browse({ query: '%' }, db)).toHaveLength(0);
  });

  it('reports no rating rather than a rating of zero', () => {
    /*
     * A zero would sort below a genuinely bad listing and render as "0 stars"
     * — a claim about quality that nobody made.
     */
    expect(browse({}, db)[0]?.rating).toBeNull();
    expect(browse({}, db)[0]?.ratingCount).toBe(0);
  });
});

// -------------------------------------------------------------------- ordering

describe('ordering a free listing', () => {
  it('delivers immediately', () => {
    const listingId = publishedTemplate();

    const result = order(buyer, listingId, db);

    expect(result.ok).toBe(true);
    expect(result.order?.status).toBe('fulfilled');
  });

  it('copies the map into the buyer’s account', () => {
    const listingId = publishedTemplate();

    const result = order(buyer, listingId, db);
    const copy = getMap(buyer, result.order!.resultId!, db);

    expect(copy).not.toBeNull();
    expect(Object.keys(copy!.nodes)).toHaveLength(2);
    expect(listOwnedMaps(buyer, db)).toHaveLength(1);
  });

  it('gives the copy fresh node ids', () => {
    /*
     * Node ids are global, not per-map. Copying them verbatim would make two
     * maps claim the same rows the moment anything looked a node up by id.
     */
    const listingId = publishedTemplate();
    const result = order(buyer, listingId, db);
    const copy = getMap(buyer, result.order!.resultId!, db);

    expect(Object.keys(copy!.nodes)).not.toContain('map_source-root');
    expect(copy!.rootId).not.toBe('map_source-root');
  });

  it('remaps the parent pointers so the tree survives', () => {
    const listingId = publishedTemplate();
    const result = order(buyer, listingId, db);
    const copy = getMap(buyer, result.order!.resultId!, db);

    const child = Object.values(copy!.nodes).find((node) => node.title === 'Child');

    expect(child?.parent_id).toBe(copy!.rootId);
  });

  it('makes the copy private whatever the original was', () => {
    // A copy inheriting `public` would publish the buyer's new map before
    // they had looked at it. Visibility is their decision.
    makeMap(author, 'map_open', 'public');
    const created = createListing(
      author,
      { kind: 'template', title: 'Open starter', targetId: 'map_open' },
      db,
    );
    submitListing(author, created.listing!.id, db);
    reviewListing(staff, created.listing!.id, 'published', '', db);

    const result = order(buyer, created.listing!.id, db);

    expect(getMap(buyer, result.order!.resultId!, db)?.visibility).toBe('private');
  });

  it('does not give the buyer access to the original', () => {
    const listingId = publishedTemplate();
    order(buyer, listingId, db);

    // Buying a template copies a map. It does not make the author's map
    // readable, which is a different thing entirely.
    expect(getMap(buyer, 'map_source', db)).toBeNull();
  });

  it('counts the order', () => {
    const listingId = publishedTemplate();
    order(buyer, listingId, db);

    expect(getListing(listingId, db)?.orders).toBe(1);
  });

  it('refuses an order on your own listing', () => {
    // Not a moral rule: the order count sorts the catalogue.
    const listingId = publishedTemplate();

    expect(order(author, listingId, db).ok).toBe(false);
  });
});

describe('ordering a paid listing', () => {
  it('records it pending and delivers nothing', () => {
    /*
     * "Do not build a payment processor." Money moves through Stripe; this
     * row says what was bought. Fulfilling here would be giving the thing away
     * and hoping.
     */
    const listingId = publishedTemplate(2500);

    const result = order(buyer, listingId, db);

    expect(result.order?.status).toBe('pending');
    expect(result.order?.priceCents).toBe(2500);
    expect(listOwnedMaps(buyer, db)).toHaveLength(0);
    expect(getListing(listingId, db)?.orders).toBe(0);
  });

  it('delivers when the billing layer says the money arrived', () => {
    const listingId = publishedTemplate(2500);
    const placed = order(buyer, listingId, db);

    const fulfilled = fulfilOrder(buyer, placed.order!.id, db);

    expect(fulfilled.order?.status).toBe('fulfilled');
    expect(listOwnedMaps(buyer, db)).toHaveLength(1);
  });

  it('does not deliver twice when the payment webhook is retried', () => {
    // Stripe retries. A retry that delivered again would give away a second
    // copy and count a second order.
    const listingId = publishedTemplate(2500);
    const placed = order(buyer, listingId, db);

    fulfilOrder(buyer, placed.order!.id, db);
    fulfilOrder(buyer, placed.order!.id, db);

    expect(listOwnedMaps(buyer, db)).toHaveLength(1);
    expect(getListing(listingId, db)?.orders).toBe(1);
  });

  it('refuses to deliver once the author has lost the target', () => {
    const listingId = publishedTemplate(2500);
    const placed = order(buyer, listingId, db);

    db.prepare('DELETE FROM maps WHERE id = ?').run('map_source');

    // The third ownership check. A listing outlives its target, and
    // delivering regardless would hand over something the author no longer
    // has the right to give.
    expect(fulfilOrder(buyer, placed.order!.id, db).ok).toBe(false);
  });
});

describe('ordering a freelancer', () => {
  it('creates an enquiry in the existing pipeline, assigned to them', () => {
    /*
     * Not a second messaging system. The services pipeline already has
     * stages, ownership, quotes and follow-ups, and is already what somebody
     * looks at each morning — an order landing anywhere else is work nobody
     * sees.
     */
    const created = createListing(
      author,
      { kind: 'freelancing', title: 'Design help', targetId: 'u_author' },
      db,
    );
    submitListing(author, created.listing!.id, db);
    reviewListing(staff, created.listing!.id, 'published', '', db);

    const result = order(buyer, created.listing!.id, db);

    expect(result.order?.status).toBe('fulfilled');

    const pipeline = listPipeline(staff, {}, db);
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0]?.ownerId).toBe('u_author');
    expect(pipeline[0]?.stage).toBe('lead');
    expect(pipeline[0]?.email).toBe('buyer@example.com');
  });
});

// -------------------------------------------------------------------- ratings

describe('ratings', () => {
  it('are refused from someone who has not bought', () => {
    // Without this, ratings are opinions from people who never used the thing.
    const listingId = publishedTemplate();

    expect(rate(buyer, listingId, { rating: 5 }, db).ok).toBe(false);
    expect(getListing(listingId, db)?.ratingCount).toBe(0);
  });

  it('are accepted from a buyer', () => {
    const listingId = publishedTemplate();
    order(buyer, listingId, db);

    expect(rate(buyer, listingId, { rating: 4, body: 'Useful' }, db).ok).toBe(true);
    expect(getListing(listingId, db)?.rating).toBe(4);
  });

  it('are refused outside one to five', () => {
    const listingId = publishedTemplate();
    order(buyer, listingId, db);

    expect(rate(buyer, listingId, { rating: 0 }, db).ok).toBe(false);
    expect(rate(buyer, listingId, { rating: 6 }, db).ok).toBe(false);
  });

  it('count once per person however often they are submitted', () => {
    // One person is not a rating campaign.
    const listingId = publishedTemplate();
    order(buyer, listingId, db);

    rate(buyer, listingId, { rating: 5 }, db);
    rate(buyer, listingId, { rating: 5 }, db);
    rate(buyer, listingId, { rating: 5 }, db);

    expect(getListing(listingId, db)?.ratingCount).toBe(1);
    expect(reviewsFor(listingId, 10, db)).toHaveLength(1);
  });

  it('adjust the average correctly when a review is edited', () => {
    /*
     * The bug this guards: adding the new rating without subtracting the old
     * one. The count stays right, the sum drifts, and a listing slowly
     * acquires an average nobody gave it.
     */
    const listingId = publishedTemplate();
    order(buyer, listingId, db);

    rate(buyer, listingId, { rating: 5 }, db);
    rate(buyer, listingId, { rating: 1 }, db);

    expect(getListing(listingId, db)?.rating).toBe(1);
    expect(getListing(listingId, db)?.ratingCount).toBe(1);
  });
});

// ------------------------------------------------------------------ ownership

describe('listing management', () => {
  it('shows a person only their own listings', () => {
    publishedTemplate();

    expect(listingsBy(author, db)).toHaveLength(1);
    expect(listingsBy(buyer, db)).toHaveLength(0);
  });

  it('will not let one person edit another’s listing', () => {
    const listingId = publishedTemplate();

    expect(updateListing(buyer, listingId, { priceCents: 0 }, db).ok).toBe(false);
    expect(getListing(listingId, db)?.title).toBe('A starter map');
  });

  it('keeps prices as whole cents', () => {
    const listingId = publishedTemplate();

    updateListing(author, listingId, { priceCents: 1999.7 }, db);

    expect(getListing(listingId, db)?.priceCents).toBe(2000);
  });

  it('refuses two listings with one slug in a catalogue', () => {
    makeMap(author, 'map_a');
    makeMap(author, 'map_b');

    createListing(
      author,
      { kind: 'template', title: 'Same name', targetId: 'map_a' },
      db,
    );

    expect(
      createListing(
        author,
        { kind: 'template', title: 'Same name', targetId: 'map_b' },
        db,
      ).ok,
    ).toBe(false);
  });

  it('allows the same slug in a different catalogue', () => {
    // The unique index is (kind, slug): the catalogues are separate
    // namespaces, which is what makes them four catalogues rather than one.
    makeMap(author, 'map_a');

    expect(
      createListing(
        author,
        { kind: 'template', title: 'Design help', targetId: 'map_a' },
        db,
      ).ok,
    ).toBe(true);

    expect(
      createListing(
        author,
        { kind: 'freelancing', title: 'Design help', targetId: 'u_author' },
        db,
      ).ok,
    ).toBe(true);
  });

  it('lists a buyer’s own orders', () => {
    const listingId = publishedTemplate();
    order(buyer, listingId, db);

    expect(ordersFor(buyer, db)).toHaveLength(1);
    expect(ordersFor(author, db)).toHaveLength(0);
  });
});
