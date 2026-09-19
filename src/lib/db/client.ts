import 'server-only';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MIGRATIONS } from './migrations';

/**
 * The database handle.
 *
 * ── Why SQLite ──────────────────────────────────────────────────────────────
 *
 * §20's acceptance criterion is "map survives sign-out, device change and
 * offline edit". That needs real persistence — the in-memory stores P4 and P5
 * shipped cannot satisfy it, and both said so.
 *
 * SQLite gives real tables, real migrations, real durability and real
 * concurrency semantics with no provisioning step. The cost is no row-level
 * security, which §20 names as this phase's High risk. That is addressed in
 * `repo.ts`, where authorisation is a mandatory argument rather than a policy
 * the database enforces — see the note there. The Postgres RLS policies are
 * written out in `migrations.ts` for the production swap.
 *
 * ── The export rule ─────────────────────────────────────────────────────────
 *
 * This module exports `getDb` for the repository and nothing else does. If a
 * route handler imports it directly it can query without an AuthContext, and
 * the entire mitigation is gone. That is enforced by review and by a test that
 * greps for the import.
 */

const globalForDb = globalThis as unknown as { __cdnDb?: Database.Database };

function databasePath(): string {
  if (process.env.CDN_DATABASE_PATH) return process.env.CDN_DATABASE_PATH;
  // Tests get their own file per process so they never collide with a dev
  // database or with each other.
  if (process.env.NODE_ENV === 'test') return ':memory:';
  return resolve(process.cwd(), '.data', 'cdn.sqlite');
}

function open(): Database.Database {
  const path = databasePath();

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  // WAL lets readers proceed during a write, which matters because autosave
  // writes while the map list is being read.
  db.pragma('journal_mode = WAL');
  // Without this, SQLite accepts a child row pointing at a missing parent and
  // the map renders with an orphaned branch.
  db.pragma('foreign_keys = ON');
  // Wait rather than failing immediately when another connection holds a lock.
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT id FROM _migrations')
      .all()
      .map((row) => (row as { id: number }).id),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    // Each migration is one transaction. A half-applied schema is far worse
    // than a failed deploy: the next run would try to re-create tables that
    // already exist and fail for a reason unrelated to the real problem.
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.id, migration.name, new Date().toISOString());
    });

    run();
  }
}

export function getDb(): Database.Database {
  // Reused across hot reloads in development; without this, every edit opens
  // another connection and the WAL file grows until something complains.
  if (!globalForDb.__cdnDb) {
    globalForDb.__cdnDb = open();
  }
  return globalForDb.__cdnDb;
}

/** Test seam: a fresh in-memory database with the schema applied. */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function closeDb(): void {
  globalForDb.__cdnDb?.close();
  delete globalForDb.__cdnDb;
}
