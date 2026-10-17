#!/usr/bin/env bun
/**
 * Long-running collab doorbell for one Claude Code session.
 *
 * It loops `agenttool-collab-host wait` and posts one content-free line into
 * the inbox socket of the Claude Code session that started it. By default it
 * rings only for events routed to the bound collab session
 * (CollabStore.eventAddressesSession); `--all` rings for any other session's
 * event. The line names ids, sequences and an anchor, never event content;
 * the agent reads and verifies the events through its own MCP session.
 *
 * It exits when the owning Claude Code process or its socket is gone, when the
 * collab session ends, on SIGTERM/SIGINT, or after --max-hours. One watcher
 * per collab session (pidfile). It never writes to the journal and never
 * prints the inbox token. See README.md beside this file.
 */
import { Database } from "bun:sqlite";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface Anchor {
  epoch_id: string;
  sequence: number;
  hash: string;
}

interface WaitReceipt {
  status: "ready" | "idle" | "error";
  error?: string;
  next_anchor?: Anchor;
}

const USAGE = "usage: collab-doorbell-watch --session <id> [--db <path>] [--host-bin <path>] [--all] "
  + "[--from-cursor] [--include-own] [--cycle-ms <ms>] [--min-gap-ms <ms>] [--max-hours <h>] [--once]";

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    session: { type: "string" },
    db: { type: "string" },
    "host-bin": { type: "string" },
    all: { type: "boolean" },
    "from-cursor": { type: "boolean" },
    "include-own": { type: "boolean" },
    "cycle-ms": { type: "string" },
    "min-gap-ms": { type: "string" },
    "max-hours": { type: "string" },
    once: { type: "boolean" },
  },
});

function fail(message: string): never {
  process.stderr.write(`collab-doorbell-watch: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = values[name as keyof typeof values];
  if (raw === undefined) return fallback;
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`--${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

const sessionId = values.session ?? "";
if (!/^session_[0-9a-f-]{36}$/.test(sessionId)) fail("--session <collab session id> is required");
const dbPath = resolve(values.db ?? process.env.AGENTOOL_COLLAB_DB
  ?? join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "agenttool", "collab.sqlite"));
const hostBin = resolve(values["host-bin"] ?? process.env.AGENTTOOL_COLLAB_HOST_BIN
  ?? join(import.meta.dir, "..", "..", "dist", "agenttool-collab-host.js"));
const cycleMs = integer("cycle-ms", 1_800_000, 1_000, 3_600_000);
const minGapMs = integer("min-gap-ms", 60_000, 0, 3_600_000);
const maxMs = integer("max-hours", 12, 1, 72) * 3_600_000;
const addressed = values.all !== true;
const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? "";
const token = process.env.CLAUDE_CODE_MESSAGING_TOKEN;
if (!socket) fail("CLAUDE_CODE_MESSAGING_SOCKET is not set; start this from the Claude Code session to be rung");
if (!existsSync(dbPath)) fail(`no collab journal at ${dbPath}`);
if (!existsSync(hostBin)) fail(`no agenttool-collab-host bundle at ${hostBin}`);

// Claude Code names a session's socket after its pid; otherwise only the socket is watched.
const socketName = basename(socket, ".sock");
const ownerPid = /^\d+$/.test(socketName) ? Number(socketName) : null;
const credentialFile = join(dirname(dbPath), "collab-sessions", `${sessionId}.json`);
const stateDir = join(dirname(dbPath), "collab-doorbell");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const pidFile = join(stateDir, `watch-${sessionId}.pid`);
const logFile = join(stateDir, `watch-${sessionId}.log`);

function log(entry: Record<string, unknown>): void {
  try {
    appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
  } catch {
    // Logging is best effort; the ring is what matters.
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function claimPidFile(): void {
  try {
    const fd = openSync(pidFile, "wx", 0o600);
    writeSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    const other = Number(readFileSync(pidFile, "utf8"));
    if (Number.isInteger(other) && other !== process.pid && alive(other)) {
      fail(`watcher ${other} already runs for ${sessionId}`);
    }
    unlinkSync(pidFile);
    claimPidFile();
  }
}
claimPidFile();

let child: ChildProcess | null = null;
function stop(reason: string, code = 0): never {
  if (child) child.kill("SIGTERM");
  log({ event: "stop", reason });
  try {
    if (Number(readFileSync(pidFile, "utf8")) === process.pid) unlinkSync(pidFile);
  } catch {
    // Already gone.
  }
  process.exit(code);
}
process.on("SIGTERM", () => stop("sigterm"));
process.on("SIGINT", () => stop("sigint"));

// Read-only structural metadata only: the session's workspace and its head.
const reader = new Database(dbPath, { readonly: true });
reader.exec("PRAGMA busy_timeout = 2000");
const bound = reader.query(
  "SELECT workspace_id, status, cursor_epoch_id, cursor_sequence, cursor_hash FROM coordination_sessions WHERE id = ?",
).get(sessionId) as {
  workspace_id: string;
  status: string;
  cursor_epoch_id: string;
  cursor_sequence: number;
  cursor_hash: string;
} | null;
if (!bound) stop("session_not_found", 2);
if (bound.status !== "active") stop("session_not_active", 2);
const workspaceId = bound.workspace_id;

function head(): Anchor {
  const row = reader.query(
    "SELECT epoch_id, event_head_sequence AS sequence, event_head_hash AS hash FROM workspaces WHERE id = ?",
  ).get(workspaceId) as Anchor;
  return { epoch_id: row.epoch_id, sequence: row.sequence, hash: row.hash };
}

function sessionActive(): boolean {
  const row = reader.query("SELECT status FROM coordination_sessions WHERE id = ?").get(sessionId) as
    { status: string } | null;
  return row?.status === "active";
}

const ownerGone = () => (ownerPid !== null && !alive(ownerPid)) || !existsSync(socket);

function waitOnce(after: Anchor): Promise<WaitReceipt> {
  const args = [hostBin, "wait", "--session", sessionId, "--db", dbPath,
    "--after-anchor", JSON.stringify(after), "--wait-ms", String(cycleMs)];
  if (addressed) args.push("--addressed");
  if (values["include-own"]) args.push("--include-own");
  return new Promise((resolveReceipt) => {
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "ignore"] });
    child = proc;
    let out = "";
    proc.stdout!.on("data", (chunk) => {
      out += chunk;
    });
    proc.on("close", () => {
      child = null;
      try {
        resolveReceipt(JSON.parse(out.split("\n")[0] ?? "") as WaitReceipt);
      } catch {
        resolveReceipt({ status: "error", error: "unparseable_receipt" });
      }
    });
  });
}

/**
 * Posts one line. The shape is the one Claude Code 2.1.302 prints in its
 * "[uds-messaging] Inject messages" debug hint, not a documented contract.
 * The auth line lets Claude Code verify a post from its own child on macOS.
 */
function ring(text: string): Promise<boolean> {
  const line = JSON.stringify({ type: "user", message: { role: "user", content: text } });
  return new Promise((resolveRing) => {
    // Connect only once the line is ready: the inbox closes a silent connection after 30 s.
    const connection = createConnection(socket, () => {
      if (token) connection.write(`${JSON.stringify({ type: "auth", token })}\n`);
      connection.end(`${line}\n`);
    });
    connection.on("error", (error: NodeJS.ErrnoException) => {
      log({ event: "ring_failed", code: error.code ?? "error" });
      resolveRing(false);
    });
    connection.on("close", (hadError) => resolveRing(!hadError));
  });
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const started = Date.now();
let anchor: Anchor = values["from-cursor"]
  ? { epoch_id: bound.cursor_epoch_id, sequence: bound.cursor_sequence, hash: bound.cursor_hash }
  : head();
let lastRing = 0;
let authRetries = 0;
log({ event: "start", pid: process.pid, workspace_id: workspaceId, after_sequence: anchor.sequence, addressed });

while (true) {
  if (ownerGone()) stop("owner_gone");
  if (Date.now() - started >= maxMs) {
    await ring(`[collab doorbell] The watcher for session ${sessionId} expired after `
      + `${maxMs / 3_600_000} h. Re-arm it if you still want to be rung.`);
    stop("max_lifetime");
  }
  const receipt = await waitOnce(anchor);
  if (receipt.status === "idle" && receipt.next_anchor) {
    anchor = receipt.next_anchor;
    authRetries = 0;
    log({ event: "idle", next_sequence: anchor.sequence });
    continue;
  }
  if (receipt.status === "ready" && receipt.next_anchor) {
    authRetries = 0;
    // Coalesce a burst: wait out the gap, then ring once for everything up to the head.
    const gap = lastRing + minGapMs - Date.now();
    if (gap > 0) await sleep(gap);
    if (ownerGone()) stop("owner_gone");
    const from = receipt.next_anchor;
    const covered = head();
    const what = addressed ? "at least one routed to this session" : "at least one from another session";
    const rang = await ring(`[collab doorbell] ready: workspace ${workspaceId}, session ${sessionId}: `
      + `${covered.sequence - from.sequence} event(s) after sequence ${from.sequence} `
      + `(head ${covered.sequence}), ${what}. This line carries no event content. `
      + `Read them with collab_events_wait or collab_events_since after_anchor ${JSON.stringify(from)}. `
      + `Watcher pid ${process.pid} re-arms itself; stop it with kill ${process.pid}.`);
    lastRing = Date.now();
    log({ event: rang ? "rang" : "ring_failed", from_sequence: from.sequence, head_sequence: covered.sequence });
    if (!rang && ownerGone()) stop("owner_gone");
    anchor = covered;
    if (values.once) stop("once");
    continue;
  }
  // Ending removes the credential file; stop quietly rather than ring for it.
  if (!existsSync(credentialFile) || !sessionActive()) stop("session_ended");
  if (receipt.error === "session_auth_failed" && authRetries < 3) {
    // A resumed MCP process rewrites the file with a new generation; retry.
    authRetries += 1;
    log({ event: "auth_retry", attempt: authRetries });
    await sleep(2_000);
    continue;
  }
  if (receipt.error === "event_read_busy") {
    log({ event: "busy_retry" });
    await sleep(5_000);
    continue;
  }
  await ring(`[collab doorbell] stopped: ${receipt.error ?? "unknown_error"} for session ${sessionId}. `
    + "The watcher exited; check the session before re-arming.");
  stop(`error:${receipt.error ?? "unknown"}`, 1);
}
