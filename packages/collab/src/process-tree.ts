import { execFileSync } from "node:child_process";
import { basename } from "node:path";

/**
 * Which local host runs a collab MCP process. Derived from the process tree,
 * never from a model's claim (spike S2, 2026-10-09).
 */
export type HostKind = "claude-code" | "codex" | "codex-app-server" | "unknown";

type Environment = Record<string, string | undefined>;

export interface ProcessRecord {
  pid: number;
  ppid: number;
  /**
   * `LC_ALL=C ps -o lstart=` with whitespace runs collapsed, for example
   * "Thu Oct 8 21:50:55 2026". Compared verbatim to guard against pid reuse.
   */
  started_at: string;
  /** `ps -o comm=`: the executable path or name. */
  comm: string;
  /** `ps -o args=`: the argument vector, space-joined. */
  args: string;
}

/** One point-in-time process table keyed by pid. */
export type ProcessTable = ReadonlyMap<number, ProcessRecord>;

export interface HostProcess {
  pid: number;
  started_at: string;
  kind: HostKind;
}

export interface ProcessTreeOptions {
  /** Reads the process table; null means it could not be read. Default: readProcessTable. */
  process_table?: () => ProcessTable | null;
  /** The collab MCP's own environment, for CLAUDE_CODE_SESSION_ID. Default: process.env. */
  env?: Environment;
}

const PS = "/bin/ps";
const PS_TIMEOUT_MS = 2_000;
const MAX_ANCESTRY = 256;
// lstart is always five tokens under LC_ALL=C: "Thu Oct  8 21:50:55 2026".
const STATUS_LINE = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/;
const ARGS_LINE = /^\s*(\d+)\s+(.*)$/;
const COLLAB_MCP_ARGS = /(^|[\s/])agenttool-collab-mcp(\.[jt]s)?(\s|$)/;

/** Parse `ps -A -ww -o pid=,ppid=,lstart=,comm=` and `ps -A -ww -o pid=,args=` output. */
export function parseProcessTable(statusOutput: string, argsOutput: string): ProcessTable {
  const table = new Map<number, ProcessRecord>();
  for (const line of statusOutput.split("\n")) {
    const match = STATUS_LINE.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    table.set(pid, {
      pid,
      ppid: Number(match[2]),
      started_at: match[3]!.replace(/\s+/g, " "),
      comm: match[4]!.trim(),
      args: "",
    });
  }
  for (const line of argsOutput.split("\n")) {
    const match = ARGS_LINE.exec(line);
    if (!match) continue;
    const record = table.get(Number(match[1]));
    if (record) record.args = match[2]!.trim();
  }
  return table;
}

/**
 * Read the whole process table with two `/bin/ps` calls under `LC_ALL=C`.
 * Returns null when ps fails or is denied (it may be inside a Codex
 * seatbelt); every caller then fails closed.
 */
export function readProcessTable(): ProcessTable | null {
  try {
    const run = (format: string) =>
      execFileSync(PS, ["-A", "-ww", "-o", format], {
        encoding: "utf8",
        env: { LC_ALL: "C", PATH: "/usr/bin:/bin" },
        maxBuffer: 64 * 1024 * 1024,
        timeout: PS_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
      });
    const table = parseProcessTable(run("pid=,ppid=,lstart=,comm="), run("pid=,args="));
    return table.size > 0 ? table : null;
  } catch {
    return null;
  }
}

/**
 * Classify one process as a collab MCP host. `claude-code` needs basename
 * `claude` and the MCP's own CLAUDE_CODE_SESSION_ID (never CLAUDE_PID).
 * `codex ... app-server` is the Desktop app-server; `codex app-server daemon
 * pid-update-loop` only supervises it and is never a host.
 */
export function hostKindOf(record: ProcessRecord, env: Environment): HostKind {
  const name = basename(record.comm);
  if (name === "claude") return env.CLAUDE_CODE_SESSION_ID ? "claude-code" : "unknown";
  if (name !== "codex") return "unknown";
  const argv = record.args.split(/\s+/).slice(1);
  if (!argv.includes("app-server")) return "codex";
  return argv.includes("daemon") ? "unknown" : "codex-app-server";
}

/**
 * Whether a process is a Claude or Codex host by its executable and argv
 * alone. The knock walk uses it to stop at the nearest host; it has no MCP
 * environment to consult.
 */
export function isHostProcess(record: ProcessRecord): boolean {
  if (basename(record.comm) === "claude") return true;
  return hostKindOf(record, {}) !== "unknown";
}

/**
 * Whether a process is a collab MCP server, by its argv (the S2 prototype rule,
 * widened to the `.ts` source entry): the installed bin, a plugin's
 * `dist/agenttool-collab-mcp.js`, or `bin/agenttool-collab-mcp.ts`.
 */
export function isCollabMcpProcess(record: ProcessRecord): boolean {
  return COLLAB_MCP_ARGS.test(record.args);
}

/**
 * The host of the collab MCP process `pid`: its direct parent, classified.
 * S2 found every host (Claude Code, Codex TUI and exec, the Desktop
 * app-server) spawns the collab MCP as a direct child, so the nearest host is
 * never a further ancestor. A collab MCP started from a tool shell or a test
 * runner binds to that process (kind `unknown`), never to the seat above it.
 * Null when the table cannot be read or either process is missing.
 */
export function nearestHost(pid: number, options: ProcessTreeOptions = {}): HostProcess | null {
  const table = (options.process_table ?? readProcessTable)();
  if (!table) return null;
  const self = table.get(pid);
  if (!self) return null;
  const parent = table.get(self.ppid);
  if (!parent || parent.pid <= 1) return null;
  return {
    pid: parent.pid,
    started_at: parent.started_at,
    kind: hostKindOf(parent, options.env ?? process.env),
  };
}

/** `pid` and its ancestors, nearest first; stops at a missing pid, a cycle, or 256 steps. */
export function ancestry(pid: number, table: ProcessTable): ProcessRecord[] {
  const chain: ProcessRecord[] = [];
  const seen = new Set<number>();
  let current = pid;
  while (current > 0 && chain.length < MAX_ANCESTRY && !seen.has(current)) {
    const record = table.get(current);
    if (!record) break;
    chain.push(record);
    seen.add(current);
    current = record.ppid;
  }
  return chain;
}
