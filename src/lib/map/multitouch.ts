import type { Camera } from './camera';
import { panBy, zoomAt } from './camera';
import type { Viewport } from './types';
import type { PointerSample } from './pointers';

/**
 * Concurrent multi-touch, for 20/40/60-point boards.
 *
 * ── Why `pointers.ts` is not enough ─────────────────────────────────────────
 *
 * That module tracks pointers by id from the first commit, exactly as §17
 * required, and it handles one person's hand perfectly: one pointer pans, two
 * pinch, a third is ignored. It has ONE `kind`, ONE velocity and ONE camera
 * delta, because it models one gesture at a time.
 *
 * A 20-point board is not one gesture at a time. It is four people standing at
 * a wall, and the thing that breaks first is not the pointer count — it is the
 * assumption that every contact belongs to the same intention. Under
 * `pointers.ts`, person A's finger and person B's finger a metre away become a
 * "pinch", and the map lurches under both of them.
 *
 * ── Contacts are clustered into participants ────────────────────────────────
 *
 * The unit here is a PARTICIPANT: a cluster of contacts close enough together
 * to plausibly be one person's hand. Each participant runs its own gesture,
 * holds its own selection, and — critically — most of them do not move the
 * camera at all.
 *
 * ── Only one participant may move the camera ────────────────────────────────
 *
 * This is the decision that makes a shared board usable, and it is worth
 * stating loudly because the obvious implementation gets it wrong. If four
 * people can each pan, the map is unusable: every person's frame of reference
 * is destroyed continuously by the other three, and nobody can point at
 * anything. So panning and zooming are held by whoever claimed them first, and
 * everybody else's contacts drag NODES — which is a per-object action that
 * genuinely can happen in parallel.
 *
 * The camera is shared state. Node positions are not. That asymmetry is the
 * whole design.
 *
 * ── On §17's "selection state is a set, not a scalar" ───────────────────────
 *
 * The MVP roadmap listed that as one of three decisions taken to make this
 * phase cheap. It was not honoured — `useMapState` has a scalar `selectedId`,
 * and 89 call sites across 15 files read it.
 *
 * A flat `Set<string>` would not have been the right answer anyway. On a board
 * with four people it tells you WHICH nodes are selected and not BY WHOM, and
 * "by whom" is the only part that matters: two people must not fight over one
 * detail panel. What is implemented here is a selection per participant, which
 * is what a set was reaching for. The single-pointer path stays exactly as it
 * is — one participant, one selection, no change to any of those 89 call sites.
 */

/**
 * How far apart two contacts can be and still be one person's hand.
 *
 * A hand span is roughly 200mm. On a large board this is device pixels, so it
 * is scaled by the display's pixel density at the call site — see
 * `lib/display/surfaces.ts`, which knows the physical size and cannot be
 * guessed at from here.
 *
 * Too small and one person's spread thumb and little finger become two
 * participants, which turns their pinch into two fights over the camera. Too
 * large and two people standing shoulder to shoulder merge into one, which is
 * worse: their contacts pinch against each other.
 */
export const HAND_SPAN_PX = 320;

/** Contacts beyond this in one cluster are a palm or a sleeve, not fingers. */
export const MAX_CONTACTS_PER_PARTICIPANT = 5;

/**
 * A contact bigger than this is a palm resting on the board.
 *
 * `PointerEvent.width`/`height` are reported in CSS pixels by touch hardware
 * that measures contact area. Rejecting palms matters more here than on a
 * phone: people lean on a wall-sized display, and a forearm laid across it
 * would otherwise be a dozen contacts starting a dozen gestures.
 */
export const PALM_CONTACT_PX = 45;

export type ParticipantGesture = 'idle' | 'camera-pan' | 'camera-pinch' | 'drag';

export interface Contact extends PointerSample {
  /** 'touch' | 'pen' | 'mouse'. Pen never merges into a hand cluster. */
  type: string;
  /** Contact width in CSS pixels, when the hardware reports it. */
  size: number;
}

export interface Participant {
  id: number;
  contacts: Map<number, Contact>;
  origins: Map<number, Contact>;
  gesture: ParticipantGesture;
  /** The node this participant is working with. Null when they have none. */
  selectedId: string | null;
  /** Set while dragging a node, so the drag survives the finger moving fast. */
  draggingId: string | null;
  pinchStartDistance: number;
  pinchStartScale: number;
  lastCentroid: { x: number; y: number } | null;
}

export interface BoardState {
  participants: Map<number, Participant>;
  /** Which pointer id belongs to which participant. */
  ownerOf: Map<number, number>;
  /**
   * The participant currently allowed to move the camera, or null.
   *
   * First claim wins and holds it until every one of their contacts lifts.
   * Not "most recent" — that would let a passer-by steal the view from
   * somebody mid-gesture, which is the single most irritating thing a shared
   * board can do.
   */
  cameraOwner: number | null;
  /** Contacts rejected as palms, remembered so their moves stay ignored. */
  rejected: Set<number>;
  nextParticipantId: number;
  handSpan: number;
}

export function createBoardState(handSpan = HAND_SPAN_PX): BoardState {
  return {
    participants: new Map(),
    ownerOf: new Map(),
    cameraOwner: null,
    rejected: new Set(),
    nextParticipantId: 1,
    handSpan,
  };
}

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(contacts: Iterable<Contact>): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let count = 0;

  for (const contact of contacts) {
    x += contact.x;
    y += contact.y;
    count += 1;
  }

  return count === 0 ? null : { x: x / count, y: y / count };
}

/**
 * Which existing participant, if any, this contact belongs to.
 *
 * Nearest centroid within a hand span. A pen is never merged: a stylus and a
 * hand resting beside it are two intentions, and a pen is precise enough that
 * treating it as part of a pinch destroys the one gesture it is good at.
 */
function findParticipant(state: BoardState, contact: Contact): Participant | null {
  if (contact.type === 'pen') return null;

  let best: Participant | null = null;
  let bestDistance = state.handSpan;

  for (const participant of state.participants.values()) {
    if (participant.contacts.size >= MAX_CONTACTS_PER_PARTICIPANT) continue;

    const centre = centroid(participant.contacts.values());
    if (!centre) continue;

    const gap = distance(centre, contact);
    if (gap <= bestDistance) {
      bestDistance = gap;
      best = participant;
    }
  }

  return best;
}

export interface DownResult {
  participant: Participant;
  /** False when the contact was rejected as a palm. */
  accepted: boolean;
  /** True when this participant just took the camera. */
  claimedCamera: boolean;
}

export function onContactDown(state: BoardState, contact: Contact): DownResult {
  /*
   * Palm rejection happens before anything else, and the contact id is
   * REMEMBERED rather than merely dropped. A palm produces move events for as
   * long as the arm rests there, and a check that only ran on the down event
   * would let every one of those moves through.
   */
  if (contact.type === 'touch' && contact.size > PALM_CONTACT_PX) {
    state.rejected.add(contact.id);

    return {
      participant: emptyParticipant(0),
      accepted: false,
      claimedCamera: false,
    };
  }

  const existing = findParticipant(state, contact);

  const participant =
    existing ??
    (() => {
      const created = emptyParticipant(state.nextParticipantId);
      state.nextParticipantId += 1;
      state.participants.set(created.id, created);
      return created;
    })();

  participant.contacts.set(contact.id, contact);
  participant.origins.set(contact.id, contact);
  participant.lastCentroid = centroid(participant.contacts.values());

  state.ownerOf.set(contact.id, participant.id);

  let claimedCamera = false;

  /*
   * The camera goes to the first participant who asks and is not already
   * dragging a node. Somebody who put a finger on a node wanted the node, not
   * the view — promoting them to camera owner would mean their drag scrolled
   * the map instead of moving the thing they touched.
   */
  if (state.cameraOwner === null && participant.draggingId === null) {
    state.cameraOwner = participant.id;
    claimedCamera = true;
  }

  if (state.cameraOwner === participant.id) {
    participant.gesture =
      participant.contacts.size >= 2 ? 'camera-pinch' : 'camera-pan';

    if (participant.gesture === 'camera-pinch') {
      const [a, b] = [...participant.contacts.values()];
      participant.pinchStartDistance = a && b ? distance(a, b) : 0;
    }
  } else {
    participant.gesture = 'idle';
  }

  return { participant, accepted: true, claimedCamera };
}

function emptyParticipant(id: number): Participant {
  return {
    id,
    contacts: new Map(),
    origins: new Map(),
    gesture: 'idle',
    selectedId: null,
    draggingId: null,
    pinchStartDistance: 0,
    pinchStartScale: 1,
    lastCentroid: null,
  };
}

export interface BoardMoveResult {
  camera: Camera;
  /** Node drags this move produced, one per dragging participant. */
  drags: { participantId: number; nodeId: string; dx: number; dy: number }[];
  active: boolean;
}

/**
 * Apply one contact's movement.
 *
 * Returns node drags as a LIST because several can happen in the same frame:
 * that is the entire point of a multi-touch board, and a signature returning
 * one drag would have made concurrency impossible to express.
 */
export function onContactMove(
  state: BoardState,
  contact: Contact,
  camera: Camera,
  viewport: Viewport,
): BoardMoveResult {
  const idle: BoardMoveResult = { camera, drags: [], active: false };

  // A palm keeps producing moves for as long as the arm rests there.
  if (state.rejected.has(contact.id)) return idle;

  const participantId = state.ownerOf.get(contact.id);
  if (participantId === undefined) return idle;

  const participant = state.participants.get(participantId);
  if (!participant) return idle;

  const previous = participant.contacts.get(contact.id);
  if (!previous) return idle;

  participant.contacts.set(contact.id, contact);

  // ---- dragging a node: parallel, and never touches the camera ------------

  if (participant.draggingId) {
    return {
      camera,
      drags: [
        {
          participantId: participant.id,
          nodeId: participant.draggingId,
          // World units, so a drag moves the node under the finger whatever
          // the zoom.
          dx: (contact.x - previous.x) / camera.scale,
          dy: (contact.y - previous.y) / camera.scale,
        },
      ],
      active: true,
    };
  }

  // ---- the camera: exactly one participant, or nobody --------------------

  if (state.cameraOwner !== participant.id) {
    /*
     * Somebody else holds the camera. This contact is not ignored — it may be
     * about to press a node — but it moves nothing. Returning `active: false`
     * keeps the renderer's `flat` optimisation off for a contact that is not
     * animating anything.
     */
    return idle;
  }

  if (participant.gesture === 'camera-pinch' && participant.contacts.size >= 2) {
    const [a, b] = [...participant.contacts.values()];
    if (!a || !b || participant.pinchStartDistance <= 0)
      return { ...idle, active: true };

    const ratio = distance(a, b) / participant.pinchStartDistance;
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    return {
      camera: zoomAt(
        camera,
        participant.pinchStartScale * ratio,
        centre.x,
        centre.y,
        viewport,
      ),
      drags: [],
      active: true,
    };
  }

  if (participant.gesture === 'camera-pan') {
    /*
     * Panned by the CENTROID's movement, not by one contact's.
     *
     * With several contacts in a hand, following any single one makes the map
     * jitter as fingers settle independently. The centroid is what the hand as
     * a whole is doing, and it is stable while individual fingers are not.
     */
    const centre = centroid(participant.contacts.values());
    const last = participant.lastCentroid;
    participant.lastCentroid = centre;

    if (!centre || !last) return { ...idle, active: true };

    return {
      camera: panBy(camera, centre.x - last.x, centre.y - last.y),
      drags: [],
      active: true,
    };
  }

  return { ...idle, active: true };
}

export interface BoardUpResult {
  /** True when this contact went down and up without meaningful movement. */
  wasTap: boolean;
  tapPoint: { x: number; y: number } | null;
  participantId: number | null;
  /** True when the camera became free for somebody else to claim. */
  releasedCamera: boolean;
}

export const TAP_SLOP_PX = 12;

export function onContactUp(state: BoardState, contact: Contact): BoardUpResult {
  if (state.rejected.delete(contact.id)) {
    return {
      wasTap: false,
      tapPoint: null,
      participantId: null,
      releasedCamera: false,
    };
  }

  const participantId = state.ownerOf.get(contact.id);
  state.ownerOf.delete(contact.id);

  if (participantId === undefined) {
    return {
      wasTap: false,
      tapPoint: null,
      participantId: null,
      releasedCamera: false,
    };
  }

  const participant = state.participants.get(participantId);
  if (!participant) {
    return {
      wasTap: false,
      tapPoint: null,
      participantId: null,
      releasedCamera: false,
    };
  }

  const origin = participant.origins.get(contact.id);
  participant.contacts.delete(contact.id);
  participant.origins.delete(contact.id);

  const travelled = origin ? distance(origin, contact) : Infinity;
  const wasTap = travelled <= TAP_SLOP_PX && participant.draggingId === null;

  let releasedCamera = false;

  if (participant.contacts.size === 0) {
    /*
     * The participant is gone, and the camera is released — but only when
     * ALL their contacts have lifted. Releasing on the first lift would hand
     * the camera to somebody else mid-pinch.
     */
    state.participants.delete(participant.id);
    participant.draggingId = null;

    if (state.cameraOwner === participant.id) {
      state.cameraOwner = null;
      releasedCamera = true;

      // Whoever is already on the board and not dragging inherits it, so the
      // next pan does not need a fresh touch to work.
      for (const candidate of state.participants.values()) {
        if (candidate.draggingId === null) {
          state.cameraOwner = candidate.id;
          candidate.gesture =
            candidate.contacts.size >= 2 ? 'camera-pinch' : 'camera-pan';
          break;
        }
      }
    }
  } else if (state.cameraOwner === participant.id) {
    // Dropping from a pinch to a pan on the remaining fingers, rather than
    // ending the gesture and stranding the map mid-zoom.
    participant.gesture =
      participant.contacts.size >= 2 ? 'camera-pinch' : 'camera-pan';
    participant.lastCentroid = centroid(participant.contacts.values());

    if (participant.gesture === 'camera-pinch') {
      const [a, b] = [...participant.contacts.values()];
      participant.pinchStartDistance = a && b ? distance(a, b) : 0;
    }
  }

  return {
    wasTap,
    tapPoint: wasTap ? { x: contact.x, y: contact.y } : null,
    participantId: participant.id,
    releasedCamera,
  };
}

export function onContactCancel(state: BoardState, pointerId: number): void {
  state.rejected.delete(pointerId);

  const participantId = state.ownerOf.get(pointerId);
  state.ownerOf.delete(pointerId);

  if (participantId === undefined) return;

  const participant = state.participants.get(participantId);
  if (!participant) return;

  participant.contacts.delete(pointerId);
  participant.origins.delete(pointerId);

  if (participant.contacts.size === 0) {
    state.participants.delete(participant.id);
    if (state.cameraOwner === participant.id) state.cameraOwner = null;
  }
}

/**
 * Start dragging a node with a participant's contact.
 *
 * Called after a hit test, by the component that knows what is under the
 * finger. A participant who starts dragging gives up the camera, so their pan
 * does not scroll the map out from under the node they are holding.
 */
export function beginDrag(
  state: BoardState,
  participantId: number,
  nodeId: string,
): void {
  const participant = state.participants.get(participantId);
  if (!participant) return;

  participant.draggingId = nodeId;
  participant.selectedId = nodeId;
  participant.gesture = 'drag';

  if (state.cameraOwner === participantId) {
    state.cameraOwner = null;

    for (const candidate of state.participants.values()) {
      if (candidate.id !== participantId && candidate.draggingId === null) {
        state.cameraOwner = candidate.id;
        candidate.gesture =
          candidate.contacts.size >= 2 ? 'camera-pinch' : 'camera-pan';
        break;
      }
    }
  }
}

export function setSelection(
  state: BoardState,
  participantId: number,
  nodeId: string | null,
): void {
  const participant = state.participants.get(participantId);
  if (participant) participant.selectedId = nodeId;
}

/**
 * Every node currently claimed by somebody, and by whom.
 *
 * The renderer draws a participant-coloured ring around each, which is what
 * lets four people at a wall see whose is whose. A flat set of ids could not
 * express that — the reason a per-participant map is the right shape and a
 * `Set<string>` was not.
 */
export function claimedNodes(state: BoardState): Map<string, number> {
  const claimed = new Map<string, number>();

  for (const participant of state.participants.values()) {
    if (participant.selectedId) claimed.set(participant.selectedId, participant.id);
  }

  return claimed;
}

/** How many people appear to be at the board. Drives the presence strip. */
export function participantCount(state: BoardState): number {
  return state.participants.size;
}

/** Total live contacts. A 60-point board should report up to 60. */
export function contactCount(state: BoardState): number {
  let total = 0;
  for (const participant of state.participants.values()) {
    total += participant.contacts.size;
  }
  return total;
}
