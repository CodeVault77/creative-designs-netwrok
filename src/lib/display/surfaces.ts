/**
 * Display surfaces, from a phone to an 86-inch board.
 *
 * ── The mistake this file exists to prevent ─────────────────────────────────
 *
 * A responsive layout keyed on CSS pixel width says an 86-inch 4K board and a
 * 27-inch monitor are the same thing: both report about 1920 logical pixels.
 * They are not remotely the same thing, and treating them alike produces the
 * two failures that make large-format software feel broken:
 *
 *   text nobody can read    12px is comfortable at 60cm and illegible at 3m.
 *                           The board looks like a monitor somebody zoomed
 *                           out of.
 *
 *   targets nobody can hit  a 44px tap target is a fingertip on a phone held
 *                           in the hand. On a wall, with an arm extended,
 *                           accuracy is far worse — a finger is the same size
 *                           and the aim is not.
 *
 * What actually matters is **angular size**: how big something is on the
 * viewer's retina. That depends on physical size and viewing distance, not on
 * pixel count — so this module works in millimetres and metres and converts to
 * pixels at the end, rather than guessing from a breakpoint.
 *
 * ── Why viewing distance is inferred, not measured ──────────────────────────
 *
 * No browser API reports how far away somebody is sitting. But viewing
 * distance correlates strongly with physical screen size, because people
 * position themselves to see the whole thing: a phone at ~35cm, a laptop at
 * ~60cm, a wall display at 2–3m. Inferring from diagonal is an approximation,
 * and it is a far better one than assuming everybody is at a desk.
 */

export type SurfaceClass = 'handheld' | 'tablet' | 'desktop' | 'wall';

export interface Surface {
  class: SurfaceClass;
  /** Physical diagonal in inches, measured or inferred. */
  diagonalInches: number;
  /** Assumed viewing distance in millimetres. */
  viewingDistanceMm: number;
  /** CSS pixels per physical millimetre. */
  pixelsPerMm: number;
  /**
   * Multiplier applied to type and target sizes.
   *
   * 1 at a laptop, which is what the design system was drawn for. Everything
   * else is relative to that — so a value of 2.4 means "twice the size, and a
   * bit, because it is twice as far away and then some".
   */
  scale: number;
  /** True when several people may be at this surface at once. */
  shared: boolean;
  /** Maximum simultaneous contacts the hardware is expected to report. */
  maxContacts: number;
}

/** Reference: a 13-inch laptop at 60cm, which the type scale was drawn for. */
const REFERENCE_DIAGONAL = 13;
const REFERENCE_DISTANCE_MM = 600;

/**
 * Viewing distance from physical size.
 *
 * The constants are the observed ergonomics, not a formula anybody derived: a
 * phone is held at arm's-length-ish, a desk display is at a desk, and a wall
 * display is stood back from. The interpolation between them is linear
 * because a curve would imply a precision that is not there.
 */
export function inferViewingDistanceMm(diagonalInches: number): number {
  if (diagonalInches <= 7) return 350; // phone, in the hand
  if (diagonalInches <= 13) return 600; // tablet or laptop
  if (diagonalInches <= 32) return 700; // desk monitor
  if (diagonalInches <= 55) return 1800; // a screen in a room
  return 2500; // a wall people stand at
}

export function classify(
  diagonalInches: number,
  coarsePointer: boolean,
): SurfaceClass {
  if (diagonalInches >= 40 && coarsePointer) return 'wall';
  if (diagonalInches <= 7) return 'handheld';
  if (diagonalInches <= 13 && coarsePointer) return 'tablet';
  return 'desktop';
}

export interface SurfaceInput {
  /** CSS pixel dimensions of the viewport. */
  width: number;
  height: number;
  /** devicePixelRatio. */
  dpr: number;
  /** `(pointer: coarse)` — touch or pen rather than a mouse. */
  coarsePointer: boolean;
  /** `navigator.maxTouchPoints`, when available. */
  maxTouchPoints?: number;
  /**
   * Physical diagonal, when it is actually known.
   *
   * Nothing in a browser reports this, so it is normally inferred below. A
   * deployment that KNOWS — a kiosk, a boardroom install, a signed-in device
   * profile — should pass it, because a measurement always beats an
   * inference and this is the input everything else is derived from.
   */
  diagonalInches?: number;
}

/**
 * Estimate the physical diagonal.
 *
 * ── This is an inference and is documented as one ───────────────────────────
 *
 * CSS pixels are defined against a reference pixel of 1/96 inch at arm's
 * length, and device makers honour that loosely. Multiplying logical size by
 * devicePixelRatio and dividing by a nominal density gets within perhaps 20%,
 * which is enough to tell a phone from a wall and not enough to tell a 24-inch
 * monitor from a 27-inch one. That distinction does not matter; the first one
 * does.
 *
 * The `maxTouchPoints` signal is what rescues the hard case. A display
 * reporting 20 or more simultaneous contacts is a board — no phone or laptop
 * does that — and no amount of pixel arithmetic reveals it.
 */
export function estimateDiagonalInches(input: SurfaceInput): number {
  if (input.diagonalInches) return input.diagonalInches;

  /*
   * A device reporting 20+ contacts is a large-format board, whatever its
   * resolution says. This is the one strong signal available, and it is
   * checked before the arithmetic because the arithmetic cannot see it.
   */
  if ((input.maxTouchPoints ?? 0) >= 20) return 75;

  const physicalWidth = input.width * input.dpr;
  const physicalHeight = input.height * input.dpr;
  const diagonalPx = Math.hypot(physicalWidth, physicalHeight);

  /*
   * Nominal densities by class, because real densities vary by a factor of
   * three and there is no way to read the true one. A phone is ~460ppi, a
   * laptop ~140, a monitor ~110, a large board ~55.
   */
  const nominalPpi = input.dpr >= 3 ? 460 : input.dpr >= 2 ? 220 : 110;

  return diagonalPx / nominalPpi;
}

/**
 * The scale factor for type and targets.
 *
 * Angular size is preserved: something twice as far away must be twice as big
 * to look the same. That single relationship is the whole calculation, and
 * everything else here is bounds on it.
 */
export function scaleFor(
  diagonalInches: number,
  viewingDistanceMm: number,
): number {
  const raw = viewingDistanceMm / REFERENCE_DISTANCE_MM;

  /*
   * Bounded, and NOT applied in full.
   *
   * Strict angular parity says a display at 2.5m needs everything 4.2 times
   * larger. That is correct optics and wrong design: at that size a wall
   * displays about as much as a phone, which defeats the reason for having a
   * wall. People also move closer to read detail, which strict parity assumes
   * they cannot.
   *
   * The square root keeps most of the legibility gain while leaving the board
   * meaningfully more spacious than a laptop. 2.4 caps it at a size that is
   * still comfortable at 3m.
   */
  const eased = Math.sqrt(raw);

  // A small phone is not scaled DOWN — the type scale is already at its
  // legible floor, and shrinking it would fail contrast and touch minimums.
  const floor = diagonalInches <= REFERENCE_DIAGONAL ? 1 : eased;

  return Math.min(2.4, Math.max(1, floor));
}

export function describeSurface(input: SurfaceInput): Surface {
  const diagonalInches = estimateDiagonalInches(input);
  const viewingDistanceMm = inferViewingDistanceMm(diagonalInches);
  const surfaceClass = classify(diagonalInches, input.coarsePointer);

  const diagonalPx = Math.hypot(input.width, input.height);
  const diagonalMm = diagonalInches * 25.4;

  return {
    class: surfaceClass,
    diagonalInches,
    viewingDistanceMm,
    pixelsPerMm: diagonalMm > 0 ? diagonalPx / diagonalMm : 4,
    scale: scaleFor(diagonalInches, viewingDistanceMm),
    // A wall is shared by definition. Nobody crowds around a laptop for long.
    shared: surfaceClass === 'wall',
    maxContacts: input.maxTouchPoints ?? (input.coarsePointer ? 10 : 1),
  };
}

/** The physical minimum target, in millimetres, for a surface. */
export function minimumTargetMm(surface: Surface): number {
  /*
   * 9mm is the widely used physical minimum for a fingertip. A wall gets 14mm
   * because an extended arm is less accurate than a thumb on a held device —
   * the finger is the same size and the aim is worse.
   */
  return surface.class === 'wall' ? 14 : 9;
}

/**
 * The minimum comfortable target size, in CSS pixels.
 *
 * ── Two different minimums, and the larger wins ─────────────────────────────
 *
 * The physical requirement is in millimetres, so it is computed from pixel
 * density rather than being a constant — on a dense phone, 9mm is 54 CSS
 * pixels, and the familiar 44 would be 7mm.
 *
 * The 44px floor is the platform minimum, and it is NOT redundant: it is what
 * dominates on a low-density surface. A large board has few CSS pixels per
 * millimetre, so 14mm computes to about 28 — while 44 CSS pixels there is
 * already some 22mm, comfortably above the physical requirement. Taking the
 * larger of the two is right in both directions, and it means a board's
 * CSS-pixel minimum can legitimately be SMALLER than a phone's while its
 * physical minimum is larger.
 *
 * That inversion is confusing enough that `minimumTargetMm` exists to state
 * the physical intent separately, and a test asserts the physical ordering
 * rather than the pixel one.
 */
export function minimumTargetPx(surface: Surface): number {
  /*
   * Rounded UP, not to nearest. Rounding a minimum down produces a value
   * below the minimum — 9mm on a dense phone is 54.3 pixels, and rounding to
   * 54 gives 8.95mm. Small, and the wrong direction for a floor.
   */
  return Math.max(44, Math.ceil(minimumTargetMm(surface) * surface.pixelsPerMm));
}

/**
 * The hand-span radius used to cluster contacts into participants.
 *
 * `multitouch.ts` has a pixel default and says it should be scaled by density,
 * because it cannot know the physical size. This is where that knowledge
 * lives: a hand is about 200mm wherever it is.
 */
export function handSpanPx(surface: Surface): number {
  return Math.round(200 * surface.pixelsPerMm);
}

/**
 * CSS custom properties for a surface.
 *
 * Only the SCALE is emitted, not a set of recomputed sizes. The design system
 * already expresses every size in terms of its tokens, so multiplying one
 * variable rescales the whole product coherently — and a page that emitted
 * forty overridden sizes would drift from the tokens the moment either
 * changed.
 */
export function surfaceVariables(surface: Surface): Record<string, string> {
  return {
    '--surface-scale': surface.scale.toFixed(3),
    '--surface-min-target': `${minimumTargetPx(surface)}px`,
  };
}

/**
 * Whether the map should draw in board mode.
 *
 * Shared surfaces get: larger nodes, participant-coloured selection rings, no
 * hover states (nobody hovers with a finger), and controls duplicated at both
 * ends of the screen — because a control in one corner of a 2-metre board is
 * out of reach for the person standing at the other.
 */
export function isBoardMode(surface: Surface): boolean {
  return surface.class === 'wall';
}
