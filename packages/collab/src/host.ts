import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolveDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import {
  collabSessionsDirectory,
  readHostBindings,
  removeHostBinding,
  type HostBinding,
} from "./host-binding.js";
import {
  ancestry,
  hostKindOf,
  isCollabMcpProcess,
  isHostProcess,
  readProcessTable,
  type ProcessRecord,
  type ProcessTable,
} from "./process-tree.js";
import {
  SESSION_STALE_AFTER_MS,
  type SessionCredential,
  type SessionEndRelease,
  type SessionHandle,
  type SessionLiveness,
  type SessionRest,
} from "./protocol.js";
import {
  readSessionCredentialFile,
  removeSessionCredentialFile,
} from "./session-file.js";
import {
  CollabStore,
  isAddressedTo,
  restFromDeclaration,
  type AddressedEventRow,
  type RestDeclarationRow,
} from "./store.js";

export const COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1" as const;
export const COLLAB_KNOCK_PROTOCOL = "agenttool.collab-knock/1" as const;
export const COLLAB_DOORBELL_SCAN_PROTOCOL = "agenttool.collab-doorbell-scan/1" as const;
export const KNOCK_LEDGER_FORMAT = "agenttool.collab-knock-ledger/1" as const;

export const COLLAB_HOST_USAGE =
  "usage: agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]";
export const COLLAB_KNOCKS_USAGE =
  "usage: agenttool-collab-host knocks --host-ancestor auto|<pid> [--mark-tapped] [--db <path>]";
export const COLLAB_DOORBELL_SCAN_USAGE = "usage: agenttool-collab-host doorbell-scan [--db <path>]";

/** The trimmed-length limit endSession applies to its reason. */
const MAX_HOST_REASON = 2_000;
/** store.ts APPLICATION_ID ("ATCL"): a read-only verb never reads another application's SQLite file. */
const COLLAB_APPLICATION_ID = 0x4154434c;
/** A ledger lock older than this was left by a crashed run and may be broken. */
const LEDGER_LOCK_STALE_MS = 30_000;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface HostEndReceipt {
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "ended" | "already_ended";
  session_id: string;
  released: SessionEndRelease[];
  ended_at: string | null;
  /** Present only when the session is ended but its revoked credential file is still on disk. */
  warning?: "session_file_remove_failed";
}

export interface HostErrorReceipt {
  [detail: string]: unknown;
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "error";
  error: string;
  message: string;
}

export interface HostEndOptions {
  session_file: string;
  reason: string;
  release_leases: boolean;
}

/** One doorbell pointer: never a body. `kind` is the journal event type. */
export interface KnockItem {
  seq: number;
  kind: "report.posted" | "handoff.offered";
  from_actor: string;
  ref_id: string;
}

export interface KnockReport {
  protocol: typeof COLLAB_KNOCK_PROTOCOL;
  session_id: string;
  liveness: SessionLiveness;
  rest: SessionRest | null;
  waiting: number;
  new: KnockItem[];
}

export interface DoorbellScanSession {
  session_id: string;
  workspace_id: string;
  worktree_root: string;
  actor: string;
  rest: SessionRest;
  waiting: number;
  new: KnockItem[];
  binding: HostBinding | null;
}

export interface DoorbellScan {
  protocol: typeof COLLAB_DOORBELL_SCAN_PROTOCOL;
  sessions: DoorbellScanSession[];
}

/** Seams for the read-only verbs; production uses ps, process.ppid and the wall clock. */
export interface HostCliDependencies {
  process_table?: () => ProcessTable | null;
  /** The process `--host-ancestor auto` starts from. Default: process.ppid. */
  parent_pid?: number;
  now?: () => Date;
}

/**
 * Host-side end for a session whose MCP process is gone. Without
 * release_leases it first refuses, read-only, while a lease is live. It then
 * resumes with cursor recovery allowed (a stale generation or cursor in the
 * file is tolerated), ends through the store, and removes the credential
 * file. The returned receipt never contains the credential. The reason is
 * judged only by the end, after the resume, so callers pass one already
 * checked (parseHostArgs does this for the CLI).
 */
export function endSessionFromCredential(
  store: CollabStore,
  credential: SessionCredential,
  options: HostEndOptions,
): HostEndReceipt {
  let resumed: SessionHandle;
  try {
    if (!options.release_leases) store.preflightSessionEnd(credential);
    resumed = store.resumeSession(credential, { allow_cursor_recovery: true });
  } catch (error) {
    if (error instanceof CollabError && error.code === "session_auth_failed") {
      const known = store.getCoordinationSession(credential.session_id);
      if (known?.status === "ended") {
        return removeRevokedFile(options.session_file, {
          protocol: COLLAB_HOST_PROTOCOL,
          status: "already_ended",
          session_id: known.id,
          released: [],
          ended_at: known.ended_at,
        });
      }
    }
    throw error;
  }
  const ended = store.endSessionWithReleases({
    ...resumed.credential,
    reason: options.reason,
    release_leases: options.release_leases,
  });
  return removeRevokedFile(options.session_file, {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "ended",
    session_id: ended.session.id,
    released: ended.released_leases.map(({ task_id, lease_id, via }) => ({
      task_id,
      lease_id,
      via,
    })),
    ended_at: ended.session.ended_at,
  });
}

/** The session is ended either way; a leftover revoked file is a warning, not a failure. */
function removeRevokedFile(sessionFile: string, receipt: HostEndReceipt): HostEndReceipt {
  try {
    removeSessionCredentialFile(sessionFile);
    return receipt;
  } catch {
    return { ...receipt, warning: "session_file_remove_failed" };
  }
}

/**
 * Parse argv and run one verb. `end` returns exactly one JSON receipt line.
 * `knocks` and `doorbell-scan` are read-only and consulted from hooks and
 * timers: they return one JSON line or null (print nothing), and every
 * failure, including a usage error, is null with exit 0.
 */
export function runCollabHostCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  dependencies: HostCliDependencies = {},
): { exit_code: 0 | 1; line: string | null } {
  const [verb, ...rest] = argv;
  if (verb === "knocks") return quietly(() => runKnocks(rest, env, dependencies));
  if (verb === "doorbell-scan") return quietly(() => runDoorbellScan(rest, env, dependencies));
  return runEnd(argv, env);
}

function quietly(run: () => KnockReport | DoorbellScan | null): { exit_code: 0; line: string | null } {
  try {
    const payload = run();
    return { exit_code: 0, line: payload === null ? null : JSON.stringify(payload) };
  } catch {
    return { exit_code: 0, line: null };
  }
}

function runEnd(
  argv: string[],
  env: Record<string, string | undefined>,
): { exit_code: 0 | 1; line: string } {
  let secret: string | null = null;
  const emit = (payload: HostEndReceipt | HostErrorReceipt, exitCode: 0 | 1) => {
    const line = JSON.stringify(payload);
    if (secret !== null && line.includes(secret)) {
      return {
        exit_code: 1 as const,
        line: JSON.stringify({
          protocol: COLLAB_HOST_PROTOCOL,
          status: "error",
          error: "receipt_withheld",
          message: "The receipt would have contained credential material and was withheld",
        }),
      };
    }
    return { exit_code: exitCode, line };
  };
  try {
    const args = parseHostArgs(argv);
    const databasePath = args.db ?? resolveDatabasePath(env);
    if (!existsSync(databasePath)) {
      throw new CollabError(
        "journal_not_found",
        "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB",
      );
    }
    const credential = readSessionCredentialFile(args.session_file);
    secret = credential.session_token;
    const store = new CollabStore(databasePath);
    try {
      const receipt = endSessionFromCredential(store, credential, {
        session_file: args.session_file,
        reason: args.reason,
        release_leases: args.release_leases,
      });
      // An ended session is never knocked or woken; its host binding goes with it.
      removeHostBinding(databasePath, receipt.session_id);
      return emit(receipt, 0);
    } finally {
      store.close();
    }
  } catch (error) {
    return emit(errorReceipt(error), 1);
  }
}

function parseHostArgs(argv: string[]): HostEndOptions & { db?: string } {
  let parsed: ReturnType<typeof parseHostOptions>;
  try {
    parsed = parseHostOptions(argv);
  } catch (error) {
    throw new CollabError(
      "usage_error",
      `${error instanceof Error ? error.message : String(error)}; ${COLLAB_HOST_USAGE}`,
    );
  }
  const [command, ...extra] = parsed.positionals;
  if (command !== "end" || extra.length > 0) {
    throw new CollabError("usage_error", COLLAB_HOST_USAGE);
  }
  const sessionFile = parsed.values["session-file"];
  const reason = parsed.values.reason;
  if (!sessionFile || sessionFile.trim() === "") {
    throw new CollabError("usage_error", `--session-file is required; ${COLLAB_HOST_USAGE}`);
  }
  if (!reason || reason.trim() === "") {
    throw new CollabError("usage_error", `--reason is required; ${COLLAB_HOST_USAGE}`);
  }
  // The resume raises the generation and appends an event before the end
  // judges its reason, so refuse here what endSession would refuse there.
  if (reason.trim().length > MAX_HOST_REASON) {
    throw new CollabError(
      "usage_error",
      `--reason exceeds ${MAX_HOST_REASON} characters; ${COLLAB_HOST_USAGE}`,
    );
  }
  if (reason.includes("\0")) {
    throw new CollabError("usage_error", `--reason must not contain NUL bytes; ${COLLAB_HOST_USAGE}`);
  }
  if (parsed.values.db !== undefined && parsed.values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  return {
    session_file: sessionFile,
    reason,
    release_leases: parsed.values["release-leases"] === true,
    db: parsed.values.db,
  };
}

function parseHostOptions(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "session-file": { type: "string" },
      reason: { type: "string" },
      "release-leases": { type: "boolean" },
      db: { type: "string" },
    },
  });
}

function runKnocks(
  argv: string[],
  env: Record<string, string | undefined>,
  dependencies: HostCliDependencies,
): KnockReport | null {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "host-ancestor": { type: "string" },
      "mark-tapped": { type: "boolean" },
      db: { type: "string" },
    },
  });
  if (parsed.positionals.length > 0) throw new CollabError("usage_error", COLLAB_KNOCKS_USAGE);
  const ancestor = parsed.values["host-ancestor"];
  let startPid: number;
  if (ancestor === "auto") {
    startPid = dependencies.parent_pid ?? process.ppid;
  } else if (ancestor !== undefined && /^[1-9][0-9]{0,9}$/.test(ancestor)) {
    startPid = Number(ancestor);
  } else {
    throw new CollabError("usage_error", COLLAB_KNOCKS_USAGE);
  }
  return knockForHost(selectedJournal(parsed.values.db, env), startPid, {
    ...dependencies,
    mark_tapped: parsed.values["mark-tapped"] === true,
  });
}

function runDoorbellScan(
  argv: string[],
  env: Record<string, string | undefined>,
  dependencies: HostCliDependencies,
): DoorbellScan {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { db: { type: "string" } },
  });
  if (parsed.positionals.length > 0) throw new CollabError("usage_error", COLLAB_DOORBELL_SCAN_USAGE);
  return doorbellScan(selectedJournal(parsed.values.db, env), dependencies);
}

/**
 * The read-only verbs never create a journal: a missing or blank path is an
 * error (silence), and so is any path the store itself would refuse to open
 * (a symlink, a hard-linked or foreign-owned file).
 */
function selectedJournal(db: string | undefined, env: Record<string, string | undefined>): string {
  const path = db ?? resolveDatabasePath(env);
  if (path.trim() === "" || path === ":memory:" || !existsSync(path)) {
    throw new CollabError("journal_not_found", "No collaboration journal exists at the selected path");
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !isOwnedByCurrentUser(stat.uid)) {
    throw new CollabError("database_file_unsafe", "The journal path is not a private regular file");
  }
  return path;
}

/**
 * Open the journal read-only, never through CollabStore (which takes BEGIN
 * IMMEDIATE, writes pragmas and re-verifies every journal): readonly,
 * query_only, busy_timeout 0, like the store's nonblockingEventReader.
 *
 * A WAL journal whose last connection closed cleanly may have no -wal file,
 * and a readonly connection cannot create one (SQLITE_CANTOPEN) — the
 * doorbell's usual case when no MCP is running. Only then it reads through a
 * handle that never creates the journal (create: false) and refuses every
 * write (query_only), with no transaction lock and no persistent pragma.
 */
export function openReadOnly(databasePath: string): Database {
  try {
    return prepareReader(new Database(databasePath, { readonly: true, strict: true }));
  } catch (error) {
    if ((error as { code?: unknown }).code !== "SQLITE_CANTOPEN" || !existsSync(databasePath)) throw error;
    return prepareReader(new Database(databasePath, { readwrite: true, create: false, strict: true }));
  }
}

function prepareReader(db: Database): Database {
  try {
    db.exec("PRAGMA busy_timeout = 0; PRAGMA query_only = ON");
    // The first read of the header: an unopenable WAL fails here.
    const { application_id: applicationId } = db.query("PRAGMA application_id").get() as {
      application_id: number;
    };
    if (applicationId !== COLLAB_APPLICATION_ID) {
      throw new CollabError("database_application_mismatch", "The SQLite file belongs to another application");
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * The knock for the host nearest `startPid`: walk the ancestry (start
 * inclusive) to the nearest process recorded as a binding's host with the
 * same start time. Exactly one active session must be bound there; none or
 * several (one Desktop app-server hosting several threads) is silence (null),
 * never a guess. With mark_tapped, the returned `new` items are recorded in
 * the private knock ledger before they are returned, so they never repeat;
 * a session at held rest is reported but never marked.
 */
export function knockForHost(
  databasePath: string,
  startPid: number,
  options: HostCliDependencies & { mark_tapped?: boolean } = {},
): KnockReport | null {
  const bindings = readHostBindings(databasePath);
  // Nothing bound: no ps call and no SQLite open.
  if (bindings.length === 0) return null;
  const table = (options.process_table ?? readProcessTable)();
  // ps failed or was denied (for example inside a Codex seatbelt): fail closed.
  if (!table) return null;
  const bound = boundHostFor(startPid, table, bindings);
  if (!bound) return null;
  const now = (options.now ?? (() => new Date()))();
  const db = openReadOnly(databasePath);
  let found: { session: ReadOnlySessionRow; rest: SessionRest | null; waiting: KnockItem[] } | null;
  try {
    found = db.transaction(() => {
      const active = bound.flatMap((binding) => {
        const row = sessionRowById(db, binding.session_id);
        return row?.status === "active" ? [row] : [];
      });
      if (active.length !== 1) return null;
      const session = active[0]!;
      return { session, rest: restAt(db, session, now), waiting: addressedItems(db, session) };
    })();
  } finally {
    db.close();
  }
  if (!found) return null;
  const { session, rest, waiting } = found;
  // A held rest (resting without wake_on "addressed") is never tapped: its items
  // stay unmarked, so they tap at the first turn after the session returns.
  const held = rest !== null && !rest.wake_on.includes("addressed");
  const fresh = options.mark_tapped && !held
    ? markTapped(databasePath, session.id, waiting)
    : untapped(readKnockLedger(databasePath), session.id, waiting);
  return {
    protocol: COLLAB_KNOCK_PROTOCOL,
    session_id: session.id,
    liveness: livenessAt(session, rest, now),
    rest,
    waiting: waiting.length,
    new: fresh,
  };
}

/**
 * Resting sessions that asked to be woken for addressed notes (`wake_on`
 * includes "addressed", rest unexpired, session active) and have waiting
 * items no tap has announced yet, each with its host binding or null.
 */
export function doorbellScan(
  databasePath: string,
  options: Pick<HostCliDependencies, "now"> = {},
): DoorbellScan {
  const now = (options.now ?? (() => new Date()))();
  const ledger = readKnockLedger(databasePath);
  const bindings = new Map(readHostBindings(databasePath).map((binding) => [binding.session_id, binding]));
  const db = openReadOnly(databasePath);
  try {
    const sessions = db.transaction(() => {
      const rows = db.query(`
        SELECT s.id, s.workspace_id, s.actor, s.status, s.last_seen_at, s.cursor_sequence,
          w.root_path AS worktree_root
        FROM coordination_sessions s
        JOIN worktrees w ON w.id = s.worktree_id
        WHERE s.status = 'active'
        ORDER BY s.joined_at, s.id
      `).all() as Array<ReadOnlySessionRow & { worktree_root: string }>;
      const found: DoorbellScanSession[] = [];
      for (const row of rows) {
        const rest = restAt(db, row, now);
        if (!rest || !rest.wake_on.includes("addressed")) continue;
        const waiting = addressedItems(db, row);
        const fresh = untapped(ledger, row.id, waiting);
        if (fresh.length === 0) continue;
        found.push({
          session_id: row.id,
          workspace_id: row.workspace_id,
          worktree_root: row.worktree_root,
          actor: row.actor,
          rest,
          waiting: waiting.length,
          new: fresh,
          binding: bindings.get(row.id) ?? null,
        });
      }
      return found;
    })();
    return { protocol: COLLAB_DOORBELL_SCAN_PROTOCOL, sessions };
  } finally {
    db.close();
  }
}

interface ReadOnlySessionRow {
  id: string;
  workspace_id: string;
  actor: string;
  status: string;
  last_seen_at: string;
  cursor_sequence: number;
}

/**
 * The bindings that may answer for the host nearest `startPid`. A recognised
 * host with no binding stops the walk, so a nested Codex never borrows the
 * Claude seat's knocks. A binding counts only while its mcp_pid is still a
 * collab MCP and that host's direct child (an exited MCP's reused pid is not).
 * An app-server must run exactly one collab MCP, since a hook cannot tell its
 * threads apart.
 */
function boundHostFor(
  startPid: number,
  table: ProcessTable,
  bindings: HostBinding[],
): HostBinding[] | null {
  for (const record of ancestry(startPid, table)) {
    const matched = bindings.filter(
      (binding) => binding.host_pid === record.pid && binding.host_started_at === record.started_at,
    );
    if (matched.length > 0) {
      if (hostKindOf(record, {}) === "codex-app-server" && collabChildren(table, record).length !== 1) {
        return null;
      }
      const live = matched.filter((binding) => {
        const mcp = table.get(binding.mcp_pid);
        return mcp !== undefined && mcp.ppid === record.pid && isCollabMcpProcess(mcp);
      });
      return live.length > 0 ? live : null;
    }
    if (isHostProcess(record)) return null;
  }
  return null;
}

function collabChildren(table: ProcessTable, host: ProcessRecord): ProcessRecord[] {
  return [...table.values()].filter((record) => record.ppid === host.pid && isCollabMcpProcess(record));
}

function sessionRowById(db: Database, sessionId: string): ReadOnlySessionRow | null {
  return db.query(`
    SELECT id, workspace_id, actor, status, last_seen_at, cursor_sequence
    FROM coordination_sessions WHERE id = ?
  `).get(sessionId) as ReadOnlySessionRow | null;
}

/**
 * The session's declared rest at `now`: the store's own latestRestDeclaration
 * query run on the read-only handle, judged by the store's restFromDeclaration
 * (returned, expired or damaged reads as no rest).
 */
function restAt(db: Database, session: ReadOnlySessionRow, now: Date): SessionRest | null {
  const declaration = db.query(`
    SELECT type, sequence, occurred_at, payload_json FROM events
    WHERE workspace_id = ? AND entity_id = ?
      AND type IN ('session.rested', 'session.returned')
    ORDER BY sequence DESC
    LIMIT 1
  `).get(session.workspace_id, session.id) as RestDeclarationRow | null;
  return declaration ? restFromDeclaration(declaration, now.toISOString()) : null;
}

/** Precedence ended → resting → stale → live, as the store derives it. */
function livenessAt(session: ReadOnlySessionRow, rest: SessionRest | null, now: Date): SessionLiveness {
  if (session.status !== "active") return "ended";
  if (rest) return "resting";
  const age = now.getTime() - Date.parse(session.last_seen_at);
  return age <= SESSION_STALE_AFTER_MS ? "live" : "stale";
}

/**
 * Addressed items past the session's acknowledged cursor, judged by the
 * store's own isAddressedTo, so `waiting` always equals collab_next's
 * addressed_waiting.
 */
function addressedItems(db: Database, session: ReadOnlySessionRow): KnockItem[] {
  const rows = db.query(`
    SELECT sequence, type, actor, entity_id, session_id, payload_json FROM events
    WHERE workspace_id = ? AND sequence > ?
      AND type IN ('report.posted', 'handoff.offered')
    ORDER BY sequence
  `).all(session.workspace_id, session.cursor_sequence) as Array<
    AddressedEventRow & { sequence: number; actor: string; entity_id: string }
  >;
  return rows
    .filter((row) => isAddressedTo(row, session.id))
    .map((row) => ({
      seq: row.sequence,
      kind: row.type as KnockItem["kind"],
      from_actor: row.actor,
      ref_id: row.entity_id,
    }));
}

interface KnockLedger {
  format: typeof KNOCK_LEDGER_FORMAT;
  tapped: Record<string, number[]>;
}

/** `dirname(db)/collab-sessions/knock-ledger.json`: which items a tap has already announced. */
export function knockLedgerPath(databasePath: string): string {
  return join(collabSessionsDirectory(databasePath), "knock-ledger.json");
}

function untapped(ledger: KnockLedger, sessionId: string, waiting: KnockItem[]): KnockItem[] {
  const tapped = new Set(ledger.tapped[sessionId] ?? []);
  return waiting.filter((item) => !tapped.has(item.seq));
}

/** Missing reads as empty; an unsafe or damaged ledger refuses (the caller stays silent). */
function readKnockLedger(databasePath: string): KnockLedger {
  const path = knockLedgerPath(databasePath);
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { format: KNOCK_LEDGER_FORMAT, tapped: {} };
    }
    throw error;
  }
  if (!isPrivateRegularFile(stat)) {
    throw new CollabError("knock_ledger_unsafe", "The knock ledger is not a private regular file");
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isKnockLedger(parsed)) {
    throw new CollabError("knock_ledger_invalid", "The knock ledger is malformed");
  }
  return parsed;
}

/**
 * Record the untapped items under an exclusive ledger lock and return them.
 * A held lock means another tap is in progress: refuse (silence) rather than
 * risk announcing an item twice; the next turn taps it.
 */
function markTapped(databasePath: string, sessionId: string, waiting: KnockItem[]): KnockItem[] {
  if (untapped(readKnockLedger(databasePath), sessionId, waiting).length === 0) return [];
  return withLedgerLock(databasePath, () => {
    const ledger = readKnockLedger(databasePath);
    const fresh = untapped(ledger, sessionId, waiting);
    if (fresh.length === 0) return [];
    // Keep only sequences still waiting: acknowledged items never return.
    const stillWaiting = new Set(waiting.map((item) => item.seq));
    const kept = (ledger.tapped[sessionId] ?? []).filter((seq) => stillWaiting.has(seq));
    const tapped = [...new Set([...kept, ...fresh.map((item) => item.seq)])].sort((left, right) => left - right);
    writeKnockLedger(databasePath, {
      format: KNOCK_LEDGER_FORMAT,
      tapped: { ...ledger.tapped, [sessionId]: tapped },
    });
    return fresh;
  });
}

function withLedgerLock<T>(databasePath: string, run: () => T): T {
  const lock = `${knockLedgerPath(databasePath)}.lock`;
  const acquire = () => closeSync(openSync(lock, "wx", 0o600));
  try {
    acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (Date.now() - lstatSync(lock).mtimeMs < LEDGER_LOCK_STALE_MS) {
      throw new CollabError("knock_ledger_busy", "Another tap holds the knock ledger");
    }
    unlinkSync(lock);
    acquire();
  }
  try {
    return run();
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      // A lock that cannot be removed expires after LEDGER_LOCK_STALE_MS.
    }
  }
}

function writeKnockLedger(databasePath: string, ledger: KnockLedger): void {
  const directory = collabSessionsDirectory(databasePath);
  const directoryStat = lstatSync(directory);
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || !isOwnedByCurrentUser(directoryStat.uid)
    || (directoryStat.mode & 0o077) !== 0
  ) {
    throw new CollabError("session_directory_not_private", "The collab-sessions directory is not private");
  }
  const path = knockLedgerPath(databasePath);
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(ledger)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Already renamed or never created.
    }
    throw error;
  }
}

function isKnockLedger(value: unknown): value is KnockLedger {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.format !== KNOCK_LEDGER_FORMAT) return false;
  const tapped = record.tapped;
  if (tapped === null || typeof tapped !== "object" || Array.isArray(tapped)) return false;
  return Object.entries(tapped).every(([sessionId, sequences]) =>
    SESSION_ID.test(sessionId)
    && Array.isArray(sequences)
    && sequences.every((sequence) => Number.isInteger(sequence) && sequence > 0)
  );
}

function isPrivateRegularFile(stat: Stats): boolean {
  return (
    stat.isFile()
    && !stat.isSymbolicLink()
    && isOwnedByCurrentUser(stat.uid)
    && (stat.mode & 0o077) === 0
  );
}

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

function errorReceipt(error: unknown): HostErrorReceipt {
  if (error instanceof CollabError) {
    return {
      ...error.details,
      protocol: COLLAB_HOST_PROTOCOL,
      status: "error",
      error: error.code,
      message: error.message,
    };
  }
  return {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "error",
    error: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
