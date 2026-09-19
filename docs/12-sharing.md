# Sharing & Roles (P7)

**Status:** Shipped · **Date:** 2026-08-31 · **Phase:** P7

Implements §08 screens 11 and 12, and §15 (collaboration and permissions).

---

## The security review

§20's acceptance criterion for this phase is not a feature check. It is a review: **"no private node data in any shared response body."**

`npm run verify:sharing` runs 34 checks that read **raw HTTP bodies and raw server-rendered HTML** and look for strings that must not be there. It never asks whether the UI hides something — a UI test passes happily while the secret sits in the network tab, which is the exact failure being guarded against. Every secret is a unique marker, so a match is unambiguous.

Plus 61 unit tests asserting on the payload object itself.

### It found a real leak

The first run failed one check, and it was worth having:

> `FAIL an invited member does NOT see the private node — via /api/maps`

`/api/maps/<id>` — the **editor** endpoint, not the share endpoint — returned the stored map verbatim. The visibility predicate from P6 decides _whether_ you may read a map; it says nothing about _which nodes_. So an invited viewer received the owner's private nodes in full, and the editor **page** would have put them in the server-rendered HTML where view-source reaches them.

Both now run the same filter as the share route. The general lesson is in the code comment: **two endpoints returning the same map with different filtering is precisely how one of them ends up wrong.**

## The filter

`src/lib/sharing/payload.ts` is the only thing that turns a stored map into something a viewer receives. Two rules make it hard to get wrong:

**1. It builds a new object field by field.** Never a spread with deletions on top. A spread means the default is _include_, so any field added later leaks until someone remembers to exclude it. Here the default is _omit_ — a new field must be deliberately added to be shared.

**2. A private node takes its whole subtree.** Excluding the node but keeping its children leaves orphans dangling from a parent that is not there — visible structure the owner meant to hide.

It is pure, so it is tested exhaustively with no database and no request.

### node-viewable

§15: _"Viewers see structure, titles and shape — taps do not open detail."_

|     | Sent                                                            | Withheld                         |
| --- | --------------------------------------------------------------- | -------------------------------- |
| ON  | everything                                                      | private subtrees                 |
| OFF | id, parent, slot, title, family, type, status, weight, position | description, href, icon, payload |

Owners, staff and members always see detail — node-viewable is a setting about the people you shared **with**, not about people already inside.

### Private nodes

Hidden from **members too**, not only strangers. A per-node override inside an already-shared map is pointless if the people you shared with can still see it. The root is never hidden: a map with no root renders as nothing, which reads as broken rather than as private.

The payload reports `hiddenCount` so the UI can say "3 nodes kept private" honestly rather than pretending the map is complete.

## The role matrix

Pure and data-driven in `roles.ts`, so it can be read at a glance and asserted cell by cell. Permission logic scattered through route handlers is how a role quietly gains a capability nobody granted it.

Two rules that are obvious once stated and absent from most implementations:

- **An admin cannot promote anyone to admin.** Otherwise the ceiling is not a ceiling — one admin mints another and privilege escalates sideways.
- **An admin cannot demote another admin.** Two admins could remove each other, and the outcome depends on who clicks first.

Also: admins cannot delete the map (§15). Deleting is the one action with no undo and no partial form, so it stays with the single person who owns it.

`RoleMenu` builds its options from `canAssignRole` — the same function the server enforces with. The menu therefore cannot offer something the server will refuse, and the rule does not live in the UI.

## Tokens

Share links and invite links are **bearer credentials**: whoever holds the string gets the access. Both are stored **hashed**, so a database dump is not a set of working links — and unlike a password, nobody can change a leaked one.

The consequence is stated plainly in the share sheet: **the link is shown once**. It cannot be displayed again, only replaced.

- **One live link per map.** Several would each need their own revoke control and their own "who has this" answer.
- **Creating a new link revokes the old one**, immediately.
- **A revoked or unknown token is 404, never 403.** A 403 would confirm the link was real, which turns a leaked-and-revoked link into information.
- **A token for a private map does not open it.** Visibility and the token are separate gates; making the map private kills every link without needing to revoke anything.

## Email — the honest gap

**There is no mail provider configured.** Choosing one has cost, deliverability and privacy implications that belong with the product owner.

Rather than pretending or dropping the mail:

- invites are **queued** in an `outbox` table, so everything already invited can be delivered once a provider exists;
- the invite link is **handed back to the inviter** in the UI, with copy saying exactly why.

The feature genuinely works — you copy the link and send it yourself. That is a much smaller lie than a "sent!" toast for mail that went nowhere.

## Known gaps

- **No mail delivery.** See above. `pendingEmails()` has everything waiting.
- **Editor role cannot yet write.** The matrix grants `editNodes`, but P6's write predicate is still owner-only and P7 did not widen it. An editor can read and is listed correctly; their edits are refused. **This is the most visible gap** — it makes "Editor" currently mean "Viewer who is labelled Editor". Widening the predicate needs the same cross-user test sweep P6 did, and doing that properly is a phase of its own.
- **Ownership transfer is in the matrix, not in the UI.** §15 requires it to be "explicit and confirmed"; the capability exists and the flow does not.
- **No publish gate.** §15 requires a ToS acknowledgement the first time someone makes anything public. Not built.
- **No automated screening on publish.** §15 requires text classification, a domain blocklist and a known-bad URL check before anything goes public. Not built — this belongs with P13 and is a launch blocker, not a nice-to-have.
- **Map chat, presence and activity** (§15) are P11.
- **Rate limits on invites** are not in place. The per-process limiter on sign-in is not applied here.
