# ADR-0006: Private maps are not content-scanned

**Status:** Accepted
**Date:** 2026-08-31
**Phase:** P0

## Context

Two stated goals are in genuine tension: the platform should be "limitless for everyone", and it must prevent illicit activity.

Resolving this by scanning everything is superficially safer but creates a moderation obligation across every private document on the platform — an obligation that cannot be staffed at this size, and a privacy position that cannot be walked back once taken.

## Decision

- **Private maps are private and are not content-scanned.**
- **Anything made public or link-shared is screened** on publish: text classification, domain blocklist, known-bad URL check.
- **Outbound links to known-bad domains are blocked in both**, because that is a safety measure against malware and phishing rather than a judgement about content.
- Reporting, the moderation queue and the audit trail cover everything that has been made visible to someone else.
- This is stated plainly in the privacy policy before launch, in words a user can understand.

## Consequences

**Easy.** Defensible, implementable within the MVP window, and honest with users. Moderation load scales with public content, which is the part that can actually be reviewed by a small team.

**Hard.** Private maps could contain material we would not want hosted, and we will not know. The position must be explained clearly if it is ever challenged — which is why it is written down here rather than left implicit in the code.

**Reversing it.** Very expensive in one direction. Beginning to scan previously unscanned private content is a privacy-policy change with notification obligations and a probable trust cost. Treat this as close to irreversible and revisit only with legal input.

## Alternatives considered

- **Scan everything.** Rejected: unstaffable at this size, and it makes a promise in reverse that cannot be undone.
- **Scan nothing.** Rejected: public content is where harm reaches other people, and leaving it unscreened is indefensible.
- **Scan private content only on report.** Considered. Kept in reserve as a possible middle path, but not in the MVP because there is no reporting surface for content nobody else can see.
