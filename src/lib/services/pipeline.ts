import 'server-only';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import type { AuthContext } from '@/lib/db/repo';

/**
 * The professional-services pipeline.
 *
 * ── Built on `enquiries`, not beside it ─────────────────────────────────────
 *
 * A lead and a deal are the same thing at different moments, so they are the
 * same row. A separate `deals` table would mean copying the enquiry across at
 * some arbitrary point and thereafter keeping two records of one conversation
 * in step — and the copy would immediately lose the spam verdict, the rate
 * limit hash and the original message, which are exactly what you want when a
 * deal turns out to have started as something odd.
 *
 * ── Stages are a sequence, and they are allowed to go backwards ─────────────
 *
 * Deals stall and restart. A state machine that only moved forward would force
 * people to lie to it, and a pipeline nobody trusts is worse than a list.
 */

export const STAGES = [
  'lead',
  'contacted',
  'qualified',
  'quoted',
  'won',
  'lost',
] as const;

export type Stage = (typeof STAGES)[number];

/** Stages where the deal is finished, so it drops out of the working list. */
const CLOSED: readonly Stage[] = ['won', 'lost'];

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

export interface PipelineEntry {
  id: string;
  serviceSlug: string;
  name: string;
  email: string;
  company: string;
  message: string;
  budget: string;
  stage: Stage;
  ownerId: string | null;
  ownerHandle: string | null;
  /** Integer cents, like every other money value here. Null until quoted. */
  quotedCents: number | null;
  nextActionAt: string | null;
  status: string;
  createdAt: string;
}

interface Row {
  id: string;
  service_slug: string;
  name: string;
  email: string;
  company: string;
  message: string;
  budget: string;
  stage: string;
  owner_id: string | null;
  owner_handle: string | null;
  quoted_cents: number | null;
  next_action_at: string | null;
  status: string;
  created_at: string;
}

function hydrate(row: Row): PipelineEntry {
  return {
    id: row.id,
    serviceSlug: row.service_slug,
    name: row.name,
    email: row.email,
    company: row.company,
    message: row.message,
    budget: row.budget,
    stage: isStage(row.stage) ? row.stage : 'lead',
    ownerId: row.owner_id,
    ownerHandle: row.owner_handle,
    quotedCents: row.quoted_cents,
    nextActionAt: row.next_action_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

const SELECT = `
  SELECT enquiries.id, enquiries.service_slug, enquiries.name, enquiries.email,
         enquiries.company, enquiries.message, enquiries.budget,
         enquiries.stage, enquiries.owner_id, enquiries.quoted_cents,
         enquiries.next_action_at, enquiries.status, enquiries.created_at,
         users.handle AS owner_handle
    FROM enquiries
    LEFT JOIN users ON users.id = enquiries.owner_id
`;

export interface ListOptions {
  stage?: Stage;
  /** Only deals assigned to this person. */
  ownerId?: string;
  /** Include won and lost. Off by default: the working list is what is open. */
  includeClosed?: boolean;
}

/**
 * The pipeline. Staff only.
 *
 * Spam is excluded from the working list but never deleted — the same rule the
 * enquiries inbox follows. A false positive is a lost customer, and the only
 * way to find one is to be able to look.
 */
export function listPipeline(
  ctx: AuthContext,
  options: ListOptions = {},
  db: Database = getDb(),
): PipelineEntry[] {
  if (!ctx.isStaff) return [];

  const clauses = ["enquiries.status != 'spam'"];
  const params: Record<string, string> = {};

  if (options.stage) {
    clauses.push('enquiries.stage = @stage');
    params.stage = options.stage;
  } else if (!options.includeClosed) {
    clauses.push(`enquiries.stage NOT IN ('won', 'lost')`);
  }

  if (options.ownerId) {
    clauses.push('enquiries.owner_id = @ownerId');
    params.ownerId = options.ownerId;
  }

  const rows = db
    .prepare(
      `${SELECT} WHERE ${clauses.join(' AND ')}
       /*
        * Nulls last: a deal with no follow-up date is not more urgent than one
        * due tomorrow, and SQLite sorts NULL first by default — which would
        * put every unscheduled deal at the top of a list meant to be read as
        * "what is next".
        */
       ORDER BY enquiries.next_action_at IS NULL,
                enquiries.next_action_at,
                enquiries.created_at DESC
       LIMIT 200`,
    )
    .all(params) as Row[];

  return rows.map(hydrate);
}

export function getEntry(
  ctx: AuthContext,
  enquiryId: string,
  db: Database = getDb(),
): PipelineEntry | null {
  if (!ctx.isStaff) return null;

  const row = db.prepare(`${SELECT} WHERE enquiries.id = ?`).get(enquiryId) as
    Row | undefined;

  return row ? hydrate(row) : null;
}

export interface UpdateResult {
  ok: boolean;
  entry?: PipelineEntry;
  error?: string;
}

/**
 * Move a deal along, assign it, quote it, or schedule the next touch.
 *
 * One function rather than four, because they are almost always done together
 * — you move something to `quoted` and set the amount in the same breath — and
 * four endpoints would mean four round trips and four chances for the row to
 * end up half-updated.
 */
export function updateEntry(
  ctx: AuthContext,
  enquiryId: string,
  patch: {
    stage?: string;
    ownerId?: string | null;
    quotedCents?: number | null;
    nextActionAt?: string | null;
  },
  db: Database = getDb(),
): UpdateResult {
  if (!ctx.isStaff) return { ok: false, error: 'Not found' };

  const existing = getEntry(ctx, enquiryId, db);
  if (!existing) return { ok: false, error: 'Not found' };

  if (patch.stage !== undefined && !isStage(patch.stage)) {
    return { ok: false, error: 'That is not a stage' };
  }

  /*
   * A quote is required to reach `quoted`, and to stay there.
   *
   * The stage IS the claim that a number was sent. Letting the two disagree
   * turns "what have we quoted this month" into a question the pipeline
   * cannot answer, which is most of what a pipeline is for.
   */
  const nextStage = patch.stage ?? existing.stage;
  const nextQuote =
    patch.quotedCents === undefined ? existing.quotedCents : patch.quotedCents;

  if (nextStage === 'quoted' && (nextQuote === null || nextQuote <= 0)) {
    return { ok: false, error: 'Add the amount you quoted' };
  }

  db.prepare(
    `UPDATE enquiries SET
       stage = COALESCE(@stage, stage),
       owner_id = CASE WHEN @ownerSet = 1 THEN @ownerId ELSE owner_id END,
       quoted_cents = CASE WHEN @quoteSet = 1 THEN @quotedCents ELSE quoted_cents END,
       next_action_at = CASE WHEN @dateSet = 1 THEN @nextActionAt ELSE next_action_at END
     WHERE id = @id`,
  ).run({
    id: enquiryId,
    stage: patch.stage ?? null,
    /*
     * Each nullable field needs a "was it supplied" flag. COALESCE cannot tell
     * "leave it alone" from "clear it", and unassigning a deal or withdrawing
     * a quote both mean writing NULL deliberately.
     */
    ownerSet: patch.ownerId === undefined ? 0 : 1,
    ownerId: patch.ownerId ?? null,
    quoteSet: patch.quotedCents === undefined ? 0 : 1,
    quotedCents:
      patch.quotedCents === null || patch.quotedCents === undefined
        ? null
        : Math.max(0, Math.round(patch.quotedCents)),
    dateSet: patch.nextActionAt === undefined ? 0 : 1,
    nextActionAt: patch.nextActionAt ?? null,
  });

  return { ok: true, entry: getEntry(ctx, enquiryId, db) ?? undefined };
}

export interface PipelineSummary {
  stage: Stage;
  count: number;
  /** Total quoted in this stage, integer cents. */
  quotedCents: number;
}

/**
 * Counts and value by stage.
 *
 * Value is the sum of what was actually quoted, never an estimate derived from
 * the budget field — that is a range someone typed into a form, and turning it
 * into a forecast would be inventing a number and then reporting it.
 */
export function summary(
  ctx: AuthContext,
  db: Database = getDb(),
): PipelineSummary[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `SELECT stage, COUNT(*) AS n, COALESCE(SUM(quoted_cents), 0) AS value
         FROM enquiries WHERE status != 'spam'
        GROUP BY stage`,
    )
    .all() as { stage: string; n: number; value: number }[];

  const byStage = new Map(rows.map((row) => [row.stage, row]));

  // Every stage appears, including the empty ones — a pipeline view with
  // stages missing reads as data still loading.
  return STAGES.map((stage) => ({
    stage,
    count: byStage.get(stage)?.n ?? 0,
    quotedCents: byStage.get(stage)?.value ?? 0,
  }));
}

/** Deals whose follow-up date has passed. The list someone works from. */
export function overdue(ctx: AuthContext, db: Database = getDb()): PipelineEntry[] {
  if (!ctx.isStaff) return [];

  const rows = db
    .prepare(
      `${SELECT} WHERE enquiries.status != 'spam'
         AND enquiries.stage NOT IN ('won', 'lost')
         AND enquiries.next_action_at IS NOT NULL
         AND enquiries.next_action_at <= datetime('now')
       ORDER BY enquiries.next_action_at
       LIMIT 100`,
    )
    .all() as Row[];

  return rows.map(hydrate);
}

export function isClosed(stage: Stage): boolean {
  return CLOSED.includes(stage);
}
