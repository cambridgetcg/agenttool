# House: survey, blueprint and plan of an agent's environment

> **Type:** reference
> **Purpose:** Describe `agenttool-house`, a read-only survey of the AgentTool environment on one device, a blueprint of it as data, and a plan that compares the two.
> **Evidence:** Source and hermetic tests in this package (`bun run ci`: an in-memory file system, a scripted runner, a fixed environment and clock; no test looks at the machine it runs on). Nothing here is released, installed, registered with a host or deployed.
> **Compass:** [Lobby doorbell](../lobby-doorbell/README.md) (the boundary this package copies) · [Collab](../collab/README.md) · [Lobby desk](../lobby/README.md) · [Execution seat](../execution-seat/README.md)
> **Code:** `src/{shapes,fs,run,places,privacy,looks,parts,survey,blueprint,plan,cli,errors}.ts` · `bin/agenttool-house.ts`
> **Tests:** `tests/{looks,privacy,survey,plan,cli,run,boundary}.test.ts` with `tests/helpers.ts`

`@agenttool/house` is a private Bun 1.3.5 package (`"private": true`, version
`0.1.0-dev.0`, no release lane, no runtime dependencies).

An agent that arrives on a device cannot easily tell what its environment there
is made of: which AgentTool tools are installed and at which commit, which agent
hosts are pointed at them, which switches are on, how old its picture of the
owner's other devices is. A **house** is the set of parts an agent's environment
on one device is made of. This package does three read-only things:

- **survey**: look at this device and say what is here, what is missing, and
  what could not be told;
- **blueprint**: describe a house as data, written by hand or taken from a survey
  ("this house, as it stands");
- **plan**: compare a survey with a blueprint and list what would have to change,
  whose act each change is, and which document says how.

It builds nothing. Building stays where it is: reviewed scripts and runbooks, run
on the person's word.

```sh
agenttool-house survey
agenttool-house blueprint --from-survey [--name <text>]
agenttool-house plan --blueprint <path>
agenttool-house --help
```

Each command prints one JSON line on stdout and writes no file. Exit codes: 0 on
success (a survey with unknown parts is still a success), 2 on a usage error, 3
when a blueprint is refused, 1 when this build could not finish. From a checkout:
`bun --no-install --no-env-file --config=/dev/null packages/house/bin/agenttool-house.ts survey`.
The flags keep the working directory's `.env` and `bunfig.toml` (and any preload it
names) out of the survey's process, and Bun's auto-install off; the bin's first
line gives Bun the same flags when it is run directly.

## Principles, with their reasons

1. **Look, do not touch.** The survey lstats, reads a symlink, reads two named
   lines of an install's `SOURCE.txt`, reads named keys of an agent host's
   configuration, and runs the collab host's `--help` and `weather`. It never
   opens a journal, a database or a key, and writes nothing. A survey that could
   break or leak what it measures could not be run freely by any agent that
   arrives.
2. **Fixed places, never a search.** It looks only where AgentTool's own installs
   put things, and never walks the home directory. The home directory holds the
   person's life, and a tool that searches it will one day print some of it.
3. **Kinds, not identifiers.** The home directory is shown as `~`; no user name,
   host name, address or serial appears; no environment value appears except the
   closed-set switches below; a hook's or wrapper's text is never shown, only the
   install it names. A survey goes into a model's context and often a transcript.
4. **Unknown is not present.** Every part that could not be looked at is
   `unknown`, with the reason. `stale` means only an inconsistency visible on this
   device: an entry, hook or wrapper that names an install other than the current
   one. It never means "a newer release exists"; that cannot be known without a
   network, and the survey uses none.
5. **A reading about now.** A survey carries `surveyed_at` and
   `good_for_seconds` (300), is self-declared, and authorises nothing. A plan is a
   reading too.
6. **Described, not judged.** No score, percentage, grade or health. A house with
   three parts is not worse than one with nine.
7. **Every change is the person's act.** A plan names what would change and the
   document in this repository that says how, or says plainly that none exists
   yet. It never generates commands to paste, because generated commands invite
   running them, and installing changes the person's configuration on their
   device.

## Looks

A look is the closed vocabulary of what the survey may do; it is both the
extension point and the boundary. Each part's row in `src/parts.ts` declares its
looks, and its reader is handed those looks and no others.

| Look | What it does | What it may emit |
|---|---|---|
| `path` | `lstat` a fixed path under an allowed root (every component from the home directory down, so a link at `~/.local` or `~/.local/share` is seen; a link on the way is not followed), or one of a closed list of system paths | exists, type, age in seconds from mtime by this device's clock |
| `link` | read an install directory's `current` link (resolved by its text within that directory, never followed), list the version directories beside it (a directory holding `SOURCE.txt`; the first 32 by name), and tell by `lstat` whether one named version directory is installed | the version directories' names; the current one's name |
| `source` | read the current install's `SOURCE.txt` (a regular file, opened without following a link, at most 8 KiB) | its `commit:` hash and the UTC time at the start of its `installed:` line; nothing else of either line or the file |
| `entry` | read one named server entry of an agent host's configuration | whether it exists; which AgentTool install its command and arguments name (by name only when that version is installed here), and whether that is the current one; the closed-set switches, and whether a switch's two spellings disagree; nothing else |
| `hook` | read Claude Code's hook settings | for each event, whether a hook names an AgentTool install, which, and whether it is current; an event's name only when it is one of Claude Code's hook events (others are `null`); never a command or matcher |
| `wrapper` | list `~/.local/bin`, keep `agenttool-*` names, and read the first 4 KiB of each (a link is not followed) | each wrapper's name when it is one of AgentTool's own commands (otherwise `null`) and the AgentTool install it names; never its text |
| `ask` | run the current collab host's `--help`, and `weather` when the help lists it, with a fixed argv, a time limit, a fixed small environment and output capped at 64 KiB | from `--help`, whether `weather` exists; from `weather`, its `says` and `notes` (only when every word is the weather build's own), the two wake times and whether a battery shows |
| `env` | read the process environment in closed form | booleans only: CI, SSH, a container, whether a command directory is on `PATH`, and whether a variable moves a place the survey looks at |

**Allowed places.** Under the home directory: `~/.local/share/agenttool`,
`~/.local/state/agenttool`, and `~/.local/bin` (`agenttool-*` wrappers and two
named commands, `timewitness` and `lobby-netcheck`). Host configuration, named
files and named keys only: Claude Code's `~/.claude.json`
(`mcpServers.agenttool-collab` and `mcpServers.agenttool-lobby`: `command`,
`args`, and the switches in `env`), its `~/.claude/settings.json` (`hooks`), and
Codex's `~/.codex/config.toml` (`mcp_servers.<name>` the same way). Every
component from the home directory down is `lstat`'ed first, and a link on the
way (`~/.local`, `~/.claude`, `~/.codex`, ...) is not followed: what lies behind
it is `unknown`. A configuration file that is a link, larger than 8 MiB, or that
this build's reader cannot parse is `unknown`; a parser's message is never kept,
because it can quote the file. (Bun 1.3.5's TOML reader refuses some valid TOML,
such as an unquoted datetime; the reason says so rather than calling the file
broken.) Outside the home directory: `timewitness` in `/opt/homebrew/bin` and
`/usr/local/bin`, and on Linux the container markers `/.dockerenv` and
`/run/.containerenv`, by `lstat` only.

**Variables that move these places** are not followed: the places are fixed. But
when one is set in this process's environment to anywhere other than its
default, the default place is not read as if it were the one in use. What it
would show is `unknown`, and the variable is named, never its value:
`CLAUDE_CONFIG_DIR` (Claude Code's doors and hooks), `CODEX_HOME` (Codex's
doors), `XDG_DATA_HOME` and `AGENTOOL_COLLAB_DB` (the collab journal),
`AGENTTOOL_LOBBY_HOME` and `XDG_STATE_HOME` (the lobby cache), and
`AGENTTOOL_EXECUTION_SEAT_HOME` and `XDG_STATE_HOME` (the seat ledger). A room
whose state file is moved keeps its install's state, with the file's `exists`
and `age_seconds` `null`.

**Closed-set switches**, reported by value only when the value is in the set,
otherwise as `set to something else`: `AGENTOOL_COLLAB_TOOLS` (`full`, `notes`),
`AGENTOOL_COLLAB_CONSENT_RULE` (`consent/v1`, `consent/v2`),
`AGENTOOL_COLLAB_WEATHER` (`on`, `off`), and the same three spelt `AGENTTOOL_`.
Each is reported under the spelling found. Collab reads the two spellings as one
switch, an empty value as unset, and refuses to start when the two are set to
different values; the survey reads them the same way. An empty value is not
reported, and a door whose entry sets the two spellings of a switch to different
values is `unknown`, with that reason.

**The ask.** The child is this process's own Bun, run as
`bun --no-install --no-env-file --config=/dev/null <~/.local/share/agenttool/collab/<current>/agenttool-collab-host.js> --help`
(or `weather`), with `PATH=/usr/bin:/bin`, `HOME` and
`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` only, `cwd` `/`, no stdin and no shell;
standard error is drained and dropped. With `--no-install`, a bare import in a
bundle neither asks a package registry nor writes a package cache into the home,
and with the transpiler cache off, a bundle without Bun's own mark writes nothing
there either. `src/run.ts` refuses any other argv before anything starts. The bundle is
run only when it and its directory belong to this user and are writable by no one
else. The child leads its own process group. At the time limit the group is sent
SIGTERM, then SIGKILL after half a second, and the runner stops reading whether
or not anything still holds its output, so a child that ignores SIGTERM, or
leaves something behind that holds the pipe, cannot hold the survey past the
limit and two graces. A slow, flooding, failing, two-line or non-JSON answer is
`unknown` with that reason.

**The weather's sentences** are kept only when every word in them is one of the
words the weather build's own templates use (a closed vocabulary, taken from
`packages/collab/src/weather.ts` in that build), or a number, a percentage or a
UTC time, and nothing in them looks identifying (the home path, the user or host
name, an address, an email, a token shape). Otherwise none of them is kept and the
part is `unknown`; the wake times still come through.

**The last check.** The CLI prints nothing, and exits 1, when a line holds the
home path or a `/Users/` or `/home/` path anywhere, or the user or host name (two
characters or more, as a whole word, either case) in the texts that come from the
device or the person: version directory names, the weather's sentences, a
blueprint's name, and a refused part's id. The house's own fixed sentences are
not compared, because they are the same on every device: an account called
`claude`, `codex` or `house` can be surveyed.

## Parts in this build

| Part | Kind | Looks | `detail` keys |
|---|---|---|---|
| `ground.weather` | ground | link, path, ask | `says`, `notes` (when present). A build without `weather` is `missing` with that reason. |
| `room.collab` | room | link, source, path, env | `versions` (the first 32 by name), `more_versions: true` when there are more, `current`, `commit`, `installed`, `journal` (`exists`, `age_seconds`; the newer of `collab.sqlite` and its write-ahead log) |
| `room.lobby` | room | link, source, path, env | the same, with `cache` for `~/.local/state/agenttool/lobby/lobby.sqlite`: the age of this device's picture of the owner's other devices, by file time on this device's own clock. Any write updates the file, so the picture is at least that old. |
| `room.execution-seat` | room | link, source, path, env | the same, with `ledger` for `~/.local/state/agenttool/execution-seat/seats.sqlite` |
| `door.claude-code.collab`, `door.claude-code.lobby`, `door.codex.collab`, `door.codex.lobby` | door | entry, link, env | `entry`, `names_install`, `version` (`current`, an installed version's name, or `null` when the entry names a directory that is not installed here), `names_current`, `switches` |
| `hand.claude-code.hooks` | hand | hook, link, env | `events`: `event` (`null` for a name that is not one of Claude Code's hook events), `names_install`, `installs` (`tool`, `version` as for a door, `names_current`) |
| `hand.wrappers` | hand | wrapper, link | `wrappers`: `name` (`null` for a name that is not one of AgentTool's own commands), `entry`, `names_install`, `installs`; `more_wrappers: true` past 32. `unknown` when no wrapper could be read (all links, which are not followed). |
| `clock.witness` | clock | path, env | `found_in`, `entry`, `on_process_path`, `run_by_survey: false`. The survey never runs `timewitness`: it contacts time servers. Running it gives a tied clock. A `timewitness` that is a link is not followed, so it is `unknown` unless a regular file is found in a later directory. |
| `clock.netcheck` | clock | path, link | `found` (regular files and an install with a current link), `current`, `run_by_survey: false`. Not run, for the same reason. A link (not followed), or doorbell versions with no current link, is `unknown`. |
| `clock.wake` | clock | link, path, ask | `awake_since`, `last_slept_at`, from the weather reading |

`place` is not a part: it sits at the top of the survey and holds one platform
word and booleans: `has_battery` (from the weather reading; `null` without one),
`container` (`false` on macOS; on Linux `true` when a marker or the `container`
variable is present, otherwise `null`, because no marker does not prove no
container), `ci` (`CI` or `GITHUB_ACTIONS`) and `over_ssh` (`SSH_CONNECTION`,
`SSH_CLIENT` or `SSH_TTY`).

A missing part also carries a `why`. A door whose entry runs something outside
AgentTool's installs (a checkout's `dist`, for example) is `unknown`: which build
it runs cannot be told from here. A reference to another directory in an install
area that is not an install (the collab doorbell's state, for example) is ignored.

## Shapes

```ts
interface HouseSurvey {
  protocol: "agenttool.house-survey/1";
  surveyed_at: string; good_for_seconds: number;   // 300
  basis: string; authorises: string;               // fixed sentences
  place: { platform: string; has_battery: boolean | null; container: boolean | null; ci: boolean; over_ssh: boolean };
  says: string;                                    // one plain line: what is here, what is missing, what could not be told
  parts: Array<{
    id: string; kind: "ground" | "clock" | "room" | "door" | "hand"; for: string;
    state: "present" | "missing" | "stale" | "unknown";
    detail: Record<string, unknown>;               // closed per part (above)
    how: string;                                   // what was looked at, in words
    why?: string;                                  // given when unknown, stale or missing
  }>;
}
interface HouseBlueprint {
  protocol: "agenttool.house-blueprint/1";
  name: string;
  parts: Array<{ id: string; commit?: string; switches?: Record<string, string> }>;
}
interface HousePlan {
  protocol: "agenttool.house-plan/1";
  planned_at: string; good_for_seconds: number; basis: string; authorises: string;
  says: string;
  steps: Array<{
    id: string;
    is: "as_wanted" | "to_build" | "to_repoint" | "to_switch" | "cannot_tell";
    because: string;
    whose_act: "the person";
    see: string | null;                            // a document in this repository; null when none exists yet, said in `because`
  }>;
}
```

**Blueprint.** `blueprint --from-survey` keeps the present parts, with a room's
commit and a door's switches whose values are in their sets (`set to something
else` cannot be built from, so it is not carried; a switch set under both
spellings is carried once). Only rooms take a `commit` (7 to 40 lowercase hex
characters) and only collab doors take `switches`. A blueprint is a closed
schema: an unknown part is refused; so are an unknown key, a duplicate part, a
bad commit, an unknown switch, both spellings of one switch, or a value outside
its set. A refusal quotes nothing of the file except an unknown part's id, which
it names only when the id is shaped like one of this build's (`room.`, `door.`,
`hand.`, `clock.` or `ground.` and plain words) and looks like nothing
identifying; otherwise it says the id is not shown. `plan --blueprint` reads only
a file whose name ends in `.json`, never one under `~/.local/share/agenttool` or
`~/.local/state/agenttool` (where journals and keys are kept), and never through
a final link.

**Plan.** For each part the blueprint names, in its order: `unknown` plans
`cannot_tell`; `missing` plans `to_build`; `stale` plans `to_repoint`; a present
room whose `SOURCE.txt` names no commit, when the blueprint wants one, plans
`cannot_tell`; a present room at another commit plans `to_build`; a present door
whose switches differ plans `to_switch`; anything else is `as_wanted`. A switch is
compared as collab reads it, under either spelling: the same value under the
other spelling is as wanted, and a `to_switch` step names the spelling set in the
entry, so changing it does not add a conflicting one. A switch the blueprint does
not name is not compared. Every step's act is the person's. A step names a
document only where this repository has one whose recipe gives a house the survey
recognises; today that is the doorbell's README for `clock.netcheck`, and every
other step says that no document says how yet.

The loop: survey a house that works, carry its blueprint to another device or
environment, plan there, and the person builds from the plan. On a device with
nothing installed every part is `missing` and the plan lists everything as
`to_build`.

## Example survey (made-up values, shortened)

```json
{"protocol":"agenttool.house-survey/1","surveyed_at":"2026-11-14T12:00:00.000Z","good_for_seconds":300,
 "basis":"Looked at just now by this process on this device, at fixed places only, without opening any journal, database or key; self-declared, and nothing attests it.",
 "authorises":"Nothing: this is a reading, not a permission.",
 "place":{"platform":"darwin","has_battery":true,"container":false,"ci":false,"over_ssh":false},
 "says":"Here: ground.weather, room.collab, door.claude-code.collab, clock.wake. Stale: door.codex.collab. Missing: room.lobby, clock.netcheck. A reading from 12:00:00Z, good for about five minutes.",
 "parts":[
  {"id":"ground.weather","kind":"ground","state":"present","detail":{"says":"On mains power, battery 80%; load 1.2 on 8 cores; memory pressure normal; Wi-Fi. Read 11:59:58Z; good for about a minute.","notes":[]},"how":"…"},
  {"id":"room.collab","kind":"room","state":"present","detail":{"versions":["0.5.0-1a2b3c4d","0.6.0-dev.0-5e6f7a8b"],"current":"0.6.0-dev.0-5e6f7a8b","commit":"5e6f7a8b9c0d1e2f3a4b5c6d7e8f901234567890","installed":"2026-11-02T09:15:00Z","journal":{"exists":true,"age_seconds":60}},"how":"…"},
  {"id":"door.codex.collab","kind":"door","state":"stale","detail":{"entry":true,"names_install":true,"version":"0.5.0-1a2b3c4d","names_current":false,"switches":{"AGENTOOL_COLLAB_TOOLS":"notes"}},"how":"…","why":"the entry: it names collab 0.5.0-1a2b3c4d, but the current collab install is 0.6.0-dev.0-5e6f7a8b"},
  {"id":"clock.wake","kind":"clock","state":"present","detail":{"awake_since":"2026-11-14T08:02:11.000Z","last_slept_at":"2026-11-14T01:40:00.000Z"},"how":"…"}
 ]}
```

(Each part also carries its `for` sentence; the battery percentage is the
weather build's own reading of the device, not a measure of the house.)

## Not in this build

No `build` command and nothing that changes a device. No network. No opening of
any journal, database or key. No search. No reading of another tool's state
beyond the looks above. No judgement of the house. No cross-device send. No
dependency on `packages/collab` or `packages/lobby` as code: like the lobby
doorbell, it asks installed commands and does not import them, so it can survey a
device whose installs are older or newer than this checkout, and a change to
either package cannot silently widen what the survey reads.

## Limits

- The survey looks only in the fixed places above. A tool installed elsewhere
  reads `missing`. (The doorbell's own recipe puts it under `~/.kingdom/tools`,
  which is not looked at, and a wrapper in `~/.local/bin`, which is.)
- A switch a host passes to its servers from its own environment (Claude Code's
  `settings.json` `env`, or the environment the host was started in) cannot be
  seen: the survey reads only the entry. "Not set in this entry" means just that.
- An entry's own `AGENTOOL_COLLAB_DB` is not read (the entry look keeps the
  switches and nothing else), so a journal moved by one host entry is still
  reported at its default place; only a move in this process's environment is
  seen.
- A link in a directory above a blueprint file is followed, as part of the path
  the person gave; the file itself is not followed.
- Codex's hooks file is not read; only Claude Code's hook settings are.
- File times are this device's own clock; nothing here ties that clock to another
  (`clock.witness` says whether `timewitness`, which does, is present).
- The weather path is tested against fixtures shaped like the collab host's
  `weather` receipt; a build with `weather` was not installed where this was
  written.
