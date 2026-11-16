// One journal file is served by builds from more than one line at once: the
// build installed on this Mac, main, and the lines still to be merged. Each
// checks the schema-3 shape on open and refuses a journal that moved. So the
// shape is pinned here as literals, never imported from src: a change to a
// session column or a write guard must fail this test before it can fail
// another build's open. The second half opens a journal written before the
// three additive tables existed, the shape the installed build writes today.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doorbellScan, knockForSession } from "../src/host.js";
import { CollabStore } from "../src/store-notes.js";

const ADDITIVE = ["repository_aliases", "repository_discovery", "session_lease_lapses"];
const COORDINATION_SESSIONS = [
  "id", "workspace_id", "worktree_id", "actor", "role", "parent_session_id", "status",
  "generation", "token_hash", "joined_at", "last_seen_at", "ended_at", "cursor_epoch_id",
  "cursor_sequence", "cursor_hash", "cursor_version", "reset_generation", "cursor_recovery_required",
];
const PRESENCE_SESSIONS = [
  "id", "workspace_id", "epoch_id", "client_instance_id", "actor_label", "actor_key",
  "runtime_kind", "provider_label", "model_label", "declared_capabilities_json", "version",
  "joined_at", "last_seen_at", "presence_expires_at", "left_at",
];
const GUARDS = [
  "artifacts_v2_insert_guard", "handoffs_v2_insert_guard", "tasks_v2_delete_guard",
  "tasks_v2_insert_guard", "tasks_v2_update_guard",
];

function read<T>(path: string, fn: (db: Database) => T): T {
  const db = new Database(path, { readonly: true });
  try { return fn(db); } finally { db.close(); }
}
const tables = (path: string) => read(path, (db) =>
  (db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name));
const columns = (path: string, table: string) => read(path, (db) =>
  (db.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((r) => r.name));

test("keeps the schema-3 shape other builds check, and opens a journal without the additive tables", () => {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-schema-3-shape-"));
  try {
    const root = join(directory, "repo");
    mkdirSync(root);
    const path = join(directory, "state", "collab.sqlite");
    let now = new Date("2026-11-12T09:00:00.000Z");
    let store = new CollabStore(path, { now: () => new Date(now) });
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    const task = store.createTaskForSession({
      ...beta.credential, idempotency_key: "create", title: "held across builds", work_mode: "edit",
      completion_policy: "accepted", path_scopes: ["src/a.ts"],
    });
    const claimed = store.claimTaskForSession({
      ...beta.credential, idempotency_key: "claim", task_id: task.id, expected_version: task.version, ttl_seconds: 30,
    });
    store.restSessionForSession({
      ...beta.credential, idempotency_key: "rest", mode: "resting",
      until: new Date(now.getTime() + 48 * 3600_000).toISOString(), wake_on: ["addressed"],
    });
    store.appendReportForSession({
      ...alpha.credential, idempotency_key: "note", to_session_id: beta.session.id, kind: "observation",
      body: "An addressed note.",
    });
    store.close();

    // The pins: a build on another line refuses the journal if any of these moves.
    expect(columns(path, "coordination_sessions")).toEqual(COORDINATION_SESSIONS);
    expect(columns(path, "sessions")).toEqual(PRESENCE_SESSIONS);
    expect(read(path, (db) => (db.query(`
      SELECT name FROM sqlite_master WHERE type = 'trigger'
        AND sql LIKE '%v2_write_guard%' AND sql LIKE '%agenttool_collab_v2_write_requires_v2_client%'
      ORDER BY name`).all() as Array<{ name: string }>).map((r) => r.name))).toEqual(GUARDS);
    expect(read(path, (db) => ({
      user_version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      receipts: db.query("SELECT version, protocol FROM schema_migrations ORDER BY version").all(),
    }))).toEqual({
      user_version: 3,
      receipts: [{ version: 2, protocol: "agenttool.collab/0.2" }, { version: 3, protocol: "agenttool.collab/0.2" }],
    });

    const raw = new Database(path);
    raw.exec(ADDITIVE.map((t) => `DROP TABLE ${t};`).join("\n"));
    raw.close();
    const seamShape = tables(path);
    expect(seamShape.filter((t) => ADDITIVE.includes(t))).toEqual([]);

    // The read-only verbs answer on that shape and add nothing to it.
    now = new Date(now.getTime() + 31_000);
    expect(knockForSession(path, beta.session.id, { now: () => now })).toMatchObject({ liveness: "resting", waiting: 1 });
    expect(doorbellScan(path, { now: () => now }).sessions.map((s) => s.session_id)).toEqual([beta.session.id]);
    expect(tables(path)).toEqual(seamShape);

    // The store reopens it, restores its additive tables, and reads the same
    // facts: the chain holds, and the present holder's past-TTL lease is held.
    store = new CollabStore(path, { now: () => new Date(now) });
    expect(tables(path).filter((t) => ADDITIVE.includes(t))).toEqual(ADDITIVE);
    expect(store.verifyJournal(alpha.workspace.id)).toBe(true);
    const current = store.getTask(claimed.workspace_id, claimed.id);
    expect(current.assignee_liveness).toBe("resting");
    expect(current.effective_status).toBe("claimed");
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
