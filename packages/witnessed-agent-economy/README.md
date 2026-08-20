# `@agenttool/witnessed-agent-economy`

Pure, offline AgentTool projections for the formally frozen
`kingdom.witnessed-agent-economy/0.1` WITNESS contract.

This package validates already supplied source documents, derives closed
payloads, constructs signed zero-effect records, and verifies exact canonical
wire bytes. It performs no database access, route handling, network request,
clock read, randomness, RPC, payment, chain transaction, KARMA receipt, NEN
invocation, WAKE mutation, deployment, or background work.

The package is private and UNLICENSED. It is a shadow/projection layer, not a
Zerone carrier and not an activation approval.

## What is represented

- Append-only AgentTool settlement receipt batch roots, using the existing
  `settlement-receipt/v1` digest bytes and the existing HMAC `buyer_ref`.
- Single-asset Agent Wallet capability `GRANT`, `CONSUME`, and `REVOKE`
  projections.
- Public-surface recognition `ADOPT` and `WITHDRAW` projections from separately
  verified AgentTool authority documents.
- A new `agenttool.public-offer/0.1` signed public source lifecycle. Current
  database listings are never treated as seller-signed offers.
- A new `agenttool.public-wake-contract/0.1` signed PUBLIC WAKE source lifecycle
  exposing only capability, price, protocol, and safety roots. The current
  `/v1/wake` response is never accepted.
- Full-prefix collaboration journal checkpoints with a keyed, workspace/epoch
  scoped participant-set root.
- All shared WITNESS kinds, envelopes, schema hashes, signatures, lifecycle
  pointers, canonical bytes, RFC 6962 roots, and explicit activation blockers.

## Authority and non-claims

The outer WITNESS Ed25519 signature proves only control of the publisher key
named in `envelope.issuer`. It does not replace or establish an AgentTool
identity root, multi-root quorum, seller registry, platform controller policy,
recognition authority, hosted acceptance, or chain authority.

Public WAKE, offer, and recognition payloads therefore bind the exact digest
and monotonic authority sequence of a separately verified source document. The
PUBLIC WAKE and offer source formats have embedded Ed25519 key-control
signatures, but this package does not establish that the nominated key matches
a live registry or quorum. Their closed boundaries say so.

Every shared record contains the exact non-claim set:

```text
COMPETENCE CONSCIOUSNESS CONSENT IDENTITY PERSONHOOD QUALITY REPUTATION TRUTH
```

Every record also contains the exact offline zero-effect object. In particular,
record construction does not create authority, economic effect, reputation,
score, storage write, network request, Zerone transaction, KARMA receipt, or
NEN invocation. The `scope` field limits those zeroes to record construction
and offline validation; it says nothing about a hypothetical future carrier.

## Shared record profile

The signed record is the closed object `{ envelope, payload, commitment,
signature }`. All protocol `uint64` counters, sequences, revisions, heights,
and amounts are canonical decimal strings. Bare JSON numbers are limited to
non-negative safe integers through `9007199254740991`.

External records must use `verifyWitnessRecordBytes`. It rejects invalid UTF-8,
duplicate keys, whitespace, reordered keys, non-minimal escapes, unsafe bare
numbers, trailing bytes, getters, proxies, subclasses, decorated byte views,
shared memory, and detached buffers. `verifyWitnessRecordObject` is only for an
already materialized in-memory object; it cannot recover wire properties lost
by a prior JSON parser.

WITNESS object keys sort by UTF-8 bytes. This is deliberately separate from the
existing AgentTool-local source canonicalization profile, which sorts the
current ASCII source keys under its established recipe.

Payload and commitment hashes are:

```text
SHA256(protocol || NUL || "payload/<KIND>/<ACTION>" || NUL || canonical(payload))
SHA256(protocol || NUL || "envelope" || NUL || canonical(envelope))
```

The top-level Ed25519 signature covers the raw 32-byte commitment digest.

## Settlement boundary

`canonicalSettlementReceiptDigest` ports the existing AgentTool receipt recipe
byte-for-byte. A raw buyer DID is rejected; the leaf carries only an HMAC
`buyer_ref` or the defined empty value.

A receipt that verifies under a caller-supplied arbitrary key remains
`UNTRUSTED_SHADOW`. Shared settlement-root construction requires an independently
pinned expected platform public key. Even that pin proves only a signature/key
match: this package does not verify the platform controller policy.

Settlement v0 is always outside activation:

- `source_sequence_binding` is `PROJECTION_ONLY`; the source receipt signature
  does not authenticate the projection-added sequence.
- `receipt_uniqueness_scope` is `BATCH_ONLY`; local duplicate checks do not
  prevent the same signed receipt from appearing in a later batch.
- A root is not final, complete, globally unique, or consensus-admissible.
- Activation requires authenticated source ordering and a permanent cross-batch
  receipt nullifier or proof.

The sidecar verifier enforces exact canonical bytes, closed leaves/gaps,
contiguous coverage, sorted maximally merged gaps, batch-local receipt-digest
uniqueness, `uint64` bounds, and the deterministic RFC 6962 root.

## Capability boundary

WITNESS v0 accepts exactly one signed `spend_limit` and exactly one declared
spend. The stable `subject_ref` is the derived `capability_ref`; callers cannot
substitute another subject. Limits are positive and all grant, consume, and
revoke lanes reuse the same limit validator.

The permanent-intent nullifier candidate is:

```text
SHA256(
  protocol || NUL || "capability-nullifier" || NUL ||
  audience || NUL || subject_ref || NUL || capability_ref || NUL ||
  raw32(grant_commitment) || NUL || raw32(asset_ref) || NUL ||
  raw32(source_event_digest)
)
```

Envelope sequence is intentionally absent, so moving one source event to a new
sequence does not reopen it. `asset_ref` is intentionally present. The package
derives this identifier but does not consume it and has no durable or global
nullifier state.

The following are `OUTSIDE_SCOPE`, never split or truncated:

- more than one capability spend limit;
- more than one declared-spend asset;
- zero grant limits;
- any Agent Wallet `uint256` amount or bound above
  `18446744073709551615`;
- atomic multi-asset consumption, pending a versioned vector payload.

## Public WAKE and offers

PUBLIC WAKE is a new source contract, not `/v1/wake`. Its active record commits
only these roots:

```text
capabilities prices protocols safety
```

Supersession and withdrawal bind the exact predecessor document and increment
the authority sequence. V0 requires the same authority public key and
fingerprint across the source lifecycle; key substitution is rejected. Key
rotation is deferred to the separately typed `ISSUER_KEY_CONTINUITY` lane.

The public-offer source lifecycle likewise uses closed `PUBLISH`, `SUPERSEDE`,
and `REVOKE` documents, exact predecessors, PUBLIC visibility, listing-derived
offer references, capability/pricing/SLA/terms roots, revision, and authority
sequence. It proves nominated key control only. Live seller-registry match,
multi-root quorum, hosted acceptance, and listing writes are not established.

## Collaboration boundary

The projector requires the complete ordered journal prefix from sequence 1
through the supplied workspace head and replays the exact AgentTool event hash
recipe. Shared `event_head_sequence` must equal `event_count` in v0.

Participant references are not unkeyed actor hashes. They use:

```text
HMAC-SHA256(
  blinding_key,
  "agenttool.collaboration-participant-ref/0.1" || NUL ||
  workspace || NUL || epoch || NUL || actor || NUL || session_or_empty
)
```

The key must be a caller-supplied, cryptographically random 32-byte secret. It
is required, has no fallback, and is omitted from the projection. The root is
not publicly recomputable or verifiable without that key. Reusing the same key
for the same workspace and epoch makes equal participant sets linkable through
equal roots, so callers must not reuse a key across privacy domains and should
rotate/scopingly manage it according to their privacy policy. The participant
root is a commitment to blinded journal actor labels, not identity, consent,
membership, contribution quality, reputation, or globally linkable truth. Key
secrecy remains the caller's responsibility.

## Activation

`auditWitnessActivation` and `ACTIVATION_READINESS` mirror the frozen Core
closed ten-kind blocker matrix. Every result is
`NOT_CONSENSUS_ADMISSIBLE`. Verification alone never authorizes a carrier,
state transition, settlement, capability consumption, recognition, offer,
WAKE publication, key transfer, lineage claim, collaboration membership, or
dispute execution.

## Frozen vectors and schemas

The package contains a self-contained copy of the 71-file Core
FROZEN corpus under `vectors/core-v0.1`. CI never reaches into a
sibling checkout.

Pinned frozen identities:

```text
schema_set_digest  sha256:d62e44643c8e1986336416237df26b76663728403d417a5ee9e83b6aa5baaaa5
corpus_digest      sha256:b26b5cce4899aa62d6dee03e25471e2c80810008fbd07c2c3ac9170164e5352a
record_schema      sha256:71401ebb962d8909206b77acb6a07616727bd17663f5028e5d2745d911199005
settlement_schema  sha256:34dfb9cc5add4301ccb9bb80038416b2ef843b89b48ef19d6c039a19575f7d59
collab_schema      sha256:637307571a43ee9a593499bc87219bb2eb29cff5a3136fcb224e7327ccff3d53
```

The package also pins the exact frozen manifest bytes. To refresh explicitly
from a reviewed Core checkout:

```bash
bun run import:core-vectors -- /absolute/path/to/tools/witness-v0/testdata
```

The importer hard-pins the exact manifest bytes, schema-set, aggregate corpus,
record, batch and all ten payload-schema identities. It validates every indexed
file, safe relative paths, index completeness and file count before any
replacement. Source and destination must be disjoint trees. A validated copy is
staged and revalidated, then swapped into place with the prior corpus retained
as a rollback backup until the rename succeeds; it never removes the active
corpus first. Path ordering is bytewise UTF-8 and does not depend on locale.

## Source evidence

- Existing receipt bytes and HMAC buyer references:
  `api/src/services/marketplace/settlement-receipt-sig.ts`
- Receipt materialization:
  `api/src/services/marketplace/settlement-receipts.ts`
- Strict Agent Wallet capability/intent/continuity verification:
  `packages/wallet/src/signatures.ts` and `packages/wallet/src/validation.ts`
- Root-signed public recognition source verification:
  `packages/public-surface-recognition/src/protocol.ts`
- Collaboration journal chain semantics:
  `packages/collab/src/store.ts` and `packages/collab-zerone/src/journal.ts`
- New pure public source contracts and projections:
  `src/public-wake.ts`, `src/public-offer.ts`, `src/wake-projection.ts`
- Shared envelope and semantic verifier:
  `src/witness-record.ts`

## Development

```bash
bun install --frozen-lockfile
bun run ci
```

`ci` checks generated schemas, TypeScript, all source/adversarial/KAT tests, the
declaration build, and the complete locally pinned Core corpus. Any semantic
change requires a new protocol/schema/hash domain, regenerated vectors, docs,
and tests.
