import 'server-only';
import { randomUUID } from 'node:crypto';
import { createMap, getMap } from '@/lib/db/repo';
import { defineKind, type FulfilContext, type FulfilResult } from './kinds';

/**
 * The four catalogues.
 *
 * Each one is a target check and a delivery. Everything else — review,
 * publication, pricing, ordering, rating, moderation — is `repo.ts`, shared.
 */

// ------------------------------------------------------------------ templates

/**
 * A template is a MAP the author owns, sold as a starting point.
 *
 * Buying it COPIES the map into the buyer's account. It does not share the
 * author's map: a shared map is a live document two people edit, and a
 * template is a snapshot the buyer then owns and diverges from. Confusing the
 * two would mean an author editing their template silently rewriting the work
 * of everyone who ever bought it.
 */
defineKind({
  kind: 'template',
  label: 'Templates',
  blurb: 'Maps built by other people, ready to make your own.',

  ownsTarget(ctx, targetId, db) {
    const map = getMap(ctx, targetId, db);
    /*
     * `canEdit` rather than mere visibility. `getMap` returns any map the
     * caller may SEE, which includes public maps belonging to strangers —
     * listing one of those as your own template is exactly the theft this
     * check exists to prevent.
     */
    return Boolean(map?.canEdit);
  },

  fulfil(ctx: FulfilContext): FulfilResult {
    /*
     * Read as the AUTHOR, write as the BUYER.
     *
     * The buyer usually cannot see the source map — a template is very often a
     * private map its owner chose to sell — so reading it with the buyer's
     * context would find nothing. Reading as the author is safe here and only
     * here, because `ownsTarget` has just confirmed the author still holds it
     * and the only thing that escapes is the copy the author put up for sale.
     */
    const source = getMap(
      { userId: ctx.authorId, isStaff: false },
      ctx.targetId,
      ctx.db,
    );
    if (!source)
      return { ok: false, error: 'That template is no longer available' };

    const mapId = `map_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    /*
     * Every node id is rewritten.
     *
     * Node ids are global, not per-map, so copying them verbatim would make
     * two maps claim the same rows the moment anything looked a node up by id
     * alone. The parent pointers are remapped through the same table.
     */
    const idMap = new Map<string, string>();
    for (const nodeId of Object.keys(source.nodes)) {
      idMap.set(nodeId, `nod_${randomUUID().replace(/-/g, '').slice(0, 20)}`);
    }

    const nodes: typeof source.nodes = {};

    for (const [oldId, node] of Object.entries(source.nodes)) {
      const newId = idMap.get(oldId)!;
      nodes[newId] = {
        ...node,
        id: newId,
        parent_id: node.parent_id ? (idMap.get(node.parent_id) ?? null) : null,
      };
    }

    createMap(
      ctx.buyer,
      {
        ...source,
        id: mapId,
        title: ctx.title.slice(0, 120),
        rootId: idMap.get(source.rootId) ?? source.rootId,
        nodes,
        /*
         * Private, always, whatever the original was.
         *
         * A copy that inherited `public` would publish the buyer's new map the
         * instant they bought it, before they had looked at it. Visibility is
         * a decision, and it is theirs to make.
         */
        visibility: 'private',
        version: 1,
        dirty: [],
        metaDirty: false,
      },
      ctx.db,
    );

    return { ok: true, resultId: mapId };
  },
});

// -------------------------------------------------------------------- plugins

/**
 * A plugin listing points at a plugin the author published.
 *
 * ── Why ordering does not install ───────────────────────────────────────────
 *
 * Installing grants permissions, and permissions need consent — a screen
 * showing precisely what the plugin asked for, and a person agreeing to it.
 * Fulfilling an order by installing would mean a purchase silently handing a
 * third party access to the buyer's maps, which is the one thing the whole
 * scope design exists to prevent.
 *
 * So the order records entitlement, and the buyer installs afterwards with the
 * consent screen in front of them. The result id is the plugin's, which is
 * what the UI needs to send them there.
 */
defineKind({
  kind: 'plugin',
  label: 'Plugins',
  blurb: 'Extensions that add node types and connect other services.',

  ownsTarget(ctx, targetId, db) {
    const row = db
      .prepare('SELECT author_id, status FROM plugins WHERE id = ?')
      .get(targetId) as { author_id: string; status: string } | undefined;

    if (!row || row.author_id !== ctx.userId) return false;

    // A suspended plugin cannot be sold. Suspension is how a plugin that
    // turned out to be abusive is stopped, and a live listing would undo it.
    return row.status !== 'suspended';
  },

  fulfil(ctx: FulfilContext): FulfilResult {
    return { ok: true, resultId: ctx.targetId };
  },
});

// --------------------------------------------------------------------- agents

/**
 * An agent listing sells an agent's DEFINITION — its name and instructions.
 *
 * Not its runs, not its memory, and not its tool grants. Tool grants are
 * authority the author holds on the author's own maps; copying them across
 * would hand a stranger's agent permissions on the buyer's data that nobody
 * consented to. The buyer grants tools themselves, on their own map, after the
 * copy lands.
 */
defineKind({
  kind: 'agent',
  label: 'Agents',
  blurb: 'Ready-made agents you can point at your own maps.',

  ownsTarget(ctx, targetId, db) {
    const row = db
      .prepare('SELECT owner_id FROM agents WHERE id = ?')
      .get(targetId) as { owner_id: string } | undefined;

    return row?.owner_id === ctx.userId;
  },

  fulfil(ctx: FulfilContext): FulfilResult {
    const source = ctx.db
      .prepare('SELECT name, instructions FROM agents WHERE id = ?')
      .get(ctx.targetId) as { name: string; instructions: string } | undefined;

    if (!source) return { ok: false, error: 'That agent is no longer available' };

    /*
     * The definition is stored as a purchase, not attached to a node.
     *
     * An `agents` row needs a node id, and the buyer has not chosen one — the
     * whole point is that they will point it at a map of their own. Creating a
     * node on their behalf would put an unexplained circle on a map they did
     * not ask us to touch. So the order carries the definition, and the buyer
     * creates the agent from it when they pick a node.
     */
    const id = `agd_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    ctx.db
      .prepare(
        `INSERT INTO events (id, type, actor_id, subject_type, subject_id, payload)
         VALUES (?, 'agent.purchased', ?, 'listing', ?, ?)`,
      )
      .run(
        id,
        ctx.buyer.userId,
        ctx.listingId,
        JSON.stringify({ name: source.name, instructions: source.instructions }),
      );

    return { ok: true, resultId: id };
  },
});

// ---------------------------------------------------------------- freelancing

/**
 * A freelancing listing is a person offering their time.
 *
 * ── Ordering creates an ENQUIRY, in the existing pipeline ───────────────────
 *
 * Not a second messaging system, not a separate deals table. The professional
 * services pipeline already exists, already has stages, ownership, quotes and
 * follow-ups, and is already the thing somebody looks at each morning. A
 * marketplace order that landed anywhere else would be work nobody sees.
 *
 * The target is the author's own user id — a person cannot list somebody else
 * as available for hire.
 */
defineKind({
  kind: 'freelancing',
  label: 'Freelancers',
  blurb: 'People available for work, with what they do and what it costs.',

  ownsTarget(ctx, targetId) {
    return Boolean(ctx.userId) && targetId === ctx.userId;
  },

  fulfil(ctx: FulfilContext): FulfilResult {
    const buyer = ctx.db
      .prepare('SELECT email, display_name FROM users WHERE id = ?')
      .get(ctx.buyer.userId) as { email: string; display_name: string } | undefined;

    if (!buyer) return { ok: false, error: 'Sign in first' };

    /*
     * The row is written directly rather than through `submitEnquiry`.
     *
     * That function is the PUBLIC FORM's entry point, and everything it does
     * beyond the insert is wrong here: it resolves the slug against the
     * studio's service catalogue (a marketplace listing is not in it, so the
     * call is simply refused), it scores the submission for spam using signals
     * a form produces and a purchase does not, and it consumes the anonymous
     * rate limit keyed on a client hash this caller has no reason to have.
     *
     * The first attempt DID call it, and every freelancing order failed with
     * "Unknown service" — which is the catalogue check doing its job on input
     * that should never have reached it.
     *
     * What matters is that the row lands in `enquiries`, because that is what
     * the pipeline reads. It does.
     */
    const enquiryId = `enq_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    ctx.db
      .prepare(
        `INSERT INTO enquiries
           (id, service_slug, name, email, company, budget, message, user_id,
            client_hash, status, stage, owner_id)
         VALUES (@id, @slug, @name, @email, '', '', @message, @userId,
                 '', 'new', 'lead', @ownerId)`,
      )
      .run({
        id: enquiryId,
        // Namespaced so the pipeline can tell a marketplace order from a
        // studio enquiry, and can link back to the listing it came from.
        slug: `marketplace:${ctx.listingId}`,
        name: buyer.display_name,
        email: buyer.email,
        message: `Marketplace enquiry about "${ctx.title}".`,
        userId: ctx.buyer.userId,
        /*
         * Owned by the FREELANCER, so it appears in their pipeline rather
         * than the studio's general inbox. Assigning at creation rather than
         * leaving it unowned means nobody has to notice and route it.
         */
        ownerId: ctx.authorId,
      });

    return { ok: true, resultId: enquiryId };
  },
});

/**
 * Importing this module is what registers the four adapters.
 *
 * Exported so a caller can be explicit about needing them — an import purely
 * for a side effect is easy to delete by accident, and the marketplace would
 * then report every catalogue as unknown.
 */
export function ensureCatalogues(): number {
  return 4;
}
