import { NextResponse } from 'next/server';
import { handle, preflight } from '@/lib/api/gateway';
import { browse } from '@/lib/marketplace/repo';
import { isListingKind } from '@/lib/marketplace/kinds';

// The four adapters register themselves when this module loads. Imported for
// that effect, and named so the import is not mistaken for a stray one.
import { ensureCatalogues } from '@/lib/marketplace/catalogues';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/marketplace — the published catalogues.
 *
 * Behind a key even though the catalogue is public, because everything under
 * `/api/v1` is: one authentication rule, applied by one gateway. An endpoint
 * that opted out would be the one place the rate limit, the request log and
 * the attribution did not apply.
 */
export async function GET(request: Request) {
  ensureCatalogues();

  return handle(request, { scopes: ['marketplace:read'] }, ({ db }) => {
    const params = new URL(request.url).searchParams;
    const kindParam = params.get('kind');
    const priceParam = params.get('price');

    return NextResponse.json({
      data: browse(
        {
          // An unrecognised value is ignored rather than rejected: a stale
          // client asking for a catalogue we renamed should see everything,
          // not an error.
          kind: kindParam && isListingKind(kindParam) ? kindParam : undefined,
          query: params.get('q') ?? undefined,
          price:
            priceParam === 'free' || priceParam === 'paid' ? priceParam : undefined,
          limit: Number(params.get('limit') ?? '50'),
        },
        db,
      ),
    });
  });
}

export function OPTIONS() {
  return preflight();
}
