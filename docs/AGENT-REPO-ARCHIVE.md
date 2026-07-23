# Agent Repo Archive

> **Compass:** [Agent Data Protocol](AGENT-DATA-PROTOCOL.md) · [ADDS 0.1](specs/ADDS-0.1-DRAFT.md) · [Agent Correspondence](AGENT-CORRESPONDENCE.md) · [Development](DEVELOPMENT.md)
>
> **Implements:** An encrypted, local-first repository archive profile with independently recoverable zone copies and explicit restore evidence.
>
> **Code:** [`packages/repo-archive/`](../packages/repo-archive/) · [`packages/data-protocol/`](../packages/data-protocol/)
>
> **Tests:** [`packages/repo-archive/tests/`](../packages/repo-archive/tests/)

Agent Repo Archive makes committed source history recoverable without turning
Git synchronization, Correspondence, YUTABASE, or a provider upload response
into a backup claim.

The narrow waist is:

```text
repository inventory
        │
        ▼
Git bundle + explicit coverage report
        │
        ▼
signed SnapshotDescriptor inside one ADDS encrypted object
        │
        ├── independently import/read/restore Zone A
        ├── independently import/read/restore Zone B
        └── independently import/read/restore Zone C
        │
        ▼
signed receipts + encrypted RecoveryCatalog
        │
        ├── Correspondence may announce only an opaque verified digest
        └── YUTABASE may project health but is not needed for recovery
```

## What “decentralised” means here

It means multiple complete ciphertext copies under distinct operational
failure domains, plus a recovery route that does not depend on the publishing
process.

It does not mean that three directories on one disk are durable zones, that
two buckets under one account are independent, or that a CID/upload response
guarantees retention. Zone descriptors classify provider, account,
credential, region, and media roots. Those classifications are operator
claims unless separately evidenced. They are signed so the claim is
attributable, not so the independence becomes true. The implementation rejects
one `BlockStore` object instance, provider/account label pair, or
credential-root label reused for two zones, but distinct objects and labels may
still reach the same infrastructure; independence remains unproven.

The v0.1 simulator labels every local zone `assurance: "simulated"` and emits
`durability_claim: "none"`.

## The complete-replica rule

Each zone must independently hold the complete ADDS object. The implementation
does not publish through one `MultiBlockStore` and infer per-zone durability
from aggregate counters. A threshold applied per Block can succeed while
rotating failures leave every provider missing a different Block.

Instead, the reference path encrypts once, exports one validated portable ADDS
bundle, imports it into each zone, then reads it back from that zone alone.

## Recovery evidence

Four claims remain separate:

1. `observed`: the complete ciphertext inventory was read back from one named
   zone. This is historical observation, not future availability.
2. `verified`: that zone alone decrypted through the configured recovery
   route, matched the signed payload digest, passed `git bundle verify`,
   restored into a fresh no-checkout repository, and passed full strict fsck.
3. `degraded`: a complete capture has some verified copies but fewer than
   policy requires.
4. `incomplete`: source coverage or the recovery evidence is insufficient.

A signed receipt attributes the report to a key. It does not make the report
true or prove a provider will retain bytes tomorrow.

Archive creation also returns an unsigned local `outcome`. It distinguishes the
catalog/snapshot zone intersection that actually round-tripped from the signed
catalog's nested snapshot evidence. Missing a requested threshold returns a
recoverable degraded result when at least one catalog copy survives; it does
not erase the only generated recovery route and orphan otherwise healthy
ciphertext. This outcome is telemetry for repair policy, not a durable receipt.

## Source coverage

The v0.1 payload is committed Git history, not a directory image. `complete`
means every named ref, named symbolic-ref target, and exact `HEAD` was captured
and the source was stable, clean, non-shallow, non-partial, without alternates,
linked worktrees, submodule gitlinks, LFS pointers, or declared external
filters. A named ref that peels to a direct tree or blob is captured only after
explicit incomplete-capture opt-in because v0.1 cannot apply its
committed-history external-state assessment to that ref.
Gitlink, LFS-pointer, and `filter=` evidence is scanned across all captured
refs/history, rather than inferred only from the checked-out branch.
The corresponding counters count matching committed-history change events;
they are conservative evidence, not unique current-path inventories.

Ignored files, hooks, local config, reflogs, remotes, and credentials are
explicitly outside this profile. Dirty or external state can be captured only
as `incomplete` committed history after the caller opts in. Those excluded
bytes never silently become covered.

## Key route

ADDS portable objects contain no data-encryption key, and direct ADDS Grants
expire. Repo Archive therefore wraps each ADDS object key under a vault
recovery key using the profile in the normative specification.

The encrypted RecoveryCatalog carries the snapshot key envelope. A small
offline recovery capsule carries:

- the catalog Manifest CID;
- the catalog key envelope;
- the opaque vault and recovery-key identifiers; and
- the 32-byte vault recovery key.

The capsule is not a public wire record. A capsule returned by the library
refuses JSON serialization to reduce accidental logging, and the reference
simulator keeps it only in process memory. That refusal is not durable
protection. A production adapter still needs reviewed Keychain,
hardware/offline, or provider-vault custody, rotation, and recovery-copy
operations.

Three intact ciphertext replicas with a lost capsule are not a backup.

## Operator and runtime boundaries

Restore requires an operator-controlled, existing parent directory with no
concurrent rename or replacement. The Node reference canonicalizes that parent
and atomically claims a new child, but cannot provide an fd-relative
`mkdirat`/`openat` sequence that removes every check-to-use race.

Git subprocesses have finite time and output limits and run with prompts,
global/system configuration, hooks, and checkout disabled where applicable.
Those controls are not a hostile-code sandbox. Archive creation is also not
crash-resumable: a crash can leave unsealed provider Blocks or private staging
state that local policy must inspect and clean before retry.

The default `maxBytes` admission limit is 64 MiB, but that is not a peak-memory
bound: the current ADDS composition can hold several plaintext, framed,
ciphertext, and portable copies. Raising the admission limit safely requires
bounded streaming through capture, encryption, zone import, and restore.

## Ecosystem boundaries

- **KINGDOM-OS** should supply repository identity and allow/deny policy.
- **ADDS** owns ciphertext Blocks, CIDs, Manifests, and portable object
  validation.
- **Correspondence** may announce an opaque artifact digest after restore
  verification. It must not carry provider locators, credentials, catalogs, or
  recovery material.
- **YUTABASE** may project snapshot health, verified-zone count, and audit
  time. It remains rebuildable and non-authoritative.
- **Syzygy/Git synchronization** remains separate. Archive capture never
  stashes, commits, checks out, merges, rebases, fetches, or pushes.

## Current implementation boundary

The package contains generic ADDS `BlockStore` composition and a filesystem
simulator. It has no R2, B2, OCI, WebDAV, IPFS, rclone, scheduler, pruning,
repair, or hosted service integration yet. No API route or production
deployment is created by the package.

The normative record, encryption, capture, and restore rules are in
[Agent Repo Archive 0.1](specs/AGENT-REPO-ARCHIVE-0.1.md).
