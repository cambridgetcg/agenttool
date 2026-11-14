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
  `--no-install --no-env-file --config=/dev/null`, the current collab install's
  `agenttool-collab-host.js`, and exactly `--help` or `weather`. Children get
  `PATH=/usr/bin:/bin`, `HOME` and `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` only, so
  nothing is installed or cached into the home. Each child leads its own process
  group; at the time limit the group gets SIGTERM, then SIGKILL, and the runner
  stops reading, so the limit is a bound. Only `src/run.ts` signals a process. A
  new ask is a reviewed change to this list, and never one that takes a session,
  a journal or a network.
- **One file-system module, read-only.** Only `src/fs.ts` imports `node:fs`. It
  lstats, reads links, lists one directory, and opens files `O_RDONLY |
  O_NOFOLLOW | O_NONBLOCK`, the person's own blueprint file included. A blueprint
  is read only from a `.json` file outside `~/.local/share/agenttool` and
  `~/.local/state/agenttool`.
- **Fixed places, never a search.** Looks reach only the places README.md lists,
  lstat'ing every component from the home directory down; a link on the way is
  not followed. Never list the home directory or walk anything; the only listings
  are an install directory and `~/.local/bin` (filtered to `agenttool-*` first).
  A variable that moves a place makes what is there `unknown`; it is never
  followed.
- **No journal, database or key is opened.** The journal, cache and ledger are
  named only in `src/parts.ts`, and only as `lstat` targets. Nothing names
  `collab-sessions`, `backups`, the desk's `secrets`, the Keychain or the
  kingdom's keys.
- **Kinds, not identifiers; a leak is closed by reading less.** Every emitted
  field is a closed word, a validated name, a canonical time, a number or a
  boolean. A version named in a configuration is printed only when it is an
  installed version's directory; hook event and wrapper names only from closed
  lists; the weather's own sentences only when every word is the weather build's
  own. A switch value outside its set is `set to something else`. A parser's or
  command's message is never kept, and a refusal quotes nothing of a blueprint
  but a checked part id. The CLI's last check prints nothing if a line holds the
  home path, or the user or host name in a text that came from the device or the
  person. Privacy tests cover every output.
- **Unknown is not present; stale is only an inconsistency on this device.**
  Never call a part stale because a newer release might exist.
- **Described, not judged.** No score, percentage, fraction, grade or health in
  anything the house itself says.
- **Every change is the person's act.** A plan names a document in this
  repository or says that none exists; it never carries a command to paste.
  Every `see` path must exist, and its recipe must name the places its part
  looks (a test checks), or a house built from it would not be recognised.
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
  `tests/run.test.ts` and the bin's tests in `tests/cli.test.ts` run the real
  runner, file system and bin only inside fresh temporary directories, with
  made-up bundles.
- A new part is a row in `src/parts.ts` using existing looks, a reader in
  `src/survey.ts`, its `detail` keys in README.md, and privacy and state tests.
  A new look widens the boundary: it needs its own review, README row and
  boundary test.
- Root `AGENTS.md` and `CLAUDE.md` also apply.
