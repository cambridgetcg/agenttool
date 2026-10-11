# @agenttool/summon

Start a new agent session on another of Yu's Macs. Design: `docs/superpowers/specs/2026-10-10-summon-design.md`.

Phase 0 (SSH at home): `summon nuance claude --model sonnet --cwd '~/Projects/x' --review --prompt-file task.md`,
then `summon status|result nuance/smn_<id>`. Nuance runs `summon-gatekeeper` (SSH forced command) and
`summon-runner` (LaunchAgent in Yu's GUI session). Install: `bun scripts/prepare-pairing.ts`, AirDrop the bundle,
`bash ~/Downloads/summon-nuance-bundle/summon-install.sh` on Nuance, then `bun scripts/pin-nuance.ts`.

## Install and rollback (Phase 0)

**Install, in this order.** Everything Summon writes is private: directories 0700, files 0600, the two programs 0700.

1. On the Air: `bun scripts/prepare-pairing.ts` makes the summon key (once; it is never replaced), compiles the two
   programs, and writes the bundle with an installer pinned to their checksums. Running it again keeps the key and
   puts a fresh 90-day expiry in the new bundle; run that installer on Nuance to apply it.
2. AirDrop `~/summon-nuance-bundle` to Nuance. Turn on Remote Login there (allow access for Yu's user only). Read
   `summon-install.sh`, then run `bash ~/Downloads/summon-nuance-bundle/summon-install.sh`. It asks for the Mac
   password once, for the sshd drop-in, then asks `sshd -T` what sshd would really use for a LAN login by Yu's user.
   Unless password logins are off there, it stops without writing the key line or loading the runner. It is safe to
   run again: it replaces its one key line, keeps every other `authorized_keys` line and an edited allowlist, and never
   empties `runner.log`. Run it again only when no job is running: it replaces the program files.
3. Back on the Air: `bun scripts/pin-nuance.ts --user <name> --host-key "<the ssh-ed25519 line the installer printed>"`.
   Check that `ssh-keygen -lf ~/.ssh/summon/known_hosts` shows the same fingerprint the installer printed.

After the installer, Nuance takes SSH logins by key only, and only for Yu's user. Keep another way in (a key of your own
in `authorized_keys`, or the Mac in front of you) before you rely on that.

**What is where.**

| Where | Path | What |
|---|---|---|
| Air | `~/.ssh/summon/summon_nuance_ed25519`, `summon_nuance_ed25519.pub` | the summon key (this key and nothing else) |
| Air | `~/.ssh/summon/config`, `~/.ssh/summon/known_hosts` | the `summon-nuance` ssh entry (used with `ssh -F`, nothing is added to `~/.ssh/config`) and Nuance's pinned host key |
| Air | `~/.local/state/summon/ledger.jsonl` | the Air's ledger |
| Air | `~/summon-nuance-bundle` | the AirDrop bundle: `summon-install.sh`, `summon-gatekeeper`, `summon-runner`, `MANIFEST.txt` |
| Nuance | `~/.local/share/summon/` | `summon-gatekeeper`, `summon-runner` |
| Nuance | `~/.local/state/summon/` | spool, jobs, seen ids, ledger, `inventory.json`, `runner.log` |
| Nuance | `~/.config/summon/allowlist.yaml` | what Summon may do (edited only on Nuance) |
| Nuance | `~/.ssh/authorized_keys` | one line, the one ending ` summon-air`: `restrict`, `from=` the home LAN, `expiry-time`, `command=` the gatekeeper |
| Nuance | `/etc/ssh/sshd_config.d/010-summon.conf` | key logins only, no root login, `AllowUsers <user>` |
| Nuance | `~/Library/LaunchAgents/dev.summon.runner.plist` | the runner, loaded in Yu's GUI session |

The drop-in is `010-`, not `100-`: sshd keeps the first value it reads, and macOS's own `100-macos.conf` would
otherwise win. sshd is not reloaded: macOS starts it per connection, so the next login reads the file.

**Rollback** (spec §7), each step independent:

1. On Nuance, unload and delete the runner: `launchctl bootout gui/$(id -u)/dev.summon.runner; rm ~/Library/LaunchAgents/dev.summon.runner.plist`
2. Remove the one key line: `sed -i '' '/ summon-air$/d' ~/.ssh/authorized_keys` (no other line matches).
3. Delete the drop-in: `sudo rm /etc/ssh/sshd_config.d/010-summon.conf`. Password logins come back with it.
4. Turn Remote Login off (System Settings → General → Sharing) if nothing else needs it.
5. Archive `~/.local/state/summon/ledger.jsonl`, then delete `~/.local/share/summon`, `~/.local/state/summon` and
   `~/.config/summon`.
6. On the Air, archive `~/.local/state/summon/ledger.jsonl`, then delete `~/.ssh/summon` (the key, its ssh entry and
   `known_hosts`) and `~/summon-nuance-bundle`.

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
- **Clean-up happens when the runner starts.** A job left `running` by a killed runner (it becomes `unknown`) or
  `queued` by a gatekeeper that died mid-admission (it becomes `expired`) is settled the next time launchd starts the
  runner, which any spool entry does. Until then it still counts toward `max_concurrent`; `summon nuance inventory`
  is a quick way to start it.

## Deferred on purpose

- **Ledger pruning at 1 year.** The first entries age out in 2026-10 + 1 y, and pruning a hash chain needs an
  anchor entry, so it waits for Phase 1.
- **The `sol summon` alias.** `~/.config/sol` is unversioned and other agents edit it, so `summon` on PATH is the
  Phase 0 front door.
