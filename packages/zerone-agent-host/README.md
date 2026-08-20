# Zerone Agent Host (private v0 source slice)

This package supplies the durable half of a future Zerone agent wallet host: a hardened local SQLite ledger, atomic binding/capability/treasury authorization reservations, one in-flight Cosmos sequence per account, sticky unknown states, and positive-evidence reconciliation.

It does **not** make Zerone agent-economy transactions executable. `@agenttool/wallet-zerone` 0.1 only reviews its released two-message union, while `@agenttool/zerone-agent-economy` currently emits unsupported unsigned message-value projections. This package therefore exposes evidence transitions, not a signer or broadcaster. `EXECUTION_SUPPORT` is machine-readable and always reports that boundary.

The host cryptographically verifies the economy package's full portable
`WalletIdentityBindingProofEnvelope`: Ed25519 identity-root authorization and
compact low-S secp256k1 wallet-key control over the same raw binding digest.
It persists the canonical envelope and reverifies it after every reload, so a
reloaded proof receives a fresh runtime verification brand. The binding used
by the ledger is derived only from that verified envelope.

Currentness is deliberately separate. A caller injects a resolver that receives
the already verified proof and returns a closed `BindingCurrentnessAssertion`.
Its `currentness_id` content-addresses the exact binding ID, immutable proof ID,
verifier name, revocation nonce, and resolver-asserted `[verified_at,
valid_until)` interval. The host validates that record, chronology, and linkage,
but does not authenticate the resolver, consult an identity registry, or prove
freshness with a trusted host clock. The assertion performs no effect and grants
no signing or economic authority by itself.

Likewise, v0 does not reconstruct Wallet's process-local verified-record brands
after restart and does not decode a native economy transaction. The embedding
host remains responsible for verifying the exact descriptor, capability,
intent, simulation, approvals, and future reviewed native plan before passing
their immutable references and ceilings through the explicitly named
`trusted_injected_wallet_authorization_projection/0.1` boundary. The ledger binds the capability
`policy_hash` to the exact treasury policy ID and makes the resulting local
usage/reservation decision atomic; it is not a substitute for those upstream
cryptographic and chain-native checks.

Safety rules in v0:

- every reserve and transition is one SQLite `BEGIN IMMEDIATE` transaction;
- file-backed storage is mandatory by default; `:memory:` requires the explicit `allow_in_memory_for_tests: true` non-durable test escape hatch;
- schema SQL, foreign keys, indexes (including the held-fence predicate), canonical records, authority projections, accounting, fences, and event chains are verified before recovery and before mutation;
- every operation event receives a persisted monotonic ledger sequence that is included in its event hash; verification replays account observations, halts, and sole-fence handoffs across operations in that durable order rather than inferring order from timestamps;
- the current binding, proof, currentness assertion, head version, descriptor, signer key, revocation nonce, policy, balance floor, capability ceiling, window cap, and account sequence are checked together;
- binding history stores canonical proof-envelope and currentness bytes separately; `proof_id` may repeat across refreshed currentness assertions, while `currentness_id` is the append-only history key;
- every history wallet must retain exactly one current head, current-head deletion is blocked, and a successor binding's `issued_at` cannot predate the prior durable head;
- reservations and signer boundaries require their exact `(binding_id, proof_id, currentness_id, head_version)` tuple and a ledger timestamp inside the injected currentness interval;
- one source account remains permanently associated with its first wallet ID in the indexed append-only binding history (including after the current head rotates away), and v0 freezes the first treasury policy used by that account; policy rotation is blocked until a reviewed non-widening policy-head protocol exists;
- the first append-only operation event commits the exact injected authorization projection, capability ceilings, canonical policy, reservations, account observation, and sequence tuple;
- the database records `signing` before any possible signer invocation, at which point capability usage is consumed and treasury exposure becomes sticky;
- `signer_invoked: true` is deliberately conservative shorthand for “the persisted boundary was crossed before a possible external call”; it is not evidence that a signer actually ran;
- a cold-start recovery converts unfinished `signing` and `submitting` rows to their unknown variants;
- recovery defaults on even with create-if-missing; concurrent reservation-only workers must explicitly opt out and must never drive lifecycle effects;
- even a reported pre-submit rejection remains sticky because the signed bytes could surface elsewhere;
- only a positive account observation with `sequence > reserved_sequence` releases a post-signer fence;
- transaction absence/unavailability does nothing, a reorg requires positive replacement-block evidence, and every later halt epoch must be strictly newer in both observation height and time (equal-height epochs are rejected); post-reorg sequence or re-inclusion evidence must likewise be causally newer than the persisted halt epoch;
- each unresolved canonical reorg is an explicit operation-to-event pointer that survives positive re-inclusion and clears only on qualifying sequence-advance evidence; if a fence must move, the earliest numeric reserved Cosmos sequence wins, with creation time and operation ID as deterministic ties;
- each operation's events, account observations, binding history, and capability mutations reject retrograde clocks; cross-operation evidence arrival is ordered by `ledger_sequence`, and cold-start recovery clamps a regressed wall clock to the operation's last persisted time;
- one SQLite database coordinates one device/process domain, not distributed exactly-once execution.

The hashes and semantic replay detect torn writes, accidental substitution, and
state/event disagreement. They are unkeyed and do not make the local database
tamper-proof against a privileged writer that replaces the entire ledger with a
different, fully self-consistent history. Protect the database with the host OS
and treat that writer as part of the local trusted computing base.

Run `bun run ci` from this directory. No test needs a network, account, credential, or funded wallet.

The package is private and unreleased. Schema version 2 is an intentional
pre-release rewrite; there is no migration from the earlier opaque-proof
development schema. Discard development databases created by schema version 1.
