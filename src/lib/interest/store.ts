import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db/client';

/**
 * Interest capture — now durable.
 *
 * P4 shipped this in memory and said so plainly: "the in-memory store DOES NOT
 * SURVIVE A RESTART… Do not read month-one numbers out of this store." P6
 * closes that. §24 measures ≥10 registrations per dark node in month one, and
 * that number ranks what gets built in months 4–6, so it has to be real.
 *
 * Dedupe is a UNIQUE INDEX rather than an application check:
 *
 *   CREATE UNIQUE INDEX node_interest_dedupe
 *     ON node_interest(node_id, COALESCE(user_id, visitor_hash, 'anon'));
 *
 * A check-then-insert has a race — two taps in flight both see no row and both
 * insert. The index cannot be raced, and COALESCE is there because SQLite (and
 * Postgres by default) treat NULLs as distinct in a unique index, which would
 * let one signed-out visitor register unlimited times.
 */

export interface InterestRecord {
  nodeId: string;
  userId: string | null;
  /** Hashed identifier for signed-out visitors. Never a raw IP. */
  visitorHash: string | null;
  email: string | null;
  createdAt: string;
}

/** Dedupe key: the signed-in user if there is one, else the visitor hash. */
export function dedupeKey(
  record: Pick<InterestRecord, 'userId' | 'visitorHash'>,
): string {
  return record.userId ?? record.visitorHash ?? 'anon';
}

export interface InterestStore {
  readonly name: string;
  /** Returns false when this person had already registered for this node. */
  register(record: InterestRecord): Promise<boolean>;
  countFor(nodeId: string): Promise<number>;
  hasRegistered(nodeId: string, key: string): Promise<boolean>;
  counts(): Promise<Record<string, number>>;
}

class SqliteInterestStore implements InterestStore {
  readonly name = 'sqlite';

  async register(record: InterestRecord): Promise<boolean> {
    const result = getDb()
      .prepare(
        `INSERT INTO node_interest (id, node_id, user_id, visitor_hash, email, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         -- The index does the deduping; a duplicate is a no-op, not an error.
         ON CONFLICT DO NOTHING`,
      )
      .run(
        randomUUID(),
        record.nodeId,
        record.userId,
        record.visitorHash,
        record.email,
        record.createdAt,
      );

    return result.changes > 0;
  }

  async countFor(nodeId: string): Promise<number> {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS n FROM node_interest WHERE node_id = ?')
      .get(nodeId) as { n: number };
    return row.n;
  }

  async hasRegistered(nodeId: string, key: string): Promise<boolean> {
    const row = getDb()
      .prepare(
        `SELECT 1 FROM node_interest
         WHERE node_id = ? AND COALESCE(user_id, visitor_hash, 'anon') = ?`,
      )
      .get(nodeId, key);
    return row !== undefined;
  }

  async counts(): Promise<Record<string, number>> {
    const rows = getDb()
      .prepare('SELECT node_id, COUNT(*) AS n FROM node_interest GROUP BY node_id')
      .all() as { node_id: string; n: number }[];

    const result: Record<string, number> = {};
    for (const row of rows) result[row.node_id] = row.n;
    return result;
  }
}

let store: InterestStore = new SqliteInterestStore();

export function getInterestStore(): InterestStore {
  return store;
}

/** Test seam. */
export function setInterestStore(next: InterestStore): void {
  store = next;
}

export { SqliteInterestStore };
