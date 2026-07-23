# Agent Repo Archive 0.1

> **Compass:** [Agent Repo Archive](../AGENT-REPO-ARCHIVE.md) · [Agent Data Protocol](../AGENT-DATA-PROTOCOL.md) · [ADDS 0.1](ADDS-0.1-DRAFT.md) · [Agent Correspondence](../AGENT-CORRESPONDENCE.md)
>
> **Implements:** The `agent-repo-archive/v0.1` signed records, encrypted payload, recovery envelope, zone verification, health calculation, and safe Git restore profile.
>
> **Code:** [`packages/repo-archive/src/`](../../packages/repo-archive/src/) · [`packages/repo-archive/schema/agent-repo-archive-v0.1.schema.json`](../../packages/repo-archive/schema/agent-repo-archive-v0.1.schema.json)
>
> **Tests:** [`packages/repo-archive/tests/`](../../packages/repo-archive/tests/) · [`packages/repo-archive/vectors/agent-repo-archive-v0.1-vectors.json`](../../packages/repo-archive/vectors/agent-repo-archive-v0.1-vectors.json)

Status: **Experimental Working Draft, 2026-07-23.**

This document is normative for the local reference profile. The JSON Schema
is normative for record shape. Runtime validators additionally enforce
cross-record and cryptographic invariants that JSON Schema cannot express.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as requirement levels.

## 1. Scope

`agent-repo-archive/v0.1` preserves committed Git source history as complete,
encrypted replicas in independently addressed storage zones. It defines:

- conservative Git capture coverage;
- four closed signed control records;
- one encrypted snapshot payload framing;
- one recovery-key envelope profile;
- independent zone placement and full restore verification;
- encrypted catalog bootstrapping; and
- no-checkout recovery into a fresh repository.

It does not define account discovery, provider credentials, scheduling,
retention contracts, secure deletion, pruning, garbage collection, repair,
erasure coding, consensus, a hosted service, or physical-zone proof.

## 2. Layering

Git owns commits, objects, refs, and fsck semantics.

ADDS owns AES-GCM content encryption, ciphertext CIDs, signed Manifests,
portable encrypted objects, and the `BlockStore` interface.

Repo Archive owns repository coverage, signed archive records, object-key
recovery envelopes, zone classifications, read-back evidence, and safe restore
orchestration.

A conforming implementation MUST NOT describe an ADDS write acknowledgement,
an IPFS CID, a provider object listing, or a signed archive receipt as a future
retention guarantee.

## 3. Canonical records

The protocol identifier is:

```text
agent-repo-archive/v0.1
```

The public control records are:

- `snapshot`
- `placement`
- `verification`
- `catalog`

Every record is a closed restricted-I-JSON object. Unknown fields, duplicate
object names, non-scalar Unicode, NUL, non-integer numbers, negative zero,
unsafe integers, sparse arrays, and values outside the schema bounds MUST be
rejected.

The exact shape is
[`agent-repo-archive-v0.1.schema.json`](../../packages/repo-archive/schema/agent-repo-archive-v0.1.schema.json).
The secret-bearing recovery capsule is deliberately absent from that schema.

### 3.1 Record identity and signature

Let `core` be the record without `record_id` and `signature`, including its
`signer`.

```text
record_id =
  "sha256:" || lowerhex(SHA-256(JCS(core)))

signing_bytes =
  UTF8("agent-repo-archive/v0.1/" || kind)
  || 0x00
  || JCS(core with record_id)

signature = Ed25519(signing_bytes)
```

JCS means RFC 8785 canonical JSON under the restricted input profile. Public
keys and signatures use canonical unpadded base64url. Verification MUST reject
non-canonical encodings, small-order or non-torsion-free points, and permissive
ZIP-215-only acceptance.

The signature attributes the record to the included key claim. It does not
resolve the signer's identity, establish that a provider retained bytes, prove
that a failure-domain declaration is true, or grant restore authority.

Pinned bytes are in
[`agent-repo-archive-v0.1-vectors.json`](../../packages/repo-archive/vectors/agent-repo-archive-v0.1-vectors.json).

## 4. SnapshotDescriptor

A SnapshotDescriptor binds:

- one opaque `vault_id`;
- one opaque `repository_id`;
- exact object format, `HEAD`, branch state, named symbolic-ref targets,
  named-ref count, and named-ref digest;
- explicit source-coverage evidence;
- Git bundle SHA-256 digest and byte size;
- optional parent Snapshot ID; and
- `automatic_restore: never`, `execute_repository_code: never`, and
  `checkout: explicit_after_restore`.

`repository_id` MUST NOT be a filesystem path or credential-bearing remote
URL. It MUST reject file URIs, absolute and dot-relative path forms, URL
userinfo, queries, and fragments. The default local implementation derives an
opaque SHA-256 label from the canonical worktree path; KINGDOM-OS SHOULD supply
a stable registry identity such as `repo:github.com/owner/name`.

### 4.1 Capture

The v0.1 reference capture MUST:

1. Resolve the exact worktree root and refuse a subdirectory or unborn
   repository.
2. Observe object format, exact attached/detached `HEAD`, every named ref and
   named symbolic-ref target, index/worktree/untracked status, shallow/partial
   clone state, alternates, and linked worktrees. Submodule gitlink,
   LFS-pointer, and `filter=` attribute evidence MUST be assessed across all
   refs and committed history selected for capture, not only the current
   worktree or `HEAD`. History scans MUST examine merge commits against their
   parents and MUST treat candidate blobs as text without invoking textconv or
   external diff commands.
3. Refuse incomplete state unless the caller explicitly requests an
   incomplete committed-history capture.
4. Run `git bundle create <private-file> --all HEAD` without a shell, network
   prompt, lazy promisor fetch, hooks, or fsmonitor.
5. Run `git bundle verify` and require every observed ref plus exact `HEAD` in
   the bundle.
6. Repeat the observation and refuse to seal if refs, HEAD, workspace, or any
   source-completeness evidence changed.

Capture MUST NOT stash, commit, checkout, merge, rebase, fetch, push, contact
submodule URLs, invoke LFS, or read remote credentials.

### 4.2 Completeness

`complete` means complete committed source under this profile. It requires:

- clean index and tracked worktree;
- no untracked or unmerged paths;
- no submodule gitlinks;
- no LFS pointers or declared external filters;
- no shallow or partial clone;
- no alternate object locations;
- no additional linked worktrees; and
- no named ref whose terminal peeled object is a direct tree or blob.

Ignored files, hooks, local Git config, remotes, reflogs, and filesystem
metadata are explicitly outside v0.1 and remain marked `included: false`.

The `gitlink_evidence_events`, `pointer_evidence_events`, and
`attribute_evidence_events` counters report matching committed-history change
events across the captured refs, including per-parent merge-diff events. They
are conservative evidence counts, not counts of unique current paths, live
submodule configuration, or materialized external objects.

The reference implementation cannot apply this history-diff assessment to a
named ref whose terminal peeled object is a direct tree or blob. It records
that condition as a bounded incompleteness reason and requires the caller's
explicit incomplete-capture opt-in before bundling the exact ref. Reasons MAY
therefore represent a conservative assessed gap that has no dedicated v0.1
counter.

If any assessed gap exists, `status` MUST be `incomplete`, at least one bounded
reason MUST be present, and callers MUST opt in before a bundle is emitted.
A successful restore of that bundle does not change the capture status.
`shallow_clone.complete_history` MUST be the logical inverse of
`shallow_clone.detected`; the field is evidence, not an independent claim.

## 5. Snapshot payload framing

The signed SnapshotDescriptor and raw Git bundle are framed before ADDS
encryption:

```text
offset  size  value
0       9     UTF8("ARA\\x00v0.1\\n")
9       4     unsigned big-endian descriptor byte length
13      N     JCS(SignedSnapshotDescriptor)
13+N    rest  exact Git bundle bytes
```

The descriptor is limited to 1 MiB. The bundle length and SHA-256 MUST match
the descriptor before encryption and after decryption. Trailing bytes are part
of the bundle; there is no second payload section.

The ADDS Manifest MUST use:

```text
schema:
  https://docs.agenttool.dev/specs/agent-repo-archive-0.1.schema.json#snapshot-payload

media_type:
  application/vnd.agenttool.repo-archive.snapshot+binary;version=0.1
```

The `#snapshot-payload` fragment is a resolvable media-profile identifier. It
does not assert that JSON Schema validates the binary framing; implementations
MUST apply the byte-level checks in this section.

Manifest metadata is limited to the protocol and record kind. Repository
identity, refs, paths, provider locators, and recovery material MUST NOT be
placed in public ADDS metadata.

## 6. Recovery-key envelope

ADDS portable objects deliberately contain no data-encryption key, and ADDS
direct Grants have finite lifetimes. v0.1 therefore defines an archive-local
envelope for each 32-byte ADDS object key.

Inputs:

- one random 32-byte vault recovery key;
- opaque `vault_id`;
- opaque `recovery_key_id`; and
- the ADDS Manifest CID receiving the object key.

Derive:

```text
salt = SHA-256(UTF8(vault_id))
info = UTF8(
  "agent-repo-archive/v0.1/recovery-envelope"
  || 0x00
  || recovery_key_id
)

wrapping_key =
  HKDF-SHA256(vault_recovery_key, salt, info, 32)
```

The envelope header contains exact protocol, kind, algorithm, AAD-domain,
vault/key identifiers, and Manifest CID. The object key is encrypted with
AES-256-GCM, a fresh random 12-byte nonce, and
`JCS(envelope_header)` as AAD. The ciphertext is exactly 48 bytes: 32-byte key
plus 16-byte GCM tag.

An envelope MUST fail if moved to another Manifest CID, vault, or recovery-key
identifier. Raw object keys MUST NOT appear in records, catalogs, zone bytes,
logs, or API results.

The recovery key is a vault root. Compromise exposes all envelopes for that
vault; loss makes them unrecoverable. Rotation and hardware/provider custody
are not defined by v0.1.

## 7. Zones and placement

A ZoneDescriptor carries:

- an opaque zone ID and restricted non-secret locator;
- transport kind;
- assurance level;
- deletion-authority classification; and
- opaque provider, account, region, credential-root, and media failure-domain
  labels.

Locators MUST be non-secret URIs and MUST live only in encrypted archive
control data or local adapter configuration. The v0.1 restricted locator form
excludes userinfo, queries, fragments, percent escapes, and whitespace and is
limited to 512 characters. Locators MUST NOT enter Correspondence.

Two locators under one required failure-domain root do not count twice.
`simulated` assurance proves only implementation behavior.
Failure-domain labels are signed operator claims: signatures make them
attributable but do not prove provider, account, credential, region, or media
independence. The reference implementation rejects the same `BlockStore`
object instance, provider/account label pair, or credential-root label being
supplied as two zones. Distinct adapter instances and labels can still share
infrastructure; these checks do not prove independence.

### 7.1 Encrypt once, import independently

A conforming placement implementation MUST:

1. Create the encrypted snapshot in a private staging ADDS store.
2. Export one strict complete portable ADDS bundle.
3. Import that exact bundle independently into each named zone.
4. Read every ciphertext Block back from that zone alone.
5. Create a PlacementReceipt only after the zone has a complete valid
   ciphertext inventory.

It MUST NOT infer a complete zone from composite fallback reads or
`MultiBlockStore` aggregate counters.

A PlacementReceipt is `observed` and carries the literal caveat
`observation_is_not_future_durability`.

## 8. VerificationReceipt

A `verified` receipt requires, against one named zone alone:

1. complete Manifest and ciphertext CID/framing validation;
2. object-key recovery through the configured vault recovery route;
3. successful AES-GCM authentication of every ADDS chunk;
4. valid SnapshotDescriptor record signature;
5. matching bundle size and SHA-256 digest;
6. `git bundle verify`;
7. exact-ref import into a fresh no-checkout repository;
8. matching attached/detached `HEAD`, named symbolic refs, and named-ref
   digest; and
9. `git fsck --full --strict --no-reflogs`.

The receipt MUST say `checkout_performed: false`. Verification MUST NOT run
hooks, global/system Git configuration, templates, filters, LFS, submodules,
or repository code.

The receipt is historical. A later missing/corrupt zone does not rewrite the
old receipt; a successor catalog recomputes current health.

## 9. RecoveryCatalog

The catalog contains:

- signed SnapshotDescriptor;
- snapshot ADDS Manifest CID;
- snapshot recovery-key envelope;
- declared zones;
- signed Placement and Verification Receipts;
- required verified-zone threshold;
- generation and optional parent catalog ID; and
- derived health status.

It is signed, encoded as canonical JSON, encrypted as its own ADDS object, and
independently offered to every archive zone. A zone is catalog-available only
after that zone alone decrypts and validates the catalog. A failed zone does not
destroy a capsule for other usable zones.

Its ADDS Manifest MUST use:

```text
schema:
  https://docs.agenttool.dev/specs/agent-repo-archive-0.1.schema.json#recovery-catalog

media_type:
  application/vnd.agenttool.repo-archive.catalog+json;version=0.1
```

The catalog is discovery and evidence, not an authority to execute recovery.

### 9.1 Health

Health is derived conservatively:

1. An incomplete source capture is always `incomplete`.
2. A complete capture with placement observations and no verified zone is
   `observed`.
3. A complete capture with at least one but fewer than the required distinct
   verified failure domains is `degraded`.
4. A complete capture with the required number is `verified`.
5. No nested placement or verification evidence is `incomplete`.

Schema-valid but cross-vault, cross-snapshot, duplicate-zone, undeclared-zone,
wrong-envelope, or falsely derived status combinations MUST be rejected.

Catalog health describes the nested snapshot evidence in a catalog that has
already been retrieved; a catalog cannot attest its own current availability.
`archiveRepository()` therefore also returns an unsigned, process-local
`ArchiveRepositoryOutcome`. `policy_satisfied` is true only when the catalog
round-tripped through the required distinct domains that also hold verified
snapshot copies. The outcome lists snapshot and catalog failures, but it is
operational telemetry rather than a signed durability record. Durable catalog
placement receipts and resumable repair are deferred beyond v0.1.

## 10. Offline recovery capsule

Recovery bootstrap needs:

- current catalog Manifest CID;
- catalog recovery-key envelope;
- vault and recovery-key identifiers; and
- the 32-byte vault recovery key.

This is the `RecoveryCapsule` application interface. It is not a public record,
has no JSON Schema, MUST NOT be logged or replicated beside ciphertext, and
MUST be protected by a separately chosen offline/OS/hardware custody system.
The library-returned capsule refuses JSON serialization to reduce accidental
logging. That guard is not encryption, backup, rotation, or durable custody;
the caller must transfer the capsule into a separately reviewed custody path.

The reference simulator keeps it only in process memory and erases its local
copies on completion. This does not prove secure erasure or production
custody.

## 11. Restore

Restore MUST start with one zone plus the recovery capsule and MUST NOT depend
on publisher process memory.

The implementation:

1. Retrieves and decrypts the catalog.
2. Validates the catalog and every nested signature/invariant.
3. Retrieves and decrypts the named snapshot from the same zone.
4. Validates payload framing, the signed descriptor, and Git bundle bytes.
5. Requires a non-existent target beneath an existing canonical,
   non-symlinked parent.
6. Initializes a private staged repository with an empty template and
   system/global config disabled.
7. Imports every bundle ref plus exact `HEAD`.
8. Uses a collision-checked temporary ref only for an otherwise unreachable
   detached `HEAD`, then removes it.
9. Compares ref digest/count and runs full strict fsck.
10. Revalidates the parent and atomically renames the complete staged
    repository into the new target.

The target remains no-checkout. Materializing a worktree is a separate
explicit action because checkout can invoke filters and other host behavior.
Ordinary verification failures remove private staging and leave the final
target absent.

The operator MUST control the restore parent and prevent concurrent path
renames or replacement while restore runs. The Node reference checks and
canonicalizes the parent before atomically claiming the final directory, but
Node does not provide the fd-relative `mkdirat`/`openat` sequence needed to
eliminate every check-to-use race.

## 12. Bounds and temporary plaintext

The reference default plaintext object and Git-bundle admission limit is
64 MiB and the default ADDS chunk size is 4 MiB. `maxBytes` limits admitted
object/bundle size; it is not a peak-memory guarantee. The current path can
hold multiple plaintext, framed, ciphertext, and portable-object copies in
memory.

Implementations SHOULD NOT raise that default for untrusted or
memory-constrained operation until capture, encryption, portable export/import,
and restore have bounded streaming paths. A larger input limit without
streaming can multiply peak memory rather than merely admit a larger archive.

Git bundle creation and verification use private temporary directories and
mode-`0600` bundle files. They are removed after use. Filesystem removal is not
secure deletion on SSD, copy-on-write, snapshots, or backups.

Implementations SHOULD use a dedicated protected staging volume when this
residual plaintext risk matters.

Git subprocesses have finite wall-clock and output bounds. Those limits,
disabled prompts/configuration/hooks, and no-checkout restore reduce ambient
behavior, but they are not a sandbox for hostile Git object databases or a
compromised `git` executable.

The archive operation is not crash-resumable in v0.1. A process or host failure
can leave provider Blocks or private temporary state without a sealed catalog;
operators must inspect and clean abandoned state under their storage and
staging policies before retrying.

## 13. Correspondence and YUTABASE

No new Correspondence event kind is required. After successful restore-level
verification, an `artifact.offer` MAY announce an opaque content digest or
archive URN. It MUST NOT contain zone descriptors, locators, catalog content,
provider responses, or recovery material.

YUTABASE MAY project Snapshot ID, health, verified-zone count, and verification
time. It MUST remain rebuildable and MUST NOT be required for recovery.

## 14. Conformance

The local reference conformance suite covers:

- closed schema and secret-field rejection;
- pinned canonical record ID and signature vectors;
- recovery envelope roundtrip, wrong-key, and cross-CID failure;
- clean, dirty, hostile-filename, attached, detached, SHA-1, SHA-256, and
  zero-named-ref Git capture;
- history-wide and merge-result gitlink/LFS/filter evidence, including
  repository `-diff` masking;
- fail-closed direct tree/blob refs with explicit incomplete-capture opt-in;
- exact direct/symbolic ref and no-checkout restoration;
- cross-vault and mismatched nested catalog rejection;
- distinct-failure-domain health calculation;
- the rotating per-Block quorum counterexample;
- three independent zone imports and restore drills;
- publisher-state loss;
- one-zone corruption or outage with healthy-zone recovery and degraded
  outcome;
- no plaintext source/path markers in zone bytes;
- no hook execution;
- existing/symlink restore target refusal and parent-replacement detection;
- secret-like locator/repository-ID, invalid-date, unsafe-integer, and invalid
  CID rejection; and
- accidental recovery-capsule JSON serialization refusal.

Passing the suite proves compatibility with this implementation profile. It
does not prove operational durability, provider independence, secure key
custody, or security against every hostile Git object/database input.

## 15. Licence and change process

This specification text is offered under CC0 1.0 Universal. The reference
implementation is Apache-2.0 and remains an unreleased developer preview while
this document is a Working Draft. Draft changes are reviewed in the AgentTool
repository. Any incompatible change to closed record shape, canonical bytes,
signing domains, payload framing, envelope construction, or restore semantics
requires a new schema or protocol version; no `0.x` compatibility promise is
implied.
