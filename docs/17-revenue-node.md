# 17 — Revenue node (P12)

Screen 17. A service page that sells something and captures enquiries.

§20 rates the risk **Low** and adds the line that shapes the whole phase: _"do
this early if cash matters more than polish."_ So this is deliberately the
simplest thing that can carry revenue — a page, a form, a row in a table, an
email — and the engineering effort went into the two ways it silently loses
money rather than into the page.

---

## The two expensive failures

Both are invisible from the sender's side, which is exactly why they get tests
rather than a manual check.

**1. An enquiry that is accepted and then lost.**

The order of operations is the answer:

```
validate → score → WRITE THE ROW → queue the email
```

The row is the record. Mail is best-effort and always has been; an enquiry that
exists only as a queued message is one you lose the first time a provider
bounces it, and the person who sent it will never know, because from their side
it succeeded.

**2. A real customer classified as spam.**

Which is why **nothing is ever discarded**. A message over the threshold is
filed with `status = 'spam'` and its reason, and stays readable. A false
positive is a lost customer, and the only way to find one is to be able to look
at what was filtered.

---

## Spam protection, without a CAPTCHA

A CAPTCHA taxes every real customer to stop a bot that solves it anyway. This
is the form standing between the business and its first revenue, so the cost
asymmetry decides it: some junk in an inbox is cheap, a customer who gave up is
not.

Instead, cheap signals, **scored rather than absolute**, with a threshold of 60:

| Signal                | Weight      | Note                                                                                   |
| --------------------- | ----------- | -------------------------------------------------------------------------------------- |
| Honeypot filled       | 100         | Decisive. Nothing legitimate ever fills a hidden field.                                |
| Submitted under 3s    | 40          | Only when a timing was reported — see below.                                           |
| 3+ links              | 30 + 5/link | Lenient: one link is normal.                                                           |
| Links with no prose   | 45          | 3 links in a paragraph is a person showing their work; 3 links and 11 words is a drop. |
| Bulk-outreach phrases | 20 each     | Weak individually.                                                                     |
| No word breaks        | 40          | Machine output.                                                                        |
| Repeated characters   | 30          | `aaaaaaaaaa`.                                                                          |

Two details worth keeping:

- **A missing timing is treated leniently, not suspiciously.** No `elapsedMs`
  means JavaScript did not run — penalising it would target exactly the people
  with the most restrictive browsers.
- **The honeypot is hidden three ways at once** — off-screen, zero opacity,
  `aria-hidden` with `tabIndex={-1}` — because a bot checking only one still
  fills it in. It is deliberately _not_ `display: none`, which some bots skip.

A spam verdict returns **the same response as a real submission**. Telling a bot
which message tripped the filter is how it learns to get past it, and telling a
misclassified person "your message looks like spam" is worse than useless — they
have no appeal and no idea what to change.

Rate limits are 3/hour and 8/day per salted client hash. Filtered enquiries
count, or the limit is not a limit. IPs are never stored.

---

## The page

`ServiceHero`, `CapabilityList`, `WorkGrid`, `EnquiryForm` — the four named
components, plus the trust row.

- **Public.** No sign-in wall: this page exists to be found by people who do not
  have an account and may never want one. That would be the most expensive gate
  in the product.
- **§08 screen 17: "Pricing and checkout marked Soon; enquiry is live."** An
  honest price range with a `Checkout soon` badge, rather than a checkout that
  does not exist.
- **§08 screen 17: "No case studies: capability list only."** The work section
  is _absent_ when empty, not present-and-empty — a heading over nothing reads
  as a page that failed to load.
- **§08 screen 17: "Form submit failure preserves entries."** Nothing is cleared
  until the server confirms. Someone who has just written six sentences about
  their project must not lose them to a flaky connection. The harness asserts
  this on a genuinely rejected submit.

The catalogue is **code, not a CMS**. A content system for two services is a
second system to run before there is a second editor to run it.

---

## Reaching an inbox

Two emails, because §20's criterion is that the enquiry _arrives_:

- to the business, with everything typed, the service name in the subject, and
  the reference;
- to the **sender**, with their own words back — because from their side, "did
  that go anywhere?" is answered by an email or by nothing at all.

The read side (`GET /api/enquiries`) is **staff-only**, returning 404 rather
than 403. The write side is deliberately open; the read side holds other
people's names, addresses and what they are working on.

---

## A bug this phase found

`queueEmail` had no injectable database — it always called `getDb()`. That made
**anything that sends mail untestable in isolation**: a test running against an
in-memory database queued its row into the real dev file, and the assertion saw
an empty outbox. It now takes an optional `db` like every other repository
function, and the enquiry path passes its own through.

Worth noting because the test did not merely fail — it failed in the direction
that would have let a broken email path ship. The row was written, the form said
thank you, and nothing was in the outbox the test could see.

---

## Verifying

```bash
npm run verify:enquiry   # needs the app running: npm run build && npm start
```

24 checks. The important ones open the **database** rather than trusting the
screen:

- the page is public, with hero, capabilities, work, and Soon-marked pricing
- **the criterion**: fill the real form, then assert the row exists with every
  field, and that mail is queued to the business _and_ to the sender with the
  right content and subject
- spam: honeypot driven the way a bot would, same response as a real send, filed
  not delivered, still readable, nothing emailed
- a flood from one sender is stopped
- a rejected submit says why **and keeps everything typed**
- the inbox is staff-only (404, not 403)

The harness clears `enquiries` and `outbox` first, since rate limits persist and
would otherwise throttle the second run.

---

## Known gaps

- **No payments.** ADR-0005 defers Stripe to month 4; §20 is explicit that the
  enquiry form converts fine at this stage.
- **No staff inbox UI.** The API is there and locked; reading it today means
  calling the endpoint. Screen 21's moderation queue is the natural home.
- **Mail is queued, not sent.** There is still no provider wired up — the outbox
  is drained by a job that does not exist yet. That is honest rather than
  broken: the enquiry is durable, and connecting a provider is one function.
- **`status` has no transitions.** Rows are written `new` or `spam`; nothing
  moves them to `read` or `archived` yet.
- **Spam thresholds are untuned.** They are guesses backed by tests over
  plausible messages, not by real traffic. The score is stored so a threshold
  change can be reasoned about against enquiries already received.
