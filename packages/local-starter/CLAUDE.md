# @agenttool/local-starter

> **Type:** guide · **Purpose:** preserve the files-only starter's scope and verification boundaries.
> **Evidence:** `src/core.mjs`, `src/files.mjs`, `src/cli.mjs`, `src/adapters.mjs`, explicit `src/connect.mjs`, and `tests/`.

This guide governs only `packages/local-starter`. Core and CLI use Node ESM
and built-ins and declare Node >=22. Keep them usable directly from a checkout
without installing dependencies or building. The public preview archive copies
those modules into `dist` and bundles the sibling MCP transport with Bun 1.3.5.
The manifest has no runtime dependencies or installation lifecycle scripts.

## Boundaries

- For the ordinary files-only commands, an explicit directory and seven fixed source IDs are the entire selection
  surface. No globs, arbitrary source paths, upward/home search, URL fetches,
  transcript extraction, executable notes, or automatic imports.
- `init` creates a new root only; existing destinations always refuse. Keep
  incomplete initialization inspectable. Manifest publication requires a
  filesystem with hardlink support. Preserve `init_uncertain` recovery through
  inspection, not blind retry. No force-overwrite, recursive removal, silent
  permission repair, or cleanup of user-authored content.
- This is optional plaintext context, not secret custody or identity authority.
  Do not add keys, seeds, bearers, identity registration, provider calls, database
  access, MCP, daemons, timers, or remote synchronization to the notes/core/hooks.
  The separate sibling `packages/local-starter-mcp` imports this core for
  explicit local tools; the core/CLI/hooks must never import that transport.
  Delivery plans can point to its entry point without starting it.
  Release delivery paths point to the bundled `dist` entry within this package;
  never rely on a repository sibling or installed dependency at runtime. Keep
  the pinned builder and exact third-party licenses in sync. Plugin manifests
  expose the skill only; no default MCP/hook, root binding or startup effect.
  Retained notes and machine-specific bindings belong outside the distributable
  package and plugin cache. Build output is generated and disposable, never a
  notes root. Do not publish source paths, source maps or private absolute paths.
  The explicitly invoked `connect.mjs` companion is the sole hosted-read boundary:
  one fixed GET path selected by exact origin/project/identity, explicit callback
  or injected transport credentials, no ambient lookup except a CLI-selected env
  name, no redirects/retries, and no persistence. Core, CLI, adapters and hooks
  must never import or invoke this companion. Preserve a completely offline path.
  Do not widen the companion into general HTTP, discovery, registration, a secret
  resolver/store, full Wake retrieval, arbitrary projections, or automatic saves.
  Its request timeout is a bound, not a polling or scheduling mechanism.
  Keep project-bearer selection, hosted read grants, broker grants, and identity
  proofs distinct. Authentication defaults to `project_bearer` and requires the
  unchanged v1 envelope. Explicit `local_context_grant` requires v2 with closed
  authorization metadata and rejects a v1 downgrade. Validate exact origin,
  project, identity, action/method/path, canonical grant ID, issue/check/response
  ordering, the 24-hour lifetime cap, fresh checks, and expiry against client
  time. Direct grant mode must refuse parent tokens before HTTP; accept only a
  canonical `atlc_` token encoding 32 bytes. Never add grant issuance, renewal,
  revocation or parent-key discovery to this reader. Issuance and management are
  explicit administrator operations elsewhere; a receipt is not ongoing authority
  and revocation cannot retract earlier output. A broker injecting a project
  bearer still produces a project-bearer server receipt.
  Validate protocol, subject, expiry, UTF-8/digests and content/encoded limits before
  output; use a distinct metadata receipt and selected records for local-budget
  composition rather than modifying a verified server envelope. No excluded body
  may enter stdout merely as part of a retained source envelope.
- Foundations are optional links; the template lists AI-WAKE only.
  The published `0.1.0-dev.0` archive's template predates that and lists a
  second link; the README says so. Do not fetch them or assign a persona,
  biography, relationship, feeling, or duty to a later session. Retained
  records are data under current authority.
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
- Only `handoff.md` and `memories.md` are mutable through their fixed wrappers.
  Memory writes never enable selection. Keep expected-current-hash
  checks under a cooperative exclusive lock, bounded stdin, same-directory
  replacement, conservative cleanup, and truthful durability receipts. No
  automatic stale-lock stealing, process killing, merging, or backup copies.
  `write_uncertain` requires current-state inspection before any retry; do not
  silently downgrade an ambiguous rename to a known pre-write failure.
  Read write input from fd 0 without creating `process.stdin`: that stream
  makes a stdin pipe non-blocking, and a slower producer then turned `readSync`
  into EAGAIN and `INTERNAL_ERROR` under contention. Wait on EAGAIN from an
  inherited non-blocking descriptor; give any other read failure a typed code.
- Adapters emit reviewable fragments and explicit `installed: false` /
  `host_delivery: unverified`. Never edit host configuration, launch a model,
  bypass trust review, or use hook input/transcripts to select state.
- Delivery plans preserve that boundary. Emit portable skill/binding, local
  MCP and direct command-hook proposals for Codex/Claude; default writes to
  none. Never install them, duplicate retained prose in a skill, turn MCP into
  an arrival dependency, or add automatic Stop/PreCompact saving. Keep the
  zero-dependency manual path and Windows Codex manual fallback.
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
After a release build, run `npm run check:bundle`. Its optional extracted-root
argument tests the actual archive surface outside the repository with no
`node_modules` or sibling packages. Keep archive checks distinct from native
host delivery and registry/download publication receipts.
Connector fixtures use injected transports and disposable literal-loopback HTTP
with sentinel credentials only. Cover exact origin/project/identity, scope and
schema refusal, byte/expiry/digest checks, no redirects/retries, bounded abort,
secret-free diagnostics, aggregate selection, unchanged files, and offline paths.
The companion has 24 cases; the current local suite passes 103 on macOS arm64 /
Node 22.18.0 and 24.18.1. Set `LOCAL_STARTER_STRESS_ROUNDS` to repeat the
contending-writer stress test (default 12 rounds of four real CLI writers).
Its API wire tests are in `api/tests/local-context.test.ts`.
Keep direct and injected grant tests explicit: no parent credential transmission,
closed v2 metadata, rejected downgrades, in-transit expiry, unchanged record/byte
bounds, secret-free receipts, and offline/CLI behavior. Test credentials are
sentinels; current counts do not establish production grant issuance or revocation.

State the actual runtime/OS used. Local tests passed 70/70 on macOS arm64 with
Node 22.18.0 and 24.18.1. CI run 36327872045 passed all six combinations of
Ubuntu 24.04/macOS 15/Windows 2025 and Node 22.18.0/24.18.0: 70 passes on each
Linux/macOS job; 63 passes and seven POSIX-specific skips on each Windows job.
WSL/container and Windows ACL privacy need their own receipts. The README
records separate native Codex MCP/skill and Claude startup-hook observations;
these do not establish model delivery or automatic resume/compaction. Read [README.md](README.md)
before changing a public behavior or a host-specific assumption, and keep its
limits in sync with source.
