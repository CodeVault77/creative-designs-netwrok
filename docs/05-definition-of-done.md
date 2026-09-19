# Definition of Done

**Status:** Ratified · **Date:** 2026-08-31 · **Phase:** P0

A phase is done when every line below is true. Not "done except accessibility". Not "done, tests to follow".

The reason this is a P0 artifact rather than a P13 checklist: §23 rates _"discovering accessibility debt at P13"_ as a High risk, and the stated mitigation is auditing from P3 onward. That only happens if the standard exists before the work does.

---

## Every pull request

- [ ] `npm run verify` passes — typecheck, lint, format, unit tests
- [ ] Production build passes in CI
- [ ] Inside the phase's scope per §20; nothing from the deferred list in §04
- [ ] Any scope or decision change has a `docs/decisions/` record and product-owner approval

## Every screen

- [ ] All states from the §08 state matrix implemented: **loading, empty, error, permission** — or explicitly marked not applicable, with the reason
- [ ] Coming Soon variant where §08 specifies one
- [ ] Mobile (< 600) and desktop (≥ 1024) both correct; §17 gives the breakpoint behaviour
- [ ] Real copy, not placeholder. Errors say what went wrong and how to fix it
- [ ] Analytics events for the phase are emitting (see the table in `03-analytics-plan.md`)

## Every interactive component

- [ ] Keyboard operable, with a visible `:focus-visible` state
- [ ] Hit targets ≥ 88 px on touch, ≥ 44 px on pointer (§17)
- [ ] State communicated in at least two channels, never colour alone (§10)
- [ ] `prefers-reduced-motion` honoured — the global rule covers transitions; JS-driven animation must check it explicitly
- [ ] Announced correctly by a screen reader, or deliberately `aria-hidden` with an accessible equivalent elsewhere

## Anything touching the map

- [ ] Frame rate measured on a real mid-range Android, not a desktop throttle profile
- [ ] Node budget for the breakpoint respected (§17)
- [ ] Tree view renders the same data and stays in sync
- [ ] No live `box-shadow` or `filter` glow per node; glow comes from pre-baked sprites (§16, §23)
- [ ] No per-node styled-components (ADR-0008)

## Anything touching permissions or sharing

- [ ] Filtering happens **server-side**. A test asserts private node data never appears in any response body
- [ ] Role matrix from §15 covered by tests, including the negative cases
- [ ] Search results are permission-scoped; private content is excluded silently, never teased

## Anything user-generated reaching another user

- [ ] Reportable
- [ ] Screened on publish per ADR-0006
- [ ] Rate-limited

---

## Phase exit

- [ ] The phase's acceptance criteria in §20 demonstrably met — shown working, not asserted
- [ ] Metrics for the phase visible in the analytics sink
- [ ] Known gaps written down as issues, not carried in someone's head
- [ ] The roadmap updated if reality diverged from the plan. A roadmap nobody corrects stops being used
