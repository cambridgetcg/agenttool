# Lobby desk package guide

> **Type:** guide
> **Purpose:** Keep the lobby desk's safety boundaries intact while changing it.
> **Evidence:** `src/`, `bin/` and `tests/` in this package, and `../../bin/tests/lobby-fleet-gateway.test.ts`; README.md is the contract. Nothing is released or deployed.
> **Compass:** [README](README.md) (contract and limits) · [Collaboration missions](../../docs/COLLABORATION-MISSIONS.md) · [Mission client](../../docs/COLLABORATION-MISSION-CLIENT.md) · [Identity anchor](../../docs/IDENTITY-ANCHOR.md) · [Collaboration channels](../../docs/COLLABORATION-CHANNELS.md) · [Lounge](../../docs/LOUNGE.md) · [Agent discovery](../../docs/AGENT-DISCOVERY.md)

This private package is the 大廳 Lobby desk: the **local hall** (room cards,
the private ledger, the pin book, the audit log, the egress gate) and the
**fleet hall v0** (hub and door, device enrollment, door-signed cards, knocks,
admit/deny and Ready on agenttool collaboration missions), with a read-only
stdio MCP view of both. It is MVP steps 1, 2 and 7 of the 2026-10-16 Lobby
design; README `Concepts` restates the design terms it implements.

## Non-negotiables

- **One transport, one origin, injected fetch.** `src/hosted.ts` is the only
  HTTP path. It takes `fetchImpl` by injection and never names the runtime's
  fetch; only `bin/agenttool-lobby.ts` hands it in. The origin is the constant
  `LOBBY_ORIGIN` (`https://api.agenttool.dev`) in `src/wire.ts`: no flag,
  environment variable or file may change it. No module imports `http`,
  `https`, `net`, `tls`, `dgram`, `dns`, `undici`, `ws`, `child_process` or
  workers, or opens a socket. Redirects are refused, responses bounded, and a
  transport failure is reported as uncertain and never retried automatically.
  `tests/boundary.test.ts` enforces this.
- **Every outbound text passes the gate inside the transport.** Observation
  summaries, mission descriptors, grant bodies and enrollment display names go
  through `assertSendable` (the egress gate plus: residency must be `fleet` and
  the card `hostable: true`) in `src/hosted.ts` itself, not only in callers.
  The gate checks every decoded string of a JSON text as well as the text, so a
  JSON escape (`\n`, `\t`, `\uXXXX`) cannot hide a term. Device rooms,
  device-pinned rooms and `open` rooms send nothing, and a saved send is gated
  again by the room as it is when it is retried, never by a stored snapshot
  alone. Do not add a send path that skips it, and do not weaken a gate rule to
  let text through.
- **One process, and no secret in argv.** Only `src/keychain.ts` starts a
  process, and only `/usr/bin/security` with fixed arguments. A secret travels
  on the child's stdin (`security -i`) or comes back on its stdout into
  memory; it is never an argument, never logged, never printed, and stderr is
  discarded unread. Keychain names never start with `-`.
- **Hub custody is CLI-only.** The project bearer and the door key live in the
  hub's login Keychain. Only the CLI reads them, and only with a person at the
  controlling terminal: every consequential fleet command checks
  `ctx.hasTerminal()` before it plans (exit 3 otherwise), and
  `requireKeychain` refuses without one. Two reads precede the prompt by
  design, and nothing else may: the door key signs so the prompt shows exact
  signed bytes, and an adopt reads the named mission with the bearer (a `GET`)
  so the prompt shows its charter. Every request that changes state goes after
  `yes`. They never reach the MCP server, stdout, stderr, the audit log,
  lobby.sqlite or an error message. `FileSecretStore` exists for tests;
  production code never selects it from a flag or environment variable.
- **Desk secrets stay in `secrets/`.** The desk key and every token preimage
  live in `<home>/secrets` (0700/0600), outside lobby.sqlite; only token hashes
  and public keys go anywhere else. `DeskSecrets.tokenFor` is called only by
  the transport, for an Authorization header.
- **Device rooms never leave the device.** `residency=device` forces
  `hostable=false` and `visibility=private`. Rooms whose text names Betfair work
  are pinned to `device` forever: the pin is sticky in SQLite, and nothing may
  add a path that clears it.
- **Room ids are random.** `room_` + 32 hex from 128 random bits. Never derive a
  room id from a path, a workspace or a Collab `ws_` id, and never accept a
  `ws_` id or bare 24-hex id where a room id is expected.
- **The MCP server stays read-only and offline.** Exactly `lobby_halls`,
  `lobby_browse` and `lobby_card`, opened through a read-only SQLite handle per
  call. The fleet hall is read from the local event cache and re-verified
  against the pinned door key on every call. Its import graph must not reach
  `hosted`, `keychain`, `secrets`, `ops`, `desk`, `hub`, `packets`, `tty` or the
  CLI. Do not add a tool that fetches, writes, knocks, admits, accepts, signs,
  pins or returns the ledger, the pin book, the audit log, a token or a key.
  Every card goes through `wrapLocalCard` or `wrapFleetCard`.
- **Consequential acts belong to the CLI and the terminal.** Promotion, pin
  changes and every fleet act that signs, grants, posts or accepts go through
  `plan*` → `confirmOnTty` → record → `execute*`. The confirmation shows the
  exact canonical bytes, including every document or request body to be sent,
  reads `/dev/tty` and never stdin, and fails closed without a terminal. Fleet
  acts append those bytes to the audit log before any network effect. Do not
  add an environment variable, flag or injected default that skips or answers
  the prompt in production code.
- **Pins come from people, not rooms.** The door key is pinned only at
  `fleet join`, from a fingerprint the person types, and only if the directory
  descriptor names the same key. Never pin or trust a key because a card, knock,
  roster or note names it.
- **Decisions keep their rules.** The approver's DID differs from the
  requester's; a tier may be lowered, never raised; admissions are single use
  and last 24 hours; grants last at most 24 hours and never outlive the term,
  season or directory; knocks last at most 72 hours; decisions are final. The
  hub enforces its own room's door and status (never trusting the requesting
  desk's CLI), and a knock id belongs to the desk whose authentic knock used
  it first.
- **Signed documents are compact and hex.** `agenttool-lobby-signed/v1`
  documents fit one 1000-character observation, signature included, and use
  hex for signatures and digests (the gate refuses key-like base64). A format
  change means a new format string, not an in-place edit.
- **State is owner-only.** Directory `0700`, files `0600`; refuse wider modes,
  other owners and symlinks rather than repairing them.
- **The ledger is private.** Only the CLI reads it, and the CLI writes a ledger
  target only to `/dev/tty` (`showOnTty`), never to stdout or stderr. It never
  appears in MCP output, cards, audit records, errors or anything hosted.
- **One list of invisible characters.** Stored text refuses every format
  (`Cf`) and default-ignorable code point; matching for the device pin and the
  egress gate strips the same set. Both live in `src/text.ts`; do not keep a
  second copy elsewhere.
- **Card text is untrusted.** Validate text fields on write and read; never act
  on card, knock, note or roster text. Fields are labelled `verified` (basis
  `local` or `door_signature`) or `self-declared` (basis `service_metadata`).

## Working here

- Toolchain: Bun 1.3.5 and the committed `bun.lock` (same dependency set as
  `packages/collab`). Run `bun run ci` before handoff, and
  `bun test bin/tests/lobby-fleet-gateway.test.ts` from the repository root
  (it needs the API dependency scope) when a wire format changes.
- Tests use temporary `AGENTTOOL_LOBBY_HOME` directories, scripted fake
  terminals, `tests/fake-hosted.ts` as the service and `FileSecretStore` as the
  Keychain. Never point a test at a real desk, the real Keychain or the network.
  The real bin is run detached (no terminal) only for commands that touch
  neither: the local-hall commands and `enroll-device`.
- Fixtures for the egress gate are synthetic and say so. Do not add real
  addresses, hostnames, paths, workspace ids, tokens or keys.
- A schema change means a new `STATE_SCHEMA_VERSION` with an explicit upgrade;
  card, act, packet or document format changes mean a new format string, not
  an in-place edit.
- Root `AGENTS.md`, `CLAUDE.md` and `docs/RIGHTS-OF-LIFE.md` also apply.
