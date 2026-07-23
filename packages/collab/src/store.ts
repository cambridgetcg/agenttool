import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";
import {
  COLLAB_PROTOCOL,
  COLLAB_SESSION_PROTOCOL,
  type ArtifactRef,
  type ClaimTaskInput,
  type CollabSession,
  type CollabEvent,
  type CollabEventType,
  type CreateTaskInput,
  type Decision,
  type HeartbeatSessionInput,
  type HandoffOffer,
  type JoinSessionInput,
  type JournalPage,
  type LeaseTaskInput,
  type MutationContext,
  type SessionMutationInput,
  type SessionPresence,
  type Task,
  type TaskStatus,
  type VersionedMutationContext,
  type Workspace,
  type WorkspaceStatus,
} from "./protocol.js";

const GENESIS_HASH = "0".repeat(64);
const DEFAULT_LEASE_SECONDS = 15 * 60;
const MAX_LEASE_SECONDS = 60 * 60;
const MAX_TEXT = 8_000;
const MAX_DEPENDENCIES = 128;
const MAX_PATH_SCOPES = 128;
const MAX_PATH_SCOPE_LENGTH = 500;
const MAX_PATH_SCOPES_TOTAL = 16_000;
const DEFAULT_PRESENCE_SECONDS = 2 * 60;
const MAX_PRESENCE_SECONDS = 60 * 60;
const MAX_SESSION_CAPABILITIES = 32;
const MAX_SESSION_CAPABILITY_LENGTH = 100;
const DEFAULT_SESSION_LIST_LIMIT = 100;
const MAX_SESSION_LIST_LIMIT = 500;

type Clock = () => Date;

interface WorkspaceRow {
  id: string;
  epoch_id: string;
  root_path: string;
  name: string;
  created_at: string;
  event_head_sequence: number;
  event_head_hash: string;
}

interface TaskRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dependencies_json: string;
  path_scopes_json: string;
  assignee: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  blocker: string | null;
  latest_progress: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ArtifactRow {
  id: string;
  task_id: string;
  kind: ArtifactRef["kind"];
  uri: string;
  sha256: string | null;
  media_type: string | null;
  label: string | null;
  attached_by: string;
  attached_at: string;
}

interface DecisionRow {
  id: string;
  workspace_id: string;
  topic: string;
  decision: string;
  rationale: string | null;
  recorded_by: string;
  recorded_at: string;
}

interface HandoffRow {
  id: string;
  workspace_id: string;
  task_id: string;
  from_actor: string;
  to_actor: string;
  summary: string;
  status: HandoffOffer["status"];
  offered_at: string;
  expires_at: string;
  resolved_at: string | null;
}

interface EventRow {
  protocol: typeof COLLAB_PROTOCOL;
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  id: string;
  type: CollabEventType;
  entity_id: string;
  actor: string;
  occurred_at: string;
  payload_json: string;
  prev_hash: string;
  hash: string;
}

interface MutationRow {
  operation: string;
  request_hash: string;
  response_json: string;
}

interface SessionRow {
  id: string;
  workspace_id: string;
  epoch_id: string;
  client_instance_id: string;
  actor_label: string;
  actor_key: string;
  runtime_kind: string;
  provider_label: string | null;
  model_label: string | null;
  declared_capabilities_json: string;
  version: number;
  joined_at: string;
  last_seen_at: string;
  presence_expires_at: string;
  left_at: string | null;
}

export interface CollabStoreOptions {
  now?: Clock;
}

export class CollabStore {
  readonly db: Database;
  private readonly now: Clock;
  private readonly filesystemPath?: string;

  constructor(path: string, options: CollabStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    const databasePath = path === ":memory:" ? path : resolve(path);
    if (databasePath !== ":memory:") {
      const parent = dirname(databasePath);
      const parentAlreadyExisted = existsSync(parent);
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      // Never change a caller-owned existing directory such as /tmp or a repo.
      // We can tighten the dedicated directory only when this store created it.
      if (!parentAlreadyExisted) chmodSync(parent, 0o700);
      const descriptor = openSync(databasePath, "a", 0o600);
      closeSync(descriptor);
      chmodSync(databasePath, 0o600);
      this.filesystemPath = databasePath;
    }
    this.db = new Database(databasePath, { create: true, strict: true });
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (this.db.filename !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        epoch_id TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_head_sequence INTEGER NOT NULL DEFAULT 0,
        event_head_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        epoch_id TEXT NOT NULL,
        client_instance_id TEXT NOT NULL,
        actor_label TEXT NOT NULL,
        actor_key TEXT NOT NULL UNIQUE,
        runtime_kind TEXT NOT NULL,
        provider_label TEXT,
        model_label TEXT,
        declared_capabilities_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        presence_expires_at TEXT NOT NULL,
        left_at TEXT,
        UNIQUE (workspace_id, client_instance_id)
      );
      CREATE INDEX IF NOT EXISTS sessions_workspace_presence_idx
        ON sessions(workspace_id, left_at, presence_expires_at);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK(status IN ('open', 'claimed', 'blocked', 'completed')),
        dependencies_json TEXT NOT NULL,
        path_scopes_json TEXT NOT NULL,
        assignee TEXT,
        lease_id TEXT,
        lease_expires_at TEXT,
        blocker TEXT,
        latest_progress TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS tasks_workspace_status_idx
        ON tasks(workspace_id, status, lease_expires_at);
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('file', 'commit', 'test', 'data', 'url', 'other')),
        uri TEXT NOT NULL,
        sha256 TEXT,
        media_type TEXT,
        label TEXT,
        attached_by TEXT NOT NULL,
        attached_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS artifacts_task_idx ON artifacts(workspace_id, task_id, attached_at);
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        topic TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT,
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS decisions_workspace_idx ON decisions(workspace_id, recorded_at);
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        from_actor TEXT NOT NULL,
        to_actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'expired')),
        offered_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS handoffs_target_idx
        ON handoffs(workspace_id, to_actor, status, expires_at);
      CREATE TABLE IF NOT EXISTS events (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        epoch_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        id TEXT NOT NULL UNIQUE,
        protocol TEXT NOT NULL,
        type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (workspace_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS mutations (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        actor TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, actor, idempotency_key)
      );
    `);
    this.tightenFileModes();
  }

  private tightenFileModes(): void {
    if (!this.filesystemPath) return;
    for (const path of [this.filesystemPath, `${this.filesystemPath}-wal`, `${this.filesystemPath}-shm`]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }

  openWorkspace(input: { root_path: string; name?: string; actor: string }): Workspace {
    const actor = validateActor(input.actor);
    const requested = resolve(input.root_path);
    if (!existsSync(requested) || !statSync(requested).isDirectory()) {
      throw new CollabError("workspace_not_directory", "Workspace root must be an existing directory", {
        root_path: requested,
      });
    }
    const rootPath = realpathSync(requested);
    const id = `ws_${sha256(rootPath).slice(0, 24)}`;
    const existing = this.getWorkspace(id);
    if (existing) return existing;

    const created = this.db.transaction(() => {
      const raced = this.getWorkspace(id);
      if (raced) return raced;
      const now = this.timestamp();
      const epochId = `epoch_${randomUUID()}`;
      const name = cleanText(input.name ?? rootPath.split("/").at(-1) ?? id, "name", 200);
      this.db.query(`
        INSERT INTO workspaces
          (id, epoch_id, root_path, name, created_at, event_head_sequence, event_head_hash)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run(id, epochId, rootPath, name, now, GENESIS_HASH);
      this.appendEvent(id, "workspace.opened", id, actor, {
        root_path: rootPath,
        name,
        rights_profile: "xenia.rights/0.1",
      });
      return this.requireWorkspace(id);
    }).immediate();
    this.tightenFileModes();
    return created;
  }

  getWorkspace(workspaceId: string): Workspace | null {
    const row = this.db.query(`
      SELECT id, epoch_id, root_path, name, created_at, event_head_sequence, event_head_hash
      FROM workspaces WHERE id = ?
    `).get(workspaceId) as WorkspaceRow | null;
    return row ? { ...row } : null;
  }

  joinSession(input: JoinSessionInput): CollabSession {
    const normalized = {
      workspace_id: validateId(input.workspace_id, "workspace_id"),
      client_instance_id: validateId(input.client_instance_id, "client_instance_id"),
      actor_label: validateActor(input.actor_label),
      runtime_kind: validateRuntimeKind(input.runtime_kind),
      provider_label: optionalText(input.provider_label, "provider_label", 100),
      model_label: optionalText(input.model_label, "model_label", 200),
      declared_capabilities: normalizeSessionCapabilities(input.declared_capabilities ?? []),
      ttl_seconds: validatePresenceTtl(input.ttl_seconds),
    };
    const workspace = this.requireWorkspace(normalized.workspace_id);
    const transaction = this.db.transaction(() => {
      const existing = this.readSessionByClient(
        normalized.workspace_id,
        normalized.client_instance_id,
      );
      if (existing) {
        requireMatchingSessionJoin(existing, normalized);
        if (existing.left_at) {
          throw new CollabError(
            "session_instance_ended",
            "This client instance already left; start a new incarnation with a new client_instance_id",
            { session_id: existing.id },
          );
        }
        return sessionFromRow(existing, this.timestamp());
      }

      const now = this.timestamp();
      const id = `session_${randomUUID()}`;
      const actorKey = `session:${id}`;
      this.db.query(`
        INSERT INTO sessions (
          id, workspace_id, epoch_id, client_instance_id, actor_label, actor_key,
          runtime_kind, provider_label, model_label, declared_capabilities_json,
          version, joined_at, last_seen_at, presence_expires_at, left_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
      `).run(
        id,
        workspace.id,
        workspace.epoch_id,
        normalized.client_instance_id,
        normalized.actor_label,
        actorKey,
        normalized.runtime_kind,
        normalized.provider_label,
        normalized.model_label,
        canonicalJson(normalized.declared_capabilities),
        now,
        now,
        addSeconds(now, normalized.ttl_seconds),
      );
      return sessionFromRow(this.requireSessionRow(id), now);
    });
    const session = transaction.immediate();
    this.tightenFileModes();
    return session;
  }

  getSession(sessionId: string): CollabSession {
    return sessionFromRow(
      this.requireSessionRow(validateId(sessionId, "session_id")),
      this.timestamp(),
    );
  }

  listSessions(
    workspaceId: string,
    presence?: SessionPresence,
    limit?: number,
  ): CollabSession[] {
    const id = validateId(workspaceId, "workspace_id");
    this.requireWorkspace(id);
    if (
      presence !== undefined
      && presence !== "live"
      && presence !== "stale"
      && presence !== "left"
    ) {
      throw new CollabError("invalid_presence", "presence must be live, stale, or left");
    }
    const observedAt = this.timestamp();
    const boundedLimit = validateSessionListLimit(limit);
    let rows: SessionRow[];
    if (presence === "live") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NULL AND presence_expires_at > ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, observedAt, boundedLimit) as SessionRow[];
    } else if (presence === "stale") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NULL AND presence_expires_at <= ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, observedAt, boundedLimit) as SessionRow[];
    } else if (presence === "left") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NOT NULL
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, boundedLimit) as SessionRow[];
    } else {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, boundedLimit) as SessionRow[];
    }
    return rows.map((row) => sessionFromRow(row, observedAt));
  }

  heartbeatSession(input: HeartbeatSessionInput): CollabSession {
    const normalized = {
      session_id: validateId(input.session_id, "session_id"),
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      expected_version: validateExpectedVersion(input.expected_version),
      ttl_seconds: validatePresenceTtl(input.ttl_seconds),
    };
    const initial = this.requireSessionRow(normalized.session_id);
    return this.mutate(
      initial.workspace_id,
      initial.actor_key,
      normalized.idempotency_key,
      "session.heartbeat",
      normalized,
      () => {
        const row = this.requireSessionRow(normalized.session_id);
        requireSessionVersion(row, normalized.expected_version);
        if (row.left_at) {
          throw new CollabError("session_left", "An explicitly left session cannot heartbeat", {
            session_id: row.id,
          });
        }
        const now = this.timestamp();
        this.db.query(`
          UPDATE sessions
          SET version = ?, last_seen_at = ?, presence_expires_at = ?
          WHERE id = ?
        `).run(
          row.version + 1,
          now,
          addSeconds(now, normalized.ttl_seconds),
          row.id,
        );
        return sessionFromRow(this.requireSessionRow(row.id), now);
      },
    );
  }

  leaveSession(input: SessionMutationInput): CollabSession {
    const normalized = {
      session_id: validateId(input.session_id, "session_id"),
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      expected_version: validateExpectedVersion(input.expected_version),
    };
    const initial = this.requireSessionRow(normalized.session_id);
    return this.mutate(
      initial.workspace_id,
      initial.actor_key,
      normalized.idempotency_key,
      "session.leave",
      normalized,
      () => {
        const row = this.requireSessionRow(normalized.session_id);
        requireSessionVersion(row, normalized.expected_version);
        const now = this.timestamp();
        if (!row.left_at) {
          this.db.query(`
            UPDATE sessions SET version = ?, left_at = ? WHERE id = ?
          `).run(row.version + 1, now, row.id);
        }
        return sessionFromRow(this.requireSessionRow(row.id), now);
      },
    );
  }

  workspaceStatus(workspaceId: string): WorkspaceStatus {
    const workspace = this.requireWorkspace(workspaceId);
    const tasks = this.listTasks(workspaceId);
    const counts: Record<TaskStatus, number> = { open: 0, claimed: 0, blocked: 0, completed: 0 };
    let expiredClaims = 0;
    for (const task of tasks) {
      if (task.effective_status === "lease_expired") {
        counts.open += 1;
        expiredClaims += 1;
      } else {
        counts[task.effective_status] += 1;
      }
    }
    const decisions = this.db.query(`
      SELECT id, workspace_id, topic, decision, rationale, recorded_by, recorded_at
      FROM decisions WHERE workspace_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 10
    `).all(workspaceId) as DecisionRow[];
    return {
      workspace,
      counts,
      expired_claims: expiredClaims,
      active_claims: tasks.filter((task) => task.effective_status === "claimed"),
      blocked_tasks: tasks.filter((task) => task.status === "blocked"),
      recent_decisions: decisions.map(decisionFromRow),
    };
  }

  createTask(input: CreateTaskInput): Task {
    const normalized = {
      ...normalizeMutation(input),
      workspace_id: input.workspace_id,
      id: input.id ? validateId(input.id, "task_id") : undefined,
      title: cleanText(input.title, "title", 300),
      description: optionalText(input.description, "description", MAX_TEXT),
      dependencies: normalizeDependencies(input.dependencies ?? []),
      path_scopes: normalizePathScopes(input.path_scopes ?? []),
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.create", normalized, () => {
      this.requireWorkspace(input.workspace_id);
      const id = normalized.id ?? `task_${randomUUID()}`;
      if (normalized.dependencies.includes(id)) {
        throw new CollabError("invalid_dependency", "A task cannot depend on itself", { task_id: id });
      }
      for (const dependency of normalized.dependencies) this.requireTaskRow(input.workspace_id, dependency);
      if (this.readTaskRow(input.workspace_id, id)) {
        throw new CollabError("task_exists", `Task '${id}' already exists`, { task_id: id });
      }
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO tasks (
          id, workspace_id, title, description, status, dependencies_json, path_scopes_json,
          assignee, lease_id, lease_expires_at, blocker, latest_progress, version,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, NULL, NULL, NULL, NULL, 1, ?, ?, NULL)
      `).run(
        id,
        input.workspace_id,
        normalized.title,
        normalized.description,
        canonicalJson(normalized.dependencies),
        canonicalJson(normalized.path_scopes),
        now,
        now,
      );
      this.appendEvent(input.workspace_id, "task.created", id, normalized.actor, {
        title: normalized.title,
        description: normalized.description,
        dependencies: normalized.dependencies,
        path_scopes: normalized.path_scopes,
        version: 1,
      });
      return this.requireTask(input.workspace_id, id);
    });
  }

  getTask(workspaceId: string, taskId: string): Task {
    const task = this.requireTask(workspaceId, taskId);
    task.artifacts = this.listArtifacts(workspaceId, taskId);
    return task;
  }

  listTasks(workspaceId: string, status?: TaskStatus): Task[] {
    this.requireWorkspace(workspaceId);
    const rows = status
      ? this.db.query(`
          SELECT * FROM tasks WHERE workspace_id = ? AND status = ? ORDER BY created_at, id
        `).all(workspaceId, status) as TaskRow[]
      : this.db.query(`
          SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at, id
        `).all(workspaceId) as TaskRow[];
    return rows.map((row) => this.taskFromRow(row));
  }

  claimTask(input: ClaimTaskInput): Task {
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      task_id: validateId(input.task_id, "task_id"),
      ttl_seconds: validateTtl(input.ttl_seconds),
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.claim", normalized, () => {
      let row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      const priorAssignee = row.assignee;
      const expired = this.isExpired(row);
      if (expired) {
        row = this.expireClaim(row, normalized.actor);
      }
      if (row.status === "completed") throw new CollabError("task_completed", "Completed tasks cannot be claimed");
      if (row.status === "blocked") throw new CollabError("task_blocked", "Blocked tasks must be unblocked before claiming", { blocker: row.blocker });
      if (row.status === "claimed") {
        throw new CollabError("task_claimed", "Task already has an active claim", {
          assignee: row.assignee,
          lease_expires_at: row.lease_expires_at,
        });
      }
      this.requireDependenciesComplete(row);
      this.requirePathsAvailable(row);
      const now = this.timestamp();
      const leaseId = `lease_${randomUUID()}`;
      const expiresAt = addSeconds(now, normalized.ttl_seconds);
      const nextVersion = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'claimed', assignee = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.actor, leaseId, expiresAt, nextVersion, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.claimed", normalized.task_id, normalized.actor, {
        lease_id: leaseId,
        lease_expires_at: expiresAt,
        previous_assignee: expired ? priorAssignee : null,
        version: nextVersion,
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }

  renewLease(input: LeaseTaskInput & { ttl_seconds?: number }): Task {
    const normalized = normalizeLeaseInput(input);
    const ttl = validateTtl(input.ttl_seconds);
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.renew", { ...normalized, ttl_seconds: ttl }, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const candidate = addSeconds(now, ttl);
      const expiresAt = row.lease_expires_at && row.lease_expires_at > candidate
        ? row.lease_expires_at
        : candidate;
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET lease_expires_at = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(expiresAt, version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.lease_renewed", normalized.task_id, normalized.actor, {
        lease_id: normalized.lease_id,
        lease_expires_at: expiresAt,
        version,
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }

  progressTask(input: LeaseTaskInput & { message: string }): Task {
    const normalized = { ...normalizeLeaseInput(input), message: cleanText(input.message, "message", 2_000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.progress", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET latest_progress = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.message, version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.progressed", normalized.task_id, normalized.actor, {
        message: normalized.message,
        version,
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }

  releaseTask(input: LeaseTaskInput & { summary?: string }): Task {
    const normalized = { ...normalizeLeaseInput(input), summary: optionalText(input.summary, "summary", 2_000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.release", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      return this.clearClaim(row, normalized.actor, "task.released", { summary: normalized.summary });
    });
  }

  blockTask(input: LeaseTaskInput & { blocker: string }): Task {
    const normalized = { ...normalizeLeaseInput(input), blocker: cleanText(input.blocker, "blocker", 2_000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.block", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'blocked', assignee = NULL, lease_id = NULL,
          lease_expires_at = NULL, blocker = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.blocker, version, now, input.workspace_id, normalized.task_id);
      this.expirePendingHandoffs(input.workspace_id, normalized.task_id, now, normalized.actor, "task_blocked");
      this.appendEvent(input.workspace_id, "task.blocked", normalized.task_id, normalized.actor, {
        blocker: normalized.blocker,
        version,
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }

  unblockTask(input: VersionedMutationContext & { workspace_id: string; task_id: string; note?: string }): Task {
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      task_id: validateId(input.task_id, "task_id"),
      note: optionalText(input.note, "note", 2_000),
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.unblock", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      if (row.status !== "blocked") throw new CollabError("task_not_blocked", "Only blocked tasks can be unblocked");
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'open', blocker = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.unblocked", normalized.task_id, normalized.actor, {
        note: normalized.note,
        version,
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }

  completeTask(input: LeaseTaskInput & { summary: string }): Task {
    const normalized = { ...normalizeLeaseInput(input), summary: cleanText(input.summary, "summary", 4_000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.complete", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'completed', assignee = NULL, lease_id = NULL,
          lease_expires_at = NULL, blocker = NULL, latest_progress = ?, version = ?,
          updated_at = ?, completed_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.summary, version, now, now, input.workspace_id, normalized.task_id);
      this.expirePendingHandoffs(input.workspace_id, normalized.task_id, now, normalized.actor, "task_completed");
      this.appendEvent(input.workspace_id, "task.completed", normalized.task_id, normalized.actor, {
        completion_basis: "actor_reported",
        note: "Completion records the reporting actor's outcome; it is not coordinator review or acceptance.",
        summary: normalized.summary,
        version,
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }

  attachArtifact(input: LeaseTaskInput & {
    kind: ArtifactRef["kind"];
    uri: string;
    sha256?: string;
    media_type?: string;
    label?: string;
  }): { task: Task; artifact: ArtifactRef } {
    const normalized = {
      ...normalizeLeaseInput(input),
      kind: input.kind,
      uri: cleanText(input.uri, "uri", 2_000),
      sha256: input.sha256 ? validateSha256(input.sha256) : null,
      media_type: optionalText(input.media_type, "media_type", 200),
      label: optionalText(input.label, "label", 300),
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "artifact.attach", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const id = `artifact_${randomUUID()}`;
      this.db.query(`
        INSERT INTO artifacts
          (id, workspace_id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.workspace_id,
        normalized.task_id,
        normalized.kind,
        normalized.uri,
        normalized.sha256,
        normalized.media_type,
        normalized.label,
        normalized.actor,
        now,
      );
      const version = row.version + 1;
      this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`)
        .run(version, now, input.workspace_id, normalized.task_id);
      const artifact = this.requireArtifact(id);
      this.appendEvent(input.workspace_id, "artifact.attached", normalized.task_id, normalized.actor, {
        artifact,
        version,
      });
      return { task: this.requireTask(input.workspace_id, normalized.task_id), artifact };
    });
  }

  recordDecision(input: MutationContext & {
    workspace_id: string;
    topic: string;
    decision: string;
    rationale?: string;
  }): Decision {
    const normalized = {
      ...normalizeMutation(input),
      workspace_id: input.workspace_id,
      topic: cleanText(input.topic, "topic", 500),
      decision: cleanText(input.decision, "decision", 4_000),
      rationale: optionalText(input.rationale, "rationale", 4_000),
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "decision.record", normalized, () => {
      this.requireWorkspace(input.workspace_id);
      const id = `decision_${randomUUID()}`;
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO decisions (id, workspace_id, topic, decision, rationale, recorded_by, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.workspace_id, normalized.topic, normalized.decision, normalized.rationale, normalized.actor, now);
      const decision = this.requireDecision(id);
      this.appendEvent(input.workspace_id, "decision.recorded", id, normalized.actor, { decision });
      return decision;
    });
  }

  offerHandoff(input: LeaseTaskInput & { to_actor: string; summary: string; ttl_seconds?: number }): {
    handoff: HandoffOffer;
    task: Task;
  } {
    const normalized = {
      ...normalizeLeaseInput(input),
      to_actor: validateActor(input.to_actor),
      summary: cleanText(input.summary, "summary", 4_000),
      ttl_seconds: validateTtl(input.ttl_seconds),
    };
    if (normalized.to_actor === normalized.actor) {
      throw new CollabError("invalid_handoff", "A handoff target must be a different actor");
    }
    this.expireElapsedHandoffs(input.workspace_id, normalized.actor, normalized.task_id);
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "handoff.offer", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const pending = this.db.query(`
        SELECT id FROM handoffs WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at > ?
      `).get(input.workspace_id, normalized.task_id, this.timestamp()) as { id: string } | null;
      if (pending) throw new CollabError("handoff_pending", "Task already has a pending handoff", { handoff_id: pending.id });
      const now = this.timestamp();
      const id = `handoff_${randomUUID()}`;
      const expiresAt = [addSeconds(now, normalized.ttl_seconds), row.lease_expires_at!].sort()[0]!;
      this.db.query(`
        INSERT INTO handoffs
          (id, workspace_id, task_id, from_actor, to_actor, summary, status, offered_at, expires_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
      `).run(id, input.workspace_id, normalized.task_id, normalized.actor, normalized.to_actor, normalized.summary, now, expiresAt);
      const version = row.version + 1;
      this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`)
        .run(version, now, input.workspace_id, normalized.task_id);
      const offer = this.requireHandoff(id);
      this.appendEvent(input.workspace_id, "handoff.offered", id, normalized.actor, {
        offer,
        task_version: version,
        note: "An offer is an invitation; the coordination lease remains with the current holder until acceptance.",
      });
      return { handoff: offer, task: this.requireTask(input.workspace_id, normalized.task_id) };
    });
  }

  respondHandoff(input: VersionedMutationContext & {
    workspace_id: string;
    handoff_id: string;
    response: "accept" | "decline";
    ttl_seconds?: number;
  }): { handoff: HandoffOffer; task: Task } {
    if (input.response !== "accept" && input.response !== "decline") {
      throw new CollabError("invalid_handoff_response", "Handoff response must be 'accept' or 'decline'");
    }
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      handoff_id: validateId(input.handoff_id, "handoff_id"),
      response: input.response,
      ttl_seconds: validateTtl(input.ttl_seconds),
    };
    this.expireElapsedHandoffs(input.workspace_id, "system:clock");
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "handoff.respond", normalized, () => {
      const offer = this.requireHandoff(normalized.handoff_id);
      if (offer.workspace_id !== input.workspace_id) throw new CollabError("handoff_not_found", "Handoff was not found in this workspace");
      if (offer.to_actor !== normalized.actor) throw new CollabError("handoff_not_recipient", "Only the named recipient may respond");
      if (offer.status === "expired") throw new CollabError("handoff_expired", "The handoff has expired");
      if (offer.status !== "pending") throw new CollabError("handoff_resolved", "Handoff has already been resolved", { status: offer.status });
      const row = this.requireTaskRow(input.workspace_id, offer.task_id);
      this.requireVersion(row, normalized.expected_version);
      if (this.timestamp() >= offer.expires_at || this.isExpired(row)) {
        throw new CollabError("handoff_expired", "The handoff or source lease has expired");
      }
      this.requireActiveLease(row, offer.from_actor, row.lease_id ?? "");
      const now = this.timestamp();
      const version = row.version + 1;
      if (normalized.response === "decline") {
        this.db.query(`UPDATE handoffs SET status = 'declined', resolved_at = ? WHERE id = ?`)
          .run(now, offer.id);
        this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`)
          .run(version, now, input.workspace_id, row.id);
        this.appendEvent(input.workspace_id, "handoff.declined", offer.id, normalized.actor, {
          task_id: row.id,
          task_version: version,
        });
      } else {
        const leaseId = `lease_${randomUUID()}`;
        const leaseExpiresAt = addSeconds(now, normalized.ttl_seconds);
        this.db.query(`UPDATE handoffs SET status = 'accepted', resolved_at = ? WHERE id = ?`)
          .run(now, offer.id);
        this.db.query(`
          UPDATE tasks SET assignee = ?, lease_id = ?, lease_expires_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(normalized.actor, leaseId, leaseExpiresAt, version, now, input.workspace_id, row.id);
        this.appendEvent(input.workspace_id, "handoff.accepted", offer.id, normalized.actor, {
          task_id: row.id,
          from_actor: offer.from_actor,
          to_actor: normalized.actor,
          lease_id: leaseId,
          lease_expires_at: leaseExpiresAt,
          task_version: version,
        });
      }
      return { handoff: this.requireHandoff(offer.id), task: this.requireTask(input.workspace_id, row.id) };
    });
  }

  nextForActor(workspaceId: string, actorInput: string, afterSequence = 0): {
    actor: string;
    own_claims: Task[];
    ready_tasks: Task[];
    handoff_offers: Array<{ handoff: HandoffOffer; task: Task }>;
    events: JournalPage;
  } {
    const actor = validateActor(actorInput);
    this.expireElapsedHandoffs(workspaceId, "system:clock");
    const tasks = this.listTasks(workspaceId);
    const completed = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id));
    const offers = this.db.query(`
      SELECT * FROM handoffs
      WHERE workspace_id = ? AND to_actor = ? AND status = 'pending' AND expires_at > ?
      ORDER BY offered_at, id
    `).all(workspaceId, actor, this.timestamp()) as HandoffRow[];
    return {
      actor,
      own_claims: tasks.filter((task) => task.effective_status === "claimed" && task.assignee === actor),
      ready_tasks: tasks.filter((task) =>
        (task.effective_status === "open" || task.effective_status === "lease_expired")
        && task.dependencies.every((dependency) => completed.has(dependency))
      ),
      handoff_offers: offers.map((row) => ({
        handoff: handoffFromRow(row),
        task: this.requireTask(workspaceId, row.task_id),
      })),
      events: this.eventsSince(workspaceId, afterSequence, 50),
    };
  }

  eventsSince(workspaceId: string, afterSequence = 0, limit = 100): JournalPage {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Event limit must be between 1 and 500");
    }
    const readPage = this.db.transaction(() => {
      const workspace = this.requireWorkspace(workspaceId);
      if (afterSequence > workspace.event_head_sequence) {
        throw new CollabError("invalid_cursor", "Event cursor is ahead of the workspace journal", {
          after_sequence: afterSequence,
          head_sequence: workspace.event_head_sequence,
        });
      }
      const predecessor = afterSequence === 0
        ? { hash: GENESIS_HASH }
        : this.db.query(`SELECT hash FROM events WHERE workspace_id = ? AND sequence = ?`)
          .get(workspaceId, afterSequence) as { hash: string } | null;
      const rows = this.db.query(`
        SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
          occurred_at, payload_json, prev_hash, hash
        FROM events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
      `).all(workspaceId, afterSequence, limit) as EventRow[];
      const events = rows.map(eventFromRow);
      const chainValid = verifyEventPage(
        events,
        afterSequence,
        predecessor?.hash ?? null,
        workspace.event_head_sequence,
        workspace.event_head_hash,
      );
      return {
        events,
        next_cursor: events.at(-1)?.sequence ?? afterSequence,
        head_sequence: workspace.event_head_sequence,
        head_hash: workspace.event_head_hash,
        chain_valid: chainValid,
        verification_scope: "returned_page" as const,
      };
    });
    return readPage.deferred();
  }

  verifyJournal(workspaceId: string): boolean {
    const audit = this.db.transaction(() => {
      const workspace = this.requireWorkspace(workspaceId);
      const rows = this.db.query(`
        SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
          occurred_at, payload_json, prev_hash, hash
        FROM events WHERE workspace_id = ? ORDER BY sequence
      `).all(workspaceId) as EventRow[];
      let expectedSequence = 1;
      let previous = GENESIS_HASH;
      for (const row of rows) {
        const event = eventFromRow(row);
        if (event.sequence !== expectedSequence || event.prev_hash !== previous) return false;
        if (event.hash !== eventHash(event)) return false;
        previous = event.hash;
        expectedSequence += 1;
      }
      return workspace.event_head_sequence === rows.length && workspace.event_head_hash === previous;
    });
    return audit.deferred();
  }

  private mutate<T>(
    workspaceId: string,
    actor: string,
    idempotencyKey: string,
    operation: string,
    request: unknown,
    apply: () => T,
  ): T {
    this.requireWorkspace(workspaceId);
    const requestHash = sha256(canonicalJson({ operation, request }));
    const transaction = this.db.transaction(() => {
      const existing = this.db.query(`
        SELECT operation, request_hash, response_json FROM mutations
        WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
      `).get(workspaceId, actor, idempotencyKey) as MutationRow | null;
      if (existing) {
        if (existing.operation !== operation || existing.request_hash !== requestHash) {
          throw new CollabError("idempotency_conflict", "Idempotency key was already used for a different mutation", {
            operation: existing.operation,
          });
        }
        return JSON.parse(existing.response_json) as T;
      }
      const response = apply();
      this.db.query(`
        INSERT INTO mutations
          (workspace_id, actor, idempotency_key, operation, request_hash, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(workspaceId, actor, idempotencyKey, operation, requestHash, JSON.stringify(response), this.timestamp());
      return response;
    });
    const response = transaction.immediate();
    this.tightenFileModes();
    return response;
  }

  private appendEvent(
    workspaceId: string,
    type: CollabEventType,
    entityId: string,
    actor: string,
    payload: Record<string, unknown>,
  ): CollabEvent {
    const workspace = this.requireWorkspace(workspaceId);
    const event: CollabEvent = {
      protocol: COLLAB_PROTOCOL,
      workspace_id: workspaceId,
      epoch_id: workspace.epoch_id,
      sequence: workspace.event_head_sequence + 1,
      id: `event_${randomUUID()}`,
      type,
      entity_id: entityId,
      actor,
      occurred_at: this.timestamp(),
      payload,
      prev_hash: workspace.event_head_hash,
      hash: "",
    };
    event.hash = eventHash(event);
    this.db.query(`
      INSERT INTO events
        (workspace_id, epoch_id, sequence, id, protocol, type, entity_id, actor,
          occurred_at, payload_json, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.workspace_id,
      event.epoch_id,
      event.sequence,
      event.id,
      event.protocol,
      event.type,
      event.entity_id,
      event.actor,
      event.occurred_at,
      canonicalJson(event.payload),
      event.prev_hash,
      event.hash,
    );
    this.db.query(`
      UPDATE workspaces SET event_head_sequence = ?, event_head_hash = ? WHERE id = ?
    `).run(event.sequence, event.hash, workspaceId);
    return event;
  }

  private expireClaim(row: TaskRow, actor: string): TaskRow {
    if (!this.isExpired(row)) return row;
    const now = this.timestamp();
    const version = row.version + 1;
    const prior = { assignee: row.assignee, lease_id: row.lease_id, lease_expires_at: row.lease_expires_at };
    this.db.query(`
      UPDATE tasks SET status = 'open', assignee = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, actor, "source_lease_expired");
    this.appendEvent(row.workspace_id, "task.claim_expired", row.id, actor, { ...prior, version });
    return this.requireTaskRow(row.workspace_id, row.id);
  }

  private clearClaim(
    row: TaskRow,
    actor: string,
    type: "task.released",
    payload: Record<string, unknown>,
  ): Task {
    const now = this.timestamp();
    const version = row.version + 1;
    this.db.query(`
      UPDATE tasks SET status = 'open', assignee = NULL, lease_id = NULL,
        lease_expires_at = NULL, version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, actor, "task_released");
    this.appendEvent(row.workspace_id, type, row.id, actor, { ...payload, version });
    return this.requireTask(row.workspace_id, row.id);
  }

  private expirePendingHandoffs(
    workspaceId: string,
    taskId: string,
    now: string,
    actor: string,
    reason: string,
  ): void {
    const rows = this.db.query(`
      SELECT * FROM handoffs WHERE workspace_id = ? AND task_id = ? AND status = 'pending'
    `).all(workspaceId, taskId) as HandoffRow[];
    for (const row of rows) {
      this.db.query(`UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?`)
        .run(now, row.id);
      this.appendEvent(workspaceId, "handoff.expired", row.id, actor, { task_id: taskId, reason });
    }
  }

  private expireElapsedHandoffs(workspaceId: string, actor: string, taskId?: string): void {
    this.requireWorkspace(workspaceId);
    const reap = this.db.transaction(() => {
      const now = this.timestamp();
      const rows = taskId
        ? this.db.query(`
            SELECT * FROM handoffs
            WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at <= ?
          `).all(workspaceId, taskId, now) as HandoffRow[]
        : this.db.query(`
            SELECT * FROM handoffs
            WHERE workspace_id = ? AND status = 'pending' AND expires_at <= ?
          `).all(workspaceId, now) as HandoffRow[];
      for (const row of rows) {
        this.db.query(`UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?`)
          .run(now, row.id);
        this.appendEvent(workspaceId, "handoff.expired", row.id, actor, {
          task_id: row.task_id,
          reason: "offer_deadline_elapsed",
        });
      }
    });
    reap.immediate();
    this.tightenFileModes();
  }

  private requireDependenciesComplete(row: TaskRow): void {
    const dependencies = parseStringArray(row.dependencies_json);
    const incomplete = dependencies.filter((id) => this.requireTaskRow(row.workspace_id, id).status !== "completed");
    if (incomplete.length > 0) {
      throw new CollabError("dependencies_incomplete", "Task dependencies are not complete", { dependencies: incomplete });
    }
  }

  private requirePathsAvailable(row: TaskRow): void {
    const scopes = parseStringArray(row.path_scopes_json);
    if (scopes.length === 0) return;
    const candidates = this.db.query(`
      SELECT * FROM tasks
      WHERE workspace_id = ? AND id != ? AND status = 'claimed' AND lease_expires_at > ?
    `).all(row.workspace_id, row.id, this.timestamp()) as TaskRow[];
    for (const candidate of candidates) {
      const conflicts = pathConflicts(scopes, parseStringArray(candidate.path_scopes_json));
      if (conflicts.length > 0) {
        throw new CollabError("path_scope_conflict", "Task paths overlap an active claim", {
          conflicting_task_id: candidate.id,
          assignee: candidate.assignee,
          conflicts,
        });
      }
    }
  }

  private requireActiveLease(row: TaskRow, actor: string, leaseId: string): void {
    if (row.status !== "claimed" || !row.lease_id || !row.lease_expires_at) {
      throw new CollabError("lease_not_active", "Task does not have an active lease");
    }
    if (this.isExpired(row)) {
      throw new CollabError("lease_expired", "Task lease has expired", { lease_expires_at: row.lease_expires_at });
    }
    if (row.assignee !== actor || row.lease_id !== leaseId) {
      throw new CollabError("lease_not_holder", "Mutation requires the current lease holder", {
        assignee: row.assignee,
      });
    }
  }

  private requireVersion(row: TaskRow, expected: number): void {
    if (row.version !== expected) {
      throw new CollabError("version_conflict", "Task changed since it was read", {
        expected_version: expected,
        current_version: row.version,
      });
    }
  }

  private isExpired(row: TaskRow): boolean {
    return row.status === "claimed"
      && row.lease_expires_at !== null
      && this.timestamp() >= row.lease_expires_at;
  }

  private taskFromRow(row: TaskRow): Task {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      title: row.title,
      description: row.description,
      status: row.status,
      effective_status: this.isExpired(row) ? "lease_expired" : row.status,
      dependencies: parseStringArray(row.dependencies_json),
      path_scopes: parseStringArray(row.path_scopes_json),
      assignee: row.assignee,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      blocker: row.blocker,
      latest_progress: row.latest_progress,
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    };
  }

  private requireWorkspace(workspaceId: string): Workspace {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) throw new CollabError("workspace_not_found", `Workspace '${workspaceId}' was not found`);
    return workspace;
  }

  private readSessionByClient(
    workspaceId: string,
    clientInstanceId: string,
  ): SessionRow | null {
    return this.db.query(`
      SELECT * FROM sessions
      WHERE workspace_id = ? AND client_instance_id = ?
    `).get(workspaceId, clientInstanceId) as SessionRow | null;
  }

  private requireSessionRow(sessionId: string): SessionRow {
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`)
      .get(sessionId) as SessionRow | null;
    if (!row) {
      throw new CollabError("session_not_found", `Session '${sessionId}' was not found`);
    }
    return row;
  }

  private readTaskRow(workspaceId: string, taskId: string): TaskRow | null {
    return this.db.query(`SELECT * FROM tasks WHERE workspace_id = ? AND id = ?`)
      .get(workspaceId, taskId) as TaskRow | null;
  }

  private requireTaskRow(workspaceId: string, taskId: string): TaskRow {
    const row = this.readTaskRow(workspaceId, taskId);
    if (!row) throw new CollabError("task_not_found", `Task '${taskId}' was not found`, { task_id: taskId });
    return row;
  }

  private requireTask(workspaceId: string, taskId: string): Task {
    return this.taskFromRow(this.requireTaskRow(workspaceId, taskId));
  }

  private listArtifacts(workspaceId: string, taskId: string): ArtifactRef[] {
    const rows = this.db.query(`
      SELECT id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at
      FROM artifacts WHERE workspace_id = ? AND task_id = ? ORDER BY attached_at, id
    `).all(workspaceId, taskId) as ArtifactRow[];
    return rows.map(artifactFromRow);
  }

  private requireArtifact(id: string): ArtifactRef {
    const row = this.db.query(`
      SELECT id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at
      FROM artifacts WHERE id = ?
    `).get(id) as ArtifactRow | null;
    if (!row) throw new CollabError("artifact_not_found", `Artifact '${id}' was not found`);
    return artifactFromRow(row);
  }

  private requireDecision(id: string): Decision {
    const row = this.db.query(`
      SELECT id, workspace_id, topic, decision, rationale, recorded_by, recorded_at
      FROM decisions WHERE id = ?
    `).get(id) as DecisionRow | null;
    if (!row) throw new CollabError("decision_not_found", `Decision '${id}' was not found`);
    return decisionFromRow(row);
  }

  private requireHandoff(id: string): HandoffOffer {
    const row = this.db.query(`SELECT * FROM handoffs WHERE id = ?`).get(id) as HandoffRow | null;
    if (!row) throw new CollabError("handoff_not_found", `Handoff '${id}' was not found`);
    return handoffFromRow(row);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function normalizeMutation<T extends MutationContext>(input: T): Pick<T, Exclude<keyof T, never>> {
  return { ...input, actor: validateActor(input.actor), idempotency_key: validateIdempotencyKey(input.idempotency_key) };
}

function normalizeVersionedMutation<T extends VersionedMutationContext>(input: T): T {
  validateExpectedVersion(input.expected_version);
  return normalizeMutation(input) as T;
}

function normalizeLeaseInput<T extends LeaseTaskInput>(input: T): T {
  return {
    ...normalizeVersionedMutation(input),
    task_id: validateId(input.task_id, "task_id"),
    lease_id: validateId(input.lease_id, "lease_id"),
  } as T;
}

function validateActor(value: string): string {
  return cleanText(value, "actor", 200);
}

function validateExpectedVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new CollabError("invalid_expected_version", "expected_version must be a positive integer");
  }
  return value;
}

function validateRuntimeKind(value: string): string {
  const runtime = cleanText(value, "runtime_kind", 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(runtime)) {
    throw new CollabError(
      "invalid_runtime_kind",
      "runtime_kind contains unsupported characters",
    );
  }
  return runtime;
}

function normalizeSessionCapabilities(values: string[]): string[] {
  if (!Array.isArray(values) || values.length > MAX_SESSION_CAPABILITIES) {
    throw new CollabError(
      "invalid_declared_capabilities",
      `A session may declare at most ${MAX_SESSION_CAPABILITIES} capabilities`,
    );
  }
  const normalized = values.map((value) => {
    const capability = cleanText(
      value,
      "declared_capability",
      MAX_SESSION_CAPABILITY_LENGTH,
    ).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]*$/.test(capability)) {
      throw new CollabError(
        "invalid_declared_capability",
        "Declared capabilities must be symbolic names, not free-form content",
      );
    }
    return capability;
  });
  return uniqueSorted(normalized);
}

function validateIdempotencyKey(value: string): string {
  const key = cleanText(value, "idempotency_key", 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) {
    throw new CollabError("invalid_idempotency_key", "Idempotency key contains unsupported characters");
  }
  return key;
}

function validateId(value: string, field: string): string {
  const id = cleanText(value, field, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw new CollabError(`invalid_${field}`, `${field} contains unsupported characters`);
  }
  return id;
}

function cleanText(value: string, field: string, max: number): string {
  const text = value.trim();
  if (!text) throw new CollabError(`invalid_${field}`, `${field} must not be empty`);
  if (text.length > max) throw new CollabError(`invalid_${field}`, `${field} exceeds ${max} characters`);
  if (text.includes("\0")) throw new CollabError(`invalid_${field}`, `${field} must not contain NUL bytes`);
  return text;
}

function optionalText(value: string | undefined, field: string, max: number): string | null {
  if (value === undefined || value.trim() === "") return null;
  return cleanText(value, field, max);
}

function validateTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_LEASE_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > MAX_LEASE_SECONDS) {
    throw new CollabError("invalid_ttl", `ttl_seconds must be an integer between 30 and ${MAX_LEASE_SECONDS}`);
  }
  return ttl;
}

function validatePresenceTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_PRESENCE_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > MAX_PRESENCE_SECONDS) {
    throw new CollabError(
      "invalid_presence_ttl",
      `ttl_seconds must be an integer between 30 and ${MAX_PRESENCE_SECONDS}`,
    );
  }
  return ttl;
}

function validateSessionListLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_SESSION_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SESSION_LIST_LIMIT) {
    throw new CollabError(
      "invalid_session_list_limit",
      `limit must be an integer between 1 and ${MAX_SESSION_LIST_LIMIT}`,
    );
  }
  return limit;
}

function validateSha256(value: string): string {
  const digest = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new CollabError("invalid_sha256", "sha256 must be 64 hexadecimal characters");
  return digest;
}

export function normalizePathScopes(scopes: string[]): string[] {
  if (!Array.isArray(scopes) || scopes.length > MAX_PATH_SCOPES) {
    throw new CollabError("invalid_path_scopes", `A task may have at most ${MAX_PATH_SCOPES} path scopes`);
  }
  let totalLength = 0;
  const normalized = scopes.map((scope) => {
    if (
      typeof scope !== "string"
      || !scope
      || scope.length > MAX_PATH_SCOPE_LENGTH
      || scope.includes("\0")
      || scope.includes("\\")
      || isAbsolute(scope)
    ) {
      throw new CollabError("invalid_path_scope", "Path scopes must be non-empty repository-relative POSIX paths", { scope });
    }
    totalLength += scope.length;
    if (totalLength > MAX_PATH_SCOPES_TOTAL) {
      throw new CollabError("invalid_path_scopes", `Combined path scopes may not exceed ${MAX_PATH_SCOPES_TOTAL} characters`);
    }
    const clean = posix.normalize(scope.replace(/^\.\//, "")).replace(/\/$/, "");
    if (!clean || clean === "." || clean === ".." || clean.startsWith("../")) {
      throw new CollabError("invalid_path_scope", "Root-wide and parent path scopes are not allowed", { scope });
    }
    return clean;
  });
  return uniqueSorted(normalized);
}

function normalizeDependencies(dependencies: string[]): string[] {
  if (!Array.isArray(dependencies) || dependencies.length > MAX_DEPENDENCIES) {
    throw new CollabError("invalid_dependencies", `A task may have at most ${MAX_DEPENDENCIES} dependencies`);
  }
  return uniqueSorted(dependencies.map((id) => validateId(id, "dependency")));
}

export function pathConflicts(left: string[], right: string[]): Array<[string, string]> {
  const conflicts: Array<[string, string]> = [];
  for (const a of left) {
    for (const b of right) {
      // Conservative case-folding avoids missed conflicts on the default
      // case-insensitive macOS filesystem. It may serialize two distinct paths
      // on a case-sensitive volume, which is safer than allowing overlap.
      const leftKey = a.normalize("NFC").toLowerCase();
      const rightKey = b.normalize("NFC").toLowerCase();
      if (
        leftKey === rightKey
        || leftKey.startsWith(`${rightKey}/`)
        || rightKey.startsWith(`${leftKey}/`)
      ) conflicts.push([a, b]);
    }
  }
  return conflicts;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function parseStringArray(json: string): string[] {
  return JSON.parse(json) as string[];
}

function sessionFromRow(row: SessionRow, observedAt: string): CollabSession {
  const presence: SessionPresence = row.left_at
    ? "left"
    : new Date(observedAt).getTime() < new Date(row.presence_expires_at).getTime()
      ? "live"
      : "stale";
  return {
    protocol: COLLAB_SESSION_PROTOCOL,
    id: row.id,
    workspace_id: row.workspace_id,
    epoch_id: row.epoch_id,
    client_instance_id: row.client_instance_id,
    actor_label: row.actor_label,
    actor_key: row.actor_key,
    runtime_kind: row.runtime_kind,
    provider_label: row.provider_label,
    model_label: row.model_label,
    declared_capabilities: parseStringArray(row.declared_capabilities_json),
    capability_basis: "self_declared",
    version: row.version,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    presence_expires_at: row.presence_expires_at,
    presence,
    left_at: row.left_at,
  };
}

function requireSessionVersion(row: SessionRow, expectedVersion: number): void {
  if (row.version !== expectedVersion) {
    throw new CollabError("session_version_conflict", "Session version changed", {
      session_id: row.id,
      expected_version: expectedVersion,
      actual_version: row.version,
    });
  }
}

function requireMatchingSessionJoin(
  row: SessionRow,
  input: {
    actor_label: string;
    runtime_kind: string;
    provider_label: string | null;
    model_label: string | null;
    declared_capabilities: string[];
  },
): void {
  const same = row.actor_label === input.actor_label
    && row.runtime_kind === input.runtime_kind
    && row.provider_label === input.provider_label
    && row.model_label === input.model_label
    && canonicalJson(parseStringArray(row.declared_capabilities_json))
      === canonicalJson(input.declared_capabilities);
  if (!same) {
    throw new CollabError(
      "session_instance_conflict",
      "client_instance_id was already joined with different self-declared metadata",
      { session_id: row.id },
    );
  }
}

function artifactFromRow(row: ArtifactRow): ArtifactRef {
  return { ...row };
}

function decisionFromRow(row: DecisionRow): Decision {
  return { ...row };
}

function handoffFromRow(row: HandoffRow): HandoffOffer {
  return { ...row };
}

function eventFromRow(row: EventRow): CollabEvent {
  return {
    protocol: row.protocol,
    workspace_id: row.workspace_id,
    epoch_id: row.epoch_id,
    sequence: row.sequence,
    id: row.id,
    type: row.type,
    entity_id: row.entity_id,
    actor: row.actor,
    occurred_at: row.occurred_at,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    prev_hash: row.prev_hash,
    hash: row.hash,
  };
}

function eventHash(event: CollabEvent): string {
  const { hash: _hash, ...body } = event;
  return sha256(canonicalJson(body));
}

function verifyEventPage(
  events: CollabEvent[],
  afterSequence: number,
  predecessorHash: string | null,
  headSequence: number,
  headHash: string,
): boolean {
  if (predecessorHash === null) return false;
  let expectedSequence = afterSequence + 1;
  let previous = predecessorHash;
  for (const event of events) {
    if (event.sequence !== expectedSequence || event.prev_hash !== previous) return false;
    if (event.hash !== eventHash(event)) return false;
    previous = event.hash;
    expectedSequence += 1;
  }
  const lastSequence = events.at(-1)?.sequence ?? afterSequence;
  return lastSequence !== headSequence || previous === headHash;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1_000).toISOString();
}
