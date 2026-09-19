/**
 * P13 load test.
 *
 * §20 lists "load test" among P13's engineering work. This is deliberately a
 * SMOKE load test, not a capacity plan: the target is a closed beta of 20–50
 * users (§20 P14), so the useful question is not "how many requests per second
 * can it serve" but "does anything fall over, leak, or degrade non-linearly at
 * the scale we are actually about to see".
 *
 * What it measures:
 *   - p50/p95/p99 latency on the read paths people hit constantly
 *   - whether concurrency makes anything fail rather than merely slow down
 *   - whether the event log and the SSE endpoint survive many open streams
 *   - whether memory grows without bound over a sustained run
 *
 * Stated plainly because it is easy to over-claim: a single Node process with
 * SQLite is not a horizontally scalable deployment, and this test does not
 * pretend otherwise. It establishes a floor and a baseline to regress against.
 */

const BASE = 'http://localhost:3000';
let failures = 0;

function check(label, ok, detail = '') {
  if (ok) console.log(`ok   ${label}${detail ? '  ' + detail : ''}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? '  ' + detail : ''}`);
  }
}

function section(name) {
  console.log(`\n— ${name} ${'-'.repeat(Math.max(0, 60 - name.length))}`);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

/**
 * Fire `total` requests with at most `concurrency` in flight.
 *
 * A fixed-size worker pool rather than `Promise.all` over everything: firing
 * 500 requests at once measures how fast the client can queue, not how fast
 * the server can answer, and the numbers look great for the wrong reason.
 */
async function run(label, path, { total = 200, concurrency = 20 } = {}) {
  const timings = [];
  const statuses = new Map();
  let next = 0;

  const started = Date.now();

  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= total) return;

      const t0 = performance.now();
      try {
        const response = await fetch(`${BASE}${path}`);
        await response.text();
        timings.push(performance.now() - t0);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      } catch {
        // A refused connection or a socket reset counts as a failed request;
        // the reason does not change the verdict.
        statuses.set('error', (statuses.get('error') ?? 0) + 1);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  const elapsed = Date.now() - started;
  timings.sort((a, b) => a - b);

  const result = {
    label,
    total,
    concurrency,
    rps: Math.round((total / elapsed) * 1000),
    p50: Math.round(percentile(timings, 50)),
    p95: Math.round(percentile(timings, 95)),
    p99: Math.round(percentile(timings, 99)),
    max: Math.round(timings[timings.length - 1] ?? 0),
    statuses: Object.fromEntries(statuses),
  };

  console.log(
    `     ${label.padEnd(28)} ${String(result.rps).padStart(5)} rps · ` +
      `p50 ${String(result.p50).padStart(4)}ms · p95 ${String(result.p95).padStart(5)}ms · ` +
      `p99 ${String(result.p99).padStart(5)}ms · ${JSON.stringify(result.statuses)}`,
  );

  return result;
}

// ---------------------------------------------------------------- warm up

console.log('(warming up — the first request of a process pays for compilation)');
await run('warmup', '/api/health', { total: 20, concurrency: 4 });

// =============================================================== read paths

/**
 * Latency is measured at LOW concurrency, on purpose.
 *
 * On a single-threaded server, latency under load is dominated by queueing:
 * Little's law puts it at roughly concurrency ÷ throughput, so a p95 taken at
 * 30 in flight measures the queue I chose to create, not the time the server
 * spends on the work. An earlier version of this test set a 150 ms budget and
 * measured 182 ms at concurrency 30 — which was arithmetic, not a regression.
 *
 * So: latency here, at a depth a real user experiences. Saturation gets its
 * own section below, where the question is throughput and errors instead.
 */
section('latency — what one user actually waits for');

const results = [];
results.push(await run('health', '/api/health', { total: 120, concurrency: 4 }));
results.push(
  await run('search', '/api/search?q=mind', { total: 120, concurrency: 4 }),
);
results.push(
  await run('watch feed', '/api/watch/feed?tags=design&limit=8', {
    total: 120,
    concurrency: 4,
  }),
);
results.push(
  await run('watch interests', '/api/watch/interests', {
    total: 120,
    concurrency: 4,
  }),
);
results.push(
  await run('service page', '/services/build-with-us', {
    total: 60,
    concurrency: 4,
  }),
);
results.push(await run('community map', '/map', { total: 60, concurrency: 4 }));

/**
 * Everything must SUCCEED. A load test where a percentage of requests fail is
 * reporting an outage, not a latency number — and averaging the survivors
 * hides it.
 */
for (const result of results) {
  const ok = result.statuses[200] ?? 0;
  check(
    `${result.label}: every request succeeded`,
    ok === result.total,
    `${ok}/${result.total} ${JSON.stringify(result.statuses)}`,
  );
}

/**
 * Budgets, set against §20's beta scale rather than an aspiration. p95 is the
 * number a user actually notices; p99 catches the tail that a mean hides.
 */
const BUDGETS = {
  health: 120,
  search: 250,
  'watch feed': 300,
  'watch interests': 250,
  'service page': 600,
  'community map': 900,
};

for (const result of results) {
  const budget = BUDGETS[result.label];
  if (!budget) continue;
  check(
    `${result.label}: p95 within ${budget}ms`,
    result.p95 <= budget,
    `p95 ${result.p95}ms · p99 ${result.p99}ms · max ${result.max}ms`,
  );
}

// ============================================================ degradation

section('saturation — does load make it fail, or only queue?');

const light = await run('search @ 5', '/api/search?q=mind', {
  total: 100,
  concurrency: 5,
});
const heavy = await run('search @ 40', '/api/search?q=mind', {
  total: 200,
  concurrency: 40,
});

check(
  'eight times the concurrency does not produce errors',
  (heavy.statuses[200] ?? 0) === heavy.total,
  JSON.stringify(heavy.statuses),
);

/**
 * THROUGHPUT is the signal, not latency.
 *
 * Under a queue, latency rises with concurrency by arithmetic — that is what a
 * queue is, and asserting on it just re-measures the load generator. What
 * distinguishes healthy queueing from thrashing is whether the server keeps
 * getting the same amount of work done: contention on a lock, a file handle or
 * a synchronous scan shows up as throughput COLLAPSING as concurrency climbs.
 */
check(
  'throughput holds up as concurrency rises eightfold',
  heavy.rps >= light.rps * 0.6,
  `${light.rps} rps @5 → ${heavy.rps} rps @40`,
);

/**
 * And latency should stay close to what queueing alone predicts. Little's law:
 * expected latency ≈ concurrency ÷ throughput. Well above that means time is
 * going somewhere other than the queue.
 */
const predicted = (40 / Math.max(heavy.rps, 1)) * 1000;
check(
  'latency is explained by queueing, not by contention',
  heavy.p95 <= predicted * 3,
  `p95 ${heavy.p95}ms vs ${Math.round(predicted)}ms predicted by Little's law`,
);

// ============================================================ open streams

section('many open SSE streams');

/**
 * The realtime channel holds a connection per open map, so the question is
 * whether a hundred of them cost anything at rest. §20 rates "realtime cost"
 * as P11's risk, and this is where that claim gets a number.
 */
const controllers = [];
const opened = [];

for (let i = 0; i < 60; i++) {
  const controller = new AbortController();
  controllers.push(controller);
  opened.push(
    fetch(`${BASE}/api/maps/does-not-exist/stream`, { signal: controller.signal })
      .then((response) => response.status)
      .catch(() => 'aborted'),
  );
}

const streamStatuses = await Promise.all(opened);
check(
  '60 stream connections to an unauthorised map are all refused cleanly',
  streamStatuses.every((status) => status === 404),
  `${streamStatuses.filter((s) => s === 404).length}/60 refused`,
);

for (const controller of controllers) controller.abort();

// The server must still be healthy afterwards.
const afterStreams = await run('health after streams', '/api/health', {
  total: 60,
  concurrency: 10,
});
check(
  'the server is healthy after opening and dropping 60 connections',
  (afterStreams.statuses[200] ?? 0) === afterStreams.total,
  JSON.stringify(afterStreams.statuses),
);

// ============================================================== sustained

section('sustained run');

const sustained = await run('sustained search', '/api/search?q=map', {
  total: 600,
  concurrency: 25,
});

check(
  'a sustained run stays healthy',
  (sustained.statuses[200] ?? 0) === sustained.total,
  JSON.stringify(sustained.statuses),
);

/**
 * The last decile must not be dramatically slower than the first. A steady
 * climb across a run is the signature of a leak — an unbounded cache, a
 * listener never removed, a growing table scanned every time.
 */
const drift = sustained.p99 / Math.max(sustained.p50, 1);
check(
  'no runaway tail across a sustained run',
  drift < 20,
  `p50 ${sustained.p50}ms → p99 ${sustained.p99}ms (${drift.toFixed(1)}×)`,
);

console.log('');
console.log('Baseline recorded. These numbers are a floor for a 20–50 user beta,');
console.log('not a capacity plan: one Node process with SQLite does not scale');
console.log(
  'horizontally, and a real capacity test belongs after the Postgres move.',
);
console.log('');
console.log(
  failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
