# Zerone Agent Host package instructions

## Scope

This private Bun-only package is a local durability and concurrency boundary for a future Zerone agent execution host. It owns hardened SQLite state, compare-and-swap binding heads, capability and treasury reservations, Cosmos account sequence fences, sticky ambiguity, and injected positive-evidence reconciliation.

## Hard boundaries

- Do not add an RPC URL, credential lookup, private key, custody implementation, background worker, automatic signing, broadcast retry, or hosted route.
- Do not claim that Zerone agent-economy messages can be planned or executed. Wallet Zerone 0.1 does not admit them. `EXECUTION_SUPPORT` must remain explicit until a separately reviewed native planner exists.
- Persist and cryptographically reverify the full portable economy dual-key proof envelope. Derive the binding only from that verified envelope; never accept a separately supplied binding projection.
- Keep proof verification and currentness separate. Currentness is a closed, content-addressed, nonauthorizing assertion from an injected resolver. Validate its exact proof/binding linkage and `[verified_at, valid_until)` chronology, but never claim that the host authenticated the resolver, consulted a registry, or established freshness with a trusted clock.
- Bind every head CAS, operation, reservation event, and signer replay to the exact `(binding_id, proof_id, currentness_id, head_version)` tuple. The same immutable proof may receive a new currentness assertion; the same `currentness_id` may not be refreshed.
- Keep one non-deletable current head for every wallet present in binding history, and reject successor `issued_at` values older than the prior durable head.
- Persist the signer-invocation boundary before any possible signer call. Every post-signer state is sticky and holds its sequence fence until positive chain evidence shows the account sequence advanced beyond the reserved sequence.
- Treat crashes left in `signing` or `submitting` as unknown during explicit cold-start recovery. Absence, timeout, and unavailable lookups never release state.
- Reorg transitions require positive canonical-block replacement evidence. Never infer a reorg from transaction absence.
- Keep all lifecycle transition inputs injected and evidence-shaped. This v0 ledger does not invoke a signer or broadcaster.
- Use immediate SQLite writer transactions for every authorization, reservation, lifecycle, and reconciliation mutation.
- Preserve 0600 regular-file semantics for the database and all SQLite sidecars; reject symlinks, hardlinks, unowned or group/other-writable parents.

## Verification

Run `bun run ci`. Tests must remain local and credential-free.
