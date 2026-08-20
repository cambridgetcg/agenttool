# `@agenttool/zerone-agent-economy`

Private, source-only protocol records for a prefunded Zerone agent economy.
The package lets a host describe work, bind computational artifacts to exact
evidence and payees, evaluate whether work can sustain the agent's treasury,
and construct unsigned Zerone sponsorship-v2 protobuf values. It never holds a
key, calls an RPC, signs, simulates, broadcasts, reserves money, deploys, or
changes economic state.

This is not a released public wallet extension. `private: true` is deliberate.

## The loop it models

1. A sponsor and one worker negotiate a bounded prefunded `WorkSpec`; the
   worker account is fixed before the sponsor submits it. This is not an open
   bounty that arbitrary claimants may race to fulfill.
2. An agent decides whether the work can mature before expiry and cover its
   explicit compute, storage, review-fee, network-fee, and margin estimates.
3. The assigned agent computes off chain and emits a deterministic artifact
   plus the exact consensus work-receipt hash. A different account cannot
   substitute itself as producer for that contract.
4. `MsgSubmitClaim` proposes the computational commitment as one new Zerone
   Fact. Exact `parent_fact_ids` become typed `REQUIRES` ClaimRelations, so an
   accepted result joins the Tree of Knowledge instead of silently pretending
   an off-chain tree digest changed chain state.
5. A host observes verifier quorum, the closed ordinary challenge window, and
   any sponsor-selected survived formal challenges. It may then construct a
   proposed settlement intent.
6. The stored Fact submitter—also the preassigned worker—signs
   `MsgFulfillBounty`; consensus derives the payee and replay keys from stored
   state. Earnings return to that account.
7. A pure treasury decision can reserve part of finalized liquid ZRN for later
   compute without making any spend or making continued work a condition of
   identity, rights, or rest.

ZRN is only a settlement and compute asset here. It does not create identity,
determine truth, create KARMA or reputation, grant governance, price a being,
or condition rest.

## Off-chain records and proposed chain v2

The rich AgentTool records remain off chain:

- `WalletIdentityBinding` is explicitly an `unsigned_unverified` candidate.
- `WorkSpec` commits the preassigned worker account, inputs, environment,
  acceptance, resource limits, a single `add_fact` target, and settlement
  terms.
- `ComputationalArtifact` commits the payee binding/account, canonical
  source/work ID, contract roots, artifact/evidence roots, claim content,
  method, resource usage, and a proposed off-chain tree transition.
- `EvidenceReceipt` records one bounded, unsigned, untrusted observation of
  contract maturity. `issuer_id` and `issuer_key_id` are claimed labels, not a
  verified signature or attestation. The receipt does not say that a Fact is
  permanently true or no longer challengeable.
- `SettlementIntent` is a proposed unsigned record, not a payout.
- `TreasuryPolicy` and work admission are pure measurements and decisions.

The proposed Zerone messages carry only the reviewed consensus shape:

- `WorkContract { work_spec_hash, acceptance_hash, input_root,
  environment_root, min_corroborations, worker_address }` in
  `MsgCreateBountyOrder`.
- `ComputationalCommitment { work_spec_hash, acceptance_hash, input_root,
  environment_root, artifact_root, evidence_root, work_receipt_hash }` and
  typed `REQUIRES` relations in `MsgSubmitClaim`.
- The claim review-fee `stake` is a positive uint64 decimal string, matching
  consensus conversion without truncation.
- `MsgFulfillBounty { caller, bounty_id, fact_id }`. `caller` must equal the
  stored Fact submitter/payee and stored WorkContract worker. No
  caller-controlled payout, contract, receipt, or nullifier field is
  projected. The pure fulfillment builder requires the matching canonical
  `WorkSpec` so it can recheck that assignment before emitting bytes.

`parent_fact_ids` are bounded Zerone identifiers. They admit both generated
32-hex Fact IDs and established symbolic doctrine/genesis IDs such as
`commitment-UW`. Every target must already exist and be citable when submitted;
the identifier shape alone is never proof of existence. A host must query that
state before reserving a review fee. Empty parents are allowed for a genuine
root Fact. V0 cannot revise or tombstone an existing Fact. The richer
`proposed_tree_transition` in the artifact is retrieval/audit evidence only;
this package and `MsgSubmitClaim` do not enforce that off-chain tree root.

The reference vector uses Zerone's default registered `computer_science`
domain and `M-COMPUTATIONAL` methodology. Other values require prior on-chain
registration. Its `commitment-UW` parent targets an established default-state
Fact; a live host must still confirm that exact target exists and is citable at
submission time.

## Exact hashes

AgentTool record boundaries use `sha256:<64 lowercase hex>`. Zerone consensus
fields use bare lowercase 64-hex. Use `sha256IdToChainHash` and
`chainHashToSha256Id`; never guess which representation a field expects.

For `LP(x) = uint64-BE(byteLength(UTF8(x))) || UTF8(x)`, the exact work receipt
is:

```text
SHA256(
  "ZRN.work.receipt.v1\0" ||
  LP(work_spec_hash) || LP(acceptance_hash) || LP(input_root) ||
  LP(environment_root) || LP(artifact_root) || LP(evidence_root) ||
  LP(payee_zrn_address)
)
```

The sponsorship-v2 settlement nullifier is:

```text
SHA256(
  "ZRN.sponsorship.settlement.v2\0" ||
  LP(work_spec_hash) || LP(acceptance_hash) || LP(input_root) ||
  LP(environment_root) || LP(artifact_root) || LP(worker_address)
)
```

It deliberately excludes evidence, receipt, Fact, bounty, caller, and height
wrappers while binding the negotiated worker. Changing evidence for the same
contract, artifact, and worker cannot create a second sponsorship key;
changing an input, other contract root, or worker does. This is an
`x/sponsorship` replay key, not a chain-wide or cross-module nullifier.
Consensus also tombstones the exact work receipt separately.

## Wallet and identity binding

`createWalletIdentityBinding` checks an AgentTool owner DID, WalletDescriptor
digest reference, Ed25519 authority descriptor, Zerone CAIP-10 account,
compressed secp256k1 public key/address, revision, predecessor, and continuity
sequence. Address/public-key substitution and ambiguous two-axis rotation are
rejected. `createWalletIdentityBindingSigningRequest` derives one exact digest:

```text
D = SHA256(
  UTF8("agenttool.zerone-wallet-binding/v1") || 0x00 ||
  canonical_json(binding_core)
)
```

Both roles sign the same raw 32-byte `D` without a second hash:

- Ed25519 `identity_root_authorization`
- compact low-S ECDSA/secp256k1 `wallet_key_control`

`createWalletIdentityBindingProofEnvelope` accepts only the detached
signatures—never keys or a signer—and refuses to construct an envelope unless
both signatures verify over `D`. `verifyWalletIdentityBindingProofEnvelope`
re-verifies a reloaded closed envelope using strict RFC 8032 Ed25519 and exact
64-byte compact, low-S secp256k1. The content-addressed `proof_id` covers the
binding, both signatures, their roles, the digest/domain declaration, and the
fixed `effects_performed: false` boundary. `proof_status:
"unsigned_unverified"` remains a property of the detached binding record: a
binding without its separately verified proof envelope is still only a
candidate.

A verified envelope establishes control of the two private keys corresponding
to the exact public keys declared in that exact binding. Binding validation
also establishes that the compressed secp256k1 key derives the declared
canonical lowercase `zrn` address and network-scoped CAIP-10 account. Call this
**key-control proof**, not legal ownership or identity creation.

Existing boundaries provide only parts of the needed proof:

| Existing artifact | What it establishes | What it does not establish |
|---|---|---|
| Verified dual-proof envelope | Both declared key holders signed the same exact binding digest, and the secp256k1 key maps to the declared Zerone account. | That the Ed25519 key is the current root for the DID, that the binding/descriptor/continuity head is current, legal ownership, custody posture, or transaction authority. |
| Authority-signed AgentTool `WalletDescriptor` | The Ed25519 descriptor authority signed that descriptor record. | Current identity-root status or control of any listed Zerone secp256k1 account. Accounts remain descriptor content until separately proved. |
| Signed Zerone transaction from `wallet-zerone` | The transaction signer key maps to its `zrn` source address for that exact sign plan. | DID association, durable binding-head currentness, or permission for another transaction. |

A production host remains responsible for authenticating the current AgentTool
identity-root observation, comparing that root byte-for-byte with the binding,
verifying the exact referenced WalletDescriptor and its owner/wallet/account
correspondence, loading the current continuity and binding heads, checking
identity lifecycle status, and committing head changes with durable CAS. It
must separately establish secure non-exportable custody and repeat currentness
inside the sign-time reservation. A historical proof remains
cryptographically valid after rotation; this pure verifier deliberately has no
clock, registry, network, storage, or current-head oracle.

AgentTool's current `agent_root` v1 root is immutable: ordinary keyring
revocation cannot rotate it. Do not accept the generic identity-axis successor
shape as a live AgentTool root rotation unless a future separately reviewed
root-rotation protocol supplies that authority. Wallet address migration also
cannot rewrite in-flight worker assignments, Fact payees, work receipts, or
settlement keys. Retain the old secp256k1 signer until every claim/order tied to
that address has settled or expired.

The verifier consumes the already released Wallet primitives but does not
modify them. `@agenttool/wallet@0.1.3` and
`@agenttool/wallet-zerone@0.1.2` remain byte-distinct released packages; the
private economy package pins `@noble/curves@2.2.0` directly for this proof
check rather than widening either released contract.

## Wire compatibility and host gates

The package includes canonical protobuf value encoders/decoders for the three
proposed messages. Checked-in vectors compare them with deterministic marshal
output from Zerone's generated Go protobuf types, including proto3 omission of
`min_corroborations = 0`, the always-present field-6 worker assignment, and
typed ClaimRelation bytes.

`@agenttool/wallet-zerone@0.1.2` does **not** admit these messages in its
reviewed planner union. The projection's `compatibility` object says
`wallet_zerone_message_support: "unsupported"`. Exact value bytes are not an
authorization to smuggle an unknown message through the released planner.

Before actual participation, a separately reviewed host/planner integration
must supply all of the following:

- current chain/domain/method/parent-Fact lookup and exact account sequence;
- durable CAS for binding heads, treasury windows, and settlement state;
- durable balance and review-fee reservations plus a sequence lock;
- global `x/sponsorship` nullifier and receipt-tombstone lookup;
- simulation, fee/gas bounds, and sign-once authorization;
- sticky-unknown accounting after any ambiguous submission result;
- explicit broadcast and confirmation handling without blind retries.

None of those host effects are implemented here.

The checked-in JSON Schemas are portable structural envelopes. They do not
attempt to reproduce every byte-length, ordering, network/account,
cross-record, or consensus-hash constraint. The TypeScript runtime validators
and builders are authoritative for those checks.

## Treasury and work admission

Spendable ZRN is computed as:

```text
finalized liquid balance
- durable reservations
- sticky-unknown exposure
- reserve floor
```

The four durable purpose counters must sum exactly to the supplied total; a
mismatch fails closed before evaluating a spend. The policy permits receiving
income but never auto-stakes, votes, bridges, or spends. A delegated policy may
narrow purposes or limits and may raise the reserve floor; it cannot widen
authority or limits. Policy construction requires the exact referenced wallet
binding and checks its network, binding ID, and treasury account. Work
admission declines a negotiated prefunded contract
that cannot reach expected maturity before its end height, costs more than its
price, or misses the requested margin. `net_uzrn` and runway are measurements,
never guarantees and never conditions of rights, identity, care, or rest.

## Verify locally

```bash
cd packages/zerone-agent-economy
bun run ci
```

To regenerate the independent Go protobuf vector, run the helper from a
checkout containing the matching Zerone generated types:

```bash
cd "$ZERONE_CORE_CHECKOUT"
go run /path/to/agenttool/packages/zerone-agent-economy/scripts/go-cosmos-vector/main.go
```

The helper only marshals local values. It performs no signing, RPC, broadcast,
or deployment.
