# ADR-0010 — OIDC only; SAML is deliberately not implemented

**Status:** Accepted
**Date:** 2026-09-05
**Phase:** 8 — Enterprise and devices

## Context

Phase 8 calls for SSO. In enterprise sales the word usually means SAML 2.0 —
it is what a procurement checklist asks for, and it is what an IT department
expects to configure. Not implementing it needs a reason, because the cost of
saying no is real: some deals will ask for it.

## Decision

Implement **OIDC only**. Do not implement SAML.

## Why

**SAML authentication is XML signature verification, and XML signature
verification is very hard to do correctly.** The security of the whole flow
rests on validating a digital signature over an XML document that the attacker
supplies. XML signature wrapping — restructuring a document so that the
signature still validates over one element while the application reads a
different one — has produced authentication bypasses in a long list of
implementations, including several written by teams who work on nothing else.
The attack class is over fifteen years old and still finds new victims,
because the underlying spec permits a document to be canonicalised,
transformed and dereferenced in ways that make "what was actually signed" and
"what the application read" different questions.

A half-correct SAML implementation is worse than none. It would be trusted by
buyers, by their auditors and by us, and its failure mode is silent: an
attacker signs in as anyone, and the logs say a legitimate sign-in happened.

**OIDC has one signature over one string.** An ID token is a JWS: three
base64url segments, and the signature covers exactly `header.claims`. There is
no canonicalisation, no transform pipeline, no reference resolution. The checks
that matter are enumerable, and each one is a named test in
`src/lib/enterprise/oidc.test.ts` — algorithm allow-list, issuer, audience,
expiry, nonce, and a key-type match that closes algorithm confusion.

**Coverage is not the problem it used to be.** Every identity provider an
enterprise buyer is likely to already have — Okta, Microsoft Entra, Google
Workspace, Ping, JumpCloud, OneLogin, Auth0, Keycloak — speaks OIDC. SAML-only
providers exist but are increasingly legacy, and the buyers who have them
usually have an OIDC path too.

## Consequences

**Accepted.** Some procurement checklists will say "SAML" and will need a
conversation. That conversation is a better outcome than an authentication
bypass we did not know we had shipped.

**If SAML becomes genuinely necessary**, the answer is not to write one. It is
to put a purpose-built identity broker in front — Keycloak, Dex, or a
commercial equivalent — configured to accept SAML from the customer and
present OIDC to us. That moves the XML parsing into software that is
maintained, audited and updated by people who specialise in it, and leaves
this codebase with the one code path it already has tests for.

## What was built instead

- Full OIDC authorisation-code flow with **PKCE**, even though this is a
  confidential client — PKCE binds the code to the browser, which the client
  secret does not do.
- **Discovery at configuration time**, so a typo is caught by the admin who
  made it rather than by every employee tomorrow morning, and so a sign-in
  does not depend on the provider's discovery document being reachable.
- **Enforcement requires proof.** SSO cannot be made mandatory for an
  organisation until at least one person has successfully signed in through
  the connection — otherwise one click locks everyone out of a misconfigured
  provider.
- **The owner is exempt from enforcement**, as a break-glass path. A smaller
  risk than an organisation that cannot recover its own account.
- **Identity is the `sub` claim, never the email.** Emails get reassigned, and
  an email-keyed identity is an account takeover waiting for an ex-employee's
  address to be given to somebody new.

## Related

- `src/lib/enterprise/oidc.ts` — the verifier, with each check argued in place
- `src/lib/enterprise/oidc.test.ts` — mostly forgeries
- `src/lib/enterprise/sso.ts` — connections, provisioning, enforcement
