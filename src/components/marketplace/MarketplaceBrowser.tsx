'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Chip, TextField, useToast } from '@/components/ui';

/**
 * The marketplace, all four catalogues.
 *
 * ── One screen, not four ────────────────────────────────────────────────────
 *
 * The catalogues share a review process, a rating model and an order flow, so
 * they share a screen. `kind` is a filter, not a different page — which also
 * means adding a fifth catalogue changes nothing here.
 *
 * ── Ratings are never invented ──────────────────────────────────────────────
 *
 * An unrated listing says "No ratings yet". It does not show zero stars, and
 * it does not show an average borrowed from somewhere. A number nobody gave is
 * a claim about someone's work that we made up.
 */

interface Listing {
  id: string;
  kind: string;
  slug: string;
  title: string;
  summary: string;
  authorHandle: string | null;
  priceCents: number;
  orders: number;
  rating: number | null;
  ratingCount: number;
}

interface Catalogue {
  kind: string;
  label: string;
  blurb: string;
}

interface Order {
  id: string;
  listingId: string;
  status: string;
  resultId: string | null;
}

function money(cents: number): string {
  if (cents === 0) return 'Free';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin-bottom: var(--space-4);
`;

const Blurb = styled.p`
  margin: 0 0 var(--space-6);
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Grid = styled.div`
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
`;

const CardBox = styled.article`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  background: var(--ground-surface);
`;

const Title = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
  overflow-wrap: anywhere;
`;

const Summary = styled.p`
  margin: 0;
  flex: 1;
  color: var(--ground-muted);
  font-size: var(--text-label);
  line-height: 1.6;
  overflow-wrap: anywhere;
`;

const Meta = styled.p`
  margin: 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
`;

const Price = styled.span`
  font-family: var(--face-mono);
  color: var(--ground-ink);
`;

const Muted = styled.p`
  color: var(--ground-muted);
  line-height: 1.6;
`;

export function MarketplaceBrowser({ signedIn }: { signedIn: boolean }) {
  const toast = useToast();
  const [catalogues, setCatalogues] = useState<Catalogue[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (query.trim()) params.set('q', query.trim());

    const response = await fetch(`/api/marketplace?${params.toString()}`);
    if (!response.ok) return;

    const body = (await response.json()) as {
      catalogues: Catalogue[];
      listings: Listing[];
      orders: Order[];
    };

    setCatalogues(body.catalogues);
    setListings(body.listings);
    setOrders(body.orders);
    setLoaded(true);
  }, [kind, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const place = useCallback(
    async (listing: Listing) => {
      setBusy(true);
      try {
        const response = await fetch('/api/marketplace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'order', listingId: listing.id }),
        });

        const body = (await response.json().catch(() => ({}))) as {
          order?: Order;
          error?: string;
        };

        if (!response.ok || !body.order) {
          toast.show({ tone: 'danger', message: body.error ?? 'Could not order.' });
          return;
        }

        /*
         * A pending order is a paid listing awaiting payment, not a failure.
         * Saying "done" here would tell someone they own something they have
         * not paid for yet.
         */
        toast.show({
          tone: body.order.status === 'fulfilled' ? 'success' : 'neutral',
          message:
            body.order.status === 'fulfilled'
              ? 'Yours. Look in My Maps.'
              : 'Recorded. Payment next.',
        });

        await load();
      } finally {
        setBusy(false);
      }
    },
    [load, toast],
  );

  const active = catalogues.find((catalogue) => catalogue.kind === kind);
  const owned = new Set(
    orders.filter((order) => order.status === 'fulfilled').map((o) => o.listingId),
  );

  return (
    <>
      <Filters>
        <Chip selected={kind === ''} onClick={() => setKind('')}>
          Everything
        </Chip>
        {catalogues.map((catalogue) => (
          <Chip
            key={catalogue.kind}
            selected={kind === catalogue.kind}
            onClick={() => setKind(catalogue.kind)}
          >
            {catalogue.label}
          </Chip>
        ))}
      </Filters>

      <div style={{ maxWidth: '24rem', marginBottom: 'var(--space-4)' }}>
        <TextField
          label="Search"
          hideLabel
          shape="pill"
          placeholder="Search the marketplace"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {active && <Blurb>{active.blurb}</Blurb>}

      {!loaded && <Muted>Loading…</Muted>}

      {loaded && listings.length === 0 && (
        /*
          Said plainly. A marketplace with nothing in it is a real state on a
          new deployment, and dressing it up with placeholder listings would be
          inventing products that do not exist.
        */
        <Muted>
          Nothing here yet. Published listings appear once someone submits one and
          it passes review.
        </Muted>
      )}

      <Grid>
        {listings.map((listing) => (
          <CardBox key={listing.id}>
            <Title>{listing.title}</Title>

            <Meta>
              {listing.kind}
              {listing.authorHandle && ` · @${listing.authorHandle}`}
            </Meta>

            <Summary>{listing.summary || 'No description given.'}</Summary>

            <Meta>
              {listing.rating === null
                ? 'No ratings yet'
                : `${listing.rating.toFixed(1)} from ${listing.ratingCount} ${
                    listing.ratingCount === 1 ? 'rating' : 'ratings'
                  }`}
              {listing.orders > 0 && ` · ${listing.orders} taken`}
            </Meta>

            <div
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                alignItems: 'center',
                marginTop: 'var(--space-2)',
              }}
            >
              <Price>{money(listing.priceCents)}</Price>

              {owned.has(listing.id) ? (
                <Meta>Yours</Meta>
              ) : (
                <Button
                  size="sm"
                  disabled={busy || !signedIn}
                  onClick={() => void place(listing)}
                >
                  {listing.priceCents === 0 ? 'Get it' : 'Buy'}
                </Button>
              )}
            </div>

            {!signedIn && <Meta>Sign in to take this.</Meta>}
          </CardBox>
        ))}
      </Grid>
    </>
  );
}
