# Lobby doorbell package guide

> **Type:** guide
> **Purpose:** Keep the doorbell's boundaries intact while changing it.
> **Evidence:** `src/`, `bin/`, `contract/` and `tests/` in this package; README.md is the contract. Nothing is released, installed or deployed.
> **Compass:** [README](README.md) · [Lobby guide](../lobby/CLAUDE.md) (the lobby's non-negotiables, all kept) · [Lobby README](../lobby/README.md)

This private package is the per-device lobby doorbell: `netcheck`, a
read-only health check with five states; and the doorbell itself, one fetcher
per device, content-free bells, the listener registry, the Claude Code inbox
ringer, the `stop`/`resume` brake and the Claude Code hooks. The Codex bell,
Hermes and the hourly renewal trigger come later and inherit every rule below.

## Non-negotiables

- **The lobby stays behind its CLI.** Never import `packages/lobby` (or `api/`
  or `docs/`). Read lobby state only through the pinned CLI's JSON output, run as
  a child. Contract checks in `contract/lobby-contract.ts` pin what is parsed, as
  patterns and key names; update them in the same change as a parser.
- **One process module, no shell.** Only `src/run.ts` starts processes (never
  `Bun.$`), with one spawn call behind two closed allowlists:
  `assertAllowedArgv` (`process.execPath` with the pinned lobby entry and its
  read commands, including the fetcher's `room read <room> [--cached] --json
  --after C --limit 50`; `mullvad lan get` at fixed paths;
  `/bin/ps -o lstart= -p <pid>`) and `assertAllowedDetachedArgv` (this
  package's own bin with `fetch` or `watch --room R`, detached). Lobby children
  get `HOME`, `PATH=/usr/bin:/bin`, `LANG` and `AGENTTOOL_LOBBY_HOME` only;
  doorbell children add the resolved doorbell home and launch evidence, and
  only a watcher gets the inbox variables. Signals live there too: signal 0,
  and SIGTERM only after the pid's `ps` start time matched the record. Never
  `sh -c`, never a shell string, never `kill -9`.
- **One HTTP call site.** Only `src/health.ts` makes a request, through an
  injected `fetchImpl`, to the origin constant (equal to the lobby's
  `LOBBY_ORIGIN`): one credential-free `GET /health`. Only the bin hands over
  `globalThis.fetch`. No flag or variable changes the origin.
- **No listening, no LAN role.** No `Bun.listen`, `Bun.serve`,
  `createServer`, `.listen(`, `dgram`, `node:http(s)` servers, `Bun.udpSocket`,
  mDNS or Bonjour. Besides the injected fetch there is exactly one socket
  connect, `createConnection` in `src/claude-inbox.ts`, to the session inbox
  named by `CLAUDE_CODE_MESSAGING_SOCKET`. The token is never printed or logged.
- **Never secrets.** Nothing names the Keychain, `/usr/bin/security` or the
  lobby's `secrets/`, and nothing opens or reads the lobby's database. Inside
  the lobby home only two names appear, both in `src/home.ts`: `STOP` (the
  brake: `stop` writes it, `resume` removes it, everything else only lstats
  it), and the database file, only lstat'ed, whose existence decides whether
  the CLI may run. (The spec said not to name `lobby.sqlite` at all; a review of PR
  1 showed that without this check netcheck made the CLI create the database
  in a home holding only `.DS_Store`.)
- **No text survives.** Every field printed, logged, written to a bell,
  listener, mark or status file, or rung is a validated id, canonical time,
  number or closed code. Card, message, roster and display-name text is dropped
  at parse time. Ring and note lines match the closed grammar in `src/ring.ts`
  (`agenttool-lobby-bell/v2`), and every file format refuses unknown keys on
  read. Canary tests enforce it; keep them covering every new output.
- **A ring grants nothing.** It names a room and cursors so the agent reads
  through the verified `room_read`. Changing the ring wording means a new
  grammar version.
- **Unknown is never healthy.** A new axis that cannot be read reports
  `unknown`, never `ok`. `unknown` never exits 0.
- **Read-only means read-only.** Netcheck never runs a command that changes
  state (no `room sync`), never starts the lobby CLI unless the lobby's
  database file already exists, never creates the doorbell home, and writes
  one log line only into a doorbell home that already exists. The fetcher's
  `room read` refreshes the desk's own cache, as any lobby read does; it never
  sends, signs, accepts or renews. Writes live in `src/home.ts` (and the
  `/dev/tty` prompt in `src/tty.ts`), sync, async or callback style;
  `node:fs/promises` is not imported anywhere. Only `bin/` reads the
  environment (`process.env`, never `Bun.env`); library code takes it as a
  value.
- **Listening is always an explicit `listen`.** The hooks do nothing for a
  session that is not a listener, and `install-hooks` only prints its snippet;
  it never edits `~/.claude/settings.json`.
- **Nothing restarts itself.** No launchd agent, no KeepAlive, no self-restart;
  the fetcher and watchers refuse a launchd context and start only from a
  session or a terminal. Every loop checks `STOP` at `<lobby home>/STOP`, the
  one device brake, before every poll and every ring; lifting it needs a
  person at `/dev/tty` (`resume`).
- **State is owner-only.** Directories 0700, files 0600; refuse wider modes,
  other owners and symlinks rather than repairing them.

## Working here

- Toolchain: Bun 1.3.5 and the committed `bun.lock` (dev dependencies only).
  Run `bun run ci` before handoff: typecheck, the hermetic tests and the lobby
  contract against `../lobby/src`.
- Tests use temporary homes, `tests/fixtures/fake-lobby.ts` as the CLI, a fake
  fetch and a fake Mullvad, fake processes (pids above any real `pid_max`, so a
  stray signal reaches nothing) or short-lived `sleep` children, and a test
  inbox socket. Never point a test at a real desk, a real session's inbox, the
  network or the Keychain. Fixtures are synthetic.
- `tests/boundary.test.ts` enforces the rules above; extend it with each new
  module rather than loosening it.
- Root `AGENTS.md`, `CLAUDE.md`, `docs/RIGHTS-OF-LIFE.md` and
  `packages/lobby/CLAUDE.md` also apply.
