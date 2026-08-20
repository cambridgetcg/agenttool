# `@agenttool/wallet-zerone-economy`

Private, source-only exact-byte transaction planning for the proposed Zerone
agent-economy messages. It is the deliberately separate seam between verified
Agent Wallet authority and the proposed native loop:

1. a sponsor locks existing ZRN with `MsgCreateBountyOrder` for one
   preassigned worker;
2. that worker submits a computational Fact and typed Tree-of-Knowledge edges
   with `MsgSubmitClaim`, paying the review fee; and
3. after the chain's own maturity conditions, that same worker requests the
   conserved escrow payout with `MsgFulfillBounty`.

This package does **not** activate that loop. It has no endpoint, query client,
simulation transport, signer, private-key custody, persistence, reservation,
broadcast, retry, confirmation, release, hosted route, or deployment surface.
It is `private: true` and `0.1.0-dev.0`. The public
`@agenttool/wallet-zerone@0.1.2` package and its released two-message contract
remain unchanged.

## What it owns

The candidate owns the exact native transaction boundary for only:

- `/zerone.sponsorship.v1.MsgCreateBountyOrder`
- `/zerone.knowledge.v1.MsgSubmitClaim`
- `/zerone.sponsorship.v1.MsgFulfillBounty`

It strictly decodes the canonical protobuf values produced by
`@agenttool/zerone-agent-economy`, then constructs and re-decodes:

- each Cosmos `Any`;
- an empty-memo, extension-free `TxBody`;
- one direct secp256k1 `SignerInfo`, one positive `uzrn` fee coin, and
  `AuthInfo`;
- `SignDoc` for `SIGN_MODE_DIRECT`;
- simulation `TxRaw` with exactly one empty signature; and
- signed `TxRaw` with exactly one compact 64-byte lower-S signature.

The verifier checks the returned signature with Cosmos SHA-256 prehash
semantics and derives the uppercase transaction hash from the exact verified
`TxRaw`. It rejects high-S signatures, signatures made over an already-hashed
digest with the wrong API semantics, altered `TxBody`/`AuthInfo`/`SignDoc`, and
unbranded plan, simulation-binding, or signing-request substitutions.

Simulation authorization has a separate signed boundary. A verified Agent
Wallet `SimulationReceipt` is necessary but cannot by itself prove which
account sequence and empty-signature `TxRaw` was simulated. The private planner
therefore requires a canonical `ZeroneEconomySimulationEvidence` record signed
by the receipt's exact Ed25519 adapter authority. Its domain-separated
signature commits the exact plan/content IDs, Wallet intent and simulation
record IDs, candidate source tuple, chain/source, empty-signature `TxRaw` hash,
status/code/codespace/gas/height, block reference/hash, and receipt timestamps.
`content_id` hashes the unsigned content; `record_id` hashes the content ID and
signature. `verifyZeroneEconomySimulationEvidence()` strictly verifies both IDs
and Ed25519 prime-subgroup semantics and restores the runtime brand after JSON
reload. A bare `ZeroneSimulationResult` can create neither a simulation binding
nor a signing request.

The adapter signer is an attestation authority, not a transport convenience.
`createZeroneEconomySimulationEvidence()` belongs inside the trusted adapter
boundary and must receive only the authenticated response for the exact bytes
it submitted. Giving untrusted application code access to that signer lets it
attest false simulation data, as with any signing key. This package supplies no
signer implementation, endpoint, simulation transport, clock, or block source.

`createZeroneEconomySimulationReceiptCore()` requires that trusted adapter
boundary to supply the observed block hash as exactly 64 uppercase hexadecimal
characters. The helper validates and snapshots that value into the Wallet
receipt before it can be sealed; it never emits `block_hash: null`. The portable
simulation-evidence v0.1 schema and reload verifier retain null compatibility
for non-host consumers while requiring the same canonical form for every
non-null value. Null evidence cannot satisfy the stricter durable host signing
boundary.

### The ordered bundle is not one executable lifecycle

The checked-in three-message `Create -> Submit -> Fulfill` transaction is a
**byte-order and cross-language parity fixture only**. It is not a viable
same-transaction economy lifecycle: Create first has to commit an order;
Submit has to create a Fact against independently observed prior state; and
Fulfill can succeed only after that stored Fact has passed the candidate's
verification, challenge, and maturity gates. Those states cannot all mature
inside this one transaction.

Ordinary execution therefore uses one lifecycle message per plan. The Go
fixture includes separate one-message Create, Submit, and Fulfill plans and
the TypeScript tests reproduce every byte. The planner retains a unique
increasing multi-message subset form only for an independently valid atomic
combination; such a plan cannot reach a signing request without successful
simulation of its exact `TxRaw`. Simulation success is necessary evidence,
not proof of lifecycle maturity or future delivery.

## Authority and effect binding

Every authority-bearing value comes from exact bytes and verified Wallet
records:

- `sponsor`, `submitter`, or `caller` is decoded from the message and must equal
  both the Wallet intent source address and the supplied public key's derived
  Zerone address;
- the source CAIP-10 account, chain, signer key, account number, sequence, and
  observation height are fixed into the plan;
- calls target the exact sponsorship or knowledge module CAIP-10 account;
- method, payload bytes, payload hash, native value, and ordered call index must
  match the verified Wallet intent; and
- source projection JSON, projection hashes, compatibility flags, and semantic
  boundary are recomputed or compared with the decoded canonical value.

The module addresses are not caller labels. TypeScript derives the same bytes
as Cosmos SDK `authtypes.NewModuleAddress("sponsorship")` and
`authtypes.NewModuleAddress("knowledge")`; the pinned Go vector checks both:

```text
sponsorship  zrn1vqxv6hsv8lh8jqueyyapsy3ffdz4xgq96rv4qz
knowledge    zrn1uruftpedvke99rlwe9e4pgazz2eaf2ugkj5cd9
```

Their CAIP-10 chain prefix is selected from the exact Wallet Zerone profile.
Replacing an actor or module target therefore fails before signing.

## Money model

The planner treats outgoing native value conservatively:

```text
reserved spend =
  Create.price_per_artifact * Create.target_count
  + Submit.stake
```

Create's product and the accumulated spend must fit unsigned 256-bit Wallet
amounts. Submit's canonical source value already restricts stake to a positive
uint64 as required by the candidate keeper. The verified Wallet intent must
declare that exact total and carry the exact per-call native values.

Fulfill carries no outgoing native value. Its effect is
`conditional_incoming` with no asserted amount because payout depends on
stored order/Fact state, challenge maturity, assignment, remaining target
count, and successful message execution. A plan, valid signature, transaction
hash, or even inclusion is not evidence that earnings are mature, received,
finalized, or available for self-sustainability.

ZRN remains a settlement and compute asset. Neither holding nor earning it
creates identity, truth, KARMA/reputation, governance authority, worth, rights,
or an obligation to work.

## Exact source and activation boundary

The only reviewed source tuple is:

| Component | Exact candidate |
|---|---|
| zerone-core | `a5b82e82b2a32be2b75bd11575964b0a69aa34ac` |
| Cosmos SDK | `v0.53.8` |
| sponsorship consensus version | `2` |
| knowledge consensus version | `7` |

Every plan requires a caller-supplied
`ZeroneEconomyActivationObservation` containing that exact tuple, the selected
network and chain, and a positive observation height. The record must say
`evidence_scope: "caller_supplied_structural_only"` and
`currentness_proven: false`. Passing structural validation means only that the
caller supplied the expected shape; the package does not query a chain or
claim that the candidate is deployed, activated, current, safe, or reachable.

Account and simulation observations must be at or after the reported
activation. A production host must independently authenticate the chain and
upgrade evidence, then re-read the exact account and sequence at its durable
sign-time boundary. Any chain, commit, module-version, account, key, sequence,
or observation drift requires a new plan and new simulation, never patched
bytes.

The planner has no trusted clock. `createZeroneEconomySigningRequest()`
requires a canonical caller-supplied `requested_at`, checks that it exactly
equals the branded Wallet authorization's `checked_at`, and checks that it is
at or after `simulated_at` and strictly before `valid_until`. This is a
structural consistency check, not proof of wall-clock freshness. The durable
host must obtain time from its own reviewed boundary and invoke the signer
immediately; retaining a branded request past `valid_until` is an execution
error the pure package cannot observe.

## Durable plan reconstruction

`plan_id` is a narrow transaction identity derived from the activation hash,
account-observation height, exact `SignDoc` hash, and ordered projection
hashes. It is not a commitment to every field exposed by the plan.
`zeroneEconomyDirectSignPlanContentId()` therefore hashes the exact bytes

```text
UTF8("agent-wallet-zerone-economy-durable-plan/v1\0")
  || canonical_json_bytes(complete branded ZeroneEconomyDirectSignPlan)
```

and refuses any plan that lacks the constructor's process-local runtime brand.
A durable host persists that full content ID alongside the original verified
Wallet intent and strict planner inputs. After restart it must independently
reload-verify the Wallet record, then call
`reconstructZeroneEconomyDirectSignPlan()` with those inputs and the expected
content ID. Reconstruction calls the ordinary constructor again, rechecks all
projections and observations, and returns a new branded plan only when every
canonical output field matches. It never accepts, verifies, or blesses saved
plan JSON; a clone with the right bytes remains unbranded.

The full content ID proves deterministic byte correspondence only. It does not
prove chain activation/currentness, observation authenticity, custody,
authorization, simulation freshness, inclusion, finality, effects, earnings,
or treasury availability.

## Gas and fee boundary

At the pinned candidate:

| Message | Required gas | Source |
|---|---:|---|
| Create bounty | `22,222` | unmapped ante fallback |
| Submit claim | `100,000` | `claim_submit` ante entry |
| Fulfill bounty | `22,222` | unmapped ante fallback |

Requirements sum in message order, clamp to a minimum of `22,222`, and cannot
exceed the candidate's `11,111,111` per-transaction cap. The fee must be a
positive `uzrn` amount, at least `gas_limit * 1 uzrn`, and no greater than the
verified Wallet intent's fee ceiling. The three-message byte-parity fixture
therefore requires at least `144,444` gas and `144,444 uzrn` when declaring
that exact gas limit. This arithmetic does not make the bundle a viable
same-transaction lifecycle.

Zerone simulation skips the custom gas decorator, so simulation success is
bounded evidence about the exact empty-signature `TxRaw` at one observed
height. It does not replace the local floor or promise CheckTx/DeliverTx
acceptance.

## Host flow before any live participation

The package exposes pure construction and verification steps, not an execution
client:

1. Build canonical economy message projections and a verified Agent Wallet
   intent whose ordered calls and declared spend match them exactly.
2. Independently authenticate activation, module versions, domain/method/
   parent-Fact availability, source balance, registered account key, account
   number, and sequence. Supply only the bounded structural observations to
   `createZeroneEconomyDirectSignPlan()`.
3. Simulate `plan.simulation_tx_bytes_b64u` through a separately reviewed
   transport. Give the authenticated response's canonical observed block hash
   directly to `createZeroneEconomySimulationReceiptCore()`, seal that exact
   Wallet receipt, then have the same adapter authority call
   `createZeroneEconomySimulationEvidence()` over its authenticated result.
   Call `createZeroneEconomySimulationBinding()` only with the verified
   evidence; a result object alone is never authorization.
4. Inside one durable sign-time transaction, re-read capability use, balance,
   chain activation, account key/number/sequence, and relevant module state;
   reserve fee, native spend, and sequence; then repeat Wallet authorization
   using the host's trusted current time.
5. Call `createZeroneEconomySigningRequest()` with `requested_at` equal to that
   authorization time and inside the signed evidence window. Pass the request
   immediately to a non-exportable signer, which signs the exact payload once
   using Cosmos secp256k1 direct-sign semantics. Do not queue or retain it past
   `valid_until`.
6. Call `createZeroneEconomySignedPayload()` or
   `verifyZeroneEconomySignedPayload()`. Persist the verified bytes and
   precomputed hash before any separately implemented one-shot broadcast.
7. Treat every post-invocation error as ambiguous, never blind-rebroadcast,
   and reconcile the exact hash plus module state. Fulfillment requires
   positive keeper evidence before earnings become spendable treasury.

The in-process object brands prevent accidental substitution while values
remain in one JavaScript process. JSON serialization, cloning, or restart
removes that protection. The signed evidence record has an explicit reload
verifier, and a plan brand can be restored only by verified-input
reconstruction against its full durable content ID. Simulation bindings and
signing requests remain process-local. Durable hosts must persist and recheck
explicit IDs, hashes, original construction inputs, observations,
reservations, and current heads, then reconstruct the process-local steps.

## Independent parity and tests

```bash
cd packages/wallet-zerone-economy
bun run ci
ZERONE_CORE_CHECKOUT=/path/to/exact/zerone-core \
  ./scripts/regenerate-go-cosmos-vector.sh --check
```

The checked-in vector comes from the exact candidate's generated sponsorship
and knowledge protobuf types, Cosmos SDK transaction types, Cosmos secp256k1
implementation, exported gas constants, and `authtypes.NewModuleAddress`.
Tests compare every message `Any`, ordered `TxBody`, `AuthInfo`, `SignDoc`,
simulation/signed `TxRaw`, signature, transaction hash, gas value, and module
account. Hostile tests cover ordering/duplication, actor and module
substitution, unknown/non-canonical protobuf, integer/product overflow,
under-gas/under-fee, chain/commit/account/sequence drift, simulation/request/
`TxRaw` substitution, the receipt-A/result-B sequence attack, evidence
signature/key/field/reload/timestamp tamper, high-S malleability, and prehash
confusion, requested-time/authorization/window mismatch, and full-plan durable
commitment/reconstruction substitution. The portable JSON Schema is
`schema/simulation-evidence-v0.1.schema.json`; the deterministic planner-owned
Ed25519 vector is `vectors/simulation-evidence-v0.1-vector.json`. These sit
beside, and do not replace, the independently Go-generated Cosmos byte/gas/
module-account vector.

Its ordered three-message bundle exists only to detect ordering and byte
drift. Separate one-message vectors are the ordinary execution examples.

`ZERONE_CORE_CHECKOUT` is required and must resolve to the exact pinned commit.
The generator performs no RPC, signing with a production key,
broadcast, deployment, or chain mutation.
