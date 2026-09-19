/**
 * Versioned prompts.
 *
 * ── Why a prompt needs a version ────────────────────────────────────────────
 *
 * A prompt is the least reviewable thing in a codebase and the easiest to
 * change: someone adjusts a sentence, quality moves, and nothing in the diff
 * says what the old behaviour was. The version number is what makes a
 * regression traceable — `ai_calls.prompt_version` records which text ran, so
 * "results got worse last Tuesday" becomes a question with an answer.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * Editing the text of a released prompt means bumping its version. Not because
 * a tool enforces it, but because the audit trail is worthless if two different
 * texts ever shared a number. `prompts.test.ts` checks that every registered
 * prompt has fixtures and that no version is reused.
 */

export interface PromptFixture {
  /** What is being checked, in a sentence. */
  name: string;
  /** The variables the prompt is rendered with. */
  input: Record<string, string | number>;
  /**
   * Substrings the RENDERED prompt must contain.
   *
   * Deliberately assertions about the prompt, not about the model's answer.
   * A test that calls the model is slow, costs money, and fails for reasons
   * that have nothing to do with the change under review. What can be checked
   * cheaply and deterministically is that the instructions the model receives
   * still say what they are supposed to say.
   */
  expect: string[];
}

export interface Prompt {
  id: string;
  version: number;
  /** What this prompt is for, and what changed in this version. */
  notes: string;
  /** The system prompt, if the call takes one. */
  system?: string;
  /** Renders the user message. */
  render: (input: Record<string, never>) => string;
  fixtures: readonly PromptFixture[];
  /**
   * Substrings the SYSTEM prompt must contain.
   *
   * Separate from a fixture's `expect`, which covers the rendered user message.
   * It exists because the system prompt is where the hard limits are stated,
   * and those have to stay in step with the constants that enforce them — the
   * one thing about a prompt that can be wrong in a way code can detect.
   */
  systemExpect?: readonly string[];
}

const registry = new Map<string, Prompt>();

export function definePrompt<T extends Record<string, unknown>>(prompt: {
  id: string;
  version: number;
  notes: string;
  system?: string;
  render: (input: T) => string;
  fixtures: readonly PromptFixture[];
  systemExpect?: readonly string[];
}): void {
  registry.set(prompt.id, prompt as unknown as Prompt);
}

export function getPrompt(id: string): Prompt | undefined {
  return registry.get(id);
}

export function allPrompts(): Prompt[] {
  return [...registry.values()];
}

/**
 * Render a prompt and report which version ran.
 *
 * Returns the version alongside the text so a caller cannot record one and
 * send the other — the pairing is the whole point of the audit column.
 */
export function renderPrompt(
  id: string,
  input: Record<string, unknown>,
): { text: string; system?: string; version: number } | null {
  const prompt = registry.get(id);
  if (!prompt) return null;

  return {
    text: prompt.render(input as Record<string, never>),
    ...(prompt.system ? { system: prompt.system } : {}),
    version: prompt.version,
  };
}

// ------------------------------------------------------------------ prompts

definePrompt<{ title: string; url: string; text: string }>({
  id: 'ingest.structure',
  version: 1,
  notes:
    'Turns an extracted page into a shallow mind map. Version 1 is the text ' +
    'that shipped inline in lib/ingest/structure.ts, moved here unchanged so ' +
    'the migration to the registry is not also a behaviour change. The ' +
    'breadth and depth limits must stay in step with MAX_CHILDREN and ' +
    'MAX_DEPTH in lib/ingest/structure.ts; the fixture below is what catches ' +
    'them drifting apart.',
  system: [
    'You turn a single web page into a mind map skeleton.',
    '',
    'Rules:',
    /*
     * The breadth and depth limits are stated to the MODEL, not only enforced
     * afterwards.
     *
     * `clampTree` truncates whatever comes back, so omitting these still
     * produces a valid map — but a model that was never told the budget spends
     * it on nodes that are then thrown away, and the ones discarded are the
     * tail rather than the worst. Telling it up front is what makes the eight
     * it returns the eight it considers best.
     *
     * Hardcoded rather than interpolated from MAX_CHILDREN/MAX_DEPTH so that
     * changing a limit is a visible prompt change with a version bump, instead
     * of silently rewriting version 1 from a constant somewhere else.
     */
    '- At most 8 top-level nodes, each with at most 8 children.',
    '- At most 3 levels deep including the root.',
    '- Titles are 1-5 words, noun phrases, drawn from the page. Never invent a topic the page does not cover.',
    '- Summaries are one short sentence, factual, from the page.',
    '- If the page is a list of links or navigation, say so by producing few nodes rather than padding.',
    '- Output only via the provided tool.',
  ].join('\n'),
  render: ({ title, url, text }) =>
    [`URL: ${url}`, `Title: ${title}`, '', text].join('\n'),
  fixtures: [
    {
      name: 'carries the page URL and title into the prompt',
      input: { title: 'Patent law', url: 'https://example.com/p', text: 'Body.' },
      expect: ['https://example.com/p', 'Patent law', 'Body.'],
    },
  ],
  systemExpect: ['At most 8 top-level nodes', 'At most 3 levels deep'],
});

definePrompt<{ title: string; context: string; count: number }>({
  id: 'assistant.expand',
  version: 1,
  notes: 'Suggests child nodes for an existing node. Never writes; proposes.',
  system: [
    'You suggest child nodes for one node of a mind map.',
    '',
    'Rules:',
    '- Titles are 1-5 words, noun phrases.',
    '- Suggest only what genuinely belongs under the given node.',
    '- Fewer good suggestions beat a padded list. Returning two is fine.',
    '- Never repeat a title that already exists in the context.',
    '- Output only via the provided tool.',
  ].join('\n'),
  render: ({ title, context, count }) =>
    [
      `Node: ${title}`,
      context ? `Already present: ${context}` : 'No children yet.',
      '',
      `Suggest at most ${count} children.`,
    ].join('\n'),
  fixtures: [
    {
      name: 'names the node and the existing children',
      input: { title: 'Sources', context: 'Books, Papers', count: 5 },
      expect: ['Sources', 'Books, Papers', 'at most 5'],
    },
    {
      name: 'says so plainly when there are no children yet',
      input: { title: 'Sources', context: '', count: 5 },
      expect: ['No children yet'],
    },
  ],
});

definePrompt<{ title: string; body: string }>({
  id: 'assistant.summarise',
  version: 1,
  notes: 'One-sentence summary for a node that has none.',
  system: [
    'You write one factual sentence describing a node in a mind map.',
    '',
    'Rules:',
    '- One sentence, at most 20 words.',
    '- Use only what the provided text says. Never add a claim it does not make.',
    '- If the text is too thin to summarise, say so rather than inventing.',
    '- Output only via the provided tool.',
  ].join('\n'),
  render: ({ title, body }) => [`Node: ${title}`, '', body].join('\n'),
  fixtures: [
    {
      name: 'includes the node title and its text',
      input: { title: 'Prior art', body: 'Everything published before filing.' },
      expect: ['Prior art', 'Everything published before filing.'],
    },
  ],
});
