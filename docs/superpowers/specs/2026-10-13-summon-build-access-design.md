# Summon Phase 0.5: wider turn caps, sandboxed edit and build jobs

**Status.** Yu approved this direction in chat on 2026-10-13 ("Yes please :)"). The chat design:
- raise the turn caps;
- add a per-folder, opt-in `build` access, switched on only in Nuance's own allowlist;
- review it before it lands;
- install it at the cross-device Collab's Nuance visit (b), so Yu makes no extra trip.

This document is that change. An adversarial review on Nuance (Summon job smn_01a13732…, 2026-10-13) found 18 issues; all are folded in below (§8). A re-review on Nuance (smn_01a13743…, Opus, 2026-10-13) did not approve that version: four fixes were only partly done and it found five new Important problems, most of them in `sandbox_write`, `local_binding`, Unix sockets and unsandboxed edit jobs. Ruling S1 therefore narrows Phase 0.5 to the fail-safe core (§9). It amends `2026-10-10-summon-design.md` (Phase 0) and touches only `packages/summon`.

**Why.** Summon Phase 0 stops every job at 12 turns, and its edit jobs may run no command but `git add` and `git commit` (`src/harness.ts:46-56`). So a Nuance job can review, but cannot do test-driven work. On 2026-10-13 Yu asked to "delegate some implementation work to Nuance": the Air's weekly Claude limit was nearly spent, while Nuance's was not.

**The boundary, stated plainly.** A build job runs code from its folder as Yu's macOS user: its tests, its scripts, whatever the model writes into the folder before running them. The command list therefore says only what the job may start. It does not limit what runs. **The boundary is Claude Code's sandbox:** no network, and writes only inside the folder, where the job's temp dir also lives. The sandbox is mandatory for every edit job and every build job, with no opt-out and no extra writable path in Phase 0.5. The command list, the git guards and the folder rules narrow what the model can do directly; the sandbox bounds everything else. Inside the folder the sandbox cannot tell `src/` from `.git/config`, so the runner fingerprints the git files that could run code later and restores them after every edit or build job (§3).

## 1. Turn caps

`MAX_TURNS` becomes a per-access table: `{ review: 40, edit: 60, build: 60 }`. The same table feeds both `--max-turns` and the `error_max_turns` detail (`turn cap (<n>) reached before a final answer`). The job timeout stays the time bound: the allowlist's `job_timeout_max`, at most 24 h, enforced by the runner as today.

## 2. The `build` access

**Rank.** `rank = { review: 0, edit: 1, build: 2 }`. A build entry admits review, edit and build jobs. An edit entry admits review and edit jobs, as today. Every edit job and every build job runs under the sandbox (§3), whatever kind of entry admitted it. There is no separate case for "an edit job in a build folder": a build job can leave code that a later `git add` would run (git filters and textconv drivers), and the sandbox confines that `git add` too.

**Allowlist entry.** It is edited only on Nuance:

```yaml
folders:
  - path: ~/Projects/collab-trial
    access: build
    commands:
      - run: bun test
        args: true        # optional; default false
      - run: bun run typecheck
```

Parse rules. Any violation is a parse error, so the allowlist fails closed as a whole, as any malformed allowlist does today:
- `commands` is required when `access` is `build`, and forbidden otherwise.
- `commands` holds 1 to 16 entries, with no duplicate `run`.
- `run` matches `^(/[A-Za-z0-9._/-]{1,200}|[a-z0-9][a-z0-9._-]{0,63})( [A-Za-z0-9][A-Za-z0-9._/=:-]{0,127}){0,7}$`.
- `run` has no `..` path segment and no trailing newline.
- The program's basename (the first word's basename) is not one of `sh bash zsh dash ksh fish env xargs find git curl wget ssh scp sftp nc open osascript sudo su launchctl python python3 perl ruby`.
- `args` must be the boolean `true` or `false`; the strings `"true"` and `"false"` are refused.
- `sandbox_write` and `local_binding` are not keys of Phase 0.5. A folder entry of any access that carries either one is a parse error, so nobody believes a setting took effect that did not (they are deferred, §7).
- An edit or build entry whose path lies strictly inside another edit or build entry's path is a parse error. The paths are compared as spelled, with `..` and doubled slashes folded and case ignored; a `~` spelling against an absolute spelling of the same place, and symlinks, are caught at admission on realpaths (below). A review entry may lie inside an edit or build entry.

**Folders that can write.** These checks run at admission, on realpaths, for every edit or build job. Any failure refuses the job with `outside_allowlist` and a hint:
- The job's `cwdReal` equals the matched entry's realpath. An edit or build job runs at the repository root; a review job may still run anywhere inside an entry. From here on, "the folder" is `cwdReal`.
- The folder is a git repository root with a real `.git` directory directly in it: not a gitfile, a worktree link, a symlink or a parent repo.
- No other edit or build entry's realpath lies strictly inside the matched entry or strictly contains it.
- For a build entry only, the location rules: the folder lies strictly inside `~`, and it is not, does not contain and does not lie within `~/.ssh`, `~/.claude`, `~/.config`, `~/.local`, `~/Library` or any TCC-protected folder (the existing list). The same rules are checked at parse time on the entry's spelling.

**Runtime and refusal order.** `checkAdmission` refuses in this order:
1. peer;
2. runtime, and right after it, unchanged and still before step 3, the existing check that a non-claude runtime needs `reads_anywhere` (`<runtime> can read any file on this Mac`). The order does not move it: a codex build request on a Mac without that flag gets this message first, and with the flag gets the step 3 message;
3. for any non-review access on a non-claude runtime: hermes `hermes is review-only`, codex `codex is not run by Summon`;
4. model;
5. TCC spelling;
6. cwd exists;
7. TCC target;
8. folder match;
9. ambiguous folder: two matching entries with equal-length realpaths are refused, `ambiguous folder entries`;
10. rank;
11. `reads_anywhere` is required for any `rank(access) >= 1` job on claude, so `editNeedsFlag` becomes `rank >= 1`;
12. folder checks for an edit or build job: for a build entry the location rules, then for both the `cwdReal` equality, the real `.git` directory and the nesting rule above. A build entry without `commands` cannot reach this point, but admission fails closed on one anyway.

The hint for a build refusal includes a complete entry, with a `commands:` line.

**Admission result.** `checkAdmission` returns `{ ok, cwdReal, access, commands }` from the matched entry: `access` is the entry's access and `commands` is its list (empty unless the entry is build). The job's own access comes from the request. The runner re-runs admission when the job starts, with every rule above, and uses that result. A build entry removed while a job is queued revokes it, and so does a folder that has stopped being a repository root or has become nested; the job ends `refused` with the admission's reason. The request never carries commands or sandbox fields; unknown request fields are already `malformed`.

**Request and CLI.** `access` accepts `build`. The Air's `summon` gets `--build`. `--review`, `--edit` and `--build` are mutually exclusive.

**Harness, edit and build jobs.** Tools are `Read,Write,Edit,Glob,Grep,Bash`, as an edit job has today.

Allow rules:
- Edit and build jobs: `Bash(git add:*)` and `Bash(git commit:*)`.
- Build jobs, for each command: `Bash(<run>)`, an exact match, and with `args: true` also `Bash(<run>:*)`.
- Build jobs, absolute programs. When `run` starts with an absolute path, the program's directory is appended to the job's `PATH` after the system directories, so it never shadows `/usr/bin` tools. The harness then resolves the program's basename on that final `PATH`. Only if the result has the same realpath as the absolute program does it emit the same two rules for the basename form; otherwise it emits the absolute rules only, so a different `bun` earlier on `PATH` is never allowed.
- Build jobs, read-only git: `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git log:*)`, `Bash(git show:*)`, `Bash(git rev-parse:*)`.

Deny rules, for edit and build jobs:
- Edit's list, as in Phase 0: `git push`, `git ls-remote`, `rm`, `rmdir`, `mv`, `cp`, `sed`, and writes under `.githooks/`.
- `Edit(//<cwdReal>/**/.git/**)`, `Write(//<cwdReal>/**/.git/**)`, and the same two for `.GIT`. Note the leading `//`: it marks an absolute path in Claude Code's rules. The existing `.githooks` rule already produces that form, because `cwdReal` starts with `/`. The other case spellings (`.Git`, `.gIt`, …) have no rule; the sandbox keeps their writes inside the folder and the fingerprint (§3) restores them.
- There is no `--output` rule. The form `Bash(git diff:*--output*)` was never verified against Claude Code's matcher, and the sandbox confines the write it would have blocked.

Env and files, for edit and build jobs:
- `TMPDIR=<cwdReal>/.summon-tmp/<job id>` (§3) and `SUMMON_JOB_ID=<job id>` (§3, the process sweep).
- `UNSAFE_IN_RULE` applies to the folder and to every command string. If either contains one of its characters, the harness throws and the job does not start (the `run` regex already keeps those characters out of a command at parse time; this is the second guard).

**Git env, edit and build jobs.**
- `GIT_CONFIG_COUNT` grows from 2 to 6 pairs: `core.hooksPath=/dev/null`, `core.fsmonitor=false`, `core.pager=cat`, `core.editor=true`, `commit.gpgsign=false` and `core.sshCommand=/usr/bin/false`. A test checks that the count equals the number of pairs.
- Also set: `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `GIT_PAGER=cat`.
- The global `~/.gitconfig` stays, because commits need Yu's identity. Its program-running keys are overridden by the pairs above, and the sandbox keeps a job from writing it.

## 3. The sandbox, and the guards around it

The sandbox is mandatory for every edit job and every build job, in any folder. The job passes `--settings` with:

```json
{"sandbox":{"enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":false,"allowUnsandboxedCommands":false,
 "filesystem":{"allowWrite":[],"denyRead":["~/.ssh","~/.claude","~/.config/summon","~/.local/share/summon","~/.local/state/summon"]},
 "network":{"allowedDomains":[],"allowLocalBinding":false,"allowAllUnixSockets":false}}}
```

Effects:
- No outbound network.
- Writes are limited to the folder, `allowWrite` being empty. There is no `sandbox_write`.
- No local port binding and no Unix sockets. There is no `local_binding`.
- Reads of the credential and Summon paths are denied.
- If the sandbox cannot start, the job fails rather than running unconfined.

Review jobs have no `Bash` tool and get no `--settings`, as today.

**Temp files.** The sandbox allows no temp root outside the folder, so each edit or build job gets its own. Before the job starts, the runner creates `<cwdReal>/.summon-tmp/<job id>` (mode 0700) and sets it as `TMPDIR`. It also adds the line `/.summon-tmp/` to `<cwdReal>/.git/info/exclude`, creating `.git/info` if needed and doing nothing if the line is already there, so git never sees the temp files. That line stays; it is written before the fingerprint baseline is taken. After the job, whether it ended normally, failed or timed out, and after the process sweep, the runner removes the job's directory, and removes `.summon-tmp` too if it is then empty.

**Fingerprint.** Before each edit or build job (after the exclude line) and after it (after the sweep), the runner fingerprints these files, with the sha256 of each:
- `.git/config`;
- every file under `.git/hooks/`;
- every file under `.git/info/`;
- `.gitattributes` and `.gitmodules` in the folder root.

The names are found by a case-insensitive listing of the folder root, of `.git/` and of those subdirectories, so every case spelling (`.Git`, `.gIt`, `.GitAttributes`, `Config`) is covered on the Mac's case-insensitive volume. The baseline keeps each file's contents, outside the folder, in the runner's private state for the job. After the job, any file whose hash differs from the baseline, that has appeared, or that has vanished is restored from the baseline: contents and mode rewritten, new files removed, vanished files recreated. The first line of the job's result file then says `tampered: <paths>`. A ledger line records it too, with a fixed word and the number of paths; the paths themselves stay in the 0600 result file, as every harness-derived string does. The job's status is not changed by the restore.

**Process sweep.** The runner starts claude for an edit or build job in its own process group, with `SUMMON_JOB_ID=<job id>` in its env. When the job ends, normally or by timeout, the runner:
1. kills the whole process group;
2. lists the user's own processes with their environments (`ps -E -o pid=,command=`) and kills every one, other than the runner itself, whose environment carries `SUMMON_JOB_ID=<job id>`. A child that called `setsid`, or that was reparented to launchd, still carries the marker it inherited, so the group and the parent chain are not needed;
3. only then compares the fingerprint, restores, and removes the temp dir.

A detached child that cleared its env is not found. It stays sandboxed, with no network and writes only inside the folder, and this is accepted as a residual in Phase 0.5 (§7).

**Spikes on the Air, 2026-10-13.** Both ran the collab-bridge hermetic suite through `claude -p` with Summon's flags, on a committed copy at `af10ebfc`, where the suite passes 175 of 175 unsandboxed.

**B1:** sandbox on, nothing extra allowed.
- 165 tests ran in 17 files: 147 passed and 18 failed. One file errored at load, so 10 tests never ran.
- Causes: unwritable temp roots, and `/bin/ps` returning nothing.
- This is the shape Phase 0.5 ships, except that `TMPDIR` now points into the folder. B1 ran with the default `TMPDIR`, so how many of the temp-root failures the per-job directory removes is not yet measured; the live checks in §6 measure it.

**B2:** `allowWrite: ["/private/tmp", "/private/var/folders"]`, `allowLocalBinding` and `allowAllUnixSockets`.
- 170 of 175 passed.
- The 5 failures all inspect other processes: `ps`, another user's pid, the boot clock, and a launcher signal test. The sandbox rightly denies those. A build job's prompt names them as known sandbox-only failures, and the Air reruns the full suite unsandboxed before anything merges.
- B2's settings are not in Phase 0.5. They are the evidence for what the deferred options in §7 would buy.

## 4. What stays the same

- Review jobs: `--tools=Read,Glob,Grep`, inside their folder, byte-identical to Phase 0 except `--max-turns=40`.
- Edit jobs keep Phase 0's tools, allow rules and deny list. They gain the sandbox, the folder rules (repository root, `cwdReal` at the entry, no nesting), the per-job `TMPDIR`, the fingerprint, the process sweep, the new git env and the `.git/**` denies.
- The serial runner, `max_concurrent: 1`, `starts_per_hour` (Nuance's is 6), retention, the ledgers and the other front-door verbs.
- The installer never rewrites an edited allowlist. Yu adds a build entry himself on Nuance, and the 🔴 step gives him the exact YAML.
- Nothing pushes, and no Summon change touches the citizen fleet.

## 5. Install and rollback

`bun scripts/prepare-pairing.ts` makes a new bundle with a new build id. It is AirDropped and installed at the cross-device Collab's visit (b), in the same sitting as the bridge installer.

Before the update, Yu checks the allowlist already on Nuance:
- No edit entry may lie inside another edit entry. That is now a parse error, and a parse error refuses every job. The 🔴 step lists the check.
- Each edit entry should be a git repository root with a real `.git` directory, and a job's `cwd` must be that root. Otherwise the update refuses edit jobs in that folder until the entry is corrected.

For a build folder, Yu then:
1. installs Bun on Nuance, if he wants Bun projects there (optional; one official install line);
2. adds the folder entry above;
3. sets `reads_anywhere: true` on the claude runtime, if it is not set yet.

The Air's `~/.local/bin/summon` keeps pointing at `feat/summon-phase0`. That branch fast-forwards to this one after the review, so the CLI learns `--build` at the same time. A Nuance runner that has not been updated refuses `access: build` as `malformed`, a definite refusal, and a test pins it against the old validator.

**Rollback:** remove every build entry first, then roll back. An old runner would refuse the whole allowlist over a build entry, and refuse every job: definite, but total. The 🔴 step says so.

## 6. Tests (TDD, `packages/summon`)

**allowlist:**
- every parse rule in §2, each with a passing and a refusing case: the regex, `..`, the basename denylist, duplicates, 17 commands, a non-string command, `"true"` vs `true`, a trailing newline in `run`, `sandbox_write` and `local_binding` on any entry (parse error), and fields on non-build entries;
- nested edit and build entries are a parse error (edit in edit, edit in build, build in edit, trailing slash, `..`, case) and a review entry inside one is accepted;
- the build location rules;
- the admission checks on edit and build folders: `cwdReal` equal to the entry, a real `.git` directory (a gitfile, a symlinked `.git` and a parent repo each refused), and nesting by realpath (a symlink into another entry, a `~` spelling against an absolute one);
- equal-length duplicate realpaths;
- rank;
- the full refusal order, including hermes and codex with build, the non-claude `reads_anywhere` check staying before step 3 (codex with build, with and without the flag), and a missing `reads_anywhere` on claude;
- the build hint includes `commands`.

**request:** `access: build` is accepted. A request carrying `commands` or `sandbox` is `malformed`. A test runs the old validator (the Phase 0 `request.ts` at `5958f271`) on a build request and gets `malformed`.

**harness:**
- turn caps;
- exact allow and deny rule strings for edit and build jobs, including the basename forms (emitted when the basename resolves to the same realpath, absolute only when it does not), the `PATH` append, no `--output` rule, and `UNSAFE_IN_RULE` on an edit or build cwd and on every command string;
- `--settings` JSON for edit and build jobs, exactly as in §3, and none for review;
- `TMPDIR` and `SUMMON_JOB_ID` for edit and build jobs, and a review env unchanged;
- git env pairs and `GIT_CONFIG_COUNT`, plus a real `git commit` in a temp repo under exactly that env (a temp `HOME` holding an identity): it succeeds, and a planted `pre-commit` hook does not run;
- `.git/**` and `.GIT/**` denies for edit and build jobs;
- negative shell-form strings. For a build command `bun test` with `args: false`, a table of job commands: `bun test > ~/x`, `bun test >> ~/x`, `bun test | tee ~/x`, `FOO=1 bun test`, a second command after a newline, `bun test $(id)`, ``bun test `id` ``, `bun test <(id)`, `bun test --cwd /elsewhere`, and a `run` with `:` or `=` in a word. The test asserts that no emitted allow rule is an exact match for any of them. The forms that only a `:*` rule could match (`git log --output=~/x`, `git commit -m x >> ~/x`, `bun test --preload x` with `args: true`) are listed as left to the sandbox and the live checks.

**runner:**
- admission re-run at job start revokes a queued build job, and a queued job whose folder has stopped being a repository root;
- the temp dir: created 0700, `TMPDIR` points at it, the exclude line is written once and before the baseline, and the dir is gone after a normal end, a failure and a timeout;
- the fingerprint: a fake harness that edits `.git/config`, adds a hook, edits `.gitmodules`, adds `.GitAttributes` or deletes `.git/info/exclude` is restored each time, the result file starts with `tampered: <paths>` and a ledger line records it; an untouched job reports nothing. The case-insensitive listing is injected, and one test also runs on the real temp directory;
- the process sweep: a fake harness leaves (1) a child in the group, (2) a child that calls `setsid` and (3) a child reparented to launchd, and all three are gone afterwards, after a normal end and after a timeout. A fourth child that clears its env is not swept; the test documents that residual;
- every place that switches on `Access`: status, ledger and `describeCommand`.

**cli:** `--build`, and the three access flags are mutually exclusive.

**Live checks, on Nuance after visit (b), each one Haiku job in a scratch repository with a build entry:**
- `bun test` on a tiny package passes and commits, and the Air sees the commit in `summon result`;
- a test that writes through `os.tmpdir()` lands in `.summon-tmp/<job id>`, which is gone afterwards, and `git status` shows no `.summon-tmp`;
- `curl` and `bun -e "fetch(...)"` are denied or fail on network;
- a write to `~/x` fails;
- redirects and writers: `>`, `>>`, `tee ~/x`, `git log --output=~/x` and `git diff --output=~/x` fail in a build job, and `git commit -m x >> ~/x` fails in an edit job;
- `bun test --preload x` is denied when `args` is false;
- `FOO=1 bun test`, a second command after a newline, `$()`, backticks and `<()` are denied or confined;
- a command with `:` and `=` in its words (`bun run test:unit`, `bun test --timeout=5000`) is matched by Claude Code exactly as its rule says: allowed as written, denied with anything added when `args` is false;
- git file writes: an Edit-tool write to `<folder>/.git/config` is denied by the rule (this also shows that `**/` matches zero directories); an Edit-tool write and a shell redirect to `.Git/config` and `.gIt/hooks/pre-commit` either fail or are restored, and the result says `tampered: …`;
- the process sweep: a job that starts `sleep 600 &` leaves no `sleep` after it ends.

## 7. Deferred (Phase 1)

- An unsandboxed build mode. It would mean unconfined code as Yu, with network: it could rewrite the allowlist, `authorized_keys` or `~/.local/bin`. It needs its own decision from Yu, with protections on those files first (`chflags uchg` or a separate owner).
- A spend bound (`--max-budget-usd`, if the harness supports it). Today the job timeout and the per-hour start cap are the bounds.
- `sandbox_write`, extra writable paths. It returns with a parse rule that separates two sets: paths that may not be, contain or lie within `~/.ssh`, `~/.claude`, `~/.config`, `~/.local` or `~/Library`, and paths that may not be or contain `/`, `/Users` or `~` (every absolute path lies within `/`, so the two cannot be one set). It also refuses `/opt/homebrew`, `/usr/local` and any path that is, contains or lies within an allowlisted edit or build folder.
- `local_binding` and Unix sockets. They return as two separate opt-ins, never one switch: `allowLocalBinding` for loopback ports, and a specific `allowUnixSockets` path list instead of `allowAllUnixSockets`, which would also open the launchd, ssh-agent and Docker sockets. Spike B2 (170 of 175) is the evidence for what they buy.
- The collab-bridge suite's `/private/tmp` sockets. That suite will not run as a Nuance build job in Phase 0.5; ordinary suites that respect `TMPDIR` will. The cost if this is wrong: Nuance build jobs serve fewer projects until Phase 1.

**Residual risks, accepted in Phase 0.5:**
- A detached child that cleared its env is not found by the sweep. It stays sandboxed.
- A legitimate edit to `.git/config`, a hook, `.git/info/**`, `.gitattributes` or `.gitmodules` by a job is reverted and reported as `tampered`. Phase 0.5 prefers safety to breadth.
- `.gitattributes` files below the folder root are not fingerprinted. The filter and textconv drivers they name are defined in config files, and the config files are.

## 8. Review fold log (smn_01a13732…)

This is the log of the first fold. Where Ruling S1 changed a fix (items 2, 4, 5, 6, 9 and 14), §9 says so and §2 and §3 hold the current rule.

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

## 9. Re-review fold log (smn_01a13743…)

The re-review (Opus, 2026-10-13) did not approve the design: findings 4, 6, 10 and 17 were only partly addressed, and it found five new Important problems, none Critical. Ruling S1 settles them by narrowing Phase 0.5 to the fail-safe core. Its parts, which the lines below cite by letter:
- (a) Every edit and every build job runs under the sandbox: writes only inside the folder, no network, `failIfUnavailable`, `denyRead` as before. That confines redirects, git filters and case-variant `.git` writes in edit jobs too.
- (b) No `sandbox_write`, no `local_binding` and no Unix sockets in Phase 0.5; all three are deferred to Phase 1 with the re-review's notes (§7). Temp files go to a per-job directory in the folder, set as `TMPDIR`.
- (c) Edit and build folders are git repository roots with a real `.git` directory, and nesting among edit and build entries is a parse error, re-checked on realpaths at admission.
- (d) The runner fingerprints the git files that can run code, restores any change and reports `tampered`.
- (e) The process sweep is a process group plus the `SUMMON_JOB_ID` marker.
- (f) Negative tests, as harness strings and as live checks on Nuance, for the shell forms and case variants; the unverified `--output` rule form is dropped.
- (g) The refusal order says where the existing non-claude `reads_anywhere` check stays.
- (h) The git env test also runs a real `git commit`.
- (i) Basename rules are emitted only when the basename resolves to the same program; otherwise the absolute rule only.

R1 to R18 are the re-review's numbered findings, in its order; N1 to N5 are its new problems.

- R1. The command list does not confine (addressed). Stands: the sandbox is the boundary, now for every edit job too (a). The `--cwd /elsewhere` case is in the §6 shell-form table, and `args: true` is covered by the live check.
- R2. `sandbox: false` (addressed). Stands, and is simpler: the sandbox has no opt-out, and `sandbox_write` is gone too (b), so there is no way to widen it.
- R3. `rank` (addressed in design). Stands: `{0, 1, 2}`, and step 12 fails closed on a build entry without commands. The code is Task 1.
- R4. Redirects and `--output` (not fully addressed). Settled by (a) and (f): edit jobs are sandboxed, so `git commit -m x >> ~/.zshrc` cannot write outside the folder; tests for `>`, `>>`, `tee` and `--output` are in §6 as strings and as live checks; the `Bash(git diff:*--output*)` form is dropped as unverified.
- R5. Planted code run by a later edit job (addressed for the plain case). Settled by (a): every edit job is sandboxed, so the planted code runs confined; (d) restores the planted config, hooks and attributes after the job.
- R6. `.git` rule form and coverage (not fully addressed). Settled by (a), (d) and (f): the `//` rules and the `.GIT` pair stay; a `.Git` or `.gIt` write stays inside the folder, is found by the case-insensitive listing and restored; the case-variant writes and the zero-directory match of `**/` are live checks in §6.
- R7. Command regex too wide (addressed). Stands. A symlink named `mytool` that points at `/bin/bash` still passes, which is tolerable only because the sandbox is mandatory, and (i) now also refuses a basename rule that resolves elsewhere.
- R8. Build folder location (addressed). Stands; (c) adds the repository-root and nesting rules for edit and build folders.
- R9. Sandbox settings (addressed, with flaws). Settled by (b) and (e): `allowLocalBinding` and `allowAllUnixSockets` are both false, and the sweep is replaced (N4, N5); the rest of the settings stand.
- R10. Git env hardening and shell-form tests (not fully addressed). Settled by (f) and (h): `FOO=1 bun test`, a newline second command, `$()`, backticks and `<()` are in the §6 string table and in the live checks.
- R11. `GIT_CONFIG_COUNT` (addressed). Settled by (h): a real `git commit` now runs under that env in a temp repo.
- R12. Hint, `editNeedsFlag` and codex order (addressed, one gap). Settled by (g): step 2 keeps the existing non-claude `reads_anywhere` check right after the runtime lookup and says so.
- R13. Queued jobs and duplicate entries (addressed). Stands; the start-time admission also re-checks (c)'s repository-root and nesting rules.
- R14. `bun` not on `PATH` (addressed, one side effect). Settled by (i): the basename rule is emitted only when it resolves to the same realpath as the absolute program, so a different `bun` is never allowed; the cost is in §7.
- R15. Spike B1 counts (addressed). The counts stand. The sandbox on/off rerun on Nuance is not added: B2's settings are deferred (§7), and the §6 live checks are the Nuance runs for what ships.
- R16. Turn caps and spend (addressed). Unchanged.
- R17. Test gaps (not fully addressed). Settled by (f): `:` and `=` in words is a string case and a live check in §6.
- R18. Rollback (addressed). Unchanged: "remove every build entry first". §5 also tells Yu to check existing edit entries for nesting before the update.
- N1. The `sandbox_write` rule refuses every path. Settled by (b): `sandbox_write` is removed, so the rule is gone; §7 keeps the two-set rule for Phase 1.
- N2. `sandbox_write` can open the escapes finding 2 closed. Settled by (b): nothing outside the folder is writable, and the refusals of `/opt/homebrew`, `/usr/local` and allowlisted folders are kept in §7 for Phase 1.
- N3. "Edit job in a build folder" is undefined. Settled by (a) and (c): the term is gone because every edit job is sandboxed, and an edit entry nested inside a build repo is a parse error, with a realpath re-check at admission.
- N4. `allowAllUnixSockets` is tied to `local_binding`. Settled by (b): both are false in the settings JSON, and §7 returns them as separate opt-ins with a path list.
- N5. The sweep cannot work as worded. Settled by (e): the sweep goes by the `SUMMON_JOB_ID` marker in the process environment, which survives reparenting to launchd and `setsid`; a detached child that cleared its env stays sandboxed and is accepted as a residual (§7).
