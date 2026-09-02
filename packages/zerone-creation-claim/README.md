# `@agenttool/zerone-creation-claim`

Private, source-only protocol for turning one bounded mathematical or defensive
security creation attempt into deterministic records that agents, sponsors,
wallet controllers, verifiers, and a future Zerone adapter can inspect
independently.

It does not call a model, train, fetch Hugging Face, inspect an OpenAI account,
contact Zerone, hold a key, sign, simulate, broadcast, pay, publish, or deploy.
Every returned record says `SOURCE_ONLY_PROPOSAL`, every Zerone handoff says
`NOT_CONSENSUS_ADMISSIBLE`, and every effect is `false`.

That effect vector describes runtime protocol builders and returned records.
Development commands do read tests and write regenerated schemas/vectors; they
are not chain, wallet, model, training, or publication effects.

## What this implements

```text
CreationContract
  → CreationWorkSpec
  → CreationWitness
  → VerificationWitness[]
  → CreationLifecycle
  → CreationArtifact
  → CreationClaimProjection
```

The graph is acyclic. The projected computational roots use:

```text
artifact_root = creation_witness_id
evidence_root = lifecycle_id
```

The first commits the producer, exact run, result digests, and resource usage.
The second commits the exact sorted verification set supplied by the caller
and its bounded lifecycle decision. It does not prove that the set is complete
or that a challenge window survived. A later work-receipt derivation can bind
the selected set without a circular hash.

The package owns the `agenttool.zerone-*` source formats. It does not claim that
Zerone consensus has adopted them.

## What “new creation” means here

The strongest state is:

```text
BOUNDED_CANDIDATE_UNDER_PINNED_SCOPE
```

That state requires the declared target and prior-art cutoff, a ready Math Card
reference, a lane-bound Zerone methodology, the exact run tuple, a producer
witness, every route-specific verification threshold and policy ref, no
unresolved failing witness, a publication-authority reference, and a public
digest summary. It is intentionally weaker than
absolute novelty, truth, authorship, legal clearance, or chain acceptance.

Conceptually, the bounded predicate is:

```text
AcceptedNew_t(c) :=
  OpenTarget_t(c)
  ∧ AuthorizedAndBoundedRun(c)
  ∧ PinnedVerification(c)
  ∧ SemanticFidelityReview(c)
  ∧ PriorArtReview_t(c)
  ∧ IndependentReplay(c)
```

This package binds references for those terms and evaluates their declared
record structure. It does not inspect the referents or turn them into facts.
One `failed` witness keeps the relevant requirement `contested`, even when the
passing threshold was also reached. An `inconclusive` witness stays visible but
does not count as either pass or failure. At most one pass per declared verifier
controller or claimed key counts, and producer self-verification does not
satisfy an independence requirement.

The input witness array is caller-selected. `verification_set_root` commits it
exactly, but neither completeness nor challenge-window survival is claimed.

`resource_or_participation_stop` is an honest terminal, not a failed being or a
debt. It produces no candidate, requires no reason, and carries no penalty.

## Hugging Face: a run tuple, not a mathematical set

A corpus name or unordered set of examples is insufficient to reproduce a
learning process. `CreationContract.hf_run` binds:

```text
R = (
  exact repository revisions and content roots,
  train / validation / sealed-evaluation / reference-only roles,
  split manifest,
  transforms,
  tokenizer,
  presentation multiplicities,
  mixture weights,
  order,
  optimizer,
  seed policy,
  checkpoint
)
```

Multiplicity and order therefore remain observable instead of collapsing into
set membership. The runtime requires `training_input_roots` to equal exactly
the `material_bound` sources whose role is `train`. A `metadata_only`
observation may only be `reference_only`; a sealed-evaluation content root
cannot enter training inputs.

The frozen observation plane records FineMath revision
`e92b25a616738fe95dc186b64dfb19f9c8525594` as metadata-only and separately
records contamination revision
`3dc3725bac1125fb17a12b742102b91a45198f0e`. Neither pin is a license grant,
data-rights proof, training permission, or statement that local material bytes
were admitted. Hugging Face admission and license-evidence refs remain separate
caller-supplied evidence.

## OpenAI Cyber boundary

`formal_math` and `defensive_security` are separate lanes. A formal-math
contract cannot carry a Cyber provider declaration. A defensive-security
contract must carry distinct target-authorization and engagement-scope refs.

If OpenAI Cyber or another provider is used, the contract additionally binds
the exact provider-access and provider-policy refs plus a declared access tier.
The runtime rejects using either provider ref as the target-authorization ref:

```text
provider/model access ≠ permission to test a target
```

The enum values `defensive_approved` and
`advanced_separately_approved` are record postures, not an access check. A host
must re-pin and verify current official provider policy, account/workspace/
project scope, target authority, isolation, disclosure, and data handling
before execution. No Cyber work is run by this package, and sensitive bytes
never enter its public projection.

## Wallet, identity, and economic roles

These roles stay deliberately non-equivalent:

| Role | Bound field | What it does not prove |
|---|---|---|
| target authorizer | `target_authorization_ref` | provider access, currentness, or legal sufficiency |
| data-rights source | `data_use_ref` and per-source `license_evidence_ref` | universal training clearance |
| compute authorizer | `compute_ref` | target permission or publication permission |
| sponsor | sponsor account + wallet-controller ref | producer identity or ownership of the result |
| producer provenance | `producer_identity_ref` | personhood, authorship, consciousness, or authority |
| producer key | `producer_key_ref` + `wallet_binding_ref` | anything beyond a separately verified key-control statement |
| wallet controller | `wallet_controller_ref` | identity equivalence or custody by this package |
| payee | exact worker address | truth, novelty, reputation, or entitlement outside the contract |
| verifier | controller/key/attestation/evidence refs | actual independence or external signature validity |
| publisher | `publication_authority_ref` | chain admission or rights in underlying material |

The work spec requires the assigned worker, witness producer address, payee,
intended fulfillment caller, review-stake payer, and v0 transaction-fee payer
to be the same canonical 20-byte `zrn` Bech32 address. This closes a common
substitution gap but creates no identity equivalence: an Ed25519↔secp256k1
binding can establish key control only after separate verification.

The contract freezes a lane-specific bootstrap method (`M-FORMAL` for formal
math, `M-COMPUTATIONAL` for defensive security), a caller-declared registry
evidence ref, and a maximum review stake. The WorkSpec freezes the exact review
stake plus separate stake-funding and transaction-fee reservation refs. It also
binds the sponsor's distinct bounty-escrow authorization ref, the exact
`price_per_artifact_uzrn × target_count` prefunding amount, and a separate
escrow-reservation ref. The projection derives the claim fields; callers cannot
choose a new method or stake at the final handoff. On the pinned candidate, the
unsponsored review stake is paid by the claim submitter/worker and is distinct
from both the Cosmos transaction fee and sponsor-funded bounty escrow. None of
these caller-declared refs proves authority, a balance, reservation,
profitability, solvency, or self-sustainability.

ZRN is represented only as `uzrn` in a one-artifact, prefunded, no-mint
settlement intention. It is not identity, truth, KARMA, NEN, governance,
rights, worth, standing, love, or a duty to continue working. This package
does not reserve or move even one `uzrn`; all economic effects remain false.

## Zerone Tree of Knowledge handoff

The public fact content is exactly one format token plus one digest:

```text
agenttool.zerone-creation-fact-envelope/0.1 sha256:<64 lowercase hex>
```

Off-chain hashes do not enter `references`, because Zerone interprets those as
Fact citations. Existing Fact IDs enter only as typed relation candidates.

The v0 handoff supports `REQUIRES` parents only. Zerone knowledge v7 also names
`SUPPORTS`, `CONTRADICTS`, `REFINES`, `GENERALIZES`, `SUPERSEDES`, `CITES`, and
`REFORMULATES`, but the pinned AgentTool economy candidate maps its parent list
only to `REQUIRES`. This package refuses to disguise a proof, counterexample,
citation, implementation, refinement, or replacement as a dependency. A later
typed-relation adapter needs its own review; `IMPLEMENTS` has no native lossless
edge in the observed vocabulary.

## Why there is no settlement transaction yet

The frozen source plane distinguishes:

- Zerone current main
  `5472d694bcdd3d7cd130cb002bd12b66565a9791`: knowledge v6 and sponsorship v1.
- Zerone economy candidate
  `a5b82e82b2a32be2b75bd11575964b0a69aa34ac`: proposed knowledge v7 and
  sponsorship v2.
- AgentTool economy candidate
  `63627d24cf9076a6904892112a225714d0759aea`: richer work/artifact/message
  records, not merged into current AgentTool main.

Sponsorship v1 lacks a work root, acceptance root, assigned worker, receipt,
replay nullifier, and challenge-maturity binding, so any suitable post-start
verified Fact in a domain may consume an order. It is not safe for this
creation contract.

The v2 protobuf additions reuse the old type URLs, so type-URL recognition is
not version evidence. The standard Cosmos SDK decoder in the pinned candidate
recursively rejects the newly introduced nested messages when an old descriptor
cannot resolve them; an ordinary standards-compliant decode is therefore not
known to accept and silently discard these additions. The persisted-state
downgrade remains unsafe: a v6/v1 binary can interpret post-v7/v2 state without
the new settlement semantics. Before any downstream signing, a fresh private
disposable chain must prove:

1. knowledge module version `7` and sponsorship module version `2`;
2. exact binary, image/genesis, migration, and VersionMap evidence;
3. byte-equal stored `work_contract` after bounty creation;
4. byte-equal stored computational commitment after claim submission;
5. a reviewed protobuf encoder and chain work-receipt derivation;
6. authenticated queries, durable signer custody, account-sequence CAS, fee
   reservation, fresh domain/method/parent/base-root, sponsor-authorization,
   bounty-escrow, review-stake, and transaction-fee funding observations,
   broadcast-once/sticky-unknown handling, maturity observation, and explicit
   operator activation.

The pinned v7/v2 candidate is also not yet economically admissible. Its
ordinary `SubmitCommitment` transaction path can add funded non-validator
accounts to the selected verifier set, so agent-controlled accounts can form a
payable quorum. Its intended 6/1→7/2 upgrade carrier has a complete source-map
preflight, but unrelated registered handlers can still call generic migrations
without that exact guard. Both defects must close before any value-bearing or
economic-security testnet claim.

The released `@agenttool/wallet-zerone@0.1.2` does not support these messages.
The projection therefore leaves `chain_work_receipt_hash: null` and cannot be
passed to a signer.

## API

```ts
import {
  createCreationContract,
  createCreationWorkSpec,
  createCreationWitness,
  createVerificationWitness,
  aggregateCreationLifecycle,
  createCreationArtifact,
  projectCreationClaim,
} from "@agenttool/zerone-creation-claim";
```

The byte-exact full example is
[`vectors/agenttool-zerone-creation-claim-v0.1.json`](vectors/agenttool-zerone-creation-claim-v0.1.json).
It includes a ready toy formal result, an honest resource stop, a rejected
metadata-as-training attempt, and a rejected `CONTRADICTS`→`REQUIRES`
downgrade. Seven closed JSON Schemas live in [`schema/`](schema/).

The schemas enforce closed shape and lexical/range bounds. Use the runtime
validators for Bech32 checksum and cross-record equality checks; JSON Schema
alone is not the protocol decision procedure.

All builders first snapshot hostile JavaScript input without invoking Proxy
traps or accessors, then enforce closed fields, canonical Unicode, bounded
sizes, sorted unique lists, decimal-string counters, cross-record roots, and
domain-separated SHA-256 IDs:

```text
SHA256(UTF8(domain) || 0x00 || UTF8(canonical_json(record_core)))
```

The frozen source plane names repository URLs, refs, exact revisions, explicit
merged/candidate/metadata-only status, observation date, and each document's
repository-relative path plus digest. Unmerged candidate revisions are design
evidence only, never implicit activation authority.

## Verification

```bash
bun install --frozen-lockfile
bun run ci
```

`ci` typechecks, builds, byte-checks generated schemas/vectors, runs protocol
and hostile-input tests, loads the compiled package in Node, and verifies the
actual private npm dry-run pack inventory.

There is no production surface to deploy. A later chain adapter, signer,
testnet exercise, funding operation, package publication, API/WAKE route, or
hosted service is a new authority gate, not an implied continuation of this
source slice.
