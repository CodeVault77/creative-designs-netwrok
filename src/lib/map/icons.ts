/**
 * Node glyphs.
 *
 * Ported verbatim from the design canvas (`ICONS` in "Creative Design Networks
 * v2.dc.html"). Every path is drawn on a 24×24 grid, stroked — never filled —
 * so one stroke colour and one line width give the whole set a single voice.
 *
 * Stored as raw path data rather than as React components because the map is
 * painted onto a 2D canvas, not into the DOM. `Path2D` takes exactly this
 * string, so the same source serves the canvas renderer and any DOM chrome
 * that needs the same glyph.
 *
 * Adding one here is not enough to make it appear: `iconPathsFor` is what the
 * renderer calls, and an unknown name deliberately returns nothing rather than
 * a fallback glyph — a wrong icon is worse than no icon, because it reads as
 * information.
 */

export const ICON_VIEWBOX = 24;

export const icons = {
  map: [
    'M3 6.5 9.5 3.5 15 6.5 21 3.5v14L15 20.5 9.5 17.5 3 20.5z',
    'M9.5 3.5v14',
    'M15 6.5v14',
  ],
  link: [
    'M9.6 13.4a4 4 0 0 0 6 .5l2.4-2.4a4.2 4.2 0 0 0-6-6l-1.4 1.4',
    'M14.4 10.6a4 4 0 0 0-6-.5L6 12.5a4.2 4.2 0 0 0 6 6l1.4-1.4',
  ],
  eye: [
    'M2 12s3.6-6.4 10-6.4S22 12 22 12s-3.6 6.4-10 6.4S2 12 2 12z',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  ],
  code: ['m8.5 8.5-4 3.5 4 3.5', 'm15.5 8.5 4 3.5-4 3.5', 'M13.6 5.5l-3.2 13'],
  layers: ['M12 3 3 8l9 5 9-5z', 'M3 13l9 5 9-5', 'M3 17.5l9 5 9-5'],
  users: [
    'M16 20v-1.8a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.2V20',
    'M13.3 7.6a3.8 3.8 0 1 1-7.6 0 3.8 3.8 0 0 1 7.6 0',
    'M18.4 14.7a3.6 3.6 0 0 1 2.6 3.5V20',
  ],
  bag: [
    'M4 8.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19v-9A1.5 1.5 0 0 1 4 8.5z',
    'M9 8.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2.5',
    'M2.5 13h19',
  ],
  spark: ['M12 2.8 14.2 9l6.2 2.2-6.2 2.2L12 19.6 9.8 13.4 3.6 11.2 9.8 9z'],
  bulb: [
    'M9.4 18.4h5.2',
    'M10.5 21.4h3',
    'M15 14c.2-1 .7-1.8 1.4-2.5A4.7 4.7 0 0 0 18 8a6 6 0 0 0-12 0c0 1 .2 2.2 1.5 3.5.7.7 1.2 1.5 1.4 2.5',
  ],
  cal: [
    'M5 4.6h14a2 2 0 0 1 2 2v12.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.6a2 2 0 0 1 2-2z',
    'M8 2.5v4',
    'M3 10.4h18',
  ],
  card: [
    'M3 6.5h18a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 17V8A1.5 1.5 0 0 1 3 6.5z',
    'M1.5 11h21',
    'M5 15h4',
  ],
  heart: [
    'M12 20.4S3.6 15 3.6 9.6A4.5 4.5 0 0 1 12 7.1a4.5 4.5 0 0 1 8.4 2.5c0 5.4-8.4 10.8-8.4 10.8z',
  ],
  file: [
    'M13.6 2.8H7a2 2 0 0 0-2 2v14.4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.2z',
    'M13.6 2.8v5.4H19',
  ],
  note: [
    'M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z',
    'M7.5 8.5h9',
    'M7.5 13h6',
  ],
  search: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14', 'm20 20-3.6-3.6'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z'],
  user: [
    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
    'M16 7.2a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  ],
  connect: ['M8 12h8', 'M8 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0'],
  chat: ['M20 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.3A8 8 0 1 1 20 12z'],
} as const;

export type IconName = keyof typeof icons;

/**
 * Paths for a name, or an empty array.
 *
 * `icon` on a node is an optional free string (it survives a round trip
 * through the database, where nothing constrains it to this set), so an
 * unrecognised value has to be handled rather than trusted. Returning nothing
 * is deliberate: a placeholder glyph in the middle of a node would read as a
 * node type, and inventing a meaning is worse than leaving the space empty.
 */
export function iconPathsFor(name: string | undefined): readonly string[] {
  if (!name) return [];
  return icons[name as IconName] ?? [];
}

/**
 * The brand infinity, for the ROOT node only.
 *
 * Its own viewBox (44×24, not the 24×24 grid the node glyphs share) because it
 * is a wordless logo rather than a symbol from the icon set, and squeezing it
 * into a square would distort the lobes.
 *
 * The six stops are `components/brand/LogoMark.tsx`'s gradient, copied
 * rather than shared — that one is SVG `<linearGradient>` stops consumed by
 * JSX, this is a `CanvasGradient` built by hand in `renderer.ts`, and there
 * is no single value the two could both import.
 *
 * They MUST still match, because the map centre and the entry screen draw the
 * same mark and a visitor sees both inside a few taps of each other. This used
 * to be three stops — blue, magenta, orange — a coarser copy of an earlier,
 * three-stop version of LogoMark's gradient that stayed after LogoMark grew
 * to six. The visible result was a canvas mark that read as two flat colour
 * blocks (blue loop, orange loop) where the SVG one showed a continuous
 * sweep through cyan and pink — correct in isolation, and a mismatch the
 * moment the two are seen on the same visit.
 */
export const BRAND_MARK = {
  width: 44,
  height: 24,
  paths: [
    'M22 12c3-4.6 5.3-7.2 8.8-7.2a7.2 7.2 0 0 1 0 14.4C26.3 19.2 25 16.6 22 12Z',
    'M22 12c-3-4.6-5.3-7.2-8.8-7.2a7.2 7.2 0 0 0 0 14.4C17.7 19.2 19 16.6 22 12Z',
  ],
  stops: [
    { at: 0, color: '#2E7BF6' },
    { at: 0.18, color: '#2FD9F5' },
    { at: 0.42, color: '#8B5CF6' },
    { at: 0.56, color: '#FF4D97' },
    { at: 0.8, color: '#FF8A3D' },
    { at: 1, color: '#FF3D2E' },
  ],
} as const;
