# Codex review jobs

> **Type:** reference · **Purpose:** add a bounded native Codex reply over Summon's existing transport. · **Evidence:** implementation and live receipts are listed below; this document is not an installation receipt.

Yu requested this extension on 2026-10-15. The target outcome is a fresh native
Codex job on Nuance, explicitly selecting `gpt-6-astra`, whose final reply can be
retrieved on the Air. It is separate from the held Cross-device Collab Phase 1
acceptance trial.

## Boundary

- Reuse the existing SSH forced command, allowlist, spool, replay protection,
  deadlines, cancellation and private result files. No remote shell or session
  attachment is added.
- Codex initially accepts review access only. The target must explicitly list
  the model/effort and `reads_anywhere: true`: a read-only native sandbox is not
  a promise that reads stay inside the project.
- Native Codex keeps its own authentication. Summon does not inspect or copy
  authentication files, change accounts, or fall back to a different provider
  or model.
- Preserve Claude jobs, the parked Phase 0.5 branch, the installed Collab bridge,
  private journals, citizen repositories and other users' sessions.
- Quiet execution must suppress inherited MCP servers, plugins, hooks and
  automatic memory. Native AGENTS/skill context can remain; this is not a blank
  context or folder-confined read promise. A CLI flag's presence alone is not
  evidence that external integrations are disabled.

## Implementation and limits

[Admission](src/gate.ts) accepts only review jobs with the existing exact
model/folder allowlist. [Native invocation](src/codex.ts) currently requires
`codex-cli 0.162.1`; both admission and execution check it. The clean environment
keeps native account authentication and supplies the Node launcher PATH, while
discarding inherited API keys and endpoint overrides. It does not override
administrator-enforced requirements.

[Result parsing](src/codex-output.ts) requires a valid one-turn JSONL sequence,
exit code zero, completion and a nonempty final agent message. Tool output is not
the reply. Unsupported event/error shapes fail; Codex authentication and quota
errors are not yet classified into dedicated statuses.

The optional `codex_diagnostics` in the private result records stdout/stderr byte
counts, first-output offsets, bounded counts/timings for fixed event and item
types, the stop request, and the actual child's exit code/signal/order. Unknown
event/item names become `other`; payloads, IDs, commands and error text are never
copied. The parser's classification is retained even when timeout or cancellation
wins. These diagnostics do not decide success and are not written to state or
the ledger. They are returned at settlement, not live, and are unavailable after
a supervisor crash. See [collector](src/codex-progress.ts),
[privacy tests](tests/codex-progress.test.ts) and [runner tests](tests/codex-runtime.test.ts).

[Runner supervision](src/runner.ts) and [group identity checks](src/process-group.ts)
handle cancellation and timeout while the runner is alive. Restart recovery can
terminate an identified orphan group when its original leader survives, then
settles `unknown` without replay. If signalling cannot be verified, recovery
keeps the job `running` and its slot occupied. If the leader has already gone,
surviving descendants cannot always be identified. There is no independent
crash-proof deadline watcher; `ps` identity checks and signalling are separate
OS operations. This is not complete process-tree containment.
Membership is sampled at heartbeat cadence while the original leader is alive;
observed descendants can be cleaned after normal completion. A descendant first
created after the final sample can still be unidentifiable after its leader exits.

Disabling integration startup is not filesystem confinement: a native read-only
job can still read outside its working folder, including other account-readable
files. The adapter does not access private Collab journals, but does not prevent
the native agent from reading them. The target's broad-read opt-in is required.

## Acceptance

1. Hermetic tests cover default-deny admission, native runtime dispatch, quiet
   invocation, exact model/effort, stdin prompts, parser failure cases, bounded
   output, timeout/cancel and content-free ledgers. Existing Claude tests pass.
2. A synthetic-home native probe verifies configuration isolation without real
   credentials or real journals. Unsupported CLI versions fail closed.
3. The updated Nuance programs and target allowlist are reviewed before
   installation. Source changes do not update Nuance's compiled runner.
4. Nuance's native CLI/version and model availability are observed, then one
   explicit Astra hello completes through Summon. No silent model fallback.

The target runtime entry is below; merge it into the existing allowlist without
replacing other runtimes or folders. Yu saved it after initial requests were
refused because `codex` was absent; a later request was admitted. The hello uses the already
allowlisted `~/Projects/collab-trial` working folder.

```yaml
- id: codex
  reads_anywhere: true
  models:
    - model: gpt-6-astra
```

This grants broad read access for Codex review jobs. Adding it does not update the
compiled runner or prove that this account can use the model.

## Evidence so far

- Air: `codex-cli 0.162.1` advertises `exec --ignore-user-config`, `--ignore-rules`,
  `--ephemeral`, `--json`, `--sandbox read-only` and global `-a never`.
- A native 0.162.1 probe used a synthetic home and a localhost fake Responses
  server, with no credentials or external model. Positive controls started user,
  project and plugin MCP servers and a lifecycle hook. The candidate started
  none and returned a complete reply; native user/project AGENTS and skills
  remained. The provider and request-compression setting were changed only for
  the local fake server. Administrator-enforced settings were not exercised.
  The exact-version gate matters: documented user-config suppression alone does
  not establish project/plugin isolation for other versions.
- [Runtime tests](tests/codex-runtime.test.ts), [parser tests](tests/codex-output.test.ts),
  [inventory tests](tests/inventory.test.ts) and the [compiled-pair test](tests/build.test.ts)
  cover admission, launch, replay, result parsing, cancellation with descendants,
  timeout, supervisor restart and preservation of unrelated processes. These use
  fixture CLIs; they do not establish Nuance account or model availability.
- Before this update, Nuance inventory returned a null Codex version and false
  login status; that did not distinguish launcher failure from logout. Yu then
  reported version `0.162.1`, followed by the installation receipt below.
- Nuance Sonnet consultation `nuance/smn_01a13f291c3d7ae8887394097d998896`
  completed in one turn. It recommends a separate read-only Codex adapter and
  conservative parsing. It used no tools or files; its advice is not a native
  Codex probe. Its suggestion that no runner installation is needed is rejected:
  Nuance runs compiled Summon binaries.
- Nuance Sonnet source review `nuance/smn_01a13f42fa097f3ea258ab4e42e49e43`
  identified missing group sampling during normal completion. The runner now
  records identity-checked membership at heartbeat cadence; a real-process
  fixture verifies cleanup after normal leader exit. This was an inline source
  review with no tools or remote file edits.
- Sonnet follow-up `nuance/smn_01a13f45ff2d7ab1a5429ef4645c5566` confirmed that
  correction and found no further blocker in the supplied change. This is source
  review evidence, not an independent execution receipt.
- Base adapter local Summon suite: **556 passed, 0 failed** across 15 files using Bun
  **1.3.5**. The suite includes compiled arm64 programs, signature verification
  and fixture installation. New/changed documentation links and `git diff --check`
  also passed. The broader repository `preflight.sh packages` could not start:
  the HF training host test environment is missing. Its result is not a passing
  repository-wide gate; no unrelated dependency preparation was performed.
- Diagnostic extension: **563 passed, 0 failed**, 4,268 assertions across 16
  files on Bun **1.3.5**, including the compiled-pair result. A stalled fixture
  emits a partial reply and private stderr, then exits zero on SIGTERM; its
  result remains timed out and retains content-free stage/termination evidence.
  A separate source review found no blocker. Documentation links and diff
  whitespace checks passed. This does not add live Nuance evidence.

## Nuance installation and first request (2026-10-15)

Yu returned installer output for user `macair`, build `073508aa`, prepared
`20261015112308` UTC, key expiry `20270113`. The build/prepared fields match the
local bundle manifest. Its reported host fingerprint matched the independently
read existing Air pin. The pin helper preserved that key and SSH configuration
and updated only the expiry value. This is a user-reported installation receipt,
not an independent hash readback of Nuance's installed programs.

A fresh inventory over pinned SSH at `2026-10-15T11:35:04.890Z` returned
`/opt/homebrew/bin/codex`, `codex-cli 0.162.1`, `logged_in: true`, user `macair`
and the expected GUI session. That verifies the CLI startup/login probe, not
model availability.

The first review hello explicitly selected `gpt-6-astra`, no effort/provider
override, and `~/Projects/collab-trial`. Admission returned
`refused(outside_allowlist): runtime codex is not allowed`; no model job was
started. Yu subsequently supplied the saved Codex entry, with the original
Claude runtime/folders/limits retained and a local backup.

The first admitted request, `nuance/smn_01a13f6fc3f2785e9a0c264808b28ae8`,
started at `2026-10-15T12:00:51.698Z` with a 300-second deadline. It ended
`timed_out` (`ran past 300s`), exit code zero and empty `result_text`. A fresh
heartbeat proved supervisor activity only. Exit zero after termination does not
mean completion; empty parsed text does not establish an empty native stream.
The installed `073508aa` runner did not preserve event-stage diagnostics.

Nuance Opus xhigh source diagnosis
`nuance/smn_01a13f7656d97c2e9375586cb69b3fd1` completed in one turn. It identified
the missing stage evidence but established no cause. Yu confirmed direct native
Astra on Nuance can reply normally. Inventory's normal-config `login status` and
the job's `--ignore-user-config` execution do not establish identical auth-store
selection. The offline probe exercised a local unauthenticated provider with
compression disabled, not the native account/network path. Auth-store, network
and stream-timeout explanations remain hypotheses. No automatic replay followed.

Official references: [non-interactive JSONL](https://learn.chatgpt.com/docs/non-interactive-mode),
[CLI flags](https://learn.chatgpt.com/docs/developer-commands?surface=cli),
[configuration](https://learn.chatgpt.com/docs/config-file/config-reference).

The base adapter is installed (user receipt), native version/login are observed
through authenticated inventory, and Codex admission is verified. The diagnostic
extension above is local source only until a newer installation receipt exists.
A live Astra reply through Summon remains pending; do not describe this route as
connected yet.
