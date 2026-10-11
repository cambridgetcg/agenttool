# @agenttool/summon

Start a new agent session on another of Yu's Macs. Design: `docs/superpowers/specs/2026-10-10-summon-design.md`.

Phase 0 (SSH at home): `summon nuance claude --model sonnet --cwd '~/Projects/x' --review --prompt-file task.md`,
then `summon status|result nuance/smn_<id>`. Nuance runs `summon-gatekeeper` (SSH forced command) and
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
   If the runner does not load, it says so (the key line is already updated): run it again, or log out and in. It
   says `Done` only once the runner is loaded, the host key is handed back and the runner has answered an inventory
   request; otherwise it ends `✗ Not confirmed: …` and you keep the bundle and tell Ai. After `Done`, once Ai has the
   "give this back to Ai" lines (user, build, prepared, key expiry, host key, the pin line), delete the bundle folder
   from `~/Downloads` on Nuance, so a later re-pair can never run an old one by mistake. `~/.local/share/summon/INSTALLED`
   then holds the same lines as the bundle's `MANIFEST.txt`.
3. Back on the Air, run the pin line the installer printed:
   `bun scripts/pin-nuance.ts --user <name> --host-key "<the ssh-ed25519 line>" --expires <YYYYMMDD>`. It pins the host
   key and records the key's expiry (the installer's "key expires:" line) in `~/.ssh/summon/expiry`. Check that
   `ssh-keygen -lf ~/.ssh/summon/known_hosts` shows the same fingerprint the installer printed.
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
| Air | `~/.local/state/summon/ledger.jsonl` | the Air's ledger |
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

**Rollback** (spec §7), each step independent:

1. On Nuance, unload and delete the runner: `launchctl bootout gui/$(id -u)/dev.summon.runner; rm ~/Library/LaunchAgents/dev.summon.runner.plist`
2. Remove the one key line: `sed -i '' '/ summon-air$/d' ~/.ssh/authorized_keys` (no other line matches).
3. Delete the drop-in: `sudo rm /etc/ssh/sshd_config.d/010-summon.conf`. Password logins come back with it.
4. Turn Remote Login off (System Settings → General → Sharing) if nothing else needs it.
5. Archive `~/.local/state/summon/ledger.jsonl`, then delete `~/.local/share/summon`, `~/.local/state/summon`,
   `~/.config/summon`, and any `~/Downloads/summon-nuance-bundle-*` still there.
6. On the Air, archive `~/.local/state/summon/ledger.jsonl`, then delete `~/.ssh/summon` (the key, its expiry, its ssh
   entry and `known_hosts`), every `~/summon-nuance-bundle-*`, and the link `~/.local/bin/summon` (only if
   `ls -l` shows it pointing at `packages/summon/bin/summon.ts`).

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
- **An edit folder also needs `reads_anywhere: true` on the claude runtime entry**, because an edit grant reaches well
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
    reads_anywhere: true      # needed by every edit folder below
folders:
  - path: ~/Projects
    access: review
  - path: ~/Projects/some-repo
    access: edit
```

## Known Phase 0 limits

- **The runner is serial.** It runs one job at a time and answers nothing else until that job ends, so
  `summon nuance inventory` sent while a job runs answers `unknown` after 15 s. Ask again once the job is over.
- **Clean-up happens when the runner starts.** A job left `running` by a killed runner is settled the next time
  launchd starts the runner, which any spool entry does: it ends with the outcome in its `result.json` if that was
  written, else `unknown`. Until then it still counts toward `max_concurrent`; `summon nuance inventory` is a quick
  way to start it. A job still `queued` that the runner never claimed stops counting once its expiry (plus the 5 min
  clock-skew grace) has passed: `status` then says `expired` (or `cancelled`, if a cancel was asked for), and the next
  `start` or runner start settles it. A job whose claim keeps failing (a full disk) is retried by launchd until it
  runs or reaches that point.
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
