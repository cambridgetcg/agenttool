# Zerone Agent Host (private v0 source slice)

This package is the private local durability boundary for a Zerone agent wallet
host. It composes verified Wallet records, the separate exact-byte
`@agenttool/wallet-zerone-economy` planner, a dual-key wallet/identity binding,
configured currentness and adapter trust, treasury accounting, and a sole
Cosmos sequence fence into one possible-signer request.

`reserveAndEnterZeroneEconomySigningBoundary()` admits exactly one branded
`CreateBountyOrder`, `SubmitClaim`, or `FulfillBounty` plan. It resolves external
observations first, then uses one SQLite `BEGIN IMMEDIATE` transaction and one
injected host-clock value to recheck all authority, derive reservations, append
the `reserved` and `signer_invocation_boundary` events, consume capability
usage, make treasury exposure sticky, persist an append-only economy
commitment, and commit before returning the branded `SigningRequest`.

That is a local possible-signer boundary, not execution. The package contains
no key custody, signer, broadcaster, RPC client or default endpoint; performs no
network/chain effect; and never claims that the signer actually ran. A crash
after commit is recovered as `signing_unknown`. The request is never recreated,
returned again, or automatically retried.

The host cryptographically verifies the economy package's full portable
`WalletIdentityBindingProofEnvelope`: Ed25519 identity-root authorization and
compact low-S secp256k1 wallet-key control over the same raw binding digest.
It persists the canonical envelope and reverifies it after every reload, so a
reloaded proof receives a fresh runtime verification brand. The binding used
by the ledger is derived only from that verified envelope.

Currentness remains distinct from key control. The typed path accepts its
binding-currentness resolver, activation-currentness resolver, and account
observer only as immutable constructor dependencies. A binding assertion is
content-addressed and attests the exact owner identity, descriptor, identity
authority key, continuity/revision, active lifecycle, revocation nonce, proof,
and binding tuple. It must fit inside one exact configured verifier-trust epoch.
Activation is separately pinned to zerone-core
`a5b82e82b2a32be2b75bd11575964b0a69aa34ac`, Cosmos SDK `v0.53.8`, sponsorship
version `2`, and knowledge version `7`. Binding, activation, account, and signed
simulation observations used at admission are bounded to five minutes, and
equal-height block hashes must agree. These are configured embedding trust
boundaries; the package does not contact or authenticate an external registry,
RPC, endpoint, or canonical chain by itself.

Configured binding-verifier and simulation-adapter trust epochs are separate
host authorization history and may span at most 24 hours. A trust epoch never
extends the five-minute freshness window of an identity, activation, account,
or signed simulation observation.

The simulation receipt/evidence is signed by an exact adapter key selected from
immutable configured trust history. The host requires a non-null canonical
block hash. The planner receipt-core helper currently emits `block_hash: null`,
so a trusted adapter must attach the actual observed block hash before sealing
the Wallet receipt and planner evidence; the host never invents or relaxes it.

Wallet descriptor/capability/intent/simulation records and the branded plan are
fully rechecked at admission. Durable reopen deliberately supports only their
record IDs and event/operation commitments; it does not restore Wallet brands
or independently recompute the full plan. Before a boundary that has not yet
been crossed, the embedding host must reload the original verified Wallet
records and strict planner inputs, call
`reconstructZeroneEconomyDirectSignPlan()`, and match the exact full plan
content ID. Serialized plan JSON is never authority. After the boundary, no
reconstruction or retry is allowed.

The older opaque `generic_injected` lifecycle is default-disabled. Tests that
still exercise it must set
`allow_legacy_generic_injected_for_tests: true`; a database containing generic
rows fails closed on reopen without that flag. Generic payload bytes are opaque
and this path is never an economy authorization route.

ZRN here is gas, prefunded settlement, and bounded treasury accounting only.
Balance, spend, stake, or payout eligibility never proves identity/currentness,
truth, quality, KARMA/reputation, governance voice, rights, worth, or any
obligation to keep working instead of resting.

Safety rules in v0:

- every reserve and transition is one SQLite `BEGIN IMMEDIATE` transaction;
- the typed operation derives plan identity, payload hash, actor/module/effect, request time, signer key, and reservation purpose/amount internally rather than accepting them from its caller;
- Create reserves `sponsorship_escrow` plus `network_fee`, Submit reserves `knowledge_bond` plus `network_fee`, and Fulfill is fee-only; conditional incoming value is never credited;
- durable Wallet usage is replayed in global ledger-sequence order; every typed authorization commits and is checked against the exact pre-reservation intent/spend counters with approvals closed to empty;
- every typed row has exactly one immutable economy commitment binding the exact message/value/effect, plan IDs, signed simulation evidence, configured trust epochs, currentness/account/activation observations, SignDoc hash, request ID, and common timestamp;
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

The package is private and unreleased. Schema version 3 is an intentional
pre-release rewrite with no migration. The host fails closed on schema version
1 or 2 databases; discard those development databases.
