# `@agenttool/repo-archive`

Local reference implementation of **Agent Repo Archive 0.1**: encrypted,
signed, independently verified Git repository snapshots across multiple
storage zones.

The package does:

- capture every named Git ref plus the exact attached or detached `HEAD` in a
  self-contained Git bundle, with direct tree/blob refs requiring explicit
  incomplete-capture opt-in;
- report excluded workspace, submodule, LFS, filter, shallow/partial clone,
  alternate-object, linked-worktree, and non-commit-ref state without calling
  it complete;
- sign closed Snapshot, Placement, Verification, and Recovery Catalog records;
- encrypt snapshot and catalog bytes through `@agenttool/adds`;
- encrypt each ADDS object key under one caller-custodied vault recovery key;
- import the same validated ADDS portable object into each zone independently;
- issue a verified receipt only after a per-zone decrypt, payload digest,
  `git bundle verify`, fresh no-checkout restore, and `git fsck --full --strict`;
- restore exact refs from one zone and an offline recovery capsule without the
  publisher's process or ADDS MemoryKeyStore.

It does not:

- pool providers into one filesystem;
- prove future retention, geographic independence, provider honesty, or secure
  deletion;
- capture dirty/untracked bytes, ignored files, hooks, local Git config,
  reflogs, submodule repositories, LFS objects, or external filter output;
- run checkout, hooks, filters, LFS, submodules, or repository code during
  restore;
- provide R2, B2, S3, WebDAV, IPFS, rclone, discovery, pruning, scheduling,
  repair, or production key-vault adapters in v0.1;
- turn a same-device three-directory simulation into three physical failure
  domains.

## Local three-zone proof

```bash
bun install
bun run build
node dist/cli.js simulate --repo /absolute/path/to/clean/repository
```

The default simulation uses a temporary directory and removes it when the
proof finishes. Supplying `--root /new/absolute/path` preserves the simulated
zones and no-checkout restores for inspection. The process-held recovery key
is deliberately erased before exit, so preserved simulator ciphertext is not
a usable long-term backup.

An incomplete committed-history proof must be explicit:

```bash
node dist/cli.js simulate \
  --repo /absolute/path/to/repository \
  --allow-incomplete
```

The output says `capture_status: "incomplete"` and the signed catalog remains
`incomplete`; successful recovery of committed Git history never upgrades
excluded workspace bytes or unassessable direct tree/blob refs into a complete
claim.

## Library shape

```ts
import { FileSystemBlockStore } from "@agenttool/adds/fs";
import { generateIdentity } from "@agenttool/adds";
import {
  archiveRepository,
  restoreRepository,
  type ArchiveZone,
} from "@agenttool/repo-archive";

const zones: ArchiveZone[] = [
  // Each descriptor names a real failure-domain classification and each store
  // is an independent ADDS BlockStore adapter.
];

const archived = await archiveRepository({
  repositoryPath: "/repos/example",
  repositoryId: "repo:kingdom:example",
  zones,
  publisherIdentity: generateIdentity("urn:example:archive-publisher"),
  requiredVerifiedZones: 3,
});

if (!archived.outcome.policy_satisfied) {
  // The capsule and any healthy zones remain recoverable. The outcome lists
  // failed snapshot/catalog zones so policy can schedule an explicit repair.
}

await restoreRepository({
  zone: zones[1]!,
  recoveryCapsule: archived.recoveryCapsule,
  targetPath: "/fresh/restore-target",
  expectedSnapshotId: archived.snapshot.record_id,
});
```

`recoveryCapsule` contains a 32-byte secret. The library-returned object keeps
the key non-enumerable and throws on JSON serialization; callers can still read
the bytes, so this is an accident guard rather than custody. A real operator
must put the recovery key plus current catalog pointer/envelope into an
independently protected offline or OS-managed secret store. Losing it makes
intact zone bytes unrecoverable; exposing it compromises every object envelope
for that vault.

`outcome` is unsigned process telemetry. A degraded archive is returned when at
least one catalog copy survives: verified recovery-zone IDs and failed
snapshot/catalog zone IDs remain visible so healthy copies are not orphaned
merely because the requested threshold was missed. Only
`outcome.policy_satisfied === true` means the creation-time catalog and snapshot
round-trips met the requested distinct-domain threshold.

## Why complete replicas first

ADDS `MultiBlockStore` applies its threshold per Block. Rotating provider
failures can satisfy every Block's write quorum while leaving no provider with
one complete object. Repo Archive therefore encrypts once in a private staging
store, exports one strict portable ADDS bundle, and imports/read-backs that
exact bundle against every named zone separately.

The included simulator's three zones are full replicas. Repo histories in the
current ecosystem are small enough that this is easier to audit and recover
than cross-provider erasure shards. Erasure coding remains outside v0.1.

## Plaintext and metadata boundary

Git requires a bundle file for verification. The reference implementation
uses private temporary directories and mode `0600`, then removes the files.
Removal is not secure erasure, especially on copy-on-write or SSD media.

Storage zones receive ADDS ciphertext and signed Manifests. They still learn
object sizes, timing, ciphertext CIDs, the publisher claim, schema/media
labels, and access patterns. Encryption does not hide that metadata.

## Development

```bash
bun install
bun run ci
npm pack --dry-run --ignore-scripts
```

Normative schema and vectors are exported as
`@agenttool/repo-archive/schema.json` and
`@agenttool/repo-archive/vectors.json`.

See
[`../../docs/specs/AGENT-REPO-ARCHIVE-0.1.md`](../../docs/specs/AGENT-REPO-ARCHIVE-0.1.md)
for the wire and state rules.
