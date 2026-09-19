import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Structural guard for the authorisation choke point.
 *
 * §20's High risk for this phase is "RLS mistakes leak data". `repo.ts`
 * mitigates it by making an AuthContext a mandatory first argument on every
 * query — but that guarantee evaporates the moment something reaches around
 * it and talks to the database directly.
 *
 * So this test does not check behaviour; it checks that the shape holds. A
 * route handler importing `getDb` would compile, pass every other test, and
 * quietly be able to read anyone's rows.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

/**
 * The only modules allowed to touch the raw handle.
 *
 * Every entry is an exception on the record. Adding one should be a decision
 * someone argues for in review, not a way to make this test go green.
 */
const ALLOWED = [
  'lib/db/client.ts',
  // The repositories ARE the choke point.
  'lib/db/repo.ts',
  'lib/db/sharing-repo.ts',
  // search/query.ts is a peer of the repositories, not a consumer: it applies
  // the visibility predicate in its own SQL because search joins across every
  // map at once and cannot be expressed as a call to getMap. It is held to
  // the same standard — see search.test.ts, which is mostly negative tests.
  'lib/search/query.ts',
  // Test files build their own in-memory databases.
  'lib/db/repo.test.ts',
  'lib/db/chokepoint.test.ts',
  'lib/search/search.test.ts',
  // Sessions are a lookup by opaque token with no owner to scope by — the
  // token IS the authorisation.
  'lib/auth/session.ts',
  // Interest rows are deduped by a unique index and are not owned data.
  'lib/interest/store.ts',
  // The outbox is a queue, not user-owned data: written by flows that have
  // already authorised, and read only by a drain job. There is no per-user
  // predicate that would even apply.
  'lib/email/outbox.ts',
  // Rate limits and the spend cap count ATTEMPTS, not content. The rows hold
  // no user data beyond a salted client hash, and the counters are deliberately
  // cross-user (a per-host limit protects sites we fetch from, and the monthly
  // cap is global). A visibility predicate would defeat the purpose.
  'lib/ingest/budget.ts',
  'lib/ingest/ingest.test.ts',
  // Page Watcher ranks across every community item at once, which cannot be
  // expressed as calls to getMap. Held to the same standard: an AuthContext
  // first argument, and visibility as a SQL predicate that joins back to
  // `maps` rather than trusting the denormalised index.
  'lib/watch/repo.ts',
  'lib/watch/watch.test.ts',
  // Collaboration reads and writes across chat, presence, locks and the event
  // log for a whole map at once. Same standard: an AuthContext first argument
  // and one `roleOn` function that every entry point calls before anything
  // else, so "may this person be here" is answered in exactly one place.
  'lib/collab/repo.ts',
  'lib/collab/collab.test.ts',
  // Enquiries are not user-owned content: they arrive from people with no
  // account at all, and the only reader is the business. There is no per-user
  // predicate that would apply, and the staff-only read is enforced at the
  // route.
  'lib/services/enquiries.ts',
  'lib/services/services.test.ts',
  // Moderation is the one place that deliberately reaches ACROSS ownership —
  // that is what moderation is. It is gated on ctx.isStaff in every function
  // and again at the route, and every action it takes is written to an
  // append-only audit trail.
  'lib/moderation/repo.ts',
  'lib/moderation/moderation.test.ts',
  // Analytics, errors and support hold no user-owned content: events are
  // pseudonymous counters, an error report is a stack trace, and a support
  // message arrives from people who may have no account. Every read is
  // staff-gated at the function and again at the route.
  'lib/analytics/store.ts',
  'lib/analytics/analytics.test.ts',
  'lib/launch/errors.ts',
  'lib/launch/support.ts',
  'lib/launch/beta.ts',
  'lib/launch/launch.test.ts',
  // Readiness opens the handle to probe it — "can we reach the database, and
  // is it migrated" — and reads no rows at all. Asking the repository whether
  // the repository works would answer a different question.
  'lib/launch/readiness.ts',
  // Newsletter subscribers are not user-owned content, for the same reason as
  // `lib/interest/store.ts`: rows arrive from people with no account, dedup is
  // a unique index rather than an ownership check, and the only per-row read
  // is by an unguessable unsubscribe token — the token IS the authorisation.
  'lib/marketing/newsletter.ts',
  'lib/marketing/marketing.test.ts',
  /*
   * The graph repository IS a repository — here for the same reason as
   * `repo.ts` and `sharing-repo.ts`, not as an exception to them. Every export
   * takes an AuthContext first, and edge creation checks BOTH ends: `editNodes`
   * on the source map and `view` on the target's, so a cross-map link cannot be
   * used to probe for node ids that exist.
   */
  'lib/graph/edges.ts',
  /*
   * Organisations and grants are REPOSITORIES, not consumers.
   *
   * Both answer questions ABOUT authorisation, so neither can route through a
   * repository that already requires the answer — capabilitiesOnMap exists to
   * compute what repo.ts would otherwise have to be told. Held to the same
   * standard as every other entry: an AuthContext first argument, and
   * permission checked in SQL against the owning map rather than trusted from
   * the caller. See permissions.test.ts, which is mostly negative tests — an
   * editor cannot mint grants, and a granted capability cannot be used to
   * bootstrap the authority to grant more.
   */
  'lib/orgs/repo.ts',
  'lib/permissions/resolve.ts',
  'lib/permissions/permissions.test.ts',
  /*
   * Comments are per-NODE, and every entry point calls canOnNode before it
   * touches a row — read, write and delete alike. It is here rather than in
   * repo.ts because repo.ts is map-scoped and this is not: the whole point is
   * that a denied node stays denied inside a map the caller can otherwise use.
   */
  'lib/comments/repo.ts',
  'lib/comments/comments.test.ts',
  /*
   * Rate limiting and password reset count ATTEMPTS and mint single-use
   * tokens. Neither reads user-owned content: the rate table holds a salted
   * hash and nothing else, and a reset is authorised by the token itself —
   * the token IS the authorisation, exactly as it is for sessions and share
   * links. There is no per-user predicate that would even apply.
   */
  'lib/auth/rate-limit.ts',
  'lib/auth/reset.ts',
  'lib/auth/auth.test.ts',
  /*
   * The AI gateway writes the audit row for every call, and the embedding
   * store writes vectors keyed by subject. Neither reads user-owned CONTENT:
   * the gateway records who asked and what it cost, and the assistant — which
   * does touch nodes — goes through canOnNode on every proposal, accept and
   * reject. The gateway is here for the same reason as the outbox: it is a
   * ledger written by flows that have already authorised.
   */
  'lib/ai/gateway.ts',
  'lib/ai/embeddings.ts',
  'lib/ai/assistant.ts',
  'lib/ai/ai.test.ts',
  /*
   * The agent layer. safety.ts and runtime.ts are the enforcement itself, so
   * they cannot route through something that already assumes an answer; and
   * tools.ts is the one file that must check permission per resource, which it
   * does with canOnNode on every read and write. agents.test.ts is mostly
   * negative tests for exactly that reason.
   */
  'lib/agents/safety.ts',
  'lib/agents/tools.ts',
  'lib/agents/runtime.ts',
  'lib/agents/workflows.ts',
  'lib/agents/agents.test.ts',
  /*
   * The agent repository, alongside the rest of lib/agents. It reads
   * capabilitiesOnMap before every write and canOnNode before every read, so
   * it is held to the same standard as the other repositories here rather
   * than being an exception to them.
   */
  'lib/agents/repo.ts',
  /*
   * Billing. The credit ledger and subscription tables are not user-owned
   * CONTENT: a ledger row is a financial record keyed by user id, and every
   * read here is already scoped to one. Routing them through repo.ts would
   * mean the repository knowing about money, which is the coupling this split
   * exists to avoid.
   */
  'lib/billing/credits.ts',
  'lib/billing/subscriptions.ts',
  'lib/billing/billing.test.ts',
  /*
   * Plan administration sits beside the rest of billing. A plan is business
   * configuration rather than anyone's content — there is no owner to scope a
   * read by — and every export refuses outright unless ctx.isStaff, checked
   * again at the route. It is here rather than in repo.ts for the same reason
   * as the ledger: the repository has no business knowing about prices.
   */
  'lib/billing/plans-admin.ts',
  'lib/billing/plans-admin.test.ts',
  /*
   * The services pipeline reads and writes the SAME `enquiries` rows as
   * `lib/services/enquiries.ts`, which is already allow-listed above and for
   * the same reason: enquiries arrive from people with no account, so there is
   * no per-user predicate that would apply, and the only reader is the
   * business. Every export here begins with ctx.isStaff and the routes check
   * it again.
   */
  'lib/services/pipeline.ts',
  'lib/services/pipeline.test.ts',
  'lib/graph/graph.test.ts',
  /*
   * The job queue and the event log hold no user-owned content. A job is a
   * type, a JSON payload and a retry count; an event is an append-only record
   * of something that already happened. Neither has an owner to scope by, and
   * both are written by flows that have ALREADY authorised the action being
   * recorded. Reads are staff-only at `/api/jobs/drain`.
   *
   * The rule that keeps this honest: a job payload carries IDS, never borrowed
   * authority. A handler that must act as a user re-derives that user's context
   * from the id; it never inherits the enqueuer's permissions.
   */
  'lib/jobs/queue.ts',
  'lib/jobs/worker.ts',
  'lib/jobs/events.ts',
  'lib/jobs/jobs.test.ts',
  /*
   * The outbox drain is the queue's first consumer, under the same reasoning as
   * `lib/email/outbox.ts` above: a delivery queue rather than user-owned data,
   * written by flows that have already authorised and read only by this drain.
   */
  'lib/email/drain.ts',
  'lib/email/email.test.ts',
  /*
   * PHASE 7 - THE ECOSYSTEM LAYER.
   *
   * Every entry below is here for one of two reasons, and neither is an
   * exception to the choke point.
   *
   * `api/keys.ts` and `api/gateway.ts` ARE authentication. They resolve a
   * presented credential into the AuthContext that `repo.ts` then requires, so
   * they cannot route through something that already has the answer. The
   * property that keeps this honest is asserted in api.test.ts: an
   * authenticated key produces `isStaff: false` for every owner, and every
   * resource it can reach goes through the ordinary repositories with that
   * context. A scope narrows what the owner may do; it never widens it.
   *
   * `api/resources.ts` is the published SHAPE of the API. It reads nothing
   * itself — every query is a call to `repo.ts` with a caller-supplied
   * context — and exists so that no route serialises a row and turns a column
   * name into somebody's integration.
   */
  'lib/api/keys.ts',
  'lib/api/gateway.ts',
  'lib/api/resources.ts',
  'lib/api/api.test.ts',
  /*
   * Webhooks hold no user-owned CONTENT: an endpoint is a URL and a secret,
   * and a delivery is a status code and a timestamp. Both are scoped to their
   * owner in the WHERE clause of every statement. The delivery job is written
   * by the queue and read by nothing else — the same reasoning as the outbox
   * and the job tables above.
   */
  'lib/webhooks/endpoints.ts',
  'lib/webhooks/delivery.ts',
  'lib/webhooks/fanout.ts',
  'lib/webhooks/webhooks.test.ts',
  /*
   * The plugin repository is a repository. A plugin and an installation are
   * not content inside a map, so `repo.ts` is map-scoped in a way that does
   * not apply — but the standard is the same: an AuthContext first argument,
   * ownership in the WHERE clause, and staff-only review. plugins.test.ts is
   * mostly negative tests, because a plugin's authority is the highest-value
   * thing in this phase to get wrong.
   */
  'lib/plugins/repo.ts',
  'lib/plugins/plugins.test.ts',
  /*
   * The marketplace repository and its four catalogue adapters. Listings are
   * public by design once published, and everything that is NOT public — a
   * draft, an order, the review queue — is scoped to the caller or to staff.
   * The adapters reach into `maps`, `agents`, `plugins` and `enquiries`
   * because a catalogue's whole job is to know what its target is; each one
   * checks ownership before it touches anything, at publish and again at
   * delivery.
   */
  'lib/marketplace/repo.ts',
  'lib/marketplace/catalogues.ts',
  'lib/marketplace/marketplace.test.ts',
  /*
   * PHASE 8 - ENTERPRISE.
   *
   * `auth/mfa.ts` and `auth/secrets.ts` are AUTHENTICATION, like sessions and
   * password reset above them. They hold no user-owned content: a TOTP secret
   * and a set of recovery-code hashes, both keyed by one user id and read only
   * while authenticating that user. They cannot route through a repository
   * that already assumes an authenticated caller, because they are what
   * produces one.
   */
  'lib/auth/mfa.ts',
  'lib/auth/mfa.test.ts',
  /*
   * SSO is authentication too, and additionally OWNS the accounts it
   * provisions — it is the only thing in the codebase that creates a user
   * without a password. Every configuration function takes an AuthContext and
   * an org role and refuses without them; the sign-in path is gated by the
   * state row, PKCE and full ID-token verification rather than by a caller's
   * context, because at that point there is no caller yet.
   */
  'lib/enterprise/sso.ts',
  /*
   * The audit log is APPEND-ONLY and is not user-owned content: a row is a
   * record ABOUT people rather than data belonging to one. Reads are gated on
   * an org admin role or staff, and `querySelf` is scoped to the caller in the
   * WHERE clause. It is here rather than in repo.ts for the same reason as the
   * job tables: it is written by flows that have already authorised whatever
   * they are recording.
   */
  'lib/enterprise/audit.ts',
  /*
   * Org settings and branding are per-ORGANISATION configuration, not content
   * inside a map — so repo.ts's map-scoped predicate does not apply. Held to
   * the same standard: an AuthContext and an org role on every write, and
   * `brandingForHost` reads only rows whose domain has been PROVED by DNS.
   */
  'lib/enterprise/branding.ts',
  'lib/enterprise/enterprise.test.ts',
  /*
   * The sync repository is a repository. `push` checks editNodes and `pull`
   * checks view through capabilitiesOnMap before touching a row, and the
   * operation log is per-map with no cross-map query. Its one honest
   * limitation — per-NODE grants are not enforced on a pushed operation,
   * because the device does not hold the grant set — is argued in ADR-0011
   * rather than left to be discovered.
   */
  'lib/sync/repo.ts',
  'lib/sync/sync.test.ts',
  /*
   * The LifeMap repository is the STRICTEST module in this list, not an
   * exception to it.
   *
   * It is here because a LifeMap is not a map: it is imported personal archive
   * data with its own tables, so there is no getMap call these queries could
   * be expressed as. What replaces it is tighter than repo.ts, not looser --
   * every query filters on user_id in its own WHERE clause, and that column is
   * denormalised onto every table so the filter never depends on a join
   * somebody might forget.
   *
   * There is deliberately no ctx.isStaff branch anywhere in the file, and that
   * is the point. Moderation reaches across ownership everywhere else in this
   * codebase; it does not reach here, because a LifeMap is somebody's private
   * messages and photographs imported for their own use. See lifemap.test.ts,
   * which is largely negative tests proving staff get nothing.
   */
  'lib/lifemap/repo.ts',
  'lib/lifemap/lifemap.test.ts',
  /*
   * Collections read map_nodes across EVERY map at once, filtered by node
   * type, which cannot be expressed as calls to getMap -- the same reason
   * search/query.ts is here, and it is held to the same standard: an
   * AuthContext first argument and visibility as a SQL predicate joined back
   * to `maps`.
   *
   * Its predicate is deliberately TIGHTER than repo.ts's, not a copy of it.
   * `visible` admits public maps and has a staff bypass, which is correct for
   * "may I read this map" and wrong for a personal working list: a stranger's
   * public map is not my work, and a staff bypass would fill an operator's
   * own task list with other people's. See collections.test.ts, which is
   * mostly negative tests for exactly those two cases.
   */
  'lib/nodes/collections.ts',
  'lib/nodes/collections.test.ts',
];

/**
 * Matches BOTH the alias and relative forms.
 *
 * The first version of this test only checked `@/lib/db/client`, and
 * `sharing-repo.ts` importing `'./client'` walked straight past it. A guard
 * that only catches one spelling of the thing it guards against is worse than
 * no guard, because it is trusted.
 */
const DB_IMPORT =
  /from\s+['"](?:@\/lib\/db\/client|\.{1,2}(?:\/[\w.-]+)*\/client|\.\/client)['"]/;

describe('database access is funnelled through the repository', () => {
  const files = walk(SRC).map((file) => ({
    path: relative(SRC, file).replace(/\\/g, '/'),
    source: readFileSync(file, 'utf8'),
  }));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('lets nothing outside the allow-list import the raw handle', () => {
    const offenders = files
      .filter((file) => !ALLOWED.includes(file.path))
      .filter((file) => DB_IMPORT.test(file.source))
      .map((file) => file.path);

    expect(
      offenders,
      `These import the database handle directly and can bypass authorisation:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps route handlers off the database entirely', () => {
    // Belt and braces: even an allow-listed module would be wrong inside
    // app/, because that is where request handling lives.
    const offenders = files
      .filter((file) => file.path.startsWith('app/'))
      .filter(
        (file) => /better-sqlite3/.test(file.source) || DB_IMPORT.test(file.source),
      )
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('never ships the database into a client component', () => {
    // A `'use client'` file importing the repo would try to bundle
    // better-sqlite3 for the browser. `server-only` already throws at build
    // time; this names the file instead of failing with a stack trace.
    const offenders = files
      .filter((file) => /^['"]use client['"]/m.test(file.source.trimStart()))
      .filter((file) => /@\/lib\/db\//.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});

describe('repository call sites always pass a context', () => {
  const files = walk(SRC).map((file) => ({
    path: relative(SRC, file).replace(/\\/g, '/'),
    source: readFileSync(file, 'utf8'),
  }));

  it('never calls a map query with no arguments', () => {
    // `getMap()` or `listOwnedMaps()` with an empty argument list would be a
    // context-free query. TypeScript catches it, but this fails with a message
    // that says why it matters.
    const offenders = files
      .filter((file) => !file.path.startsWith('lib/db/'))
      .filter((file) =>
        /(getMap|listOwnedMaps|listSharedMaps|saveMap|deleteMap|countMapsOwned)\(\s*\)/.test(
          file.source,
        ),
      )
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});
