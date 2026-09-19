import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkUrl } from '@/lib/ingest/ssrf';
import { FetchError, fetchPage } from '@/lib/ingest/fetcher';
import { extract } from '@/lib/ingest/extract';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ingest/preview — §12 step 3.
 *
 * "Resolving the title before processing is the trust moment. Do it in
 * <800 ms." So this route does the minimum that earns trust: the address
 * policy, then one fetch, then the title out of the head. No robots check, no
 * extraction of body structure, and above all no model call.
 *
 * Deliberately NOT counted against the rate limit. A preview happens on every
 * paste, including corrections, and charging a run for each would exhaust a
 * signed-out visitor's single free run before they ever pressed the button.
 * The fetch itself is still guarded, size-capped and timed out, which is what
 * bounds the abuse.
 */

const schema = z.object({ url: z.string().trim().min(1).max(2048) });

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'format' }, { status: 400 });
  }

  // Accept "example.com/page" the way a browser bar does — a user pasting a
  // URL without a scheme has not made a mistake worth an error message.
  const raw = parsed.data.url;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  const verdict = checkUrl(candidate);
  if (!verdict.ok) {
    return NextResponse.json(
      { ok: false, reason: verdict.reason, message: verdict.detail },
      { status: 200 }, // a rejected URL is a normal answer to a preview, not an error
    );
  }

  const url = new URL(candidate);
  const startedAt = performance.now();

  try {
    /**
     * robots.txt is skipped HERE and enforced on the real run. Reading a
     * title to show the user what they pasted is not crawling, and fetching
     * robots.txt first would double the latency of a step budgeted at 800 ms.
     *
     * `headOnly` stops the read at `</head>`. Without it this route downloads
     * an entire article to display its title, which measured 2.4 s against
     * that 800 ms budget.
     */
    const page = await fetchPage(candidate, { skipRobots: true, headOnly: true });
    const fetchedAt = performance.now();
    const extracted = extract(page.html, page.finalUrl);

    return NextResponse.json({
      ok: true,
      /**
       * Split so the 800 ms budget in §12 can be held against the right thing.
       * `ms` is the whole step; `upstreamMs` is time spent waiting for someone
       * else's server. Only the difference is ours to optimise, and when the
       * budget is missed it is almost entirely the upstream half.
       */
      ms: Math.round(performance.now() - startedAt),
      upstreamMs: Math.round(fetchedAt - startedAt),
      url: page.finalUrl,
      title: extracted.title,
      siteName: extracted.siteName,
      description: extracted.description,
      // Rendered by the browser directly from the origin; we never proxy it.
      favicon: `${new URL(page.finalUrl).origin}/favicon.ico`,
      paywalled: extracted.paywalled,
      thin: extracted.wordCount < 120,
    });
  } catch (error) {
    const failure = error instanceof FetchError ? error.failure : 'unreachable';
    return NextResponse.json(
      {
        ok: false,
        reason: failure,
        // Enough to identify the page, so the field is not left blank while
        // the user decides whether to run it anyway.
        title: url.hostname.replace(/^www\./, ''),
      },
      { status: 200 },
    );
  }
}
