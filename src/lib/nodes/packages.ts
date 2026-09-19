import { z } from 'zod';
import { defineNodeType, type NodeAction } from './define';

/**
 * Commerce, CRM and project management, as node types.
 *
 * ── Why these are not three applications ────────────────────────────────────
 *
 * The instinct is to build a CRM: a contacts table, a deals table, a pipeline
 * screen, a permission model. Then a project manager: a tasks table, a board.
 * Then commerce. Three schemas, three UIs, three sets of sharing rules, and a
 * user who now has four places to look for one piece of work.
 *
 * But everything those applications need already exists here. A contact IS a
 * node — it has a title, a description, a place in a graph, a payload, an
 * owner, comments, permissions, history, search, and typed edges to anything
 * else. Building a contacts table would mean rebuilding all of that, worse,
 * beside itself.
 *
 * So a "CRM" here is three node types and the map you already have. The deal
 * connects to the contact with an ordinary edge; the task connects to the
 * deal; the order connects to the product. Nothing needed a table, and nothing
 * outside this file changed — which is the claim `packages.test.ts` checks by
 * going through the ordinary registry functions rather than any of these.
 *
 * ── This also closes a debt item ────────────────────────────────────────────
 *
 * Part 8 of the audit names it: "the `commerce` family is a colour with no
 * functionality. The palette promises a capability that does not exist."
 * `product`, `order` and `invoice` are that capability.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 *
 * No money is taken, no stock is decremented, no invoice is rendered or sent.
 * These types RECORD commercial facts; moving money is Stripe's job, as
 * migration 16 settled. A node type that quietly grew into a payment processor
 * would be the worst imaginable place to find one.
 */

const OPEN: NodeAction = {
  id: 'open',
  label: 'Open',
  requires: 'view',
  mutates: false,
};

const EDIT: NodeAction = {
  id: 'edit',
  label: 'Edit',
  requires: 'editNodes',
  mutates: true,
};

/**
 * Money is integer cents here too.
 *
 * The same rule as the billing tables, for the same reason, and worth
 * restating because a payload is free-form JSON: nothing structurally prevents
 * `19.99` being written into it except a schema that says otherwise. This is
 * that schema.
 */
const cents = z.number().int().min(0).max(1_000_000_00);

/** ISO 4217, three letters. Not checked against a list — new codes exist. */
const currency = z.string().length(3).optional();

// ------------------------------------------------------------------ commerce

function registerCommerce(): void {
  defineNodeType({
    id: 'product',
    label: 'product',
    description: 'Something you sell, with what it costs.',
    icon: 'bag',
    availability: 'available',
    payload: z
      .object({
        sku: z.string().max(60).optional(),
        priceCents: cents.optional(),
        currency,
        /*
         * Optional, and 0 is a real value.
         *
         * Absent means "we do not track stock for this"; zero means "there are
         * none". Collapsing the two — by defaulting to 0 — would make every
         * untracked product read as out of stock, which is the sort of bug
         * that stops a shop from selling anything.
         */
        stock: z.number().int().min(0).optional(),
        url: z.string().url().max(500).optional(),
      })
      .passthrough(),
    actions: [OPEN, EDIT],
  });

  defineNodeType({
    id: 'order',
    label: 'order',
    description: 'A purchase someone made, and where it has got to.',
    icon: 'card',
    availability: 'available',
    payload: z
      .object({
        reference: z.string().max(80).optional(),
        totalCents: cents.optional(),
        currency,
        /*
         * An enum, unlike a product's free-text availability. Order state
         * drives decisions — has this shipped, should we chase it — and free
         * text makes "Shipped", "shipped" and "sent" three states nobody can
         * count.
         */
        status: z
          .enum(['draft', 'placed', 'paid', 'shipped', 'complete', 'cancelled'])
          .optional(),
        items: z
          .array(
            z.object({
              name: z.string().max(200),
              /*
               * Required, unlike almost everything else here. An order line
               * with no quantity is not a partially filled record — it is one
               * that cannot be totalled, priced or fulfilled.
               */
              quantity: z.number().int().min(1).max(1_000_000),
              unitCents: cents,
            }),
          )
          .max(200)
          .optional(),
        placedAt: z.string().max(40).optional(),
      })
      .passthrough(),
    actions: [OPEN, EDIT],
  });

  defineNodeType({
    id: 'invoice',
    label: 'invoice',
    description: 'What was billed, when, and whether it has been paid.',
    icon: 'file',
    availability: 'available',
    payload: z
      .object({
        reference: z.string().max(80).optional(),
        amountCents: cents.optional(),
        currency,
        status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).optional(),
        dueAt: z.string().max(40).optional(),
        paidAt: z.string().max(40).optional(),
      })
      .passthrough(),
    actions: [OPEN, EDIT],
  });
}

// ----------------------------------------------------------------------- CRM

function registerCrm(): void {
  defineNodeType({
    id: 'contact',
    label: 'contact',
    description: 'A person or company you deal with.',
    icon: 'user',
    availability: 'available',
    payload: z
      .object({
        /*
         * NOT validated as an email address, unlike the enquiry form. That
         * form is a gate — a typo there means a reply that never arrives.
         * This is a note someone is writing about a person they know, and
         * refusing "ask Sam for it" mid-thought is a validator getting in the
         * way of the work it exists to support.
         */
        email: z.string().max(200).optional(),
        phone: z.string().max(40).optional(),
        company: z.string().max(120).optional(),
        role: z.string().max(80).optional(),
        lastContactedAt: z.string().max(40).optional(),
      })
      .passthrough(),
    actions: [OPEN, EDIT],
  });

  defineNodeType({
    id: 'deal',
    label: 'deal',
    description: 'A piece of work you hope to win, and what it is worth.',
    icon: 'spark',
    availability: 'available',
    payload: z
      .object({
        /*
         * The SAME six stages as `lib/services/pipeline.ts`.
         *
         * Declared again rather than imported, because that module is
         * `server-only` and this registry is evaluated on both sides. Two
         * vocabularies for one idea is a genuine cost; what makes the
         * duplication safe is the assertion in `packages.test.ts` that walks
         * every pipeline stage through this schema, so drift fails a test
         * instead of waiting to be noticed.
         */
        stage: z
          .enum(['lead', 'contacted', 'qualified', 'quoted', 'won', 'lost'])
          .optional(),
        valueCents: cents.optional(),
        currency,
        /*
         * A whole percentage, 0–100. Integer on purpose: a forecast expressed
         * to four decimal places is false precision, and half the codebase
         * writing 0.6 while the other half writes 60 is the ambiguity this
         * removes.
         */
        probability: z.number().int().min(0).max(100).optional(),
        closeBy: z.string().max(40).optional(),
      })
      .passthrough(),
    actions: [
      OPEN,
      EDIT,
      /*
       * Its own verb, rather than being buried inside "edit".
       *
       * Moving a deal along is the operation people actually perform, many
       * times a day. Making them open a form to do it is how a CRM ends up
       * unused and the real pipeline goes back to living in someone's head.
       */
      { id: 'advance', label: 'Move stage', requires: 'editNodes', mutates: true },
    ],
  });
}

// ------------------------------------------------------- project management

function registerProjects(): void {
  defineNodeType({
    id: 'task',
    label: 'task',
    description: 'Something to do, and who is doing it.',
    icon: 'note',
    availability: 'available',
    payload: z
      .object({
        status: z.enum(['todo', 'doing', 'blocked', 'done']).optional(),
        /** A handle, not a user id: work is often assigned to someone with no account. */
        assignee: z.string().max(80).optional(),
        dueAt: z.string().max(40).optional(),
        /*
         * Three levels, not five. A five-point priority scale collapses to
         * "urgent" and "everything else" within a month of real use, and the
         * three middle values become a way to avoid deciding.
         */
        priority: z.enum(['low', 'normal', 'high']).optional(),
        estimateHours: z.number().min(0).max(10_000).optional(),
      })
      .passthrough(),
    actions: [
      OPEN,
      EDIT,
      { id: 'complete', label: 'Mark done', requires: 'editNodes', mutates: true },
    ],
  });

  defineNodeType({
    id: 'milestone',
    label: 'milestone',
    description: 'A date a group of work has to be finished by.',
    icon: 'cal',
    availability: 'available',
    payload: z
      .object({
        dueAt: z.string().max(40).optional(),
        status: z.enum(['upcoming', 'at-risk', 'met', 'missed']).optional(),
      })
      .passthrough(),
    actions: [OPEN, EDIT],
  });
}

export const COMMERCE_TYPES = ['product', 'order', 'invoice'] as const;
export const CRM_TYPES = ['contact', 'deal'] as const;
export const PROJECT_TYPES = ['task', 'milestone'] as const;

/**
 * Every type these packages contribute.
 *
 * Listed explicitly rather than derived from the registry, so a type
 * accidentally dropped from a register function fails a test rather than
 * quietly shrinking the list it was meant to be in.
 */
export const PACKAGE_TYPES = [
  ...COMMERCE_TYPES,
  ...CRM_TYPES,
  ...PROJECT_TYPES,
] as const;

/**
 * Register all three packages.
 *
 * A FUNCTION rather than top-level calls, and this is the reason: registering
 * on import would make this module depend on the registry's module-level state
 * being initialised, and the registry imports this file. `define.ts` exists to
 * break that cycle — the shared state lives there, both sides import it, and
 * `registry.ts` calls this at the bottom of its own evaluation when everything
 * it needs is ready.
 *
 * Idempotent: `defineNodeType` replaces by id, so calling twice — which Next.js
 * will do across dev reloads and route workers — registers once.
 */
export function registerPackages(): void {
  registerCommerce();
  registerCrm();
  registerProjects();
}
