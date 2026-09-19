import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { createMap, createUser, type AuthContext } from '@/lib/db/repo';
import { createDraft } from '@/lib/editor/draft';
import { MAX_CHILDREN, MAX_DEPTH } from '@/lib/ingest/structure';
import {
  AIError,
  UnconfiguredProvider,
  type AIProvider,
  type CompletionResult,
  type EmbedResult,
  type ToolCallResult,
} from './provider';
import { USER_MONTHLY_USD, setProvider, usageSummary, userSpend } from './gateway';
import { allPrompts, getPrompt, renderPrompt } from './prompts';
import { cosine, forget, fuse, search, storeEmbeddings } from './embeddings';
import {
  acceptProposal,
  pendingProposals,
  proposeExpansion,
  rejectProposal,
} from './assistant';

/**
 * Phase 4's definition of done:
 *
 *   swapping providers is a config change
 *   every AI action is attributable and reversible
 *
 * The first is tested by running the whole stack against a fake provider that
 * shares nothing with Anthropic but the interface. The second is tested by
 * checking that a call leaves a row even when it fails, and that the assistant
 * cannot write to a map without a person accepting first.
 */

let db: Database;
let owner: AuthContext;
let mapId: string;
let nodeId: string;

/** A provider that is entirely fake, which is the point. */
class FakeProvider implements AIProvider {
  readonly id = 'fake';
  calls = 0;
  failWith: AIError | null = null;

  constructor(private readonly toolResult: unknown = { children: [] }) {}

  isConfigured() {
    return true;
  }

  private usage() {
    return { inputTokens: 100, outputTokens: 50, costUsd: 0.001 };
  }

  async complete(): Promise<CompletionResult> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return { text: 'hello', usage: this.usage(), model: 'fake-1' };
  }

  async *stream(): AsyncIterable<string> {
    yield 'hello';
  }

  async toolCall<T>(): Promise<ToolCallResult<T>> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return {
      input: this.toolResult as T,
      usage: this.usage(),
      model: 'fake-1',
    };
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return {
      // Deterministic: length and first character, so two different strings
      // embed differently and the same string embeds identically.
      vectors: texts.map((text) => [
        text.length / 100,
        (text.charCodeAt(0) || 0) / 200,
        0.5,
      ]),
      usage: this.usage(),
      model: 'fake-embed',
      dimensions: 3,
    };
  }
}

function user(id: string, handle: string): AuthContext {
  const row = createUser(
    {
      id,
      email: `${handle}@example.com`,
      passwordHash: 'x',
      handle,
      displayName: handle,
    },
    db,
  );
  return { userId: row.id, isStaff: false };
}

beforeEach(() => {
  db = createTestDb();
  owner = user('u_owner', 'owner');

  mapId = 'm_ai';
  createMap(owner, createDraft(mapId, 'AI map', 'create'), db);

  nodeId = 'nd_parent';
  db.prepare(
    `INSERT INTO map_nodes
       (id, map_id, parent_id, slot, title, family, type, status, visibility)
     VALUES (?, ?, NULL, 0, 'Sources', 'create', 'topic', 'active', 'inherit')`,
  ).run(nodeId, mapId);
});

afterEach(() => setProvider(null));

// ------------------------------------------------------------------ provider

describe('the provider seam', () => {
  it('runs the whole stack against a provider that is not Anthropic', async () => {
    const fake = new FakeProvider({ children: [{ title: 'Books' }] });
    setProvider(fake);

    const result = await proposeExpansion(owner, nodeId, db);

    /*
     * Nothing outside lib/ai knows which provider ran. That is the definition
     * of done for this half of the phase: swapping is a config change.
     */
    expect(result.ok).toBe(true);
    expect(fake.calls).toBe(1);

    const call = db.prepare('SELECT provider FROM ai_calls').get() as {
      provider: string;
    };
    expect(call.provider).toBe('fake');
  });

  it('fails cleanly when nothing is configured', async () => {
    setProvider(new UnconfiguredProvider());

    const result = await proposeExpansion(owner, nodeId, db);
    expect(result.ok).toBe(false);

    // Still recorded: an unconfigured environment is exactly the thing you
    // want visible, and a call that leaves no trace is invisible.
    const row = db.prepare('SELECT outcome FROM ai_calls').get() as {
      outcome: string;
    };
    expect(row.outcome).toBe('unconfigured');
  });
});

// --------------------------------------------------------------------- audit

describe('the audit trail', () => {
  it('records a failed call, not just a successful one', async () => {
    const fake = new FakeProvider();
    fake.failWith = new AIError('unavailable', 'busy', 'HTTP 503');
    setProvider(fake);

    await proposeExpansion(owner, nodeId, db);

    const row = db.prepare('SELECT outcome, detail FROM ai_calls').get() as {
      outcome: string;
      detail: string;
    };

    // A feature failing 40% of the time is invisible if only successes are
    // written down.
    expect(row.outcome).toBe('unavailable');
    expect(row.detail).toBe('HTTP 503');
  });

  it('records which prompt version ran', async () => {
    setProvider(new FakeProvider({ children: [{ title: 'Books' }] }));
    await proposeExpansion(owner, nodeId, db);

    const row = db
      .prepare('SELECT prompt_id, prompt_version FROM ai_calls')
      .get() as { prompt_id: string; prompt_version: number };

    // Without this, "results got worse last Tuesday" has no answer.
    expect(row.prompt_id).toBe('assistant.expand');
    expect(row.prompt_version).toBe(1);
  });

  it('attributes cost to the user who asked', async () => {
    setProvider(new FakeProvider({ children: [{ title: 'Books' }] }));
    await proposeExpansion(owner, nodeId, db);

    expect(userSpend(owner.userId!, db)).toBeCloseTo(0.001, 6);
    expect(usageSummary(owner.userId!, db).calls).toBe(1);
  });

  it('refuses once a user is over their monthly quota', async () => {
    const fake = new FakeProvider({ children: [{ title: 'Books' }] });
    setProvider(fake);

    db.prepare(
      `INSERT INTO ai_calls (id, user_id, feature, provider, model, cost_usd, outcome)
       VALUES ('spent', ?, 'assistant', 'fake', 'fake-1', ?, 'ok')`,
    ).run(owner.userId, USER_MONTHLY_USD);

    const result = await proposeExpansion(owner, nodeId, db);

    expect(result.ok).toBe(false);
    // Refused BEFORE the provider was reached: a quota that still spends money
    // is not a quota.
    expect(fake.calls).toBe(0);
  });
});

// ------------------------------------------------------------------- prompts

describe('the prompt registry', () => {
  it('gives every prompt at least one fixture', () => {
    for (const prompt of allPrompts()) {
      expect(prompt.fixtures.length, prompt.id).toBeGreaterThan(0);
    }
  });

  it('renders every fixture to text containing what it promises', () => {
    for (const prompt of allPrompts()) {
      for (const fixture of prompt.fixtures) {
        const rendered = renderPrompt(prompt.id, fixture.input);
        expect(rendered, `${prompt.id}: ${fixture.name}`).not.toBeNull();

        for (const needle of fixture.expect) {
          expect(rendered!.text, `${prompt.id}: ${fixture.name}`).toContain(needle);
        }
      }
    }
  });

  it('checks the system prompt says what it promises', () => {
    for (const prompt of allPrompts()) {
      for (const needle of prompt.systemExpect ?? []) {
        expect(prompt.system, prompt.id).toContain(needle);
      }
    }
  });

  /**
   * The limits the model is TOLD and the limits that are ENFORCED must agree.
   *
   * They live in two files — the prompt states them, `clampTree` applies them —
   * and nothing but this connects the two. Moving the prompt into the registry
   * silently dropped both limits from the text on the first attempt: the output
   * stayed valid because clampTree still truncated, so no other test noticed,
   * and the only symptom would have been the model spending its budget on
   * nodes that were then thrown away.
   */
  it('states the same breadth and depth limits that clampTree enforces', () => {
    const prompt = getPrompt('ingest.structure')!;

    expect(prompt.system).toContain(`At most ${MAX_CHILDREN} top-level nodes`);
    expect(prompt.system).toContain(`At most ${MAX_DEPTH} levels deep`);
  });

  it('reports the version alongside the text', () => {
    const rendered = renderPrompt('assistant.expand', {
      title: 'Sources',
      context: '',
      count: 5,
    });

    // Paired deliberately: recording one version while sending another would
    // make the audit column worse than useless.
    expect(rendered!.version).toBe(getPrompt('assistant.expand')!.version);
  });
});

// ---------------------------------------------------------------- embeddings

describe('embeddings', () => {
  it('scores identical text as more similar than different text', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    const c = new Float32Array([0, 1, 0]);

    expect(cosine(a, b)).toBeCloseTo(1);
    expect(cosine(a, c)).toBeCloseTo(0);
  });

  it('refuses to compare vectors of different lengths', () => {
    // Silently scoring mismatched vectors is how an index built at one
    // dimension returns confident nonsense against another.
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBe(0);
  });

  it('round-trips a vector through the blob column', async () => {
    setProvider(new FakeProvider());

    await storeEmbeddings(
      { userId: owner.userId, feature: 'embed' },
      [{ type: 'node', id: nodeId, text: 'Sources' }],
      db,
    );

    const hits = search(
      new Float32Array([7 / 100, 83 / 200, 0.5]),
      'node',
      'fake-embed',
      10,
      db,
    );

    expect(hits[0]?.subjectId).toBe(nodeId);
    expect(hits[0]!.score).toBeGreaterThan(0.99);
  });

  it('does not re-embed text that has not changed', async () => {
    const fake = new FakeProvider();
    setProvider(fake);

    const subject = [{ type: 'node' as const, id: nodeId, text: 'Sources' }];

    const first = await storeEmbeddings(
      { userId: owner.userId, feature: 'embed' },
      subject,
      db,
    );
    const second = await storeEmbeddings(
      { userId: owner.userId, feature: 'embed' },
      subject,
      db,
    );

    expect(first.stored).toBe(1);
    // Re-embedding identical text is the easiest way to spend a budget on
    // nothing.
    expect(second.stored).toBe(0);
    expect(second.skipped).toBe(1);
    expect(fake.calls).toBe(1);
  });

  it('forgets a subject', async () => {
    setProvider(new FakeProvider());
    await storeEmbeddings(
      { userId: owner.userId, feature: 'embed' },
      [{ type: 'node', id: nodeId, text: 'Sources' }],
      db,
    );

    expect(forget('node', nodeId, db)).toBe(1);
    expect(
      search(new Float32Array([1, 1, 1]), 'node', 'fake-embed', 10, db),
    ).toEqual([]);
  });

  it('ranks a document found by both systems above one found by either', () => {
    const fused = fuse({
      keyword: [
        { id: 'both', rank: 0 },
        { id: 'keyword-only', rank: 1 },
      ],
      semantic: [
        { subjectId: 'semantic-only', score: 0.9 },
        { subjectId: 'both', score: 0.8 },
      ],
    });

    // The entire reason for running two systems.
    expect(fused[0]!.id).toBe('both');
  });
});

// ----------------------------------------------------------------- assistant

describe('the assistant', () => {
  it('writes nothing to the map until a person accepts', async () => {
    setProvider(
      new FakeProvider({ children: [{ title: 'Books' }, { title: 'Papers' }] }),
    );

    const before = db
      .prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE parent_id = ?')
      .get(nodeId) as { n: number };

    const result = await proposeExpansion(owner, nodeId, db);
    expect(result.ok).toBe(true);

    const after = db
      .prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE parent_id = ?')
      .get(nodeId) as { n: number };

    // The proposal exists; the map is untouched.
    expect(after.n).toBe(before.n);
    expect(result.proposal!.status).toBe('pending');
  });

  it('applies the children on accept', async () => {
    setProvider(
      new FakeProvider({ children: [{ title: 'Books' }, { title: 'Papers' }] }),
    );
    const proposal = (await proposeExpansion(owner, nodeId, db)).proposal!;

    const decision = acceptProposal(owner, proposal.id, db);
    expect(decision.applied).toBe(2);

    const titles = db
      .prepare('SELECT title FROM map_nodes WHERE parent_id = ? ORDER BY slot')
      .all(nodeId) as { title: string }[];
    expect(titles.map((row) => row.title)).toEqual(['Books', 'Papers']);
  });

  it('keeps the proposal on the record after it is applied', async () => {
    setProvider(new FakeProvider({ children: [{ title: 'Books' }] }));
    const proposal = (await proposeExpansion(owner, nodeId, db)).proposal!;
    acceptProposal(owner, proposal.id, db);

    const row = db
      .prepare('SELECT status, call_id FROM ai_proposals WHERE id = ?')
      .get(proposal.id) as { status: string; call_id: string };

    // Attributable after the fact: what the model suggested, and the call that
    // produced it, are both still there.
    expect(row.status).toBe('accepted');
    expect(row.call_id).toBeTruthy();
  });

  it('cannot be applied twice', async () => {
    setProvider(new FakeProvider({ children: [{ title: 'Books' }] }));
    const proposal = (await proposeExpansion(owner, nodeId, db)).proposal!;

    expect(acceptProposal(owner, proposal.id, db).ok).toBe(true);
    expect(acceptProposal(owner, proposal.id, db).ok).toBe(false);

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE parent_id = ?')
      .get(nodeId) as { n: number };
    expect(count.n).toBe(1);
  });

  it('writes nothing on reject', async () => {
    setProvider(new FakeProvider({ children: [{ title: 'Books' }] }));
    const proposal = (await proposeExpansion(owner, nodeId, db)).proposal!;

    expect(rejectProposal(owner, proposal.id, db).ok).toBe(true);

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE parent_id = ?')
      .get(nodeId) as { n: number };
    expect(count.n).toBe(0);
  });

  it('refuses someone who cannot edit the node', async () => {
    const stranger = user('u_other', 'other');
    setProvider(new FakeProvider({ children: [{ title: 'Books' }] }));

    const result = await proposeExpansion(stranger, nodeId, db);
    expect(result.ok).toBe(false);
    expect(pendingProposals(stranger, mapId, db)).toEqual([]);
  });

  it('drops suggestions that duplicate an existing child', async () => {
    db.prepare(
      `INSERT INTO map_nodes
         (id, map_id, parent_id, slot, title, family, type, status, visibility)
       VALUES ('nd_books', ?, ?, 0, 'Books', 'create', 'topic', 'active', 'inherit')`,
    ).run(mapId, nodeId);

    setProvider(
      new FakeProvider({ children: [{ title: 'Books' }, { title: 'Papers' }] }),
    );

    const result = await proposeExpansion(owner, nodeId, db);
    const payload = result.proposal!.payload as { children: { title: string }[] };

    expect(payload.children.map((child) => child.title)).toEqual(['Papers']);
  });

  it('rejects an answer that does not match the schema', async () => {
    // A tool schema enforces shape; it does not enforce OUR limits.
    setProvider(new FakeProvider({ children: [{ title: 'x'.repeat(200) }] }));

    const result = await proposeExpansion(owner, nodeId, db);
    expect(result.ok).toBe(false);
  });
});
