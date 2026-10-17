/**
 * Claude Code SessionStart and SessionEnd hooks. Reads allowlisted hook fields
 * only: the event name, `session_id`, `source`, `reason`, `model` and
 * `effort.level`. Prompts, tool input and output, messages, paths and
 * transcript contents are never read or copied.
 *
 * One Claude Code process can host several sessions in turn (`/clear`,
 * interactive `/resume`), while its MCP servers live on and keep the session
 * ID they were spawned with. A small file per process under `hosts/` lists the
 * sessions it hosted, so that `/clear` can be recorded as a continuation and,
 * when the process exits, every collab session its MCP servers started can be
 * ended by seat ref. Nothing here grants, verifies or contacts anything.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CODE } from "./claude-code.js";
import { SeatError } from "./errors.js";
import { token, uuid } from "./fields.js";
import { assertPrivateDirectory, assertPrivateFile } from "./home.js";
import type { SeatLedger } from "./ledger.js";

export const HOSTS_DIRECTORY = "hosts";
const HOST_FILE = /^claude-code-(\d+)\.json$/;
const MAX_HOST_SESSIONS = 256;
/** SessionEnd reasons after which the process, and its MCP servers, keep running. */
const IN_PROCESS_REASONS = new Set(["clear", "resume"]);
/** SessionEnd reasons the hooks documentation gives for a process that is exiting. */
const EXIT_REASONS = new Set(["prompt_input_exit", "logout", "other"]);
const COLLAB_HOST_TIMEOUT_MS = 8_000;

export interface ClaudeHookInput {
  event: "SessionStart" | "SessionEnd" | null;
  session_id: string | null;
  source: string | null;
  reason: string | null;
  model: string | null;
  effort: string | null;
}

/** Pick the allowlisted fields; anything else in the hook input is ignored. */
export function readClaudeHookInput(raw: unknown): ClaudeHookInput {
  const input = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = input.hook_event_name;
  const effort = input.effort !== null && typeof input.effort === "object" ? (input.effort as Record<string, unknown>).level : null;
  return {
    event: name === "SessionStart" || name === "SessionEnd" ? name : null,
    session_id: uuid(input.session_id),
    source: token(input.source),
    reason: token(input.reason),
    model: token(input.model),
    effort: token(effort),
  };
}

interface HostFile {
  pid: number;
  /** The process start time `ps` reports, to tell a reused pid apart. */
  process_started: string | null;
  sessions: string[];
  last_end: { session_id: string; reason: string } | null;
}

export interface CollabRun {
  exit_code: number | null;
  stdout: string;
  timed_out: boolean;
}

export interface ClaudeHookOptions {
  /** The Claude Code process: `CLAUDE_PID` when set, else the hook's parent. */
  pid: number;
  now?: () => string;
  processStarted?: (pid: number) => string | null;
  alive?: (pid: number) => boolean;
  /** End collab sessions by seat ref when the process exits. */
  collab?: { host: string; db?: string | null; run?: (argv: string[]) => CollabRun } | null;
}

export interface ClaudeHookResult {
  event: ClaudeHookInput["event"];
  seat_id: string | null;
  /** What the hook did, in order: opened, resumed, settings, continuation, ended, collab, … */
  actions: string[];
  collab: { seat_refs: string[]; summary: string } | null;
}

function processStartedByPs(pid: number): string | null {
  const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore", timeout: 2_000 });
  const text = result.exitCode === 0 ? result.stdout.toString().trim() : "";
  return text.length > 0 && text.length <= 64 ? text : null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function runCollabHost(argv: string[]): CollabRun {
  const result = Bun.spawnSync([process.execPath, ...argv], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: COLLAB_HOST_TIMEOUT_MS,
  });
  return {
    exit_code: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
    timed_out: result.exitCode === null,
  };
}

function hostsDirectory(home: string): string {
  const directory = join(home, HOSTS_DIRECTORY);
  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  assertPrivateDirectory(directory);
  return directory;
}

function readHostFile(path: string): HostFile | null {
  if (!existsSync(path)) return null;
  assertPrivateFile(path);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const file = value as Partial<HostFile> | null;
  if (!file || typeof file !== "object" || !Number.isSafeInteger(file.pid) || !Array.isArray(file.sessions)) return null;
  const sessions = file.sessions.map(uuid).filter((id): id is string => id !== null);
  const endSession = uuid(file.last_end?.session_id);
  const endReason = token(file.last_end?.reason);
  return {
    pid: file.pid!,
    process_started: typeof file.process_started === "string" ? file.process_started : null,
    sessions,
    last_end: endSession && endReason ? { session_id: endSession, reason: endReason } : null,
  };
}

function writeHostFile(path: string, file: HostFile): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

/** Forget processes that are gone. A crash or kill leaves no SessionEnd, so this is the only cleanup. */
function pruneHostFiles(directory: string, current: number, alive: (pid: number) => boolean): void {
  for (const name of readdirSync(directory)) {
    const match = HOST_FILE.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid !== current && !alive(pid)) unlinkSync(join(directory, name));
  }
}

function summarize(run: CollabRun): string {
  if (run.timed_out) return "collab host timed out";
  let receipt: { status?: string; error?: string; sessions?: Array<{ status?: string }> };
  try {
    receipt = JSON.parse(run.stdout.split("\n")[0] ?? "");
  } catch {
    return `collab host exited ${run.exit_code} without a receipt`;
  }
  if (receipt.status !== "ended_by_seat_ref" || !Array.isArray(receipt.sessions)) {
    return `collab host: ${token(receipt.error) ?? "unexpected receipt"}`;
  }
  const counts = new Map<string, number>();
  for (const session of receipt.sessions) {
    const status = token(session.status) ?? "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const parts = [...counts].map(([status, count]) => `${status} ${count}`);
  return `collab sessions: ${parts.length > 0 ? parts.join(", ") : "none matched"}`;
}

/** Handle one hook input. Throws only SeatError and I/O errors; the CLI reports them and still exits 0. */
export function handleClaudeHook(ledger: SeatLedger, raw: unknown, options: ClaudeHookOptions): ClaudeHookResult {
  const input = readClaudeHookInput(raw);
  const result: ClaudeHookResult = { event: input.event, seat_id: null, actions: [], collab: null };
  if (!input.event) return result;
  if (!input.session_id) throw new SeatError("invalid_hook_input", "a session hook names a session_id");
  if (!Number.isSafeInteger(options.pid) || options.pid <= 1) throw new SeatError("invalid_hook_input", "the Claude Code process id is unknown");
  const now = options.now ?? (() => new Date().toISOString());
  const alive = options.alive ?? processAlive;
  const started = (options.processStarted ?? processStartedByPs)(options.pid);
  const at = now();

  const directory = hostsDirectory(ledger.home);
  pruneHostFiles(directory, options.pid, alive);
  const path = join(directory, `claude-code-${options.pid}.json`);
  const previous = readHostFile(path);
  // A different start time means the pid was reused by a new process.
  const reused = previous !== null && previous.process_started !== null && started !== null && previous.process_started !== started;
  const host: HostFile =
    previous && !reused ? previous : { pid: options.pid, process_started: started, sessions: [], last_end: null };
  if (!host.sessions.includes(input.session_id)) host.sessions = [...host.sessions, input.session_id].slice(-MAX_HOST_SESSIONS);

  const { seat, created } = ledger.openSeat({
    harness: CLAUDE_CODE,
    native_ref: { session_id: input.session_id },
    started_at: input.event === "SessionStart" ? at : null,
  });
  result.seat_id = seat.seat_id;
  if (created) result.actions.push("opened");
  ledger.observe(seat.seat_id, { last_seen_at: at });

  if (input.event === "SessionStart") {
    if (ledger.resumeSeat(seat.seat_id, at)) result.actions.push("resumed");
    // Only a brand-new session: an earlier transcript entry must never be shadowed by a later hook entry.
    if (created && input.source === "startup" && input.model) {
      const appended = ledger.recordSettings(seat.seat_id, [
        { at, model: input.model, effort: input.effort, provider: null, basis: "hook", evidence: null },
      ]);
      if (appended > 0) result.actions.push("settings");
    }
    const ended = host.last_end;
    if (input.source === "clear" && ended?.reason === "clear" && ended.session_id !== input.session_id) {
      const parent = ledger.findSeat(CLAUDE_CODE, { session_id: ended.session_id });
      if (parent) {
        try {
          if (ledger.linkParent(seat.seat_id, parent.seat_id, "continuation")) result.actions.push("continuation");
        } catch (error) {
          if (!(error instanceof SeatError) || (error.code !== "lineage_conflict" && error.code !== "lineage_cycle")) throw error;
          result.actions.push(error.code);
        }
      }
    }
    host.last_end = null;
    writeHostFile(path, host);
    return result;
  }

  if (ledger.endSeat(seat.seat_id, at, input.reason)) result.actions.push("ended");
  if (input.reason && IN_PROCESS_REASONS.has(input.reason)) {
    host.last_end = { session_id: input.session_id, reason: input.reason };
    writeHostFile(path, host);
    return result;
  }
  if (!input.reason || !EXIT_REASONS.has(input.reason)) {
    // Unknown reason: the process may live on, so keep its file and leave collab alone.
    result.actions.push("unknown_reason");
    writeHostFile(path, host);
    return result;
  }
  if (options.collab) {
    const seatRefs = host.sessions.map((id) => `${CLAUDE_CODE}:${id}`);
    const argv = [options.collab.host, "end", ...seatRefs.flatMap((seatRef) => ["--seat-ref", seatRef])];
    argv.push("--reason", `Claude Code session ended (${input.reason})`);
    if (options.collab.db) argv.push("--db", options.collab.db);
    const run = (options.collab.run ?? runCollabHost)(argv);
    result.collab = { seat_refs: seatRefs, summary: summarize(run) };
    result.actions.push("collab");
  }
  if (existsSync(path)) unlinkSync(path);
  return result;
}
