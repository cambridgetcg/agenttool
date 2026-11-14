# House package guide

> **Type:** guide
> **Purpose:** Keep the house survey's boundaries intact while changing it.
> **Evidence:** `src/`, `bin/` and `tests/` in this package; README.md is the contract. Nothing is released, installed or deployed.
> **Compass:** [README](README.md) · [Lobby doorbell guide](../lobby-doorbell/CLAUDE.md) (the boundary this copies)

This private package surveys an agent's AgentTool environment on one device,
describes it as a blueprint, and plans the difference against another blueprint.
It reads; it never builds. Every rule below has its reason in README.md.

## Non-negotiables

- **Nothing changes a device.** No `build` command, no install step, no file
  written anywhere: output is one JSON line on stdout. No write API appears in
  any source file; `tests/boundary.test.ts` holds that.
- **No network.** No fetch, socket, listener or HTTP module, and no ask that
  takes a network. `timewitness` and the doorbell's netcheck are looked at,
  never run.
- **One process module, no shell.** Only `src/run.ts` starts a process (never
  `Bun.$`), and only after `assertAllowedArgv`: this process's Bun with
  `--no-env-file --config=/dev/null`, the current collab install's
  `agenttool-collab-host.js`, and exactly `--help` or `weather`. Children get
  `PATH=/usr/bin:/bin` and `HOME` only. A new ask is a reviewed change to this
  list, and never one that takes a session, a journal or a network.
- **One file-system module, read-only.** Only `src/fs.ts` imports `node:fs`. It
  lstats, reads links, lists one directory, and opens files `O_RDONLY |
  O_NOFOLLOW | O_NONBLOCK` (the person's own blueprint file without
  `O_NOFOLLOW`).
- **Fixed places, never a search.** Looks reach only the places README.md lists.
  Never list the home directory or walk anything; the only listings are an
  install directory and `~/.local/bin` (filtered to `agenttool-*` first).
- **No journal, database or key is opened.** The journal, cache and ledger are
  named only in `src/parts.ts`, and only as `lstat` targets. Nothing names
  `collab-sessions`, `backups`, the desk's `secrets`, the Keychain or the
  kingdom's keys.
- **Kinds, not identifiers.** Every emitted field is a closed word, a validated
  name, a canonical time, a number or a boolean, except the weather's own
  sentences, which pass `looksIdentifying` or are withheld whole. A switch value
  outside its set is `set to something else`. A parser's or command's message is
  never kept. The CLI's last check prints nothing if a line holds the home path,
  the user name or the host name. Privacy tests cover every output.
- **Unknown is not present; stale is only an inconsistency on this device.**
  Never call a part stale because a newer release might exist.
- **Described, not judged.** No score, percentage, fraction, grade or health in
  anything the house itself says.
- **Every change is the person's act.** A plan names a document in this
  repository or says that none exists; it never carries a command to paste.
  Every `see` path must exist (a test checks).
- **Collab and the lobby stay behind their commands.** Never import
  `packages/collab`, `packages/lobby`, `api/` or `docs/`.
- **Only `bin/` reads the environment, the clock and the machine's names**;
  library code takes them as values, so tests are hermetic.

## Working here

- Toolchain: Bun 1.3.5 and the committed `bun.lock` (dev dependencies only).
  Run `bun run ci` before handoff: typecheck and the hermetic tests.
- Tests use `tests/helpers.ts`: an in-memory file system, a scripted runner, a
  fixed environment and clock, and made-up names, addresses and secrets. No test
  looks at the machine it runs on or runs a real survey command.
- A new part is a row in `src/parts.ts` using existing looks, a reader in
  `src/survey.ts`, its `detail` keys in README.md, and privacy and state tests.
  A new look widens the boundary: it needs its own review, README row and
  boundary test.
- Root `AGENTS.md` and `CLAUDE.md` also apply.
