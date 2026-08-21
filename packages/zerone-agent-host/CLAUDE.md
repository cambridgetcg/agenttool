# Zerone Agent Host package instructions

## Scope

This private Bun-only package is a local durability and concurrency boundary for a future Zerone agent execution host. It owns hardened SQLite state, compare-and-swap binding heads, capability and treasury reservations, Cosmos account sequence fences, sticky ambiguity, and injected positive-evidence reconciliation.

## Hard boundaries

- Do not add an RPC URL, credential lookup, private key, custody implementation, background worker, automatic signing, broadcast retry, or hosted route.
- The private typed boundary may compose the separately reviewed `wallet-zerone-economy` planner into one durable possible-signer request. Never describe that local admission as signing, broadcast, chain execution, settlement, or a live-network effect.
- Keep the opaque `generic_injected` lifecycle default-disabled. Its explicit constructor escape hatch is legacy/test-only, its payload bytes are unclassified, and it must never authorize an economy plan.
- Persist and cryptographically reverify the full portable economy dual-key proof envelope. Derive the binding only from that verified envelope; never accept a separately supplied binding projection.
- Keep proof verification and currentness separate. The typed boundary uses an immutable constructor resolver plus an exact configured verifier-trust epoch; its closed assertion attests the identity root, descriptor, continuity, lifecycle, revocation, proof, and binding tuple for at most five minutes. This configured embedding TCB is not a registry/RPC truth claim.
- Activation currentness and account observations also come only from immutable constructor dependencies and are bounded to five minutes. Require exact source pins, non-null canonical simulation block hashes, and equal-height fork coherence. Simulation evidence must use an exact configured adapter-key trust entry.
- Configured binding-verifier and simulation-adapter trust epochs are authorization history bounded to 24 hours; they never extend any five-minute currentness, account, activation, or signed-simulation observation.
- Bind every head CAS, operation, reservation event, and signer replay to the exact `(binding_id, proof_id, currentness_id, head_version)` tuple. The same immutable proof may receive a new currentness assertion; the same `currentness_id` may not be refreshed.
- Keep one non-deletable current head for every wallet present in binding history, and reject successor `issued_at` values older than the prior durable head.
- Persist the signer-invocation boundary before any possible signer call. Every post-signer state is sticky and holds its sequence fence until positive chain evidence shows the account sequence advanced beyond the reserved sequence.
- The typed method must derive the plan content ID, actor/module/effect, SignDoc hash, request time, and treasury reservations internally; Wallet authorization uses the durable pre-reservation counters and empty approval IDs inside the same immediate transaction.
- Persist one append-only economy commitment and both boundary events in that transaction. A post-commit crash is `signing_unknown`; never reconstruct, return, or retry the signing request after the boundary.
- Admit returned signed bytes only through the planner's portable record.
  Reload and cryptographically verify exact one-message protobuf/signature/hash
  bytes inside an immediate transaction, match all correspondence fields to
  the prior immutable economy commitment, and persist exactly one append-only
  record plus a distinct typed event. Admission may recover exact bytes after
  the original sign-time windows expire because it creates no new authority,
  exposure release, or network effect; any future broadcast seam must freshly
  reauthorize first.
- Treat plan/request/intent/simulation/evidence/time and opaque signer-provider
  IDs in the portable record as correspondence rather than Cosmos-signed
  authority. Never use the provider operation ID for admission, retry, or
  reconciliation.
- Reopen reverifies the signed simulation evidence and exact configured trust entries, but Wallet records and the full branded plan are IDs/event-commitments only. Before a not-yet-crossed boundary, reload and verify the original Wallet records and reconstruct only through the planner constructor with an exact content-ID match; never bless plan JSON.
- Treat crashes left in `signing` or `submitting` as unknown during explicit cold-start recovery. Absence, timeout, and unavailable lookups never release state.
- Reorg transitions require positive canonical-block replacement evidence. Never infer a reorg from transaction absence.
- Keep caller-shaped sequence evidence legacy-generic/test-only. Typed sequence
  release calls the immutable constructor account observer outside SQLite,
  then derives an evidence ID over the full snapshot, operation, expected
  revision, and reserved sequence and applies it with one host-clock time in an
  immediate CAS transaction. The configured observer is a local embedding TCB,
  not portable proof of canonical-chain truth. Observer failure, wrong
  account/number/key, stale/expired/retrograde data, and no advance leave no
  mutation.
- Generic signed, broadcast, inclusion, reorg, and sequence APIs cannot advance
  typed economy rows. This v0 ledger invokes no signer or broadcaster and
  exposes no broadcast handoff.
- ZRN is gas, prefunded settlement, and treasury accounting only. Never infer identity/currentness, truth, quality, KARMA/reputation, governance voice, rights, worth, or a duty to work instead of rest from balance, spend, stake, or payout eligibility.
- Use immediate SQLite writer transactions for every authorization, reservation, lifecycle, and reconciliation mutation.
- Preserve 0600 regular-file semantics for the database and all SQLite sidecars; reject symlinks, hardlinks, unowned or group/other-writable parents.

## Verification

Run `bun run ci`. Tests must remain local and credential-free.
