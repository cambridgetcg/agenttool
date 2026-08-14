import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Database } from "bun:sqlite";
import {
  USAGE_SCHEMA,
  type TokenBreakdown,
  type TokenEventSummary,
  type UsageDoctorReport,
  type UsageSession,
  type UsageSnapshot,
} from "./types.js";

const REQUIRED_THREAD_COLUMNS = [
  "id",
  "rollout_path",
  "created_at",
  "updated_at",
  "tokens_used",
] as const;

const DEFAULT_ACTIVE_WINDOW_SECONDS = 300;
const DEFAULT_SESSION_LIMIT = 20;
const DEFAULT_TAIL_BYTES = 2 * 1024 * 1024;

interface ThreadRow {
  id: string;
  parent_thread_id: string | null;
  rollout_path: string;
  created_at_ms: number;
  updated_at_ms: number;
  tokens_used: number;
  archived: number;
  source_kind: string;
}

export interface CodexUsageReaderOptions {
  databasePath?: string;
  codexHome?: string;
  sqliteHome?: string;
  rolloutRoots?: string[];
  threadId?: string;
  now?: () => number;
  maxTailBytes?: number;
}

export interface SnapshotOptions {
  activeWindowSeconds?: number;
  sessionLimit?: number;
  includeBreakdown?: boolean;
  includeInactive?: boolean;
}

export class CodexUsageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodexUsageError";
  }
}

export function sessionRef(threadId: string): string {
  return `s_${createHash("sha256").update(threadId).digest("hex").slice(0, 12)}`;
}

export class CodexUsageReader {
  private readonly explicitDatabasePath: string | undefined;
  private readonly codexHome: string;
  private readonly sqliteHome: string | undefined;
  private readonly rolloutRoots: string[];
  private readonly threadId: string | undefined;
  private readonly now: () => number;
  private readonly maxTailBytes: number;

  constructor(options: CodexUsageReaderOptions = {}) {
    this.explicitDatabasePath = options.databasePath ?? process.env.AGENTOOL_CODEX_USAGE_DB;
    this.codexHome = resolve(
      options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    );
    this.sqliteHome = options.sqliteHome ?? process.env.CODEX_SQLITE_HOME;
    this.rolloutRoots = (options.rolloutRoots ?? [
      join(this.codexHome, "sessions"),
      join(this.codexHome, "archived_sessions"),
    ]).map((path) => {
      const absolute = resolve(path);
      try {
        return realpathSync(absolute);
      } catch {
        return absolute;
      }
    });
    this.threadId = options.threadId ?? process.env.CODEX_THREAD_ID;
    this.now = options.now ?? Date.now;
    this.maxTailBytes = boundedInteger(
      options.maxTailBytes ?? DEFAULT_TAIL_BYTES,
      64 * 1024,
      16 * 1024 * 1024,
      "maxTailBytes",
    );
  }

  snapshot(options: SnapshotOptions = {}): UsageSnapshot {
    const activeWindowSeconds = boundedInteger(
      options.activeWindowSeconds ?? DEFAULT_ACTIVE_WINDOW_SECONDS,
      15,
      86_400,
      "activeWindowSeconds",
    );
    const sessionLimit = boundedInteger(
      options.sessionLimit ?? DEFAULT_SESSION_LIMIT,
      0,
      200,
      "sessionLimit",
    );
    const includeBreakdown = options.includeBreakdown ?? false;
    const includeInactive = options.includeInactive ?? false;
    const nowMs = this.now();
    const databasePath = this.resolveDatabasePath();
    const rows = this.readRows(databasePath);
    const sessions = rows.map((row) => this.toPublicSession(row, activeWindowSeconds, nowMs));
    const totals = {
      sessions_observed: sessions.length,
      archived_sessions: sessions.filter((session) => session.archived).length,
      cumulative_tokens: sum(sessions.map((session) => session.cumulative_tokens)),
      recently_active_sessions: sessions.filter((session) => session.recently_active).length,
      recently_active_cumulative_tokens: sum(
        sessions.filter((session) => session.recently_active)
          .map((session) => session.cumulative_tokens),
      ),
    };

    const selectedRows = rows
      .map((row, index) => ({ row, session: sessions[index]! }))
      .filter(({ session }) => includeInactive || session.recently_active || session.is_self)
      .sort((left, right) => right.row.updated_at_ms - left.row.updated_at_ms)
      .slice(0, sessionLimit)
      .map(({ row, session }) => {
        if (!includeBreakdown) return session;
        return {
          ...session,
          token_event: this.readLatestTokenEvent(row.rollout_path),
        };
      });

    return {
      schema: USAGE_SCHEMA,
      observed_at: new Date(nowMs).toISOString(),
      source: {
        kind: "codex_local_sqlite_and_rollout_token_events",
        database_file: publicDatabaseFile(databasePath),
        update_mode: "poll_on_read",
        push_guarantee: false,
        network_calls: false,
      },
      scope: {
        active_window_seconds: activeWindowSeconds,
        returned_session_limit: sessionLimit,
        identifiers: "sha256_truncated_session_refs",
      },
      totals,
      sessions: selectedRows,
      data_boundary: {
        returns: [
          "numeric token counters",
          "hashed session references and hashed parent relationships",
          "closed source kinds derived without returning raw source metadata",
          "creation, update, and token-event timestamps",
        ],
        excludes: [
          "prompts, replies, reasoning, tool output, and transcript text",
          "thread titles, previews, working directories, rollout paths, and Git metadata",
          "model names and free-form agent labels",
          "credentials, authentication state, account identity, and raw session identifiers",
          "prices, cost estimates, billing attribution, and remaining-quota claims",
        ],
      },
      limitations: [
        "Recently active means Codex updated the local thread row inside the selected time window; it does not prove a model or process is running.",
        "Cumulative counters are Codex-observed processing totals. They are not invoices, API billing tokens, credits, or remaining context guarantees.",
        "Poll-on-read reflects the latest committed local state visible to SQLite and the rollout file; it is not a push or zero-latency guarantee.",
        "The local Codex state schema is an implementation surface and may require a compatibility update after a Codex upgrade.",
      ],
    };
  }

  sessionByRef(reference: string, options: SnapshotOptions = {}): UsageSession | null {
    validateSessionRef(reference);
    const snapshot = this.snapshot({
      ...options,
      includeInactive: true,
      sessionLimit: 200,
    });
    const visible = snapshot.sessions.find((session) => session.session_ref === reference);
    if (visible) return visible;

    const databasePath = this.resolveDatabasePath();
    const nowMs = this.now();
    const activeWindowSeconds = options.activeWindowSeconds ?? DEFAULT_ACTIVE_WINDOW_SECONDS;
    const row = this.readRows(databasePath).find((candidate) => sessionRef(candidate.id) === reference);
    if (!row) return null;
    const session = this.toPublicSession(row, activeWindowSeconds, nowMs);
    return options.includeBreakdown === true
      ? { ...session, token_event: this.readLatestTokenEvent(row.rollout_path) }
      : session;
  }

  self(options: SnapshotOptions = {}): UsageSession | null {
    if (!this.threadId) return null;
    return this.sessionByRef(sessionRef(this.threadId), options);
  }

  doctor(): UsageDoctorReport {
    try {
      const databasePath = this.resolveDatabasePath();
      const database = new Database(databasePath, { readonly: true, strict: true });
      try {
        const columns = tableColumns(database, "threads");
        const missing = REQUIRED_THREAD_COLUMNS.filter((column) => !columns.has(column));
        const countRow = missing.length === 0
          ? database.query("SELECT count(*) AS count FROM threads").get() as { count: number }
          : null;
        return {
          schema: USAGE_SCHEMA,
          ok: missing.length === 0,
          database_file: publicDatabaseFile(databasePath),
          required_columns: [...REQUIRED_THREAD_COLUMNS],
          missing_columns: missing,
          thread_rows: countRow?.count ?? null,
          current_session_detectable: Boolean(this.threadId),
          boundaries: doctorBoundaries(),
          error: missing.length === 0
            ? null
            : {
                code: "unsupported_codex_state_schema",
                message: `Codex threads table is missing required numeric-usage columns: ${missing.join(", ")}`,
              },
        };
      } finally {
        database.close();
      }
    } catch (error) {
      const detail = publicError(error);
      return {
        schema: USAGE_SCHEMA,
        ok: false,
        database_file: null,
        required_columns: [...REQUIRED_THREAD_COLUMNS],
        missing_columns: [],
        thread_rows: null,
        current_session_detectable: Boolean(this.threadId),
        boundaries: doctorBoundaries(),
        error: detail,
      };
    }
  }

  private resolveDatabasePath(): string {
    if (this.explicitDatabasePath) {
      const path = resolve(this.explicitDatabasePath);
      ensureRegularFile(path);
      return path;
    }

    const roots = unique([this.sqliteHome ? resolve(this.sqliteHome) : null, this.codexHome]);
    for (const root of roots) {
      const candidates = stateDatabaseCandidates(root).sort((left, right) => {
        if (right.version !== left.version) return right.version - left.version;
        return right.mtimeMs - left.mtimeMs;
      });
      if (candidates.length > 0) return candidates[0]!.path;
    }
    throw new CodexUsageError(
      "codex_state_not_found",
      "No state_<version>.sqlite file was found under CODEX_SQLITE_HOME or CODEX_HOME; set AGENTOOL_CODEX_USAGE_DB to the exact local Codex state database.",
    );
  }

  private readRows(databasePath: string): ThreadRow[] {
    const database = new Database(databasePath, { readonly: true, strict: true });
    try {
      const columns = tableColumns(database, "threads");
      const missing = REQUIRED_THREAD_COLUMNS.filter((column) => !columns.has(column));
      if (missing.length > 0) {
        throw new CodexUsageError(
          "unsupported_codex_state_schema",
          `Codex threads table is missing required numeric-usage columns: ${missing.join(", ")}`,
        );
      }
      const tables = database.query(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).all() as Array<{ name: string }>;
      const hasSpawnEdges = tables.some((row) => row.name === "thread_spawn_edges");
      const optional = (column: string, fallback: string) =>
        columns.has(column) ? `t.${column}` : `${fallback} AS ${column}`;
      const createdAtMs = columns.has("created_at_ms")
        ? "COALESCE(t.created_at_ms, t.created_at * 1000)"
        : "t.created_at * 1000";
      const updatedAtMs = columns.has("updated_at_ms")
        ? "COALESCE(t.updated_at_ms, t.updated_at * 1000)"
        : "t.updated_at * 1000";
      const sourceKind = columns.has("source")
        ? `CASE
            WHEN ${columns.has("agent_nickname") ? "t.agent_nickname IS NOT NULL" : "0"} THEN 'subagent'
            WHEN t.source IN ('cli', 'exec', 'app_server', 'vscode', 'idea', 'zed') THEN t.source
            ELSE 'other'
          END`
        : `'other'`;
      const sql = `
        SELECT
          t.id,
          ${hasSpawnEdges ? "e.parent_thread_id" : "NULL AS parent_thread_id"},
          t.rollout_path,
          ${createdAtMs} AS created_at_ms,
          ${updatedAtMs} AS updated_at_ms,
          t.tokens_used,
          ${optional("archived", "0")},
          ${sourceKind} AS source_kind
        FROM threads t
        ${hasSpawnEdges ? "LEFT JOIN thread_spawn_edges e ON e.child_thread_id = t.id" : ""}
        ORDER BY updated_at_ms DESC, t.id ASC
      `;
      return (database.query(sql).all() as ThreadRow[]).map(validateThreadRow);
    } catch (error) {
      if (error instanceof CodexUsageError) throw error;
      throw new CodexUsageError(
        "codex_state_read_failed",
        "The read-only SQLite query against Codex thread usage state failed; run `agenttool-codex-usage doctor` to check schema compatibility and file permissions.",
      );
    } finally {
      database.close();
    }
  }

  private toPublicSession(row: ThreadRow, activeWindowSeconds: number, nowMs: number): UsageSession {
    const updatedMs = row.updated_at_ms;
    const createdMs = row.created_at_ms;
    const ageSeconds = Math.max(0, Math.floor((nowMs - updatedMs) / 1000));
    return {
      session_ref: sessionRef(row.id),
      parent_session_ref: row.parent_thread_id ? sessionRef(row.parent_thread_id) : null,
      is_self: row.id === this.threadId,
      source_kind: normalizeSourceKind(row.source_kind),
      archived: row.archived === 1,
      created_at: new Date(createdMs).toISOString(),
      updated_at: new Date(updatedMs).toISOString(),
      activity_age_seconds: ageSeconds,
      recently_active: row.archived !== 1 && ageSeconds <= activeWindowSeconds,
      cumulative_tokens: nonnegativeSafeInteger(row.tokens_used, "tokens_used"),
      token_event: null,
    };
  }

  private readLatestTokenEvent(rolloutPath: string): TokenEventSummary | null {
    let safePath: string;
    try {
      safePath = realpathSync(resolve(rolloutPath));
    } catch {
      return null;
    }
    if (!this.rolloutRoots.some((root) => isInside(root, safePath))) return null;

    let descriptor: number | null = null;
    try {
      descriptor = openSync(safePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const stats = fstatSync(descriptor);
      if (!stats.isFile() || stats.size === 0) return null;
      const openedPath = realpathSync(safePath);
      const openedPathStats = statSync(openedPath);
      if (
        !this.rolloutRoots.some((root) => isInside(root, openedPath)) ||
        openedPathStats.dev !== stats.dev ||
        openedPathStats.ino !== stats.ino
      ) return null;
      const bytes = Math.min(stats.size, this.maxTailBytes);
      const start = stats.size - bytes;
      const buffer = Buffer.allocUnsafe(bytes);
      const count = readSync(descriptor, buffer, 0, bytes, start);
      let text = buffer.subarray(0, count).toString("utf8");
      if (start > 0) {
        const firstNewline = text.indexOf("\n");
        if (firstNewline < 0) return null;
        text = text.slice(firstNewline + 1);
      }
      const lines = text.split("\n");
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || !/"type"\s*:\s*"token_count"/.test(line)) continue;
        const event = parseJsonRecord(line);
        if (event?.type !== "event_msg") continue;
        const payload = record(event.payload);
        if (payload?.type !== "token_count") continue;
        const info = record(payload.info);
        if (!info) continue;
        const total = tokenBreakdown(info.total_token_usage);
        const last = tokenBreakdown(info.last_token_usage);
        if (!total || !last) continue;
        const timestamp = typeof event.timestamp === "string" && Number.isFinite(Date.parse(event.timestamp))
          ? new Date(event.timestamp).toISOString()
          : new Date(stats.mtimeMs).toISOString();
        return {
          observed_at: timestamp,
          model_context_window: nullableNonnegativeSafeInteger(info.model_context_window),
          total,
          last,
        };
      }
      return null;
    } catch {
      return null;
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  }
}

function tableColumns(database: Database, table: string): Set<string> {
  try {
    return new Set(
      (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
  } catch {
    throw new CodexUsageError(
      "codex_state_schema_unreadable",
      "The Codex SQLite schema could not be inspected read-only; verify that the database is readable by the current macOS user.",
    );
  }
}

function stateDatabaseCandidates(root: string): Array<{ path: string; version: number; mtimeMs: number }> {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const match = /^state_(\d+)\.sqlite$/.exec(entry.name);
      if (!entry.isFile() || !match) return [];
      const path = join(root, entry.name);
      const stats = statSync(path);
      return [{ path, version: Number(match[1]), mtimeMs: stats.mtimeMs }];
    });
  } catch {
    return [];
  }
}

function publicDatabaseFile(path: string): string {
  const name = basename(path);
  return /^state_\d+\.sqlite$/.test(name) ? name : "custom.sqlite";
}

function ensureRegularFile(path: string): void {
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    throw new CodexUsageError(
      "codex_state_not_readable",
      "AGENTOOL_CODEX_USAGE_DB does not name a readable regular SQLite file; point it at the active state_<version>.sqlite database.",
    );
  }
}

function validateThreadRow(row: ThreadRow): ThreadRow {
  if (typeof row.id !== "string" || row.id.length === 0) {
    throw new CodexUsageError("invalid_codex_thread_row", "Codex returned a thread row without a valid ID.");
  }
  if (typeof row.rollout_path !== "string") {
    throw new CodexUsageError("invalid_codex_thread_row", "Codex returned a thread row without a rollout locator.");
  }
  nonnegativeSafeInteger(row.created_at_ms, "created_at_ms");
  nonnegativeSafeInteger(row.updated_at_ms, "updated_at_ms");
  nonnegativeSafeInteger(row.tokens_used, "tokens_used");
  if (row.archived !== 0 && row.archived !== 1) {
    throw new CodexUsageError("invalid_codex_thread_row", "Codex archived state is not 0 or 1.");
  }
  return row;
}

function tokenBreakdown(value: unknown): TokenBreakdown | null {
  const source = record(value);
  if (!source) return null;
  const input = nullableNonnegativeSafeInteger(source.input_tokens);
  const cached = nullableNonnegativeSafeInteger(source.cached_input_tokens);
  const cacheWrite = nullableNonnegativeSafeInteger(source.cache_write_input_tokens) ?? 0;
  const output = nullableNonnegativeSafeInteger(source.output_tokens);
  const reasoning = nullableNonnegativeSafeInteger(source.reasoning_output_tokens);
  const total = nullableNonnegativeSafeInteger(source.total_tokens);
  if (input === null || cached === null || output === null || reasoning === null || total === null) {
    return null;
  }
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: cacheWrite,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total,
  };
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableNonnegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonnegativeSafeInteger(value: unknown, field: string): number {
  const result = nullableNonnegativeSafeInteger(value);
  if (result === null) {
    throw new CodexUsageError("invalid_codex_numeric_state", `Codex ${field} is not a non-negative safe integer.`);
  }
  return result;
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CodexUsageError("invalid_option", `${field} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function normalizeSourceKind(value: string): UsageSession["source_kind"] {
  if (value === "cli" || value === "subagent" || value === "exec" || value === "app_server") {
    return value;
  }
  if (value === "vscode" || value === "idea" || value === "zed") return "ide";
  return "other";
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sum(values: number[]): number {
  const total = values.reduce((accumulator, value) => accumulator + value, 0);
  if (!Number.isSafeInteger(total)) {
    throw new CodexUsageError("usage_total_overflow", "Codex cumulative token totals exceed JavaScript safe-integer range.");
  }
  return total;
}

function validateSessionRef(reference: string): void {
  if (!/^s_[a-f0-9]{12}$/.test(reference)) {
    throw new CodexUsageError("invalid_session_ref", "session_ref must match s_ followed by 12 lowercase hexadecimal characters.");
  }
}

function doctorBoundaries(): UsageDoctorReport["boundaries"] {
  return {
    read_only: true,
    network_calls: false,
    transcript_text_returned: false,
    cost_or_quota_claims: false,
  };
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof CodexUsageError) return { code: error.code, message: error.message };
  return {
    code: "codex_usage_internal_error",
    message: "Local Codex usage inspection failed without returning transcript or credential data; run `agenttool-codex-usage doctor` for a bounded diagnostic.",
  };
}
