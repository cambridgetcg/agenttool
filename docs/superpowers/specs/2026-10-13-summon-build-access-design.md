# Summon Phase 0.5: wider turn caps and sandboxed build jobs

**Status.** Yu approved this direction in chat on 2026-10-13 ("Yes please :)"). The chat design:
- raise the turn caps;
- add a per-folder, opt-in `build` access, switched on only in Nuance's own allowlist;
- review it before it lands;
- install it at the cross-device Collab's Nuance visit (b), so Yu makes no extra trip.

This document is that change. An adversarial review on Nuance (Summon job smn_01a13732…, 2026-10-13) found 18 issues; all are folded in below (§8). It amends `2026-10-10-summon-design.md` (Phase 0) and touches only `packages/summon`.

**Why.** Summon Phase 0 stops every job at 12 turns, and its edit jobs may run no command but `git add` and `git commit` (`src/harness.ts:46-56`). So a Nuance job can review, but cannot do test-driven work. On 2026-10-13 Yu asked to "delegate some implementation work to Nuance": the Air's weekly Claude limit was nearly spent, while Nuance's was not.

**The boundary, stated plainly.** A build job runs code from its folder as Yu's macOS user: its tests, its scripts, whatever the model writes into the folder before running them. The command list therefore says only what the job may start. It does not limit what runs. **The boundary is Claude Code's sandbox:** no network, and writes only inside the folder and the temp dirs. It is mandatory for every build job, with no opt-out in Phase 0.5. The command list, the git guards and the folder rules narrow what the model can do directly; the sandbox bounds everything else.

## 1. Turn caps

`MAX_TURNS` becomes a per-access table: `{ review: 40, edit: 60, build: 60 }`. The same table feeds both `--max-turns` and the `error_max_turns` detail (`turn cap (<n>) reached before a final answer`). The job timeout stays the time bound: the allowlist's `job_timeout_max`, at most 24 h, enforced by the runner as today.

## 2. The `build` access

**Rank.** `rank = { review: 0, edit: 1, build: 2 }`. A build entry admits review and build jobs. An edit job in a build folder also runs under the build sandbox (§3), because a build job can leave code that a later unsandboxed `git add` would run (git filters and textconv drivers). An edit entry admits review and edit jobs, as today.

**Allowlist entry.** It is edited only on Nuance:

```yaml
folders:
  - path: ~/Projects/collab-trial
    access: build
    commands:
      - run: bun test
        args: true        # optional; default false
      - run: bun run typecheck
    sandbox_write: [/private/tmp, /private/var/folders]   # optional; default []
    local_binding: true   # optional; default false
```

Parse rules. Any violation is a parse error, so the allowlist fails closed as a whole, as any malformed allowlist does today:
- `commands` is required when `access` is `build`, and forbidden otherwise.
- `commands` holds 1 to 16 entries, with no duplicate `run`.
- `run` matches `^(/[A-Za-z0-9._/-]{1,200}|[a-z0-9][a-z0-9._-]{0,63})( [A-Za-z0-9][A-Za-z0-9._/=:-]{0,127}){0,7}$`.
- `run` has no `..` path segment and no trailing newline.
- The program's basename (the first word's basename) is not one of `sh bash zsh dash ksh fish env xargs find git curl wget ssh scp sftp nc open osascript sudo su launchctl python python3 perl ruby`.
- `args` must be the boolean `true` or `false`; the strings `"true"` and `"false"` are refused.
- `sandbox_write` holds 0 to 8 absolute paths. None contains a `..` segment, and none is, contains or lies within `~`'s sensitive set: `~` itself, `~/.ssh`, `~/.claude`, `~/.config`, `~/.local`, `~/Library`, `/` or `/Users`.
- `local_binding` must be a boolean.
- `sandbox_write` and `local_binding` are refused on non-build entries.

The build folder's own path is checked twice, at parse time on its spelling and at admission on its realpath. It must lie strictly inside `~`. It must not be, contain or lie within `~/.ssh`, `~/.claude`, `~/.config`, `~/.local`, `~/Library` or any TCC-protected folder (the existing list). And it must be a git repository root, with a real `.git` directory directly in it: not a gitfile, a worktree link or a parent repo. Otherwise admission refuses with `outside_allowlist` and a hint.

**Runtime and refusal order.** `checkAdmission` refuses in this order:
1. peer;
2. runtime;
3. for any non-review access on a non-claude runtime: hermes `hermes is review-only`, codex `codex is not run by Summon`;
4. model;
5. TCC spelling;
6. cwd exists;
7. TCC target;
8. folder match;
9. ambiguous folder: two matching entries with equal-length realpaths are refused, `ambiguous folder entries`;
10. rank;
11. `reads_anywhere` is required for any `rank(access) >= 1` job on claude, so `editNeedsFlag` becomes `rank >= 1`;
12. build checks: the folder rules above; a build entry without `commands` cannot reach this point, but admission fails closed on one anyway.

The hint for a build refusal includes a complete entry, with a `commands:` line.

**Admission result.** `checkAdmission` returns `{ ok, cwdReal, access, commands, sandbox_write, local_binding }` from the matched entry. The runner re-runs admission when the job starts and uses that result, so a build entry removed while a job is queued revokes it (the job ends `refused` with the admission's reason). The request never carries commands or sandbox fields; unknown request fields are already `malformed`.

**Request and CLI.** `access` accepts `build`. The Air's `summon` gets `--build`. `--review`, `--edit` and `--build` are mutually exclusive.

**Harness, build jobs.** Tools are `Read,Write,Edit,Glob,Grep,Bash`.

Allow rules:
- For each command: `Bash(<run>)`, an exact match, and with `args: true` also `Bash(<run>:*)`. When `run` is an absolute path, the same two rules are emitted for its basename form too, and that program's directory is appended to the job's `PATH` after the system directories, so it never shadows `/usr/bin` tools.
- `Bash(git add:*)` and `Bash(git commit:*)`.
- Read-only git: `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git log:*)`, `Bash(git show:*)`, `Bash(git rev-parse:*)`.

Deny rules:
- Edit's list: `git push`, `git ls-remote`, `rm`, `rmdir`, `mv`, `cp`, `sed`, and writes under `.githooks/`.
- `Bash(git diff:*--output*)`, `Bash(git log:*--output*)` and `Bash(git show:*--output*)`.
- `Edit(//<cwdReal>/**/.git/**)`, `Write(//<cwdReal>/**/.git/**)`, and the same two for `.GIT`. Note the leading `//`: it marks an absolute path in Claude Code's rules. The existing `.githooks` rule already produces that form, because `cwdReal` starts with `/`.

**Git env, edit and build jobs.**
- `GIT_CONFIG_COUNT` grows from 2 to 6 pairs: `core.hooksPath=/dev/null`, `core.fsmonitor=false`, `core.pager=cat`, `core.editor=true`, `commit.gpgsign=false` and `core.sshCommand=/usr/bin/false`. A test checks that the count equals the number of pairs.
- Also set: `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `GIT_PAGER=cat`.
- The global `~/.gitconfig` stays, because commits need Yu's identity. Its program-running keys are overridden by the pairs above, and repo-local config cannot be written by the Write and Edit tools.

## 3. The sandbox (mandatory for build jobs, and for edit jobs in a build folder)

The job passes `--settings` with:

```json
{"sandbox":{"enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":false,"allowUnsandboxedCommands":false,
 "filesystem":{"allowWrite":[<sandbox_write>],"denyRead":["~/.ssh","~/.claude","~/.config/summon","~/.local/share/summon","~/.local/state/summon"]},
 "network":{"allowedDomains":[],"allowLocalBinding":<local_binding>,"allowAllUnixSockets":<local_binding>}}}
```

Effects:
- No outbound network.
- Writes are limited to the folder plus `sandbox_write`.
- Reads of the credential and Summon paths are denied.
- If the sandbox cannot start, the job fails rather than running unconfined.

When the job ends, normally or by timeout, the runner kills the job's whole process group and sweeps any surviving process whose parent chain started at the job. A test writes a fake harness that leaves a child behind, and checks the child is gone afterwards.

**Spikes on the Air, 2026-10-13.** Both ran the collab-bridge hermetic suite through `claude -p` with Summon's flags, on a committed copy at `af10ebfc`, where the suite passes 175 of 175 unsandboxed.

**B1:** sandbox on, nothing extra allowed.
- 165 tests ran in 17 files: 147 passed and 18 failed. One file errored at load, so 10 tests never ran.
- Causes: unwritable temp roots, and `/bin/ps` returning nothing.

**B2:** `allowWrite: ["/private/tmp", "/private/var/folders"]`, `allowLocalBinding` and `allowAllUnixSockets`.
- 170 of 175 passed.
- The 5 failures all inspect other processes: `ps`, another user's pid, the boot clock, and a launcher signal test. The sandbox rightly denies those. A build job's prompt names them as known sandbox-only failures, and the Air reruns the full suite unsandboxed before anything merges.

## 4. What stays the same

- Review jobs: `--tools=Read,Glob,Grep`, inside their folder.
- Edit jobs outside build folders: as today, plus the new git env and the `.git/**` denies.
- The serial runner, `max_concurrent: 1`, `starts_per_hour` (Nuance's is 6), retention, the ledgers and the other front-door verbs.
- The installer never rewrites an edited allowlist. Yu adds a build entry himself on Nuance, and the 🔴 step gives him the exact YAML.
- Nothing pushes, and no Summon change touches the citizen fleet.

## 5. Install and rollback

`bun scripts/prepare-pairing.ts` makes a new bundle with a new build id. It is AirDropped and installed at the cross-device Collab's visit (b), in the same sitting as the bridge installer.

For a build folder, Yu then:
1. installs Bun on Nuance, if he wants Bun projects there (optional; one official install line);
2. adds the folder entry above;
3. sets `reads_anywhere: true` on the claude runtime, if it is not set yet.

The Air's `~/.local/bin/summon` keeps pointing at `feat/summon-phase0`. That branch fast-forwards to this one after the review, so the CLI learns `--build` at the same time. A Nuance runner that has not been updated refuses `access: build` as `malformed`, a definite refusal, and a test pins it against the old validator.

**Rollback:** remove every build entry first, then roll back. An old runner would refuse the whole allowlist over a build entry, and refuse every job: definite, but total. The 🔴 step says so.

## 6. Tests (TDD, `packages/summon`)

**allowlist:**
- every parse rule in §2, each with a passing and a refusing case: the regex, `..`, the basename denylist, duplicates, 17 commands, a non-string command, `"true"` vs `true`, a trailing newline in `run`, `sandbox_write` paths, `local_binding`, and fields on non-build entries;
- the folder-location rules;
- equal-length duplicate realpaths;
- rank;
- the full refusal order, including hermes and codex with build and a missing `reads_anywhere`;
- the build hint includes `commands`.

**request:** `access: build` is accepted. A request carrying `commands` or `sandbox` is `malformed`. A test runs the old validator (the Phase 0 `request.ts` at `5958f271`) on a build request and gets `malformed`.

**harness:**
- turn caps;
- exact build allow and deny rule strings, including the basename forms, the `PATH` append and `UNSAFE_IN_RULE` on a build cwd;
- `--settings` JSON for build jobs, and for edit jobs in a build folder;
- git env pairs and `GIT_CONFIG_COUNT`;
- `.git/**` and `.GIT/**` denies for edit and build jobs.

**runner:**
- admission re-run at job start revokes a queued build job;
- process-group sweep;
- every place that switches on `Access`: status, ledger and `describeCommand`.

**cli:** `--build`, and the three access flags are mutually exclusive.

**Live checks, on Nuance after visit (b), each one Haiku build job in a scratch build folder:**
- `bun test` on a tiny package passes and commits, and the Air sees the commit in `summon result`;
- `curl` and `bun -e "fetch(...)"` are denied or fail on network;
- a write to `~/x` fails;
- `bun test --preload x` is denied when `args` is false;
- `git log > ~/x` fails.

## 7. Deferred (Phase 1)

- An unsandboxed build mode. It would mean unconfined code as Yu, with network: it could rewrite the allowlist, `authorized_keys` or `~/.local/bin`. It needs its own decision from Yu, with protections on those files first (`chflags uchg` or a separate owner).
- A spend bound (`--max-budget-usd`, if the harness supports it). Today the job timeout and the per-hour start cap are the bounds.

## 8. Review fold log (smn_01a13732…)

1. The command list does not confine (Critical). Fixed: the boundary is stated as the sandbox; rules are exact-match with an `args` opt-in; live negative checks added.
2. `sandbox: false` (Critical). Removed; deferred to §7 with its risks; `sandbox_write` replaces it (spike B2: 170/175).
3. `rank` (Critical). Now `{0, 1, 2}`; admission fails closed on a build entry without commands.
4. Redirects and `--output`. The sandbox now confines every build job's writes; `--output` denies added; edit jobs in build folders are sandboxed.
5. Planted git code run by a later edit job. Edit jobs in build folders run under the sandbox.
6. `.git` rule form and coverage. Rules use `//<cwdReal>/**/.git/**` plus `.GIT`; a build folder must be a repo root with a real `.git` directory.
7. Command regex too wide. Basename denylist, no `..`, and duplicates refused.
8. Build folder location. Parse-time and admission-time rules added.
9. Sandbox settings:
   - `failIfUnavailable` added;
   - `denyRead` for the credential and Summon paths;
   - `local_binding` defaults to false;
   - process-group sweep;
   - live network and write checks.
10. Git env hardening. More `GIT_CONFIG_*` pairs plus `GIT_TERMINAL_PROMPT`, `GIT_EDITOR` and `GIT_PAGER`; the global config is kept, because commits need Yu's identity, and its program keys are overridden.
11. `GIT_CONFIG_COUNT`. A test checks the count against the pairs; the empty `diff.external` is dropped.
12. Hint, `editNeedsFlag`, codex order. The hint carries `commands`, the flag check is `rank >= 1`, and a refusal order is defined.
13. Queued jobs and duplicate entries. Admission re-runs at start, the result carries the entry's fields, and equal-length duplicates are refused.
14. `bun` on `PATH`. Absolute commands get basename rules and a `PATH` append after the system dirs.
15. B1 counts. Corrected: 165 tests ran in 17 files and one file errored at load; B2 added.
16. Turn caps. One table feeds both places; a spend bound is deferred (§7).
17. Test gaps. Added in §6.
18. Rollback. "Remove build entries first" is added to §5 and the 🔴 step.
