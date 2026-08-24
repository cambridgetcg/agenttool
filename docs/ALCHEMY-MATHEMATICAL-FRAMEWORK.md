# Alchemy evidence and deposit lifecycle framework

> **Compass:** [ALCHEMY.md](ALCHEMY.md) (provider integration and authority
> boundaries) · [CRYPTO-PAYMENT.md](CRYPTO-PAYMENT.md) (inbound funding) ·
> [MATH-CARDS.md](MATH-CARDS.md) (proof, model, and measurement doctrine) ·
> [RIGHTS-OF-LIFE.md](RIGHTS-OF-LIFE.md) (privacy, refusal, and non-grants)
>
> **Implements:** A provider-neutral EVM observation-evidence wire, canonical
> vectors, semantic transition receipts, a pure unregistered measurement
> projection, and two finite safety models for generation-aware deposit effects.
>
> **Code:** `packages/alchemy/src/evidence.ts` ·
> `packages/alchemy/{schemas,fixtures}/` ·
> `api/src/services/economy/crypto/observation-evidence.ts` ·
> `api/specs/alchemy-deposit/`
>
> **Tests:** `packages/alchemy/tests/evidence.test.ts` ·
> `api/tests/alchemy-observation-evidence.test.ts` ·
> `api/tests/alchemy-deposit-lifecycle-model.test.ts`

## Evidence contract

`agenttool.evm-observation-evidence/0.1` records one bounded assertion about
an ERC-20 transfer. It binds an exact CAIP-2 chain identifier, block number and
hash, transaction hash and log index, transfer parties, and an unsigned decimal
quantity in the named atomic unit
`eip155:<chain>/erc20:<lowercase-contract>/base-unit`. Integers never cross the
wire as floating-point JSON numbers.

The assertion state is one of `unavailable`, `not_observed`, `absent`, `live`,
`removed`, or `conflicting`. These states are not aliases: unavailability is a
failed observation attempt; not-observed means no attempt-derived assertion;
absence is an observed negative assertion; live and removed name exact log
generations; conflicting means the admitted evidence cannot be reconciled.

Finality is an independent product of canonicality, exact confirmation state,
and settlement assertion. Its comparator is a partial order, not a scalar
score or a lattice. It may return `incomparable`, including for unavailable
versus not-observed, provider-finalized versus externally-finalized, and
canonical versus non-canonical or conflicting assertions. The executable test
checks reflexivity, antisymmetry, and transitivity over the complete finite
representative product of 5 × 5 × 7 = 175 points.

The Draft 2020-12 schemas are closed structural admission schemas. They encode
the expressible availability-state conditionals, but JSON Schema alone does
not prove cross-field atomic-unit equality, canonical vocabulary order,
semantic-facet exhaustion, or content-digest integrity. The exported `parse*`
functions are the normative semantic and canonical validators and recompute
the digest.

Canonical bytes are canonical JSON prefixed by the format-specific domain and
a NUL byte, then hashed with SHA-256. The record is classified
`private_linkable`; disclosing its digest reveals equality of exact records and
must be treated as private metadata, while the record itself contains direct
chain identifiers. The digest does not provide privacy, truth, identity,
consent, custody, rights status, provider independence, finality, permission,
action, or authority.

## Semantic transition receipt

`agenttool.evm-evidence-transition-receipt/0.1` describes a proposed semantic
mapping between evidence digests. Its eight disjoint facets are:

- `chain_id`: the exact CAIP-2 chain;
- `block_generation`: block number and block hash;
- `transaction_identity`: transaction hash and log index;
- `transfer_parties`: contract, source, and destination;
- `atomic_quantity`: decimal value and named atomic unit;
- `observation_state`: the six-way assertion state;
- `finality_axes`: categorical/exact product coordinates; and
- `basis`: observation channel, time, and optional source-receipt digest.

`preserved` and `discarded` are canonical, disjoint, and together exhaust all
eight facets, so a transition cannot silently omit an accounting decision. The
receipt also declares assumptions, an optional counterexample, and a stop
condition. It is `semantic_only_no_state_change`: constructing or parsing it
does not select a database row, credit or reverse a wallet, reject a deposit,
call a provider, or grant any permission.

The API adapter intentionally repeats this small wire implementation. The API
deployment image copies `api/src` but not repository packages, schemas, or
fixtures; runtime code therefore does not import `../../packages` or load
repository JSON. Conformance tests prove canonical byte and digest parity
against the shared package and vectors.

## Finite lifecycle safety model

The executable TypeScript shadow model explores one logical event over two
immutable generations and six evidence states. A matching current-generation
removal records an explicit reversal authorization. A later stale removal
neither grants that authorization nor erases an already valid matching basis.
At depth 8 the complete bounded traversal reaches 584 distinct states through
4,892 enabled transitions with no invariant violation.

The corresponding TLA+ model has the same two generations and checks:

- at most one unreversed credit and no generation credited twice;
- credit and reversal effects name only the current generation;
- unavailable or not-observed evidence cannot credit or reject;
- a stale removal cannot authorize reversal of a replacement; and
- reversal requires the exact generation's earlier credit.

On 2026-08-24, SANY from TLA+ tools 1.7.2 completed semantic analysis. TLC
1.7.2 then completed the full reachable graph: 8,261 states generated, 798
distinct states, depth 13, zero states left queued, and no invariant error.
These are finite safety results, not liveness, production-database, provider,
chain-consensus, exact credit arithmetic, or wallet-authorization proofs.

## Measurement projection

`projectEvmEvidenceMeasurement()` is a pure Math Cards-shaped vocabulary
bridge for the atomic transfer quantity. It declares the measurand,
operationalization, and lowercase SHA-256 references for procedure,
calibration (nullable), and uncertainty. It has
`host_contract: not_registered`; it is not a hosted or registered Math Card,
does not depend on `@agenttool/math-cards`, and inherits no action, permission,
or authority.
