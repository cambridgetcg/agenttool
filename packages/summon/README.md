# @agenttool/summon

Start a new agent session on another of Yu's Macs. Design: `docs/superpowers/specs/2026-10-10-summon-design.md`.

Phase 0 (SSH at home): `summon nuance claude --model sonnet --cwd '~/Projects/x' --review --prompt-file task.md`,
then `summon status|result nuance/smn_<id>`. Nuance runs `summon-gatekeeper` (SSH forced command) and
`summon-runner` (LaunchAgent in Yu's GUI session). Install: `bun scripts/prepare-pairing.ts`, AirDrop the bundle,
`bash ~/Downloads/summon-nuance-bundle/summon-install.sh` on Nuance, then `bun scripts/pin-nuance.ts`.

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
