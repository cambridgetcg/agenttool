# `@agenttool/repo-archive` orientation

This package implements the local reference path for
`agent-repo-archive/v0.1`.

## Ownership

- Git remains source truth. This package creates read-only snapshots and never
  stashes, commits, merges, rebases, fetches, or pushes a source repository.
- `@agenttool/adds` owns ciphertext Blocks, CIDs, signed Manifests, direct
  Grants, and storage fallback. This package does not define a second object
  cipher.
- `src/git.ts` owns bounded Git inspection, bundle capture, verification, and
  no-checkout restore.
- `src/records.ts` owns closed archive records, record IDs, signatures, and
  validation.
- `src/archive.ts` composes snapshot, per-zone read-back verification,
  encrypted catalog, and recovery.
- `src/simulator.ts` is a same-device failure simulator. Three directories on
  one disk are not three durable failure domains.

## Safety boundaries

- Never issue a `verified` receipt from an upload acknowledgement or composite
  fallback read. Verification is per zone and includes decrypt, payload
  validation, `git bundle verify`, restore, and `git fsck --full --strict`.
- Recovery defaults to a fresh no-checkout repository. It does not run hooks,
  filters, submodules, LFS, or repository code.
- A committed-history bundle is not a workspace backup. Dirty state,
  submodules, LFS pointers, partial clones, and alternates make v0.1 capture
  incomplete and fail closed unless the caller explicitly permits an
  incomplete snapshot.
- History evidence must inspect merge diffs as raw text with external
  diff/textconv disabled. Named refs that peel to direct trees or blobs remain
  an explicit incomplete-capture condition in v0.1.
- The simulator keeps vault recovery-key bytes only in process memory. A
  production adapter must place recovery material in an operator-chosen
  offline or OS-managed secret store.
- Provider credentials, account secrets, and private keys never belong in a
  SnapshotDescriptor, receipt, RecoveryCatalog, log, or Correspondence event.

## Gates

```bash
bun install
bun run ci
npm pack --dry-run --ignore-scripts
```

See also:
[`../../AGENTS.md`](../../AGENTS.md) ·
[`../../docs/specs/AGENT-REPO-ARCHIVE-0.1.md`](../../docs/specs/AGENT-REPO-ARCHIVE-0.1.md) ·
[`../data-protocol/README.md`](../data-protocol/README.md).
