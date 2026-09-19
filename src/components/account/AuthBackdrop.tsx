'use client';

import styled from 'styled-components';

/**
 * The atmosphere behind the authentication form.
 *
 * Two constraints shaped this. It has to say "same product as the map" —
 * so it borrows the map's vocabulary, a dark ground with connected nodes
 * fading into it. And it has to stay out of the way of a form someone is
 * typing into, so it is confined to the region BELOW the fields, at an
 * opacity where it reads as depth rather than as content.
 *
 * Deliberately not a full network graphic. The map earns a screen full of
 * nodes because navigating them is the task; here the task is a password box,
 * and decoration behind an input is just contrast the label has to fight.
 */

const Layer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;

  /* Two soft pools rather than a gradient wash across the whole screen: the
     violet sits behind the brand at the top, the cyan low and off to one side,
     so the middle of the screen — where the fields are — stays near-black. */
  background:
    radial-gradient(
      340px 240px at 50% 12%,
      var(--fam-organise-glow),
      transparent 72%
    ),
    radial-gradient(
      300px 220px at 18% 78%,
      var(--fam-discover-wash),
      transparent 70%
    );
`;

const Lines = styled.svg`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 200px;
  opacity: 0.42;
`;

export function AuthBackdrop() {
  return (
    <Layer aria-hidden="true">
      <Lines viewBox="0 0 390 200" preserveAspectRatio="none" fill="none">
        <g stroke="#3B2A6B" strokeWidth="0.7">
          <path d="M-20 150 120 96 250 148 400 92" />
          <path d="M-20 84 96 150 232 88 370 156" />
          <path d="M250 148 232 88 320 190" />
          <path d="M96 150 250 148" />
        </g>
        <g fill="#6D4BC9">
          <circle cx="120" cy="96" r="2" />
          <circle cx="250" cy="148" r="2" />
          <circle cx="232" cy="88" r="1.6" />
        </g>
      </Lines>
    </Layer>
  );
}
