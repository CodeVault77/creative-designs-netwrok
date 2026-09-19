import 'server-only';
import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db/client';
import { embed, type CallContext } from './gateway';

/**
 * Embeddings and vector search.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 *
 * Vectors are a BLOB of little-endian float32, not JSON. A 1536-dimension
 * vector as JSON is roughly 20KB of text to parse on every read; as a blob it
 * is 6KB and a typed-array view over the same bytes. Across a few thousand
 * nodes that is the difference between a search that feels instant and one
 * that does not.
 *
 * ── No approximate index, and why that is fine for now ──────────────────────
 *
 * SQLite has no built-in ANN index. A linear scan over a few thousand vectors
 * is single-digit milliseconds, so the honest answer today is to scan. The row
 * shape is what a real index would need, so adopting sqlite-vec or moving to
 * pgvector later replaces `search()` and nothing else.
 *
 * The scan is bounded by `subject_type` and `model`, so it never compares
 * vectors from different models — which produces confident nonsense rather
 * than an error, and is the failure mode most worth designing out.
 */

export type SubjectType = 'node' | 'map' | 'content';

/** float32 little-endian, the layout every runtime here agrees on. */
function pack(vector: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(vector[i]!, i * 4);
  }
  return buffer;
}

function unpack(buffer: Buffer): Float32Array {
  /*
   * A copy, not a view.
   *
   * better-sqlite3 hands back a Buffer that may be a view into a larger pooled
   * ArrayBuffer, so constructing a Float32Array over it directly reads whatever
   * happens to be adjacent. The copy is a few microseconds; the bug it prevents
   * is silently wrong similarity scores.
   */
  const copy = Buffer.from(buffer);
  return new Float32Array(
    copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
  );
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/**
 * Cosine similarity.
 *
 * Not normalised in advance because providers differ on whether they return
 * unit vectors, and assuming it when it is false silently distorts every
 * score. The extra two multiplications are not the cost worth optimising.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface StoreResult {
  stored: number;
  /** Subjects whose text was unchanged, so no call was made. */
  skipped: number;
}

/**
 * Embed and store, skipping anything whose text has not changed.
 *
 * The hash check is what stops a re-index costing the whole corpus every time
 * it runs. Re-embedding identical text is the single easiest way to spend a
 * budget on nothing.
 */
export async function storeEmbeddings(
  ctx: CallContext,
  subjects: { type: SubjectType; id: string; text: string }[],
  db: Database = getDb(),
): Promise<StoreResult> {
  if (subjects.length === 0) return { stored: 0, skipped: 0 };

  const existing = db.prepare(
    'SELECT content_hash FROM embeddings WHERE subject_type = ? AND subject_id = ?',
  );

  const pending = subjects.filter((subject) => {
    const row = existing.get(subject.type, subject.id) as
      { content_hash: string } | undefined;
    return row?.content_hash !== hashOf(subject.text);
  });

  const skipped = subjects.length - pending.length;
  if (pending.length === 0) return { stored: 0, skipped };

  const result = await embed(
    ctx,
    pending.map((subject) => subject.text),
    undefined,
    db,
  );

  // A failure is not fatal: search falls back to keywords, which is the
  // behaviour when no embedding exists at all.
  if (!result.ok || !result.value) return { stored: 0, skipped };

  const { vectors, model, dimensions } = result.value;

  const insert = db.prepare(
    `INSERT INTO embeddings
       (subject_type, subject_id, model, dimensions, vector, content_hash)
     VALUES (@type, @id, @model, @dimensions, @vector, @hash)
     ON CONFLICT(subject_type, subject_id, model) DO UPDATE SET
       vector = excluded.vector,
       dimensions = excluded.dimensions,
       content_hash = excluded.content_hash,
       updated_at = datetime('now')`,
  );

  db.transaction(() => {
    pending.forEach((subject, index) => {
      const vector = vectors[index];
      if (!vector) return;

      insert.run({
        type: subject.type,
        id: subject.id,
        model,
        dimensions,
        vector: pack(vector),
        hash: hashOf(subject.text),
      });
    });
  })();

  return { stored: pending.length, skipped };
}

export interface VectorHit {
  subjectId: string;
  score: number;
}

/**
 * Nearest subjects to a query vector.
 *
 * Filtered by model AND dimensions before any comparison: two vectors of
 * different lengths score 0 rather than throwing, and vectors from different
 * models are not comparable at all even when their lengths match.
 */
export function search(
  query: Float32Array,
  subjectType: SubjectType,
  model: string,
  limit = 20,
  db: Database = getDb(),
): VectorHit[] {
  const rows = db
    .prepare(
      `SELECT subject_id, vector FROM embeddings
        WHERE subject_type = ? AND model = ? AND dimensions = ?`,
    )
    .all(subjectType, model, query.length) as {
    subject_id: string;
    vector: Buffer;
  }[];

  return (
    rows
      .map((row) => ({
        subjectId: row.subject_id,
        score: cosine(query, unpack(row.vector)),
      }))
      /*
       * Drop anything at or below zero.
       *
       * Cosine runs to -1, and a negative score means "actively unlike the
       * query". Returning those in ranked order would fill an empty result set
       * with the worst matches in the corpus, which reads as the search being
       * broken rather than as there being no answer.
       */
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  );
}

/** Remove a subject's vectors. Called when the subject is deleted. */
export function forget(
  subjectType: SubjectType,
  subjectId: string,
  db: Database = getDb(),
): number {
  return db
    .prepare('DELETE FROM embeddings WHERE subject_type = ? AND subject_id = ?')
    .run(subjectType, subjectId).changes;
}

export interface HybridInput {
  /** Keyword results, best first. From the existing FTS search. */
  keyword: { id: string; rank: number }[];
  /** Semantic results, best first. */
  semantic: VectorHit[];
  limit?: number;
}

/**
 * Combine keyword and semantic results with reciprocal rank fusion.
 *
 * ── Why RRF rather than weighted scores ─────────────────────────────────────
 *
 * The two systems produce incomparable numbers: BM25 rank is unbounded and
 * ordinal, cosine is bounded and continuous. Normalising them into a common
 * scale requires choosing a mapping, and every choice is a hidden thumb on the
 * scale that nobody revisits. RRF uses only the ORDER each system produced,
 * which is the part both agree is meaningful.
 *
 * A document found by both rises above one found by either — which is the
 * entire point of running both.
 */
export function fuse(input: HybridInput): { id: string; score: number }[] {
  // The standard damping constant. Large enough that the top few ranks are not
  // wildly more valuable than the next few.
  const K = 60;

  const scores = new Map<string, number>();

  const add = (id: string, rank: number) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (K + rank + 1));
  };

  input.keyword.forEach((hit, index) => add(hit.id, index));
  input.semantic.forEach((hit, index) => add(hit.subjectId, index));

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 20);
}
