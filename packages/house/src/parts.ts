/** The parts of a house, declared as data. This table is the extension point:
 * a new part is a new row here, using only the looks named in README.md, and
 * a reader for its `shape` in src/survey.ts. A row's `looks` is binding: its
 * reader is handed only those looks (src/survey.ts, `looksFor`).
 */
import type { PartKind } from "./shapes.js";
import type { HostName } from "./looks.js";
import type { RootName, Tool } from "./places.js";

/**
 * Variables that move a place the survey looks at, and the place (under the home
 * directory) each names when it is not set. When one is set in this process's
 * environment to anywhere else, the survey does not read the default place as if
 * it were the one in use: what it holds is `unknown`. Only whether it moves the
 * place is kept, never its value. Here because it names the journal's file.
 */
export const MOVING_VARIABLES = {
  CLAUDE_CONFIG_DIR: ".claude",
  CODEX_HOME: ".codex",
  XDG_DATA_HOME: ".local/share",
  XDG_STATE_HOME: ".local/state",
  AGENTOOL_COLLAB_DB: ".local/share/agenttool/collab.sqlite",
  AGENTTOOL_LOBBY_HOME: ".local/state/agenttool/lobby",
  AGENTTOOL_EXECUTION_SEAT_HOME: ".local/state/agenttool/execution-seat",
} as const;
export type MovingVariable = keyof typeof MOVING_VARIABLES;

export type LookName = "path" | "link" | "source" | "entry" | "hook" | "ask" | "env" | "wrapper";

export type PartShape =
  | { shape: "weather" }
  | {
    shape: "room";
    tool: Tool;
    /** The room's state file, lstat'ed only; `movedBy` lists the variables that put it elsewhere. */
    file: { root: RootName; rel: string; sidecar: string; label: "journal" | "cache" | "ledger"; shown: string; movedBy: readonly MovingVariable[] };
  }
  | { shape: "door"; host: HostName; server: string; tool: Tool }
  | { shape: "hooks" }
  | { shape: "wrappers" }
  | { shape: "witness" }
  | { shape: "netcheck" }
  | { shape: "wake" };

export interface PartSpec {
  id: string;
  kind: PartKind;
  for: string;
  looks: readonly LookName[];
  of: PartShape;
  /** Documents in this repository that say how to make each kind of change; null where none exists yet. */
  see: { build: string | null; repoint: string | null; switch: string | null };
  /** What a blueprint may name for this part besides its id. */
  wants: { commit: boolean; switches: boolean };
}

const NONE = { build: null, repoint: null, switch: null } as const;
const PLAIN = { commit: false, switches: false } as const;

export const PARTS: readonly PartSpec[] = [
  {
    id: "ground.weather",
    kind: "ground",
    for: "This device's weather now (power, load, memory, uplink), in the installed collab build's own sentences.",
    looks: ["link", "path", "ask"],
    of: { shape: "weather" },
    see: NONE,
    wants: PLAIN,
  },
  {
    id: "room.collab",
    kind: "room",
    for: "The collab install agents on this device coordinate through, and whether its journal is here.",
    looks: ["link", "source", "path", "env"],
    of: { shape: "room", tool: "collab", file: { root: "share", rel: "collab.sqlite", sidecar: "collab.sqlite-wal", label: "journal", shown: "~/.local/share/agenttool/collab.sqlite", movedBy: ["XDG_DATA_HOME", "AGENTOOL_COLLAB_DB"] } },
    see: NONE,
    wants: { commit: true, switches: false },
  },
  {
    id: "room.lobby",
    kind: "room",
    for: "The Lobby desk install, and the age of its cache: this device's picture of the owner's other devices.",
    looks: ["link", "source", "path", "env"],
    of: { shape: "room", tool: "lobby", file: { root: "state", rel: "lobby/lobby.sqlite", sidecar: "lobby/lobby.sqlite-wal", label: "cache", shown: "~/.local/state/agenttool/lobby/lobby.sqlite", movedBy: ["AGENTTOOL_LOBBY_HOME", "XDG_STATE_HOME"] } },
    see: NONE,
    wants: { commit: true, switches: false },
  },
  {
    id: "room.execution-seat",
    kind: "room",
    for: "The execution-seat hook's source copy, which records which runtime acted for which identity.",
    looks: ["link", "source", "path", "env"],
    of: { shape: "room", tool: "execution-seat", file: { root: "state", rel: "execution-seat/seats.sqlite", sidecar: "execution-seat/seats.sqlite-wal", label: "ledger", shown: "~/.local/state/agenttool/execution-seat/seats.sqlite", movedBy: ["AGENTTOOL_EXECUTION_SEAT_HOME", "XDG_STATE_HOME"] } },
    see: NONE,
    wants: { commit: true, switches: false },
  },
  {
    id: "door.claude-code.collab",
    kind: "door",
    for: "Claude Code's user-scope MCP entry for collab: how Claude Code sessions here reach the journal.",
    looks: ["entry", "link", "env"],
    of: { shape: "door", host: "claude-code", server: "agenttool-collab", tool: "collab" },
    see: NONE,
    wants: { commit: false, switches: true },
  },
  {
    id: "door.claude-code.lobby",
    kind: "door",
    for: "Claude Code's user-scope MCP entry for the Lobby desk's read-only view.",
    looks: ["entry", "link", "env"],
    of: { shape: "door", host: "claude-code", server: "agenttool-lobby", tool: "lobby" },
    see: NONE,
    wants: PLAIN,
  },
  {
    id: "door.codex.collab",
    kind: "door",
    for: "Codex's MCP entry for collab: how Codex sessions here reach the journal.",
    looks: ["entry", "link", "env"],
    of: { shape: "door", host: "codex", server: "agenttool-collab", tool: "collab" },
    see: NONE,
    wants: { commit: false, switches: true },
  },
  {
    id: "door.codex.lobby",
    kind: "door",
    for: "Codex's MCP entry for the Lobby desk's read-only view.",
    looks: ["entry", "link", "env"],
    of: { shape: "door", host: "codex", server: "agenttool-lobby", tool: "lobby" },
    see: NONE,
    wants: PLAIN,
  },
  {
    id: "hand.claude-code.hooks",
    kind: "hand",
    for: "Claude Code hooks that run an AgentTool install (the execution seat, and the collab host at session end).",
    looks: ["hook", "link", "env"],
    of: { shape: "hooks" },
    see: NONE,
    wants: PLAIN,
  },
  {
    id: "hand.wrappers",
    kind: "hand",
    for: "The agenttool-* commands in ~/.local/bin, and which install each runs.",
    looks: ["wrapper", "link"],
    of: { shape: "wrappers" },
    see: NONE,
    wants: PLAIN,
  },
  {
    id: "clock.witness",
    kind: "clock",
    for: "timewitness, which checks this device's clock against signed outside witnesses. The survey does not run it, because it contacts time servers; running it gives a tied clock.",
    looks: ["path", "env"],
    of: { shape: "witness" },
    see: NONE,
    wants: PLAIN,
  },
  {
    id: "clock.netcheck",
    kind: "clock",
    for: "The Lobby doorbell's netcheck, which reads the desk's grants and the hosted service. Not run by the survey, because it contacts the service.",
    looks: ["path", "link"],
    of: { shape: "netcheck" },
    see: { build: "packages/lobby-doorbell/README.md", repoint: "packages/lobby-doorbell/README.md", switch: null },
    wants: PLAIN,
  },
  {
    id: "clock.wake",
    kind: "clock",
    for: "When this device last woke and last slept, from the weather reading: silence across a sleep means the device slept, not that anyone agreed.",
    looks: ["link", "path", "ask"],
    of: { shape: "wake" },
    see: NONE,
    wants: PLAIN,
  },
];

export const PART_IDS: readonly string[] = PARTS.map((part) => part.id);

export function partSpec(id: string): PartSpec | undefined {
  return PARTS.find((part) => part.id === id);
}
