# @agenttool/summon

Start a new agent session on another of Yu's Macs. Design: `docs/superpowers/specs/2026-10-10-summon-design.md`.

Phase 0 (SSH at home): `summon nuance claude --model sonnet --cwd '~/Projects/x' --review --prompt-file task.md`,
then `summon status|result nuance/smn_<id>`. `--job` may be given (it is Phase 0's only mode); `--live` is refused until
Phase 1. `--edit` and `--build` ask for more than a review (see "Edit and build folders (Phase 0.5)" below); `--review`,
`--edit` and `--build` are mutually exclusive, and a start names at most one. Nuance runs `summon-gatekeeper` (SSH forced command) and
`summon-runner` (LaunchAgent in Yu's GUI session). Install: `bun scripts/prepare-pairing.ts`, AirDrop the bundle,
`bash ~/Downloads/summon-nuance-bundle-<expiry>-<build id>/summon-install.sh` on Nuance, then `bun scripts/pin-nuance.ts`
and the `summon` link on the Air.

## Install and rollback (Phase 0)

**Install, in this order.** Everything Summon writes is private: directories 0700, files 0600, the two programs 0700.

1. On the Air, from `packages/summon`: `bun scripts/prepare-pairing.ts` makes the summon key (once; it is never
   replaced), compiles the two programs, and writes the bundle `~/summon-nuance-bundle-<expiry>-<build id>` with an
   installer pinned to their checksums. The expiry is the key's (90 days on); the build id is the first 8 hex digits of
   sha256(runner sha256 ‖ gatekeeper sha256), so a change to either program gets a folder of its own. The bundle also
   carries when it was prepared (UTC, `YYYYMMDDHHMMSS`), and `MANIFEST.txt` lists build, prepared, both sha256s and the
   expiry. It prints the exact `bash ~/Downloads/<that folder>/summon-install.sh` line and the key's expiry, and, if
   earlier bundle folders are still in `~`, the `rm -rf` line that would remove them (it removes nothing itself).
   Running it again keeps the key and makes a new bundle; run that installer on Nuance to apply it.
2. At Nuance, **turn on Remote Login first** (System Settings → General → Sharing → Remote Login, allow access for
   Yu's user only). AirDrop the bundle folder there. Read `summon-install.sh`, then run the line step 1 printed,
   `bash ~/Downloads/summon-nuance-bundle-<expiry>-<build id>/summon-install.sh`. Before it writes anything it stops if:
   - Remote Login is off (nothing answers on port 22): turn it on, then run it again;
   - the bundle's key has expired (ask Ai for a fresh bundle);
   - the bundle is older than what is installed (prepared before the installed one, or, for an install from before
     that was recorded, its key expires earlier): run the newest bundle instead, or `SUMMON_ALLOW_OLDER=1` to go back
     on purpose;
   - a summon is `queued` or `running`: installing restarts the runner, which ends a running job as `unknown`, with
     no result. Wait for it, or re-run with `SUMMON_INSTALL_ANYWAY=1`. A `running` job whose process is gone, and a
     `queued` one the runner never claimed that is more than 5 minutes past its expiry, do not count.

   It asks for the Mac password once. If sshd has never run on this Mac, it first makes the host keys
   (`ssh-keygen -A`, as macOS does at the first SSH connection). It writes the sshd drop-in, has `sshd -t` check it,
   then asks `sshd -T` what sshd would really use for a LAN login, by Yu's user and by root. Nothing of Summon's (the
   programs, the allowlist, the key line, the runner) is written until that says key logins only, so a refused re-run
   leaves the earlier install as it was. **Whenever it stops before that point, it says what to do about Remote Login:
   on a first install, turn it off until the problem is fixed** (sshd still takes passwords until then); when the
   drop-in an earlier run put in place passed its `sshd -T` check (the installer keeps its own record of that,
   `~/.local/share/summon/keys-only`), it says passwords are still off and Remote Login can stay on.
   Once the new drop-in is in and sshd refuses it, it always says to turn Remote Login off.
   It is safe to run again: it replaces
   its one key line, keeps every other `authorized_keys` line and an edited allowlist, and never empties `runner.log`.
   If the runner does not load, it says so (the key line is already updated): run it again, or log out and in.
   macOS shows a "Background Items Added" notification for dev.summon.runner (it may be listed as summon-runner): leave it allowed in System Settings →
   General → Login Items, or every start reads `runner_missing`. If `~/Projects`, the starter allowlist's folder, does
   not exist, it warns (⚠) and goes on: make it, or edit the allowlist. It says `Done` only once the runner is loaded,
   the host key is handed back and the runner has answered an inventory request (it waits up to 45 s); otherwise it
   ends `✗ Not confirmed: …` and you keep the bundle and tell Ai. After `Done`, once Ai has the
   "give this back to Ai" lines (user, build, prepared, key expiry, host key, the pin line), delete the bundle folder
   from `~/Downloads` on Nuance, so a later re-pair can never run an old one by mistake. `~/.local/share/summon/INSTALLED`
   then holds the same lines as the bundle's `MANIFEST.txt`.
3. Back on the Air, run the pin line the installer printed:
   `bun scripts/pin-nuance.ts --user <name> --host-key "<the ssh-ed25519 line>" --expires <YYYYMMDD>`. It pins the host
   key and records the key's expiry (the installer's "key expires:" line) in `~/.ssh/summon/expiry`. It prints the
   pinned host key's SHA256 fingerprint: compare it with the one the installer printed on Nuance (the `ssh-keygen`
   line under `host key:`). If they differ, stop and tell Ai.
4. Once, on the Air, from `packages/summon`: put the front door on PATH,
   `mkdir -p ~/.local/bin && ln -sf "$PWD/bin/summon.ts" ~/.local/bin/summon`. First check `ls -l ~/.local/bin/summon`:
   if it exists and is not a link to this file, do not overwrite it; tell Ai. Then `summon nuance inventory`.

After the installer, Nuance takes SSH logins by key only, and only for Yu's user. Keep another way in (a key of your own
in `authorized_keys`, or the Mac in front of you) before you rely on that.

The two Nuance programs ignore `.env*` and `bunfig.toml` files (the build turns that loading off), even in the home
folder sshd starts the gatekeeper in. The Air's `summon` ignores `.env` files in the folder it is run from.

**What is where.**

| Where | Path | What |
|---|---|---|
| Air | `~/.ssh/summon/summon_nuance_ed25519`, `summon_nuance_ed25519.pub` | the summon key (this key and nothing else) |
| Air | `~/.ssh/summon/config`, `~/.ssh/summon/known_hosts` | the `summon-nuance` ssh entry (used with `ssh -F`, nothing is added to `~/.ssh/config`) and Nuance's pinned host key |
| Air | `~/.ssh/summon/expiry` | the summon key's expiry on Nuance (YYYYMMDD), written by `pin-nuance --expires` |
| Air | `~/.local/state/summon/ledger.jsonl` | the Air's ledger: `sent` (with the effort and the advisory origin: harness, pid, start time) and `answer` for each start, `cancel_sent` and `cancel_answer` for each cancel, and an `inventory_answer`, `status_answer` or `result_answer` for any `auth_refused` or `host_key_mismatch` |
| Air | `~/.local/bin/summon` | a link to `packages/summon/bin/summon.ts`: the front door |
| Air | `~/summon-nuance-bundle-<expiry>-<build id>` | one AirDrop bundle per build and expiry: `summon-install.sh`, `summon-gatekeeper`, `summon-runner`, `MANIFEST.txt` |
| Nuance | `~/.local/share/summon/` | `summon-gatekeeper`, `summon-runner`, and `INSTALLED` (build, prepared, both sha256s and the key expiry: the bundle's `MANIFEST.txt`, written once the new programs and key line are in place); `keys-only`, the installer's record that its last drop-in passed the `sshd -T` check |
| Nuance | `~/.local/state/summon/` | spool, jobs, seen ids, ledger, `inventory.json`, `runner.log` |
| Nuance | `~/.config/summon/allowlist.yaml` | what Summon may do (edited only on Nuance) |
| Nuance | `~/.ssh/authorized_keys` | one line, the one ending ` summon-air`: `restrict`, `from=` the home LAN, `expiry-time`, `command=` the gatekeeper |
| Nuance | `/etc/ssh/sshd_config.d/010-summon.conf` | `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `AllowUsers <user>`, `AuthenticationMethods publickey`, `GSSAPIAuthentication no`, `HostbasedAuthentication no` |
| Nuance | `~/Library/LaunchAgents/dev.summon.runner.plist` | the runner, loaded in Yu's GUI session |

The drop-in is `010-`, not `100-`: sshd keeps the first value it reads, and macOS's own `100-macos.conf` would
otherwise win. sshd is not reloaded: macOS starts it per connection, so the next login reads the file.

**Rollback** (spec §7), each step independent. **Remove every build entry from the allowlist before any rollback** (and
before putting an older runner back): an older runner does not know `build`, so it refuses the whole allowlist over a build
entry and then every job. That is definite, but total.

1. On Nuance, unload and delete the runner: `launchctl bootout gui/$(id -u)/dev.summon.runner; rm ~/Library/LaunchAgents/dev.summon.runner.plist`
2. Remove the one key line: `sed -i '' '/ summon-air$/d' ~/.ssh/authorized_keys` (no other line matches).
3. Delete the drop-in (skip while `grep -c ' collab-air$' ~/.ssh/authorized_keys` is not 0; run Collab's Nuance rollback first): `sudo rm /etc/ssh/sshd_config.d/010-summon.conf`. Password logins come back with it.
4. Turn Remote Login off (System Settings → General → Sharing) if nothing else needs it (skip while `grep -c ' collab-air$' ~/.ssh/authorized_keys` is not 0; Collab's bridge relies on Remote Login).
5. Archive `~/.local/state/summon/ledger.jsonl`, then delete `~/.local/share/summon`, `~/.local/state/summon`,
   `~/.config/summon`, and any `~/Downloads/summon-nuance-bundle-*` still there.
6. On the Air, archive `~/.local/state/summon/ledger.jsonl`, then delete `~/.ssh/summon` (the key, its expiry, its ssh
   entry and `known_hosts`), every `~/summon-nuance-bundle-*`, and the link `~/.local/bin/summon` (only if
   `ls -l` shows it pointing at `packages/summon/bin/summon.ts`).

## When a summon does not reach Nuance

Every answer here means nothing reached Nuance, so a new summon is safe. `unknown` is the exception: the request may
have been delivered, so it is never sent again; ask `summon status` with its handle.

- **`unreachable (no_route)`, `not paired: <device>`.** `~/.ssh/summon/config` has no `Host summon-<device>` entry:
  before install step 3, after rollback, or a mistyped device (Phase 0 pairs only `nuance`). Nothing is ledgered or sent.
- **`unreachable (no_route)` while Nuance is awake.** The Air may be blocking the caller. Inside a harness sandbox
  (Codex's, or Claude Code's), the hint names it: rerun outside it. Otherwise it may be macOS Local Network privacy for
  the app that started `summon` (System Settings › Privacy & Security › Local Network); Terminal.app and SSH logins are
  exempt, so `summon nuance inventory` from Terminal.app tells the two apart.
- **The key expired.** The summon key works until the date in `~/.ssh/summon/expiry`; every summon warns on stderr from
  7 days before it (`expires on <date> (in N days)`). From that day `auth_refused` says the key expired: re-pair from
  install step 1.
- **The summon key is missing or unreadable on the Air** (deleted, or a sandbox that cannot read `~/.ssh/summon`):
  `auth_refused`, with a hint naming the key file ssh could not offer.
- **Nuance restarted (FileVault).** After a restart (power loss, a drained battery, a panic) Nuance may be waiting at the
  FileVault screen, where its sshd cannot read the summon key line, so a summon answers `auth_refused` (or
  `host_key_mismatch`, if the pre-boot host key differs). Unlock it at the Mac. Do not re-pin or re-key from this state.
- **Host key changed.** `host_key_mismatch` is a security event: the host at `nuance.local` presented a different key from
  the one pinned, and the detail shows the fingerprint it presented. Do not re-pin from the network (no `ssh-keyscan`).
  At Nuance, run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Only if it shows that fingerprint and you know why it
  changed (macOS was reinstalled, say), re-pin with the line read there:
  `bun scripts/pin-nuance.ts --user <name> --host-key "<line read on Nuance>" --expires <YYYYMMDD>`.
- **The Air ledger cannot be written** (a sandbox, a full disk). A start or a cancel is logged before it is sent, so it
  stops there and answers `unreachable (no_route)` with exit 3; with `--json` that is one line,
  `{"status":"unreachable","reason":"no_route","detail":"could not write the Air ledger (<code>); nothing was sent"}`,
  with a hint inside a sandbox. Usage errors exit 2; any other fault inside `summon` answers `unknown` (exit 1).

## The allowlist

`~/.config/summon/allowlist.yaml` on Nuance decides what Summon may do. It is read on every request and edited only
there, by Yu. The installer's starter file allows Claude Code (sonnet, haiku) to review `~/Projects`, and it is the
reference for the format. If the file is missing or does not parse, every summon is refused `outside_allowlist`, with a
hint that says what is wrong.

- **`limits.max_concurrent` must be 1.** The runner is serial, so a second admitted job could only wait, and it could
  expire before its turn.
- **Only `claude` runs in Phase 0.** A `codex` or `hermes` request, or a `claude` request that names a provider, is
  refused `runtime_unavailable` before the allowlist's admission check. A claude model entry may list `effort` values that
  `claude --help` accepts (`low`, `medium`, `high`, `xhigh`, `max`), and an admitted effort reaches claude as `--effort`.
- **A review folder** gives the job Read, Glob and Grep, and Claude Code keeps those reads inside the folder.
- **An edit or build folder also needs `reads_anywhere: true` on the claude runtime entry**, because an edit grant reaches well
  past its folder:
  1. The job can **read any file Yu can**, through git's own file options (`git commit -F <file>`,
     `git add --pathspec-from-file=<file>`), and return what it read in its result.
  2. `git add` and `git commit` act on the **whole enclosing repository**, not just the folder. The job can stage and
     commit other agents' uncommitted work anywhere in that repository, or amend its last commit. Nothing is pushed or
     deleted, and the reflog keeps the old commit.
  3. The job can write **`CLAUDE.md`, `AGENTS.md` and `CLAUDE.local.md`**. Summon's own jobs ignore them, but later
     agent sessions in that folder load them as instructions. `CLAUDE.local.md` is often gitignored, so `git status`
     may not show it.

  So grant edit on a repository root or a worktree of its own, and read a job's diff (and any `CLAUDE.local.md`)
  before you open your own session there.

```yaml
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
    reads_anywhere: true      # needed by every edit or build folder below
folders:
  - path: ~/Projects
    access: review
  - path: ~/Projects/some-repo
    access: edit
```

## Edit and build folders (Phase 0.5)

`--edit` lets a job run `git add` and `git commit` in its folder. `--build` also lets it start the commands that the folder's
**build entry** lists (`bun test`, say), so Nuance can do test-driven work. A job stops after 40 turns for review and 60 for
edit and build; the job timeout (at most `job_timeout_max`, 24 h) is the time bound, as before.

**The boundary is Claude Code's sandbox, not the command list.** The list says only what a job may *start*. A build job runs
code from its folder as Yu's macOS user: its tests, its scripts, whatever the model wrote into the folder before running them.
So every edit job and every build job runs under the sandbox, with no opt-out and no extra setting:

- no network;
- writes only inside the folder (`allowWrite` is empty), which is where the job's temp directory lives;
- no local port binding and no Unix sockets;
- `~/.ssh`, `~/.claude` and Summon's own `~/.config/summon`, `~/.local/share/summon` and `~/.local/state/summon` unreadable;
- if the sandbox cannot start, the job fails rather than run unconfined.

Review jobs have no `Bash` tool and no sandbox settings, as before.

**A build entry** is edited only on Nuance, like every allowlist entry:

```yaml
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
    reads_anywhere: true      # required: an edit or build job runs git, which can read any file Yu can
folders:
  - path: ~/Projects/collab-trial
    access: build
    commands:
      - run: bun test
        args: true            # optional; default false
      - run: bun run typecheck
```

The parse rules. Any violation is a parse error, so the whole allowlist is refused (every summon is `outside_allowlist`), as
for any malformed allowlist:

- `commands` is required for `access: build` and refused on any other access; 1 to 16 entries, no `run` twice.
- `run` is a program followed by up to seven plain words. The program is a lowercase name looked up on `PATH`, or an absolute
  path. Each word starts with a letter or digit, so there are no flags, no quotes and no shell syntax; `:` and `=` are allowed
  inside a word (`bun run test:unit`). No `..` path segment, no newline.
- The program's basename is not one of `sh bash zsh dash ksh fish env xargs find git curl wget ssh scp sftp nc open osascript
  sudo su launchctl python python3 perl ruby`.
- `args` is the boolean `true` or `false`; the strings `"true"` and `"false"` are refused. With `false` the job may run the
  command exactly as written; with `true` it may add anything after it. Either way the rule matches the command string, not
  what the program then does: the sandbox is what confines that.
- **`sandbox_write` and `local_binding` are not settings of this version.** An entry of any access that carries either one is a
  parse error, so nobody believes a setting took effect that did not. Extra writable paths, local ports and Unix sockets are
  deferred to Phase 1.
- A build folder lies strictly inside `~` and is not, does not contain and does not lie within `~/.ssh`, `~/.claude`,
  `~/.config`, `~/.local`, `~/Library`, Desktop, Documents, Downloads or iCloud Drive. This is checked on the entry as spelled,
  and again on realpaths when a job is admitted.

**Edit and build entries**, both:

- The job's `cwd` is the entry itself (its realpath). A review job may still run anywhere inside an entry.
- The folder is a **git repository root with a real `.git` directory** directly in it: not a gitfile, a worktree link, a symlink
  or a parent's repository, and one that git itself would take (a `HEAD` naming a ref or an object, real `objects/` and `refs/`
  directories, no `commondir`).
- **No edit or build entry lies inside another edit or build entry.** Spelled paths are compared with `..` and doubled slashes
  folded and case ignored; that is a parse error. A `~` spelling against an absolute one, and symlinks, are caught when a job is
  admitted, on realpaths. A review entry may lie inside an edit or build entry.
- A refusal names its reason and carries a hint holding the entry to add (for a build refusal, a complete entry with a
  `commands:` line).

**Absolute programs and `PATH`.** A job's `PATH` is the system directories. `run: /Users/yu/.bun/bin/bun test` appends
`/Users/yu/.bun/bin` after them, so it never shadows `/usr/bin`; the rules for the bare form (`bun test`) are added only if `bun`,
looked up on that final `PATH`, is the same program (same realpath). Otherwise only the absolute form is allowed. To run Bun
projects on Nuance, install Bun there first (optional; Bun's own installer, `curl -fsSL https://bun.sh/install | bash`).

**The runner checks again when the job starts.** The gate admits a request; the runner re-runs the whole admission when it takes
the job and uses that result. A build entry removed while the job waited, a folder that has stopped being a repository root or has
become nested, an allowlist that went missing or broke, or a folder that now resolves somewhere else: the job ends **`refused`**
with the admission's reason (and its hint in the result text), and claude is never started. This holds for review jobs too.

**What the runner does around an edit or build job.**

1. **A temp directory.** The sandbox allows no temp root outside the folder, so the runner makes `<folder>/.summon-tmp/<job id>`
   (mode 0700) and sets it as the job's `TMPDIR`. It adds the line `/.summon-tmp/` to `<folder>/.git/info/exclude` (creating
   `.git/info` if needed, and doing nothing if the line is there), so git never sees the temp files. The line stays. When the job is
   over, however it ended, the runner removes the job's directory, and `.summon-tmp` too if that leaves it empty. If `.git/info`
   or the exclude file is a link, or the temp directory or the fingerprint cannot be made, the job ends `failed` before claude starts.
2. **A fingerprint.** Inside the folder the sandbox cannot tell `src/` from `.git/config`, so the runner keeps a copy of the git
   files that could run code later: `.git/config`, every file under `.git/hooks/` and `.git/info/`, and `.gitattributes` and
   `.gitmodules` in the folder root (found by a case-insensitive listing, so `.Git`, `.GitAttributes` and `Config` are covered on
   the Mac's volume). The copy is taken after the exclude line is written. The runner keeps it in memory and also as `guard.json`,
   a 0600 file in the job's private state directory (`~/.local/state/summon/jobs/<job id>/`, mode 0700, which the job's sandbox
   cannot read); it holds file contents, so a `.git/config` that holds credentials is on disk there for as long as the job runs,
   and the file is deleted when the job is closed. After the job the runner puts back any file whose contents, type or mode
   changed, removes any that appeared and recreates any that vanished, and puts each watched directory (and `.git` itself) back
   to its mode. **If it changed anything, the first line of the result is `tampered: <paths>`**
   (a second line, `not restored: <paths>`, names what it could not put back), and the Nuance ledger gets one `job_tampered` line
   with a count and no paths; the paths stay in the 0600 result file. The job's status is not changed by any of this.
   A job cannot keep a change by making it hard to undo. The folder belongs to the runner's user, and the owner can clear all of
   these without root, so the restore does: a mode of 000 on a file or directory (it is opened, and a changed path is compared
   without being read, so a huge file a job planted costs nothing), a user flag (`chflags uchg`, `uappnd`) and a deny ACL (the
   restore clears them with `/usr/bin/chflags -h nouchg,nouappnd` and `/bin/chmod -N` on the path and its parent before it
   replaces or removes the path), and a directory the job made unreadable (it is removed with what is in it). Only a failure that
   is really outside the owner's power, such as a pipe or socket that was in the baseline and is gone, ends as `not restored`.
   The restore puts back contents and mode, not timestamps or extended attributes, and a user flag or ACL on a path it replaces
   is gone with the old copy.
3. **A process sweep.** Claude is started as the leader of a process group of its own, and the runner records its process tree
   every 2 s (`/bin/ps`, walked from the claude pid, keyed by pid *and* start time so a reused pid is never taken for a job
   process). When the job ends, normally or by timeout, the runner kills the group, then every recorded process still alive with
   the same start time (this catches a child that called `setsid`), and only then compares the fingerprint, restores and removes
   the temp directory.
4. **A runner that is stopped or dies.** Claude runs in a session of its own, so stopping the runner no longer takes it down with
   it (launchd cleans up only the runner's own process group). Three things cover that:
   - The runner keeps `procs.json` (0600, next to `guard.json`): claude's pid, its process group, its start time and the
     recorded processes with theirs. It is written before the job is marked running and again whenever the recorded set changes,
     and deleted when the job is closed.
   - **SIGTERM** (`launchctl bootout`, logout, a reinstall): the runner stops the running job as a cancel does, then sweeps,
     restores and cleans up as above, and ends it `unknown` (`runner stopped mid-job`) before it exits 0. No other job is
     started. It has launchd's exit timeout (20 s by default); claude gets a 5 s grace before SIGKILL.
   - **SIGKILL, a crash, power loss**: the next runner start does the same work first, before it settles any job or claims any:
     for a running job whose runner is gone (its recorded pid is dead, or alive with another start time) it kills the group and
     the recorded processes, but only those whose start time still matches the record, compares the git files with the saved
     baseline and puts them back, removes the temp directory, and writes the result's first line (`tampered: <paths>`, or
     `fingerprint not checked: <why>` if the saved baseline is missing or unreadable; a further line `processes not swept: <why>`
     if the process record is). The job then ends `unknown`, as before. A runner that is still alive owns its job and is left
     alone.

**Known limits of Phase 0.5, accepted.**

- A process that detaches and is reparented to launchd within one 2 s interval is not found. It stays sandboxed (no network,
  writes only inside the folder). An environment marker cannot serve instead: `ps -E` shows no other process's environment on
  this macOS.
- A legitimate edit to `.git/config`, a hook, `.git/info/**`, `.gitattributes` or `.gitmodules` by a job is reverted and reported
  as `tampered`. `.gitattributes` files below the folder root are not fingerprinted (the filter and textconv drivers they name are
  defined in config files, and those are).
- Test suites that need `/private/tmp` sockets or local ports (the collab-bridge suite is one) will not run as a build job here;
  suites that respect `TMPDIR` will.
- A runner that is killed (SIGKILL, a crash, power loss) rather than stopped cannot clean up at once. launchd starts the runner only
  when something is in the spool, so claude, with its job's sandbox but no timeout, can keep running until the next request of
  any kind arrives (`summon nuance inventory` is the quick way to start the runner); that start does the sweep and the restore
  before anything else. Until then the git files stay as the job left them, and the job still says `running`. Also unrecoverable:
  a runner that dies in the instant between spawning claude and saving `procs.json` (nothing is saved to find it by), a claude
  whose start time was never read (`ps` failed, so a live pid proves nothing and is not signalled), and a detached child that was
  never recorded (the same residual as above).
- There is no spend bound yet (a `--max-budget-usd` is deferred): the job timeout and `starts_per_hour` are the bounds.

**Updating an existing install.** Before the new runner goes on Nuance, check the allowlist already there: no edit entry may lie
inside another edit entry (that is now a parse error, and a parse error refuses every job), and each edit entry should be a git
repository root with a real `.git` directory (a job's `cwd` must be that root; otherwise edit jobs in that folder are refused until
the entry is corrected). The installer never rewrites an edited allowlist. For a build folder, then: install Bun if Bun projects
are wanted, add the folder entry above, and set `reads_anywhere: true` on the claude runtime if it is not set. A Nuance runner that
has not been updated refuses `access: build` as `malformed`, which is a definite refusal.

## Known Phase 0 limits

- **The runner is serial.** It runs one job at a time and answers nothing else until that job ends, so
  `summon nuance inventory` sent while a job runs answers `unknown` after 40 s. Ask again once the job is over.
- **Clean-up happens when the runner starts.** A job left `running` by a killed runner is settled the next time
  launchd starts the runner, which any spool entry does: it ends with the outcome in its `result.json` if that was
  written, else `unknown`. Until then it still counts toward `max_concurrent`; `summon nuance inventory` is a quick
  way to start it. A job still `queued` that the runner never claimed stops counting once its expiry (plus the 5 min
  clock-skew grace) has passed: `status` then says `expired` (or `cancelled`, if a cancel was asked for), and the next
  `start` or runner start settles it. A job whose claim keeps failing (a full disk) is retried by launchd until it
  runs or reaches that point.
- **A symlink inside an allowlisted folder can stall a job.** A `cwd` that resolves into `~/Documents`, `~/Desktop`,
  `~/Downloads` or iCloud Drive is refused `tcc_protected_folder`, but a link *inside* an allowlisted folder that points
  into one of them is only met when the job reads it. macOS can then hold the job at a privacy prompt on Nuance's
  screen, where it stalls until its timeout.
- **Claude Code keeps some files of its own.** Claude Code may save large tool outputs of a summoned job under
  `~/.claude/projects/<cwd-slug>/<session>/tool-results/` on Nuance, even with `--no-session-persistence`. They follow
  Claude Code's own cleanup, not Summon's 30-day sweep. The inventory carries a short `retention` note per harness.

## Deferred on purpose

- **Ledger pruning at 1 year.** The first entries age out in 2026-10 + 1 y, and pruning a hash chain needs an
  anchor entry, so it waits for Phase 1.
- **The `sol summon` alias.** `~/.config/sol` is unversioned and other agents edit it, so `summon` on PATH is the
  Phase 0 front door.
- **Reusing `sol agent start`.** Phase 0 runs jobs with its own minimal runner, not `sol agent start`, even when the
  inventory shows a verified `sol`. Reuse is Phase 1.

## Phase 0 live check (2026-10-12)

The Air → Nuance install was done by hand on 2026-10-12, 22:20–22:40 BST: build `5c09726b`, prepared
20261012212024 UTC, key expiring 20270110. Nuance runs macOS 26.6.2 with Claude Code 2.1.296.

| # | Check | Result |
|---|---|---|
| — | `ls /etc/ssh/ssh_host_*` before the install | `not found`. Nuance had no host keys yet, so the installer generated them (`ssh-keygen -A`) |
| — | Installer | Finished, and its own inventory request was answered. Host key `SHA256:WdvQobU1ra2aU622roj5SAXq9+qmrEBxwePHkGvXGCQ` matched what pin-nuance pinned on the Air |
| 1 | `summon nuance inventory` | `completed` in 3.3 s: claude logged in, `gui_session_is_mine: true`, `fleet_users: [macair]` |
| 2 | Review job in `~/Projects` | First attempt refused `outside_allowlist`, because `~/Projects` did not exist yet (correct). After `mkdir`: `admitted` → `completed` in 11 s, 4 turns |
| 3 | The same request JSON sent twice | `refused(outside_allowlist)`, then `refused(replayed)` |
| 4 | `--cwd '~/Documents'` / `--cwd '/'` | `refused(tcc_protected_folder)` / `refused(outside_allowlist)` with the YAML hint |
| 5 | `expires_at` in the past | `refused(expired)`, with both clocks in the detail |
| 6 | `ssh … ls`, `scp`, `sftp` | `refused(malformed)` exit 2. scp and sftp fail on the gatekeeper's one JSON line; no shell |
| 7 | Password login | exactly `macair@nuance.local: Permission denied (publickey).`, so only publickey is offered |
| 8 | Logout / lid closed | not run (optional; needs Yu at Nuance) |
| 9 | Traversal ids (five spellings) | all `refused(malformed)` |
| 10 | `ssh -6` / `AddressFamily=inet6` | `Permission denied (publickey)`: the IPv6 source misses `from="192.168.50.0/24"` |
| 11 | Job on battery with `pmset -g assertions` | not run (optional; needs Yu at Nuance) |
| 12 | Lid closed mid-job | not run (optional; needs Yu at Nuance) |
| 13 | Edit folder without `reads_anywhere` | `refused(outside_allowlist)`: "edit jobs run git, which can read any file on this Mac" + hint; nothing ran |
| 14 | `--effort low` | `admitted` → `completed` in 6 s, 1 turn |
| 15 | KexAlgorithms mismatch (pre-auth drop) | raw ssh: `Unable to negotiate with 192.168.50.65 port 22: no matching key exchange method found. Their offer: …`, exit 255. Through summon: `unknown`, with the first 200 characters as the detail |

Checks 8, 11 and 12 test how failures are reported when Nuance logs out, runs on battery or sleeps. Hermetic tests cover
them; run them live before relying on Summon over a closed lid.
