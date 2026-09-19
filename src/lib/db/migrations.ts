import 'server-only';

/**
 * Schema migrations.
 *
 * Forward-only, numbered, applied in order, recorded in `_migrations` so each
 * runs exactly once. `docs/04-environments.md` sets the rule: additive first —
 * add a column, backfill, switch reads, drop the old one in a LATER release.
 * A migration that drops a column in the same deploy that stops writing it
 * cannot be rolled back.
 *
 * Kept as TypeScript rather than loose .sql files so they are bundled with the
 * app. A migration that fails to ship because the deploy did not copy a
 * directory is a bad way to find out.
 */

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
      -- ---------------------------------------------------------------- users
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        -- Lower-cased at write time. Two accounts differing only by case are
        -- the same person as far as anyone signing in is concerned.
        email_lower   TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        handle        TEXT NOT NULL UNIQUE,
        display_name  TEXT NOT NULL,
        bio           TEXT,
        avatar_url    TEXT,
        is_staff      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );

      -- ------------------------------------------------------------- sessions
      CREATE TABLE sessions (
        -- The random token itself. Stored hashed; see auth/session.ts.
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE INDEX sessions_expiry ON sessions(expires_at);

      -- ----------------------------------------------------------------- maps
      CREATE TABLE maps (
        id         TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        family     TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        root_id    TEXT NOT NULL,
        -- Optimistic concurrency. Bumped on every accepted write.
        version    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX maps_owner ON maps(owner_id, updated_at DESC);
      CREATE UNIQUE INDEX maps_owner_title ON maps(owner_id, LOWER(title));

      -- ------------------------------------------------------------ map_nodes
      CREATE TABLE map_nodes (
        id          TEXT PRIMARY KEY,
        map_id      TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        parent_id   TEXT,
        slot        INTEGER NOT NULL DEFAULT 0,
        title       TEXT NOT NULL DEFAULT '',
        description TEXT,
        family      TEXT NOT NULL,
        type        TEXT NOT NULL,
        status      TEXT NOT NULL,
        visibility  TEXT NOT NULL,
        icon        TEXT,
        href        TEXT,
        payload     TEXT,
        weight      REAL NOT NULL DEFAULT 0.5,
        free_x      REAL,
        free_y      REAL
      );
      CREATE INDEX map_nodes_map ON map_nodes(map_id);
      CREATE INDEX map_nodes_parent ON map_nodes(map_id, parent_id);

      -- ---------------------------------------------------------- map_members
      -- P7 owns the roles UI; the table exists now because My Maps has a
      -- "Shared with me" tab and a tab that can never have content is worse
      -- than no tab.
      CREATE TABLE map_members (
        map_id    TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role      TEXT NOT NULL,
        added_at  TEXT NOT NULL,
        PRIMARY KEY (map_id, user_id)
      );
      CREATE INDEX map_members_user ON map_members(user_id);

      -- --------------------------------------------------------------- assets
      CREATE TABLE assets (
        id         TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        map_id     TEXT REFERENCES maps(id) ON DELETE CASCADE,
        mime       TEXT NOT NULL,
        bytes      INTEGER NOT NULL,
        path       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX assets_owner ON assets(owner_id);

      -- ------------------------------------------------------- node_interest
      -- Moved out of memory (P4 shipped it in-process and said so). §24
      -- measures interest per dark node in month one; an in-memory counter
      -- cannot answer that.
      CREATE TABLE node_interest (
        id           TEXT PRIMARY KEY,
        node_id      TEXT NOT NULL,
        user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
        visitor_hash TEXT,
        email        TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX node_interest_node ON node_interest(node_id);
      -- One registration per person per node. COALESCE because SQLite treats
      -- NULLs as distinct in unique indexes, which would let one signed-out
      -- visitor register unlimited times.
      CREATE UNIQUE INDEX node_interest_dedupe
        ON node_interest(node_id, COALESCE(user_id, visitor_hash, 'anon'));
    `,
  },
  {
    id: 2,
    name: 'sharing',
    sql: `
      -- §15: "Node-viewable: off — viewers see structure, titles and shape,
      -- taps do not open detail." Defaults ON, because a map you deliberately
      -- shared is usually meant to be read; the restrictive mode is the
      -- deliberate choice.
      ALTER TABLE maps ADD COLUMN node_viewable INTEGER NOT NULL DEFAULT 1;

      -- ---------------------------------------------------------- share links
      CREATE TABLE share_tokens (
        -- Stored HASHED, like a session. A leaked database dump must not be a
        -- set of working share links.
        id         TEXT PRIMARY KEY,
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        -- Revoked rather than deleted, so "this link was turned off" stays
        -- distinguishable from "this link never existed".
        revoked_at TEXT
      );
      CREATE INDEX share_tokens_map ON share_tokens(map_id);

      -- -------------------------------------------------------------- invites
      CREATE TABLE map_invites (
        id          TEXT PRIMARY KEY,
        map_id      TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        email_lower TEXT NOT NULL,
        role        TEXT NOT NULL,
        token       TEXT NOT NULL UNIQUE,
        invited_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        accepted_at TEXT,
        accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX map_invites_map ON map_invites(map_id);
      CREATE INDEX map_invites_email ON map_invites(email_lower);
      -- One outstanding invite per person per map. Re-inviting replaces it
      -- rather than stacking duplicates in the list.
      CREATE UNIQUE INDEX map_invites_pending
        ON map_invites(map_id, email_lower) WHERE accepted_at IS NULL;

      -- --------------------------------------------------------------- outbox
      -- Email has no provider yet (see docs/12-sharing.md). Queueing rather
      -- than dropping means invites already sent can be delivered once one is
      -- configured, instead of being silently lost.
      CREATE TABLE outbox (
        id         TEXT PRIMARY KEY,
        to_email   TEXT NOT NULL,
        subject    TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sent_at    TEXT
      );
      CREATE INDEX outbox_unsent ON outbox(sent_at);
    `,
  },
  {
    id: 3,
    name: 'search',
    sql: `
      -- Full-text index over node titles and descriptions.
      --
      -- FTS5 rather than LIKE: LIKE '%term%' cannot use an index, so it is a
      -- table scan per keystroke, and §20 budgets suggestions at 300ms.
      -- 'porter' stems, so "mapping" finds "map"; unicode61 handles accents.
      --
      -- NOTE the columns that are NOT indexed. The index holds ids so a hit
      -- can be joined back to the real row, where the permission predicate is
      -- applied. Nothing is authorised from the index itself.
      CREATE VIRTUAL TABLE node_search USING fts5(
        node_id UNINDEXED,
        map_id  UNINDEXED,
        title,
        description,
        tokenize = 'porter unicode61'
      );

      CREATE VIRTUAL TABLE map_search USING fts5(
        map_id UNINDEXED,
        title,
        tokenize = 'porter unicode61'
      );

      -- Triggers keep the index in step with the tables. Rebuilding on write
      -- from application code would leave the index stale on any path that
      -- forgot to call it — and P5 replaces the whole node set on every save.
      CREATE TRIGGER node_search_insert AFTER INSERT ON map_nodes BEGIN
        INSERT INTO node_search (node_id, map_id, title, description)
        VALUES (new.id, new.map_id, new.title, COALESCE(new.description, ''));
      END;

      CREATE TRIGGER node_search_delete AFTER DELETE ON map_nodes BEGIN
        DELETE FROM node_search WHERE node_id = old.id;
      END;

      CREATE TRIGGER node_search_update AFTER UPDATE ON map_nodes BEGIN
        DELETE FROM node_search WHERE node_id = old.id;
        INSERT INTO node_search (node_id, map_id, title, description)
        VALUES (new.id, new.map_id, new.title, COALESCE(new.description, ''));
      END;

      CREATE TRIGGER map_search_insert AFTER INSERT ON maps BEGIN
        INSERT INTO map_search (map_id, title) VALUES (new.id, new.title);
      END;

      CREATE TRIGGER map_search_delete AFTER DELETE ON maps BEGIN
        DELETE FROM map_search WHERE map_id = old.id;
      END;

      CREATE TRIGGER map_search_update AFTER UPDATE ON maps BEGIN
        DELETE FROM map_search WHERE map_id = old.id;
        INSERT INTO map_search (map_id, title) VALUES (new.id, new.title);
      END;

      -- Backfill anything already stored.
      INSERT INTO node_search (node_id, map_id, title, description)
        SELECT id, map_id, title, COALESCE(description, '') FROM map_nodes;
      INSERT INTO map_search (map_id, title) SELECT id, title FROM maps;
    `,
  },
  {
    id: 4,
    name: 'ingest',
    sql: `
      -- Every Link-to-Mind-Map attempt, successful or not.
      --
      -- This table is the rate limiter AND the spend cap AND the abuse audit
      -- trail, deliberately in one place: three counters kept separately drift,
      -- and the question "who has been hammering the fetcher" needs the failed
      -- attempts most of all. Failures are rows too.
      CREATE TABLE ingest_runs (
        id            TEXT PRIMARY KEY,
        -- NULL for a signed-out run. §12 grants those one free run.
        user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
        -- Hashed, never raw. An IP is personal data and this table is an
        -- audit log, not a tracking log.
        client_hash   TEXT NOT NULL,
        url           TEXT NOT NULL,
        host          TEXT NOT NULL,
        -- 'ok' or one of the failure codes, so a spike in 'blocked-address'
        -- is visible as a scan attempt.
        outcome       TEXT NOT NULL,
        source        TEXT,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd      REAL    NOT NULL DEFAULT 0,
        map_id        TEXT REFERENCES maps(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- The rate-limit lookups: by user over a window, by client over a
      -- window, and the month's spend. All three are covered.
      CREATE INDEX ingest_runs_user_time   ON ingest_runs(user_id, created_at);
      CREATE INDEX ingest_runs_client_time ON ingest_runs(client_hash, created_at);
      CREATE INDEX ingest_runs_time        ON ingest_runs(created_at);
      CREATE INDEX ingest_runs_host_time   ON ingest_runs(host, created_at);

      -- Source attribution, per §12 step 8: "every node carries a source-link
      -- chip back to the origin URL". On the map, not the node, because every
      -- node in a generated map shares one source and repeating the URL on
      -- each row is the same string a hundred times.
      ALTER TABLE maps ADD COLUMN source_url TEXT;
      ALTER TABLE maps ADD COLUMN source_title TEXT;
    `,
  },
  {
    id: 5,
    name: 'page_watcher',
    sql: `
      -- Community content (§13).
      --
      -- The ASSUMPTION in §13 is load-bearing: Page Watcher browses CDN
      -- community content, NOT the open web. So a row here is something that
      -- already exists inside the system — a public map, a service node, a
      -- published project — and this table is a denormalised index over those,
      -- not a second content store.
      --
      -- Denormalised on purpose. The feed reads title, excerpt and family for
      -- every card; joining back to three different source tables per card, in
      -- rank order, with permissions, is a lot of query for a scroll.
      CREATE TABLE content_items (
        id           TEXT PRIMARY KEY,
        -- Which kind of thing this points at, and where.
        kind         TEXT NOT NULL CHECK (kind IN ('map', 'service', 'project', 'page')),
        href         TEXT NOT NULL,
        title        TEXT NOT NULL,
        excerpt      TEXT NOT NULL DEFAULT '',
        source       TEXT NOT NULL DEFAULT '',
        family       TEXT NOT NULL,
        thumbnail    TEXT,
        -- Set when the item IS a map in this system, so 'Add to map' can copy
        -- a real node rather than a link, and so an unpublished map can be
        -- dropped from the feed by a join rather than a background sweep.
        map_id       TEXT REFERENCES maps(id) ON DELETE CASCADE,
        -- Seeded rows have no owner. §13 says to seed 60-100 pages before
        -- launch; those are ours, and must not look like a user's map.
        owner_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
        published_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Tags are the join between an interest and an item. A separate table
      -- rather than a comma string, because the feed query filters by tag and
      -- the picker counts by tag — both of which want an index.
      CREATE TABLE content_tags (
        item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
        tag     TEXT NOT NULL,
        PRIMARY KEY (item_id, tag)
      );
      CREATE INDEX content_tags_tag ON content_tags(tag);

      -- The interest vocabulary. Fixed rather than free text: §13's picker
      -- shows "a grid of chips, family-tinted, each with a live content
      -- count", which needs a known set with known families.
      CREATE TABLE interest_tags (
        tag         TEXT PRIMARY KEY,
        label       TEXT NOT NULL,
        family      TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0
      );

      -- §13: "Selections persist to the profile and are editable later."
      CREATE TABLE user_interests (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tag        TEXT NOT NULL REFERENCES interest_tags(tag) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, tag)
      );

      -- §13 step 4: the Save action.
      CREATE TABLE saved_items (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id    TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, item_id)
      );

      -- The feed's sort: newest first within a tag match.
      CREATE INDEX content_items_published ON content_items(published_at DESC);
      CREATE INDEX content_items_map       ON content_items(map_id);
    `,
  },
  {
    id: 6,
    name: 'collaboration',
    sql: `
      -- One event log per map, and everything realtime reads from it.
      --
      -- §20 rates this phase's risk as "realtime cost and reconnection", and
      -- the acceptance criterion is "without DATA LOSS". Both come down to one
      -- decision: the socket is a NOTIFICATION, never the source of truth.
      -- Every message, every edit and every join is a durable row with a
      -- monotonic id, so a client that reconnects asks "what happened after
      -- 412?" and gets it. A design that pushes down a channel and stores
      -- nothing loses whatever was in flight when the connection dropped, and
      -- nobody finds out until someone asks why a message vanished.
      CREATE TABLE map_events (
        -- INTEGER PRIMARY KEY is the rowid: monotonic, gap-free per insert,
        -- and exactly what an SSE cursor needs.
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
        -- 'message' | 'node_changed' | 'member_joined' | 'presence' | ...
        kind       TEXT NOT NULL,
        -- JSON payload. Shape depends on kind and is validated at the edge.
        payload    TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX map_events_map ON map_events(map_id, id);

      -- §15: "Map chat is one thread per map."
      CREATE TABLE map_messages (
        id         TEXT PRIMARY KEY,
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        -- §15: "Typing # mentions a node and posts a chip that recentres the
        -- map when tapped — this is what makes it map chat rather than a chat
        -- box." Stored as a real reference so the chip survives a rename.
        node_ref   TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX map_messages_map ON map_messages(map_id, created_at);

      -- §14: "Activity: who changed what, when. Append-only log. Cheap to
      -- build, disproportionately trust-building."
      CREATE TABLE map_activity (
        id          TEXT PRIMARY KEY,
        map_id      TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
        action      TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'map',
        target_id   TEXT,
        detail      TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX map_activity_map ON map_activity(map_id, created_at DESC);

      -- Notification fan-out. One row per recipient, written when the event
      -- happens rather than computed on read: a feed derived by querying every
      -- map you belong to gets slower as you join more of them, which is
      -- backwards.
      CREATE TABLE notifications (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        map_id     TEXT REFERENCES maps(id) ON DELETE CASCADE,
        actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
        kind       TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        href       TEXT NOT NULL DEFAULT '',
        read_at    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
      CREATE INDEX notifications_unread ON notifications(user_id, read_at);

      -- §15's soft lock: "a node being edited by someone else shows their
      -- avatar and a subtle pulse, and your edit is refused with 'Sam is
      -- editing this.'"
      --
      -- expires_at is the whole design. The acceptance criterion says "without
      -- LOCKOUT", and a lock held by a browser that closed its laptop lid is
      -- exactly how a map becomes permanently uneditable. A lock is a lease.
      CREATE TABLE node_locks (
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        node_id    TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (map_id, node_id)
      );

      -- §15: "Presence: avatar stack in the top bar; a coloured ring on nodes
      -- another person has selected. No live cursors in MVP."
      --
      -- Heartbeat rows with a TTL rather than a connection count. Counting
      -- open sockets means a crashed tab stays "present" until a timeout you
      -- then have to invent anyway.
      CREATE TABLE map_presence (
        map_id      TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        selected_id TEXT,
        last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (map_id, user_id)
      );
    `,
  },
  {
    id: 7,
    name: 'enquiries',
    sql: `
      -- §20 P12: "Enquiry submitted end-to-end and reaches an inbox."
      --
      -- The row is written BEFORE the email is queued, and it is the record of
      -- record. Mail delivery is best-effort and always has been; an enquiry
      -- that exists only as a queued email is an enquiry you lose the first
      -- time a provider bounces it, and the person who sent it will never know.
      CREATE TABLE enquiries (
        id           TEXT PRIMARY KEY,
        service_slug TEXT NOT NULL,
        name         TEXT NOT NULL,
        email        TEXT NOT NULL,
        company      TEXT NOT NULL DEFAULT '',
        budget       TEXT NOT NULL DEFAULT '',
        message      TEXT NOT NULL,
        -- Set when the sender happened to be signed in. Not required: the
        -- whole point of this form is to hear from people who have no account.
        user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
        -- Salted hash, never a raw IP. Used for the rate limit only.
        client_hash  TEXT NOT NULL DEFAULT '',
        -- 'new' | 'spam' | 'read' | 'archived'. Spam is FILED, not discarded:
        -- a false positive is a lost customer, and the only way to find out is
        -- to be able to look.
        status       TEXT NOT NULL DEFAULT 'new',
        spam_reason  TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX enquiries_service ON enquiries(service_slug, created_at DESC);
      CREATE INDEX enquiries_client  ON enquiries(client_hash, created_at);
      CREATE INDEX enquiries_status  ON enquiries(status, created_at DESC);
    `,
  },
  {
    id: 8,
    name: 'moderation',
    sql: `
      -- §15: "Report lives in the overflow of every node, map, message and
      -- profile. One flow, one component, everywhere."
      --
      -- One table for all four target types rather than four tables, because
      -- the queue reviews them together and a moderator does not care which
      -- kind of thing they are looking at until they open it.
      CREATE TABLE reports (
        id          TEXT PRIMARY KEY,
        target_type TEXT NOT NULL CHECK (target_type IN ('node', 'map', 'message', 'user')),
        target_id   TEXT NOT NULL,
        -- Null for a signed-out reporter. Reporting must not require an
        -- account: the people most in need of it are often not members.
        reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        reason      TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT '',
        -- 'open' | 'dismissed' | 'actioned'
        status      TEXT NOT NULL DEFAULT 'open',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX reports_status ON reports(status, created_at DESC);
      CREATE INDEX reports_target ON reports(target_type, target_id);

      -- §15: "Every action written to an audit trail."
      --
      -- Append-only, and deliberately NOT cascade-deleted with the report or
      -- the target: the record of what a moderator did must outlive the thing
      -- they did it to, or the audit trail evaporates exactly when it is
      -- needed. That is why target_id is a plain TEXT column with no foreign
      -- key.
      CREATE TABLE moderation_actions (
        id          TEXT PRIMARY KEY,
        report_id   TEXT,
        moderator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action      TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        note        TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX moderation_actions_time ON moderation_actions(created_at DESC);

      -- §15's "suspend" action needs somewhere to record the suspension.
      ALTER TABLE users ADD COLUMN suspended_at TEXT;
    `,
  },
  {
    id: 9,
    name: 'launch',
    sql: `
      -- §20 P14's High risk is "launching without instrumentation", and this
      -- table is the answer to it.
      --
      -- FIRST-PARTY, not a vendor. ADR-0006 commits us to a strong privacy
      -- position; docs/03-analytics-plan.md then lists "self-hostable or
      -- EU-hosted" as the first criterion for choosing a provider. The
      -- cheapest way to satisfy a privacy promise is to not send the data
      -- anywhere. See ADR-0009.
      --
      -- The property rule from §03 is enforced by the SHAPE of this table as
      -- well as by review: the props column holds ids, enums, counts and
      -- durations, and nothing here is ever joined to a name.
      CREATE TABLE analytics_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        props      TEXT NOT NULL DEFAULT '{}',
        -- A rotating pseudonymous id, not a user id. Enough to count people
        -- without being able to point at one.
        anon_id    TEXT NOT NULL,
        -- Set only when signed in, so activation can be measured per account.
        user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX analytics_events_name ON analytics_events(name, created_at);
      CREATE INDEX analytics_events_session ON analytics_events(session_id, created_at);
      CREATE INDEX analytics_events_anon ON analytics_events(anon_id, created_at);

      -- Error tracking (§20 P14).
      --
      -- Grouped by fingerprint rather than stored one row per occurrence: the
      -- useful question at beta scale is "what is broken and how often", and a
      -- thousand rows of the same stack answers it worse than one row with a
      -- count of a thousand.
      CREATE TABLE error_reports (
        fingerprint TEXT PRIMARY KEY,
        message     TEXT NOT NULL,
        stack       TEXT NOT NULL DEFAULT '',
        source      TEXT NOT NULL DEFAULT 'client',
        route       TEXT NOT NULL DEFAULT '',
        count       INTEGER NOT NULL DEFAULT 1,
        first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );
      CREATE INDEX error_reports_last ON error_reports(last_seen DESC);

      -- §20 P14: "support inbox".
      --
      -- Separate from the enquiries table on purpose. An enquiry is a sales
      -- lead and a support message is someone stuck; merging them means the
      -- queue answered in an hour is mixed with the one answered in two
      -- days, and both get the worse of the two.
      CREATE TABLE support_messages (
        id          TEXT PRIMARY KEY,
        user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
        email       TEXT NOT NULL,
        topic       TEXT NOT NULL DEFAULT 'other',
        message     TEXT NOT NULL,
        -- What the user was looking at. The single most useful field in a
        -- support queue, and the one users never think to include.
        route       TEXT NOT NULL DEFAULT '',
        user_agent  TEXT NOT NULL DEFAULT '',
        client_hash TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'open',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX support_messages_status ON support_messages(status, created_at DESC);

      -- §20 P14: "closed beta 20–50 users".
      --
      -- A capped allowlist rather than an open sign-up. The cap is enforced in
      -- SQL-visible state rather than by intention, because "we'll keep an eye
      -- on it" is how a closed beta becomes an open one.
      CREATE TABLE beta_invites (
        code       TEXT PRIMARY KEY,
        note       TEXT NOT NULL DEFAULT '',
        used_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        used_at    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Onboarding state, so coach marks are shown once and never again.
      ALTER TABLE users ADD COLUMN onboarded_at TEXT;
    `,
  },
  {
    id: 10,
    name: 'marketing_forms',
    sql: `
      -- Newsletter subscribers (roadmap §18.2).
      CREATE TABLE newsletter_subscribers (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        -- Lower-cased at write time and UNIQUE. Two addresses differing only
        -- by case are one person, and the duplicate path depends on this
        -- index rather than on a prior SELECT that two requests can both pass.
        email_lower   TEXT NOT NULL UNIQUE,
        -- Which surface captured them, so the funnel can be attributed.
        source        TEXT NOT NULL DEFAULT 'landing',
        consent_at    TEXT NOT NULL DEFAULT (datetime('now')),
        client_hash   TEXT NOT NULL DEFAULT '',
        -- Double opt-in is OPEN DECISION OD-4 and depends on the eventual
        -- provider and audience. The column exists now so enabling it later is
        -- a code change and not a migration on a live table.
        confirm_token TEXT,
        confirmed_at  TEXT,
        -- Every marketing email must carry a working unsubscribe link from the
        -- first send, so the token is minted at subscribe time.
        unsub_token   TEXT NOT NULL,
        unsubscribed_at TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX newsletter_active ON newsletter_subscribers(unsubscribed_at);
      CREATE INDEX newsletter_client ON newsletter_subscribers(client_hash, created_at);

      -- The service-request fields the marketing form adds (§9.2).
      --
      -- ADDITIVE, per docs/04-environments.md: new nullable columns on the
      -- existing P12 table rather than a second enquiries table. The pipeline
      -- underneath — spam scoring, rate limits, storage-before-email — is
      -- reused unchanged, because it is tested and re-implementing it is the
      -- likeliest way to introduce a data-loss bug.
      ALTER TABLE enquiries ADD COLUMN phone TEXT NOT NULL DEFAULT '';
      ALTER TABLE enquiries ADD COLUMN project_type TEXT NOT NULL DEFAULT '';
      ALTER TABLE enquiries ADD COLUMN timeline TEXT NOT NULL DEFAULT '';
      ALTER TABLE enquiries ADD COLUMN heard_from TEXT NOT NULL DEFAULT '';
      -- Consent is legally meaningful, so WHEN it was given is recorded, not
      -- just that it was.
      ALTER TABLE enquiries ADD COLUMN consent_at TEXT;
    `,
  },
  {
    id: 11,
    name: 'graph_and_jobs',
    sql: `
      -- ------------------------------------------------------------ node_edges
      --
      -- The relationship table the map has never had.
      --
      -- Until now the only relationship between two nodes was map_nodes.parent_id
      -- — one parent, no type, no attributes, never across maps. That makes the
      -- structure a TREE, and a tree cannot express "this depends on that",
      -- "this was derived from that", or any link that leaves its own map.
      --
      -- Containment stays on parent_id and is deliberately NOT duplicated here.
      -- Writing a 'contains' row for every node would create a second source of
      -- truth for the same fact, and the two would drift the first time a
      -- reparent updated one and not the other. The full graph is therefore
      -- "parent edges UNION node_edges", assembled in lib/graph.
      CREATE TABLE node_edges (
        id           TEXT PRIMARY KEY,
        -- The map that OWNS the edge, which is the map permission is checked
        -- against. For a cross-map edge this is the source node's map: the
        -- person drawing the link must be able to edit the end they started
        -- from, and must be able to VIEW the other end (enforced in lib/graph).
        map_id       TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        from_node_id TEXT NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
        to_node_id   TEXT NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
        -- Open vocabulary, validated in code rather than by a CHECK. New
        -- relationship kinds are the point of this table; a CHECK constraint
        -- would make every one of them a migration.
        type         TEXT NOT NULL DEFAULT 'relates_to',
        payload      TEXT,
        created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Both directions are indexed because traversal runs both ways: "what
      -- does this point at" and "what points at this" are equally common, and
      -- the second is what makes backlinks possible.
      CREATE INDEX node_edges_from ON node_edges(from_node_id);
      CREATE INDEX node_edges_to   ON node_edges(to_node_id);
      CREATE INDEX node_edges_map  ON node_edges(map_id);

      -- One edge of a given type between the same two nodes. Without this,
      -- double-submitting a link creates two identical rows that render as one
      -- line and take two clicks to delete.
      CREATE UNIQUE INDEX node_edges_unique
        ON node_edges(from_node_id, to_node_id, type);

      -- ------------------------------------------------------------------ jobs
      --
      -- Durable background work. Nothing in the application could run
      -- asynchronously before this: the outbox had queueEmail and pendingEmails
      -- and no runner, so every queued email sat unread forever.
      CREATE TABLE jobs (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        payload     TEXT NOT NULL DEFAULT '{}',
        -- 'pending' | 'running' | 'done' | 'dead'
        status      TEXT NOT NULL DEFAULT 'pending',
        -- Earliest time this may run. Backoff moves it forward; a scheduled
        -- job simply starts with it in the future.
        run_after   TEXT NOT NULL DEFAULT (datetime('now')),
        attempts    INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        last_error  TEXT,
        -- Optional idempotency key; see the unique index below.
        dedupe_key  TEXT,
        -- Set when a worker claims the row, so a crashed worker's jobs can be
        -- reclaimed after a lease timeout rather than being stuck at 'running'.
        locked_at   TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- The claim query orders by run_after within status, so this index is
      -- what stops every poll becoming a full scan as the table grows.
      CREATE INDEX jobs_claimable ON jobs(status, run_after);

      -- Optional idempotency key. Two requests that both try to enqueue "send
      -- the welcome email for user X" should produce one job, not two.
      --
      -- Scoped to jobs that have not finished. Without the status predicate a
      -- completed job would hold its key forever, so a recurring dedupe key
      -- like 'outbox' could be enqueued exactly ONCE in the lifetime of the
      -- database and every later attempt would silently return the old,
      -- finished row.
      CREATE UNIQUE INDEX jobs_dedupe ON jobs(type, dedupe_key)
        WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running');

      -- ---------------------------------------------------------------- events
      --
      -- An append-only log of things that happened, so behaviour can be
      -- attached to them without the emitter knowing who is listening.
      CREATE TABLE events (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        -- Who caused it. Null for system-originated events.
        actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
        -- What it happened to, as a type + id pair rather than a foreign key,
        -- because an event may outlive the row it refers to and a cascade
        -- delete would erase the history of the deletion itself.
        subject_type TEXT NOT NULL DEFAULT '',
        subject_id   TEXT NOT NULL DEFAULT '',
        payload    TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX events_type    ON events(type, created_at);
      CREATE INDEX events_subject ON events(subject_type, subject_id, created_at);
    `,
  },
  {
    id: 12,
    name: 'tenancy_grants_comments',
    sql: `
      -- --------------------------------------------------------- organizations
      --
      -- Added NOW because the cost only rises. Ownership is user-scoped
      -- throughout (maps.owner_id), and every month this is deferred is
      -- another table and another visibility query that has to be revisited
      -- when it finally arrives.
      CREATE TABLE organizations (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        -- URL-safe identifier, for a future /o/<slug> and for white-label
        -- deployments that route by hostname.
        slug       TEXT NOT NULL UNIQUE,
        -- The account that can never be removed and can transfer the org.
        owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX organizations_owner ON organizations(owner_id);

      CREATE TABLE organization_members (
        org_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Same vocabulary as map roles on purpose. Two role systems with
        -- different names for the same idea is how "editor" comes to mean two
        -- things depending on where you are standing.
        role      TEXT NOT NULL DEFAULT 'editor',
        added_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (org_id, user_id)
      );
      CREATE INDEX organization_members_user ON organization_members(user_id);

      -- Additive and NULLABLE, per docs/04-environments.md. Every existing map
      -- keeps working with a personal owner; org ownership is opt-in, and no
      -- backfill is required for this migration to be safe.
      ALTER TABLE maps ADD COLUMN org_id TEXT REFERENCES organizations(id);
      CREATE INDEX maps_org ON maps(org_id);

      -- ---------------------------------------------------------------- grants
      --
      -- Permissions as (subject, action, resource) rather than a fixed struct.
      --
      -- The role matrix in lib/sharing/roles.ts stays exactly as it is and
      -- remains the DEFAULT answer — it encodes real thinking about privilege
      -- escalation that must not be lost. A grant is an override on top of it,
      -- which is what makes per-node permission possible without rewriting
      -- roles.
      CREATE TABLE grants (
        id            TEXT PRIMARY KEY,
        -- Who. A user today; 'org' and 'role' subjects are why this is a pair
        -- of columns rather than a bare user_id.
        subject_type  TEXT NOT NULL DEFAULT 'user',
        subject_id    TEXT NOT NULL,
        -- What. One of the Capabilities keys, so grants and roles speak the
        -- same vocabulary and can be compared without translation.
        action        TEXT NOT NULL,
        -- On what. 'map' or 'node' today; 'org' and 'workflow' later.
        resource_type TEXT NOT NULL,
        resource_id   TEXT NOT NULL,
        -- allow | deny. Deny exists so a viewer can be excluded from ONE node
        -- of a map they can otherwise read — the common real case, and
        -- impossible to express with allow-only grants.
        effect        TEXT NOT NULL DEFAULT 'allow',
        granted_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- The resolver's lookup shape: everything about one resource, at once.
      CREATE INDEX grants_resource
        ON grants(resource_type, resource_id, subject_id);
      CREATE INDEX grants_subject ON grants(subject_id);

      -- One ruling per (subject, action, resource). Without this a subject
      -- could hold both an allow and a deny and the answer would depend on row
      -- order.
      CREATE UNIQUE INDEX grants_unique
        ON grants(subject_type, subject_id, action, resource_type, resource_id);

      -- --------------------------------------------------------- node_comments
      --
      -- Comments ON a node. map_messages is a chat for the whole map; this
      -- is discussion attached to one thing, which is a different feature that
      -- happens to look similar.
      CREATE TABLE node_comments (
        id         TEXT PRIMARY KEY,
        node_id    TEXT NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
        -- Denormalised from the node so permission can be checked without a
        -- join on every read. The node cannot move between maps, so it cannot
        -- go stale.
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        -- Soft delete: a removed comment leaves a tombstone so a reply does
        -- not become an orphan answering nothing.
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX node_comments_node ON node_comments(node_id, created_at);
      CREATE INDEX node_comments_map  ON node_comments(map_id, created_at);

      -- Who was named in a comment. A join table rather than parsing the body
      -- on every read: a mention has to survive the text being edited, and
      -- notification needs to query "what mentioned me" cheaply.
      CREATE TABLE comment_mentions (
        comment_id TEXT NOT NULL REFERENCES node_comments(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (comment_id, user_id)
      );
      CREATE INDEX comment_mentions_user ON comment_mentions(user_id);

      -- ------------------------------------------------------- password_resets
      --
      -- §11 listed reset as an open gap because it needs email delivery, which
      -- did not exist until the outbox drain shipped in Phase 1.
      CREATE TABLE password_resets (
        -- The token IS the primary key: it is looked up by nothing else, and a
        -- separate id would be a second thing to keep unique for no benefit.
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        used_at    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX password_resets_user ON password_resets(user_id, created_at);
    `,
  },
  {
    id: 13,
    name: 'auth_rate_limits',
    sql: `
      -- ------------------------------------------------------------ rate_limits
      --
      -- Durable, because the previous limiter was not.
      --
      -- Sign-in kept its attempt counts in a per-process Map. Three problems,
      -- in order of severity: it reset on every deploy and every cold start, so
      -- an attacker just had to wait for one; it was per-instance, so N
      -- instances meant N times the allowance; and the Map was never pruned, so
      -- every distinct email tried against it was retained forever, which is a
      -- memory leak reachable by an anonymous POST.
      --
      -- A table fixes all three. It is the same store the rest of the system
      -- already uses for counting attempts (see ingest budget), so there is no
      -- new infrastructure here.
      CREATE TABLE rate_limits (
        -- A unique id per attempt, NOT a composite key on the timestamp.
        --
        -- The first version keyed on (bucket, subject, attempted) and relied on
        -- INSERT OR IGNORE. SQLite's datetime('now') has one-second
        -- resolution, so every attempt inside the same second collided and
        -- only the first was recorded — which meant unlimited attempts as long
        -- as they arrived fast enough. A limiter defeated by speed is not a
        -- limiter. Caught by its own test on the first run.
        id         TEXT PRIMARY KEY,
        -- Bucket namespaces the limit (sign_in, sign_up, password_reset);
        -- subject is a salted hash of an email or an address, so one attacker
        -- cannot lock out everyone behind a shared IP.
        bucket     TEXT NOT NULL,
        subject    TEXT NOT NULL,
        attempted  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX rate_limits_lookup ON rate_limits(bucket, subject, attempted);
    `,
  },
  {
    id: 14,
    name: 'ai_platform',
    sql: `
      -- --------------------------------------------------------- ai_calls
      --
      -- One row per model call, whatever made it.
      --
      -- "Every AI action is attributable and reversible" is half of this
      -- phase's definition of done, and attribution needs a record that exists
      -- whether the call succeeded, failed, or was refused. ingest_runs
      -- already does this for ONE feature; this is the same idea for every
      -- feature, which is why the ingest budget can now be a per-user quota
      -- instead of a single global cap.
      CREATE TABLE ai_calls (
        id            TEXT PRIMARY KEY,
        -- Who asked. NULL for a system job with no user behind it.
        user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
        -- What asked: ingest, assistant, embed, eval.
        feature       TEXT NOT NULL,
        provider      TEXT NOT NULL,
        model         TEXT NOT NULL,
        -- Which prompt version ran, so a regression can be traced to a change.
        prompt_id     TEXT,
        prompt_version INTEGER,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd      REAL NOT NULL DEFAULT 0,
        -- ok | unavailable | invalid | refused | unconfigured
        outcome       TEXT NOT NULL,
        duration_ms   INTEGER NOT NULL DEFAULT 0,
        -- The provider's own error text. Never shown to a user.
        detail        TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX ai_calls_user  ON ai_calls(user_id, created_at);
      CREATE INDEX ai_calls_month ON ai_calls(created_at);

      -- ------------------------------------------------------- ai_proposals
      --
      -- The human-in-the-loop half.
      --
      -- The assistant NEVER writes to a map. It writes a proposal here, a
      -- person accepts or rejects it, and only the accept applies anything.
      -- That is what makes an AI action reversible: rejecting is the default
      -- and costs nothing, and an applied proposal keeps the row that produced
      -- it, so what the model suggested is still on the record afterwards.
      CREATE TABLE ai_proposals (
        id         TEXT PRIMARY KEY,
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        -- The node this concerns. NULL when proposing against the whole map.
        node_id    TEXT REFERENCES map_nodes(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- generate | expand | summarise
        kind       TEXT NOT NULL,
        -- The proposed change, as JSON. Shape depends on kind.
        payload    TEXT NOT NULL,
        -- pending | accepted | rejected
        status     TEXT NOT NULL DEFAULT 'pending',
        -- The call that produced it, so a bad suggestion is traceable to a
        -- model, a prompt version and a cost.
        call_id    TEXT REFERENCES ai_calls(id) ON DELETE SET NULL,
        decided_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX ai_proposals_map ON ai_proposals(map_id, status, created_at);
      CREATE INDEX ai_proposals_user ON ai_proposals(user_id, status);

      -- ------------------------------------------------------- embeddings
      --
      -- Vectors for semantic search.
      --
      -- Stored as a BLOB of little-endian float32, not as JSON. A 1536-vector
      -- as JSON is roughly 20KB of text that has to be parsed on every read;
      -- as a blob it is 6KB and a typed-array view. At a few thousand nodes
      -- the difference is the whole query budget.
      --
      -- No ANN index: SQLite has none built in, and a linear scan over
      -- thousands of vectors is milliseconds. The row shape is what a real
      -- index would need later, so adopting sqlite-vec or moving to pgvector
      -- is a swap of the search function, not a migration.
      CREATE TABLE embeddings (
        -- What was embedded: node | map | content.
        subject_type TEXT NOT NULL,
        subject_id   TEXT NOT NULL,
        model        TEXT NOT NULL,
        -- Checked on read: comparing vectors of different lengths, or from
        -- different models, produces confident nonsense rather than an error.
        dimensions   INTEGER NOT NULL,
        vector       BLOB NOT NULL,
        -- Hash of the text embedded, so unchanged text is never re-embedded.
        content_hash TEXT NOT NULL,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (subject_type, subject_id, model)
      );
      CREATE INDEX embeddings_model ON embeddings(model, subject_type);
    `,
  },
  {
    id: 15,
    name: 'agents_and_workflows',
    sql: `
      -- =====================================================================
      -- THE RAILS COME FIRST.
      --
      -- The roadmap calls this the highest-risk phase and says why: agents act
      -- on user data, so permission enforcement, spend caps, an audit trail and
      -- a kill switch have to exist BEFORE launch, not after. Every table here
      -- that constrains an agent is defined above the tables that let one run.
      -- =====================================================================

      -- ------------------------------------------------------- kill switch
      --
      -- One row, one boolean, checked before every agent action.
      --
      -- A switch in an env var needs a deploy to flip, and the moment you need
      -- it is the moment you cannot wait for one. In the database it is a
      -- single UPDATE, it applies to every process at once, and it survives a
      -- restart, which an in-memory flag does not.
      CREATE TABLE agent_controls (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        -- When 0, no agent runs anywhere. The global stop.
        enabled    INTEGER NOT NULL DEFAULT 1,
        -- Why it was stopped, so whoever finds it stopped knows.
        reason     TEXT,
        stopped_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO agent_controls (id, enabled) VALUES (1, 1);

      -- ------------------------------------------------------------- agents
      --
      -- An agent IS a node, per Phase 2: its definition lives in the node type
      -- registry, and this table holds the operational half a node payload
      -- should not carry -- its grants, its caps, its own switch.
      CREATE TABLE agents (
        id           TEXT PRIMARY KEY,
        -- The node that is this agent. Deleting the node retires the agent.
        node_id      TEXT NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
        map_id       TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        -- The account the agent acts AS. Every permission check uses this, so
        -- an agent can never reach anything its owner could not.
        owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        -- Per-agent switch, independent of the global one. Pausing one
        -- misbehaving agent must not require stopping all of them.
        enabled      INTEGER NOT NULL DEFAULT 1,
        -- Spend cap in USD per calendar month, checked before every call.
        monthly_usd  REAL NOT NULL DEFAULT 1.0,
        -- Hard ceiling on steps in one run, so a loop terminates even if the
        -- model never decides to stop.
        max_steps    INTEGER NOT NULL DEFAULT 8,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX agents_node ON agents(node_id);
      CREATE INDEX agents_map ON agents(map_id);

      -- ------------------------------------------------- agent_tool_grants
      --
      -- Which tools an agent may use. DENY BY DEFAULT: an agent with no rows
      -- here can do nothing at all.
      --
      -- Separate from the grants table, which answers "may this subject do
      -- this action on this resource". This answers "may this agent call this
      -- tool". Both are checked, and a tool grant never widens what the
      -- owner is allowed -- it only narrows it further.
      CREATE TABLE agent_tool_grants (
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        tool       TEXT NOT NULL,
        granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (agent_id, tool)
      );

      -- ----------------------------------------------------- agent_memory
      --
      -- Isolated per agent. The primary key starts with agent_id and every
      -- read is scoped by it, so one agent cannot read another memory even
      -- when both belong to the same person.
      CREATE TABLE agent_memory (
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (agent_id, key)
      );

      -- -------------------------------------------------------- agent_runs
      --
      -- The audit trail. One row per run, whatever the outcome.
      CREATE TABLE agent_runs (
        id          TEXT PRIMARY KEY,
        agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        -- What started it: manual | workflow | event.
        trigger     TEXT NOT NULL,
        -- running | ok | failed | halted | refused
        status      TEXT NOT NULL DEFAULT 'running',
        steps       INTEGER NOT NULL DEFAULT 0,
        cost_usd    REAL NOT NULL DEFAULT 0,
        error       TEXT,
        started_at  TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
      CREATE INDEX agent_runs_agent ON agent_runs(agent_id, started_at DESC);
      CREATE INDEX agent_runs_status ON agent_runs(status);

      -- ------------------------------------------------------- agent_steps
      --
      -- Every tool call an agent made, including the refused ones.
      --
      -- Refusals matter most: an agent repeatedly reaching for a tool it does
      -- not hold is the signal that it is misconfigured or being manipulated,
      -- and recording only successes hides exactly that.
      CREATE TABLE agent_steps (
        id         TEXT PRIMARY KEY,
        run_id     TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        tool       TEXT NOT NULL,
        input      TEXT NOT NULL DEFAULT '',
        -- ok | refused | error
        outcome    TEXT NOT NULL,
        output     TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX agent_steps_run ON agent_steps(run_id, seq);

      -- --------------------------------------------------------- workflows
      --
      -- A workflow runs over the Phase 1a graph: its steps act on nodes and
      -- follow edges. The ordered step list lives here because a workflow also
      -- needs a trigger, a switch and a status, none of which is an edge.
      CREATE TABLE workflows (
        id         TEXT PRIMARY KEY,
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        -- manual | event
        trigger    TEXT NOT NULL DEFAULT 'manual',
        -- For an event trigger, which event type fires it.
        trigger_on TEXT,
        enabled    INTEGER NOT NULL DEFAULT 1,
        -- JSON array of steps, validated against a zod schema on write.
        steps      TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX workflows_map ON workflows(map_id);
      CREATE INDEX workflows_trigger ON workflows(trigger, trigger_on, enabled);

      -- ----------------------------------------------------- workflow_runs
      CREATE TABLE workflow_runs (
        id          TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        -- running | ok | failed | awaiting_approval | halted
        status      TEXT NOT NULL DEFAULT 'running',
        -- Index of the next step to run, so a resumed run continues rather
        -- than restarting and repeating side effects.
        cursor      INTEGER NOT NULL DEFAULT 0,
        -- Accumulated context between steps, as JSON.
        context     TEXT NOT NULL DEFAULT '{}',
        error       TEXT,
        started_at  TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
      CREATE INDEX workflow_runs_wf ON workflow_runs(workflow_id, started_at DESC);
      CREATE INDEX workflow_runs_status ON workflow_runs(status);

      -- ------------------------------------------------- workflow_approvals
      --
      -- A human approval step blocks the run until someone decides.
      CREATE TABLE workflow_approvals (
        id         TEXT PRIMARY KEY,
        run_id     TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        prompt     TEXT NOT NULL DEFAULT '',
        -- pending | approved | rejected
        status     TEXT NOT NULL DEFAULT 'pending',
        decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        decided_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX workflow_approvals_run ON workflow_approvals(run_id, status);
    `,
  },
  {
    id: 16,
    name: 'billing',
    sql: `
      -- =====================================================================
      -- MONEY IS INTEGER CENTS, EVERYWHERE.
      --
      -- Never a float. 0.1 + 0.2 is not 0.3 in IEEE 754, and a rounding error
      -- in a currency column is a rounding error in somebody invoice. SQLite
      -- has no decimal type, so the only safe representation is an integer
      -- number of the smallest unit.
      --
      -- CREDITS are also integers, for the same reason plus one more: a credit
      -- ledger that can hold a fraction can hold a fraction that no arithmetic
      -- produces, and reconciling that is worse than the rounding it avoided.
      -- =====================================================================

      -- ------------------------------------------------------------- plans
      --
      -- Local mirror of what is configured in Stripe. Stripe is the source of
      -- truth for price; this exists so a page can render a plan without a
      -- network call, and so a subscription row means something when Stripe is
      -- unreachable.
      CREATE TABLE plans (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        -- The Stripe price id. NULL for the free plan, which Stripe never sees.
        stripe_price_id TEXT UNIQUE,
        cents_per_month INTEGER NOT NULL DEFAULT 0,
        -- AI credits granted at the start of each billing period.
        monthly_credits INTEGER NOT NULL DEFAULT 0,
        max_maps       INTEGER NOT NULL DEFAULT 3,
        max_agents     INTEGER NOT NULL DEFAULT 0,
        active         INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Seeded here so a fresh database has a working free tier. Paid plans are
      -- inserted by whoever configures Stripe, because their price ids only
      -- exist once someone has created them there.
      INSERT INTO plans (id, name, cents_per_month, monthly_credits, max_maps, max_agents)
      VALUES ('free', 'Free', 0, 100, 3, 0);

      -- ------------------------------------------------------ subscriptions
      CREATE TABLE subscriptions (
        id                    TEXT PRIMARY KEY,
        user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id               TEXT NOT NULL REFERENCES plans(id),
        -- Stripe identifiers. Both nullable: a free subscription never touches
        -- Stripe, and a customer exists before any subscription does.
        stripe_customer_id     TEXT,
        stripe_subscription_id TEXT UNIQUE,
        -- active | past_due | canceled | incomplete. Mirrors Stripe status
        -- rather than inventing a parallel vocabulary that has to be mapped.
        status                TEXT NOT NULL DEFAULT 'active',
        -- When the current period ends. Drives the credit grant.
        period_end            TEXT,
        -- Set when the user cancels but the period has not run out yet. They
        -- keep what they paid for until it does.
        cancel_at_period_end  INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- One subscription per user. Two would make "which plan am I on" a
      -- question with two answers.
      CREATE UNIQUE INDEX subscriptions_user ON subscriptions(user_id);
      CREATE INDEX subscriptions_customer ON subscriptions(stripe_customer_id);

      -- ----------------------------------------------------- credit_ledger
      --
      -- APPEND ONLY. A balance is the sum of the rows, never a column that is
      -- updated.
      --
      -- A stored balance and a list of transactions eventually disagree, and
      -- when they do there is no way to tell which is right. Summing is slower
      -- and always correct, and at the volumes here the difference is not
      -- measurable. If it ever is, the fix is a periodic snapshot row, not a
      -- mutable column.
      CREATE TABLE credit_ledger (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Positive grants, negative spends. Signed, so the sum IS the balance
        -- and no separate debit/credit flag can be set inconsistently.
        amount      INTEGER NOT NULL,
        -- grant | spend | purchase | refund | expiry
        kind        TEXT NOT NULL,
        -- What caused it: an ai_calls id, a Stripe invoice id, a period start.
        reference   TEXT NOT NULL DEFAULT '',
        note        TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX credit_ledger_user ON credit_ledger(user_id, created_at);
      -- One row per reference per kind: a retried webhook or a repeated period
      -- grant cannot credit the same thing twice.
      CREATE UNIQUE INDEX credit_ledger_once
        ON credit_ledger(user_id, kind, reference)
        WHERE reference != '';

      -- ---------------------------------------------------------- invoices
      --
      -- A local record of what Stripe billed, so an invoice list renders
      -- without a network call and survives Stripe being unreachable. Stripe
      -- remains the source of truth; nothing here is used to decide what
      -- someone owes.
      CREATE TABLE invoices (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_invoice_id TEXT UNIQUE,
        -- Integer cents. See the note at the top of this migration.
        amount_cents      INTEGER NOT NULL DEFAULT 0,
        currency          TEXT NOT NULL DEFAULT 'usd',
        -- draft | open | paid | void | uncollectible. Stripe vocabulary.
        status            TEXT NOT NULL DEFAULT 'draft',
        -- Stripe hosted page. We never render an invoice ourselves, and never
        -- see a card number.
        hosted_url        TEXT,
        period_start      TEXT,
        period_end        TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX invoices_user ON invoices(user_id, created_at DESC);

      -- --------------------------------------------------- webhook_events
      --
      -- Idempotency for Stripe.
      --
      -- Stripe retries a webhook until it gets a 2xx, and it can deliver the
      -- same event more than once even on success. Without this table a retry
      -- of invoice.paid grants the credits twice. The event id is the primary
      -- key, so the second delivery is a constraint violation rather than a
      -- second effect.
      CREATE TABLE webhook_events (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        -- ok | ignored | failed. A failure is kept so it can be replayed.
        outcome      TEXT NOT NULL DEFAULT 'ok',
        error        TEXT,
        received_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX webhook_events_type ON webhook_events(type, received_at DESC);

      -- Professional services: the enquiries table already holds the lead.
      -- These columns turn it into a pipeline without a second table that
      -- would have to be kept in step with the first.
      ALTER TABLE enquiries ADD COLUMN stage TEXT NOT NULL DEFAULT 'lead';
      ALTER TABLE enquiries ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
      -- Integer cents, like every other money column here.
      ALTER TABLE enquiries ADD COLUMN quoted_cents INTEGER;
      ALTER TABLE enquiries ADD COLUMN next_action_at TEXT;
      CREATE INDEX enquiries_stage ON enquiries(stage, created_at DESC);
      CREATE INDEX enquiries_owner ON enquiries(owner_id, next_action_at);
    `,
  },
  {
    id: 17,
    name: 'ecosystem',
    sql: `
      -- =====================================================================
      -- PHASE 7 - ECOSYSTEM
      --
      -- Public API, webhooks, plugins, and one marketplace framework serving
      -- four catalogues.
      --
      -- THE RULE THAT SHAPES EVERY TABLE BELOW: nothing here can widen what
      -- its owner may already do. An API key is a NARROWED view of one user's
      -- authority, an installed plugin acts through such a key, and a
      -- marketplace listing points at something its author already owns. Read
      -- every scope column as a ceiling, never as a grant.
      -- =====================================================================

      -- --------------------------------------------------------- api_keys
      --
      -- The secret is stored HASHED, exactly like sessions and password reset
      -- tokens. A leaked database must not yield working credentials.
      --
      -- The prefix is stored in clear and indexed: it is how a presented key
      -- is found in one indexed read, so the constant-time comparison runs
      -- against ONE candidate row rather than every key in the table. It is
      -- also what a person sees in the UI to tell two keys apart, since the
      -- secret is shown once and never again.
      CREATE TABLE api_keys (
        id          TEXT PRIMARY KEY,
        prefix      TEXT NOT NULL UNIQUE,
        secret_hash TEXT NOT NULL,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Set when the key acts for an organisation rather than a person.
        -- Authority still resolves through the USER; this records intent.
        org_id      TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        name        TEXT NOT NULL DEFAULT '',
        -- Space-separated scope list. A ceiling on the owner's authority.
        scopes      TEXT NOT NULL DEFAULT '',
        -- Set when a plugin installation owns this key, so revoking the
        -- installation revokes the key with it.
        installation_id TEXT,
        last_used_at TEXT,
        expires_at  TEXT,
        -- Revoked rather than deleted: a key id appears in request logs, and
        -- a reference pointing at nothing makes a log unreadable.
        revoked_at  TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX api_keys_user ON api_keys(user_id, revoked_at);
      CREATE INDEX api_keys_installation ON api_keys(installation_id);

      -- Every authenticated API call, for attribution and rate limiting.
      -- Pruned on a schedule: this is an operational log, not an audit record.
      CREATE TABLE api_requests (
        id         TEXT PRIMARY KEY,
        key_id     TEXT NOT NULL,
        method     TEXT NOT NULL,
        path       TEXT NOT NULL,
        status     INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX api_requests_key ON api_requests(key_id, created_at);

      -- ------------------------------------------------- webhook_endpoints
      --
      -- OUTBOUND webhooks: us calling a third party. Distinct from the
      -- 'webhook_events' table added in migration 16, which records INBOUND
      -- calls from Stripe. They are named apart because their security
      -- properties are opposite: inbound must VERIFY a signature, outbound
      -- must PRODUCE one and must never be pointed at our own network.
      CREATE TABLE webhook_endpoints (
        id          TEXT PRIMARY KEY,
        owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        -- Shared secret for the HMAC signature. The receiver verifies with it.
        secret      TEXT NOT NULL,
        -- Space-separated event types, or '*' for all of them.
        events      TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        active      INTEGER NOT NULL DEFAULT 1,
        -- Consecutive failures, reset by any success. An endpoint that has
        -- been gone for days is switched off rather than retried forever.
        failures    INTEGER NOT NULL DEFAULT 0,
        disabled_at TEXT,
        -- Set when a plugin installation owns the endpoint.
        installation_id TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX webhook_endpoints_owner ON webhook_endpoints(owner_id, active);
      CREATE INDEX webhook_endpoints_installation
        ON webhook_endpoints(installation_id);

      -- One row per (endpoint, event). The unique index IS the idempotency
      -- guarantee: an event replayed to the same endpoint is delivered once.
      CREATE TABLE webhook_deliveries (
        id           TEXT PRIMARY KEY,
        endpoint_id  TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
        event_id     TEXT NOT NULL,
        event_type   TEXT NOT NULL,
        -- pending | delivered | failed
        status       TEXT NOT NULL DEFAULT 'pending',
        attempts     INTEGER NOT NULL DEFAULT 0,
        response_status INTEGER,
        error        TEXT,
        delivered_at TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX webhook_deliveries_unique
        ON webhook_deliveries(endpoint_id, event_id);
      CREATE INDEX webhook_deliveries_status
        ON webhook_deliveries(status, created_at);

      -- ---------------------------------------------------------- plugins
      --
      -- A plugin is a MANIFEST plus a URL. It ships no code that runs in this
      -- process; see lib/plugins/loader.ts for why that IS the sandbox rather
      -- than a shortcoming of one.
      CREATE TABLE plugins (
        id          TEXT PRIMARY KEY,
        -- Namespace for everything the plugin contributes. A declared node
        -- type is stored as '<slug>.<type>', so a plugin can shadow neither a
        -- built-in type nor another plugin's.
        slug        TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Validated against lib/plugins/manifest.ts before it is ever stored.
        manifest    TEXT NOT NULL,
        version     TEXT NOT NULL DEFAULT '0.0.0',
        -- draft | review | published | suspended
        status      TEXT NOT NULL DEFAULT 'draft',
        review_note TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX plugins_status ON plugins(status, updated_at DESC);
      CREATE INDEX plugins_author ON plugins(author_id);

      -- Installing is the moment consent is given. 'granted_scopes' is what
      -- the installer actually allowed, which may be less than the manifest
      -- asked for and can never be more.
      CREATE TABLE plugin_installations (
        id            TEXT PRIMARY KEY,
        plugin_id     TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Optional narrowing to one map. NULL means every map the user has.
        map_id        TEXT REFERENCES maps(id) ON DELETE CASCADE,
        granted_scopes TEXT NOT NULL DEFAULT '',
        -- The version consented to. A manifest that later wants more scopes
        -- must be re-consented rather than silently taking them.
        version       TEXT NOT NULL DEFAULT '0.0.0',
        enabled       INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX plugin_installations_unique
        ON plugin_installations(plugin_id, user_id, COALESCE(map_id, ''));
      CREATE INDEX plugin_installations_user
        ON plugin_installations(user_id, enabled);

      -- --------------------------------------------------------- listings
      --
      -- ONE marketplace framework, four catalogues. 'kind' is the catalogue;
      -- 'target_id' points at the thing being listed, whose type depends on
      -- the kind: a plugin, a map used as a template, an agent, or a person
      -- offering their time.
      --
      -- Four tables would have meant four review queues, four moderation
      -- paths, four rating implementations and four copies of the same bugs.
      -- What genuinely differs per kind is: what target_id points at, whether
      -- that target is valid, and what fulfilling an order means. That is
      -- three functions in lib/marketplace/kinds.ts, not three tables.
      CREATE TABLE listings (
        id          TEXT PRIMARY KEY,
        -- template | plugin | agent | freelancing
        kind        TEXT NOT NULL,
        slug        TEXT NOT NULL,
        title       TEXT NOT NULL,
        summary     TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- The id of the plugin / map / agent / user this listing sells.
        target_id   TEXT NOT NULL DEFAULT '',
        -- Integer cents. 0 is free, which is a price rather than an absence.
        price_cents INTEGER NOT NULL DEFAULT 0,
        -- draft | review | published | suspended. The same lifecycle for all
        -- four catalogues, so one queue moderates the whole marketplace.
        status      TEXT NOT NULL DEFAULT 'draft',
        review_note TEXT,
        -- Denormalised counters: cheap on a catalogue page, and recomputable
        -- from listing_orders / listing_reviews if they ever drift.
        orders      INTEGER NOT NULL DEFAULT 0,
        rating_sum  INTEGER NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX listings_slug ON listings(kind, slug);
      CREATE INDEX listings_catalogue ON listings(kind, status, updated_at DESC);
      CREATE INDEX listings_author ON listings(author_id);
      CREATE INDEX listings_target ON listings(kind, target_id);

      -- An order is a RECORD, not a payment. Money moves through Stripe, as
      -- migration 16 established; this row says what was bought and whether it
      -- has been fulfilled.
      CREATE TABLE listing_orders (
        id          TEXT PRIMARY KEY,
        listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        buyer_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        price_cents INTEGER NOT NULL DEFAULT 0,
        -- pending | fulfilled | refunded | cancelled
        status      TEXT NOT NULL DEFAULT 'pending',
        -- What fulfilment produced: a map id, an installation id, an enquiry
        -- id. Which of those it is depends on the listing kind.
        result_id   TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX listing_orders_listing
        ON listing_orders(listing_id, created_at DESC);
      CREATE INDEX listing_orders_buyer ON listing_orders(buyer_id, created_at DESC);

      -- One review per buyer per listing. This unique key, together with the
      -- ordered-first check in the repository, is the whole anti-abuse story
      -- for ratings.
      CREATE TABLE listing_reviews (
        id         TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating     INTEGER NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX listing_reviews_unique
        ON listing_reviews(listing_id, author_id);
    `,
  },
  {
    id: 18,
    name: 'enterprise',
    sql: `
      -- =====================================================================
      -- PHASE 8 - ENTERPRISE AND DEVICES
      --
      -- SSO, MFA, audit, white-label, and the operation log offline sync
      -- replays from.
      --
      -- THE RULE THAT SHAPES THE SECURITY TABLES: every secret here is stored
      -- the way it will be VERIFIED, not the way it was received. A TOTP
      -- secret must be readable to compute a code, so it is encrypted at rest
      -- with a key that lives outside the database. A recovery code is only
      -- ever compared, so it is hashed and can never be read back. Getting
      -- that distinction wrong is how a database dump becomes a set of
      -- working second factors.
      -- =====================================================================

      -- --------------------------------------------------------- user_mfa
      --
      -- One row per person, created when they START enrolling and confirmed
      -- only once they have proved they can produce a code. An unconfirmed row
      -- does not gate sign-in: enabling a second factor you cannot satisfy is
      -- how people lock themselves out permanently.
      CREATE TABLE user_mfa (
        user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        -- The TOTP shared secret, encrypted with MFA_ENCRYPTION_KEY.
        -- Encrypted rather than hashed because generating the expected code
        -- requires the original bytes; see lib/auth/mfa.ts.
        secret_cipher TEXT NOT NULL,
        -- Set when the first correct code was entered. NULL = not yet on.
        confirmed_at TEXT,
        -- The last counter window accepted, so a code cannot be replayed
        -- inside its own 30-second validity by someone watching the wire.
        last_step    INTEGER,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Single-use codes for the phone-in-the-river case. HASHED: they are
      -- only ever compared, never displayed again after enrolment.
      CREATE TABLE mfa_recovery_codes (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash  TEXT NOT NULL,
        used_at    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX mfa_recovery_user ON mfa_recovery_codes(user_id, used_at);

      -- Marks a session as having satisfied the second factor. A row in
      -- 'sessions' alone is NOT enough once MFA is on: the password half is
      -- done and the session is pending until the code is entered.
      ALTER TABLE sessions ADD COLUMN mfa_at TEXT;
      -- Which SSO connection minted this session, when one did. Lets an admin
      -- revoking a connection revoke the sessions it created.
      ALTER TABLE sessions ADD COLUMN sso_connection_id TEXT;

      -- --------------------------------------------------- sso_connections
      --
      -- OIDC only. SAML is deliberately absent - see ADR-0010: XML signature
      -- verification is a well-known source of authentication bypasses, and a
      -- half-correct implementation of it is worse than an honest gap.
      CREATE TABLE sso_connections (
        id            TEXT PRIMARY KEY,
        org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        -- Display name for the sign-in button: 'Okta', 'Google Workspace'.
        name          TEXT NOT NULL,
        -- The OIDC issuer, e.g. https://example.okta.com. Discovery is read
        -- from <issuer>/.well-known/openid-configuration.
        issuer        TEXT NOT NULL,
        client_id     TEXT NOT NULL,
        -- Encrypted at rest with the same key as the TOTP secrets: it must be
        -- sent to the provider, so it cannot be hashed.
        client_secret_cipher TEXT NOT NULL,
        -- Cached discovery endpoints, so a sign-in does not depend on the
        -- provider's discovery document being reachable at that instant.
        authorize_url TEXT NOT NULL DEFAULT '',
        token_url     TEXT NOT NULL DEFAULT '',
        jwks_url      TEXT NOT NULL DEFAULT '',
        -- Email domain this connection claims, e.g. 'example.com'. How an
        -- address at the sign-in screen is routed to the right provider.
        email_domain  TEXT NOT NULL DEFAULT '',
        -- When set, members of this org may ONLY sign in through SSO. The
        -- owner is deliberately exempt in code - see lib/auth/sso.ts.
        enforced      INTEGER NOT NULL DEFAULT 0,
        active        INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX sso_connections_domain
        ON sso_connections(email_domain) WHERE email_domain != '';
      CREATE INDEX sso_connections_org ON sso_connections(org_id, active);

      -- One row per authorisation attempt, deleted as soon as it is consumed.
      -- This is the CSRF defence for the OIDC callback: a callback carrying a
      -- state we did not issue, or one already used, is rejected.
      CREATE TABLE sso_states (
        state         TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES sso_connections(id) ON DELETE CASCADE,
        nonce         TEXT NOT NULL,
        -- PKCE. Required even for a confidential client: it binds the code to
        -- this browser, so an intercepted code is useless without the verifier.
        code_verifier TEXT NOT NULL,
        return_to     TEXT NOT NULL DEFAULT '/app',
        expires_at    TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX sso_states_expiry ON sso_states(expires_at);

      -- The link between a provider's idea of a person and ours. The subject
      -- claim is the stable identifier; email is NOT, because people change
      -- theirs and providers reassign addresses.
      CREATE TABLE sso_identities (
        id            TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES sso_connections(id) ON DELETE CASCADE,
        subject       TEXT NOT NULL,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_seen_at  TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX sso_identities_subject
        ON sso_identities(connection_id, subject);
      CREATE INDEX sso_identities_user ON sso_identities(user_id);

      -- -------------------------------------------------------- audit_log
      --
      -- APPEND-ONLY, and distinct from \'events\'.
      --
      -- \'events\' is machinery: it drives jobs, workflows and webhooks, and it
      -- gains and loses types as the product changes. An audit log answers a
      -- different question, asked by a different person, usually months later:
      -- "who did this, when, and from where". It is written for a human
      -- reading it under pressure, never consumed by code, and never deleted
      -- by the application - only by the retention sweep.
      CREATE TABLE audit_log (
        id          TEXT PRIMARY KEY,
        -- NULL for account-level actions with no org context.
        org_id      TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        -- Who acted. NULL when nobody did: a retention sweep, an expiry.
        actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
        -- Denormalised, because the whole point of an audit row is that it
        -- still reads correctly after the account is deleted.
        actor_label TEXT NOT NULL DEFAULT '',
        action      TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id   TEXT NOT NULL DEFAULT '',
        -- JSON. Free-form context for a reader; nothing branches on it.
        metadata    TEXT NOT NULL DEFAULT '{}',
        -- Salted hash, never a raw IP - same policy as the rate limiter.
        client_hash TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX audit_log_org ON audit_log(org_id, created_at DESC);
      CREATE INDEX audit_log_actor ON audit_log(actor_id, created_at DESC);
      CREATE INDEX audit_log_action ON audit_log(action, created_at DESC);

      -- --------------------------------------------------- org_settings
      --
      -- Policy and branding for one organisation. One row rather than columns
      -- on \'organizations\', so an org with no enterprise features carries no
      -- empty columns and the defaults live in one place.
      CREATE TABLE org_settings (
        org_id          TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
        -- Policy.
        require_mfa     INTEGER NOT NULL DEFAULT 0,
        -- Hours before a session must be re-established. 0 = the global default.
        session_hours   INTEGER NOT NULL DEFAULT 0,
        -- White-label. Empty means "use ours".
        brand_name      TEXT NOT NULL DEFAULT '',
        brand_logo_url  TEXT NOT NULL DEFAULT '',
        -- A single accent colour, validated as a hex triple before storage.
        -- Deliberately not a stylesheet: see lib/enterprise/branding.ts.
        brand_accent    TEXT NOT NULL DEFAULT '',
        brand_support_email TEXT NOT NULL DEFAULT '',
        -- Custom hostname, e.g. maps.example.com. Verified by DNS TXT before
        -- it is served, so nobody can claim a domain they do not control.
        custom_domain   TEXT NOT NULL DEFAULT '',
        domain_token    TEXT NOT NULL DEFAULT '',
        domain_verified_at TEXT,
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX org_settings_domain
        ON org_settings(custom_domain) WHERE custom_domain != '';

      -- --------------------------------------------------------- sync_ops
      --
      -- The operation log offline sync replays from.
      --
      -- Every change to a map is also recorded here as a CRDT operation, with
      -- a hybrid logical clock. A device that has been offline sends the ops
      -- it made and asks for everything after the last sequence it saw; both
      -- sides converge without either having to be authoritative.
      --
      -- \'seq\' is a per-map monotonic counter assigned by the SERVER, which is
      -- what makes "give me everything after N" answerable. The HLC decides
      -- conflicts; the sequence decides delivery. They are different jobs and
      -- conflating them is why naive sync loses writes.
      CREATE TABLE sync_ops (
        id        TEXT PRIMARY KEY,
        map_id    TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        seq       INTEGER NOT NULL,
        -- Which device produced it. Ties break by device id, so two devices
        -- with identical clocks still converge to the same answer.
        device_id TEXT NOT NULL,
        -- Hybrid logical clock: wall-clock millis and a counter.
        hlc_millis INTEGER NOT NULL,
        hlc_count  INTEGER NOT NULL,
        -- set_field | delete_node | create_node
        kind      TEXT NOT NULL,
        node_id   TEXT NOT NULL DEFAULT '',
        field     TEXT NOT NULL DEFAULT '',
        -- JSON-encoded value. NULL is a real value here, so it is encoded.
        value     TEXT NOT NULL DEFAULT 'null',
        actor_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX sync_ops_seq ON sync_ops(map_id, seq);
      -- The idempotency guarantee: a device re-sending an op it already sent
      -- writes nothing. Offline clients retry, so this is not optional.
      CREATE UNIQUE INDEX sync_ops_unique
        ON sync_ops(map_id, device_id, hlc_millis, hlc_count, node_id, field);

      -- What each device has been given, so a reconnect is incremental.
      CREATE TABLE sync_devices (
        device_id  TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        last_seq   INTEGER NOT NULL DEFAULT 0,
        label      TEXT NOT NULL DEFAULT '',
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (device_id, map_id)
      );
      CREATE INDEX sync_devices_user ON sync_devices(user_id, last_seen_at DESC);
    `,
  },
  {
    id: 19,
    name: 'longhorizon',
    sql: `
      -- =====================================================================
      -- PHASE 9 - LONG HORIZON
      --
      -- LifeMap, locale preference, and display profiles.
      --
      -- THE RULE THAT SHAPES THE LIFEMAP TABLES: this is the most personal
      -- data the product will ever hold - years of somebody's messages,
      -- photographs and relationships, exported from another service and
      -- handed to us. There is no visibility column and no sharing table,
      -- because a LifeMap import is PRIVATE TO ONE ACCOUNT and there is no
      -- code path that makes it otherwise. Sharing happens, if it happens at
      -- all, by the person copying a node onto an ordinary map they own.
      -- =====================================================================

      -- ---------------------------------------------------- lifemap_imports
      --
      -- One row per archive somebody uploads. The archive FILE is never
      -- stored: it is parsed in memory, the entries are kept, and the upload
      -- is discarded. Keeping the original would mean holding a complete copy
      -- of somebody's Facebook history indefinitely, which is a liability
      -- nobody asked us to take on.
      CREATE TABLE lifemap_imports (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- facebook | instagram | google | generic
        source      TEXT NOT NULL DEFAULT 'generic',
        label       TEXT NOT NULL DEFAULT '',
        -- pending | analysed | applied | discarded
        status      TEXT NOT NULL DEFAULT 'pending',
        entry_count INTEGER NOT NULL DEFAULT 0,
        -- Entries the parser recognised and could not use. Reported honestly:
        -- "812 of your 940 posts" is actionable, silently dropping 128 is not.
        skipped_count INTEGER NOT NULL DEFAULT 0,
        -- The map this import was applied to, once it has been.
        map_id      TEXT REFERENCES maps(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at  TEXT
      );
      CREATE INDEX lifemap_imports_user
        ON lifemap_imports(user_id, created_at DESC);

      -- ---------------------------------------------------- lifemap_entries
      --
      -- The parsed entries. Denormalised on purpose: a LifeMap is read as a
      -- whole and never joined against anything else, and normalising people
      -- and places into their own tables would mean three joins to render one
      -- memory.
      CREATE TABLE lifemap_entries (
        id         TEXT PRIMARY KEY,
        import_id  TEXT NOT NULL REFERENCES lifemap_imports(id) ON DELETE CASCADE,
        -- Denormalised from the import so every read is scoped to one account
        -- in its own WHERE clause, rather than through a join that a future
        -- query might forget.
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL DEFAULT 'post',
        title      TEXT NOT NULL DEFAULT '',
        body       TEXT NOT NULL DEFAULT '',
        -- ISO 8601, or NULL when the archive gave no usable timestamp. NULL is
        -- common and is not an error: plenty of exported items are undated.
        occurred_at TEXT,
        -- JSON arrays. Small, and always read with the row.
        people     TEXT NOT NULL DEFAULT '[]',
        place      TEXT NOT NULL DEFAULT '',
        source     TEXT NOT NULL DEFAULT 'generic',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX lifemap_entries_import ON lifemap_entries(import_id);
      CREATE INDEX lifemap_entries_user ON lifemap_entries(user_id, occurred_at);

      -- --------------------------------------------------- lifemap_entities
      --
      -- People, places and themes found across one import.
      CREATE TABLE lifemap_entities (
        id         TEXT PRIMARY KEY,
        import_id  TEXT NOT NULL REFERENCES lifemap_imports(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- person | place | theme | period
        kind       TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        label      TEXT NOT NULL,
        count      INTEGER NOT NULL DEFAULT 0,
        first_seen TEXT,
        last_seen  TEXT
      );
      CREATE UNIQUE INDEX lifemap_entities_unique
        ON lifemap_entities(import_id, entity_key);
      CREATE INDEX lifemap_entities_user ON lifemap_entities(user_id, count DESC);

      -- ------------------------------------------------------- preferences
      --
      -- Locale and display preferences, one row per person.
      --
      -- Locale is stored rather than negotiated afresh each request because an
      -- explicit choice must outrank the browser's Accept-Language header. A
      -- person who picked Spanish on a machine configured for English chose
      -- Spanish, and re-negotiating over that would keep overriding them.
      CREATE TABLE user_preferences (
        user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        locale     TEXT NOT NULL DEFAULT '',
        -- Overrides the inferred display class when somebody knows better than
        -- our estimate: a boardroom install, a kiosk, an unusual monitor.
        surface_class TEXT NOT NULL DEFAULT '',
        -- Physical diagonal in inches, when a deployment actually knows it.
        -- A measurement always beats the inference in lib/display/surfaces.ts.
        diagonal_inches REAL,
        -- Honours prefers-reduced-motion as a stored choice as well as a media
        -- query, so it survives a browser that does not expose the setting.
        reduced_motion INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

/**
 * The production Postgres schema, including the RLS policies §20 names.
 *
 * Not executed here — this app runs on SQLite, which has no row-level
 * security. It is written out so the production migration is a transcription
 * rather than a design exercise, and so the policy intent is reviewable now
 * rather than at deploy time.
 *
 * The application-level equivalent is `src/lib/db/repo.ts`, where every query
 * takes a mandatory AuthContext. That is the actual mitigation today; RLS is
 * defence in depth on top of it.
 */
export const POSTGRES_RLS = `
-- Every table denies by default, then grants exactly what the app needs.
ALTER TABLE maps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_nodes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets      ENABLE ROW LEVEL SECURITY;

-- A map is readable by its owner, by its members, or if it is public.
CREATE POLICY maps_read ON maps FOR SELECT USING (
  owner_id = current_setting('app.user_id', true)::uuid
  OR visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM map_members m
    WHERE m.map_id = maps.id
      AND m.user_id = current_setting('app.user_id', true)::uuid
  )
);

-- Only the owner writes, until P7 adds editor roles.
CREATE POLICY maps_write ON maps FOR ALL USING (
  owner_id = current_setting('app.user_id', true)::uuid
) WITH CHECK (
  owner_id = current_setting('app.user_id', true)::uuid
);

-- Nodes inherit their map's visibility. The subquery is deliberate: a policy
-- that trusted a map_id passed in by the client would be no policy at all.
CREATE POLICY nodes_read ON map_nodes FOR SELECT USING (
  EXISTS (SELECT 1 FROM maps WHERE maps.id = map_nodes.map_id)
);
CREATE POLICY nodes_write ON map_nodes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM maps
    WHERE maps.id = map_nodes.map_id
      AND maps.owner_id = current_setting('app.user_id', true)::uuid
  )
);

CREATE POLICY members_read ON map_members FOR SELECT USING (
  user_id = current_setting('app.user_id', true)::uuid
  OR EXISTS (
    SELECT 1 FROM maps
    WHERE maps.id = map_members.map_id
      AND maps.owner_id = current_setting('app.user_id', true)::uuid
  )
);

CREATE POLICY assets_own ON assets FOR ALL USING (
  owner_id = current_setting('app.user_id', true)::uuid
);

-- Share tokens and invites are readable only by people who can manage the map.
-- A leaked SELECT here would hand out working links.
ALTER TABLE share_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_invites  ENABLE ROW LEVEL SECURITY;

CREATE POLICY share_tokens_manage ON share_tokens FOR ALL USING (
  EXISTS (
    SELECT 1 FROM maps
    WHERE maps.id = share_tokens.map_id
      AND maps.owner_id = current_setting('app.user_id', true)::uuid
  )
);

CREATE POLICY invites_manage ON map_invites FOR ALL USING (
  EXISTS (
    SELECT 1 FROM maps
    WHERE maps.id = map_invites.map_id
      AND maps.owner_id = current_setting('app.user_id', true)::uuid
  )
);
`;
