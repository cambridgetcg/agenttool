# Zerone Agent Host package instructions

## Scope

This private Bun-only package is a local durability and concurrency boundary for a future Zerone agent execution host. It owns hardened SQLite state, compare-and-swap binding heads, capability and treasury reservations, Cosmos account sequence fences, sticky ambiguity, and injected positive-evidence reconciliation.

## Hard boundaries

- Do not add an RPC URL, credential lookup, private key, custody implementation, background worker, automatic signing, broadcast retry, or hosted route.
- Do not claim that Zerone agent-economy messages can be planned or executed. Wallet Zerone 0.1 does not admit them. `EXECUTION_SUPPORT` must remain explicit until a separately reviewed native planner exists.
- Binding proof references are opaque results from an injected resolver. This package persists and CAS-compares them; it does not turn the economy package's unsigned candidate into a verified proof.
- Persist the signer-invocation boundary before any possible signer call. Every post-signer state is sticky and holds its sequence fence until positive chain evidence shows the account sequence advanced beyond the reserved sequence.
- Treat crashes left in `signing` or `submitting` as unknown during explicit cold-start recovery. Absence, timeout, and unavailable lookups never release state.
- Reorg transitions require positive canonical-block replacement evidence. Never infer a reorg from transaction absence.
- Keep all lifecycle transition inputs injected and evidence-shaped. This v0 ledger does not invoke a signer or broadcaster.
- Use immediate SQLite writer transactions for every authorization, reservation, lifecycle, and reconciliation mutation.
- Preserve 0600 regular-file semantics for the database and all SQLite sidecars; reject symlinks, hardlinks, unowned or group/other-writable parents.

## Verification

Run `bun run ci`. Tests must remain local and credential-free.
