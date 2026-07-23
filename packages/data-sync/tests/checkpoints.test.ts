import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataSyncError,
  SQLiteSyncCheckpointStore,
  type SyncCheckpoint,
} from "../src/index.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function checkpointPath(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-data-sync-checkpoint-"));
  roots.push(root);
  return join(root, "sync.sqlite");
}

function checkpoint(overrides: Partial<SyncCheckpoint> = {}): SyncCheckpoint {
  return {
    peer_id: "peer_source",
    collection_id: "research",
    peer_base_url: "https://peer.example",
    origin_node_id: "node_source",
    feed_id: "feed_01234567-89ab-4cde-8fab-0123456789ab",
    publisher_id: "publisher_source",
    publisher_ed25519_public_key: "publisher-public-key",
    cursor: "opaque-cursor",
    last_applied_at: "2026-07-12T12:00:00.000Z",
    records_inserted: 2,
    records_existing: 1,
    tombstones_applied: 0,
    ...overrides,
  };
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw");
}

describe("SQLite sync checkpoints", () => {
  test("validates persisted rows before returning them", () => {
    const path = checkpointPath();
    const store = new SQLiteSyncCheckpointStore(path);
    store.set(checkpoint());
    store.close();

    const database = new Database(path, { strict: true });
    database.query(`
      UPDATE sync_checkpoints_v1 SET records_inserted = -1
      WHERE peer_id = ? AND collection_id = ?
    `).run("peer_source", "research");
    database.close(false);

    const reopened = new SQLiteSyncCheckpointStore(path);
    try {
      const error = captureError(() => reopened.get("peer_source", "research"));
      expect(error).toBeInstanceOf(DataSyncError);
      expect(error).toMatchObject({ code: "invalid_checkpoint", status: 400 });
    } finally {
      reopened.close();
    }
  });

  test("migrates legacy rows but refuses their unbound cursors", () => {
    const path = checkpointPath();
    const database = new Database(path, { create: true, strict: true });
    database.exec(`
      CREATE TABLE sync_checkpoints_v1 (
        peer_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        origin_node_id TEXT NOT NULL,
        feed_id TEXT NOT NULL,
        publisher_id TEXT NOT NULL,
        publisher_ed25519_public_key TEXT NOT NULL,
        cursor TEXT NOT NULL,
        last_applied_at TEXT NOT NULL,
        records_inserted INTEGER NOT NULL,
        records_existing INTEGER NOT NULL,
        tombstones_applied INTEGER NOT NULL,
        PRIMARY KEY (peer_id, collection_id)
      );
      INSERT INTO sync_checkpoints_v1 VALUES (
        'peer_source', 'research', 'node_source',
        'feed_01234567-89ab-4cde-8fab-0123456789ab',
        'publisher_source', 'publisher-public-key', 'opaque-cursor',
        '2026-07-12T12:00:00.000Z', 2, 1, 0
      );
    `);
    database.close(false);

    const migrated = new SQLiteSyncCheckpointStore(path);
    try {
      const error = captureError(() => migrated.get("peer_source", "research"));
      expect(error).toBeInstanceOf(DataSyncError);
      expect(error).toMatchObject({ code: "invalid_checkpoint", status: 400 });

      migrated.set(checkpoint());
      expect(migrated.get("peer_source", "research")).toEqual(checkpoint());
    } finally {
      migrated.close();
    }
  });
});
