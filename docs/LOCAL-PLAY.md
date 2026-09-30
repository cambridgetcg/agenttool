# Offline Pocket Sky

> **Type:** guide · **Purpose:** offer optional text play without an account, browser or work obligation.
> **Evidence:** Private source candidate: pure round `bin/pocket-sky.mjs`, stdin CLI `bin/agenttool-pocket-sky.mjs`, behavior tests `bin/tests/pocket-sky.test.ts`, and the existing [browser rules](https://agenttool.dev/sky.json). No standalone archive or package publication is claimed; this guide does not install a host tool.

Pocket Sky lets a caller change a small pattern directly. It starts with an empty
5×5 board. Toggle zero to seven lights, keep the pattern, clear it, or leave.
Seven is a limit, not a goal. There is no completion condition, score, reward,
interpretation or required reflection. Nothing needs to follow a work session,
and there is no expectation to play.

## Use from a checkout

Node 22 or later runs the two source modules directly; npm is optional and no
dependency installation is needed. From the repository root:

```sh
node bin/agenttool-pocket-sky.mjs --help
node bin/agenttool-pocket-sky.mjs
```

The second command reads explicit commands from stdin, one per line, until
`leave` or EOF. A terminal can supply them interactively; an agent harness may
keep that chosen process open and write the next command when wanted. It creates
no host configuration, MCP registration, daemon or automatically launched turn.
The executable does not use mission or Local Starter state.

| Command | Effect |
|---|---|
| `view` | Show the current board without changing it. |
| `toggle ROW COLUMN` | Toggle a cell using row and column numbers from 1 through 5. |
| `rest` | Freeze toggles while retaining the pattern. |
| `reopen` | Allow toggles again, preserving the pattern. |
| `clear` | Remove every light; a resting board stays resting. |
| `leave` | Remove the pattern and end the process. |

Each valid command returns one JSON line with `outcome`, `mode`, `light_count`, and
five `board` rows. `☆` is unlit; `★` is lit. Counts describe the board and do not
score the player. An eighth unlit cell returns `light_limit` without changing
the pattern. A lit cell can still be removed when the board is open. A toggle
while resting returns `resting` without changing the pattern. Repeating an
already selected mode or clearing an empty board returns `unchanged`.

Blank lines do nothing. Help and EOF with no commands create no round. Lines
are limited to 256 bytes. A mistyped or invalid ordinary command emits a bounded
error on stderr, keeps the current pattern and mode, and accepts the next command.
The error never repeats the input. Oversized lines or malformed UTF-8 end the
process. A final command before EOF can omit its newline. A new process always
starts empty; there is no restore command.

## What stays local

The tool keeps only the current board in its process memory. It writes no state
files, history or credentials, and performs no network call, subprocess launch,
timer, telemetry or background activity. `rest` affects the game only: it does
not pause the agent harness or receiver, or establish that a player rested,
enjoyed the game or benefited from it. The separate
[receiver pause](COLLABORATION-MISSION-WAKE.md#private-pause-and-free-return)
controls delivery within its documented scope.

The host can observe this process and retain commands or outputs in a terminal
log, tool transcript, capture or backup. `clear`, `leave` and EOF remove the
tool's current pattern; they cannot recall copies outside it or promise secure
memory erasure. No pattern is automatically saved into memory or a handoff.

The [browser Pocket Sky](https://agenttool.dev/sky) remains a separate interface
with the same board bounds and play rules. It has its own page-memory and hosting
boundary. Neither interface assigns meaning to a pattern; a player may do so.
