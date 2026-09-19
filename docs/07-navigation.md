# Navigation Shell (P2)

**Status:** Shipped · **Date:** 2026-08-31 · **Phase:** P2

Implements §06 (information architecture), §08 (screen inventory) and §17 (responsive navigation).

---

## The route registry is the source of truth

[`src/lib/routes.ts`](../src/lib/routes.ts) holds all 22 screens with their path, owning phase, tab and access level. The shell, the guards, the scaffolds and the tests all read from it, so:

- a route cannot exist without appearing in navigation
- a nav item cannot point at a route that does not exist
- the screen count cannot drift from 22 without a test failing

`npm test` asserts the count, the numbering (01–22, no gaps), and that every nav item resolves to a real route.

## Two deep-link decisions

**1. Node detail is `?node=<id>`, not a path segment.**

§08 is explicit that "Expanded radial map", "Selected node state" and "Node detail panel" are _states of one screen_. A `/map/node/<id>` route would unmount and remount `MapCanvas` on every selection — losing the camera position, the expansion state and any in-flight animation, and forcing a fresh canvas context.

With a query param the map stays mounted, the sheet opens over it, and Back closes the sheet rather than leaving the map. F2's rule — _"no state is reachable that cannot be exited in one tap"_ — depends on this. The same applies to `/maps/<id>?node=<id>` for the editor.

**2. `/n/<id>` is the canonical public share URL.**

Short and opaque, so the internal URL structure can change later without breaking links already sitting in messages and bookmarks. It is a Route Handler that resolves the node and redirects. Node-level share links are the product's main growth mechanism (§10) — they need to keep working indefinitely.

## Route map

| Route                      | Screen                | Access    |
| -------------------------- | --------------------- | --------- |
| `/`                        | 01 Entry transition   | public    |
| `/map`                     | 02 Community Map      | public    |
| `/map?node=<id>`           | 03 Node detail        | public    |
| `/map/tree`                | 04 Tree view          | public    |
| `/search`                  | 05 Search             | public    |
| `/search?q=<q>`            | 06 Search results     | public    |
| `/maps`                    | 07 My Maps            | authed    |
| `/maps/new`                | 08 New map            | authed    |
| `/maps/<id>`               | 09 Map editor         | authed    |
| `/maps/<id>?node=<id>`     | 10 Node editor        | authed    |
| `/maps/<id>/share`         | 11 Share map          | authed    |
| `/maps/<id>/collaborators` | 12 Collaborators      | authed    |
| `/maps/<id>/chat`          | 13 Map chat           | authed    |
| `/create/link`             | 14 Link-to-Mind-Map   | public    |
| `/watch`                   | 15 Page Watcher setup | public    |
| `/watch/feed`              | 16 Page Watcher feed  | public    |
| `/services/<slug>`         | 17 Service node       | public    |
| `/u/<handle>`              | 18 Profile            | public    |
| `/notifications`           | 19 Notifications      | authed    |
| `/settings`                | 20 Settings           | authed    |
| `/admin/moderation`        | 21 Moderation         | **staff** |
| `/soon/<nodeId>`           | 22 Coming Soon        | public    |

**Supporting routes, deliberately not in the registry** — they are not screens, and keeping them out is what stops the count drifting: `/n/<id>` (share resolver), `/you` (alias → own profile), `/sign-in` (P6), `/api/health`.

Screens 05/06 and 09/10 share a route because a query turns one into the other. Splitting them would remount the search field on every submit, and the canvas on every node edit.

## Guards

In the Server Component, before anything renders. A guard that runs in a `useEffect` has already shipped the protected markup to the browser and merely hidden it — that is a curtain, not a guard.

| Access   | Signed out                  | Signed in | Staff |
| -------- | --------------------------- | --------- | ----- |
| `public` | 200                         | 200       | 200   |
| `authed` | 307 → `/sign-in?returnTo=…` | 200       | 200   |
| `staff`  | **404**                     | **404**   | 200   |

**Staff routes render 404, never 403** (§08 screen 21). A 403 tells an attacker they have found the admin surface and only need credentials. A 404 tells them nothing — which is also why signed-out users get 404 there rather than a sign-in redirect.

The `returnTo` round trip means a deep link into a protected screen survives sign-in instead of dumping the user on a home page.

Verified end to end: **22/22 routes, three session states each.**

## Chrome by breakpoint (§17)

| Breakpoint        | Chrome                                                                             |
| ----------------- | ---------------------------------------------------------------------------------- |
| phone < 600       | bottom tab bar + top bar (brand)                                                   |
| tablet 600–1023   | bottom tab bar + top bar carrying search and notifications                         |
| desktop 1024–1599 | left icon rail, 72px, no tab bar                                                   |
| large ≥ 1600      | rail expanded with labels, 208px                                                   |
| board ≥ 2400      | rail **bottom-anchored** — someone standing at a wall display cannot reach the top |

**The tab bar and rail are never both mounted.** They are different markup with different semantics, not one element restyled; rendering both and hiding one with a media query would put two `<nav aria-label="Primary">` landmarks in the accessibility tree and a screen-reader user would hear every destination twice.

The cost is one client render at the phone layout before the breakpoint resolves. That is the right default — the phone chrome is narrowest, so the transient state is a sparse desktop rather than a desktop overflowing a phone.

Chrome modes: `full` (nav + top bar) · `minimal` (top bar only — the editor owns the viewport) · `none` (the entry transition).

## The stub session

**Development only. It must not survive into production.**

`src/lib/auth/session.ts` reads a cookie anyone can set:

```js
document.cookie = 'cdn_dev_session=user; path=/'; // signed in
document.cookie = 'cdn_dev_session=staff; path=/'; // signed in as staff
```

What is deliberately real: the _shape_ of the session, so P6 swaps the implementation and not the call sites; the guard behaviour including the 404 rule, because that is a security decision that should not wait for real auth; and `server-only`, so the file can never be pulled into a client bundle.

## ScreenScaffold

Every unbuilt screen renders its number, owning phase and purpose from §08 — not "coming soon". That wording belongs to screen 22, which is a _product_ state with real interest capture; using it for "engineering hasn't built this" would confuse a user-facing promise with a build status.

**`grep -r ScreenScaffold src/app` is an accurate list of what remains to build.** Each use is deleted by the phase that builds the screen.

## Known gaps

- **Sign-in is a placeholder** (P6). It exists only so the guards have a destination.
- **`/n/<id>` redirects blindly** to `/map?node=<id>`. P4 adds the real lookup: private nodes must 404 rather than 403, for the same reason moderation does.
- **`AppShell` is not storied** — it reads `usePathname()` and live viewport width, so a story would need a router mock or would silently show whichever layout the iframe happened to be. Its three pieces are storied individually, and its logic is covered by the route tests and the 22-route smoke test.
- **No route-level loading or error boundaries yet.** §08's state matrix specifies per-screen loading and error states; those belong to the phases that build each screen, and `loading.tsx` / `error.tsx` files should be added alongside them.
