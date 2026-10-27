# Lobby doorbell package guide

> **Type:** guide
> **Purpose:** Keep the doorbell's boundaries intact while changing it.
> **Evidence:** `src/`, `bin/`, `contract/` and `tests/` in this package; README.md is the contract. Nothing is released, installed or deployed.
> **Compass:** [README](README.md) · [Lobby guide](../lobby/CLAUDE.md) (the lobby's non-negotiables, all kept) · [Lobby README](../lobby/README.md)

This private package is the per-device lobby doorbell. PR 1 is `netcheck`
only: a read-only health check with five states. The fetcher, content-free
bells, the listener registry, ringers, `stop`/`resume` and harness hooks come in
later PRs and inherit every rule below.

## Non-negotiables

- **The lobby stays behind its CLI.** Never import `packages/lobby` (or `api/`
  or `docs/`). Read lobby state only through the pinned CLI's JSON output, run as
  a child. Contract checks in `contract/lobby-contract.ts` pin what is parsed, as
  patterns and key names; update them in the same change as a parser.
- **One process module, no shell.** Only `src/run.ts` starts processes, through
  `assertAllowedArgv`'s closed allowlist (`process.execPath` with the pinned
  lobby entry and its read commands, `mullvad lan get` at fixed paths,
  `/bin/ps -o lstart= -p <pid>`). Children get `HOME`, `PATH=/usr/bin:/bin`,
  `LANG` and `AGENTTOOL_LOBBY_HOME` only. Never `sh -c`, never a shell string,
  never `kill -9`.
- **One HTTP call site.** Only `src/health.ts` makes a request, through an
  injected `fetchImpl`, to the origin constant (equal to the lobby's
  `LOBBY_ORIGIN`): one credential-free `GET /health`. Only the bin hands over
  `globalThis.fetch`. No flag or variable changes the origin.
- **No listening, no LAN role.** No `Bun.listen`, `Bun.serve`,
  `createServer`, `dgram`, `node:http(s)` servers, `Bun.udpSocket`, mDNS or
  Bonjour. PR 1 makes no connection besides the injected fetch; PR 2 adds
  exactly one socket connect site, the Claude inbox, in its own module.
- **Never secrets.** Nothing names the Keychain, `/usr/bin/security`, the
  lobby's `secrets/` or its database. Inside the lobby home only `STOP` is named.
- **No text survives.** Every field printed, logged or (later) written to a
  bell or ring is a validated id, canonical time, number or closed code. Card,
  message, roster and display-name text is dropped at parse time. Canary tests
  enforce it; keep them covering every new output.
- **Unknown is never healthy.** A new axis that cannot be read reports
  `unknown`, never `ok`. `unknown` never exits 0.
- **Read-only means read-only.** Netcheck never runs a command that changes
  state (no `room sync`), never starts the lobby CLI on an empty lobby home,
  never creates the doorbell home, and writes one log line only into a doorbell
  home that already exists. Writes live in `src/home.ts`.
- **Nothing restarts itself.** No launchd agent, no KeepAlive, no self-restart.
  `STOP` at `<lobby home>/STOP` is the one device brake; lifting it will need a
  person at `/dev/tty`.
- **State is owner-only.** Directories 0700, files 0600; refuse wider modes,
  other owners and symlinks rather than repairing them.

## Working here

- Toolchain: Bun 1.3.5 and the committed `bun.lock` (dev dependencies only).
  Run `bun run ci` before handoff: typecheck, the hermetic tests and the lobby
  contract against `../lobby/src`.
- Tests use temporary homes, `tests/fixtures/fake-lobby.ts` as the CLI, a fake
  fetch and a fake Mullvad. Never point a test at a real desk, the network or
  the Keychain. Fixtures are synthetic.
- `tests/boundary.test.ts` enforces the rules above; extend it with each new
  module rather than loosening it.
- Root `AGENTS.md`, `CLAUDE.md`, `docs/RIGHTS-OF-LIFE.md` and
  `packages/lobby/CLAUDE.md` also apply.
