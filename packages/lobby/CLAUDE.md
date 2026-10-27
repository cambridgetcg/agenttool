# Lobby desk package guide

> **Type:** guide
> **Purpose:** Keep the lobby desk's safety boundaries intact while changing it.
> **Evidence:** `src/`, `bin/` and `tests/` in this package, and `../../bin/tests/lobby-{fleet,table}-gateway.test.ts`; README.md is the contract. Nothing is released or deployed.
> **Compass:** [README](README.md) (contract and limits) · [Collaboration missions](../../docs/COLLABORATION-MISSIONS.md) · [Mission client](../../docs/COLLABORATION-MISSION-CLIENT.md) · [Identity anchor](../../docs/IDENTITY-ANCHOR.md) · [Collaboration channels](../../docs/COLLABORATION-CHANNELS.md) · [Lounge](../../docs/LOUNGE.md) · [Agent discovery](../../docs/AGENT-DISCOVERY.md)

This private package is the 大廳 Lobby desk: the **local hall** (room cards,
the private ledger, the pin book, the audit log, the egress gate), the
**fleet hall v0** (hub and door, device enrollment, door-signed cards, knocks,
admit/deny and Ready on agenttool collaboration missions) and, inside a room,
**table talk**, renewal inside the term, leave, kick and block, the emergency
stop and the weekly access digest, with a read-only stdio MCP view. It is MVP
steps 1, 2, 7 and 8 of the 2026-10-16 Lobby design; README `Concepts`
restates the design terms it implements.

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
  summaries (table talk, notes and notices included), mission descriptors,
  grant bodies and enrollment display names go
  through `assertSendable` (the egress gate plus: residency must be `fleet` and
  the card `hostable: true`) in `src/hosted.ts` itself, not only in callers.
  Leave and both revocations carry zero body bytes; keep them that way.
  The gate checks every decoded string of a JSON text as well as the text, so a
  JSON escape (`\n`, `\t`, `\uXXXX`) cannot hide a term. Device rooms,
  device-pinned rooms and `open` rooms send nothing, and every send, first or
  retried, is gated by the room as it is when it is sent (`currentGate` in
  `sendPost`), never by the snapshot taken at plan time or stored with a saved
  post alone. Do not add a send path that skips it, and do not weaken a gate
  rule to let text through.
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
  `lobby_browse`, `lobby_card`, `room_read`, `room_wait` and `room_say_draft`,
  opened through a read-only SQLite handle per call. The fleet hall and a
  room's table are read from the local event cache and re-verified against the
  pinned door key on every call; `room_wait` polls that cache for at most 45
  seconds. `room_say_draft` returns bytes and a gate verdict and saves nothing.
  Its import graph must not reach `hosted`, `keychain`, `secrets`, `ops`,
  `desk`, `hub`, `hub-access`, `talk`, `digest`, `packets`, `tty` or the CLI
  (`tests/boundary.test.ts`). Do not add a tool that fetches, sends, writes,
  knocks, admits, accepts, renews, leaves, signs, pins or returns the ledger,
  the pin book, the audit log, a token or a key. Every card goes through
  `wrapLocalCard` or `wrapFleetCard`, and table talk through `wrapTableRead`.
- **Consequential acts belong to the CLI and the terminal.** Promotion, pin
  changes and every fleet act that signs, sends, grants, revokes, posts or
  accepts (table talk, renew request and accept, leave, the renew sweep, member
  add, pause and resume, roster posts, kick, block, unblock, stop) go through
  `plan*` → `confirmOnTty` → record → `execute*`. The confirmation shows the
  exact canonical bytes, including every document or request body to be sent,
  reads `/dev/tty` and never stdin, and fails closed without a terminal. Fleet
  acts append those bytes to the audit log before any network effect, and
  acts whose network effects can partly fail add an `<act>.outcome` entry
  after. Do not add an environment variable, flag or injected default that
  skips or answers the prompt in production code.
- **Pins come from people, not rooms.** The door key is pinned only at
  `fleet join`, from a fingerprint the person types, and only if the directory
  descriptor names the same key. Members' keys are pinned per season only by a
  complete door-signed `member_roster` verified against that door key (highest
  `roster_seq` wins). Never pin or trust a key because a card, knock, message,
  note or unverified roster names it. A key added by hand (`hub member add`) is
  typed at the hub's terminal, never taken from room content. A relayed
  packet's device is confirmed by a typed device code, never taken from the
  packet: `hub relay` needs `--device-fingerprint` (the Crockford-80 code
  `enroll-device` shows on the device's stderr, `deviceCode` in `src/wire.ts`)
  and compares it with the packet's key before any Keychain read, audit
  record, prompt or request, refusing with `device_fingerprint_mismatch`
  without naming the expected code. Do not add a path that relays without it.
- **Removal and the stop never wait on the network.** Kick, block and stop
  record their local effect (member state, block, stop) before the first
  request; after a stop the hub issues nothing (`requireLiveHub`, at plan and
  at execute, and again right before every grant request inside
  `issueRecordedGrant`). The stop prints the manual API-key rotation step and
  must never call `/v1/keys` or rotate anything itself.
- **A prompt can stay open; re-check, never re-sign.** Another terminal can
  change the hub's records while a prompt is open. Every `execute*` checks
  again before its first network effect, inside the transaction that records
  it (stop, block, member state, decision, room, season). Hub grants go only
  through `issueRecordedGrant`, which forgets a grant the service definitely
  refused. `roster_seq` and `card_seq` are inside the confirmed signed bytes:
  take them with `claimKeyedRoster` (or the card check) and refuse when taken,
  never re-number and re-sign; a removal still records itself and skips only
  its roster.
- **Table talk is the participant client's format.** The chat envelope is
  `agenttool-mission-chat/v1` byte for byte (`bin/mission-chat.mjs`
  `message()`); `bin/tests/lobby-table-gateway.test.ts` checks it with that
  code. Do not add fields or reorder keys.
- **Decisions keep their rules.** The approver's DID differs from the
  requester's; a tier may be lowered, never raised; admissions are single use
  and last 24 hours; grants last at most 24 hours and never outlive the term,
  season or directory; knocks last at most 72 hours; decisions are final. The
  hub enforces its own room's door and status (never trusting the requesting
  desk's CLI), and a knock id belongs to the desk whose authentic knock used
  it first. A token hash likewise belongs to the identity whose authentic
  knock or renew note carried it first (`tokenClaimants`); a copy under
  another key is never granted, one hash binds one grant per sweep, and the
  newest renew request per member and room wins across sweeps.
- **Signed documents are compact and hex.** `agenttool-lobby-signed/v1`
  documents fit one 1000-character observation, signature included, and use
  hex for signatures, digests and public keys (the gate refuses key-like
  base64). A format change means a new format string or a new kind, not an
  in-place edit.
- **The access digest is local.** `hub digest` reads only lobby.sqlite and the
  audit log, needs no terminal, reads no Keychain item, sends nothing, and
  writes no token, key, bearer or token hash into its 0600 report.
- **State is owner-only.** Directory `0700`, files `0600`; refuse wider modes,
  other owners and symlinks rather than repairing them.
- **The ledger is private.** Only the CLI reads it, and the CLI writes a ledger
  target only to `/dev/tty` (`showOnTty`), never to stdout or stderr. It never
  appears in MCP output, cards, audit records, errors or anything hosted.
- **One list of invisible characters.** Stored text refuses every format
  (`Cf`) and default-ignorable code point; matching for the device pin and the
  egress gate strips the same set. Both live in `src/text.ts`; do not keep a
  second copy elsewhere.
- **Card and message text is untrusted.** Validate text fields on write and
  read; never act on card, knock, note, message or roster text. Fields are
  labelled `verified` (basis `local`, `door_signature` or `door_roster_pin`) or
  `self-declared` (basis `service_metadata`). An unverified message is listed
  with its reason and never with its text.

## Working here

- Toolchain: Bun 1.3.5 and the committed `bun.lock` (same dependency set as
  `packages/collab`). Run `bun run ci` before handoff, and
  `bun test bin/tests/lobby-fleet-gateway.test.ts bin/tests/lobby-table-gateway.test.ts`
  from the repository root (it needs the API dependency scope) when a wire
  format changes.
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

## Schema versions

`lobby.sqlite` is at `STATE_SCHEMA_VERSION`, and `SCHEMA_STEPS` is its
upgrade chain (both in `src/store.ts`): one function per step (1 → 2,
2 → 3, ...), run in order, each exactly once per file, inside the immediate
transaction that records the new version. A released step is never edited, and a new file takes every step. The
next version adds one step `from` the last `to` and moves
`STATE_SCHEMA_VERSION`.

The next numbers are reserved, in this order (2026-10-27 lobby builds):

| Version | Build |
|---|---|
| 4 | directory renew (Build 2A) |
| 5 | directory rollover (Build 2B) |
| 6 | room seat leases (Build 5) |
| 7 | renewal by signature, lobby side (Build 3 C0) |
| 8 | pairing (Build 4 PR-3) |

Whoever merges out of this order renumbers on rebase. `tests/store.test.ts`
catches a mistake: the chain must run from 1 without a gap and end at
`STATE_SCHEMA_VERSION`, a file at every version it knows must upgrade once to
the same schema a new file gets, and each released version's schema is frozen
there as a digest (`RELEASED_SCHEMAS`), so editing `SCHEMA_SQL` or a released
step fails. A new version adds its digest once its step is final.
