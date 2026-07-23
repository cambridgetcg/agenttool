import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  "coordination_sessions",
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

interface PublicV2Fixture extends LegacyJournal {
  presenceSessionId: string;
  headHash: string;
}

interface HardenedPreviewFixture {
  workspaceId: string;
  ownerSessionId: string;
  reviewerSessionId: string;
  firstEventHash: string;
  headHash: string;
  eventCount: number;
}

const PUBLIC_V2_PRESERVED_COLUMNS = {
  workspaces: [
    "id",
    "epoch_id",
    "root_path",
    "name",
    "created_at",
    "event_head_sequence",
    "event_head_hash",
  ],
  sessions: [
    "id",
    "workspace_id",
    "epoch_id",
    "client_instance_id",
    "actor_label",
    "actor_key",
    "runtime_kind",
    "provider_label",
    "model_label",
    "declared_capabilities_json",
    "version",
    "joined_at",
    "last_seen_at",
    "presence_expires_at",
    "left_at",
  ],
  tasks: [
    "id",
    "workspace_id",
    "title",
    "description",
    "status",
    "dependencies_json",
    "path_scopes_json",
    "assignee",
    "lease_id",
    "lease_expires_at",
    "blocker",
    "latest_progress",
    "version",
    "created_at",
    "updated_at",
    "completed_at",
  ],
  artifacts: [
    "id",
    "workspace_id",
    "task_id",
    "kind",
    "uri",
    "sha256",
    "media_type",
    "label",
    "attached_by",
    "attached_at",
  ],
  decisions: [
    "id",
    "workspace_id",
    "topic",
    "decision",
    "rationale",
    "recorded_by",
    "recorded_at",
  ],
  handoffs: [
    "id",
    "workspace_id",
    "task_id",
    "from_actor",
    "to_actor",
    "summary",
    "status",
    "offered_at",
    "expires_at",
    "resolved_at",
  ],
  events: [
    "workspace_id",
    "epoch_id",
    "sequence",
    "id",
    "protocol",
    "type",
    "entity_id",
    "actor",
    "occurred_at",
    "payload_json",
    "prev_hash",
    "hash",
  ],
  mutations: [
    "workspace_id",
    "actor",
    "idempotency_key",
    "operation",
    "request_hash",
    "response_json",
    "created_at",
  ],
} as const;

const PUBLIC_V2_ORDER_BY = {
  workspaces: "id",
  sessions: "id",
  tasks: "workspace_id, id",
  artifacts: "workspace_id, task_id, attached_at, id",
  decisions: "workspace_id, recorded_at, id",
  handoffs: "workspace_id, offered_at, id",
  events: "workspace_id, sequence",
  mutations: "workspace_id, actor, idempotency_key",
} as const;

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("collaboration schema migrations", () => {
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
        schema_migrations: 2,
        user_version: 3,
      });
    }

    const firstOpen = new CollabStore(databasePath);
    expect(firstOpen.verifyJournal(legacy!.workspaceId)).toBe(true);
    expect(readPragma(firstOpen.db, "application_id")).toBe(APPLICATION_ID);
    expect(readPragma(firstOpen.db, "user_version")).toBe(3);
    expect(
      firstOpen.db.query(`
        SELECT version, protocol FROM schema_migrations ORDER BY version
      `).all(),
    ).toEqual([
      { version: 2, protocol: "agenttool.collab/0.2" },
      { version: 3, protocol: "agenttool.collab/0.2" },
    ]);
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
    const firstMigrationRows = firstOpen.db.query(`
      SELECT version, protocol, applied_at
      FROM schema_migrations ORDER BY version
    `).all();
    firstOpen.close();

    const secondOpen = new CollabStore(databasePath);
    expect(
      secondOpen.db.query(`
        SELECT version, protocol, applied_at
        FROM schema_migrations ORDER BY version
      `).all(),
    ).toEqual(firstMigrationRows);
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
      expect(readPragma(recovered.db, "user_version")).toBe(3);
      expect(readPragma(recovered.db, "application_id")).toBe(APPLICATION_ID);
      expect(
        recovered.db.query(`
          SELECT version, protocol FROM schema_migrations ORDER BY version
        `).all(),
      ).toEqual([
        { version: 2, protocol: "agenttool.collab/0.2" },
        { version: 3, protocol: "agenttool.collab/0.2" },
      ]);
      expect(recovered.verifyJournal(legacy!.workspaceId)).toBe(true);
      recovered.close();
    });
  }

  test("upgrades an exact public v0.2 database without changing preserved bytes", () => {
    const directory = temporaryDirectory("agenttool-collab-public-v2-");
    const root = join(directory, "repo");
    const databasePath = join(directory, "collab.sqlite");
    mkdirSync(root);
    const fixture = createPublicV2Database(databasePath, root);

    const publicDatabase = new Database(databasePath, {
      create: false,
      strict: true,
    });
    expect(readPragma(publicDatabase, "application_id")).toBe(0);
    expect(readPragma(publicDatabase, "user_version")).toBe(0);
    expect(tableColumns(publicDatabase, "sessions")).toEqual(
      [...PUBLIC_V2_PRESERVED_COLUMNS.sessions],
    );
    expect(tableColumns(publicDatabase, "coordination_sessions")).toEqual([]);
    const before = publicV2ByteSnapshot(publicDatabase);
    publicDatabase.close();

    const migrated = new CollabStore(databasePath, {
      now: () => new Date("2026-07-23T12:00:00.000Z"),
    });
    expect(readPragma(migrated.db, "application_id")).toBe(APPLICATION_ID);
    expect(readPragma(migrated.db, "user_version")).toBe(3);
    expect(
      migrated.db.query(`
        SELECT version, protocol FROM schema_migrations ORDER BY version
      `).all(),
    ).toEqual([
      { version: 2, protocol: "agenttool.collab/0.2" },
      { version: 3, protocol: "agenttool.collab/0.2" },
    ]);
    expect(publicV2ByteSnapshot(migrated.db)).toEqual(before);
    expect(migrated.verifyJournal(fixture.workspaceId)).toBe(true);
    expect(migrated.getSession(fixture.presenceSessionId)).toMatchObject({
      id: fixture.presenceSessionId,
      actor_label: "Public 0.2 presence 🛰️",
      actor_key: `session:${fixture.presenceSessionId}`,
      presence: "live",
    });
    expect(
      (
        migrated.db.query(`
          SELECT COUNT(*) AS count FROM coordination_sessions
        `).get() as { count: number }
      ).count,
    ).toBe(0);

    const secure = migrated.startSession({
      root_path: root,
      actor: "secure-migration-reviewer",
      role: "migration-verifier",
    });
    expect(secure.session).toMatchObject({
      id: secure.credential.session_id,
      workspace_id: fixture.workspaceId,
      actor: "secure-migration-reviewer",
      status: "active",
      generation: 1,
    });
    expect(typeof secure.credential.session_token).toBe("string");
    expect(secure.credential.session_token.length).toBeGreaterThan(32);
    const secureRow = migrated.db.query(`
      SELECT id, token_hash FROM coordination_sessions
    `).get() as { id: string; token_hash: string };
    expect(secureRow.id).toBe(secure.session.id);
    expect(secureRow.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      byteRows(
        migrated.db,
        "sessions",
        PUBLIC_V2_PRESERVED_COLUMNS.sessions,
        PUBLIC_V2_ORDER_BY.sessions,
      ),
    ).toEqual(before.sessions);
    expect(migrated.verifyJournal(fixture.workspaceId)).toBe(true);
    migrated.close();
  });

  test("rolls back public v0.2 upgrade after the final migration failpoint", () => {
    const directory = temporaryDirectory("agenttool-collab-public-v2-rollback-");
    const root = join(directory, "repo");
    const databasePath = join(directory, "collab.sqlite");
    mkdirSync(root);
    const fixture = createPublicV2Database(databasePath, root);
    const beforeDatabase = new Database(databasePath, {
      create: false,
      strict: true,
    });
    const before = publicV2ByteSnapshot(beforeDatabase);
    beforeDatabase.close();

    expect(
      () =>
        new CollabStore(databasePath, {
          migration_failpoint: (step) => {
            if (step === "v2_verified") throw new Error(`fail:${step}`);
          },
        }),
    ).toThrow("fail:v2_verified");

    const rolledBack = new Database(databasePath, {
      create: false,
      strict: true,
    });
    expect(readPragma(rolledBack, "application_id")).toBe(0);
    expect(readPragma(rolledBack, "user_version")).toBe(0);
    expect(tableColumns(rolledBack, "sessions")).toEqual(
      [...PUBLIC_V2_PRESERVED_COLUMNS.sessions],
    );
    expect(tableColumns(rolledBack, "coordination_sessions")).toEqual([]);
    expect(tableColumns(rolledBack, "workspaces")).not.toContain(
      "repository_key",
    );
    expect(tableColumns(rolledBack, "tasks")).not.toContain(
      "coordination_mode",
    );
    expect(tableColumns(rolledBack, "schema_migrations")).toEqual([]);
    expect(publicV2ByteSnapshot(rolledBack)).toEqual(before);
    expect(readJournal(rolledBack, fixture.workspaceId)).toEqual({
      eventHash: fixture.eventHash,
      headHash: fixture.headHash,
      eventCount: 6,
      protocol: "agenttool.collab/0.1",
    });
    rolledBack.close();

    const recovered = new CollabStore(databasePath);
    expect(readPragma(recovered.db, "user_version")).toBe(3);
    expect(publicV2ByteSnapshot(recovered.db)).toEqual(before);
    expect(recovered.verifyJournal(fixture.workspaceId)).toBe(true);
    recovered.close();
  });

  test("rejects public v0.2 roots that canonicalize to one worktree before DDL", () => {
    const directory = temporaryDirectory(
      "agenttool-collab-public-v2-identity-collision-",
    );
    const root = join(directory, "repo");
    const nestedRoot = join(root, "packages", "collab");
    const databasePath = join(directory, "collab.sqlite");
    mkdirSync(root);
    initializeGitRepository(root);
    mkdirSync(nestedRoot, { recursive: true });
    const fixture = createPublicV2Database(databasePath, root, [
      {
        id: "ws_aaa_nested_root",
        rootPath: nestedRoot,
        createdAt: "2026-07-23T10:00:30.000Z",
      },
    ]);

    const beforeDatabase = new Database(databasePath, {
      create: false,
      strict: true,
    });
    const beforeApplicationId = readPragma(beforeDatabase, "application_id");
    const beforeUserVersion = readPragma(beforeDatabase, "user_version");
    const beforeSchema = sqliteSchemaSnapshot(beforeDatabase);
    const beforeRows = publicV2ByteSnapshot(beforeDatabase);
    beforeDatabase.close();
    const beforeFile = readFileSync(databasePath);

    let migrationError: CollabError | undefined;
    try {
      new CollabStore(databasePath);
    } catch (error) {
      if (error instanceof CollabError) migrationError = error;
      else throw error;
    }

    expect(migrationError?.code).toBe("migration_identity_collision");
    expect(migrationError?.details).toEqual({
      workspace_ids: ["ws_aaa_nested_root", fixture.workspaceId],
      collisions: [
        {
          field: "worktrees.fingerprint",
          workspace_ids: ["ws_aaa_nested_root", fixture.workspaceId],
        },
        {
          field: "worktrees.id",
          workspace_ids: ["ws_aaa_nested_root", fixture.workspaceId],
        },
        {
          field: "worktrees.root_path",
          workspace_ids: ["ws_aaa_nested_root", fixture.workspaceId],
        },
      ],
      boundary:
        "v0_3_will_not_merge_distinct_legacy_journals_that_resolve_to_one_worktree",
      required_action:
        "keep_the_original_audit_database_and_use_a_compatible_v0_2_client_or_choose_a_fresh_v0_3_database",
    });
    expect(readFileSync(databasePath)).toEqual(beforeFile);

    const untouched = new Database(databasePath, {
      create: false,
      strict: true,
    });
    expect(readPragma(untouched, "application_id")).toBe(beforeApplicationId);
    expect(readPragma(untouched, "user_version")).toBe(beforeUserVersion);
    expect(beforeApplicationId).toBe(0);
    expect(beforeUserVersion).toBe(0);
    expect(sqliteSchemaSnapshot(untouched)).toEqual(beforeSchema);
    expect(publicV2ByteSnapshot(untouched)).toEqual(beforeRows);
    expect(tableColumns(untouched, "workspaces")).not.toContain(
      "repository_key",
    );
    expect(tableColumns(untouched, "coordination_sessions")).toEqual([]);
    expect(tableColumns(untouched, "schema_migrations")).toEqual([]);
    expect(readJournal(untouched, fixture.workspaceId)).toMatchObject({
      headHash: fixture.headHash,
      eventCount: 6,
    });
    expect(readJournal(untouched, "ws_aaa_nested_root")).toMatchObject({
      eventCount: 1,
      protocol: "agenttool.collab/0.1",
    });
    untouched.close();
  });

  test("upgrades the hardened schema-2 preview without changing rows or references", () => {
    const directory = temporaryDirectory("agenttool-collab-preview-v2-");
    const root = join(directory, "repo");
    const databasePath = join(directory, "collab.sqlite");
    mkdirSync(root);
    const fixture = createHardenedPreviewDatabase(databasePath, root);

    const preview = new Database(databasePath, {
      create: false,
      strict: true,
    });
    expect(readPragma(preview, "application_id")).toBe(APPLICATION_ID);
    expect(readPragma(preview, "user_version")).toBe(2);
    expect(tableColumns(preview, "coordination_sessions")).toEqual([]);
    const previewSessionColumns = tableColumns(preview, "sessions");
    const before = hardenedPreviewByteSnapshot(preview, "sessions");
    const receipt2 = byteRows(
      preview,
      "schema_migrations",
      ["version", "protocol", "applied_at"],
      "version",
    );
    expect(receipt2).toHaveLength(1);
    expect(tablesReferencing(preview, "sessions")).toEqual([
      "reports",
      "session_cursor_resets",
      "sessions",
      "task_recoveries",
      "task_reviews",
    ]);
    expect(preview.query("PRAGMA foreign_key_check").all()).toEqual([]);
    preview.close();

    const migrated = new CollabStore(databasePath);
    expect(readPragma(migrated.db, "user_version")).toBe(3);
    expect(tableColumns(migrated.db, "coordination_sessions")).toEqual(
      previewSessionColumns,
    );
    expect(
      (
        migrated.db.query("SELECT COUNT(*) AS count FROM sessions").get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    expect(
      hardenedPreviewByteSnapshot(migrated.db, "coordination_sessions"),
    ).toEqual(before);
    expect(
      byteRows(
        migrated.db,
        "schema_migrations",
        ["version", "protocol", "applied_at"],
        "version",
      )[0],
    ).toEqual(receipt2[0]);
    expect(
      migrated.db.query(`
        SELECT version, protocol FROM schema_migrations ORDER BY version
      `).all(),
    ).toEqual([
      { version: 2, protocol: "agenttool.collab/0.2" },
      { version: 3, protocol: "agenttool.collab/0.2" },
    ]);
    expect(tablesReferencing(migrated.db, "coordination_sessions")).toEqual([
      "coordination_sessions",
      "reports",
      "session_cursor_resets",
      "task_recoveries",
      "task_reviews",
    ]);
    expect(tablesReferencing(migrated.db, "sessions")).toEqual([]);
    expect(migrated.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migrated.verifyJournal(fixture.workspaceId)).toBe(true);
    expect(readJournal(migrated.db, fixture.workspaceId)).toEqual({
      eventHash: fixture.firstEventHash,
      headHash: fixture.headHash,
      eventCount: fixture.eventCount,
      protocol: "agenttool.collab/0.2",
    });
    expect(
      migrated.db.query(`
        SELECT id FROM coordination_sessions ORDER BY id
      `).all(),
    ).toEqual(
      [fixture.ownerSessionId, fixture.reviewerSessionId]
        .sort()
        .map((id) => ({ id })),
    );
    migrated.close();
  });

  for (
    const failpoint of [
      "v3_session_planes_created",
      "v3_verified",
    ] as const
  ) {
    test(`rolls back hardened schema-2 preview at ${failpoint}`, () => {
      const directory = temporaryDirectory(
        `agenttool-collab-preview-${failpoint}-`,
      );
      const root = join(directory, "repo");
      const databasePath = join(directory, "collab.sqlite");
      mkdirSync(root);
      const fixture = createHardenedPreviewDatabase(databasePath, root);

      const preview = new Database(databasePath, {
        create: false,
        strict: true,
      });
      const previewSessionColumns = tableColumns(preview, "sessions");
      const before = hardenedPreviewByteSnapshot(preview, "sessions");
      const receipt2 = byteRows(
        preview,
        "schema_migrations",
        ["version", "protocol", "applied_at"],
        "version",
      );
      preview.close();

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
      expect(readPragma(rolledBack, "application_id")).toBe(APPLICATION_ID);
      expect(readPragma(rolledBack, "user_version")).toBe(2);
      expect(tableColumns(rolledBack, "sessions")).toEqual(
        previewSessionColumns,
      );
      expect(tableColumns(rolledBack, "coordination_sessions")).toEqual([]);
      expect(hardenedPreviewByteSnapshot(rolledBack, "sessions")).toEqual(
        before,
      );
      expect(
        byteRows(
          rolledBack,
          "schema_migrations",
          ["version", "protocol", "applied_at"],
          "version",
        ),
      ).toEqual(receipt2);
      expect(tablesReferencing(rolledBack, "sessions")).toEqual([
        "reports",
        "session_cursor_resets",
        "sessions",
        "task_recoveries",
        "task_reviews",
      ]);
      expect(rolledBack.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(readJournal(rolledBack, fixture.workspaceId)).toEqual({
        eventHash: fixture.firstEventHash,
        headHash: fixture.headHash,
        eventCount: fixture.eventCount,
        protocol: "agenttool.collab/0.2",
      });
      rolledBack.close();

      const recovered = new CollabStore(databasePath);
      expect(readPragma(recovered.db, "user_version")).toBe(3);
      expect(
        hardenedPreviewByteSnapshot(recovered.db, "coordination_sessions"),
      ).toEqual(before);
      expect(recovered.verifyJournal(fixture.workspaceId)).toBe(true);
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
      migrated.startSession({ root_path: root, actor: "migration-reviewer" });
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

function createHardenedPreviewDatabase(
  path: string,
  rootPath: string,
): HardenedPreviewFixture {
  initializeGitRepository(rootPath);
  const store = new CollabStore(path, {
    now: () => new Date("2026-07-23T12:30:00.000Z"),
  });
  const owner = store.startSession({
    root_path: rootPath,
    actor: "preview-owner",
    role: "implementer",
  });
  const reviewer = store.startSession({
    root_path: rootPath,
    actor: "preview-reviewer",
    role: "reviewer",
    parent_session_id: owner.session.id,
  });
  const task = store.createTaskForSession({
    ...owner.credential,
    idempotency_key: "preview-create-task",
    id: "task_hardened_preview",
    title: "Hardened preview migration fixture",
    description: "Preserve session-linked rows and foreign keys.",
    path_scopes: ["src/preview-migration.ts"],
    work_mode: "edit",
    completion_policy: "accepted",
  });
  const claimed = store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: "preview-claim-task",
    task_id: task.id,
    expected_version: task.version,
  });
  const attached = store.attachArtifactForSession({
    ...owner.credential,
    idempotency_key: "preview-attach-artifact",
    task_id: task.id,
    lease_id: claimed.lease_id!,
    expected_version: claimed.version,
    kind: "test",
    uri: "test:preview-migration",
    sha256: "b".repeat(64),
    media_type: "application/json",
    label: "Preview verification",
  });
  const offered = store.offerHandoffForSession({
    ...owner.credential,
    idempotency_key: "preview-offer-handoff",
    task_id: task.id,
    lease_id: claimed.lease_id!,
    expected_version: attached.task.version,
    to_session_id: reviewer.session.id,
    summary: "Review this preview migration fixture.",
  });
  store.appendReportForSession({
    ...owner.credential,
    idempotency_key: "preview-route-report",
    task_id: task.id,
    to_session_id: reviewer.session.id,
    kind: "observation",
    body: "The hardened preview rows and references are populated.",
    evidence_refs: [`artifact:${attached.artifact.id}`],
    confidence: "high",
    confidence_basis: "The fixture was written through the public v2 APIs.",
  });
  const completed = store.completeTaskForSession({
    ...owner.credential,
    idempotency_key: "preview-complete-task",
    task_id: task.id,
    lease_id: claimed.lease_id!,
    expected_version: offered.task.version,
    summary: "Preview migration fixture completed.",
    confidence: "high",
    confidence_basis: "The repository checkpoint is server-observed.",
  });
  store.reviewTaskForSession({
    ...reviewer.credential,
    idempotency_key: "preview-review-task",
    task_id: task.id,
    expected_version: completed.version,
    outcome: "accept",
    summary: "The fixture is suitable for migration verification.",
  });
  store.recordDecision({
    workspace_id: owner.workspace.id,
    actor: "preview-operator",
    idempotency_key: "preview-record-decision",
    topic: "schema-2-upgrade",
    decision: "Preserve the hardened preview session graph.",
    rationale: "Existing credential-bound coordination history remains auditable.",
  });

  expect(store.verifyJournal(owner.workspace.id)).toBe(true);
  const first = store.db.query(`
    SELECT hash FROM events
    WHERE workspace_id = ? AND sequence = 1
  `).get(owner.workspace.id) as { hash: string };
  const workspace = store.getWorkspace(owner.workspace.id)!;
  const eventCount = (
    store.db.query(`
      SELECT COUNT(*) AS count FROM events WHERE workspace_id = ?
    `).get(owner.workspace.id) as { count: number }
  ).count;
  const fixture = {
    workspaceId: owner.workspace.id,
    ownerSessionId: owner.session.id,
    reviewerSessionId: reviewer.session.id,
    firstEventHash: first.hash,
    headHash: workspace.event_head_hash,
    eventCount,
  };
  store.close();

  const db = new Database(path, { create: false, strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA legacy_alter_table = OFF");
  const downgrade = db.transaction(() => {
    db.exec(`
      DROP INDEX sessions_workspace_presence_idx;
      DROP TABLE sessions;
      ALTER TABLE coordination_sessions RENAME TO sessions;
      DROP INDEX coordination_sessions_workspace_status_idx;
      CREATE INDEX sessions_workspace_status_idx
        ON sessions(workspace_id, status, last_seen_at);
      DELETE FROM schema_migrations WHERE version = 3;
      PRAGMA user_version = 2;
    `);
  });
  downgrade.immediate();
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    db.query(`
      SELECT version, protocol FROM schema_migrations ORDER BY version
    `).all(),
  ).toEqual([{ version: 2, protocol: "agenttool.collab/0.2" }]);
  db.close();
  return fixture;
}

function hardenedPreviewByteSnapshot(
  db: Database,
  credentialSessionTable: "sessions" | "coordination_sessions",
): Record<string, Array<Record<string, string>>> {
  const tables = {
    repositories: ["repositories", "key"],
    workspaces: ["workspaces", "id"],
    worktrees: ["worktrees", "id"],
    credential_sessions: [credentialSessionTable, "id"],
    tasks: ["tasks", "workspace_id, id"],
    artifacts: ["artifacts", "workspace_id, task_id, attached_at, id"],
    decisions: ["decisions", "workspace_id, recorded_at, id"],
    handoffs: ["handoffs", "workspace_id, offered_at, id"],
    events: ["events", "workspace_id, sequence"],
    mutations: ["mutations", "workspace_id, actor, idempotency_key"],
    reports: ["reports", "workspace_id, event_sequence, id"],
    task_reviews: ["task_reviews", "workspace_id, task_id, review_generation"],
    task_recoveries: ["task_recoveries", "workspace_id, task_id, recovered_at, id"],
    session_cursor_resets: ["session_cursor_resets", "session_id, reset_generation, id"],
    v2_write_guard: ["v2_write_guard", "nonce"],
  } as const;
  return Object.fromEntries(
    Object.entries(tables).map(([key, [table, orderBy]]) => [
      key,
      byteRows(db, table, tableColumns(db, table), orderBy),
    ]),
  );
}

function tablesReferencing(db: Database, target: string): string[] {
  const tables = db.query(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;
  return tables
    .filter(({ name }) =>
      (
        db.query(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`).all() as
          Array<{ table: string }>
      ).some((foreignKey) => foreignKey.table === target)
    )
    .map(({ name }) => name);
}

function createPublicV2Database(
  path: string,
  rootPath: string,
  additionalWorkspaces: LegacyWorkspaceFixture[] = [],
): PublicV2Fixture {
  const [legacy] = createLegacyDatabase(path, [
    {
      id: "ws_public_v2_fixture",
      rootPath,
      createdAt: "2026-07-23T10:00:00.000Z",
      eventId: "event_public_v2_workspace",
    },
    ...additionalWorkspaces,
  ]);
  if (!legacy) throw new Error("public v0.2 fixture workspace was not created");

  const db = new Database(path, { create: false, strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
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
  `);

  const presenceSessionId = "session_public_v2_presence";
  const actorKey = `session:${presenceSessionId}`;
  db.query(`
    INSERT INTO sessions (
      id, workspace_id, epoch_id, client_instance_id, actor_label, actor_key,
      runtime_kind, provider_label, model_label, declared_capabilities_json,
      version, joined_at, last_seen_at, presence_expires_at, left_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    presenceSessionId,
    legacy.workspaceId,
    legacy.epochId,
    "public-v2-client-e\u0301",
    "Public 0.2 presence 🛰️",
    actorKey,
    "codex-cli",
    "openai",
    "public-v2-model",
    canonicalJson(["review", "unicode:e\u0301", "handoff"]),
    4,
    "2026-07-23T10:01:00.000Z",
    "2026-07-23T11:59:30.000Z",
    "2026-07-23T13:00:00.000Z",
  );

  const taskId = "task_public_v2_claimed";
  const leaseId = "lease_public_v2_preserve";
  db.query(`
    INSERT INTO tasks (
      id, workspace_id, title, description, status, dependencies_json,
      path_scopes_json, assignee, lease_id, lease_expires_at, blocker,
      latest_progress, version, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?, NULL, ?, 2, ?, ?, NULL)
  `).run(
    taskId,
    legacy.workspaceId,
    "Preserve public v0.2 bytes e\u0301",
    "A claimed task with a live lease and UTF-8 data 🧭",
    canonicalJson(["task_external_dependency"]),
    canonicalJson(["packages/collab/**", "fixtures/e\u0301.txt"]),
    actorKey,
    leaseId,
    "2026-07-23T13:30:00.000Z",
    "half-way 🌗\nline two",
    "2026-07-23T10:02:00.000Z",
    "2026-07-23T10:03:00.000Z",
  );

  db.query(`
    INSERT INTO artifacts (
      id, workspace_id, task_id, kind, uri, sha256, media_type, label,
      attached_by, attached_at
    ) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?)
  `).run(
    "artifact_public_v2",
    legacy.workspaceId,
    taskId,
    "file:fixtures/e%CC%81.txt",
    "a".repeat(64),
    "text/plain; charset=utf-8",
    "Evidence 🧾",
    actorKey,
    "2026-07-23T10:04:00.000Z",
  );
  db.query(`
    INSERT INTO decisions (
      id, workspace_id, topic, decision, rationale, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "decision_public_v2",
    legacy.workspaceId,
    "migration-byte-preservation",
    "Preserve every public v0.2 value exactly.",
    "Schema changes must not rewrite historical caller bytes e\u0301.",
    actorKey,
    "2026-07-23T10:05:00.000Z",
  );
  db.query(`
    INSERT INTO handoffs (
      id, workspace_id, task_id, from_actor, to_actor, summary, status,
      offered_at, expires_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
  `).run(
    "handoff_public_v2",
    legacy.workspaceId,
    taskId,
    actorKey,
    "future-reviewer",
    "Review the exact migrated bytes; no silent normalization.",
    "2026-07-23T10:06:00.000Z",
    "2026-07-23T14:00:00.000Z",
  );

  const mutationRequest = {
    workspace_id: legacy.workspaceId,
    task_id: taskId,
    lease_id: leaseId,
    progress: "half-way 🌗\nline two",
  };
  db.query(`
    INSERT INTO mutations (
      workspace_id, actor, idempotency_key, operation, request_hash,
      response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    legacy.workspaceId,
    actorKey,
    "public-v2-progress-mutation",
    "task.progress",
    createHash("sha256").update(canonicalJson(mutationRequest)).digest("hex"),
    canonicalJson({
      task_id: taskId,
      lease_id: leaseId,
      version: 2,
      note: "stored response e\u0301",
    }),
    "2026-07-23T10:03:00.000Z",
  );

  let headHash = legacy.eventHash;
  const events = [
    {
      id: "event_public_v2_task_created",
      type: "task.created",
      entityId: taskId,
      occurredAt: "2026-07-23T10:02:00.000Z",
      payload: {
        title: "Preserve public v0.2 bytes e\u0301",
        dependencies: ["task_external_dependency"],
        path_scopes: ["packages/collab/**", "fixtures/e\u0301.txt"],
      },
    },
    {
      id: "event_public_v2_task_claimed",
      type: "task.claimed",
      entityId: taskId,
      occurredAt: "2026-07-23T10:03:00.000Z",
      payload: {
        assignee: actorKey,
        lease_id: leaseId,
        lease_expires_at: "2026-07-23T13:30:00.000Z",
      },
    },
    {
      id: "event_public_v2_artifact",
      type: "artifact.attached",
      entityId: "artifact_public_v2",
      occurredAt: "2026-07-23T10:04:00.000Z",
      payload: {
        task_id: taskId,
        kind: "file",
        uri: "file:fixtures/e%CC%81.txt",
        sha256: "a".repeat(64),
      },
    },
    {
      id: "event_public_v2_decision",
      type: "decision.recorded",
      entityId: "decision_public_v2",
      occurredAt: "2026-07-23T10:05:00.000Z",
      payload: {
        topic: "migration-byte-preservation",
        decision: "Preserve every public v0.2 value exactly.",
      },
    },
    {
      id: "event_public_v2_handoff",
      type: "handoff.offered",
      entityId: "handoff_public_v2",
      occurredAt: "2026-07-23T10:06:00.000Z",
      payload: {
        task_id: taskId,
        from_actor: actorKey,
        to_actor: "future-reviewer",
        expires_at: "2026-07-23T14:00:00.000Z",
      },
    },
  ] as const;
  for (const [index, event] of events.entries()) {
    headHash = appendPublicV2Event(db, {
      workspaceId: legacy.workspaceId,
      epochId: legacy.epochId,
      sequence: index + 2,
      id: event.id,
      type: event.type,
      entityId: event.entityId,
      actor: actorKey,
      occurredAt: event.occurredAt,
      payload: event.payload,
      prevHash: headHash,
    });
  }
  db.query(`
    UPDATE workspaces
    SET event_head_sequence = ?, event_head_hash = ?
    WHERE id = ?
  `).run(events.length + 1, headHash, legacy.workspaceId);
  db.close();

  return {
    ...legacy,
    presenceSessionId,
    headHash,
  };
}

function appendPublicV2Event(
  db: Database,
  input: {
    workspaceId: string;
    epochId: string;
    sequence: number;
    id: string;
    type: string;
    entityId: string;
    actor: string;
    occurredAt: string;
    payload: Record<string, unknown>;
    prevHash: string;
  },
): string {
  const body = {
    protocol: "agenttool.collab/0.1",
    workspace_id: input.workspaceId,
    epoch_id: input.epochId,
    sequence: input.sequence,
    id: input.id,
    type: input.type,
    entity_id: input.entityId,
    actor: input.actor,
    occurred_at: input.occurredAt,
    payload: input.payload,
    prev_hash: input.prevHash,
  };
  const hash = createHash("sha256")
    .update(canonicalJson(body))
    .digest("hex");
  db.query(`
    INSERT INTO events (
      workspace_id, epoch_id, sequence, id, protocol, type, entity_id,
      actor, occurred_at, payload_json, prev_hash, hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.workspaceId,
    input.epochId,
    input.sequence,
    input.id,
    body.protocol,
    input.type,
    input.entityId,
    input.actor,
    input.occurredAt,
    canonicalJson(input.payload),
    input.prevHash,
    hash,
  );
  return hash;
}

function publicV2ByteSnapshot(
  db: Database,
): Record<
  keyof typeof PUBLIC_V2_PRESERVED_COLUMNS,
  Array<Record<string, string>>
> {
  return Object.fromEntries(
    (
      Object.keys(PUBLIC_V2_PRESERVED_COLUMNS) as Array<
        keyof typeof PUBLIC_V2_PRESERVED_COLUMNS
      >
    ).map((table) => [
      table,
      byteRows(
        db,
        table,
        PUBLIC_V2_PRESERVED_COLUMNS[table],
        PUBLIC_V2_ORDER_BY[table],
      ),
    ]),
  ) as Record<
    keyof typeof PUBLIC_V2_PRESERVED_COLUMNS,
    Array<Record<string, string>>
  >;
}

function byteRows(
  db: Database,
  table: string,
  columns: readonly string[],
  orderBy: string,
): Array<Record<string, string>> {
  const byteColumns = columns.map((column) => {
    const identifier = quoteIdentifier(column);
    return `
      CASE
        WHEN ${identifier} IS NULL THEN 'null:'
        ELSE typeof(${identifier}) || ':' || hex(CAST(${identifier} AS BLOB))
      END AS ${identifier}
    `;
  });
  return db.query(`
    SELECT ${byteColumns.join(", ")}
    FROM ${quoteIdentifier(table)}
    ORDER BY ${orderBy}
  `).all() as Array<Record<string, string>>;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
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

function sqliteSchemaSnapshot(
  db: Database,
): Array<{ type: string; name: string; table_name: string; sql: string | null }> {
  return db.query(`
    SELECT type, name, tbl_name AS table_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as Array<{
    type: string;
    name: string;
    table_name: string;
    sql: string | null;
  }>;
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
