import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
// Deliberate cross-package source import (store.js, not index.js, so the MCP
// layer's external deps stay out): this test exists to prove that
// collab-zerone's independent hash walk is byte-identical to the real
// @agenttool/collab store writing the same journal.
import { CollabStore } from "../../collab/src/store.js";
import { JournalReader } from "../src/journal.js";

function freshRepoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "collab-zerone-conf-"));
  const init = Bun.spawnSync({ cmd: ["git", "init", "-q", dir], stdout: "pipe", stderr: "pipe" });
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.toString()}`);
  return dir;
}

function populatedJournal(): { dbPath: string; workspaceId: string; store: CollabStore } {
  const repo = freshRepoDir();
  const dbPath = join(mkdtempSync(join(tmpdir(), "collab-zerone-db-")), "journal.sqlite");
  const store = new CollabStore(dbPath);
  const workspace = store.openWorkspace({ root_path: repo, actor: "conformance-tester" });
  const task = store.createTask({
    workspace_id: workspace.id,
    actor: "conformance-tester",
    idempotency_key: "conf-create-1",
    title: "conformance fixture task",
    path_scopes: ["src/**"],
  });
  store.claimTask({
    workspace_id: workspace.id,
    task_id: task.id,
    actor: "conformance-tester",
    idempotency_key: "conf-claim-1",
    expected_version: task.version,
  });
  store.recordDecision({
    workspace_id: workspace.id,
    actor: "conformance-tester",
    idempotency_key: "conf-decision-1",
    topic: "conformance",
    decision: "the independent reader must recompute this exact chain",
    rationale: "cross-package hash conformance",
  });
  return { dbPath, workspaceId: workspace.id, store };
}

describe("hash conformance against @agenttool/collab", () => {
  test("independent walk reproduces the store's event chain and head", () => {
    const { dbPath, workspaceId, store } = populatedJournal();
    const storeWorkspace = store.getWorkspace(workspaceId);
    expect(storeWorkspace).not.toBeNull();
    expect(store.verifyJournal(workspaceId)).toBe(true);

    const reader = new JournalReader(dbPath);
    const readerWorkspace = reader.getWorkspace(workspaceId);
    expect(readerWorkspace?.event_head_sequence).toBe(storeWorkspace!.event_head_sequence);
    expect(readerWorkspace?.event_head_hash).toBe(storeWorkspace!.event_head_hash);
    expect(storeWorkspace!.event_head_sequence).toBeGreaterThanOrEqual(3);

    const full = reader.verify(workspaceId);
    expect(full.valid).toBe(true);
    if (full.valid) {
      expect(full.checked_events).toBe(storeWorkspace!.event_head_sequence);
      expect(full.hash_at_sequence).toBe(storeWorkspace!.event_head_hash);
    }
    reader.close();
  });

  test("prefix hashes match the store's own event page hashes", () => {
    const { dbPath, workspaceId, store } = populatedJournal();
    const page = store.eventsSince(workspaceId, 0, 100);
    expect(page.chain_valid).toBe(true);
    const reader = new JournalReader(dbPath);
    for (const event of page.events) {
      const prefix = reader.verify(workspaceId, event.sequence);
      expect(prefix.valid).toBe(true);
      if (prefix.valid) expect(prefix.hash_at_sequence).toBe(event.hash);
    }
    reader.close();
  });

  test("a workspace unknown to the journal reports workspace_not_found", () => {
    const { dbPath } = populatedJournal();
    const reader = new JournalReader(dbPath);
    const missing = reader.verify("ws_does_not_exist");
    expect(missing.valid).toBe(false);
    if (!missing.valid) expect(missing.failure).toBe("workspace_not_found");
    reader.close();
  });

  test("session-bound events (non-null session_id) hash identically in both walks", () => {
    const repo = freshRepoDir();
    const dbPath = join(mkdtempSync(join(tmpdir(), "collab-zerone-sess-")), "journal.sqlite");
    const store = new CollabStore(dbPath);
    const handle = store.startSession({ root_path: repo, actor: "session-tester" });
    const workspaceId = handle.workspace.id;
    const task = store.createTaskForSession({
      ...handle.credential,
      idempotency_key: "sess-create-1",
      title: "session conformance task",
      path_scopes: ["src/**"],
    });
    store.claimTaskForSession({
      ...handle.credential,
      idempotency_key: "sess-claim-1",
      task_id: task.id,
      expected_version: task.version,
    });
    const withSession = new Database(dbPath, { readonly: true })
      .query("SELECT COUNT(*) AS n FROM events WHERE session_id IS NOT NULL AND workspace_id = ?")
      .get(workspaceId) as { n: number };
    expect(withSession.n).toBeGreaterThanOrEqual(1);

    const storeWorkspace = store.getWorkspace(workspaceId)!;
    expect(store.verifyJournal(workspaceId)).toBe(true);
    const reader = new JournalReader(dbPath);
    const full = reader.verify(workspaceId);
    expect(full.valid).toBe(true);
    if (full.valid) expect(full.hash_at_sequence).toBe(storeWorkspace.event_head_hash);
    reader.close();
  });

  test("reader never mutates the journal file", () => {
    const { dbPath, workspaceId } = populatedJournal();
    const before = new Database(dbPath, { readonly: true })
      .query("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    const reader = new JournalReader(dbPath);
    reader.verify(workspaceId);
    reader.listWorkspaces();
    reader.close();
    const after = new Database(dbPath, { readonly: true })
      .query("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
