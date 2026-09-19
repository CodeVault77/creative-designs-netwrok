# ADR-0012 — A PWA now; Capacitor when a store listing is actually needed

**Status:** Accepted
**Date:** 2026-09-05
**Phase:** 8 — Enterprise and devices

## Context

Phase 8 asks for "mobile shells over the existing responsive web; desktop via
Tauri or Electron". Three options, and the phrasing already rules out the worst
one — nobody is proposing a second, native codebase.

## Decision

**Ship a PWA now.** Reach for Capacitor only when a store listing is a
requirement somebody has actually stated, and Tauri (not Electron) for desktop
when there is a reason to leave the browser.

## Why a PWA first

It delivers most of what a shell is for, at almost no cost:

- an icon on the home screen and a standalone window with no browser chrome;
- offline capability — which comes from `src/lib/sync`, not from the shell;
- ships with the web deploy, so it can never be a version behind;
- no review queue between a fix and the people who need it.

`public/manifest.webmanifest` and `public/sw.js` are the whole of it.

**What the service worker deliberately does not do** is as important as what it
does. It caches content-hashed build assets and one offline page. It never
caches HTML — a service worker serving stale HTML is the classic way to ship a
bug that outlives its own fix — and it never touches `/api`, because a cache
shared by every account that has signed in on a device must not hold anybody's
data.

## What a PWA does not give you

Stated plainly, because these are the reasons to revisit:

- **No store listing.** If discovery through the App Store or Play matters
  commercially, a PWA does not provide it.
- **Push notifications on iOS** need 16.4+ and an installed PWA. Below that,
  nothing.
- **No native APIs** — camera, biometrics, background sync, share targets
  beyond the web equivalents.

## When to add Capacitor

Capacitor wraps _this same build_ in a native container. It is a packaging job
on top of the PWA rather than an alternative to it: the manifest, the service
worker and the sync layer are all still doing the work, and one build keeps
serving both. That is why the PWA is not throwaway effort.

The trigger is a stated requirement — a customer who needs the store listing,
or a feature that genuinely needs a native API. Not "it would be nice to be in
the store".

## Desktop: Tauri, not Electron

If a desktop application is wanted, **Tauri**. Electron bundles a full Chromium
and Node runtime per application — roughly 100MB before any of our code, plus a
Chromium security surface we then have to keep patched on every user's machine.
Tauri uses the operating system's own webview: an order of magnitude smaller,
and the browser engine is patched by the OS vendor rather than by us shipping a
new build.

Electron's advantage is a guaranteed engine version. That matters for
applications doing unusual rendering; this application already targets whatever
browser a user has, so the guarantee buys us nothing we are not already living
without.

**Neither is being built now.** The web application is responsive, installable
and works offline. A desktop wrapper should follow a reason, not precede one.

## Consequences

- Icons at `/icons/icon-192.png`, `icon-512.png` and `icon-maskable-512.png`
  must exist before install prompts work. They are referenced by the manifest
  and are not yet in the repository.
- The service worker is not registered by default — registration is a
  deliberate step, because a worker is much easier to install than to remove
  from someone's browser.

## Related

- `public/sw.js` — with its exclusions argued at the top
- ADR-0011 — offline sync, which is where offline actually lives
- ADR-0004 — web before native, which this continues rather than reverses
