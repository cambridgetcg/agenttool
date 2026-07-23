import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, resolve } from "node:path";
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";
import {
  COLLAB_PROTOCOL,
  LEGACY_COLLAB_PROTOCOL,
  type ArtifactRef,
  type ClaimTaskInput,
  type CollabEvent,
  type CollabEventType,
  type CollabProtocol,
  type CollabReport,
  type CollabSession,
  type CompletionPolicy,
  type CreateTaskInput,
  type Decision,
  type EventCursor,
  type HandoffOffer,
  type JournalPage,
  type LeaseTaskInput,
  type MutationContext,
  type RepoCheckpoint,
  type ReportConfidence,
  type ReportKind,
  type ReportRelation,
  type ReviewStatus,
  type SessionHandle,
  type TaskConflict,
  type TaskReview,
  type TaskWorkMode,
  type Task,
  type TaskStatus,
  type VersionedMutationContext,
  type Worktree,
  type Workspace,
  type WorkspaceStatus,
} from "./protocol.js";
import { inspectRepository, type RepositoryIdentity } from "./repository.js";

const GENESIS_HASH = "0".repeat(64);
const APPLICATION_ID = 0x4154434c; // "ATCL"
const SCHEMA_VERSION = 2;
const DEFAULT_LEASE_SECONDS = 15 * 60;
const MAX_LEASE_SECONDS = 60 * 60;
const MAX_TEXT = 8_000;
const MAX_REPORT_BODY = 9_000;
const MAX_DEPENDENCIES = 128;
const MAX_PATH_SCOPES = 128;
const MAX_PATH_SCOPE_LENGTH = 500;
const MAX_PATH_SCOPES_TOTAL = 16_000;
const MAX_REPORT_REFS = 128;
const MAX_REPORT_REF_LENGTH = 2_000;
const SESSION_TOKEN_BYTES = 32;
// One SQLite attempt may already consume the 5s busy_timeout. Keep a bounded
// second window so a concurrent schema migrator can finish and be rechecked.
const SQLITE_BUSY_RETRY_MS = 15_000;
const V2_GUARD_TRIGGERS = [
  "tasks_v2_insert_guard",
  "tasks_v2_update_guard",
  "tasks_v2_delete_guard",
  "artifacts_v2_insert_guard",
  "handoffs_v2_insert_guard",
] as const;

type Clock = () => Date;

interface WorkspaceRow {
  id: string;
  epoch_id: string;
  root_path: string;
  repository_key: string;
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
  coordination_mode: "legacy_v1" | "session_v2";
  work_mode: TaskWorkMode;
  completion_policy: CompletionPolicy;
  review_status: ReviewStatus;
  review_generation: number;
  expected_base_sha: string | null;
  base_checkpoint_json: string | null;
  result_checkpoint_json: string | null;
  completion_report_id: string | null;
  assignee: string | null;
  assignee_session_id: string | null;
  claim_worktree_id: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  blocker: string | null;
  latest_progress: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  reported_by: string | null;
  reported_by_session_id: string | null;
  reported_at: string | null;
  accepted_by: string | null;
  accepted_by_session_id: string | null;
  accepted_at: string | null;
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
  attached_by_session_id: string | null;
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
  from_session_id: string | null;
  to_actor: string;
  to_session_id: string | null;
  summary: string;
  status: HandoffOffer["status"];
  offered_at: string;
  expires_at: string;
  resolved_at: string | null;
}

interface EventRow {
  protocol: CollabProtocol;
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  id: string;
  type: CollabEventType;
  entity_id: string;
  actor: string;
  session_id: string | null;
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

interface WorktreeRow {
  id: string;
  workspace_id: string;
  root_path: string;
  repository_key: string;
  git_common_dir_hash: string | null;
  fingerprint: string;
  branch: string | null;
  head_sha: string | null;
  dirty: number | null;
  registered_at: string;
  last_seen_at: string;
}

interface PreparedWorktreeCheckpoint {
  session_id: string;
  workspace_id: string;
  worktree_id: string;
  root_path: string;
  fingerprint: string;
  git_common_dir_hash: string | null;
  checkpoint: RepoCheckpoint;
}

interface PreparedReviewCheckpoint {
  workspace_id: string;
  task_id: string;
  result_checkpoint: RepoCheckpoint;
  observed_worktree: PreparedWorktreeCheckpoint;
}

interface PreparedLegacyWorkspace {
  id: string;
  root_path: string;
  identity: RepositoryIdentity;
}

interface SessionRow {
  id: string;
  workspace_id: string;
  worktree_id: string;
  actor: string;
  role: string | null;
  parent_session_id: string | null;
  status: "active" | "ended";
  generation: number;
  token_hash: string;
  joined_at: string;
  last_seen_at: string;
  ended_at: string | null;
  cursor_epoch_id: string;
  cursor_sequence: number;
  cursor_hash: string;
  cursor_version: number;
  reset_generation: number;
  cursor_recovery_required: number;
}

interface ReportRow {
  id: string;
  workspace_id: string;
  task_id: string | null;
  from_session_id: string | null;
  from_actor: string;
  to_session_id: string | null;
  kind: ReportKind;
  body: string;
  evidence_refs_json: string;
  confidence: ReportConfidence;
  confidence_basis: string | null;
  limits: string | null;
  relation: ReportRelation;
  target_report_id: string | null;
  authority_scope: string | null;
  authority_basis: string | null;
  created_at: string;
  event_sequence: number;
}

interface ReviewRow {
  id: string;
  workspace_id: string;
  task_id: string;
  review_generation: number;
  outcome: "accepted" | "changes_requested";
  summary: string;
  reviewer_actor: string;
  reviewer_session_id: string;
  created_at: string;
  event_sequence: number;
}

export interface CollabStoreOptions {
  now?: Clock;
  migration_failpoint?: (step: string) => void;
}

export class CollabStore {
  readonly db: Database;
  private readonly now: Clock;
  private readonly filesystemPath?: string;
  private readonly migrationFailpoint?: (step: string) => void;

  constructor(path: string, options: CollabStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.migrationFailpoint = options.migration_failpoint;
    const databasePath = path === ":memory:" ? path : resolve(path);
    if (databasePath !== ":memory:") {
      const parent = dirname(databasePath);
      const parentAlreadyExisted = existsSync(parent);
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      // Never change a caller-owned existing directory such as /tmp or a repo.
      // We can tighten the dedicated directory only when this store created it.
      if (!parentAlreadyExisted) chmodSync(parent, 0o700);
      if (existsSync(databasePath)) {
        assertSafeDatabaseFile(databasePath);
      } else {
        try {
          const descriptor = openSync(databasePath, "wx", 0o600);
          closeSync(descriptor);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          assertSafeDatabaseFile(databasePath);
        }
      }
      this.filesystemPath = databasePath;
    }
    this.db = new Database(databasePath, { create: true, strict: true });
    try {
      this.preflightDatabase();
      this.initialize();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  defaultSessionCredentialPath(sessionId: string): string {
    if (!this.filesystemPath) {
      throw new CollabError(
        "session_file_path_required",
        "An explicit credential file path is required for an in-memory database",
      );
    }
    const id = validateId(sessionId, "session_id");
    return join(dirname(this.filesystemPath), "collab-sessions", `${id}.json`);
  }

  private initialize(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    const legacyPreparation = this.prepareLegacyMigration();
    const migrate = this.db.transaction(() => {
      const applicationId = pragmaNumber(this.db, "application_id");
      const userVersion = pragmaNumber(this.db, "user_version");
      if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
        throw new CollabError(
          "database_application_mismatch",
          "The SQLite file belongs to another application",
          { expected_application_id: APPLICATION_ID, actual_application_id: applicationId },
        );
      }
      if (userVersion > SCHEMA_VERSION) {
        throw new CollabError(
          "database_version_too_new",
          "The collaboration database was created by a newer package version",
          { supported_schema_version: SCHEMA_VERSION, actual_schema_version: userVersion },
        );
      }

      const tables = this.tableNames();
      if (tables.length === 0) {
        this.createLegacySchema();
        this.migrationFailpoint?.("legacy_schema_created");
      } else {
        this.validateLegacyOrV2Shape(userVersion);
      }

      const versionAfterLock = pragmaNumber(this.db, "user_version");
      if (versionAfterLock < SCHEMA_VERSION) this.migrateToV2(legacyPreparation);
      this.validateV2Shape();
      this.validateAllJournals();
      this.db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    retrySqliteBusy(() => migrate.immediate());
    if (this.db.filename !== ":memory:") {
      retrySqliteBusy(() => this.db.exec("PRAGMA journal_mode = WAL"));
    }
    this.tightenFileModes();
  }

  private preflightDatabase(): void {
    const applicationId = pragmaNumber(this.db, "application_id");
    const userVersion = pragmaNumber(this.db, "user_version");
    if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
      throw new CollabError(
        "database_application_mismatch",
        "The SQLite file belongs to another application",
        { expected_application_id: APPLICATION_ID, actual_application_id: applicationId },
      );
    }
    if (userVersion > SCHEMA_VERSION) {
      throw new CollabError(
        "database_version_too_new",
        "The collaboration database was created by a newer package version",
        { supported_schema_version: SCHEMA_VERSION, actual_schema_version: userVersion },
      );
    }
    if (this.tableNames().length > 0) {
      this.validateLegacyOrV2Shape(userVersion);
      if (userVersion === SCHEMA_VERSION) {
        this.validateV2Shape();
        this.validateAllJournals();
      }
    }
  }

  private prepareLegacyMigration(): PreparedLegacyWorkspace[] {
    if (
      this.tableNames().length === 0
      || pragmaNumber(this.db, "user_version") >= SCHEMA_VERSION
    ) return [];
    const workspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY id
    `).all() as Array<{ id: string; root_path: string }>;
    return workspaces.map((workspace) => ({
      ...workspace,
      identity: safeRepositoryIdentity(workspace.root_path),
    }));
  }

  private createLegacySchema(): void {
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
  }

  private migrateToV2(preparedWorkspaces: PreparedLegacyWorkspace[]): void {
    if (this.hasColumn("workspaces", "repository_key")) {
      throw new CollabError(
        "database_partial_migration",
        "The collaboration database has v0.2 columns without a committed schema version",
      );
    }

    const journalHeads = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all() as Array<{
      id: string;
      epoch_id: string;
      event_head_sequence: number;
      event_head_hash: string;
    }>;
    const currentWorkspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY id
    `).all() as Array<{ id: string; root_path: string }>;
    if (
      canonicalJson(currentWorkspaces)
      !== canonicalJson(
        preparedWorkspaces.map(({ id, root_path }) => ({ id, root_path })),
      )
    ) {
      throw new CollabError(
        "migration_source_changed",
        "Legacy workspace roots changed while migration identities were prepared; retry startup",
      );
    }
    const identities = new Map(
      preparedWorkspaces.map((workspace) => [workspace.id, workspace.identity]),
    );

    this.db.exec(`
      ALTER TABLE workspaces
        ADD COLUMN repository_key TEXT NOT NULL DEFAULT '';

      ALTER TABLE tasks
        ADD COLUMN coordination_mode TEXT NOT NULL DEFAULT 'legacy_v1'
        CHECK(coordination_mode IN ('legacy_v1', 'session_v2'));
      ALTER TABLE tasks
        ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'coordination'
        CHECK(work_mode IN ('coordination', 'read_only', 'edit'));
      ALTER TABLE tasks
        ADD COLUMN completion_policy TEXT NOT NULL DEFAULT 'reported'
        CHECK(completion_policy IN ('reported', 'accepted'));
      ALTER TABLE tasks
        ADD COLUMN review_status TEXT NOT NULL DEFAULT 'legacy_unreviewed'
        CHECK(review_status IN ('legacy_unreviewed', 'not_required', 'pending', 'accepted', 'changes_requested'));
      ALTER TABLE tasks ADD COLUMN review_generation INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN expected_base_sha TEXT;
      ALTER TABLE tasks ADD COLUMN base_checkpoint_json TEXT;
      ALTER TABLE tasks ADD COLUMN result_checkpoint_json TEXT;
      ALTER TABLE tasks ADD COLUMN completion_report_id TEXT;
      ALTER TABLE tasks ADD COLUMN assignee_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN claim_worktree_id TEXT;
      ALTER TABLE tasks ADD COLUMN reported_by TEXT;
      ALTER TABLE tasks ADD COLUMN reported_by_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN reported_at TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_by TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_by_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_at TEXT;

      ALTER TABLE artifacts ADD COLUMN attached_by_session_id TEXT;
      ALTER TABLE handoffs ADD COLUMN from_session_id TEXT;
      ALTER TABLE handoffs ADD COLUMN to_session_id TEXT;
      ALTER TABLE events ADD COLUMN session_id TEXT;

      CREATE TABLE repositories (
        key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE worktrees (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        repository_key TEXT NOT NULL REFERENCES repositories(key),
        root_path TEXT NOT NULL UNIQUE,
        git_common_dir_hash TEXT,
        fingerprint TEXT NOT NULL,
        branch TEXT,
        head_sha TEXT,
        dirty INTEGER,
        registered_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX worktrees_repository_idx
        ON worktrees(repository_key, workspace_id);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        worktree_id TEXT NOT NULL REFERENCES worktrees(id),
        actor TEXT NOT NULL,
        role TEXT,
        parent_session_id TEXT REFERENCES sessions(id),
        status TEXT NOT NULL CHECK(status IN ('active', 'ended')),
        generation INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ended_at TEXT,
        cursor_epoch_id TEXT NOT NULL,
        cursor_sequence INTEGER NOT NULL,
        cursor_hash TEXT NOT NULL,
        cursor_version INTEGER NOT NULL DEFAULT 0,
        reset_generation INTEGER NOT NULL DEFAULT 0,
        cursor_recovery_required INTEGER NOT NULL DEFAULT 0
          CHECK(cursor_recovery_required IN (0, 1))
      );
      CREATE INDEX sessions_workspace_status_idx
        ON sessions(workspace_id, status, last_seen_at);

      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        task_id TEXT,
        from_session_id TEXT REFERENCES sessions(id),
        from_actor TEXT NOT NULL,
        to_session_id TEXT REFERENCES sessions(id),
        kind TEXT NOT NULL CHECK(kind IN ('observation', 'inference', 'proposal', 'decision')),
        body TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low', 'unknown')),
        confidence_basis TEXT,
        limits TEXT,
        relation TEXT NOT NULL CHECK(relation IN ('informs', 'supports', 'challenges', 'corrects', 'withdraws', 'supersedes', 'resolves')),
        target_report_id TEXT REFERENCES reports(id),
        authority_scope TEXT,
        authority_basis TEXT,
        created_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX reports_workspace_event_idx
        ON reports(workspace_id, event_sequence);
      CREATE INDEX reports_target_idx ON reports(target_report_id);

      CREATE TABLE task_reviews (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        review_generation INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'changes_requested')),
        summary TEXT NOT NULL,
        reviewer_actor TEXT NOT NULL,
        reviewer_session_id TEXT NOT NULL REFERENCES sessions(id),
        created_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        UNIQUE(workspace_id, task_id, review_generation),
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );

      CREATE TABLE task_recoveries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        prior_lease_id TEXT NOT NULL,
        prior_session_id TEXT,
        recovered_by_session_id TEXT NOT NULL REFERENCES sessions(id),
        action TEXT NOT NULL CHECK(action IN ('takeover', 'release', 'block')),
        note TEXT NOT NULL,
        prior_checkpoint_json TEXT,
        new_lease_id TEXT,
        recovered_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        UNIQUE(workspace_id, task_id, prior_lease_id),
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );

      CREATE TABLE session_cursor_resets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        from_epoch_id TEXT NOT NULL,
        from_sequence INTEGER NOT NULL,
        from_hash TEXT NOT NULL,
        to_epoch_id TEXT NOT NULL,
        to_sequence INTEGER NOT NULL,
        to_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        reset_generation INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE v2_write_guard (
        nonce TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK(enabled = 1)
      );

      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        protocol TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    this.migrationFailpoint?.("v2_tables_created");

    const now = this.timestamp();
    const workspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY created_at, id
    `).all() as Array<{ id: string; root_path: string }>;
    for (const workspace of workspaces) {
      const identity = identities.get(workspace.id);
      if (!identity) {
        throw new CollabError(
          "migration_identity_missing",
          "A prepared legacy repository identity is missing",
          { workspace_id: workspace.id },
        );
      }
      this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`)
        .run(identity.repository_key, now);
      this.db.query(`UPDATE workspaces SET repository_key = ? WHERE id = ?`)
        .run(identity.repository_key, workspace.id);
      this.db.query(`
        INSERT INTO worktrees (
          id, workspace_id, repository_key, root_path, git_common_dir_hash, fingerprint,
          branch, head_sha, dirty, registered_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.checkpoint.worktree_id,
        workspace.id,
        identity.repository_key,
        identity.root_path,
        identity.git_common_dir_hash,
        identity.worktree_fingerprint,
        identity.checkpoint.branch,
        identity.checkpoint.head_sha,
        booleanToSql(identity.checkpoint.dirty),
        now,
        now,
      );
    }
    this.migrationFailpoint?.("v1_rows_backfilled");

    this.db.exec(`
      CREATE INDEX workspaces_repository_idx ON workspaces(repository_key);

      CREATE TRIGGER tasks_v2_insert_guard
      BEFORE INSERT ON tasks
      WHEN NEW.coordination_mode = 'session_v2'
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER tasks_v2_update_guard
      BEFORE UPDATE ON tasks
      WHEN (OLD.coordination_mode = 'session_v2' OR NEW.coordination_mode = 'session_v2')
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER tasks_v2_delete_guard
      BEFORE DELETE ON tasks
      WHEN OLD.coordination_mode = 'session_v2'
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER artifacts_v2_insert_guard
      BEFORE INSERT ON artifacts
      WHEN EXISTS (
        SELECT 1 FROM tasks
        WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id
          AND coordination_mode = 'session_v2'
      )
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER handoffs_v2_insert_guard
      BEFORE INSERT ON handoffs
      WHEN EXISTS (
        SELECT 1 FROM tasks
        WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id
          AND coordination_mode = 'session_v2'
      )
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;
    `);
    this.migrationFailpoint?.("v2_guards_created");

    const headsAfter = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all() as typeof journalHeads;
    if (canonicalJson(headsAfter) !== canonicalJson(journalHeads)) {
      throw new CollabError(
        "migration_journal_changed",
        "Migration attempted to change a pre-existing journal head",
      );
    }
    const foreignKeyFailures = this.db.query(`PRAGMA foreign_key_check`).all();
    if (foreignKeyFailures.length > 0) {
      throw new CollabError(
        "migration_foreign_key_failure",
        "Migration would leave invalid foreign-key references",
        { failures: foreignKeyFailures.length },
      );
    }
    const integrity = this.db.query(`PRAGMA integrity_check`).get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok") {
      throw new CollabError(
        "migration_integrity_failure",
        "SQLite integrity verification failed during migration",
      );
    }
    this.db.query(`
      INSERT INTO schema_migrations (version, protocol, applied_at)
      VALUES (?, ?, ?)
    `).run(SCHEMA_VERSION, COLLAB_PROTOCOL, now);
    this.migrationFailpoint?.("v2_verified");
  }

  private tableNames(): string[] {
    const rows = this.db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  private hasColumn(table: string, column: string): boolean {
    const rows = this.db.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private validateLegacyOrV2Shape(userVersion: number): void {
    const required: Record<string, string[]> = {
      workspaces: [
        "id", "epoch_id", "root_path", "name", "created_at",
        "event_head_sequence", "event_head_hash",
      ],
      tasks: [
        "id", "workspace_id", "title", "description", "status",
        "dependencies_json", "path_scopes_json", "assignee", "lease_id",
        "lease_expires_at", "blocker", "latest_progress", "version",
        "created_at", "updated_at", "completed_at",
      ],
      artifacts: [
        "id", "workspace_id", "task_id", "kind", "uri", "sha256",
        "media_type", "label", "attached_by", "attached_at",
      ],
      decisions: [
        "id", "workspace_id", "topic", "decision", "rationale",
        "recorded_by", "recorded_at",
      ],
      handoffs: [
        "id", "workspace_id", "task_id", "from_actor", "to_actor",
        "summary", "status", "offered_at", "expires_at", "resolved_at",
      ],
      events: [
        "workspace_id", "epoch_id", "sequence", "id", "protocol", "type",
        "entity_id", "actor", "occurred_at", "payload_json", "prev_hash", "hash",
      ],
      mutations: [
        "workspace_id", "actor", "idempotency_key", "operation",
        "request_hash", "response_json", "created_at",
      ],
    };
    this.requireColumns(required, "The SQLite file is not a complete agenttool collaboration database");

    const names = new Set(this.tableNames());
    const hasV2Marker =
      names.has("sessions")
      || names.has("schema_migrations")
      || this.hasColumn("workspaces", "repository_key")
      || this.hasColumn("tasks", "coordination_mode")
      || this.hasColumn("events", "session_id");
    if (userVersion < SCHEMA_VERSION && hasV2Marker) {
      throw new CollabError(
        "database_partial_migration",
        "The collaboration database has v0.2 objects without a committed schema version",
      );
    }
    if (userVersion === SCHEMA_VERSION) this.validateV2Shape();
  }

  private validateV2Shape(): void {
    this.requireColumns({
      workspaces: ["repository_key"],
      tasks: [
        "coordination_mode", "work_mode", "completion_policy", "review_status",
        "review_generation", "expected_base_sha", "base_checkpoint_json",
        "result_checkpoint_json", "completion_report_id", "assignee_session_id",
        "claim_worktree_id", "reported_by", "reported_by_session_id",
        "reported_at", "accepted_by", "accepted_by_session_id", "accepted_at",
      ],
      artifacts: ["attached_by_session_id"],
      handoffs: ["from_session_id", "to_session_id"],
      events: ["session_id"],
      repositories: ["key", "created_at"],
      worktrees: [
        "id", "workspace_id", "repository_key", "root_path",
        "git_common_dir_hash", "fingerprint", "branch", "head_sha", "dirty",
        "registered_at", "last_seen_at",
      ],
      sessions: [
        "id", "workspace_id", "worktree_id", "actor", "role",
        "parent_session_id", "status", "generation", "token_hash", "joined_at",
        "last_seen_at", "ended_at", "cursor_epoch_id", "cursor_sequence",
        "cursor_hash", "cursor_version", "reset_generation",
        "cursor_recovery_required",
      ],
      reports: [
        "id", "workspace_id", "task_id", "from_session_id", "from_actor",
        "to_session_id", "kind", "body", "evidence_refs_json", "confidence",
        "confidence_basis", "limits", "relation", "target_report_id",
        "authority_scope", "authority_basis", "created_at", "event_sequence",
      ],
      task_reviews: [
        "id", "workspace_id", "task_id", "review_generation", "outcome",
        "summary", "reviewer_actor", "reviewer_session_id", "created_at",
        "event_sequence",
      ],
      task_recoveries: [
        "id", "workspace_id", "task_id", "prior_lease_id", "prior_session_id",
        "recovered_by_session_id", "action", "note", "prior_checkpoint_json",
        "new_lease_id", "recovered_at", "event_sequence",
      ],
      session_cursor_resets: [
        "id", "session_id", "from_epoch_id", "from_sequence", "from_hash",
        "to_epoch_id", "to_sequence", "to_hash", "reason",
        "reset_generation", "created_at",
      ],
      v2_write_guard: ["nonce", "enabled"],
      schema_migrations: ["version", "protocol", "applied_at"],
    }, "The v0.2 collaboration schema is incomplete");

    const triggers = this.db.query(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND name IN (${V2_GUARD_TRIGGERS.map(() => "?").join(", ")})
    `).all(...V2_GUARD_TRIGGERS) as Array<{ name: string; sql: string | null }>;
    const byName = new Map(triggers.map((trigger) => [trigger.name, trigger.sql ?? ""]));
    for (const trigger of V2_GUARD_TRIGGERS) {
      const sql = byName.get(trigger);
      if (
        !sql
        || !sql.includes("v2_write_guard")
        || !sql.includes("agenttool_collab_v2_write_requires_v2_client")
      ) {
        throw new CollabError(
          "database_schema_mismatch",
          "A required v0.2 write guard is missing or malformed",
          { trigger },
        );
      }
    }
    const migrationRows = this.db.query(`
      SELECT version, protocol FROM schema_migrations ORDER BY version
    `).all() as Array<{ version: number; protocol: string }>;
    if (
      migrationRows.length !== 1
      || migrationRows[0]?.version !== SCHEMA_VERSION
      || migrationRows[0]?.protocol !== COLLAB_PROTOCOL
    ) {
      throw new CollabError(
        "database_migration_receipt_invalid",
        "The v0.2 migration receipt is missing or inconsistent",
      );
    }
    const staleGuards = this.db.query(`SELECT COUNT(*) AS count FROM v2_write_guard`)
      .get() as { count: number };
    if (staleGuards.count !== 0) {
      throw new CollabError(
        "database_write_guard_invalid",
        "The v0.2 write guard contains unexpected persistent state",
      );
    }
    if (this.db.query(`PRAGMA foreign_key_check`).all().length > 0) {
      throw new CollabError(
        "database_foreign_key_failure",
        "The collaboration database contains invalid foreign-key references",
      );
    }
  }

  private requireColumns(
    required: Record<string, string[]>,
    message: string,
  ): void {
    const names = new Set(this.tableNames());
    for (const [table, columns] of Object.entries(required)) {
      if (!names.has(table)) {
        throw new CollabError("database_schema_mismatch", message, {
          missing_table: table,
        });
      }
      for (const column of columns) {
        if (!this.hasColumn(table, column)) {
          throw new CollabError("database_schema_mismatch", message, {
            table,
            missing_column: column,
          });
        }
      }
    }
  }

  private validateAllJournals(): void {
    const workspaces = this.db.query(`SELECT id FROM workspaces ORDER BY id`)
      .all() as Array<{ id: string }>;
    for (const workspace of workspaces) {
      if (!this.verifyJournalRows(workspace.id)) {
        throw new CollabError(
          "database_journal_invalid",
          "A workspace event journal failed hash-chain verification",
          { workspace_id: workspace.id },
        );
      }
    }
  }

  private tightenFileModes(): void {
    if (!this.filesystemPath) return;
    for (const path of [this.filesystemPath, `${this.filesystemPath}-wal`, `${this.filesystemPath}-shm`]) {
      if (!existsSync(path)) continue;
      const stat = lstatSync(path);
      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || (typeof process.getuid === "function" && stat.uid !== process.getuid())
      ) {
        throw new CollabError(
          "database_sidecar_unsafe",
          "A collaboration database or sidecar path is not a regular file owned by this user",
          { operation: "tighten_database_file_mode" },
        );
      }
      chmodSync(path, 0o600);
    }
  }

  openWorkspace(input: {
    root_path: string;
    name?: string;
    actor: string;
    repository_key?: string;
  }): Workspace {
    const actor = validateActor(input.actor);
    const identity = inspectRepository(input.root_path, input.repository_key);
    const created = this.db.transaction(() => {
      const now = this.timestamp();
      const existingWorktree = this.db.query(`
        SELECT * FROM worktrees WHERE root_path = ?
      `).get(identity.root_path) as WorktreeRow | null;
      if (existingWorktree) {
        if (
          existingWorktree.repository_key !== identity.repository_key
          || existingWorktree.fingerprint !== identity.worktree_fingerprint
        ) {
          throw new CollabError(
            "worktree_identity_changed",
            "This path now resolves to a different repository/worktree identity",
            {
              root_path: identity.root_path,
              registered_worktree_id: existingWorktree.id,
            },
          );
        }
        this.touchWorktree(existingWorktree, identity.checkpoint, now);
        return this.requireWorkspace(existingWorktree.workspace_id);
      }

      const repositoryWorkspace = this.db.query(`
        SELECT id FROM workspaces
        WHERE repository_key = ?
        ORDER BY created_at, id
        LIMIT 1
      `).get(identity.repository_key) as { id: string } | null;
      const id = repositoryWorkspace?.id
        ?? `ws_${sha256(identity.repository_key).slice(0, 24)}`;
      const existing = this.getWorkspace(id);
      if (existing && existing.repository_key !== identity.repository_key) {
        throw new CollabError("workspace_identity_collision", "Workspace identity collision");
      }
      if (existing) {
        this.registerWorktree(existing.id, identity, now, actor, true);
        return this.requireWorkspace(existing.id);
      }

      const epochId = `epoch_${randomUUID()}`;
      const name = cleanText(
        input.name ?? identity.root_path.split("/").at(-1) ?? id,
        "name",
        200,
      );
      this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`)
        .run(identity.repository_key, now);
      this.db.query(`
        INSERT INTO workspaces
          (id, epoch_id, root_path, repository_key, name, created_at,
            event_head_sequence, event_head_hash)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        id,
        epochId,
        identity.root_path,
        identity.repository_key,
        name,
        now,
        GENESIS_HASH,
      );
      this.registerWorktree(id, identity, now, actor, false);
      this.appendEvent(id, "workspace.opened", id, actor, {
        root_path: identity.root_path,
        repository_key: identity.repository_key,
        worktree_id: identity.checkpoint.worktree_id,
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
      SELECT id, epoch_id, root_path, repository_key, name, created_at,
        event_head_sequence, event_head_hash
      FROM workspaces WHERE id = ?
    `).get(workspaceId) as WorkspaceRow | null;
    return row ? { ...row } : null;
  }

  getWorktree(workspaceId: string, rootPath: string): Worktree | null {
    const identity = inspectRepository(rootPath);
    const row = this.db.query(`
      SELECT * FROM worktrees WHERE workspace_id = ? AND root_path = ?
    `).get(workspaceId, identity.root_path) as WorktreeRow | null;
    return row ? worktreeFromRow(row) : null;
  }

  joinSession(input: {
    root_path: string;
    actor: string;
    role?: string;
    parent_session_id?: string;
    repository_key?: string;
  }): SessionHandle {
    const actor = validateActor(input.actor);
    const role = optionalText(input.role, "role", 200);
    const identity = inspectRepository(input.root_path, input.repository_key);
    const partitions = this.db.query(`
      SELECT id FROM workspaces
      WHERE repository_key = ?
      ORDER BY created_at, id
    `).all(identity.repository_key) as Array<{ id: string }>;
    if (partitions.length > 1) {
      throw new CollabError(
        "repository_partitioned",
        "This repository has multiple preserved v0.1 journals; explicit reconciliation is required before shared sessions can join",
        { workspace_ids: partitions.map((partition) => partition.id) },
      );
    }
    const workspace = this.openWorkspace({
      root_path: input.root_path,
      actor,
      repository_key: input.repository_key,
    });
    const worktreeRow = this.db.query(`
      SELECT * FROM worktrees WHERE workspace_id = ? AND root_path = ?
    `).get(workspace.id, identity.root_path) as WorktreeRow | null;
    if (!worktreeRow) {
      throw new CollabError("worktree_not_found", "The session worktree was not registered");
    }
    const parentSessionId = input.parent_session_id
      ? validateId(input.parent_session_id, "parent_session_id")
      : null;

    const joined = this.db.transaction(() => {
      if (parentSessionId) {
        const parent = this.requireSessionRow(parentSessionId);
        if (parent.workspace_id !== workspace.id) {
          throw new CollabError(
            "parent_session_mismatch",
            "A parent session must belong to the same workspace",
          );
        }
      }
      const now = this.timestamp();
      const id = `session_${randomUUID()}`;
      const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
      const generation = 1;
      this.db.query(`
        INSERT INTO sessions (
          id, workspace_id, worktree_id, actor, role, parent_session_id, status,
          generation, token_hash, joined_at, last_seen_at, ended_at,
          cursor_epoch_id, cursor_sequence, cursor_hash, cursor_version, reset_generation
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, ?, 0, ?, 0, 0)
      `).run(
        id,
        workspace.id,
        worktreeRow.id,
        actor,
        role,
        parentSessionId,
        generation,
        hashSessionToken(token),
        now,
        now,
        workspace.epoch_id,
        GENESIS_HASH,
      );
      this.appendEvent(workspace.id, "session.joined", id, actor, {
        worktree_id: worktreeRow.id,
        role,
        parent_session_id: parentSessionId,
        identity_boundary:
          "session_credentials_fence_cooperating_local_clients_but_do_not_authenticate_a_person_or_model",
      }, id);
      return this.sessionHandle(
        this.requireSessionRow(id),
        token,
        this.requireWorkspace(workspace.id),
        worktreeRow,
      );
    }).immediate();
    this.tightenFileModes();
    return joined;
  }

  resumeSession(credential: {
    session_id: string;
    session_token: string;
    generation?: number;
    last_cursor?: EventCursor;
  }, options: { allow_cursor_recovery?: boolean } = {}): SessionHandle {
    const sessionId = validateId(credential.session_id, "session_id");
    const resumed = this.db.transaction(() => {
      const row = this.authenticateResumeToken(sessionId, credential.session_token);
      const now = this.timestamp();
      const nextGeneration = row.generation + 1;
      const persistedCursor: EventCursor = {
        epoch_id: row.cursor_epoch_id,
        sequence: row.cursor_sequence,
        hash: row.cursor_hash,
      };
      let recovery: SessionHandle["cursor_recovery"] =
        row.cursor_recovery_required !== 0
          ? {
              required: true,
              cause: "host_cursor_mismatch",
              persisted_cursor: persistedCursor,
              host_cursor: credential.last_cursor ?? null,
              expected_cursor_version: row.cursor_version,
            }
          : undefined;
      try {
        this.validateEventAnchor(row.workspace_id, persistedCursor);
      } catch (error) {
        if (error instanceof CollabError) {
          recovery = {
            required: true,
            cause: "persisted_cursor_invalid",
            persisted_cursor: persistedCursor,
            host_cursor: credential.last_cursor ?? null,
            expected_cursor_version: row.cursor_version,
          };
        } else {
          throw error;
        }
      }
      if (!recovery && credential.last_cursor) {
        try {
          const known = this.validateEventAnchor(row.workspace_id, credential.last_cursor);
          if (
            known.epoch_id !== persistedCursor.epoch_id
            || known.sequence !== persistedCursor.sequence
            || known.hash !== persistedCursor.hash
          ) {
            recovery = {
              required: true,
              cause: "host_cursor_mismatch",
              persisted_cursor: persistedCursor,
              host_cursor: known,
              expected_cursor_version: row.cursor_version,
            };
          }
        } catch (error) {
          if (error instanceof CollabError) {
            recovery = {
              required: true,
              cause: "host_cursor_invalid",
              persisted_cursor: persistedCursor,
              host_cursor: credential.last_cursor,
              expected_cursor_version: row.cursor_version,
            };
          } else {
            throw error;
          }
        }
      }
      if (recovery && !options.allow_cursor_recovery) {
        throw new CollabError(
          "cursor_reset_required",
          "The host and persisted session cursors require an explicit audited reset",
          { ...recovery },
        );
      }
      const changed = this.db.query(`
        UPDATE sessions
        SET generation = ?, last_seen_at = ?, cursor_recovery_required = ?
        WHERE id = ? AND generation = ? AND status = 'active'
      `).run(
        nextGeneration,
        now,
        recovery ? 1 : 0,
        sessionId,
        row.generation,
      );
      if (changed.changes !== 1) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      this.appendEvent(row.workspace_id, "session.resumed", row.id, row.actor, {
        worktree_id: row.worktree_id,
        generation: nextGeneration,
        cursor_recovery_required: recovery?.required ?? false,
        cursor_recovery_cause: recovery?.cause ?? null,
      }, row.id);
      const next = this.requireSessionRow(row.id);
      const workspace = this.requireWorkspace(row.workspace_id);
      const worktree = this.requireWorktreeRow(row.worktree_id);
      const handle = this.sessionHandle(next, credential.session_token, workspace, worktree);
      if (recovery) {
        handle.cursor_recovery = recovery;
        handle.credential.last_cursor = credential.last_cursor;
      }
      return handle;
    }).immediate();
    this.tightenFileModes();
    return resumed;
  }

  endSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    reason?: string;
  }): CollabSession {
    const reason = optionalText(input.reason, "reason", 2_000);
    const ended = this.db.transaction(() => {
      const row = this.authenticateSession(input, { allow_cursor_recovery: true });
      const now = this.timestamp();
      const activeLeases = this.db.query(`
        SELECT id FROM tasks
        WHERE workspace_id = ? AND assignee_session_id = ?
          AND status = 'claimed' AND lease_expires_at > ?
        ORDER BY id
      `).all(row.workspace_id, row.id, now) as Array<{ id: string }>;
      if (activeLeases.length > 0) {
        throw new CollabError(
          "session_has_active_leases",
          "Release, complete, or hand off active task leases before ending the session",
          {
            task_ids: activeLeases.map((task) => task.id),
            required_action: "resolve_active_task_leases",
          },
        );
      }
      const incomingHandoffs = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_session_id = ? AND status = 'pending'
        ORDER BY offered_at, id
      `).all(row.workspace_id, row.id) as HandoffRow[];
      for (const handoff of incomingHandoffs) {
        this.db.query(`
          UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?
        `).run(now, handoff.id);
        this.appendEvent(
          row.workspace_id,
          "handoff.expired",
          handoff.id,
          row.actor,
          {
            task_id: handoff.task_id,
            reason: "target_session_ended",
          },
          row.id,
        );
      }
      const changed = this.db.query(`
        UPDATE sessions
        SET status = 'ended', ended_at = ?, last_seen_at = ?, generation = generation + 1,
          token_hash = ?
        WHERE id = ? AND generation = ? AND status = 'active'
      `).run(now, now, hashSessionToken(randomBytes(SESSION_TOKEN_BYTES).toString("base64url")), row.id, row.generation);
      if (changed.changes !== 1) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      this.appendEvent(row.workspace_id, "session.ended", row.id, row.actor, { reason }, row.id);
      return sessionFromRow(this.requireSessionRow(row.id));
    }).immediate();
    this.tightenFileModes();
    return ended;
  }

  listSessions(workspaceId: string, status?: "active" | "ended"): CollabSession[] {
    const workspace = this.requireWorkspace(workspaceId);
    const rows = status
      ? this.db.query(`
          SELECT * FROM sessions
          WHERE workspace_id = ? AND status = ?
          ORDER BY joined_at, id
        `).all(workspace.id, status) as SessionRow[]
      : this.db.query(`
          SELECT * FROM sessions
          WHERE workspace_id = ?
          ORDER BY joined_at, id
        `).all(workspace.id) as SessionRow[];
    return rows.map(sessionFromRow);
  }

  acknowledgeSessionCursor(input: {
    session_id: string;
    session_token: string;
    generation: number;
    anchor: EventCursor;
    expected_cursor_version: number;
  }): CollabSession {
    const acknowledged = this.db.transaction(() => {
      const row = this.authenticateSession(input);
      const anchor = this.validateEventAnchor(row.workspace_id, input.anchor);
      if (anchor.epoch_id !== row.cursor_epoch_id) {
        throw new CollabError("cursor_epoch_mismatch", "The cursor belongs to another journal epoch");
      }
      if (anchor.sequence < row.cursor_sequence) {
        throw new CollabError("cursor_regression", "A session cursor cannot move backwards", {
          current_sequence: row.cursor_sequence,
        });
      }
      if (anchor.sequence === row.cursor_sequence) {
        if (anchor.hash !== row.cursor_hash) {
          throw new CollabError(
            "cursor_fork_detected",
            "The cursor sequence now resolves to a different journal hash",
          );
        }
        return sessionFromRow(row);
      }
      if (row.cursor_version !== input.expected_cursor_version) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed", {
          expected_cursor_version: input.expected_cursor_version,
          current_cursor_version: row.cursor_version,
        });
      }
      const now = this.timestamp();
      const changed = this.db.query(`
        UPDATE sessions
        SET cursor_epoch_id = ?, cursor_sequence = ?, cursor_hash = ?,
          cursor_version = cursor_version + 1, last_seen_at = ?
        WHERE id = ? AND generation = ? AND cursor_version = ? AND status = 'active'
      `).run(
        anchor.epoch_id,
        anchor.sequence,
        anchor.hash,
        now,
        row.id,
        row.generation,
        row.cursor_version,
      );
      if (changed.changes !== 1) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      return sessionFromRow(this.requireSessionRow(row.id));
    }).immediate();
    this.tightenFileModes();
    return acknowledged;
  }

  resetSessionCursor(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    expected_cursor_version: number;
    target: EventCursor;
    reason: string;
  }): CollabSession {
    const reason = cleanText(input.reason, "reason", 2_000);
    this.mutateAsSession(
      input,
      input.idempotency_key,
      "cursor.reset.v2",
      {
        expected_cursor_version: input.expected_cursor_version,
        target: input.target,
        reason,
      },
      (row) => {
      if (row.cursor_version !== input.expected_cursor_version) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      const target = this.validateEventAnchor(row.workspace_id, input.target);
      const now = this.timestamp();
      const resetGeneration = row.reset_generation + 1;
      const id = `cursor_reset_${randomUUID()}`;
      this.db.query(`
        INSERT INTO session_cursor_resets (
          id, session_id, from_epoch_id, from_sequence, from_hash,
          to_epoch_id, to_sequence, to_hash, reason, reset_generation, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        row.id,
        row.cursor_epoch_id,
        row.cursor_sequence,
        row.cursor_hash,
        target.epoch_id,
        target.sequence,
        target.hash,
        reason,
        resetGeneration,
        now,
      );
      const changed = this.db.query(`
        UPDATE sessions
        SET cursor_epoch_id = ?, cursor_sequence = ?, cursor_hash = ?,
          cursor_version = cursor_version + 1, reset_generation = ?, last_seen_at = ?,
          cursor_recovery_required = 0
        WHERE id = ? AND generation = ? AND cursor_version = ? AND status = 'active'
      `).run(
        target.epoch_id,
        target.sequence,
        target.hash,
        resetGeneration,
        now,
        row.id,
        row.generation,
        row.cursor_version,
      );
      if (changed.changes !== 1) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      this.appendEvent(row.workspace_id, "session.cursor_reset", id, row.actor, {
        from: {
          epoch_id: row.cursor_epoch_id,
          sequence: row.cursor_sequence,
          hash: row.cursor_hash,
        },
        to: target,
        reason,
        reset_generation: resetGeneration,
      }, row.id);
      return sessionFromRow(this.requireSessionRow(row.id));
      },
      { allow_cursor_recovery: true },
    );
    const current = this.authenticateSession(input, {
      allow_cursor_recovery: true,
    });
    if (current.cursor_recovery_required !== 0) {
      throw new CollabError(
        "cursor_reset_receipt_stale",
        "This reset receipt predates the current recovery fence; use a new idempotency key",
        {
          persisted_cursor: {
            epoch_id: current.cursor_epoch_id,
            sequence: current.cursor_sequence,
            hash: current.cursor_hash,
          },
          expected_cursor_version: current.cursor_version,
        },
      );
    }
    return sessionFromRow(current);
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
      } else if (task.effective_status === "recovery_required") {
        counts.claimed += 1;
        expiredClaims += 1;
      } else {
        counts[task.status] += 1;
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
      pending_reviews: tasks.filter((task) => task.review_status === "pending"),
      active_sessions: this.listSessions(workspaceId, "active"),
      recent_decisions: decisions.map(decisionFromRow),
      recent_reports: this.listReports(workspaceId, { limit: 20 }),
    };
  }

  createTask(input: CreateTaskInput): Task {
    const sessionOnly = input as CreateTaskInput & {
      work_mode?: unknown;
      completion_policy?: unknown;
      expected_base_sha?: unknown;
    };
    if (
      sessionOnly.work_mode !== undefined
      || sessionOnly.completion_policy !== undefined
      || sessionOnly.expected_base_sha !== undefined
    ) {
      throw new CollabError(
        "session_required_for_v2_task_options",
        "work_mode, completion_policy, and expected_base_sha require createTaskForSession",
      );
    }
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

  createTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    id?: string;
    title: string;
    description?: string;
    dependencies?: string[];
    path_scopes?: string[];
    work_mode?: TaskWorkMode;
    completion_policy?: CompletionPolicy;
    expected_base_sha?: string;
  }): Task {
    const normalized = {
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      id: input.id ? validateId(input.id, "task_id") : undefined,
      title: cleanText(input.title, "title", 300),
      description: optionalText(input.description, "description", MAX_TEXT),
      dependencies: normalizeDependencies(input.dependencies ?? []),
      path_scopes: normalizePathScopes(input.path_scopes ?? []),
      work_mode: input.work_mode ?? "edit",
      completion_policy: input.completion_policy,
      expected_base_sha: input.expected_base_sha
        ? validateGitObjectId(input.expected_base_sha)
        : null,
    };
    if (!["coordination", "read_only", "edit"].includes(normalized.work_mode)) {
      throw new CollabError("invalid_work_mode", "Unsupported task work mode");
    }
    if (normalized.work_mode === "edit" && normalized.path_scopes.length === 0) {
      throw new CollabError(
        "edit_scope_required",
        "Edit tasks require at least one repository-relative path scope",
      );
    }
    const completionPolicy = normalized.completion_policy
      ?? (normalized.work_mode === "edit" ? "accepted" : "reported");
    if (!["reported", "accepted"].includes(completionPolicy)) {
      throw new CollabError("invalid_completion_policy", "Unsupported completion policy");
    }
    const request = { ...normalized, completion_policy: completionPolicy };
    return this.mutateAsSession(input, normalized.idempotency_key, "task.create.v2", request, (session) => {
      const id = normalized.id ?? `task_${randomUUID()}`;
      if (normalized.dependencies.includes(id)) {
        throw new CollabError("invalid_dependency", "A task cannot depend on itself", {
          task_id: id,
        });
      }
      for (const dependency of normalized.dependencies) {
        this.requireTaskRow(session.workspace_id, dependency);
      }
      if (this.readTaskRow(session.workspace_id, id)) {
        throw new CollabError("task_exists", `Task '${id}' already exists`, { task_id: id });
      }
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO tasks (
          id, workspace_id, title, description, status, dependencies_json, path_scopes_json,
          coordination_mode, work_mode, completion_policy, review_status, review_generation,
          expected_base_sha, base_checkpoint_json, result_checkpoint_json, completion_report_id,
          assignee, assignee_session_id, claim_worktree_id, lease_id, lease_expires_at,
          blocker, latest_progress, reported_by, reported_by_session_id, reported_at,
          accepted_by, accepted_by_session_id, accepted_at, version,
          created_at, updated_at, completed_at
        ) VALUES (
          ?, ?, ?, ?, 'open', ?, ?,
          'session_v2', ?, ?, 'not_required', 0,
          ?, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, 1,
          ?, ?, NULL
        )
      `).run(
        id,
        session.workspace_id,
        normalized.title,
        normalized.description,
        canonicalJson(normalized.dependencies),
        canonicalJson(normalized.path_scopes),
        normalized.work_mode,
        completionPolicy,
        normalized.expected_base_sha,
        now,
        now,
      );
      this.appendEvent(session.workspace_id, "task.created", id, session.actor, {
        title: normalized.title,
        description: normalized.description,
        dependencies: normalized.dependencies,
        path_scopes: normalized.path_scopes,
        work_mode: normalized.work_mode,
        completion_policy: completionPolicy,
        expected_base_sha: normalized.expected_base_sha,
        version: 1,
      }, session.id);
      return this.requireTask(session.workspace_id, id);
    });
  }

  claimTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    expected_version: number;
    ttl_seconds?: number;
  }): Task {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const ttl = validateTtl(input.ttl_seconds);
    const request = { task_id: taskId, expected_version: expectedVersion, ttl_seconds: ttl };
    const replay = this.readSessionMutationReceipt<Task>(
      input,
      input.idempotency_key,
      "task.claim.v2",
      request,
    );
    if (replay.found) return replay.value;
    const preparedCheckpoint = this.captureSessionWorktree(input);
    return this.mutateAsSession(input, input.idempotency_key, "task.claim.v2", request, (session) => {
      let row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (this.isExpired(row)) {
        if (row.assignee_session_id) {
          throw new CollabError(
            "recovery_required",
            "An expired session lease requires an explicit recovery note",
            this.recoveryBundle(row),
          );
        }
        row = this.expireClaim(row, "system:clock");
      }
      if (row.status === "completed") {
        throw new CollabError("task_completed", "Completed tasks cannot be claimed", {
          review_status: row.review_status,
        });
      }
      if (row.status === "blocked") {
        throw new CollabError("task_blocked", "Blocked tasks must be unblocked before claiming", {
          blocker: row.blocker,
        });
      }
      if (row.status === "claimed") {
        throw new CollabError("task_claimed", "Task already has an active claim", {
          assignee: row.assignee,
          assignee_session_id: row.assignee_session_id,
          lease_expires_at: row.lease_expires_at,
        });
      }
      if (row.work_mode === "edit" && parseStringArray(row.path_scopes_json).length === 0) {
        throw new CollabError("edit_scope_required", "Edit tasks require path scopes");
      }
      this.requireDependenciesComplete(row);
      this.requirePathsAvailable(row);
      const worktree = this.requirePreparedWorktree(session, preparedCheckpoint);
      const checkpoint = preparedCheckpoint.checkpoint;
      this.requireExpectedBase(row, checkpoint);
      const now = this.timestamp();
      const leaseId = `lease_${randomUUID()}`;
      const expiresAt = addSeconds(now, ttl);
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks
        SET coordination_mode = 'session_v2',
          status = 'claimed', assignee = ?, assignee_session_id = ?,
          claim_worktree_id = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, base_checkpoint_json = ?,
          result_checkpoint_json = NULL, completion_report_id = NULL,
          review_status = 'not_required',
          reported_by = NULL, reported_by_session_id = NULL, reported_at = NULL,
          accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
          completed_at = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(
        session.actor,
        session.id,
        worktree.id,
        leaseId,
        expiresAt,
        canonicalJson(checkpoint),
        version,
        now,
        row.workspace_id,
        row.id,
      );
      this.appendEvent(row.workspace_id, "task.claimed", row.id, session.actor, {
        lease_id: leaseId,
        lease_expires_at: expiresAt,
        worktree_id: worktree.id,
        base_checkpoint: checkpoint,
        version,
        checkpoint_boundary:
          "server_observed_local_git_state_is_evidence_not_atomic_attribution_or_a_filesystem_lock",
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }

  recoverTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    expected_version: number;
    recovery_note: string;
    action?: "takeover" | "release" | "block";
    blocker?: string;
    ttl_seconds?: number;
  }): Task {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const recoveryNote = cleanText(input.recovery_note, "recovery_note", 4_000);
    const action = input.action ?? "takeover";
    if (!["takeover", "release", "block"].includes(action)) {
      throw new CollabError("invalid_recovery_action", "Recovery action is invalid");
    }
    const blocker = optionalText(input.blocker, "blocker", 2_000);
    if (action === "block" && !blocker) {
      throw new CollabError("recovery_blocker_required", "Blocking recovery requires a blocker");
    }
    const ttl = validateTtl(input.ttl_seconds);
    const request = {
      task_id: taskId,
      expected_version: expectedVersion,
      recovery_note: recoveryNote,
      action,
      blocker,
      ttl_seconds: ttl,
    };
    const replay = this.readSessionMutationReceipt<Task>(
      input,
      input.idempotency_key,
      "task.recover.v2",
      request,
    );
    if (replay.found) return replay.value;
    const preparedCheckpoint = action === "takeover"
      ? this.captureSessionWorktree(input)
      : null;
    return this.mutateAsSession(input, input.idempotency_key, "task.recover.v2", request, (session) => {
      const row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (!this.isExpired(row) || !row.lease_id || !row.assignee_session_id) {
        throw new CollabError(
          "recovery_not_required",
          "Only an expired session-owned lease can be explicitly recovered",
        );
      }
      const prior = {
        assignee: row.assignee,
        session_id: row.assignee_session_id,
        lease_id: row.lease_id,
        lease_expires_at: row.lease_expires_at,
        checkpoint: parseCheckpoint(row.base_checkpoint_json),
      };
      const now = this.timestamp();
      const expiryVersion = row.version + 1;
      this.db.query(`
        UPDATE tasks
        SET status = 'open', assignee = NULL, assignee_session_id = NULL,
          claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
          version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(expiryVersion, now, row.workspace_id, row.id);
      this.expirePendingHandoffs(
        row.workspace_id,
        row.id,
        now,
        "system:clock",
        "source_lease_expired",
      );
      this.appendEvent(row.workspace_id, "task.claim_expired", row.id, "system:clock", {
        ...prior,
        effective_at: prior.lease_expires_at,
        observed_by_session_id: session.id,
        version: expiryVersion,
      });

      if (action !== "takeover") {
        const version = expiryVersion + 1;
        this.db.query(`
          UPDATE tasks
          SET status = ?, blocker = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(
          action === "block" ? "blocked" : "open",
          action === "block" ? blocker : null,
          version,
          now,
          row.workspace_id,
          row.id,
        );
        const event = this.appendEvent(
          row.workspace_id,
          "task.recovered",
          row.id,
          session.actor,
          {
            prior_lease: prior,
            action,
            recovery_note: recoveryNote,
            recovery_checkpoint: null,
            version,
            note:
              "Recovery acknowledges an expired coordination lease; it does not accept or attribute prior work.",
          },
          session.id,
        );
        this.db.query(`
          INSERT INTO task_recoveries (
            id, workspace_id, task_id, prior_lease_id, prior_session_id,
            recovered_by_session_id, action, note, prior_checkpoint_json,
            new_lease_id, recovered_at, event_sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(
          `recovery_${randomUUID()}`,
          row.workspace_id,
          row.id,
          prior.lease_id,
          prior.session_id,
          session.id,
          action,
          recoveryNote,
          prior.checkpoint ? canonicalJson(prior.checkpoint) : null,
          now,
          event.sequence,
        );
        return this.requireTask(row.workspace_id, row.id);
      }

      const worktree = this.requirePreparedWorktree(session, preparedCheckpoint!);
      const checkpoint = preparedCheckpoint!.checkpoint;
      const opened = this.requireTaskRow(row.workspace_id, row.id);
      this.requireDependenciesComplete(opened);
      this.requirePathsAvailable(opened);
      this.requireExpectedBase(opened, checkpoint);
      const leaseId = `lease_${randomUUID()}`;
      const leaseExpiresAt = addSeconds(now, ttl);
      const version = expiryVersion + 1;
      this.db.query(`
        UPDATE tasks
        SET status = 'claimed', assignee = ?, assignee_session_id = ?,
          claim_worktree_id = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, base_checkpoint_json = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(
        session.actor,
        session.id,
        worktree.id,
        leaseId,
        leaseExpiresAt,
        canonicalJson(checkpoint),
        version,
        now,
        row.workspace_id,
        row.id,
      );
      const event = this.appendEvent(row.workspace_id, "task.recovered", row.id, session.actor, {
        prior_lease: prior,
        recovery_note: recoveryNote,
        recovery_checkpoint: checkpoint,
        lease_id: leaseId,
        lease_expires_at: leaseExpiresAt,
        version,
        note: "Recovery acknowledges an expired coordination lease; it does not accept or attribute prior work.",
      }, session.id);
      this.db.query(`
        INSERT INTO task_recoveries (
          id, workspace_id, task_id, prior_lease_id, prior_session_id,
          recovered_by_session_id, action, note, prior_checkpoint_json,
          new_lease_id, recovered_at, event_sequence
        ) VALUES (?, ?, ?, ?, ?, ?, 'takeover', ?, ?, ?, ?, ?)
      `).run(
        `recovery_${randomUUID()}`,
        row.workspace_id,
        row.id,
        prior.lease_id,
        prior.session_id,
        session.id,
        recoveryNote,
        prior.checkpoint ? canonicalJson(prior.checkpoint) : null,
        leaseId,
        now,
        event.sequence,
      );
      return this.requireTask(row.workspace_id, row.id);
    });
  }

  renewLeaseForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    lease_id: string;
    expected_version: number;
    ttl_seconds?: number;
  }): Task {
    const normalized = normalizeSessionLeaseInput(input);
    const ttl = validateTtl(input.ttl_seconds);
    return this.mutateAsSession(
      input,
      normalized.idempotency_key,
      "task.renew.v2",
      { ...normalized.request, ttl_seconds: ttl },
      (session) => {
        const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
        this.requireVersion(row, normalized.expected_version);
        this.requireActiveSessionLease(row, session, normalized.lease_id);
        const now = this.timestamp();
        const candidate = addSeconds(now, ttl);
        const expiresAt = row.lease_expires_at && row.lease_expires_at > candidate
          ? row.lease_expires_at
          : candidate;
        const version = row.version + 1;
        this.db.query(`
          UPDATE tasks SET lease_expires_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(expiresAt, version, now, row.workspace_id, row.id);
        this.appendEvent(row.workspace_id, "task.lease_renewed", row.id, session.actor, {
          lease_id: normalized.lease_id,
          lease_expires_at: expiresAt,
          version,
        }, session.id);
        return this.requireTask(row.workspace_id, row.id);
      },
    );
  }

  progressTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    lease_id: string;
    expected_version: number;
    message: string;
  }): Task {
    const normalized = normalizeSessionLeaseInput(input);
    const message = cleanText(input.message, "message", 2_000);
    return this.mutateAsSession(
      input,
      normalized.idempotency_key,
      "task.progress.v2",
      { ...normalized.request, message },
      (session) => {
        const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
        this.requireVersion(row, normalized.expected_version);
        this.requireActiveSessionLease(row, session, normalized.lease_id);
        const now = this.timestamp();
        const version = row.version + 1;
        this.db.query(`
          UPDATE tasks SET latest_progress = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(message, version, now, row.workspace_id, row.id);
        this.appendEvent(row.workspace_id, "task.progressed", row.id, session.actor, {
          message,
          version,
        }, session.id);
        return this.requireTask(row.workspace_id, row.id);
      },
    );
  }

  releaseTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    lease_id: string;
    expected_version: number;
    summary?: string;
  }): Task {
    const normalized = normalizeSessionLeaseInput(input);
    const summary = optionalText(input.summary, "summary", 2_000);
    return this.mutateAsSession(
      input,
      normalized.idempotency_key,
      "task.release.v2",
      { ...normalized.request, summary },
      (session) => {
        const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
        this.requireVersion(row, normalized.expected_version);
        this.requireActiveSessionLease(row, session, normalized.lease_id);
        return this.clearSessionClaim(row, session, "task.released", { summary });
      },
    );
  }

  blockTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    lease_id: string;
    expected_version: number;
    blocker: string;
  }): Task {
    const normalized = normalizeSessionLeaseInput(input);
    const blocker = cleanText(input.blocker, "blocker", 2_000);
    return this.mutateAsSession(
      input,
      normalized.idempotency_key,
      "task.block.v2",
      { ...normalized.request, blocker },
      (session) => {
        const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
        this.requireVersion(row, normalized.expected_version);
        this.requireActiveSessionLease(row, session, normalized.lease_id);
        const now = this.timestamp();
        const version = row.version + 1;
        this.db.query(`
          UPDATE tasks
          SET status = 'blocked', assignee = NULL, assignee_session_id = NULL,
            claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
            blocker = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(blocker, version, now, row.workspace_id, row.id);
        this.expirePendingHandoffs(
          row.workspace_id,
          row.id,
          now,
          session.actor,
          "task_blocked",
        );
        this.appendEvent(row.workspace_id, "task.blocked", row.id, session.actor, {
          blocker,
          version,
        }, session.id);
        return this.requireTask(row.workspace_id, row.id);
      },
    );
  }

  unblockTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    expected_version: number;
    note?: string;
  }): Task {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const note = optionalText(input.note, "note", 2_000);
    return this.mutateAsSession(
      input,
      input.idempotency_key,
      "task.unblock.v2",
      { task_id: taskId, expected_version: expectedVersion, note },
      (session) => {
        const row = this.requireTaskRow(session.workspace_id, taskId);
        this.requireVersion(row, expectedVersion);
        if (row.status !== "blocked") {
          throw new CollabError("task_not_blocked", "Only blocked tasks can be unblocked");
        }
        const now = this.timestamp();
        const version = row.version + 1;
        this.db.query(`
          UPDATE tasks
          SET status = 'open', blocker = NULL, review_status = 'not_required',
            version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
        this.appendEvent(row.workspace_id, "task.unblocked", row.id, session.actor, {
          note,
          version,
        }, session.id);
        return this.requireTask(row.workspace_id, row.id);
      },
    );
  }

  attachArtifactForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    lease_id: string;
    expected_version: number;
    kind: ArtifactRef["kind"];
    uri: string;
    sha256?: string;
    media_type?: string;
    label?: string;
  }): { task: Task; artifact: ArtifactRef } {
    const normalized = normalizeSessionLeaseInput(input);
    const artifactInput = {
      kind: validateArtifactKind(input.kind),
      uri: cleanText(input.uri, "uri", 2_000),
      sha256: input.sha256 ? validateSha256(input.sha256) : null,
      media_type: optionalText(input.media_type, "media_type", 200),
      label: optionalText(input.label, "label", 300),
    };
    return this.mutateAsSession(
      input,
      normalized.idempotency_key,
      "artifact.attach.v2",
      { ...normalized.request, ...artifactInput },
      (session) => {
        const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
        this.requireVersion(row, normalized.expected_version);
        this.requireActiveSessionLease(row, session, normalized.lease_id);
        const now = this.timestamp();
        const id = `artifact_${randomUUID()}`;
        this.db.query(`
          INSERT INTO artifacts (
            id, workspace_id, task_id, kind, uri, sha256, media_type, label,
            attached_by, attached_by_session_id, attached_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          row.workspace_id,
          row.id,
          artifactInput.kind,
          artifactInput.uri,
          artifactInput.sha256,
          artifactInput.media_type,
          artifactInput.label,
          session.actor,
          session.id,
          now,
        );
        const version = row.version + 1;
        this.db.query(`
          UPDATE tasks SET version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
        const artifact = this.requireArtifact(id);
        this.appendEvent(row.workspace_id, "artifact.attached", row.id, session.actor, {
          artifact,
          version,
        }, session.id);
        return { task: this.requireTask(row.workspace_id, row.id), artifact };
      },
    );
  }

  completeTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    lease_id: string;
    expected_version: number;
    summary: string;
    confidence?: ReportConfidence;
    confidence_basis?: string;
    limits?: string;
    evidence_refs?: string[];
  }): Task {
    const normalized = normalizeSessionLeaseInput(input);
    const summary = cleanText(input.summary, "summary", 4_000);
    const confidence = validateReportConfidence(input.confidence ?? "unknown");
    const confidenceBasis = optionalText(input.confidence_basis, "confidence_basis", 2_000);
    const limits = optionalText(input.limits, "limits", 2_000);
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const request = {
      ...normalized.request,
      summary,
      confidence,
      confidence_basis: confidenceBasis,
      limits,
      evidence_refs: evidenceRefs,
    };
    const replay = this.readSessionMutationReceipt<Task>(
      input,
      normalized.idempotency_key,
      "task.complete.v2",
      request,
    );
    if (replay.found) return replay.value;
    const preparedCheckpoint = this.captureSessionWorktree(input);
    return this.mutateAsSession(
      input,
      normalized.idempotency_key,
      "task.complete.v2",
      request,
      (session) => {
        const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
        this.requireVersion(row, normalized.expected_version);
        this.requireActiveSessionLease(row, session, normalized.lease_id);
        for (const reference of evidenceRefs) {
          this.requireEvidenceRef(row.workspace_id, reference);
        }
        this.requirePreparedWorktree(session, preparedCheckpoint);
        const checkpoint = preparedCheckpoint.checkpoint;
        const report = this.appendReportInternal(session, {
          task_id: row.id,
          to_session_id: null,
          kind: "observation",
          body: summary,
          evidence_refs: evidenceRefs,
          confidence,
          confidence_basis: confidenceBasis,
          limits,
          relation: "informs",
          target_report_id: null,
          authority_scope: null,
          authority_basis: null,
        });
        const now = this.timestamp();
        const version = row.version + 1;
        const reviewGeneration = row.review_generation + 1;
        const reviewStatus: ReviewStatus = row.completion_policy === "accepted"
          ? "pending"
          : "not_required";
        this.db.query(`
          UPDATE tasks
          SET status = 'completed', review_status = ?, review_generation = ?,
            assignee = NULL, assignee_session_id = NULL, claim_worktree_id = NULL,
            lease_id = NULL, lease_expires_at = NULL, blocker = NULL,
            latest_progress = ?, result_checkpoint_json = ?, completion_report_id = ?,
            reported_by = ?, reported_by_session_id = ?, reported_at = ?,
            accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
            version = ?, updated_at = ?, completed_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(
          reviewStatus,
          reviewGeneration,
          summary,
          canonicalJson(checkpoint),
          report.id,
          session.actor,
          session.id,
          now,
          version,
          now,
          now,
          row.workspace_id,
          row.id,
        );
        this.expirePendingHandoffs(
          row.workspace_id,
          row.id,
          now,
          session.actor,
          "task_reported_complete",
        );
        this.appendEvent(
          row.workspace_id,
          reviewStatus === "pending" ? "task.reported_complete" : "task.completed",
          row.id,
          session.actor,
          {
            completion_report_id: report.id,
            completion_policy: row.completion_policy,
            review_status: reviewStatus,
            review_generation: reviewGeneration,
            result_checkpoint: checkpoint,
            summary,
            version,
            note: reviewStatus === "pending"
              ? "Reported completion does not satisfy dependencies until a distinct session accepts it."
              : "Reported completion satisfies this task's explicit reported-only policy; it is not external acceptance.",
          },
          session.id,
        );
        return this.requireTask(row.workspace_id, row.id);
      },
    );
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

  appendReportForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id?: string;
    to_session_id?: string;
    kind: ReportKind;
    body: string;
    evidence_refs?: string[];
    confidence?: ReportConfidence;
    confidence_basis?: string;
    limits?: string;
    relation?: ReportRelation;
    target_report_id?: string;
    authority_scope?: string;
    authority_basis?: string;
  }): CollabReport {
    const normalized = {
      task_id: input.task_id ? validateId(input.task_id, "task_id") : null,
      to_session_id: input.to_session_id
        ? validateId(input.to_session_id, "to_session_id")
        : null,
      kind: validateReportKind(input.kind),
      body: cleanText(input.body, "body", MAX_REPORT_BODY),
      evidence_refs: normalizeEvidenceRefs(input.evidence_refs ?? []),
      confidence: validateReportConfidence(input.confidence ?? "unknown"),
      confidence_basis: optionalText(input.confidence_basis, "confidence_basis", 2_000),
      limits: optionalText(input.limits, "limits", 2_000),
      relation: validateReportRelation(input.relation ?? "informs"),
      target_report_id: input.target_report_id
        ? validateId(input.target_report_id, "target_report_id")
        : null,
      authority_scope: optionalText(input.authority_scope, "authority_scope", 1_000),
      authority_basis: optionalText(input.authority_basis, "authority_basis", 2_000),
    };
    return this.mutateAsSession(
      input,
      input.idempotency_key,
      "report.append.v2",
      normalized,
      (session) => {
        this.validateReportInput(session, normalized);
        return this.appendReportInternal(session, normalized);
      },
    );
  }

  listReports(
    workspaceId: string,
    options: {
      after_event_sequence?: number;
      limit?: number;
      task_id?: string;
      to_session_id?: string;
    } = {},
  ): CollabReport[] {
    this.requireWorkspace(workspaceId);
    const after = options.after_event_sequence ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isInteger(after) || after < 0) {
      throw new CollabError("invalid_cursor", "Report cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Report limit must be between 1 and 500");
    }
    const taskId = options.task_id ? validateId(options.task_id, "task_id") : null;
    const toSessionId = options.to_session_id
      ? validateId(options.to_session_id, "to_session_id")
      : null;
    const rows = this.db.query(`
      SELECT * FROM reports
      WHERE workspace_id = ?
        AND event_sequence > ?
        AND (? IS NULL OR task_id = ?)
        AND (? IS NULL OR to_session_id = ?)
      ORDER BY event_sequence
      LIMIT ?
    `).all(
      workspaceId,
      after,
      taskId,
      taskId,
      toSessionId,
      toSessionId,
      limit,
    ) as ReportRow[];
    return rows.map(reportFromRow);
  }

  reviewTaskForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    expected_version: number;
    outcome: "accept" | "request_changes";
    summary: string;
    evidence_refs?: string[];
  }): { task: Task; review: TaskReview; report: CollabReport } {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    if (input.outcome !== "accept" && input.outcome !== "request_changes") {
      throw new CollabError("invalid_review_outcome", "Review outcome is invalid");
    }
    const summary = cleanText(input.summary, "summary", 4_000);
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const request = {
      task_id: taskId,
      expected_version: expectedVersion,
      outcome: input.outcome,
      summary,
      evidence_refs: evidenceRefs,
    };
    const replay = this.readSessionMutationReceipt<{
      task: Task;
      review: TaskReview;
      report: CollabReport;
    }>(input, input.idempotency_key, "task.review.v2", request);
    if (replay.found) return replay.value;
    const preparedCheckpoint = input.outcome === "accept"
      ? this.captureReviewCheckpoint(input, taskId)
      : null;
    return this.mutateAsSession(input, input.idempotency_key, "task.review.v2", request, (session) => {
      const row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (row.completion_policy !== "accepted" || row.review_status !== "pending") {
        throw new CollabError(
          "task_not_pending_review",
          "Task does not have a pending acceptance review",
          { review_status: row.review_status },
        );
      }
      if (!row.reported_by_session_id || !row.completion_report_id) {
        throw new CollabError("review_state_invalid", "Task completion review metadata is incomplete");
      }
      if (row.reported_by_session_id === session.id) {
        throw new CollabError(
          "self_review_forbidden",
          "A distinct session must review reported completion",
        );
      }
      for (const reference of evidenceRefs) this.requireEvidenceRef(row.workspace_id, reference);
      if (
        input.outcome === "accept"
        && this.hasObsoletedCompletionReport(row.workspace_id, row.completion_report_id)
      ) {
        throw new CollabError(
          "completion_report_obsolete",
          "The reported completion was withdrawn, corrected, or superseded; request changes before a new completion report",
          { completion_report_id: row.completion_report_id },
        );
      }
      if (
        input.outcome === "accept"
        && this.hasUnresolvedChallenges(row.workspace_id, row.completion_report_id)
      ) {
        throw new CollabError(
          "completion_challenged",
          "Reported completion has an unresolved challenge",
          { completion_report_id: row.completion_report_id },
        );
      }
      if (input.outcome === "accept") {
        const resultCheckpoint = parseCheckpoint(row.result_checkpoint_json);
        if (resultCheckpoint?.source === "server_observed") {
          if (
            !preparedCheckpoint
            || checkpointDigest(preparedCheckpoint.result_checkpoint)
              !== checkpointDigest(resultCheckpoint)
          ) {
            throw new CollabError(
              "worktree_observation_stale",
              "The completion checkpoint changed after review preparation",
            );
          }
          this.requirePreparedRegisteredWorktree(
            row.workspace_id,
            resultCheckpoint.worktree_id,
            preparedCheckpoint.observed_worktree,
          );
          const observed = preparedCheckpoint.observed_worktree.checkpoint;
          requireCompleteGitCheckpoint(resultCheckpoint);
          requireCompleteGitCheckpoint(observed);
          if (!checkpointStateMatches(resultCheckpoint, observed)) {
            throw new CollabError(
              "git_checkpoint_stale",
              "The completion worktree changed after its result checkpoint was captured",
              {
                result_checkpoint: resultCheckpoint,
                observed_checkpoint: observed,
                boundary:
                  "checkpoint_validation_is_a_local_observation_not_an_atomic_git_sqlite_lock",
              },
            );
          }
        }
      }

      const report = this.appendReportInternal(session, {
        task_id: row.id,
        to_session_id: row.reported_by_session_id,
        kind: input.outcome === "accept" ? "observation" : "inference",
        body: summary,
        evidence_refs: [
          `report:${row.completion_report_id}`,
          ...evidenceRefs.filter((reference) => reference !== `report:${row.completion_report_id}`),
        ],
        confidence: "unknown",
        confidence_basis: null,
        limits: null,
        relation: input.outcome === "accept" ? "supports" : "challenges",
        target_report_id: row.completion_report_id,
        authority_scope: "local_task_coordination_review",
        authority_basis: "distinct active collaboration session",
      });
      const now = this.timestamp();
      const reviewId = `review_${randomUUID()}`;
      const version = row.version + 1;
      const outcome = input.outcome === "accept" ? "accepted" : "changes_requested";
      if (input.outcome === "accept") {
        this.db.query(`
          UPDATE tasks
          SET review_status = 'accepted', accepted_by = ?, accepted_by_session_id = ?,
            accepted_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(session.actor, session.id, now, version, now, row.workspace_id, row.id);
      } else {
        this.db.query(`
          UPDATE tasks
          SET status = 'open', review_status = 'changes_requested',
            accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
            version = ?, updated_at = ?, completed_at = NULL
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      }
      const event = this.appendEvent(
        row.workspace_id,
        input.outcome === "accept" ? "task.accepted" : "task.changes_requested",
        row.id,
        session.actor,
        {
          review_id: reviewId,
          review_report_id: report.id,
          completion_report_id: row.completion_report_id,
          review_generation: row.review_generation,
          outcome,
          summary,
          version,
          authority_boundary:
            "acceptance_is_local_coordination_review_not_merge_deploy_truth_or_external_authority",
        },
        session.id,
      );
      this.db.query(`
        INSERT INTO task_reviews (
          id, workspace_id, task_id, review_generation, outcome, summary,
          reviewer_actor, reviewer_session_id, created_at, event_sequence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reviewId,
        row.workspace_id,
        row.id,
        row.review_generation,
        outcome,
        summary,
        session.actor,
        session.id,
        now,
        event.sequence,
      );
      return {
        task: this.requireTask(row.workspace_id, row.id),
        review: this.requireReview(reviewId),
        report,
      };
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

  offerHandoffForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    task_id: string;
    lease_id: string;
    expected_version: number;
    to_session_id: string;
    summary: string;
    ttl_seconds?: number;
  }): { handoff: HandoffOffer; task: Task } {
    const normalized = normalizeSessionLeaseInput(input);
    const toSessionId = validateId(input.to_session_id, "to_session_id");
    const summary = cleanText(input.summary, "summary", 4_000);
    const ttl = validateTtl(input.ttl_seconds);
    if (toSessionId === input.session_id) {
      throw new CollabError("invalid_handoff", "A handoff target must be a different session");
    }
    return this.mutateAsSession(
      input,
      normalized.idempotency_key,
      "handoff.offer.v2",
      { ...normalized.request, to_session_id: toSessionId, summary, ttl_seconds: ttl },
      (session) => {
        const target = this.requireSessionRow(toSessionId);
        if (target.workspace_id !== session.workspace_id || target.status !== "active") {
          throw new CollabError(
            "handoff_target_unavailable",
            "The target must be an active session in the same workspace",
          );
        }
        const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
        this.requireVersion(row, normalized.expected_version);
        this.requireActiveSessionLease(row, session, normalized.lease_id);
        const now = this.timestamp();
        const pending = this.db.query(`
          SELECT id FROM handoffs
          WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at > ?
        `).get(row.workspace_id, row.id, now) as { id: string } | null;
        if (pending) {
          throw new CollabError("handoff_pending", "Task already has a pending handoff", {
            handoff_id: pending.id,
          });
        }
        const id = `handoff_${randomUUID()}`;
        const expiresAt = [addSeconds(now, ttl), row.lease_expires_at!].sort()[0]!;
        this.db.query(`
          INSERT INTO handoffs (
            id, workspace_id, task_id, from_actor, from_session_id,
            to_actor, to_session_id, summary, status, offered_at, expires_at, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
        `).run(
          id,
          row.workspace_id,
          row.id,
          session.actor,
          session.id,
          target.actor,
          target.id,
          summary,
          now,
          expiresAt,
        );
        const version = row.version + 1;
        this.db.query(`
          UPDATE tasks SET version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
        const handoff = this.requireHandoff(id);
        this.appendEvent(row.workspace_id, "handoff.offered", id, session.actor, {
          handoff,
          task_version: version,
          note: "The current session keeps its coordination lease until the target explicitly accepts.",
        }, session.id);
        return { handoff, task: this.requireTask(row.workspace_id, row.id) };
      },
    );
  }

  respondHandoffForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    handoff_id: string;
    expected_version: number;
    response: "accept" | "decline";
    ttl_seconds?: number;
  }): { handoff: HandoffOffer; task: Task } {
    const handoffId = validateId(input.handoff_id, "handoff_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    if (input.response !== "accept" && input.response !== "decline") {
      throw new CollabError("invalid_handoff_response", "Handoff response is invalid");
    }
    const ttl = validateTtl(input.ttl_seconds);
    const request = {
      handoff_id: handoffId,
      expected_version: expectedVersion,
      response: input.response,
      ttl_seconds: ttl,
    };
    const replay = this.readSessionMutationReceipt<{
      handoff: HandoffOffer;
      task: Task;
    }>(input, input.idempotency_key, "handoff.respond.v2", request);
    if (replay.found) return replay.value;
    const preparedCheckpoint = input.response === "accept"
      ? this.captureSessionWorktree(input)
      : null;
    return this.mutateAsSession(
      input,
      input.idempotency_key,
      "handoff.respond.v2",
      request,
      (session) => {
        const offer = this.requireHandoff(handoffId);
        if (offer.workspace_id !== session.workspace_id || offer.to_session_id !== session.id) {
          throw new CollabError(
            "handoff_not_recipient",
            "Only the named target session may respond",
          );
        }
        if (offer.status !== "pending") {
          throw new CollabError(
            offer.status === "expired" ? "handoff_expired" : "handoff_resolved",
            "Handoff is no longer pending",
            { status: offer.status },
          );
        }
        const row = this.requireTaskRow(session.workspace_id, offer.task_id);
        this.requireVersion(row, expectedVersion);
        if (this.timestamp() >= offer.expires_at || this.isExpired(row)) {
          throw new CollabError("handoff_expired", "The offer or source lease expired");
        }
        if (
          row.assignee_session_id !== offer.from_session_id
          || row.lease_id === null
        ) {
          throw new CollabError("handoff_source_changed", "The source lease changed");
        }
        const now = this.timestamp();
        const version = row.version + 1;
        if (input.response === "decline") {
          this.db.query(`
            UPDATE handoffs SET status = 'declined', resolved_at = ? WHERE id = ?
          `).run(now, offer.id);
          this.db.query(`
            UPDATE tasks SET version = ?, updated_at = ?
            WHERE workspace_id = ? AND id = ?
          `).run(version, now, row.workspace_id, row.id);
          this.appendEvent(row.workspace_id, "handoff.declined", offer.id, session.actor, {
            task_id: row.id,
            task_version: version,
          }, session.id);
        } else {
          const worktree = this.requirePreparedWorktree(session, preparedCheckpoint!);
          const checkpoint = preparedCheckpoint!.checkpoint;
          this.requireExpectedBase(row, checkpoint);
          const leaseId = `lease_${randomUUID()}`;
          const leaseExpiresAt = addSeconds(now, ttl);
          this.db.query(`
            UPDATE handoffs SET status = 'accepted', resolved_at = ? WHERE id = ?
          `).run(now, offer.id);
          this.db.query(`
            UPDATE tasks
            SET assignee = ?, assignee_session_id = ?, claim_worktree_id = ?,
              lease_id = ?, lease_expires_at = ?, base_checkpoint_json = ?,
              version = ?, updated_at = ?
            WHERE workspace_id = ? AND id = ?
          `).run(
            session.actor,
            session.id,
            worktree.id,
            leaseId,
            leaseExpiresAt,
            canonicalJson(checkpoint),
            version,
            now,
            row.workspace_id,
            row.id,
          );
          this.appendEvent(row.workspace_id, "handoff.accepted", offer.id, session.actor, {
            task_id: row.id,
            from_session_id: offer.from_session_id,
            to_session_id: session.id,
            lease_id: leaseId,
            lease_expires_at: leaseExpiresAt,
            base_checkpoint: checkpoint,
            task_version: version,
          }, session.id);
        }
        return {
          handoff: this.requireHandoff(offer.id),
          task: this.requireTask(row.workspace_id, row.id),
        };
      },
    );
  }

  nextForActor(workspaceId: string, actorInput: string, afterSequence = 0): {
    actor: string;
    session: null;
    own_claims: Task[];
    ready_tasks: Task[];
    claimable_tasks: Task[];
    conflicted_tasks: TaskConflict[];
    handoff_offers: Array<{ handoff: HandoffOffer; task: Task }>;
    reports: CollabReport[];
    events: JournalPage;
    projection_scope: "snapshot_head";
    reports_scope: "event_page";
  } {
    const actor = validateActor(actorInput);
    this.expireElapsedHandoffs(workspaceId, "system:clock");
    const read = this.db.transaction(() => {
      const events = this.readEventPage(workspaceId, afterSequence, 50);
      const tasks = this.listTasks(workspaceId);
      const offers = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_actor = ? AND status = 'pending' AND expires_at > ?
        ORDER BY offered_at, id
      `).all(workspaceId, actor, this.timestamp()) as HandoffRow[];
      const { claimable, conflicted } = this.projectAvailableTasks(
        workspaceId,
        tasks,
        (task) =>
          task.effective_status === "lease_expired"
          && task.assignee_session_id === null,
      );
      const reportRows = this.db.query(`
        SELECT * FROM reports
        WHERE workspace_id = ? AND event_sequence > ? AND event_sequence <= ?
        ORDER BY event_sequence
      `).all(
        workspaceId,
        afterSequence,
        events.next_anchor.sequence,
      ) as ReportRow[];
      return {
        actor,
        session: null,
        own_claims: tasks.filter(
          (task) => task.effective_status === "claimed" && task.assignee === actor,
        ),
        ready_tasks: claimable,
        claimable_tasks: claimable,
        conflicted_tasks: conflicted,
        handoff_offers: offers.map((row) => ({
          handoff: handoffFromRow(row),
          task: this.requireTask(workspaceId, row.task_id),
        })),
        reports: reportRows.map(reportFromRow),
        events,
        projection_scope: "snapshot_head" as const,
        reports_scope: "event_page" as const,
      };
    });
    return read.deferred();
  }

  nextForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    known_cursor?: EventCursor;
  }): {
    actor: string;
    session: CollabSession;
    own_claims: Task[];
    ready_tasks: Task[];
    claimable_tasks: Task[];
    conflicted_tasks: TaskConflict[];
    handoff_offers: Array<{ handoff: HandoffOffer; task: Task }>;
    reports: CollabReport[];
    events: JournalPage;
    projection_scope: "snapshot_head";
    reports_scope: "event_page";
  } {
    const row = this.db.transaction(() => {
      const authenticated = this.authenticateSession(input);
      const stored: EventCursor = {
        epoch_id: authenticated.cursor_epoch_id,
        sequence: authenticated.cursor_sequence,
        hash: authenticated.cursor_hash,
      };
      try {
        this.validateEventAnchor(authenticated.workspace_id, stored);
      } catch (error) {
        if (error instanceof CollabError) {
          throw new CollabError(
            "cursor_reset_required",
            "The persisted session cursor no longer matches this journal",
            { cursor: stored, cause: error.code },
          );
        }
        throw error;
      }
      if (input.known_cursor) {
        const known = input.known_cursor;
        try {
          this.validateEventAnchor(authenticated.workspace_id, known);
        } catch (error) {
          if (error instanceof CollabError) {
            throw new CollabError(
              "cursor_reset_required",
              "The caller's last-known cursor no longer matches this journal",
              { cursor: known, cause: error.code },
            );
          }
          throw error;
        }
      }
      this.db.query(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`)
        .run(this.timestamp(), authenticated.id);
      return this.requireSessionRow(authenticated.id);
    }).immediate();
    this.expireElapsedHandoffs(row.workspace_id, "system:clock");
    const read = this.db.transaction(() => {
      const current = this.authenticateSession(input);
      const events = this.readEventPage(
        current.workspace_id,
        current.cursor_sequence,
        50,
      );
      const tasks = this.listTasks(current.workspace_id);
      const { claimable, conflicted } = this.projectAvailableTasks(
        current.workspace_id,
        tasks,
        () => false,
      );
      const handoffs = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_session_id = ? AND status = 'pending' AND expires_at > ?
        ORDER BY offered_at, id
      `).all(
        current.workspace_id,
        current.id,
        this.timestamp(),
      ) as HandoffRow[];
      const reportRows = this.db.query(`
        SELECT * FROM reports
        WHERE workspace_id = ? AND event_sequence > ? AND event_sequence <= ?
          AND (to_session_id IS NULL OR to_session_id = ?)
        ORDER BY event_sequence
      `).all(
        current.workspace_id,
        current.cursor_sequence,
        events.next_anchor.sequence,
        current.id,
      ) as ReportRow[];
      return {
        actor: current.actor,
        session: sessionFromRow(current),
        own_claims: tasks.filter(
          (task) =>
            task.effective_status === "claimed"
            && task.assignee_session_id === current.id,
        ),
        ready_tasks: claimable,
        claimable_tasks: claimable,
        conflicted_tasks: conflicted,
        handoff_offers: handoffs.map((handoff) => ({
          handoff: handoffFromRow(handoff),
          task: this.requireTask(current.workspace_id, handoff.task_id),
        })),
        reports: reportRows.map(reportFromRow),
        events,
        projection_scope: "snapshot_head" as const,
        reports_scope: "event_page" as const,
      };
    });
    return read.deferred();
  }

  eventsSince(workspaceId: string, afterSequence = 0, limit = 100): JournalPage {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Event limit must be between 1 and 500");
    }
    const readPage = this.db.transaction(
      () => this.readEventPage(workspaceId, afterSequence, limit),
    );
    return readPage.deferred();
  }

  private readEventPage(
    workspaceId: string,
    afterSequence: number,
    limit: number,
  ): JournalPage {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Event limit must be between 1 and 500");
    }
    const workspace = this.requireWorkspace(workspaceId);
    if (afterSequence > workspace.event_head_sequence) {
      throw new CollabError(
        "invalid_cursor",
        "Event cursor is ahead of the workspace journal",
        {
          after_sequence: afterSequence,
          head_sequence: workspace.event_head_sequence,
        },
      );
    }
    const predecessor = afterSequence === 0
      ? { hash: GENESIS_HASH }
      : this.db.query(`SELECT hash FROM events WHERE workspace_id = ? AND sequence = ?`)
        .get(workspaceId, afterSequence) as { hash: string } | null;
    if (!predecessor) {
      throw new CollabError(
        "cursor_mismatch",
        "The cursor does not resolve to an event in this journal",
        { after_sequence: afterSequence },
      );
    }
    const rows = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
    `).all(workspaceId, afterSequence, limit) as EventRow[];
    const events = rows.map(eventFromRow);
    const chainValid = verifyEventPage(
      events,
      afterSequence,
      predecessor.hash,
      workspace.event_head_sequence,
      workspace.event_head_hash,
    );
    const cursor: EventCursor = {
      epoch_id: workspace.epoch_id,
      sequence: afterSequence,
      hash: predecessor.hash,
    };
    const last = events.at(-1);
    const nextAnchor: EventCursor = last
      ? { epoch_id: last.epoch_id, sequence: last.sequence, hash: last.hash }
      : cursor;
    return {
      events,
      next_cursor: nextAnchor.sequence,
      cursor,
      next_anchor: nextAnchor,
      head_sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
      has_more: nextAnchor.sequence < workspace.event_head_sequence,
      chain_valid: chainValid,
      verification_scope: "returned_page",
    };
  }

  eventsAfterAnchor(workspaceId: string, anchor: EventCursor, limit = 100): JournalPage {
    const validated = this.validateEventAnchor(workspaceId, anchor);
    return this.eventsSince(workspaceId, validated.sequence, limit);
  }

  verifyJournal(workspaceId: string): boolean {
    const audit = this.db.transaction(() => {
      this.requireWorkspace(workspaceId);
      return this.verifyJournalRows(workspaceId);
    });
    return audit.deferred();
  }

  private verifyJournalRows(workspaceId: string): boolean {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) return false;
    const rows = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ? ORDER BY sequence
    `).all(workspaceId) as EventRow[];
    let expectedSequence = 1;
    let previous = GENESIS_HASH;
    try {
      for (const row of rows) {
        const event = eventFromRow(row);
        if (event.sequence !== expectedSequence || event.prev_hash !== previous) return false;
        if (event.hash !== eventHash(event)) return false;
        previous = event.hash;
        expectedSequence += 1;
      }
    } catch {
      return false;
    }
    return workspace.event_head_sequence === rows.length
      && workspace.event_head_hash === previous;
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
        return hydrateLegacyMutationResponse(JSON.parse(existing.response_json), this.timestamp()) as T;
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

  private readSessionMutationReceipt<T>(
    credential: {
      session_id: string;
      session_token: string;
      generation: number;
    },
    idempotencyKeyInput: string,
    operation: string,
    request: unknown,
  ): { found: true; value: T } | { found: false } {
    const session = this.authenticateSession(credential);
    const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
    const requestHash = sha256(canonicalJson({ operation, request }));
    const existing = this.db.query(`
      SELECT operation, request_hash, response_json FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).get(
      session.workspace_id,
      `session:${session.id}`,
      idempotencyKey,
    ) as MutationRow | null;
    if (!existing) return { found: false };
    if (existing.operation !== operation || existing.request_hash !== requestHash) {
      throw new CollabError(
        "idempotency_conflict",
        "Idempotency key was already used for a different session mutation",
        { operation: existing.operation },
      );
    }
    return {
      found: true,
      value: JSON.parse(existing.response_json) as T,
    };
  }

  private mutateAsSession<T>(
    credential: {
      session_id: string;
      session_token: string;
      generation: number;
    },
    idempotencyKeyInput: string,
    operation: string,
    request: unknown,
    apply: (session: SessionRow) => T,
    options: { allow_cursor_recovery?: boolean } = {},
  ): T {
    const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
    const transaction = this.db.transaction(() => {
      const session = this.authenticateSession(credential, options);
      const mutationActor = `session:${session.id}`;
      const requestHash = sha256(canonicalJson({ operation, request }));
      const existing = this.db.query(`
        SELECT operation, request_hash, response_json FROM mutations
        WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
      `).get(session.workspace_id, mutationActor, idempotencyKey) as MutationRow | null;
      if (existing) {
        if (existing.operation !== operation || existing.request_hash !== requestHash) {
          throw new CollabError(
            "idempotency_conflict",
            "Idempotency key was already used for a different session mutation",
            { operation: existing.operation },
          );
        }
        this.db.query(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`)
          .run(this.timestamp(), session.id);
        return JSON.parse(existing.response_json) as T;
      }

      const guardNonce = `guard_${randomUUID()}`;
      this.db.query(`INSERT INTO v2_write_guard (nonce, enabled) VALUES (?, 1)`)
        .run(guardNonce);
      try {
        const response = apply(session);
        this.db.query(`
          INSERT INTO mutations (
            workspace_id, actor, idempotency_key, operation,
            request_hash, response_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          session.workspace_id,
          mutationActor,
          idempotencyKey,
          operation,
          requestHash,
          JSON.stringify(response),
          this.timestamp(),
        );
        this.db.query(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`)
          .run(this.timestamp(), session.id);
        return response;
      } finally {
        this.db.query(`DELETE FROM v2_write_guard WHERE nonce = ?`).run(guardNonce);
      }
    });
    const response = transaction.immediate();
    this.tightenFileModes();
    return response;
  }

  private authenticateSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
  }, options: { allow_cursor_recovery?: boolean } = {}): SessionRow {
    let id: string;
    try {
      id = validateId(input.session_id, "session_id");
    } catch {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | null;
    const suppliedHash = hashSessionToken(
      typeof input.session_token === "string" ? input.session_token : "",
    );
    const expectedHash = row?.token_hash ?? "0".repeat(64);
    const tokenMatches = safeDigestEqual(suppliedHash, expectedHash);
    const generationMatches =
      Number.isInteger(input.generation)
      && row !== null
      && input.generation === row.generation;
    if (!row || !tokenMatches || !generationMatches || row.status !== "active") {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    if (row.cursor_recovery_required !== 0 && !options.allow_cursor_recovery) {
      throw new CollabError(
        "cursor_recovery_required",
        "Reset this session to an exact journal anchor before further mutations",
        {
          persisted_cursor: {
            epoch_id: row.cursor_epoch_id,
            sequence: row.cursor_sequence,
            hash: row.cursor_hash,
          },
          expected_cursor_version: row.cursor_version,
        },
      );
    }
    return row;
  }

  private authenticateResumeToken(sessionId: string, token: string): SessionRow {
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`)
      .get(sessionId) as SessionRow | null;
    const suppliedHash = hashSessionToken(typeof token === "string" ? token : "");
    const expectedHash = row?.token_hash ?? "0".repeat(64);
    if (!row || !safeDigestEqual(suppliedHash, expectedHash) || row.status !== "active") {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    return row;
  }

  private captureSessionWorktree(input: {
    session_id: string;
    session_token: string;
    generation: number;
  }): PreparedWorktreeCheckpoint {
    const session = this.authenticateSession(input);
    const worktree = this.requireWorktreeRow(session.worktree_id);
    return this.captureRegisteredWorktree(session, worktree);
  }

  private captureReviewCheckpoint(
    input: {
      session_id: string;
      session_token: string;
      generation: number;
    },
    taskId: string,
  ): PreparedReviewCheckpoint | null {
    const session = this.authenticateSession(input);
    const task = this.requireTaskRow(session.workspace_id, taskId);
    const resultCheckpoint = parseCheckpoint(task.result_checkpoint_json);
    if (resultCheckpoint?.source !== "server_observed") return null;
    const worktree = this.requireWorktreeRow(resultCheckpoint.worktree_id);
    if (worktree.workspace_id !== session.workspace_id) {
      throw new CollabError(
        "checkpoint_workspace_mismatch",
        "The completion checkpoint belongs to another workspace",
      );
    }
    return {
      workspace_id: session.workspace_id,
      task_id: taskId,
      result_checkpoint: resultCheckpoint,
      observed_worktree: this.captureRegisteredWorktree(session, worktree),
    };
  }

  private captureRegisteredWorktree(
    session: Pick<SessionRow, "id" | "workspace_id">,
    worktree: WorktreeRow,
  ): PreparedWorktreeCheckpoint {
    let identity: RepositoryIdentity;
    try {
      identity = inspectRepository(worktree.root_path);
    } catch (error) {
      throw new CollabError(
        "worktree_unavailable",
        "The registered worktree could not be inspected",
        {
          worktree_id: worktree.id,
          cause: error instanceof CollabError ? error.code : "repository_inspection_failed",
        },
      );
    }
    if (
      identity.root_path !== worktree.root_path
      || identity.checkpoint.worktree_id !== worktree.id
      || identity.worktree_fingerprint !== worktree.fingerprint
      || identity.git_common_dir_hash !== worktree.git_common_dir_hash
    ) {
      throw new CollabError(
        "worktree_identity_changed",
        "The registered path now resolves to a different worktree identity",
        { worktree_id: worktree.id },
      );
    }
    return {
      session_id: session.id,
      workspace_id: session.workspace_id,
      worktree_id: worktree.id,
      root_path: worktree.root_path,
      fingerprint: worktree.fingerprint,
      git_common_dir_hash: worktree.git_common_dir_hash,
      checkpoint: identity.checkpoint,
    };
  }

  private requirePreparedWorktree(
    session: SessionRow,
    prepared: PreparedWorktreeCheckpoint,
  ): WorktreeRow {
    if (prepared.session_id !== session.id || prepared.worktree_id !== session.worktree_id) {
      throw new CollabError(
        "worktree_observation_stale",
        "The prepared worktree observation belongs to another session",
      );
    }
    return this.requirePreparedRegisteredWorktree(
      session.workspace_id,
      session.worktree_id,
      prepared,
    );
  }

  private requirePreparedRegisteredWorktree(
    workspaceId: string,
    worktreeId: string,
    prepared: PreparedWorktreeCheckpoint,
  ): WorktreeRow {
    const row = this.requireWorktreeRow(worktreeId);
    if (
      prepared.workspace_id !== workspaceId
      || prepared.worktree_id !== row.id
      || prepared.root_path !== row.root_path
      || prepared.fingerprint !== row.fingerprint
      || prepared.git_common_dir_hash !== row.git_common_dir_hash
      || row.workspace_id !== workspaceId
    ) {
      throw new CollabError(
        "worktree_observation_stale",
        "The registered worktree changed after it was inspected",
        { worktree_id: worktreeId },
      );
    }
    this.touchWorktree(row, prepared.checkpoint, this.timestamp());
    return row;
  }

  private requireExpectedBase(row: TaskRow, checkpoint: RepoCheckpoint): void {
    if (row.expected_base_sha && checkpoint.head_sha !== row.expected_base_sha) {
      throw new CollabError(
        "expected_base_mismatch",
        "The worktree HEAD does not match the task's required base",
        {
          expected_base_sha: row.expected_base_sha,
          observed_head_sha: checkpoint.head_sha,
          worktree_id: checkpoint.worktree_id,
        },
      );
    }
  }

  private sessionHandle(
    row: SessionRow,
    token: string,
    workspace: Workspace,
    worktreeRow: WorktreeRow,
  ): SessionHandle {
    return {
      workspace,
      worktree: worktreeFromRow(worktreeRow),
      session: sessionFromRow(row),
      credential: {
        session_id: row.id,
        session_token: token,
        generation: row.generation,
        last_cursor: {
          epoch_id: row.cursor_epoch_id,
          sequence: row.cursor_sequence,
          hash: row.cursor_hash,
        },
      },
      identity_boundary:
        "session_credentials_fence_cooperating_local_clients_but_do_not_authenticate_a_person_or_model",
    };
  }

  private registerWorktree(
    workspaceId: string,
    identity: RepositoryIdentity,
    now: string,
    actor: string,
    emitEvent: boolean,
  ): WorktreeRow {
    this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`)
      .run(identity.repository_key, now);
    this.db.query(`
      INSERT INTO worktrees (
        id, workspace_id, repository_key, root_path, git_common_dir_hash, fingerprint,
        branch, head_sha, dirty, registered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.checkpoint.worktree_id,
      workspaceId,
      identity.repository_key,
      identity.root_path,
      identity.git_common_dir_hash,
      identity.worktree_fingerprint,
      identity.checkpoint.branch,
      identity.checkpoint.head_sha,
      booleanToSql(identity.checkpoint.dirty),
      now,
      now,
    );
    const row = this.requireWorktreeRow(identity.checkpoint.worktree_id);
    if (emitEvent) {
      this.appendEvent(workspaceId, "worktree.registered", row.id, actor, {
        root_path: row.root_path,
        repository_key: row.repository_key,
        checkpoint: checkpointFromWorktreeRow(row, now),
      });
    }
    return row;
  }

  private touchWorktree(row: WorktreeRow, checkpoint: RepoCheckpoint, now: string): void {
    this.db.query(`
      UPDATE worktrees
      SET branch = ?, head_sha = ?, dirty = ?, last_seen_at = ?
      WHERE id = ?
    `).run(
      checkpoint.branch,
      checkpoint.head_sha,
      booleanToSql(checkpoint.dirty),
      now,
      row.id,
    );
  }

  private requireWorktreeRow(id: string): WorktreeRow {
    const row = this.db.query(`SELECT * FROM worktrees WHERE id = ?`).get(id) as WorktreeRow | null;
    if (!row) throw new CollabError("worktree_not_found", `Worktree '${id}' was not found`);
    return row;
  }

  private validateEventAnchor(workspaceId: string, input: EventCursor): EventCursor {
    const workspace = this.requireWorkspace(workspaceId);
    if (
      !input
      || input.epoch_id !== workspace.epoch_id
      || !Number.isInteger(input.sequence)
      || input.sequence < 0
      || typeof input.hash !== "string"
    ) {
      throw new CollabError("cursor_mismatch", "The cursor does not belong to this journal");
    }
    if (input.sequence === 0) {
      if (input.hash !== GENESIS_HASH) {
        throw new CollabError("cursor_fork_detected", "The genesis cursor hash is invalid");
      }
      return { ...input };
    }
    if (input.sequence > workspace.event_head_sequence) {
      throw new CollabError("cursor_ahead", "The cursor is ahead of the journal", {
        head_sequence: workspace.event_head_sequence,
      });
    }
    const row = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events
      WHERE workspace_id = ? AND sequence = ?
    `).get(workspaceId, input.sequence) as EventRow | null;
    const event = row ? eventFromRow(row) : null;
    if (
      !event
      || event.epoch_id !== input.epoch_id
      || event.hash !== input.hash
      || event.hash !== eventHash(event)
    ) {
      throw new CollabError(
        "cursor_fork_detected",
        "The cursor sequence resolves to a different journal hash",
      );
    }
    return {
      epoch_id: event.epoch_id,
      sequence: event.sequence,
      hash: event.hash,
    };
  }

  private projectAvailableTasks(
    workspaceId: string,
    tasks: Task[],
    allowExpired: (task: Task) => boolean,
  ): { claimable: Task[]; conflicted: TaskConflict[] } {
    const claimable: Task[] = [];
    const conflicted: TaskConflict[] = [];
    for (const task of tasks) {
      const available =
        task.effective_status === "open"
        || (task.effective_status === "lease_expired" && allowExpired(task));
      if (!available || !this.dependenciesSatisfied(workspaceId, task.dependencies)) continue;
      const conflicts = this.taskPathConflicts(task);
      if (conflicts.length > 0) {
        conflicted.push({ task, conflicts });
      } else {
        claimable.push(task);
      }
    }
    return { claimable, conflicted };
  }

  private dependenciesSatisfied(workspaceId: string, dependencies: string[]): boolean {
    return dependencies.every((id) => {
      const dependency = this.requireTask(workspaceId, id);
      if (dependency.status !== "completed") return false;
      return dependency.completion_policy !== "accepted"
        || dependency.review_status === "accepted";
    });
  }

  private taskPathConflicts(task: Task): TaskConflict["conflicts"] {
    if (task.path_scopes.length === 0 || task.work_mode === "read_only") return [];
    const workspace = this.requireWorkspace(task.workspace_id);
    const rows = this.db.query(`
      SELECT t.*
      FROM tasks t
      JOIN workspaces w ON w.id = t.workspace_id
      WHERE w.repository_key = ?
        AND NOT (t.workspace_id = ? AND t.id = ?)
        AND (
          (t.status = 'claimed' AND (t.lease_expires_at > ? OR t.assignee_session_id IS NOT NULL))
          OR (t.status = 'completed' AND t.completion_policy = 'accepted'
              AND t.review_status = 'pending')
        )
    `).all(
      workspace.repository_key,
      task.workspace_id,
      task.id,
      this.timestamp(),
    ) as TaskRow[];
    const result: TaskConflict["conflicts"] = [];
    for (const row of rows) {
      if (row.work_mode === "read_only") continue;
      const pairs = pathConflicts(task.path_scopes, parseStringArray(row.path_scopes_json));
      if (pairs.length > 0) {
        result.push({
          active_task_id: row.id,
          active_workspace_id: row.workspace_id,
          assignee: row.assignee,
          assignee_session_id: row.assignee_session_id,
          lease_expires_at: row.lease_expires_at,
          path_pairs: pairs,
        });
      }
    }
    return result;
  }

  private requireActiveSessionLease(
    row: TaskRow,
    session: SessionRow,
    leaseId: string,
  ): void {
    if (row.status !== "claimed" || !row.lease_id || !row.lease_expires_at) {
      throw new CollabError("lease_not_active", "Task does not have an active lease");
    }
    if (this.isExpired(row)) {
      throw new CollabError("lease_expired", "Task lease has expired", {
        lease_expires_at: row.lease_expires_at,
      });
    }
    if (row.assignee_session_id !== session.id || row.lease_id !== leaseId) {
      throw new CollabError("lease_not_holder", "Mutation requires the current session lease", {
        assignee: row.assignee,
        assignee_session_id: row.assignee_session_id,
      });
    }
  }

  private clearSessionClaim(
    row: TaskRow,
    session: SessionRow,
    type: "task.released",
    payload: Record<string, unknown>,
  ): Task {
    const now = this.timestamp();
    const version = row.version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = 'open', assignee = NULL, assignee_session_id = NULL,
        claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(
      row.workspace_id,
      row.id,
      now,
      session.actor,
      "task_released",
    );
    this.appendEvent(row.workspace_id, type, row.id, session.actor, {
      ...payload,
      version,
    }, session.id);
    return this.requireTask(row.workspace_id, row.id);
  }

  private recoveryBundle(row: TaskRow): Record<string, unknown> {
    return {
      task_id: row.id,
      prior_assignee: row.assignee,
      prior_session_id: row.assignee_session_id,
      prior_lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      base_checkpoint: parseCheckpoint(row.base_checkpoint_json),
      latest_progress: row.latest_progress,
      required_action: "collab_task_recover",
    };
  }

  private validateReportInput(
    session: SessionRow,
    input: {
      task_id: string | null;
      to_session_id: string | null;
      kind: ReportKind;
      relation: ReportRelation;
      target_report_id: string | null;
      authority_scope: string | null;
      authority_basis: string | null;
      evidence_refs: string[];
    },
  ): void {
    if (input.task_id) this.requireTaskRow(session.workspace_id, input.task_id);
    if (input.to_session_id) {
      const targetSession = this.requireSessionRow(input.to_session_id);
      if (targetSession.workspace_id !== session.workspace_id) {
        throw new CollabError("report_target_mismatch", "Report target is in another workspace");
      }
    }
    if (input.relation === "informs" && input.target_report_id) {
      throw new CollabError(
        "invalid_report_relation",
        "An informing report does not target another report",
      );
    }
    if (input.relation !== "informs" && !input.target_report_id) {
      throw new CollabError(
        "report_target_required",
        "This report relation requires an earlier target report",
      );
    }
    if (input.target_report_id) {
      const target = this.requireReport(input.target_report_id);
      if (target.workspace_id !== session.workspace_id) {
        throw new CollabError("report_target_mismatch", "Target report is in another workspace");
      }
      if (target.task_id !== input.task_id) {
        throw new CollabError(
          "report_task_mismatch",
          "Related reports must use the same task scope as their target",
          { target_task_id: target.task_id, report_task_id: input.task_id },
        );
      }
      if (
        ["corrects", "withdraws", "supersedes"].includes(input.relation)
        && target.from_session_id !== session.id
      ) {
        throw new CollabError(
          "report_author_mismatch",
          "Only the original author session may correct, withdraw, or supersede its report; other sessions should challenge it",
        );
      }
      if (input.relation === "resolves" && target.relation !== "challenges") {
        throw new CollabError(
          "invalid_report_relation",
          "A resolving report must target a challenge",
        );
      }
    }
    if (
      input.kind === "decision"
      && (!input.authority_scope || !input.authority_basis)
    ) {
      throw new CollabError(
        "decision_authority_required",
        "Decision reports require an explicit authority scope and basis",
      );
    }
    for (const reference of input.evidence_refs) {
      this.requireEvidenceRef(session.workspace_id, reference);
    }
  }

  private appendReportInternal(
    session: SessionRow,
    input: {
      task_id: string | null;
      to_session_id: string | null;
      kind: ReportKind;
      body: string;
      evidence_refs: string[];
      confidence: ReportConfidence;
      confidence_basis: string | null;
      limits: string | null;
      relation: ReportRelation;
      target_report_id: string | null;
      authority_scope: string | null;
      authority_basis: string | null;
    },
  ): CollabReport {
    const id = `report_${randomUUID()}`;
    const now = this.timestamp();
    const event = this.appendEvent(session.workspace_id, "report.posted", id, session.actor, {
      task_id: input.task_id,
      to_session_id: input.to_session_id,
      kind: input.kind,
      body: input.body,
      evidence_refs: input.evidence_refs,
      confidence: input.confidence,
      confidence_basis: input.confidence_basis,
      limits: input.limits,
      relation: input.relation,
      target_report_id: input.target_report_id,
      authority_scope: input.authority_scope,
      authority_basis: input.authority_basis,
    }, session.id);
    this.db.query(`
      INSERT INTO reports (
        id, workspace_id, task_id, from_session_id, from_actor, to_session_id,
        kind, body, evidence_refs_json, confidence, confidence_basis, limits,
        relation, target_report_id, authority_scope, authority_basis,
        created_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      session.workspace_id,
      input.task_id,
      session.id,
      session.actor,
      input.to_session_id,
      input.kind,
      input.body,
      canonicalJson(input.evidence_refs),
      input.confidence,
      input.confidence_basis,
      input.limits,
      input.relation,
      input.target_report_id,
      input.authority_scope,
      input.authority_basis,
      now,
      event.sequence,
    );
    return this.requireReport(id);
  }

  private requireReport(id: string): CollabReport {
    const row = this.db.query(`SELECT * FROM reports WHERE id = ?`).get(id) as ReportRow | null;
    if (!row) throw new CollabError("report_not_found", `Report '${id}' was not found`);
    return reportFromRow(row);
  }

  private requireReview(id: string): TaskReview {
    const row = this.db.query(`SELECT * FROM task_reviews WHERE id = ?`).get(id) as ReviewRow | null;
    if (!row) throw new CollabError("review_not_found", `Review '${id}' was not found`);
    return reviewFromRow(row);
  }

  private hasUnresolvedChallenges(workspaceId: string, reportId: string): boolean {
    const challenges = this.db.query(`
      SELECT id FROM reports
      WHERE workspace_id = ? AND target_report_id = ? AND relation = 'challenges'
      ORDER BY event_sequence
    `).all(workspaceId, reportId) as Array<{ id: string }>;
    for (const challenge of challenges) {
      if (
        this.hasActiveReportRelation(
          workspaceId,
          challenge.id,
          new Set(["withdraws"]),
        )
      ) continue;
      if (
        !this.hasActiveReportRelation(
          workspaceId,
          challenge.id,
          new Set(["resolves"]),
        )
      ) return true;
    }
    return false;
  }

  private hasObsoletedCompletionReport(workspaceId: string, reportId: string): boolean {
    return this.hasActiveReportRelation(
      workspaceId,
      reportId,
      new Set(["withdraws", "corrects", "supersedes"]),
    );
  }

  private hasActiveReportRelation(
    workspaceId: string,
    reportId: string,
    relations: Set<ReportRelation>,
  ): boolean {
    const rows = this.db.query(`
      SELECT id, relation FROM reports
      WHERE workspace_id = ? AND target_report_id = ?
      ORDER BY event_sequence
    `).all(workspaceId, reportId) as Array<{ id: string; relation: ReportRelation }>;
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    return rows.some(
      (row) => relations.has(row.relation) && !obsoleted.has(row.id),
    );
  }

  private activeObsoletionTargets(workspaceId: string): Set<string> {
    const rows = this.db.query(`
      SELECT id, target_report_id FROM reports
      WHERE workspace_id = ? AND target_report_id IS NOT NULL
        AND relation IN ('withdraws', 'corrects', 'supersedes')
      ORDER BY event_sequence DESC, id DESC
    `).all(workspaceId) as Array<{ id: string; target_report_id: string }>;
    const obsoleted = new Set<string>();
    for (const row of rows) {
      // Targets always predate their relation, so descending event order
      // evaluates whether each relation is itself obsolete before projecting
      // it onto the older target. This handles arbitrarily long valid chains
      // without recursion or parity cutoffs.
      if (!obsoleted.has(row.id)) obsoleted.add(row.target_report_id);
    }
    return obsoleted;
  }

  private requireEvidenceRef(workspaceId: string, reference: string): void {
    const separator = reference.indexOf(":");
    if (separator < 1) {
      throw new CollabError(
        "invalid_evidence_ref",
        "Evidence references use artifact:, event:, report:, or checkpoint: prefixes",
      );
    }
    const kind = reference.slice(0, separator);
    const id = reference.slice(separator + 1);
    if (!id) throw new CollabError("invalid_evidence_ref", "Evidence reference ID is empty");
    let exists = false;
    if (kind === "artifact") {
      exists = this.db.query(`
        SELECT 1 FROM artifacts WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "event") {
      exists = this.db.query(`
        SELECT 1 FROM events WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "report") {
      exists = this.db.query(`
        SELECT 1 FROM reports WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "checkpoint") {
      const tasks = this.db.query(`
        SELECT base_checkpoint_json, result_checkpoint_json
        FROM tasks WHERE workspace_id = ?
      `).all(workspaceId) as Array<{
        base_checkpoint_json: string | null;
        result_checkpoint_json: string | null;
      }>;
      exists = tasks.some((task) => {
        const checkpoints = [
          parseCheckpoint(task.base_checkpoint_json),
          parseCheckpoint(task.result_checkpoint_json),
        ];
        return checkpoints.some((checkpoint) =>
          checkpoint !== null
          && checkpointDigest(checkpoint) === id
        );
      });
    } else {
      throw new CollabError("invalid_evidence_ref", "Unsupported evidence reference kind");
    }
    if (!exists) {
      throw new CollabError("evidence_not_found", "Evidence reference was not found", {
        reference,
      });
    }
  }

  private appendEvent(
    workspaceId: string,
    type: CollabEventType,
    entityId: string,
    actor: string,
    payload: Record<string, unknown>,
    sessionId: string | null = null,
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
      session_id: sessionId,
      occurred_at: this.timestamp(),
      payload,
      prev_hash: workspace.event_head_hash,
      hash: "",
    };
    event.hash = eventHash(event);
    this.db.query(`
      INSERT INTO events
        (workspace_id, epoch_id, sequence, id, protocol, type, entity_id, actor,
          session_id, occurred_at, payload_json, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.workspace_id,
      event.epoch_id,
      event.sequence,
      event.id,
      event.protocol,
      event.type,
      event.entity_id,
      event.actor,
      event.session_id ?? null,
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
    const incomplete = dependencies.filter((id) =>
      !this.dependenciesSatisfied(row.workspace_id, [id])
    );
    if (incomplete.length > 0) {
      throw new CollabError("dependencies_incomplete", "Task dependencies are not complete", { dependencies: incomplete });
    }
  }

  private requirePathsAvailable(row: TaskRow): void {
    const conflicts = this.taskPathConflicts(this.taskFromRow(row));
    if (conflicts.length > 0) {
      const first = conflicts[0]!;
      throw new CollabError("path_scope_conflict", "Task paths overlap reserved work", {
        conflicting_task_id: first.active_task_id,
        conflicting_workspace_id: first.active_workspace_id,
        assignee: first.assignee,
        assignee_session_id: first.assignee_session_id,
        lease_expires_at: first.lease_expires_at,
        conflicts: first.path_pairs,
      });
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
    let effectiveStatus: Task["effective_status"] = row.status;
    if (this.isExpired(row)) {
      effectiveStatus = row.assignee_session_id ? "recovery_required" : "lease_expired";
    } else if (row.status === "completed" && row.review_status === "pending") {
      effectiveStatus = "reported_complete";
    } else if (row.status === "completed" && row.review_status === "accepted") {
      effectiveStatus = "accepted";
    }
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      title: row.title,
      description: row.description,
      status: row.status,
      effective_status: effectiveStatus,
      dependencies: parseStringArray(row.dependencies_json),
      path_scopes: parseStringArray(row.path_scopes_json),
      work_mode: row.work_mode,
      completion_policy: row.completion_policy,
      review_status: row.review_status,
      expected_base_sha: row.expected_base_sha,
      base_checkpoint: parseCheckpoint(row.base_checkpoint_json),
      result_checkpoint: parseCheckpoint(row.result_checkpoint_json),
      completion_report_id: row.completion_report_id,
      assignee: row.assignee,
      assignee_session_id: row.assignee_session_id,
      claim_worktree_id: row.claim_worktree_id,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      blocker: row.blocker,
      latest_progress: row.latest_progress,
      reported_by: row.reported_by,
      reported_by_session_id: row.reported_by_session_id,
      reported_at: row.reported_at,
      accepted_by: row.accepted_by,
      accepted_by_session_id: row.accepted_by_session_id,
      accepted_at: row.accepted_at,
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

  private requireSessionRow(sessionId: string): SessionRow {
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`)
      .get(sessionId) as SessionRow | null;
    if (!row) throw new CollabError("session_not_found", `Session '${sessionId}' was not found`);
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
        , attached_by_session_id
      FROM artifacts WHERE workspace_id = ? AND task_id = ? ORDER BY attached_at, id
    `).all(workspaceId, taskId) as ArtifactRow[];
    return rows.map(artifactFromRow);
  }

  private requireArtifact(id: string): ArtifactRef {
    const row = this.db.query(`
      SELECT id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at
        , attached_by_session_id
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
    throw new CollabError(
      "invalid_expected_version",
      "expected_version must be a positive integer",
    );
  }
  return value;
}

function normalizeSessionLeaseInput(input: {
  idempotency_key: string;
  task_id: string;
  lease_id: string;
  expected_version: number;
}): {
  idempotency_key: string;
  task_id: string;
  lease_id: string;
  expected_version: number;
  request: {
    task_id: string;
    lease_id: string;
    expected_version: number;
  };
} {
  const normalized = {
    idempotency_key: validateIdempotencyKey(input.idempotency_key),
    task_id: validateId(input.task_id, "task_id"),
    lease_id: validateId(input.lease_id, "lease_id"),
    expected_version: validateExpectedVersion(input.expected_version),
  };
  return {
    ...normalized,
    request: {
      task_id: normalized.task_id,
      lease_id: normalized.lease_id,
      expected_version: normalized.expected_version,
    },
  };
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

function validateSha256(value: string): string {
  const digest = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new CollabError("invalid_sha256", "sha256 must be 64 hexadecimal characters");
  return digest;
}

function validateGitObjectId(value: string): string {
  const oid = value.toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(oid)) {
    throw new CollabError(
      "invalid_git_object_id",
      "Git object IDs must contain 40 to 64 hexadecimal characters",
    );
  }
  return oid;
}

function validateArtifactKind(value: ArtifactRef["kind"]): ArtifactRef["kind"] {
  if (!["file", "commit", "test", "data", "url", "other"].includes(value)) {
    throw new CollabError("invalid_artifact_kind", "Unsupported artifact kind");
  }
  return value;
}

function validateReportKind(value: ReportKind): ReportKind {
  if (!["observation", "inference", "proposal", "decision"].includes(value)) {
    throw new CollabError("invalid_report_kind", "Unsupported report kind");
  }
  return value;
}

function validateReportConfidence(value: ReportConfidence): ReportConfidence {
  if (!["high", "medium", "low", "unknown"].includes(value)) {
    throw new CollabError("invalid_report_confidence", "Unsupported report confidence");
  }
  return value;
}

function validateReportRelation(value: ReportRelation): ReportRelation {
  if (
    ![
      "informs",
      "supports",
      "challenges",
      "corrects",
      "withdraws",
      "supersedes",
      "resolves",
    ].includes(value)
  ) {
    throw new CollabError("invalid_report_relation", "Unsupported report relation");
  }
  return value;
}

function normalizeEvidenceRefs(references: string[]): string[] {
  if (!Array.isArray(references) || references.length > MAX_REPORT_REFS) {
    throw new CollabError(
      "invalid_evidence_refs",
      `A report may contain at most ${MAX_REPORT_REFS} evidence references`,
    );
  }
  return uniqueSorted(references.map((reference) => {
    if (typeof reference !== "string") {
      throw new CollabError("invalid_evidence_ref", "Evidence references must be strings");
    }
    return cleanText(reference, "evidence_ref", MAX_REPORT_REF_LENGTH);
  }));
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
  const base = {
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
  return row.protocol === LEGACY_COLLAB_PROTOCOL
    ? base
    : { ...base, session_id: row.session_id };
}

function eventHash(event: CollabEvent): string {
  if (event.protocol === LEGACY_COLLAB_PROTOCOL) {
    const { hash: _hash, session_id: _sessionId, ...body } = event;
    return sha256(canonicalJson(body));
  }
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
  if (events.length === 0) {
    return afterSequence === headSequence && predecessorHash === headHash;
  }
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

function sessionFromRow(row: SessionRow): CollabSession {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    worktree_id: row.worktree_id,
    actor: row.actor,
    role: row.role,
    parent_session_id: row.parent_session_id,
    status: row.status,
    generation: row.generation,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    ended_at: row.ended_at,
    cursor: {
      epoch_id: row.cursor_epoch_id,
      sequence: row.cursor_sequence,
      hash: row.cursor_hash,
    },
    cursor_version: row.cursor_version,
    reset_generation: row.reset_generation,
    cursor_recovery_required: row.cursor_recovery_required !== 0,
  };
}

function worktreeFromRow(row: WorktreeRow): Worktree {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    root_path: row.root_path,
    repository_key: row.repository_key,
    git_common_dir_hash: row.git_common_dir_hash,
    branch: row.branch,
    head_sha: row.head_sha,
    dirty: sqlToBoolean(row.dirty),
    registered_at: row.registered_at,
    last_seen_at: row.last_seen_at,
  };
}

function checkpointFromWorktreeRow(row: WorktreeRow, capturedAt: string): RepoCheckpoint {
  return {
    worktree_id: row.id,
    head_sha: row.head_sha,
    branch: row.branch,
    dirty: sqlToBoolean(row.dirty),
    captured_at: capturedAt,
  };
}

function reportFromRow(row: ReportRow): CollabReport {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    task_id: row.task_id,
    from_session_id: row.from_session_id,
    from_actor: row.from_actor,
    to_session_id: row.to_session_id,
    kind: row.kind,
    body: row.body,
    evidence_refs: parseStringArray(row.evidence_refs_json),
    confidence: row.confidence,
    confidence_basis: row.confidence_basis,
    limits: row.limits,
    relation: row.relation,
    target_report_id: row.target_report_id,
    authority_scope: row.authority_scope,
    authority_basis: row.authority_basis,
    created_at: row.created_at,
    event_sequence: row.event_sequence,
  };
}

function reviewFromRow(row: ReviewRow): TaskReview {
  return { ...row };
}

function parseCheckpoint(json: string | null): RepoCheckpoint | null {
  return json ? JSON.parse(json) as RepoCheckpoint : null;
}

function checkpointDigest(checkpoint: RepoCheckpoint): string {
  return sha256(canonicalJson(checkpoint));
}

function checkpointStateMatches(left: RepoCheckpoint, right: RepoCheckpoint): boolean {
  return left.worktree_id === right.worktree_id
    && left.head_sha === right.head_sha
    && left.branch === right.branch
    && left.algorithm === right.algorithm
    && left.index_sha256 === right.index_sha256
    && left.state_sha256 === right.state_sha256
    && left.dirty === right.dirty;
}

function requireCompleteGitCheckpoint(checkpoint: RepoCheckpoint): void {
  if (
    checkpoint.source !== "server_observed"
    || checkpoint.algorithm !== "git-state/v1"
    || checkpoint.head_sha === null
    || checkpoint.dirty === null
    || typeof checkpoint.index_sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(checkpoint.index_sha256)
    || typeof checkpoint.state_sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(checkpoint.state_sha256)
  ) {
    throw new CollabError(
      "git_checkpoint_incomplete",
      "Acceptance requires a complete server-observed Git checkpoint",
      { worktree_id: checkpoint.worktree_id },
    );
  }
}

function hydrateLegacyMutationResponse(value: unknown, now: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => hydrateLegacyMutationResponse(item, now));
  }
  if (!isRecordValue(value)) return value;
  const hydratedEntries = Object.entries(value).map(([key, item]) => [
    key,
    hydrateLegacyMutationResponse(item, now),
  ]);
  const hydrated = Object.fromEntries(hydratedEntries) as Record<string, unknown>;
  if (
    typeof hydrated.id !== "string"
    || typeof hydrated.workspace_id !== "string"
    || !["open", "claimed", "blocked", "completed"].includes(
      typeof hydrated.status === "string" ? hydrated.status : "",
    )
    || !Array.isArray(hydrated.dependencies)
    || !Array.isArray(hydrated.path_scopes)
    || !Number.isInteger(hydrated.version)
  ) {
    return hydrated;
  }
  const expired =
    hydrated.status === "claimed"
    && typeof hydrated.lease_expires_at === "string"
    && now >= hydrated.lease_expires_at;
  return {
    ...hydrated,
    effective_status: typeof hydrated.effective_status === "string"
      ? hydrated.effective_status
      : expired ? "lease_expired" : hydrated.status,
    work_mode: typeof hydrated.work_mode === "string"
      ? hydrated.work_mode
      : "coordination",
    completion_policy: typeof hydrated.completion_policy === "string"
      ? hydrated.completion_policy
      : "reported",
    review_status: typeof hydrated.review_status === "string"
      ? hydrated.review_status
      : "legacy_unreviewed",
    expected_base_sha: hydrated.expected_base_sha ?? null,
    base_checkpoint: hydrated.base_checkpoint ?? null,
    result_checkpoint: hydrated.result_checkpoint ?? null,
    completion_report_id: hydrated.completion_report_id ?? null,
    assignee_session_id: hydrated.assignee_session_id ?? null,
    claim_worktree_id: hydrated.claim_worktree_id ?? null,
    reported_by: hydrated.reported_by ?? null,
    reported_by_session_id: hydrated.reported_by_session_id ?? null,
    reported_at: hydrated.reported_at ?? null,
    accepted_by: hydrated.accepted_by ?? null,
    accepted_by_session_id: hydrated.accepted_by_session_id ?? null,
    accepted_at: hydrated.accepted_at ?? null,
  };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanToSql(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function sqlToBoolean(value: number | null): boolean | null {
  return value === null ? null : value !== 0;
}

function hashSessionToken(token: string): string {
  return sha256(`agenttool.collab/session-token/v1\0${token}`);
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function pragmaNumber(db: Database, name: "application_id" | "user_version"): number {
  const row = db.query(`PRAGMA ${name}`).get() as Record<string, number> | null;
  const value = row?.[name];
  if (!Number.isInteger(value)) {
    throw new CollabError("database_pragma_unavailable", `Could not read PRAGMA ${name}`);
  }
  return value!;
}

function retrySqliteBusy(operation: () => void): void {
  const deadline = Date.now() + SQLITE_BUSY_RETRY_MS;
  let delay = 10;
  while (true) {
    try {
      operation();
      return;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const busy =
        code === "SQLITE_BUSY"
        || (error instanceof Error && /database is (?:locked|busy)/i.test(error.message));
      if (!busy || Date.now() >= deadline) throw error;
      const remaining = deadline - Date.now();
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        Math.min(delay, remaining),
      );
      delay = Math.min(delay * 2, 100);
    }
  }
}

function assertSafeDatabaseFile(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new CollabError(
      "database_file_unsafe",
      "The collaboration database path must be a non-linked regular file owned by this user",
      { path },
    );
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new CollabError("invalid_sql_identifier", "Invalid internal SQL identifier");
  }
  return `"${value}"`;
}

function safeRepositoryIdentity(rootPath: string): RepositoryIdentity {
  try {
    return inspectRepository(rootPath);
  } catch {
    const root = resolve(rootPath);
    const repositoryKey = `local-path:${sha256(root)}`;
    const worktreeId = `wt_${sha256(`${root}\0path:${root}`).slice(0, 24)}`;
    return {
      requested_root_path: root,
      root_path: root,
      repository_key: repositoryKey,
      git_common_dir_hash: null,
      worktree_fingerprint: `path:${sha256(root)}`,
      checkpoint: {
        worktree_id: worktreeId,
        head_sha: null,
        branch: null,
        dirty: null,
        captured_at: new Date().toISOString(),
      },
    };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1_000).toISOString();
}
