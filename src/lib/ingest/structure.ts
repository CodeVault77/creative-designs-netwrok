import { z } from 'zod';
import { toolCall } from '@/lib/ai/gateway';
import { renderPrompt } from '@/lib/ai/prompts';
import { THIN_WORD_COUNT, type ExtractedPage, type Heading } from './extract';
import {
  MAX_CHILDREN,
  MAX_DEPTH,
  MAX_NODES,
  atDepth,
  countNodes,
  type StructuredNode,
} from './tree';

/**
 * Turning a page into a node tree.
 *
 * Two paths, and the order matters:
 *
 *   1. `structureFromHeadings` — deterministic, free, instant. A well-marked-up
 *      page already contains its own outline, and using it is better than
 *      asking a model to reproduce it.
 *   2. `structureWithModel` — one structured call, for pages whose headings are
 *      absent or useless.
 *
 * The deterministic path is not a degraded fallback, it is the preferred path.
 * That is a cost decision (§20 rates "LLM cost per run" High) and a quality
 * one: a model asked to restructure a clean outline mostly paraphrases it,
 * adding latency and a chance of invention.
 */

/*
 * Re-exported from `./tree`, which owns them.
 *
 * They live there because a client component needs them and this module
 * imports the AI gateway, which is `server-only` — see the comment in
 * `tree.ts`. Re-exporting means every existing server-side import of
 * `structure.ts` kept working unchanged.
 */
export {
  MAX_CHILDREN,
  MAX_DEPTH,
  MAX_NODES,
  atDepth,
  countNodes,
  type StructuredNode,
};

export interface StructureResult {
  title: string;
  root: StructuredNode;
  /** Which path produced this. Surfaced in the UI and logged for tuning. */
  source: 'headings' | 'model' | 'stub';
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * The shape the model must return. Validated, not trusted — a model that
 * returns 400 nodes or nests fifteen deep must fail closed into the
 * deterministic path rather than produce an unusable map.
 */
/**
 * The input shape differs from the output: `summary` and `children` carry
 * defaults, so they are optional going in and always present coming out.
 * Spelling both out is what lets the recursive `z.lazy` typecheck.
 */
interface StructuredNodeInput {
  title: string;
  summary?: string;
  children?: StructuredNodeInput[];
}

const nodeSchema: z.ZodType<StructuredNode, z.ZodTypeDef, StructuredNodeInput> =
  z.lazy(() =>
    z.object({
      title: z.string().min(1).max(80),
      summary: z.string().max(240).default(''),
      children: z.array(nodeSchema).max(MAX_CHILDREN).default([]),
    }),
  );

export const structureSchema = z.object({
  title: z.string().min(1).max(120),
  nodes: z.array(nodeSchema).min(1).max(MAX_CHILDREN),
});

// --------------------------------------------------------------- deterministic

/**
 * Build a tree from the heading hierarchy.
 *
 * Headings in the wild are not well nested — an h3 often follows an h1 with no
 * h2 between. Rather than trusting levels absolutely, the walk keeps a stack
 * and attaches each heading to the nearest shallower ancestor, which is what a
 * reader infers anyway.
 */
export function structureFromHeadings(page: ExtractedPage): StructureResult | null {
  const usable = page.headings.filter((h) => h.level >= 1 && h.level <= 4);
  if (usable.length < 3) return null;

  // A page whose headings are all the same level has a flat outline, which is
  // fine — it becomes one ring.
  const root: StructuredNode = {
    title: page.title,
    // Clamped to the node model's description cap. `extract` keeps 400
    // characters of og:description for its own use; a node stores 240, and
    // handing the extra 160 downstream made the save route reject the whole
    // map over a field nobody had typed.
    summary: page.description.slice(0, 240),
    children: [],
  };

  const stack: { level: number; node: StructuredNode }[] = [
    { level: 0, node: root },
  ];
  let count = 0;

  for (const heading of usable) {
    if (count >= MAX_NODES) break;

    while (stack.length > 1 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!;

    // Depth guard: the root is depth 0, so a node at stack depth MAX_DEPTH is
    // as deep as we go. Deeper headings collapse onto their parent.
    if (stack.length > MAX_DEPTH) {
      stack.pop();
      continue;
    }
    if (parent.node.children.length >= MAX_CHILDREN) continue;

    const node: StructuredNode = {
      title: heading.text.slice(0, 80),
      summary: heading.blurb.slice(0, 240),
      children: [],
    };
    parent.node.children.push(node);
    stack.push({ level: heading.level, node });
    count++;
  }

  /**
   * Collapse a lone h1 into the root.
   *
   * This is the commonest shape on the web by a wide margin: one h1 carrying
   * the page title, then h2 sections beneath it. Left alone it produces a
   * root whose only child repeats the map's own name, and every real section
   * is pushed a ring outwards for no reason.
   *
   * Worth stating plainly because the first version of this function rejected
   * that shape outright as "not enough structure" and sent the most
   * well-formed pages on the internet down the paid model path.
   */
  if (root.children.length === 1 && root.children[0]!.children.length > 0) {
    const only = root.children[0]!;
    root.children = only.children;
    if (!root.summary) root.summary = only.summary;
  }

  if (root.children.length < 2) return null;

  return { title: page.title, root, source: 'headings' };
}

/**
 * §12: "Too thin — 'Not much text to work with — here's a starter map
 * instead,' delivering a 3-node stub rather than nothing."
 *
 * Delivering *something* is the whole point: the user pasted a link and
 * pressed a button, and an empty screen reads as a bug regardless of the
 * message above it.
 */
export function starterStub(page: ExtractedPage, url: string): StructureResult {
  const host = safeHost(url);
  return {
    title: page.title || host,
    source: 'stub',
    root: {
      title: page.title || host,
      summary: (page.description || `From ${host}`).slice(0, 240),
      children: [
        { title: 'Key ideas', summary: 'What this page is about.', children: [] },
        { title: 'Questions', summary: 'What to find out next.', children: [] },
        { title: 'Related', summary: 'Links and sources to add.', children: [] },
      ],
    },
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'this page';
  }
}

export function isThin(page: ExtractedPage): boolean {
  return page.wordCount < THIN_WORD_COUNT;
}

// ---------------------------------------------------------------------- model

export class ModelError extends Error {
  constructor(
    readonly kind: 'timeout' | 'refused' | 'invalid' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/**
 * Prices per million tokens. Used for the spend cap, so they are deliberately
 * a small overestimate — running slightly under budget is a rounding error,
 * running over is a bill.
 */
export const PRICE_PER_MTOK = { input: 3, output: 15 };

export function costOf(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICE_PER_MTOK.input +
    (outputTokens / 1_000_000) * PRICE_PER_MTOK.output
  );
}

/**
 * How much of the page the model is allowed to see.
 *
 * The cap is a cost control first: input tokens are the bulk of the spend on a
 * long article, and the top of a page carries almost all of its structure.
 */
export const MAX_INPUT_CHARS = 12000;

export function buildPrompt(page: ExtractedPage, url: string): string {
  const outline = page.headings
    .slice(0, 60)
    .map(
      (h) =>
        `${'#'.repeat(h.level)} ${h.text}${h.blurb ? ` — ${h.blurb.slice(0, 160)}` : ''}`,
    )
    .join('\n');

  const body = page.text.slice(0, MAX_INPUT_CHARS - outline.length - 500);

  return [
    `Source URL: ${url}`,
    `Page title: ${page.title}`,
    page.description ? `Description: ${page.description}` : '',
    outline ? `\nHeadings found:\n${outline}` : '',
    `\nPage text:\n${body}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/*
 * The system prompt moved to the versioned registry as ingest.structure
 * version 1. It lived here as a module constant, which meant editing it
 * changed model behaviour with nothing recording that anything had changed.
 *
 * MAX_DEPTH and MAX_CHILDREN are still enforced by clampTree below, and the
 * registry prompt still states them to the model — ai.test.ts checks the
 * stated limits and the enforced ones agree.
 */

/** The tool schema, unchanged from the inline version. */
const TOOL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['title', 'nodes'],
  properties: {
    title: { type: 'string', description: 'A short name for the map.' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          children: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title'],
              properties: {
                title: { type: 'string' },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

export interface ModelOptions {
  /*
   * apiKey and model are no longer read here — the gateway owns both. They
   * remain in the type so the pipeline's call sites are unchanged by this
   * refactor; removing them is a separate, mechanical cleanup.
   */
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Attributes the call and charges it against a quota. */
  userId?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * One structured call.
 *
 * Uses tool-use rather than "reply with JSON", because a tool schema is
 * enforced by the API rather than by hoping. The result is still validated
 * with zod: schema enforcement covers shape, not our own limits.
 */
/**
 * One structured call, through the AI gateway.
 *
 * ── What changed, and what deliberately did not ─────────────────────────────
 *
 * This function used to own the Anthropic URL, the auth header, the API
 * version, the request shape, the response parsing and the error mapping. All
 * of that now lives in `lib/ai/anthropic.ts` behind `AIProvider`, so swapping
 * providers is a config change and every other AI feature inherits the same
 * timeout and 429 handling instead of reimplementing it.
 *
 * What did NOT change is the contract: the same tool schema, the same zod
 * validation afterwards, the same `ModelError` kinds, the same `StructureResult`.
 * The ingest pipeline and its tests are untouched — a refactor that also
 * altered behaviour would make any regression impossible to attribute.
 *
 * The prompt moved to the versioned registry (`ingest.structure`, version 1)
 * with its text unchanged, so the audit trail records which version ran.
 */
export async function structureWithModel(
  page: ExtractedPage,
  url: string,
  options: ModelOptions,
): Promise<StructureResult> {
  const prompt = renderPrompt('ingest.structure', {
    title: page.title,
    url,
    text: buildPrompt(page, url),
  });

  if (!prompt) throw new ModelError('unavailable', 'Structuring is unavailable.');

  const result = await toolCall<unknown>(
    {
      userId: options.userId ?? null,
      feature: 'ingest',
      promptId: 'ingest.structure',
      promptVersion: prompt.version,
    },
    prompt.text,
    {
      name: 'emit_structure',
      description: 'Emit the mind map structure for this page.',
      schema: TOOL_SCHEMA,
    },
    {
      ...(prompt.system ? { system: prompt.system } : {}),
      maxTokens: 2000,
      timeoutMs: options.timeoutMs ?? 20000,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );

  if (!result.ok || !result.value) {
    /*
     * Map the gateway's failure kinds onto this module's, which the pipeline
     * already branches on. Kept as a translation rather than replacing
     * ModelError everywhere: the pipeline's fallback behaviour is tested
     * against these kinds, and changing both at once would be two refactors
     * wearing one commit.
     */
    const kind = result.error?.kind;
    if (kind === 'timeout') {
      throw new ModelError('timeout', 'Structuring took too long.');
    }
    if (kind === 'invalid') {
      throw new ModelError('invalid', 'Structuring took too long.');
    }
    if (kind === 'refused' || kind === 'unconfigured') {
      throw new ModelError('refused', 'Structuring took too long.');
    }
    throw new ModelError(
      'unavailable',
      'Structuring is busy. Try again in a moment.',
    );
  }

  // Schema enforcement covers shape, not our own limits.
  const parsed = structureSchema.safeParse(result.value.input);
  if (!parsed.success) {
    throw new ModelError('invalid', 'Structuring took too long.');
  }

  return {
    title: parsed.data.title,
    source: 'model',
    root: {
      title: parsed.data.title,
      summary: page.description,
      children: clampTree(parsed.data.nodes, 1),
    },
    usage: {
      inputTokens: result.value.usage.inputTokens,
      outputTokens: result.value.usage.outputTokens,
      costUsd: result.value.usage.costUsd,
    },
  };
}

/** Enforce our own depth and breadth limits on whatever came back. */
function clampTree(nodes: StructuredNode[], depth: number): StructuredNode[] {
  if (depth >= MAX_DEPTH) return [];
  return nodes.slice(0, MAX_CHILDREN).map((node) => ({
    title: node.title.slice(0, 80),
    summary: (node.summary ?? '').slice(0, 240),
    children: clampTree(node.children ?? [], depth + 1),
  }));
}

export type { Heading };
