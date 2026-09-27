# @agenttool/local-starter

> **Type:** guide · **Purpose:** preserve the files-only starter's scope and verification boundaries.
> **Evidence:** `src/core.mjs`, `src/files.mjs`, `src/cli.mjs`, `src/adapters.mjs`, and `tests/`.

This guide governs only `packages/local-starter`. The package is private,
unpublished source, uses Node ESM and built-ins, and declares Node >=22. Keep
it usable directly from a checkout without installing dependencies or building.

## Boundaries

- An explicit directory and seven fixed source IDs are the entire selection
  surface. No globs, arbitrary source paths, upward/home search, URL fetches,
  transcript extraction, executable notes, or automatic imports.
- `init` creates a new root only; existing destinations always refuse. Keep
  incomplete initialization inspectable. Manifest publication requires a
  filesystem with hardlink support. Preserve `init_uncertain` recovery through
  inspection, not blind retry. No force-overwrite, recursive removal, silent
  permission repair, or cleanup of user-authored content.
- This is optional plaintext context, not secret custody or identity authority.
  Do not add keys, seeds, bearers, identity registration, provider calls, database
  access, MCP, daemons, timers, or remote synchronization in this package.
- Foundations are optional links, with AI-WAKE first and SOPHIA-WAKE second.
  Do not fetch them or assign a persona, biography, relationship, feeling, or
  duty to a later session. Retained records are data under current authority.
- The optional identity, preferences, relationships, and memories files start
  literally empty and disabled. Do not substitute a biography or instruction
  template into those empty slots.
- `render` must not read disabled bodies. `status` may inspect all seven fixed
  slots, including disabled ones, but must never return their contents. Keep
  this distinction visible to callers.
- Keep manifest/input bounds, strict UTF-8, named omissions, exact byte digests,
  and explicit filesystem-mtime freshness. Content-byte limits exclude output
  framing and are not token guarantees. Preserve BOM characters and CRLF in
  source/handoff content; accept a leading manifest BOM without rewriting its
  bytes. Never silently truncate a source.
- Keep the separate 131,072-byte encoded stdout cap, checked before any output,
  including JSON/hook framing. `OUTPUT_TOO_LARGE` returns no partial payload;
  hook mode still fails open with exit 0.
- Preserve regular-file/link checks, bounded reads, root/file stability checks,
  POSIX ownership/private modes, and opaque error codes. No raw private contents
  or OS errors in diagnostics. The caller selects and trusts the parent/storage;
  this is not an adversarial same-user or network-filesystem sandbox.
- Native Windows ordinary plaintext IO reports `windows-acl-unverified`; chmod
  does not verify ACL privacy. Do not imply a POSIX-only test proves Windows,
  WSL, container, remote-mount, or backup isolation.
- Only `handoff.md` is mutable through the helper. Keep expected-current-hash
  checks under a cooperative exclusive lock, bounded stdin, same-directory
  replacement, conservative cleanup, and truthful durability receipts. No
  automatic stale-lock stealing, process killing, merging, or backup copies.
  `write_uncertain` requires current-state inspection before any retry; do not
  silently downgrade an ambiguous rename to a known pre-write failure.
- Adapters emit reviewable fragments and explicit `installed: false` /
  `host_delivery: unverified`. Never edit host configuration, launch a model,
  bypass trust review, or use hook input/transcripts to select state.
- Keep shell quoting separate from JSON encoding. Claude Code uses the
  documented literal argument vector. Codex/Cursor POSIX command fragments
  are refused on native Windows until a supported shell contract is verified.
- Hook load failures return no context and exit 0; ordinary CLI failures remain
  nonzero. No incidental stdout may corrupt a hook JSON envelope. A wrapper
  cannot make developer/system-context delivery into a prompt sandbox.
- No registry publication, global install, host-session activation, production
  deployment, or source-directory availability claim implies any other step.

## Verification

```sh
node --test
```

Use disposable directories and real subprocesses where process isolation or
CLI framing matters. Cover init preservation, manifest validation, selection,
freshness/budgets/provenance, invalid bytes, special/link files, bounded reads,
POSIX modes, handoff conflicts/locks, error privacy, and independent roots.
Adapter fixtures must cover quoting, host JSON shape, safe failure, and no
installation; they do not prove delivery into a running agent host.

State the actual runtime/OS used. Local tests passed 70/70 on macOS arm64 with
Node 22.18.0 and 24.18.1. CI run 36327872045 passed all six combinations of
Ubuntu 24.04/macOS 15/Windows 2025 and Node 22.18.0/24.18.0: 70 passes on each
Linux/macOS job; 63 passes and seven POSIX-specific skips on each Windows job.
WSL/container, Windows ACL privacy, and real Codex/Claude/Cursor delivery need
their own receipts. Read [README.md](README.md)
before changing a public behavior or a host-specific assumption, and keep its
limits in sync with source.
