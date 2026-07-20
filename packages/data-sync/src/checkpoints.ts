import { Database } from "bun:sqlite";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DataSyncError, syncInvariant } from "./errors.js";
import type { SyncCheckpoint, SyncCheckpointStore } from "./types.js";

interface CheckpointRow {
  peer_id: string;
  collection_id: string;
  peer_base_url: string;
  origin_node_id: string;
  feed_id: string;
  publisher_id: string;
  publisher_ed25519_public_key: string;
  cursor: string;
  last_applied_at: string;
  records_inserted: number;
  records_existing: number;
  tombstones_applied: number;
}

export class MemorySyncCheckpointStore implements SyncCheckpointStore {
  readonly #checkpoints = new Map<string, SyncCheckpoint>();

  get(peerId: string, collectionId: string): SyncCheckpoint | null {
    const value = this.#checkpoints.get(checkpointKey(peerId, collectionId));
    return value ? { ...value } : null;
  }

  set(checkpoint: SyncCheckpoint): void {
    validateCheckpoint(checkpoint);
    this.#checkpoints.set(checkpointKey(checkpoint.peer_id, checkpoint.collection_id), { ...checkpoint });
  }

  delete(peerId: string, collectionId: string): boolean {
    return this.#checkpoints.delete(checkpointKey(peerId, collectionId));
  }
}

export class SQLiteSyncCheckpointStore implements SyncCheckpointStore {
  readonly #db: Database;
  readonly #filesystemPath?: string;
  #closed = false;

  constructor(path: string) {
    syncInvariant(typeof path === "string" && path.length > 0, "invalid_checkpoint_path", "checkpoint_path is required");
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const descriptor = openSync(path, "a", 0o600);
      closeSync(descriptor);
      chmodSync(path, 0o600);
      this.#filesystemPath = path;
    }
    this.#db = new Database(path, { create: true, strict: true });
    this.#db.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sync_checkpoints_v1 (
        peer_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        peer_base_url TEXT NOT NULL,
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
      )
    `);
    const checkpointColumns = this.#db.query("PRAGMA table_info(sync_checkpoints_v1)")
      .all() as Array<{ name: string }>;
    if (!checkpointColumns.some((column) => column.name === "peer_base_url")) {
      // An old cursor has no trustworthy origin binding. Keep the row visible
      // but invalid so the operator must explicitly reset it before resuming.
      this.#db.exec("ALTER TABLE sync_checkpoints_v1 ADD COLUMN peer_base_url TEXT NOT NULL DEFAULT ''");
    }
    this.#tightenFileModes();
  }

  get(peerId: string, collectionId: string): SyncCheckpoint | null {
    this.#assertOpen();
    const row = this.#db.query(`
      SELECT peer_id, collection_id, peer_base_url, origin_node_id, feed_id,
             publisher_id, publisher_ed25519_public_key,
             cursor, last_applied_at,
             records_inserted, records_existing, tombstones_applied
      FROM sync_checkpoints_v1 WHERE peer_id = ? AND collection_id = ?
    `).get(peerId, collectionId) as CheckpointRow | null;
    if (!row) return null;
    const checkpoint = { ...row };
    validateCheckpoint(checkpoint);
    return checkpoint;
  }

  set(checkpoint: SyncCheckpoint): void {
    this.#assertOpen();
    validateCheckpoint(checkpoint);
    this.#db.query(`
      INSERT INTO sync_checkpoints_v1 (
        peer_id, collection_id, peer_base_url, origin_node_id, feed_id,
        publisher_id, publisher_ed25519_public_key,
        cursor, last_applied_at,
        records_inserted, records_existing, tombstones_applied
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(peer_id, collection_id) DO UPDATE SET
        peer_base_url = excluded.peer_base_url,
        origin_node_id = excluded.origin_node_id,
        feed_id = excluded.feed_id,
        publisher_id = excluded.publisher_id,
        publisher_ed25519_public_key = excluded.publisher_ed25519_public_key,
        cursor = excluded.cursor,
        last_applied_at = excluded.last_applied_at,
        records_inserted = excluded.records_inserted,
        records_existing = excluded.records_existing,
        tombstones_applied = excluded.tombstones_applied
    `).run(
      checkpoint.peer_id,
      checkpoint.collection_id,
      checkpoint.peer_base_url,
      checkpoint.origin_node_id,
      checkpoint.feed_id,
      checkpoint.publisher_id,
      checkpoint.publisher_ed25519_public_key,
      checkpoint.cursor,
      checkpoint.last_applied_at,
      checkpoint.records_inserted,
      checkpoint.records_existing,
      checkpoint.tombstones_applied,
    );
    this.#tightenFileModes();
  }

  delete(peerId: string, collectionId: string): boolean {
    this.#assertOpen();
    const result = this.#db.query(`
      DELETE FROM sync_checkpoints_v1 WHERE peer_id = ? AND collection_id = ?
    `).run(peerId, collectionId);
    this.#tightenFileModes();
    return result.changes > 0;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close(false);
  }

  #assertOpen(): void {
    if (this.#closed) throw new DataSyncError("checkpoint_store_closed", "Checkpoint store is closed", 410);
  }

  #tightenFileModes(): void {
    if (!this.#filesystemPath) return;
    chmodSync(this.#filesystemPath, 0o600);
    for (const suffix of ["-wal", "-shm"]) {
      try {
        chmodSync(`${this.#filesystemPath}${suffix}`, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

function checkpointKey(peerId: string, collectionId: string): string {
  return `${peerId.length}:${peerId}${collectionId}`;
}

function validateCheckpoint(checkpoint: SyncCheckpoint): void {
  syncInvariant(checkpoint && typeof checkpoint === "object", "invalid_checkpoint", "Checkpoint is required");
  for (const field of [
    "peer_id",
    "collection_id",
    "peer_base_url",
    "origin_node_id",
    "feed_id",
    "publisher_id",
    "publisher_ed25519_public_key",
    "cursor",
    "last_applied_at",
  ] as const) {
    syncInvariant(typeof checkpoint[field] === "string" && checkpoint[field].length > 0, "invalid_checkpoint", `Checkpoint ${field} is required`);
  }
  syncInvariant(Number.isFinite(Date.parse(checkpoint.last_applied_at)), "invalid_checkpoint", "Checkpoint timestamp is invalid");
  for (const field of ["records_inserted", "records_existing", "tombstones_applied"] as const) {
    syncInvariant(Number.isSafeInteger(checkpoint[field]) && checkpoint[field] >= 0, "invalid_checkpoint", `Checkpoint ${field} is invalid`);
  }
}
