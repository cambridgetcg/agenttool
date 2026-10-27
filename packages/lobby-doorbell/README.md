# Lobby doorbell: netcheck

> **Type:** reference
> **Purpose:** Describe `agenttool-lobby-doorbell netcheck` (alias `lobby-netcheck`), a read-only per-device health check for the lobby desk, and the boundaries the later doorbell parts inherit.
> **Evidence:** Source and hermetic tests in this package (`bun run ci`: a fake lobby CLI, a fake fetch and a fake Mullvad; never the network, a real desk or the Keychain), plus `bun run contract`, which checks the lobby source this package parses. Nothing here is released, installed, registered with a host or deployed.
> **Compass:** [Lobby desk](../lobby/README.md) (the CLI netcheck reads) · [Lobby guide](../lobby/CLAUDE.md) · [Collaboration missions](../../docs/COLLABORATION-MISSIONS.md) (grants and seasons)
> **Implements:** Build 1, PR 1 of the 2026-10-27 lobby doorbell spec: netcheck only. The fetcher, bells, listeners, ringers, `stop`/`resume` and harness hooks are later PRs. The spec is kept outside this repository; this README restates what is built.
> **Code:** `src/{netcheck,health,lobby-cli,probes,run,home,cli,errors}.ts` · `bin/agenttool-lobby-doorbell.ts` · `contract/{lobby-contract,check}.ts`
> **Tests:** `tests/{netcheck,lobby-cli,contract,boundary}.test.ts` with `tests/helpers.ts` and `tests/fixtures/fake-lobby.ts`

`@agenttool/lobby-doorbell` is a private Bun 1.3.5 package (`"private": true`, no
release lane, no runtime dependencies). PR 1 ships one command:

```sh
agenttool-lobby-doorbell netcheck [--json] [--room ROOM]... [--lobby-entry PATH]
lobby-netcheck [--json] [--room ROOM]...        # the same command
```

## States and exit codes

Netcheck prints exactly one overall state, then every warning, then every axis.
The state is chosen worst first:

| State | Exit | When |
|---|---|---|
| `hosted-unreachable` | 5 | `GET /health` failed, timed out, or did not answer `200 {service:"agenttool", status:"alive"}` |
| `grant-lapsed` | 4 | the directory grant, or a season grant for a room that is listened to, asked for with `--room`, or whose season is still open, is expired, never accepted or missing |
| `lan-blocked` | 6 | Mullvad's `lan` setting is `block` |
| `unknown` | 7 | any axis could not be read: no desk, an unreadable Mullvad answer, a missing or unsafe lobby CLI, an origin mismatch, an unknown lobby refusal, a CLI that failed or printed an unexpected shape |
| `hosted-ok` | 0 | none of the above |

Usage errors exit 2. **Unknown is never healthy and never exits 0.** `--json`
prints `agenttool-lobby-netcheck/v1` with `state`, `healthy`, `exit_code`,
`warnings`, `unknown` (the axes that are unknown, as `axis:code`) and `checks`.

**Warnings** do not change the state: `clock_skew` (above 5 s; `severe` above
30 s, since packets dated 60 s ahead are refused), `grant_expiring` (under 2 h),
`season_ending` (under 24 h), `directory_ending` (under 7 days, hub only),
`cache_stale` (over 1 h on a listened room), `stop_present`,
`fetcher_absent_with_listener` and `launch_context_not_exempt`.

## What it checks

1. **Lobby CLI.** The pinned entry (default
   `~/.kingdom/tools/agenttool-lobby/bin/agenttool-lobby.ts`) must resolve to a
   regular file owned by you, and neither it nor its directory may be writable by
   group or others. The install receipt's commit is reported when present.
2. **Desk.** `fleet status --json`. The desk's origin must equal the pinned
   origin `https://api.agenttool.dev`.
3. **Hosted.** One credential-free `GET https://api.agenttool.dev/health`: only an
   `Accept` header, no body, `redirect: "error"`, 5 s, at most 64 KiB read, no
   retry. Latency, the build revision and clock skew (the `Date` header minus the
   request's midpoint; about +-1 s plus half the round trip) come from it.
4. **Grants.** The directory grant and each season grant from `fleet status`,
   with countdowns. A grant counts only in the room's current season.
5. **Seasons.** `fleet card <room> --json`: only the door-signed status and the
   season's end are kept.
6. **Directory.** `hub show --json` on the hub. On a member desk the directory's
   end is not known there; netcheck says so and reports only that it outlasts
   the directory grant.
7. **Cache age.** `room read <room> --cached --json --limit 1 --after
   9223372036854775807`: no network request, and no message can come back
   (cursors compare as integers), so only `synced_at` is new.
8. **lan.** `/usr/local/bin/mullvad lan get`, else `/opt/homebrew/bin/mullvad`,
   3 s. No Mullvad is reported as `not_installed` and counts as allow. Until
   devices join without AirDrop, `block` matters: it has silently broken AirDrop
   and reaching the router before.
9. **Launch context**, from environment variables and reported as evidence, not
   proof: `SSH_CONNECTION` (ssh), `TERM_PROGRAM` `Apple_Terminal`/`iTerm.app`
   (terminal), `CLAUDECODE=1` and `CODEX_THREAD_ID` (harness add-ons),
   `XPC_SERVICE_NAME` not `0` and not `application.*` (launchd; not verified
   inside a real launchd agent). It never changes the state; launchd warns.
10. **Doorbell.** The device brake `<lobby home>/STOP` (present or not; netcheck
    only reports it), and, once later PRs create them, the doorbell home's
    fetcher pidfile (checked against `ps -o lstart=`), listener files and bell
    states.

Rooms checked are those asked for with `--room`, those with a listener, and those
with a season grant, at most 20 per run.

## Homes

The **lobby home** is resolved exactly as `packages/lobby/src/home.ts` does:
`AGENTTOOL_LOBBY_HOME` (absolute) wins, else
`${XDG_STATE_HOME:-~/.local/state}/agenttool/lobby`. Netcheck passes the result
to every child as `AGENTTOOL_LOBBY_HOME`, so a child never re-resolves it from an
environment it does not see. Every lobby command opens, and so would create, the
desk state. Netcheck therefore starts no lobby command when the lobby home is
missing or holds only `STOP`. Inside the lobby home it names only `STOP`, and
only with `lstat`.

The **doorbell home** is `${XDG_STATE_HOME:-~/.local/state}/agenttool/lobby-doorbell`;
`--home` or `AGENTTOOL_LOBBY_DOORBELL_HOME` override it in tests. It is never
inside the lobby home. Netcheck never creates it. When it already exists (0700),
netcheck appends one line to its `log.jsonl` with the state and codes only. A
variable spelt `AGENTOOL_LOBBY…` (one T) is refused.

## Boundaries

- Talks to the lobby only through the pinned CLI, as a child process with a
  fixed argv from a closed allowlist (`fleet status`, `fleet card`, `hub show`,
  the cached `room read` above), no shell, and an environment of `HOME`,
  `PATH=/usr/bin:/bin`, `LANG` and `AGENTTOOL_LOBBY_HOME` only, so proxy,
  TLS-override, `BUN_OPTIONS` and `NODE_OPTIONS` variables never reach it. Only
  the first stderr line is read, and only its refusal code is kept.
- Never imports `packages/lobby`, reads Keychain items, reads `<lobby home>/secrets`
  or opens the lobby database. It never runs `room sync` or any command that
  changes state.
- Keeps no text: every field it prints or logs is a validated id, a canonical
  time, a number or a closed code. Display names, card titles and purposes,
  roster entries and table talk are dropped at parse time; canary tests check it.
- Opens no listening socket, and its only network request is the one
  `GET /health`.

## Contract with the lobby

`contract/lobby-contract.ts` pins, as text patterns and key names (never line
numbers), the lobby source netcheck relies on: the origin constant, the home
resolution, the refusal line format and exit codes, the `fleet status`, `fleet
card`, `hub show` and table-read JSON keys, the cursor grammar and the BigInt
cursor compare. Additive changes pass; a renamed key or moved format fails.

```sh
bun run contract                                            # against ../lobby/src (part of bun run ci)
bun run contract -- --lobby-src ~/.kingdom/tools/agenttool-lobby/src   # against an installed lobby
```

## Install (per device; needs Yu's word)

Mirrors the lobby's own install. The archive holds this package alone, so run
the contract against the installed lobby rather than `bun run ci`:

```sh
git -C CHECKOUT archive <commit>:packages/lobby-doorbell | tar -x -C ~/.kingdom/tools/agenttool-lobby-doorbell-<c8>
cd ~/.kingdom/tools/agenttool-lobby-doorbell-<c8> && bun install --frozen-lockfile
bun run typecheck && bun run test && bun run contract -- --lobby-src ~/.kingdom/tools/agenttool-lobby/src
ln -sfn agenttool-lobby-doorbell-<c8> ~/.kingdom/tools/agenttool-lobby-doorbell
```

A wrapper in `~/.local/bin` runs it with `env -i` and an explicit allowlist. For
netcheck that is `HOME`, `PATH`, `LANG`, `XDG_STATE_HOME`, `AGENTTOOL_LOBBY_HOME`
and the launch-context evidence (`SSH_CONNECTION`, `TERM_PROGRAM`,
`XPC_SERVICE_NAME`, `CLAUDECODE`, `CODEX_THREAD_ID`); without the evidence the
context reads `unknown`. A `lobby-netcheck` link to the wrapper runs netcheck when
the wrapper adds `case "${0##*/}" in lobby-netcheck) set -- netcheck "$@";; esac`.
Record the commit, the test count and the lobby commit checked in an
`INSTALL-RECEIPT.json`. Rollback: re-point or trash the link; the doorbell home
holds no secrets and no text.

## Limits

- `fleet status --json` does not show whether this desk left a grant, so a grant
  it left still reads as live until it expires.
- In a lobby home that holds files but no database, the lobby CLI creates its
  empty database when netcheck runs, as any lobby command would. A desk at an
  older schema is upgraded by the lobby's own open, also as any command would.
- Clock skew is about +-1 s plus half the round trip; it replaces `sntp`.
- Not verified: `XPC_SERVICE_NAME` inside a launchd agent, and whether
  `mullvad lan get` output changes in later Mullvad releases (an unreadable
  answer is `unknown`).
