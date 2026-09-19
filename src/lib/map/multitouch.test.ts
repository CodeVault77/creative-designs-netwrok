import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginDrag,
  claimedNodes,
  contactCount,
  createBoardState,
  onContactCancel,
  onContactDown,
  onContactMove,
  onContactUp,
  participantCount,
  setSelection,
  HAND_SPAN_PX,
  MAX_CONTACTS_PER_PARTICIPANT,
  PALM_CONTACT_PX,
  type BoardState,
  type Contact,
} from './multitouch';
import type { Camera } from './camera';

/**
 * Multi-touch board tests.
 *
 * ── The claim under test ────────────────────────────────────────────────────
 *
 * A 20/40/60-point board is four people at a wall, not one person with twenty
 * fingers. Everything below asks whether the model survives that:
 *
 *   clustering    do two people a metre apart stay two people, and does one
 *                 person's spread hand stay one person?
 *   camera        does exactly one participant move the view, so nobody's
 *                 frame of reference is destroyed by somebody else?
 *   parallelism   can several people drag different nodes in the same frame?
 *   palms         does a forearm on the board start nothing?
 */

let state: BoardState;

const camera: Camera = { x: 0, y: 0, scale: 1 };
const viewport = { width: 3840, height: 2160, dpr: 1 };

function touch(
  id: number,
  x: number,
  y: number,
  over: Partial<Contact> = {},
): Contact {
  return { id, x, y, t: 1000 + id, type: 'touch', size: 20, ...over };
}

beforeEach(() => {
  state = createBoardState();
});

// ------------------------------------------------------------- clustering

describe('clustering contacts into people', () => {
  it('treats one hand as one participant', () => {
    // Five fingers spread across a hand span. One person, one gesture.
    onContactDown(state, touch(1, 500, 500));
    onContactDown(state, touch(2, 560, 520));
    onContactDown(state, touch(3, 620, 530));
    onContactDown(state, touch(4, 680, 520));
    onContactDown(state, touch(5, 730, 500));

    expect(participantCount(state)).toBe(1);
    expect(contactCount(state)).toBe(5);
  });

  it('treats two people a metre apart as two participants', () => {
    /*
     * The failure `pointers.ts` has by design: two contacts far apart become
     * a "pinch", and the map lurches under both people at once.
     */
    onContactDown(state, touch(1, 300, 500));
    onContactDown(state, touch(2, 3000, 500));

    expect(participantCount(state)).toBe(2);
  });

  it('joins a contact to the nearest hand, not the first', () => {
    onContactDown(state, touch(1, 300, 500));
    onContactDown(state, touch(2, 3000, 500));
    onContactDown(state, touch(3, 3050, 520));

    expect(participantCount(state)).toBe(2);

    const participants = [...state.participants.values()];
    const far = participants.find((p) => p.contacts.has(2));

    expect(far?.contacts.has(3)).toBe(true);
  });

  it('caps a cluster, so a sleeve does not become one huge hand', () => {
    for (let index = 1; index <= MAX_CONTACTS_PER_PARTICIPANT + 3; index += 1) {
      onContactDown(state, touch(index, 500 + index * 20, 500));
    }

    // The overflow becomes a second participant rather than a hand with
    // eight fingers.
    expect(participantCount(state)).toBeGreaterThan(1);
  });

  it('never merges a pen into a hand', () => {
    // A stylus and a hand resting beside it are two intentions, and treating
    // them as a pinch destroys the one gesture a pen is good at.
    onContactDown(state, touch(1, 500, 500));
    onContactDown(state, touch(2, 520, 510, { type: 'pen', size: 2 }));

    expect(participantCount(state)).toBe(2);
  });

  it('scales the hand span with the display', () => {
    // 200mm is 200mm; on a dense board that is many more pixels.
    const dense = createBoardState(HAND_SPAN_PX * 3);

    onContactDown(dense, touch(1, 500, 500));
    onContactDown(dense, touch(2, 1200, 500));

    expect(participantCount(dense)).toBe(1);
    expect(participantCount(createBoardState())).toBe(0);
  });
});

// ---------------------------------------------------------------- palms

describe('palm rejection', () => {
  it('refuses a large contact', () => {
    const result = onContactDown(
      state,
      touch(1, 500, 500, { size: PALM_CONTACT_PX + 10 }),
    );

    expect(result.accepted).toBe(false);
    expect(participantCount(state)).toBe(0);
  });

  it('keeps ignoring that contact as it moves', () => {
    /*
     * The bug a down-only check has: an arm resting on a board produces move
     * events for as long as it rests there, and every one of them would be
     * let through.
     */
    onContactDown(state, touch(1, 500, 500, { size: PALM_CONTACT_PX + 10 }));

    const moved = onContactMove(
      state,
      touch(1, 900, 900, { size: PALM_CONTACT_PX + 10 }),
      camera,
      viewport,
    );

    expect(moved.camera).toEqual(camera);
    expect(moved.active).toBe(false);
  });

  it('forgets the rejection when the palm lifts', () => {
    onContactDown(state, touch(1, 500, 500, { size: PALM_CONTACT_PX + 10 }));
    onContactUp(state, touch(1, 500, 500, { size: PALM_CONTACT_PX + 10 }));

    expect(state.rejected.size).toBe(0);
  });

  it('does not reject a large PEN contact', () => {
    // Only touch hardware reports contact area meaningfully. A pen reporting
    // an odd size must not be discarded as a palm.
    const result = onContactDown(
      state,
      touch(1, 500, 500, { type: 'pen', size: PALM_CONTACT_PX + 10 }),
    );

    expect(result.accepted).toBe(true);
  });
});

// --------------------------------------------------------------- camera

describe('the camera has exactly one owner', () => {
  it('goes to whoever touches first', () => {
    const first = onContactDown(state, touch(1, 300, 500));

    expect(first.claimedCamera).toBe(true);
    expect(state.cameraOwner).toBe(first.participant.id);
  });

  it('is not stolen by somebody arriving later', () => {
    /*
     * The single most irritating thing a shared board can do: a passer-by
     * takes the view from somebody mid-gesture. First claim holds.
     */
    const first = onContactDown(state, touch(1, 300, 500));
    const second = onContactDown(state, touch(2, 3000, 500));

    expect(second.claimedCamera).toBe(false);
    expect(state.cameraOwner).toBe(first.participant.id);
  });

  it('moves the camera for its owner', () => {
    onContactDown(state, touch(1, 300, 500));

    const moved = onContactMove(state, touch(1, 340, 520), camera, viewport);

    expect(moved.camera).not.toEqual(camera);
    expect(moved.active).toBe(true);
  });

  it('moves nothing for anybody else', () => {
    /*
     * If four people can each pan, every person's frame of reference is
     * destroyed continuously by the other three, and nobody can point at
     * anything. This is the assertion that makes a shared board usable.
     */
    onContactDown(state, touch(1, 300, 500));
    onContactDown(state, touch(2, 3000, 500));

    const moved = onContactMove(state, touch(2, 3200, 700), camera, viewport);

    expect(moved.camera).toEqual(camera);
    expect(moved.drags).toEqual([]);
  });

  it('pinches with two contacts of the owning hand', () => {
    onContactDown(state, touch(1, 500, 500));
    onContactDown(state, touch(2, 600, 500));

    const moved = onContactMove(state, touch(2, 800, 500), camera, viewport);

    expect(moved.camera.scale).toBeGreaterThan(camera.scale);
  });

  it('pans by the centroid, not by one finger', () => {
    /*
     * With several contacts in a hand, following any single one makes the map
     * jitter as fingers settle. Moving one of three by 60px moves the
     * centroid by 20 — and that is what the camera should follow.
     */
    onContactDown(state, touch(1, 500, 500));
    onContactDown(state, touch(3, 560, 500));
    onContactDown(state, touch(4, 620, 500));

    const before = state.participants.values().next().value!;
    before.gesture = 'camera-pan';

    const moved = onContactMove(state, touch(1, 560, 500), camera, viewport);

    expect(moved.camera.x).not.toBe(camera.x);
    expect(Math.abs(moved.camera.x - camera.x)).toBeLessThan(60);
  });

  it('releases only when every contact of the owner has lifted', () => {
    onContactDown(state, touch(1, 500, 500));
    onContactDown(state, touch(2, 560, 500));

    const owner = state.cameraOwner;

    expect(onContactUp(state, touch(1, 500, 500)).releasedCamera).toBe(false);
    expect(state.cameraOwner).toBe(owner);

    expect(onContactUp(state, touch(2, 560, 500)).releasedCamera).toBe(true);
  });

  it('hands the camera to somebody still on the board', () => {
    // So the next pan works without needing a fresh touch.
    onContactDown(state, touch(1, 300, 500));
    const second = onContactDown(state, touch(2, 3000, 500));

    onContactUp(state, touch(1, 300, 500));

    expect(state.cameraOwner).toBe(second.participant.id);
  });

  it('drops from a pinch back to a pan when one finger lifts', () => {
    onContactDown(state, touch(1, 500, 500));
    onContactDown(state, touch(2, 600, 500));

    onContactUp(state, touch(2, 600, 500));

    const owner = [...state.participants.values()][0];
    expect(owner?.gesture).toBe('camera-pan');
  });
});

// ---------------------------------------------------------- parallel drags

describe('dragging nodes in parallel', () => {
  it('lets several people drag different nodes in the same frame', () => {
    /*
     * The entire point of a multi-touch board. The camera is shared state and
     * node positions are not, which is the asymmetry the whole design rests
     * on.
     */
    const a = onContactDown(state, touch(1, 300, 500));
    const b = onContactDown(state, touch(2, 2000, 500));
    const c = onContactDown(state, touch(3, 3500, 500));

    beginDrag(state, a.participant.id, 'node-a');
    beginDrag(state, b.participant.id, 'node-b');
    beginDrag(state, c.participant.id, 'node-c');

    const first = onContactMove(state, touch(1, 340, 520), camera, viewport);
    const second = onContactMove(state, touch(2, 2100, 480), camera, viewport);
    const third = onContactMove(state, touch(3, 3400, 560), camera, viewport);

    expect(first.drags[0]?.nodeId).toBe('node-a');
    expect(second.drags[0]?.nodeId).toBe('node-b');
    expect(third.drags[0]?.nodeId).toBe('node-c');

    // And none of them moved the view.
    expect(first.camera).toEqual(camera);
    expect(second.camera).toEqual(camera);
    expect(third.camera).toEqual(camera);
  });

  it('gives up the camera when its owner starts a drag', () => {
    /*
     * Somebody who put a finger on a node wanted the node. If they kept the
     * camera, their drag would scroll the map out from under the thing they
     * are holding.
     */
    const a = onContactDown(state, touch(1, 300, 500));
    expect(state.cameraOwner).toBe(a.participant.id);

    beginDrag(state, a.participant.id, 'node-a');

    expect(state.cameraOwner).not.toBe(a.participant.id);
  });

  it('passes the camera to another participant when the owner drags', () => {
    const a = onContactDown(state, touch(1, 300, 500));
    const b = onContactDown(state, touch(2, 3000, 500));

    beginDrag(state, a.participant.id, 'node-a');

    expect(state.cameraOwner).toBe(b.participant.id);
  });

  it('reports drags in world units, so zoom does not change the feel', () => {
    const a = onContactDown(state, touch(1, 300, 500));
    beginDrag(state, a.participant.id, 'node-a');

    const zoomed: Camera = { x: 0, y: 0, scale: 2 };
    const moved = onContactMove(state, touch(1, 400, 500), zoomed, viewport);

    // 100 screen pixels at 2x is 50 world units.
    expect(moved.drags[0]?.dx).toBeCloseTo(50, 5);
  });

  it('ends the drag when the contact lifts', () => {
    const a = onContactDown(state, touch(1, 300, 500));
    beginDrag(state, a.participant.id, 'node-a');

    onContactUp(state, touch(1, 300, 500));

    expect(participantCount(state)).toBe(0);
  });
});

// ------------------------------------------------------------- selection

describe('selection is per participant', () => {
  it('lets two people hold different nodes at once', () => {
    /*
     * §17 asked for "a set, not a scalar". A flat set would say WHICH nodes
     * are held and not BY WHOM — and by whom is the only part that matters
     * when two people must not fight over one detail panel.
     */
    const a = onContactDown(state, touch(1, 300, 500));
    const b = onContactDown(state, touch(2, 3000, 500));

    setSelection(state, a.participant.id, 'node-a');
    setSelection(state, b.participant.id, 'node-b');

    const claimed = claimedNodes(state);

    expect(claimed.get('node-a')).toBe(a.participant.id);
    expect(claimed.get('node-b')).toBe(b.participant.id);
  });

  it('clears a participant’s selection when they leave', () => {
    const a = onContactDown(state, touch(1, 300, 500));
    setSelection(state, a.participant.id, 'node-a');

    onContactUp(state, touch(1, 300, 500));

    expect(claimedNodes(state).size).toBe(0);
  });

  it('sets the selection when a drag begins', () => {
    const a = onContactDown(state, touch(1, 300, 500));
    beginDrag(state, a.participant.id, 'node-a');

    expect(claimedNodes(state).get('node-a')).toBe(a.participant.id);
  });
});

// ------------------------------------------------------------------ taps

describe('taps', () => {
  it('recognises a contact that did not move', () => {
    onContactDown(state, touch(1, 500, 500));
    const up = onContactUp(state, touch(1, 503, 502));

    expect(up.wasTap).toBe(true);
    expect(up.tapPoint).toEqual({ x: 503, y: 502 });
  });

  it('does not call a drag a tap', () => {
    onContactDown(state, touch(1, 500, 500));
    const up = onContactUp(state, touch(1, 700, 500));

    expect(up.wasTap).toBe(false);
  });

  it('does not call the end of a node drag a tap', () => {
    // Otherwise dropping a node where you picked it up would also open it.
    const a = onContactDown(state, touch(1, 500, 500));
    beginDrag(state, a.participant.id, 'node-a');

    expect(onContactUp(state, touch(1, 502, 501)).wasTap).toBe(false);
  });
});

describe('cancellation', () => {
  it('removes the contact and frees the camera', () => {
    onContactDown(state, touch(1, 500, 500));
    onContactCancel(state, 1);

    expect(participantCount(state)).toBe(0);
    expect(state.cameraOwner).toBeNull();
  });

  it('survives a cancel for a contact it never saw', () => {
    // The browser sends these. A throw here would take down the gesture layer.
    expect(() => onContactCancel(state, 999)).not.toThrow();
  });
});

describe('a busy board', () => {
  it('handles sixty simultaneous contacts across several people', () => {
    // The number in the roadmap. Six people, ten contacts each.
    for (let person = 0; person < 6; person += 1) {
      for (let finger = 0; finger < 10; finger += 1) {
        onContactDown(
          state,
          touch(person * 10 + finger + 1, 400 + person * 600 + finger * 25, 800),
        );
      }
    }

    expect(contactCount(state)).toBe(60);
    // Six people, but each hand exceeds the per-hand cap, so they split
    // further. What matters is that it is many participants, not one.
    expect(participantCount(state)).toBeGreaterThanOrEqual(6);
    // And still exactly one camera.
    expect(state.cameraOwner).not.toBeNull();
  });
});
