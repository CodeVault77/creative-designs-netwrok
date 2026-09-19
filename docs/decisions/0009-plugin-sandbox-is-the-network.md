# ADR-0009 — The plugin sandbox is the network, not a VM

**Status:** Accepted
**Date:** 2026-09-05
**Phase:** 7 — Ecosystem

## Context

Phase 7 calls for "a plugin framework with sandboxing". The obvious reading is
that third parties upload JavaScript and we run it here, safely. That reading
has to be examined before it is adopted, because it is the expensive one and
because a sandbox nobody has verified is worse than no sandbox: it gets
trusted.

Three options were considered.

**Node's `vm` module.** Rejected. Node's own documentation states that `vm` is
not a security mechanism. Escapes are a genre rather than an incident —
reaching the host realm through a constructor on any object that crosses the
boundary has been rediscovered for over a decade. And even a perfect isolate
would not address the two failures that actually matter at our scale: a plugin
that holds the event loop, and a plugin that allocates until the process dies.
Both take down every tenant on the instance, and neither is a permission bug
that a capability check can prevent.

**`isolated-vm` or a WASM guest.** Genuinely solves memory safety, and both
remain viable later. Neither is a dependency this deployment can carry today.
`isolated-vm` is a native module that must match the Node ABI on every host,
which is a real operational cost on a platform we do not control. A WASM guest
needs a host ABI and an SDK before a plugin author can write a line — that is a
project, not a phase. Choosing either is a decision with a cost, and pretending
to have made it by shipping `vm` and calling it a sandbox would be dishonest.

**Out of process, over the network.** Chosen.

## Decision

A plugin does not execute in this process. It is three things:

- **Data in.** A manifest, validated by `lib/plugins/manifest.ts`, declaring
  node types built from a fixed vocabulary of field kinds. No code, no JSON
  Schema to compile, no expressions to evaluate. A plugin cannot declare an
  action, because an action is a verb we would then have to run.
- **Events out.** Signed webhooks to the plugin's own server, which is where
  its code runs — its process, its machine, its bill.
- **Actions in.** Through the public API, with a scoped key whose scopes are
  `min(what the manifest asked for, what the installer granted, what the
installer may actually do)`.

The isolation boundary is therefore the network: separate process, separate
machine, separate failure domain, no shared memory, no shared event loop.

## Consequences

**What this buys.** A stronger boundary than any in-process sandbox provides,
with no native dependency and no interpreter of our own to defend. A runaway
plugin costs its author money and affects nobody else. Revocation is complete
and instant, because everything a plugin holds — its key, its endpoint — is
owned by an installation row and dies with it.

**What it costs, plainly.** A plugin cannot render custom UI inside our canvas.
It cannot act with lower latency than an HTTP round trip. A plugin author needs
somewhere to host a server, which raises the floor for a hobbyist. These are
real, and they are accepted.

**What still has to be right here.** Namespacing. A plugin's node type is
registered as `<slug>.<id>`, where the slug comes from the `plugins` table and
never from the manifest, so a plugin cannot declare a type called `note` and
replace the built-in one for everyone who installs it. `loadPlugin` refuses to
overwrite an existing id rather than winning a collision.

**Revisit when** a plugin genuinely needs to render in the canvas, or when the
hosting requirement is demonstrably keeping authors away. The successor is a
WASM guest with a declared host ABI — not `vm`.

## Related

- `src/lib/plugins/loader.ts` — the argument, in the code it governs
- `src/lib/api/scopes.ts` — why a scope narrows and never widens
- ADR-0008 — frontend stack
