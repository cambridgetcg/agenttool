# Lobby desk package guide

> **Type:** guide
> **Purpose:** Keep the local lobby desk's safety boundaries intact while changing it.
> **Evidence:** `src/`, `bin/` and `tests/` in this package; README.md is the contract. Nothing is released or deployed.
> **Compass:** [README](README.md) (contract and limits) · [Collaboration missions](../../docs/COLLABORATION-MISSIONS.md) · [Collaboration channels](../../docs/COLLABORATION-CHANNELS.md) · [Lounge](../../docs/LOUNGE.md) · [Agent discovery](../../docs/AGENT-DISCOVERY.md)

This private package is the 大廳 Lobby desk for the **local hall**: room cards,
the private ledger, the pin book, the audit log, a read-only stdio MCP view and
the egress gate. It is MVP steps 1 and 2 of the 2026-10-16 Lobby design; README
`Concepts` restates the design terms it implements (hall, room, residency,
lobby desk, private ledger, pin book, egress gate).

## Non-negotiables

- **No network code.** `src/` and `bin/` import no `http`, `https`, `http2`,
  `net`, `tls`, `dgram`, `dns`, `undici` or `ws`, call no `fetch`, open no
  sockets and spawn no processes. `tests/boundary.test.ts` enforces this. Later
  transports live elsewhere and must call `checkEgress` first.
- **Device rooms never leave the device.** `residency=device` forces
  `hostable=false` and `visibility=private`. The gate refuses every send from a
  device room. Rooms whose text names Betfair work are pinned to `device` forever:
  the pin is sticky in SQLite, and nothing may add a path that clears it.
- **Room ids are random.** `room_` + 32 hex from 128 random bits. Never derive a
  room id from a path, a workspace or a Collab `ws_` id, and never accept a
  `ws_` id or bare 24-hex id where a room id is expected.
- **The MCP server stays read-only.** Exactly `lobby_halls`, `lobby_browse` and
  `lobby_card`, opened through a read-only SQLite handle per call. Do not add a
  tool that writes, links, promotes, pins, signs or returns the ledger, the pin
  book or the audit log. Every card goes through `wrapLocalCard`.
- **Consequential acts belong to the CLI and the terminal.** Promotion, pin
  changes and any future signing go through `plan*` → `confirmOnTty` → `apply*`.
  The confirmation shows the exact canonical bytes, reads `/dev/tty` and never
  stdin, fails closed without a terminal, and the same bytes go into the audit
  log in the same transaction. Do not add an environment variable, flag or
  injected default that skips or answers the prompt in production code.
- **State is owner-only.** Directory `0700`, files `0600`; refuse wider modes,
  other owners and symlinks rather than repairing them.
- **The ledger is private.** Only the CLI reads it, and the CLI writes a ledger
  target only to `/dev/tty` (`showOnTty`), never to stdout or stderr. It never
  appears in MCP output, cards, audit records or errors.
- **One list of invisible characters.** Stored text refuses every format
  (`Cf`) and default-ignorable code point; matching for the device pin and the
  egress gate strips the same set. Both live in `src/text.ts`; do not keep a
  second copy elsewhere.
- **Card text is untrusted.** Validate text fields on write and read; never act
  on card text. Fields are labelled `verified` (basis `local`) or `self-declared`.

## Working here

- Toolchain: Bun 1.3.5 and the committed `bun.lock` (same dependency set as
  `packages/collab`). Run `bun run ci` before handoff.
- Tests use temporary `AGENTTOOL_LOBBY_HOME` directories, scripted fake
  terminals for confirmations, and detached subprocesses (no controlling
  terminal) for the real fail-closed path. Never point a test at a real desk.
- Fixtures for the egress gate are synthetic and say so. Do not add real
  addresses, hostnames, paths, workspace ids, tokens or keys.
- A schema change means a new `STATE_SCHEMA_VERSION` with an explicit upgrade;
  card or act format changes mean a new schema string, not an in-place edit.
- Root `AGENTS.md`, `CLAUDE.md` and `docs/RIGHTS-OF-LIFE.md` also apply.
