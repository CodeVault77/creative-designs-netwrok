# Creative Design Networks — Phase 0 Roadmap

**The Coming Soon website, built as the first phase of the production site.**

Status: Draft for approval · Target: Phase 0 (pre-launch) · Owner: TBD

---

## 1. Executive Summary

This roadmap specifies a public **Coming Soon website** for Creative Design
Networks that explains the company, captures interest, and takes service
requests — built so that it becomes the production marketing site later without
a rewrite.

The single most important finding shaping this document:

> **This is not a greenfield repository.** It already contains a substantially
> built CDN application — the design token system, the exact neon palette, form
> primitives, server-side validation, spam scoring, rate limiting, an email
> outbox, and a provider-agnostic analytics facade all exist and are tested.

That changes the shape of Phase 0 completely. Roughly **60% of what a Coming
Soon site normally requires is already built and working in this repo.** The
work is mostly _assembly and marketing surface_, not new infrastructure — and
the roadmap below is written against what is actually here rather than against
a blank folder.

Three decisions drive everything else:

1. **The marketing site takes `/`; the application moves behind `/app`.** The
   root route is currently the app's entry transition. This is the one genuinely
   structural change Phase 0 requires, and doing it now is far cheaper than
   doing it after launch (§16.2).
2. **Reuse the established stack.** styled-components with a token pipeline,
   not Tailwind. This is already settled by ADR-0008, and the token system is
   the neon design language the landing page needs (§16.1).
3. **The service-request form is the existing enquiry system with a wider
   form.** P12 already shipped enquiry storage, honeypot-and-timing spam
   scoring, rate limits, and email dispatch, all tested (§18).

**What is genuinely new in Phase 0:** the marketing shell and its content
architecture, the landing page sections, a newsletter subscription, the wider
service-request form, marketing SEO, and the legal pages.

**What must not happen:** the site must not claim the platform is live. Every
future capability is described as vision, and the messaging rules in §7 are
binding rather than advisory.

---

## 2. Project Objective

Ship a public website that:

- explains what CDN is within seconds, honestly, before the platform exists;
- converts interest into two measurable outcomes — **email subscribers** and
  **service requests**;
- offers direct contact by WhatsApp and email;
- is maintainable by one developer changing configuration rather than
  components;
- becomes the production marketing site in Phase 1 by adding pages, not by
  being replaced.

**Explicit non-objective:** Phase 0 does not build, expose, or link into the
CDN application. The application exists in this repo but stays behind its own
route and is not advertised until it is ready.

---

## 3. Current Product Context

### 3.1 What CDN is

A visual, node-based platform where ideas, people, projects, tools and
information connect through an expandable radial network. The interface centres
on one node and grows outward through rings.

### 3.2 What actually exists in this repository today

Established by inspection, not assumption:

| Area                                                                         | State          | Phase 0 relevance                   |
| ---------------------------------------------------------------------------- | -------------- | ----------------------------------- |
| Next.js 15 App Router, React 19, TypeScript strict                           | Built          | Foundation                          |
| styled-components v6 + SSR registry                                          | Built          | **Use this, not Tailwind**          |
| Design tokens → JS object + CSS variables                                    | Built          | **The neon palette already exists** |
| UI primitives: Button, TextField, Card, Chip, Sheet, Toast, Skeleton, Avatar | Built          | Reuse directly                      |
| zod validation                                                               | Built          | Reuse                               |
| SQLite + forward-only TS migrations                                          | Built          | Persistence for forms               |
| Email outbox (`queueEmail`)                                                  | Built          | Notifications                       |
| Enquiry capture + spam scoring + rate limits                                 | Built (P12)    | **Service request = this, widened** |
| Interest capture (`node_interest`)                                           | Built (P4)     | Pattern for newsletter              |
| Analytics facade + typed event map                                           | Built          | Add marketing events only           |
| Radial canvas map, editor, search, collaboration                             | Built (P3–P13) | **Not exposed in Phase 0**          |
| Storybook, Vitest, Playwright harnesses                                      | Built          | Reuse test approach                 |
| ADRs 0001–0009                                                               | Written        | Follow, do not contradict           |

### 3.3 The visual references

Four references were supplied. Reading them as a design language rather than as
screens to copy:

- **Logo** — neon infinity mark, blue/cyan on the left resolving to
  orange/red on the right through a magenta crossing point, with node dots
  riding the stroke. Carries the lockup tagline
  **"God Gives the Vision. We Build the Connections."**
- **Central node screen** — a single glowing ring containing the mark on near
  black, with "TAP TO ENTER" beneath. This is the brand moment the hero should
  echo.
- **Radial map screen** — twelve labelled nodes around a lit centre, each with
  its own hue, icon and one-line description.

> **Correction worth flagging to the team.** The radial reference shows the
> _original_ twelve ring-one nodes (Mind Mapping, People & Networks, Ideas &
> Innovation, E-Commerce, Tasks, Calendar, Finance, Marketing, Content, Apps,
> Analytics, Cloud). **ADR-0003 re-cut ring one** and the shipped seed is
> different — it now leads with Mind Mapping, Link-to-Mind-Map, AI Tools,
> Commerce & Payments, Tasks & Projects, Active Projects, Build With Us,
> Freelance & Marketplace, Page Watcher, Ideas & Innovation, People & Networks,
> Partners & Sponsors. **Marketing content must follow the ADR, not the older
> mockup**, or the public site will describe a product that no longer matches
> the build.

### 3.4 Boundary

The landing page communicates value and vision. It does not claim live
features, and it does not expose implementation detail about the platform.

---

## 4. Client Requirements

Traced from the original request so nothing is lost:

| #   | Requirement                                        | Where it is met   |
| --- | -------------------------------------------------- | ----------------- |
| R1  | Quick landing page                                 | §9.1              |
| R2  | Add the CDN logo                                   | §11.3, §12.6      |
| R3  | Explain exactly what CDN does                      | §9.1 sections B–E |
| R4  | Contact via WhatsApp                               | §9.5, §15.2       |
| R5  | Contact via email                                  | §9.5, §15.2       |
| R6  | Service request submission page                    | §9.2, §18.3       |
| R7  | Function as Coming Soon / pre-launch               | §7, §15.6         |
| R8  | Subscribe for updates                              | §9.3, §18.2       |
| R9  | Build interest without exposing proprietary detail | §7.4              |
| R10 | Easy to update as the project evolves              | §15               |
| R11 | Evolve into production site without a rebuild      | §28               |

---

## 5. Landing Page Goals

Ranked, because ranking decides layout:

1. **Comprehension.** A first-time visitor can say what CDN is after ~8 seconds.
2. **Service requests.** The revenue path today. CDN sells development services
   _now_, while the platform is being built.
3. **Subscribers.** The launch audience.
4. **Direct contact.** WhatsApp and email for people who want a human.
5. **Credibility.** Looks like a company worth hiring.
6. **Partner/investor path.** Present, deliberately understated (§35 OD-11).

Goals 2 and 3 are both primary and they compete. Resolution: **the service
request is the page's primary CTA; the newsletter is a low-friction secondary
capture placed after the vision section**, where someone who is interested but
not hiring has somewhere to go.

---

## 6. Target Audiences

| Audience                            | Arrives wanting           | Gets                                           |
| ----------------------------------- | ------------------------- | ---------------------------------------------- |
| **Prospective client**              | Someone to build software | Services section → service request             |
| **Interested follower**             | To know what this is      | Explanation → newsletter                       |
| **Partner / sponsor / investor**    | To assess the vision      | Vision section → email contact                 |
| **Prospective collaborator**        | Work                      | Services → service request (marked as such)    |
| **Returning visitor (post-launch)** | The app                   | Header CTA becomes "Enter the network" (§28.4) |

Not an audience in Phase 0: existing users. There are none.

---

## 7. Messaging Strategy

### 7.1 The one-sentence explanation

> Creative Design Networks is building a visual platform where ideas, people
> and projects connect as an expandable network of nodes — and while we build
> it, we design and build software for other people.

That second clause matters. It is what makes the site a business today rather
than a countdown.

### 7.2 Tense rules — binding

| Subject           | Tense                             | Example                                              |
| ----------------- | --------------------------------- | ---------------------------------------------------- |
| Services          | Present                           | "We build web applications."                         |
| The platform      | Future                            | "We are building a visual network platform."         |
| Platform features | Vision                            | "Our vision: maps you can share and build together." |
| Launch date       | Absent unless approved (§35 OD-9) | "Launching soon" not "Launching March 4"             |

**Forbidden**: any sentence implying a visitor can use the platform now; any
feature list that reads as available; countdown timers to an unapproved date.

**Required**: at least one explicit statement that the platform is in
development, in the hero, above the fold.

### 7.3 The tagline question

The logo lockup carries **"God Gives the Vision. We Build the Connections."**
This is a real brand asset, already used in the application's own metadata. It
is faith-based, which is a positioning decision with real audience
consequences, so it is raised as **OD-13** rather than silently used or
silently dropped. The roadmap's recommendation: **keep it in the logo lockup
and the footer, do not make it the hero headline** — the hero should explain
the product, and the tagline is an identity statement rather than an
explanation.

### 7.4 Confidentiality

Describe _what_ the platform does for a user. Do not publish: architecture,
the renderer approach, the node/permission model, ring-one composition beyond
naming themes, the roadmap phases, or anything from the internal blueprint.

---

## 8. Information Architecture

```
/                       Landing (Coming Soon)
/services               Services detail            [Phase 0, thin]
/request                Service request form
/request/success        Confirmation
/contact                Contact options
/privacy                Privacy policy             [required by forms]
/terms                  Terms                      [required before launch]
/404                    Not found

/app/*                  The CDN application        [exists; unlinked in Phase 0]
```

Header navigation (Phase 0): **What is CDN · Services · Contact ·
[Request a project]**

Footer: brand + tagline, navigation, contact, social, legal, copyright.

Deliberately absent in Phase 0: About, Projects, Blog, Pricing, Solutions,
Marketplace. Their slots exist in the navigation configuration (§15.3) and are
disabled by feature flag, so Phase 1 turns them on rather than restructuring.

---

## 9. Page-by-Page Specification

### 9.1 Landing page — `/`

Sections in order, with the job each does:

| #   | Section      | Job                             | Notes                                           |
| --- | ------------ | ------------------------------- | ----------------------------------------------- |
| A   | Header       | Identify, navigate, primary CTA | Sticky on scroll ≥ 64px                         |
| B   | Hero         | Explain + state pre-launch      | Logo, headline, sub, 2 CTAs, honest status line |
| C   | What is CDN  | Expand the one-liner            | 3 short paragraphs max                          |
| D   | How it works | Make "node network" concrete    | 3 steps, static SVG diagram                     |
| E   | What we do   | The revenue path                | Service cards from config                       |
| F   | Who it's for | Self-identification             | 4 audience cards                                |
| G   | Vision       | The network concept             | Explicitly labelled _vision_                    |
| H   | Newsletter   | Capture interest                | Inline, one field                               |
| I   | Contact      | WhatsApp + email                | Two large targets                               |
| J   | Footer       | Navigate, legal, identity       | Logo + tagline                                  |

**Above the fold on a 375×667 phone must contain:** logo, headline, the
sub-line explaining CDN, and one CTA. The hero visual may be cropped; the
explanation may not.

### 9.2 Service request — `/request`

Fields, with validation (server-authoritative in all cases):

| Field                       | Required | Validation                                      |
| --------------------------- | -------- | ----------------------------------------------- |
| Full name                   | Yes      | 2–120 chars                                     |
| Email                       | Yes      | Shape check; server re-validates                |
| Phone / WhatsApp            | No       | ≤ 40 chars, permissive format                   |
| Company                     | No       | ≤ 160 chars                                     |
| Service needed              | Yes      | Enum from services config                       |
| Project type                | No       | Enum                                            |
| Project description         | Yes      | 20–4000 chars                                   |
| Budget range                | No       | Enum (ranges, not prices — §35 OD-12)           |
| Timeline                    | No       | Enum                                            |
| How did you hear about CDN? | No       | Enum + optional free text                       |
| Additional information      | No       | ≤ 2000 chars                                    |
| Consent                     | **Yes**  | Must be explicitly checked; links to `/privacy` |

Behaviour: inline validation on blur (never on every keystroke); a submit
button that shows a loading state without changing width; **failure preserves
every entered value**; success redirects to `/request/success` with a reference
number.

### 9.3 Newsletter

One email field plus consent, inline on the landing page. Duplicate submission
returns success, not an error — telling someone "you already subscribed" is
noise, and confirming which addresses are on the list is a disclosure.

### 9.4 Success — `/request/success`

Reference number, what happens next, expected response time, a route back, and
the WhatsApp option for anyone in a hurry. Not indexed.

### 9.5 Contact — `/contact`

WhatsApp (with a pre-filled message), email, expected response time, and the
service-request form as the third option.

### 9.6 Legal — `/privacy`, `/terms`

Required, not optional: the forms collect personal data. Content is a legal
deliverable, not an engineering one (§35 OD-14).

---

## 10. UX and User Flows

```
Understand → Subscribe
  / → read hero + what is CDN → newsletter → inline success

Understand → Contact
  / → header or contact section → WhatsApp (new tab) or mail client

Client → Request
  / → services → "Request a project" → /request → submit → /request/success
                                          ↑ failure returns here, values intact

Partner → Contact
  / → vision → contact → email

Returning visitor (Phase 1+)
  / → header CTA "Enter the network" → /app
```

**Principles applied throughout:** every page has a route out; the primary CTA
is visible without scrolling on every viewport; no interaction depends on
hover; form errors are specific and adjacent to their field; nothing important
depends on animation.

---

## 11. Visual Design Direction

### 11.1 Extracted from the references

- **Near-black ground.** `#07070C` for the page, `#0D0E17` for surfaces. Pure
  black is reserved for the map canvas — the two-step separation is what lets
  panels read as floating without heavy shadows.
- **Neon as emission, not decoration.** Colour appears as glow around a stroke,
  never as large filled areas.
- **The ring is the motif.** A lit circle containing the mark. The hero should
  quote this without reproducing the app screen.
- **Text stays neutral.** `#EDEEF7` for labels. Family hues light strokes,
  rings and dots — never body copy. This is an existing rule in the token file
  and it is also what keeps contrast passing.
- **Dark, generous spacing.** The references breathe; density would read as a
  dashboard rather than a brand statement.

### 11.2 Palette — already in `design/tokens.json`

| Token                 | Hex       | Marketing use                |
| --------------------- | --------- | ---------------------------- |
| `--fam-discover-core` | `#2FD9F5` | Cyan — primary accent, links |
| `--fam-organise-core` | `#8B5CF6` | Purple — secondary accent    |
| `--fam-people-core`   | `#FF4D97` | Pink — the crossing point    |
| `--fam-services-core` | `#FF8A3D` | Orange — services, CTAs      |
| `--fam-create-core`   | `#A3E635` | Lime — creation              |
| `--fam-commerce-core` | `#2DD4BF` | Teal — commerce              |
| `--ground-background` | `#07070C` | Page                         |
| `--ground-surface`    | `#0D0E17` | Cards                        |
| `--ground-ink`        | `#EDEEF7` | All text                     |
| `--ground-muted`      | `#8C8FA8` | Secondary text               |

**No new colours are needed.** Any proposal to add one should be challenged.

### 11.3 Logo usage

Header (≤ 32px tall, mark + wordmark; mark only under 400px), hero (large,
inside the ring treatment), footer (with the tagline lockup), favicon and
touch icons from the mark alone. Supply as **SVG**; the current references are
JPEGs and will not scale or sit on a dark ground cleanly. Clear space equal to
the mark's dot diameter on all sides. Never recolour, rotate, or place on a
light background.

---

## 12. Design System

Reuse the existing system. It is token-driven and already matches the brand.

| Element                                   | Source                    | Phase 0 action              |
| ----------------------------------------- | ------------------------- | --------------------------- |
| Colour, spacing, radius, type scale, glow | `design/tokens.json`      | Use as-is                   |
| Button                                    | `components/ui/Button`    | Use as-is                   |
| TextField                                 | `components/ui/TextField` | Use as-is                   |
| Card                                      | `components/ui/Card`      | Use as-is                   |
| Toast                                     | `components/ui/Toast`     | Use as-is                   |
| Select / Textarea / Checkbox              | —                         | **Add**, matching TextField |
| Section, Container                        | —                         | **Add**, marketing layout   |
| MarketingHeader / Footer                  | —                         | **Add**                     |

Two token additions are likely and should be made in `tokens.json`, not in a
component: a wider `--space-9`/`--space-10` for marketing rhythm, and a
`--text-hero` step above `--text-display`.

**Motion**: fades and 200–400ms transforms only; a slow pulse on the hero ring;
no parallax, no scroll-jacking, no animation library. Every animation must be
removed under `prefers-reduced-motion`, which the existing `transition()`
helper already handles.

---

## 13. Responsive Strategy

Mobile-first. Existing breakpoint tokens.

| Range     | Layout                                                             |
| --------- | ------------------------------------------------------------------ |
| 320–599   | Single column, hamburger nav, full-width CTAs, hero visual reduced |
| 600–899   | Single column wider, 2-up cards, inline nav if it fits             |
| 900–1199  | Two-column hero, 3-up cards, full nav                              |
| 1200–1599 | Max content width 1200px, centred                                  |
| 1600+     | Content capped; background field may extend                        |

Verified at 320, 375, 414, 768, 1024, 1440, 1920. Touch targets ≥ 44×44 CSS px.
No horizontal scroll at any width.

---

## 14. Component Architecture

```
components/
  marketing/
    MarketingLayout.tsx      Header + footer wrapper
    MarketingHeader.tsx      Nav from config, mobile menu
    MarketingFooter.tsx      Nav, contact, legal, social
    Section.tsx              Vertical rhythm + optional heading
    Hero.tsx                 Config-driven
    ServiceGrid.tsx          Maps over services config
    ServiceCard.tsx
    AudienceGrid.tsx
    StepList.tsx             "How it works"
    VisionBlock.tsx
    ContactOptions.tsx       WhatsApp + email
    NewsletterForm.tsx
    NetworkBackdrop.tsx      Decorative, aria-hidden, static SVG
  forms/
    ServiceRequestForm.tsx
    FormField.tsx            Label + control + error + hint
    ConsentCheckbox.tsx
```

Rules: marketing components take **content as props or read config** — they
never contain copy; no marketing component imports from `lib/map`,
`lib/editor`, or any application module; anything used twice becomes a
primitive rather than being copied.

---

## 15. Content Architecture

**The requirement:** changing the WhatsApp number, an email address, the hero
headline, the service list, or the launch status must mean editing one typed
file — never hunting through components.

```
src/config/
  site.ts          Name, tagline, description, domain, launch status
  contact.ts       Email, WhatsApp number + message, response time
  navigation.ts    Header + footer nav, with `enabled` flags
  services.ts      Service catalogue
  seo.ts           Defaults, OG image, title template
  flags.ts         Feature flags
src/content/
  landing.ts       All landing page copy
  audiences.ts
  vision.ts
```

### 15.1 `site.ts`

```ts
export const site = {
  name: 'Creative Design Networks',
  shortName: 'CDN',
  tagline: 'God Gives the Vision. We Build the Connections.',
  description: '…', // one sentence, used by SEO
  domain: '', // OPEN DECISION — OD-7
  launch: {
    status: 'coming-soon', // 'coming-soon' | 'live'
    showDate: false, // OD-9
    date: null,
  },
} as const;
```

### 15.2 `contact.ts`

```ts
export const contact = {
  email: '', // OPEN DECISION — OD-1. MUST be set before launch.
  whatsapp: {
    number: '', // OPEN DECISION — OD-2. E.164, digits only.
    prefill: "Hi CDN — I'd like to talk about a project.",
  },
  responseTime: 'within 2 working days', // OD-3
} as const;

export const whatsappUrl = () =>
  `https://wa.me/${contact.whatsapp.number}?text=${encodeURIComponent(contact.whatsapp.prefill)}`;
```

**Build-time guard:** a test asserts that `contact.email` and
`whatsapp.number` are non-empty when `APP_ENV` is a deployed environment. A
launch with an empty `wa.me/` link is the most expensive small bug available
here, and it is entirely preventable.

### 15.3 `navigation.ts`

Every Phase 1 destination is listed now with `enabled: false`, so Phase 1 is a
flag change:

```ts
export const headerNav = [
  { label: 'What is CDN', href: '/#what', enabled: true },
  { label: 'Services', href: '/services', enabled: true },
  { label: 'Contact', href: '/contact', enabled: true },
  { label: 'About', href: '/about', enabled: false },
  { label: 'Projects', href: '/projects', enabled: false },
] as const;
```

### 15.4 `services.ts`

```ts
export interface Service {
  id: string;
  name: string;
  summary: string;
  detail?: string;
  family: FamilyName; // ties the card to an existing token hue
  order: number;
  enabled: boolean;
  featured: boolean;
}
```

Seeded with the twelve categories supplied. `enabled: false` hides a service
without deleting it; `featured: true` puts it on the landing page while the
rest live on `/services`. **Twelve cards on the landing page is too many** —
feature four to six.

### 15.5 `flags.ts`

`newsletter`, `serviceRequest`, `whatsapp`, `partnerCta`, `blog`, `pricing`,
`appEntry`. Booleans read at render, so a form can be disabled in an incident
without a code change.

### 15.6 Launch status

`site.launch.status` drives the hero status line, the header CTA, and whether
`/app` is linked. Flipping it to `'live'` is a meaningful part of the Phase 1
switch (§28.4).

---

## 16. Technical Architecture

### 16.1 Stack — reuse, do not re-choose

| Concern     | Decision                           | Rationale                  |
| ----------- | ---------------------------------- | -------------------------- |
| Framework   | Next.js 15 App Router              | Already here               |
| Language    | TypeScript strict                  | Already here               |
| Styling     | **styled-components + tokens**     | ADR-0008; **not Tailwind** |
| Validation  | zod                                | Already here               |
| Persistence | SQLite via existing repo layer     | Already here               |
| Email       | Existing outbox                    | Already here               |
| Analytics   | Existing facade + first-party sink | ADR-0009                   |
| Testing     | Vitest, Playwright, Storybook      | Already here               |

**No new runtime dependencies are required for Phase 0.** Any proposal to add
one needs a written justification; introducing Tailwind alongside
styled-components in particular would mean two styling systems and two sources
of truth for the same colours.

### 16.2 The routing change — the one structural task

`/` is currently the application's entry transition. The marketing site needs
it. Recommended resolution:

```
/                 → marketing landing        (new, public, static)
/services /request /contact /privacy /terms  (new, public)
/app              → application entry        (moved from /)
/app/map /app/maps /app/search …             (existing (app) group, re-based)
```

Implementation: a `(marketing)` route group with its own layout beside the
existing `(app)` group; move the current `page.tsx` to `/app`; update
`src/lib/routes.ts` — which is already the single source of route truth, so
the change is contained; add redirects from any old path that may have been
shared.

**Do this first.** It touches routing and every internal link, and it gets
harder the longer the site is live.

### 16.3 Rendering

Landing, services, contact and legal pages are **static**. The forms are
client components posting to route handlers. No application code is imported
into the marketing bundle — enforced by a structural test (§25.5), because a
stray import would pull the canvas renderer into the landing page bundle.

---

## 17. Folder Structure

Adapted to this repository rather than imposed:

```
src/
  app/
    (marketing)/
      layout.tsx
      page.tsx                  /
      services/page.tsx
      request/page.tsx
      request/success/page.tsx
      contact/page.tsx
      privacy/page.tsx
      terms/page.tsx
    (app)/…                     existing application (re-based under /app)
    api/
      newsletter/route.ts       NEW
      service-request/route.ts  NEW
      enquiries/route.ts        EXISTS (P12)
  components/
    marketing/                  NEW
    forms/                      NEW
    ui/                         EXISTS — reuse
  config/                       NEW
  content/                      NEW
  lib/
    services/                   EXISTS — enquiries, spam scoring
    email/                      EXISTS — outbox
    analytics/                  EXISTS — facade
    db/                         EXISTS — migrations, repo
public/
  brand/                        logo.svg, logo-mark.svg, og-default.png
docs/
  decisions/                    ADRs 0001–0009 exist; add 0010
```

---

## 18. Forms and Backend Architecture

### 18.1 How data actually moves

```
Client form (zod, inline errors)
      │  POST JSON
      ▼
Route handler
      ├─ zod parse                → 400 with a specific message
      ├─ rate limit (client hash) → 400, generic
      ├─ spam score               → accept-and-file, never reject visibly
      ├─ WRITE ROW                ← the record of record
      ├─ queue email to business
      └─ queue acknowledgement to sender
      ▼
200 + reference id → /request/success
```

**Ordering is the design.** The row is written before the email is queued. A
submission that exists only as a queued email is one that is lost the first
time a provider bounces it — and the sender never finds out, because from
their side it succeeded. This ordering is already implemented and tested in
the P12 enquiry path; the service-request handler follows it exactly.

### 18.2 Newsletter — new

Table `newsletter_subscribers`: `id`, `email`, `email_lower` (unique),
`source`, `consent_at`, `client_hash`, `confirmed_at`, `unsubscribed_at`,
`created_at`.

Duplicate → success (see §9.3). Rate limit 3/hour per client hash. Honeypot
plus timing check, reusing `scoreSpam`. Unsubscribe token generated at
subscribe time so every email can carry a working link from day one.

> **Double opt-in is recommended but is an open decision (§35 OD-4)**, because
> it depends on the eventual email provider and on the jurisdictions of the
> audience. The schema carries `confirmed_at` either way, so enabling it later
> is a code change and not a migration.

### 18.3 Service request — extends the existing enquiry system

The P12 `enquiries` table and its whole pipeline already exist. Phase 0 adds
the wider field set via an additive migration (`project_type`, `timeline`,
`heard_from`, `phone`, `consent_at`) and a marketing-facing form. **Spam
scoring, rate limiting, storage ordering and email dispatch are reused
unchanged** — they are tested, and re-implementing them would be the most
likely place to introduce a data-loss bug.

### 18.4 Spam protection

Honeypot field (hidden three ways, never `display:none`), a minimum
time-to-submit, link-density and phrase scoring, and per-client rate limits.
**Deliberately no CAPTCHA**: it taxes every real customer to stop a bot that
solves it anyway, and this form stands between the business and its revenue.
Suspected spam is **filed, never discarded** — a false positive is a lost
customer, and the only way to find one is to be able to read what was
filtered.

### 18.5 CRM readiness

Handlers call a `notifyEnquiry()` seam rather than emailing inline, so adding a
CRM later means implementing one function. Not built in Phase 0.

### 18.6 Data retention

Newsletter until unsubscribe. Service requests 24 months. Spam-filed rows 90
days. Stated in the privacy policy and enforced by the existing prune script
pattern.

---

## 19. Security Requirements

| Control                | Approach                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-side validation | zod in every handler; the client is a convenience                                                                                                                |
| Rate limiting          | Per salted client hash, per endpoint                                                                                                                             |
| Spam                   | Honeypot + timing + scoring (§18.4)                                                                                                                              |
| CSRF                   | Same-site cookies; forms post JSON to same-origin handlers                                                                                                       |
| Secrets                | Environment only; a test asserts none are inlined                                                                                                                |
| Error messages         | Specific about _input_, never about internals                                                                                                                    |
| Headers                | HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors                                                                                               |
| CSP                    | Start report-only; enforce before launch. Requires a nonce for styled-components' injected styles — verify in staging, this is the CSP item most likely to break |
| PII                    | Emails never in analytics; IPs hashed with a salt, never stored raw                                                                                              |
| Dependencies           | `npm audit` in CI                                                                                                                                                |

**Scope, stated honestly:** these controls raise the cost of abuse. They do not
guarantee prevention. A determined attacker can still submit junk through a
public form; the goal is that doing so is unrewarding and bounded, and that
nothing they submit reaches a user's browser or the business's inbox as
anything but text.

---

## 20. SEO Requirements

Title template `%s · Creative Design Networks`; landing title under 60
characters and leading with the explanation rather than the tagline;
descriptions 140–160 characters, written for a human.

Open Graph and Twitter card on every page, with a 1200×630 image built from
the logo on the dark ground. Canonical URLs, `robots.txt`, `sitemap.xml`
generated from the route config, `noindex` on `/request/success`.

Structured data: `Organization` on the landing page (name, logo, URL,
`contactPoint`). Do **not** add `Product`, `Review` or `AggregateRating` — the
product is not released and there are no reviews. Marking up things that do not
exist is both a penalty risk and a lie.

Semantic HTML: one `h1` per page, headings that descend without skipping,
`<main>`/`<nav>`/`<footer>` landmarks, real `<button>` and `<a>` elements.

Keywords appear naturally or not at all. No stuffing; nothing that describes
the platform as available.

---

## 21. Accessibility Requirements

Target **WCAG 2.2 AA** on every page. The application already achieves 2.1 AA
across 18 surfaces with an automated axe pass, and the same harness extends to
these routes.

Specific commitments:

- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI boundaries. **The
  neon hues on near-black must be checked as text and will mostly fail** —
  which is why the token rule keeps text at `--ground-ink` and uses hues for
  strokes and glow.
- **Never dim text with `opacity`.** A token that passes at full opacity fails
  at 75%, and it is invisible in review. This exact bug has already occurred in
  this codebase once.
- Visible focus on every interactive element; never remove an outline without
  replacing it.
- Full keyboard operability; a skip link to `<main>`.
- Labels are real `<label>` elements. Errors are associated with
  `aria-describedby` and announced. Consent is a real checkbox.
- `prefers-reduced-motion` removes animation, including the hero pulse.
- Decorative network graphics are `aria-hidden`.
- Touch targets ≥ 44×44.

Automated coverage is necessary and not sufficient — it finds roughly a third
of real barriers. **A manual screen-reader pass on the landing page and the
request form is a launch requirement** (§32).

---

## 22. Performance Requirements

| Metric                          | Target  |
| ------------------------------- | ------- |
| LCP (mobile, throttled 4G)      | ≤ 2.0s  |
| CLS                             | ≤ 0.05  |
| INP                             | ≤ 200ms |
| Landing JS (gzipped)            | ≤ 120KB |
| Lighthouse Performance (mobile) | ≥ 90    |

How: static rendering; the hero visual as an inlined optimised **SVG**, not a
JPEG; `next/image` with explicit dimensions for any raster; `font-display:
swap` with preloaded subsets; no animation library; no third-party scripts in
Phase 0 (first-party analytics per ADR-0009 means no vendor tag).

**The neon aesthetic must not cost performance.** Glow is CSS `box-shadow` and
gradients on a handful of elements — not large images, not canvas, not blur
filters over big areas.

---

## 23. Analytics Requirements

Through the existing facade. Add to the typed event map — the taxonomy is code
and a call site may not invent a string:

| Event                          | Properties                   |
| ------------------------------ | ---------------------------- |
| `marketing_page_viewed`        | `page`                       |
| `marketing_cta_clicked`        | `cta_id`, `section`          |
| `newsletter_subscribe_started` | `source`                     |
| `newsletter_subscribed`        | `source`                     |
| `newsletter_subscribe_failed`  | `reason`                     |
| `whatsapp_clicked`             | `location`                   |
| `email_clicked`                | `location`                   |
| `service_request_started`      | —                            |
| `service_request_submitted`    | `service_id`, `budget_range` |
| `service_request_failed`       | `reason`                     |

**No personal data in properties** — no email addresses, no names, no free
text. Enums, ids, counts and durations only. This is an existing project rule
and the ingestion endpoint already strips non-scalar properties.

Two funnels must be readable at launch: _landing → newsletter_ and _landing →
services → request → success_.

---

## 24. Environment Configuration

| Variable                         | Required | Notes                                          |
| -------------------------------- | -------- | ---------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`           | Yes      | Canonicals, OG, sitemap                        |
| `NEXT_PUBLIC_ANALYTICS_PROVIDER` | Yes      | `beacon` in deployed environments              |
| `CONTACT_EMAIL`                  | Yes      | Or set in config; must not be empty            |
| `WHATSAPP_NUMBER`                | Yes      | E.164                                          |
| `INGEST_HASH_SALT`               | Yes      | Must not be the development default            |
| `APP_ENV`                        | Yes      | `local` / `preview` / `staging` / `production` |
| `APP_VERSION`                    | Yes      | Deploy identification                          |

Validated by the existing zod env module, which fails at boot with a message
naming the missing variable rather than surfacing `undefined` inside a request
six hours later. Extend the existing readiness endpoint to check that contact
details are non-empty in deployed environments.

---

## 25. Testing Strategy

| Level       | Tool                     | Covers                                                              | Passing                   |
| ----------- | ------------------------ | ------------------------------------------------------------------- | ------------------------- |
| Unit        | Vitest                   | Config integrity, validation schemas, `whatsappUrl()`, spam scoring | All green                 |
| Component   | Vitest + Testing Library | Form states, error/success, consent gating                          | All green                 |
| Visual      | Storybook                | Sections and cards at 3 widths                                      | Reviewed                  |
| Integration | Vitest                   | Handlers: validation, rate limit, spam, storage order, email queued | All green                 |
| E2E         | Playwright               | The four flows in §10, on mobile and desktop viewports              | All green                 |
| A11y        | axe via Playwright       | Every marketing route                                               | **0 serious or critical** |
| SEO         | Playwright               | One `h1`, title, description, canonical, OG per page                | All green                 |
| Perf        | Lighthouse CI            | Landing, mobile                                                     | ≥ 90                      |
| Build       | CI                       | `tsc`, lint, format, production build                               | Clean                     |

### 25.5 Structural tests — the ones that catch real drift

Following the existing `chokepoint.test.ts` pattern:

1. **No marketing component imports application code.** A stray import pulls
   the canvas renderer into the landing bundle.
2. **No hardcoded contact details.** Fails if an `@`-bearing string or a
   `wa.me` URL appears outside `config/contact.ts`.
3. **Contact config is populated** in deployed environments.
4. **Every `var(--…)` names a token that exists.** This test already exists and
   already caught a silent failure.

Cross-browser: latest Chrome, Firefox, Safari, Edge; iOS Safari and Android
Chrome. Manual, once, before launch.

---

## 26. Deployment Strategy

Static-first on the existing pipeline. Preview deploy per pull request;
staging mirrors production configuration; production behind a custom domain
(§35 OD-7) with HTTPS and HSTS.

Gate: CI green → preview reviewed → staging smoke test (all four flows,
including a real WhatsApp click and a real form submission) → promote.

Rollback: redeploy the previous build. Because Phase 0 is static plus two
additive tables, rollback is safe — **provided migrations stay additive**,
which is already the project rule.

---

## 27. Monitoring and Error Handling

Reuse what exists: the liveness and readiness endpoints, first-party error
tracking grouped by fingerprint, and the analytics sink.

Phase 0 additions: uptime check on `/` and `/api/health?ready=1` from outside
the host; a **submission-volume alert** — if service requests or subscriptions
drop to zero for 48 hours after a deploy, something is broken and nobody will
notice from the outside; error-rate alert; a React error boundary on each
marketing route that shows a usable page with contact details rather than a
blank screen.

**The failure that matters most here is a silently broken form.** It looks
identical to "no interest this week", which is why the volume alert is listed
as a requirement rather than a nice-to-have.

---

## 28. Coming Soon → Production Migration Plan

The migration is deliberately boring. That is the point of the architecture.

### 28.1 What is preserved

Layout, header, footer, all UI primitives, tokens, forms, handlers, analytics,
SEO infrastructure, route config, legal pages.

### 28.2 What changes

The landing page's hero and section composition; navigation flags flip on; new
pages are added.

### 28.3 What is added in Phase 1

About, Services (expanded), Projects, Solutions, Resources, Pricing (if
approved), and the application entry point.

### 28.4 The switch

1. Set `site.launch.status = 'live'`.
2. Enable `flags.appEntry`.
3. Header CTA changes from "Request a project" to "Enter the network".
4. Hero swaps its Coming Soon composition for the production hero — a content
   change, not a component rewrite.
5. Enable the Phase 1 navigation entries.
6. Add new routes to the sitemap (automatic — it is generated from config).

**No component is deleted. No form is rebuilt. No URL that was shared breaks.**

### 28.5 What would break this plan

Hardcoding copy into components; adding a second styling system; coupling
marketing components to application modules; putting the app back at `/`.
Three of the four are prevented by the structural tests in §25.5.

---

## 29. Future Production Website Architecture

`(marketing)` grows; `(app)` is untouched. Shared: tokens, primitives, config,
SEO, analytics. The two groups communicate only through routes.

When marketing content outgrows typed files — likely around the blog — the
`content/` directory becomes a CMS adapter behind the same interface, so
components do not change. Not before Phase 1.

---

## 30. Phase 0 Task Breakdown

Ordered by dependency. Sizes are relative, not hours.

### Milestone A — Foundation

| #   | Task                                                               | Size | Depends      |
| --- | ------------------------------------------------------------------ | ---- | ------------ |
| A1  | Move app to `/app`, create `(marketing)` group, update `routes.ts` | M    | —            |
| A2  | `config/` and `content/` scaffolding, typed                        | S    | —            |
| A3  | Marketing layout, header, footer                                   | M    | A1, A2       |
| A4  | Logo as SVG, favicons, OG image                                    | S    | brand assets |
| A5  | Section/Container primitives, token additions                      | S    | —            |

### Milestone B — Landing page

| #   | Task                                    | Size | Depends |
| --- | --------------------------------------- | ---- | ------- |
| B1  | Hero, with honest status line           | M    | A3, A5  |
| B2  | What is CDN + How it works (static SVG) | M    | A5      |
| B3  | ServiceGrid from config                 | M    | A2      |
| B4  | Audiences + Vision                      | S    | A5      |
| B5  | Contact options (WhatsApp + email)      | S    | A2      |
| B6  | Responsive pass, 320→1920               | M    | B1–B5   |

### Milestone C — Forms

| #   | Task                                | Size | Depends |
| --- | ----------------------------------- | ---- | ------- |
| C1  | Select/Textarea/Checkbox primitives | S    | A5      |
| C2  | Newsletter table + handler + form   | M    | A2      |
| C3  | Enquiry migration for new fields    | S    | —       |
| C4  | Service request form + handler      | L    | C1, C3  |
| C5  | Success page                        | S    | C4      |
| C6  | Failure-preserves-input behaviour   | S    | C4      |

### Milestone D — Quality

| #   | Task                                           | Size | Depends       |
| --- | ---------------------------------------------- | ---- | ------------- |
| D1  | SEO metadata, sitemap, robots, structured data | M    | B             |
| D2  | Analytics events wired                         | S    | B, C          |
| D3  | Accessibility pass + manual screen-reader test | M    | B, C          |
| D4  | Performance pass to targets                    | M    | B             |
| D5  | Security headers + CSP (report-only → enforce) | M    | —             |
| D6  | Test suites incl. structural tests             | L    | B, C          |
| D7  | Privacy + terms pages                          | S    | legal content |

### Milestone E — Launch

| #   | Task                                  | Size | Depends        |
| --- | ------------------------------------- | ---- | -------------- |
| E1  | Staging deploy + smoke test           | S    | D              |
| E2  | Populate real contact details         | S    | **OD-1, OD-2** |
| E3  | Cross-browser pass                    | S    | E1             |
| E4  | Monitoring + volume alerts            | S    | E1             |
| E5  | Production deploy                     | S    | all            |
| E6  | ADR-0010 recording the routing change | S    | A1             |

---

## 31. Implementation Milestones

| Milestone    | Exit condition                                                                   |
| ------------ | -------------------------------------------------------------------------------- |
| A Foundation | App at `/app`; marketing shell renders; config typed and read                    |
| B Landing    | All sections live, responsive 320→1920, real content                             |
| C Forms      | Both forms submit end-to-end; row written; email queued; failure preserves input |
| D Quality    | A11y 0 serious/critical; Lighthouse ≥ 90; SEO complete; all suites green         |
| E Launch     | Live on the domain, monitored, contact details real and verified                 |

Sequencing note: **A1 first.** It is the only task that gets harder with delay.

---

## 32. Definition of Done

Phase 0 is done only when all of the following are true:

- [ ] The site explains what CDN is; five people unfamiliar with it can say what
      it does after 10 seconds on the page
- [ ] The logo and visual identity are implemented from SVG
- [ ] Responsive with no horizontal scroll at 320, 375, 414, 768, 1024, 1440, 1920
- [ ] WhatsApp opens a chat with the correct number and prefilled message, on
      iOS, Android and desktop
- [ ] Email opens a mail client with the correct address
- [ ] Newsletter works end to end; the row exists; the email is queued
- [ ] Service request works end to end; the row exists; both emails are queued;
      a reference number is shown
- [ ] Both forms validate server-side and preserve input on failure
- [ ] SEO: titles, descriptions, canonicals, OG, sitemap, robots, Organization
- [ ] axe reports 0 serious or critical on every marketing route
- [ ] **A manual screen-reader pass has been completed** on the landing page
      and the request form
- [ ] Lighthouse mobile Performance ≥ 90 on the landing page
- [ ] Security headers set; CSP enforced; no secrets in the bundle
- [ ] Analytics events fire and both funnels are readable
- [ ] All content is in `config/` or `content/`; the structural tests pass
- [ ] The migration path in §28 is documented and ADR-0010 is written
- [ ] Production build passes; no console errors or warnings
- [ ] Deployment and rollback are documented
- [ ] **No page claims the platform is available**

---

## 33. Acceptance Criteria

Observable behaviour only.

**AC-1 Landing comprehension.** On a 375×667 viewport with no scrolling, the
page shows the logo, a headline, a sentence explaining CDN, an explicit
pre-launch statement, and at least one CTA.

**AC-2 Navigation.** Every header link resolves to a 200 page. At < 900px a
menu button opens a panel, traps focus, closes on Escape, and returns focus to
the button.

**AC-3 WhatsApp.** The CTA opens `https://wa.me/<number>?text=<prefill>` in a
new tab with `rel="noopener"`. The number matches `contact.ts`. It appears
nowhere else in the source.

**AC-4 Email.** The CTA opens `mailto:` with the configured address, which
appears nowhere else in the source.

**AC-5 Newsletter — success.** A valid address shows a success message without
a page navigation within 2 seconds, and a row exists in
`newsletter_subscribers`.

**AC-6 Newsletter — duplicate.** Submitting the same address twice returns
success both times and creates exactly one row.

**AC-7 Newsletter — invalid.** An invalid address shows an error adjacent to
the field, associated by `aria-describedby`, and no row is created.

**AC-8 Newsletter — consent.** Submission is blocked until consent is checked.

**AC-9 Service request — success.** A valid submission redirects to
`/request/success`, displays a reference number matching the stored row, and
queues two emails — one to the business containing every submitted field, one
to the sender.

**AC-10 Service request — validation.** Each required field left empty produces
a specific message naming that field. Description under 20 characters is
rejected.

**AC-11 Service request — failure preserves input.** On a rejected submission,
every previously entered value is still present in the form.

**AC-12 Spam — honeypot.** A submission with the honeypot filled returns the
same response as a real one, is stored with spam status, and queues **no**
email.

**AC-13 Rate limit.** The 4th service request from one client within an hour is
rejected with a specific message; the first three succeed.

**AC-14 Accessibility.** axe at WCAG 2.2 AA reports 0 serious or critical on
`/`, `/services`, `/request`, `/request/success`, `/contact`, `/privacy`,
`/terms`. Every interactive element is reachable and visibly focused by
keyboard.

**AC-15 Reduced motion.** With `prefers-reduced-motion: reduce`, no element
animates, and all content remains visible.

**AC-16 SEO.** Each page has exactly one `h1`, a unique title ≤ 60 chars, a
description 140–160 chars, a canonical, and OG tags. `/sitemap.xml` lists every
enabled public route and no disabled one. `/request/success` is `noindex`.

**AC-17 Performance.** Lighthouse mobile: Performance ≥ 90, Accessibility ≥ 95,
Best Practices ≥ 95, SEO ≥ 95. LCP ≤ 2.0s on throttled 4G.

**AC-18 Content centralisation.** Changing the hero headline, WhatsApp number,
contact email, or service list requires editing only files under `config/` or
`content/`. Verified by making each change and confirming it appears.

**AC-19 Honesty.** No page contains a sentence asserting a platform feature is
currently available. Reviewed by a person against §7.2 before launch.

**AC-20 No app coupling.** The structural test confirms no `components/
marketing/**` file imports from `lib/map`, `lib/editor`, or `components/map`.

**AC-21 Launch switch.** Setting `site.launch.status = 'live'` and
`flags.appEntry = true` changes the header CTA and reveals the app entry with
no other code change. Verified in staging.

---

## 34. Risks and Mitigations

| Risk                                            | Sev      | Mitigation                                                     |
| ----------------------------------------------- | -------- | -------------------------------------------------------------- |
| Contact details empty at launch                 | **High** | Config guard + readiness check + AC-3/AC-4; E2 blocks launch   |
| A form silently breaks post-launch              | **High** | Volume alert (§27); E2E in CI                                  |
| Site implies the platform is live               | **High** | §7.2 tense rules; AC-19 human review                           |
| Marketing content contradicts ADR-0003 ring one | Med      | §3.3 flagged; content review against the seed                  |
| Routing move breaks internal links              | Med      | `routes.ts` is single source; do it first (A1); redirects      |
| CSP breaks styled-components                    | Med      | Report-only first; nonce verified in staging (§19)             |
| Neon fails contrast                             | Med      | Text stays `--ground-ink`; automated check; no opacity dimming |
| Performance lost to the aesthetic               | Med      | SVG not raster; no animation library; budget in CI             |
| Tailwind introduced alongside styled-components | Med      | ADR-0008; challenge in review                                  |
| Scope creep into Phase 1 pages                  | Med      | Flags exist but stay off; §8 fixed                             |
| Spam floods the inbox                           | Low      | §18.4; filed not discarded                                     |
| Logo only exists as JPEG                        | Low      | A4 blocks on an SVG being supplied                             |

---

## 35. Open Decisions

**These must be answered by the business. They are not invented here.**

| ID    | Decision                                     | Blocks      | Recommendation                              |
| ----- | -------------------------------------------- | ----------- | ------------------------------------------- |
| OD-1  | **Business email address**                   | Launch (E2) | —                                           |
| OD-2  | **WhatsApp number (E.164)**                  | Launch (E2) | —                                           |
| OD-3  | Stated response time                         | Content     | "within 2 working days" if achievable       |
| OD-4  | Newsletter double opt-in                     | C2          | Yes, if the audience includes the EU        |
| OD-5  | Email/newsletter provider                    | C2          | Defer; outbox already abstracts it          |
| OD-6  | Analytics provider                           | —           | **Settled** — first-party, ADR-0009         |
| OD-7  | Domain                                       | Deploy      | —                                           |
| OD-8  | Hosting provider                             | Deploy      | —                                           |
| OD-9  | Show a public launch date                    | B1          | No — "soon" until a date is certain         |
| OD-10 | Which platform features to describe publicly | Content     | Themes only, no mechanics                   |
| OD-11 | Partner/investor CTA on the landing page     | B4          | Footer link only, not a section             |
| OD-12 | Publish budget ranges in the form            | C4          | Ranges yes, prices no                       |
| OD-13 | Faith-based tagline placement                | B1          | Logo lockup + footer, not the hero headline |
| OD-14 | Who writes privacy and terms                 | D7          | Legal review required                       |
| OD-15 | Which services to advertise initially        | B3          | Feature 4–6 of the 12                       |
| OD-16 | Company legal entity name and address        | D7          | Required for the privacy policy             |

---

## 36. Recommended Next Steps

1. **Answer OD-1 and OD-2.** Everything else can proceed; launch cannot.
2. **Supply the logo as SVG.** Blocks A4.
3. **Approve §7's messaging rules and OD-13.** They shape all copy.
4. **Approve the routing change (§16.2)** and start A1 — it is the only task
   that gets more expensive with delay.
5. **Choose the featured services (OD-15).**
6. **Commission privacy and terms (OD-14, OD-16).** Long lead time; blocks
   launch, not development.
7. Then run Milestones A → E in order.

---

## Appendix A — Completeness review

Checked against every requirement in the brief before submission.

**Covered:** all 36 required sections; every landing section; every service
request field; WhatsApp and email as configuration; newsletter with provider
abstraction; flexible service content; migration strategy; folder structure;
forms and backend data flow; security; SEO; accessibility; performance;
analytics; environment; testing; deployment; monitoring; phases 0/1/2;
configuration for all eleven named areas; measurable acceptance criteria;
definition of done; risks; open decisions.

**Deviations from the brief, and why:**

1. **Tailwind is not recommended.** The brief allowed "Tailwind CSS **or the
   project's existing styling system if already established**". styled-
   components with a token pipeline is established and is the source of the
   neon palette. Adding Tailwind would mean two styling systems and two sources
   of truth for the same colours.

2. **Far less is built from scratch than the brief anticipates.** The brief
   reads as though for a new repository. Roughly 60% of the required backend
   already exists here, tested. The roadmap reuses it and says so, because
   re-implementing a tested enquiry pipeline is the most likely way to
   introduce a data-loss bug.

3. **One structural change is required that the brief does not mention** — the
   application currently occupies `/`. This is unavoidable and is cheapest now.

4. **The analytics provider is already decided** (ADR-0009, first-party), so
   OD-6 is marked settled rather than open.

**Business information deliberately not invented:** email address, WhatsApp
number, domain, host, launch date, response time, pricing, legal entity. All
are open decisions with empty configuration placeholders.

**Assumptions recorded:** the site is English-only in Phase 0; the audience is
international, so double opt-in is recommended pending OD-4; the twelve service
categories supplied are the starting catalogue and are configurable; "Coming
Soon" is a phase, not a permanent state.
