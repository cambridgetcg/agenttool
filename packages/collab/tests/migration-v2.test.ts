import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalJson } from "../src/canonical.js";
import { CollabError } from "../src/errors.js";
import { CollabStore } from "../src/store.js";

const APPLICATION_ID = 0x4154434c;
const GENESIS_HASH = "0".repeat(64);
const V2_TABLES = [
  "repositories",
  "worktrees",
  "sessions",
  "reports",
  "task_reviews",
  "task_recoveries",
  "session_cursor_resets",
  "v2_write_guard",
  "schema_migrations",
] as const;

interface LegacyWorkspaceFixture {
  id: string;
  rootPath: string;
  createdAt?: string;
  eventId?: string;
}

interface LegacyJournal {
  workspaceId: string;
  epochId: string;
  eventHash: string;
  rootPath: string;
}

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("v0.1 to v0.2 migration", () => {
  test("serializes concurrent process migration and reopens idempotently", async () => {
    const directory = temporaryDirectory("agenttool-collab-migration-race-");
    const root = join(directory, "repo");
    const databasePath = join(directory, "state", "collab.sqlite");
    mkdirSync(root);
    const [legacy] = createLegacyDatabase(databasePath, [
      { id: "ws_concurrent_legacy", rootPath: root },
    ]);
    expect(legacy).toBeDefined();

    const barrierPath = join(directory, "migration.go");
    const workerPath = join(import.meta.dir, "migration-worker.ts");
    const processes = ["first", "second"].map((name) => {
      const readyPath = join(directory, `${name}.ready`);
      const childProcess = Bun.spawn(
        [process.execPath, workerPath, databasePath, barrierPath, readyPath],
        {
          cwd: join(import.meta.dir, ".."),
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            TMPDIR: process.env.TMPDIR ?? tmpdir(),
            AGENTOOL_COLLAB_TEST_MIGRATION_HOLD_MS: "5500",
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      return { childProcess, readyPath };
    });

    await waitFor(() => processes.every(({ readyPath }) => existsSync(readyPath)));
    writeFileSync(barrierPath, "go\n", { flag: "wx", mode: 0o600 });

    const results = await Promise.all(
      processes.map(async ({ childProcess }) => {
        const [exitCode, stdout, stderr] = await Promise.all([
          childProcess.exited,
          new Response(childProcess.stdout).text(),
          new Response(childProcess.stderr).text(),
        ]);
        return {
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
      }),
    );

    for (const result of results) {
      expect(result.exitCode, result.stderr || result.stdout).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        schema_migrations: 1,
        user_version: 2,
      });
    }

    const firstOpen = new CollabStore(databasePath);
    expect(firstOpen.verifyJournal(legacy!.workspaceId)).toBe(true);
    expect(readPragma(firstOpen.db, "application_id")).toBe(APPLICATION_ID);
    expect(readPragma(firstOpen.db, "user_version")).toBe(2);
    expect(
      firstOpen.db.query(`
        SELECT version, protocol FROM schema_migrations ORDER BY version
      `).all(),
    ).toEqual([{ version: 2, protocol: "agenttool.collab/0.2" }]);
    expect(firstOpen.db.query("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(firstOpen.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(readJournal(firstOpen.db, legacy!.workspaceId)).toEqual({
      eventHash: legacy!.eventHash,
      headHash: legacy!.eventHash,
      eventCount: 1,
      protocol: "agenttool.collab/0.1",
    });
    const firstMigrationRow = firstOpen.db.query(`
      SELECT version, protocol, applied_at FROM schema_migrations
    `).get();
    firstOpen.close();

    const secondOpen = new CollabStore(databasePath);
    expect(
      secondOpen.db.query(`
        SELECT version, protocol, applied_at FROM schema_migrations
      `).all(),
    ).toEqual([firstMigrationRow]);
    expect(readJournal(secondOpen.db, legacy!.workspaceId)).toEqual({
      eventHash: legacy!.eventHash,
      headHash: legacy!.eventHash,
      eventCount: 1,
      protocol: "agenttool.collab/0.1",
    });
    expect(secondOpen.verifyJournal(legacy!.workspaceId)).toBe(true);
    secondOpen.close();
  }, 20_000);

  for (const failpoint of ["v2_tables_created", "v2_verified"] as const) {
    test(`rolls back ${failpoint} without leaving partial v0.2 state`, () => {
      const directory = temporaryDirectory(
        `agenttool-collab-migration-${failpoint}-`,
      );
      const root = join(directory, "repo");
      const databasePath = join(directory, "collab.sqlite");
      mkdirSync(root);
      const [legacy] = createLegacyDatabase(databasePath, [
        { id: `ws_${failpoint}`, rootPath: root },
      ]);
      expect(legacy).toBeDefined();

      expect(
        () =>
          new CollabStore(databasePath, {
            migration_failpoint: (step) => {
              if (step === failpoint) throw new Error(`fail:${step}`);
            },
          }),
      ).toThrow(`fail:${failpoint}`);

      const rolledBack = new Database(databasePath, {
        create: false,
        strict: true,
      });
      expect(readPragma(rolledBack, "user_version")).toBe(0);
      expect(tableColumns(rolledBack, "workspaces")).not.toContain(
        "repository_key",
      );
      expect(tableColumns(rolledBack, "tasks")).not.toContain(
        "coordination_mode",
      );
      expect(tableColumns(rolledBack, "events")).not.toContain("session_id");
      expect(
        rolledBack
          .query(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN (${V2_TABLES.map(() => "?").join(", ")})
            ORDER BY name
          `)
          .all(...V2_TABLES),
      ).toEqual([]);
      expect(readJournal(rolledBack, legacy!.workspaceId)).toEqual({
        eventHash: legacy!.eventHash,
        headHash: legacy!.eventHash,
        eventCount: 1,
        protocol: "agenttool.collab/0.1",
      });
      rolledBack.close();

      const recovered = new CollabStore(databasePath);
      expect(readPragma(recovered.db, "user_version")).toBe(2);
      expect(readPragma(recovered.db, "application_id")).toBe(APPLICATION_ID);
      expect(
        recovered.db.query("SELECT version, protocol FROM schema_migrations").all(),
      ).toEqual([{ version: 2, protocol: "agenttool.collab/0.2" }]);
      expect(recovered.verifyJournal(legacy!.workspaceId)).toBe(true);
      recovered.close();
    });
  }

  test("preserves linked-worktree legacy partitions for explicit reconciliation", () => {
    const directory = temporaryDirectory("agenttool-collab-partitions-");
    const root = join(directory, "repo");
    const linkedRoot = join(directory, "linked-worktree");
    const databasePath = join(directory, "collab.sqlite");
    mkdirSync(root);
    initializeGitRepository(root);
    runGit(root, "worktree", "add", "-b", "migration-linked", linkedRoot);

    const legacy = createLegacyDatabase(databasePath, [
      {
        id: "ws_legacy_main",
        rootPath: root,
        createdAt: "2026-07-20T10:00:00.000Z",
      },
      {
        id: "ws_legacy_linked",
        rootPath: linkedRoot,
        createdAt: "2026-07-20T10:01:00.000Z",
      },
    ]);
    const originalJournals = new Map(
      legacy.map((item) => [item.workspaceId, item.eventHash]),
    );

    const migrated = new CollabStore(databasePath);
    expect(
      migrated.db.query(`
        SELECT id, root_path FROM workspaces ORDER BY created_at, id
      `).all(),
    ).toEqual([
      { id: "ws_legacy_main", root_path: root },
      { id: "ws_legacy_linked", root_path: linkedRoot },
    ]);
    const migratedWorktrees = migrated.db.query(`
      SELECT workspace_id, root_path FROM worktrees ORDER BY registered_at, root_path
    `).all();
    expect(migratedWorktrees).toHaveLength(2);
    expect(migratedWorktrees).toContainEqual({
      workspace_id: "ws_legacy_main",
      root_path: realpathSync(root),
    });
    expect(migratedWorktrees).toContainEqual({
      workspace_id: "ws_legacy_linked",
      root_path: realpathSync(linkedRoot),
    });
    expect(
      (
        migrated.db.query(`
          SELECT COUNT(DISTINCT repository_key) AS count FROM workspaces
        `).get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      migrated.db.query(`
        SELECT workspace_id, sequence, protocol, hash
        FROM events ORDER BY workspace_id, sequence
      `).all(),
    ).toEqual(
      ["ws_legacy_linked", "ws_legacy_main"].map((workspaceId) => ({
        workspace_id: workspaceId,
        sequence: 1,
        protocol: "agenttool.collab/0.1",
        hash: originalJournals.get(workspaceId),
      })),
    );
    expect(
      (
        migrated.db.query("SELECT COUNT(*) AS count FROM sessions").get() as {
          count: number;
        }
      ).count,
    ).toBe(0);

    let partitionError: CollabError | undefined;
    try {
      migrated.joinSession({ root_path: root, actor: "migration-reviewer" });
    } catch (error) {
      if (error instanceof CollabError) partitionError = error;
      else throw error;
    }
    expect(partitionError?.code).toBe("repository_partitioned");
    expect(partitionError?.details.workspace_ids).toEqual([
      "ws_legacy_main",
      "ws_legacy_linked",
    ]);
    expect(
      (
        migrated.db.query("SELECT COUNT(*) AS count FROM sessions").get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    for (const item of legacy) {
      expect(migrated.verifyJournal(item.workspaceId)).toBe(true);
      expect(readJournal(migrated.db, item.workspaceId)).toEqual({
        eventHash: item.eventHash,
        headHash: item.eventHash,
        eventCount: 1,
        protocol: "agenttool.collab/0.1",
      });
    }
    migrated.close();
  });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

function createLegacyDatabase(
  path: string,
  fixtures: LegacyWorkspaceFixture[],
): LegacyJournal[] {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      epoch_id TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      event_head_sequence INTEGER NOT NULL DEFAULT 0,
      event_head_hash TEXT NOT NULL
    );
    CREATE TABLE tasks (
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
    CREATE INDEX tasks_workspace_status_idx
      ON tasks(workspace_id, status, lease_expires_at);
    CREATE TABLE artifacts (
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
    CREATE INDEX artifacts_task_idx
      ON artifacts(workspace_id, task_id, attached_at);
    CREATE TABLE decisions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      topic TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT,
      recorded_by TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX decisions_workspace_idx
      ON decisions(workspace_id, recorded_at);
    CREATE TABLE handoffs (
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
    CREATE INDEX handoffs_target_idx
      ON handoffs(workspace_id, to_actor, status, expires_at);
    CREATE TABLE events (
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
    CREATE TABLE mutations (
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

  const journals = fixtures.map((fixture, index) => {
    const epochId = `epoch_${fixture.id}`;
    const occurredAt =
      fixture.createdAt
      ?? new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString();
    const eventId = fixture.eventId ?? `event_${fixture.id}`;
    const payload = {
      name: fixture.id,
      root_path: fixture.rootPath,
      rights_profile: "xenia.rights/0.1",
    };
    const eventBody = {
      protocol: "agenttool.collab/0.1",
      workspace_id: fixture.id,
      epoch_id: epochId,
      sequence: 1,
      id: eventId,
      type: "workspace.opened",
      entity_id: fixture.id,
      actor: "legacy-coordinator",
      occurred_at: occurredAt,
      payload,
      prev_hash: GENESIS_HASH,
    };
    const eventHash = createHash("sha256")
      .update(canonicalJson(eventBody))
      .digest("hex");
    db.query(`
      INSERT INTO workspaces (
        id, epoch_id, root_path, name, created_at,
        event_head_sequence, event_head_hash
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(
      fixture.id,
      epochId,
      fixture.rootPath,
      fixture.id,
      occurredAt,
      eventHash,
    );
    db.query(`
      INSERT INTO events (
        workspace_id, epoch_id, sequence, id, protocol, type, entity_id,
        actor, occurred_at, payload_json, prev_hash, hash
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fixture.id,
      epochId,
      eventId,
      eventBody.protocol,
      eventBody.type,
      eventBody.entity_id,
      eventBody.actor,
      eventBody.occurred_at,
      canonicalJson(payload),
      GENESIS_HASH,
      eventHash,
    );
    return {
      workspaceId: fixture.id,
      epochId,
      eventHash,
      rootPath: fixture.rootPath,
    };
  });
  db.close();
  return journals;
}

function readPragma(
  db: Database,
  name: "application_id" | "user_version",
): number {
  return (db.query(`PRAGMA ${name}`).get() as Record<string, number>)[name]!;
}

function tableColumns(db: Database, table: string): string[] {
  return (
    db.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
  ).map((column) => column.name);
}

function readJournal(
  db: Database,
  workspaceId: string,
): {
  eventHash: string;
  headHash: string;
  eventCount: number;
  protocol: string;
} {
  const event = db.query(`
    SELECT hash, protocol FROM events
    WHERE workspace_id = ? AND sequence = 1
  `).get(workspaceId) as { hash: string; protocol: string };
  const workspace = db.query(`
    SELECT event_head_hash FROM workspaces WHERE id = ?
  `).get(workspaceId) as { event_head_hash: string };
  const count = (
    db.query(`
      SELECT COUNT(*) AS count FROM events WHERE workspace_id = ?
    `).get(workspaceId) as { count: number }
  ).count;
  return {
    eventHash: event.hash,
    headHash: workspace.event_head_hash,
    eventCount: count,
    protocol: event.protocol,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMilliseconds = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await Bun.sleep(5);
  }
}

function initializeGitRepository(root: string): void {
  runGit(root, "init", "--initial-branch=main");
  runGit(root, "config", "user.name", "Collab Migration Test");
  runGit(root, "config", "user.email", "collab-migration@example.invalid");
  writeFileSync(join(root, "README.md"), "# migration fixture\n");
  runGit(root, "add", "README.md");
  runGit(root, "commit", "-m", "fixture");
}

function runGit(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.error?.message}`,
    );
  }
  return result.stdout.trim();
}
