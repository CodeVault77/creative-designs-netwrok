import { requireAuth } from '@/lib/auth/guard';
import {
  COLLECTIONS,
  collectionCounts,
  collectionFor,
  totalsFor,
  type CollectionSlug,
} from '@/lib/nodes/collections';
import { CollectionScreen } from './CollectionScreen';

/**
 * The server half of a collection destination, shared by all three routes.
 *
 * ── Why the data is read here rather than fetched ───────────────────────────
 *
 * Unlike the billing screen, nothing here changes as a result of leaving the
 * page and coming back, so there is no stale-after-redirect problem to solve.
 * Reading in the server component means the guard, the query and the render
 * happen once — no loading state, and no second round trip for data the page
 * cannot be drawn without.
 *
 * It also keeps the type filter honest. The client is handed exactly the rows
 * it may see and its tabs filter that array; there is no endpoint it could ask
 * for a type outside the package, because there is no endpoint.
 */
export async function collectionPage(slug: CollectionSlug) {
  const session = await requireAuth(`/${slug}`);
  const collection = COLLECTIONS[slug];

  const ctx = { userId: session.userId, isStaff: session.isStaff };
  const items = collectionFor(ctx, collection.types);

  return (
    <CollectionScreen
      title={collection.title}
      blurb={collection.blurb}
      items={items}
      counts={collectionCounts(ctx, collection.types)}
      totals={totalsFor(items)}
      /*
       * Money is shown for Commerce only. On Work the total would be a
       * confident zero on every visit — a number that is technically correct
       * and reads as a bug.
       */
      showValue={slug === 'commerce'}
    />
  );
}
