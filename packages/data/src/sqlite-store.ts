/**
 * Durable record/change store and local SQLite FTS5 reference index.
 * Doctrine: docs/AGENT-DATA-PROTOCOL.md
 */
import { Database } from "bun:sqlite";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, deepFreeze } from "./canonical.js";
import { DataNodeError } from "./errors.js";
import type {
  Change,
  IndexCandidate,
  RecordEnvelope,
  RecordIndex,
  RecordStore,
  StoredCollection,
  Tombstone,
} from "./types.js";

interface JsonRow {
  json: string;
}

interface ChangeRow {
  sequence: number;
  type: "record" | "tombstone";
  collection_id: string;
  record_id: string;
  at: string;
  payload_json: string;
}

export class SQLiteStore implements RecordStore, RecordIndex {
  readonly db: Database;
  private readonly filesystemPath?: string;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const descriptor = openSync(path, "a", 0o600);
      closeSync(descriptor);
      chmodSync(path, 0o600);
      this.filesystemPath = path;
    }
    this.db = new Database(path, { create: true, strict: true });
    this.tightenFileModes();
  }

  initialize(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (this.db.filename !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id),
        envelope_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        blob_ref TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS records_collection_idx ON records(collection_id, created_at, id);
      CREATE TABLE IF NOT EXISTS tombstones (
        record_id TEXT PRIMARY KEY REFERENCES records(id),
        collection_id TEXT NOT NULL,
        reason TEXT,
        tombstoned_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('record', 'tombstone')),
        collection_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS changes_collection_idx ON changes(collection_id, sequence);
      CREATE VIRTUAL TABLE IF NOT EXISTS record_fts USING fts5(
        record_id UNINDEXED,
        collection_id UNINDEXED,
        document,
        tokenize = 'unicode61'
      );
    `);
    this.tightenFileModes();
  }

  putCollection(collection: StoredCollection): "inserted" | "existing" {
    const existing = this.getCollection(collection.id);
    if (existing) {
      const comparableExisting = { ...existing, created_at: collection.created_at };
      if (canonicalJson(comparableExisting) !== canonicalJson(collection)) {
        throw new DataNodeError(
          "collection_conflict",
          `Collection '${collection.id}' already exists with a different definition`,
          409,
        );
      }
      return "existing";
    }
    this.db.query(
      "INSERT INTO collections (id, definition_json, created_at) VALUES (?, ?, ?)",
    ).run(collection.id, canonicalJson(collection), collection.created_at);
    return "inserted";
  }

  getCollection(id: string): StoredCollection | null {
    const row = this.db.query("SELECT definition_json AS json FROM collections WHERE id = ?")
      .get(id) as JsonRow | null;
    return row ? parseFrozen<StoredCollection>(row.json) : null;
  }

  listCollections(): StoredCollection[] {
    const rows = this.db.query("SELECT definition_json AS json FROM collections ORDER BY id")
      .all() as JsonRow[];
    return rows.map((row) => parseFrozen<StoredCollection>(row.json));
  }

  putRecord(record: RecordEnvelope): "inserted" | "existing" {
    const existing = this.db.query("SELECT envelope_json AS json FROM records WHERE id = ?")
      .get(record.id) as JsonRow | null;
    if (existing) return "existing";

    const at = record.ingested_at;
    const json = canonicalJson(record);
    const insert = this.db.transaction(() => {
      this.db.query(`
        INSERT INTO records (id, collection_id, envelope_json, content_sha256, blob_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.collection_id,
        json,
        record.content.sha256,
        record.content.blob_ref,
        at,
      );
      this.db.query(`
        INSERT INTO changes (type, collection_id, record_id, at, payload_json)
        VALUES ('record', ?, ?, ?, ?)
      `).run(record.collection_id, record.id, at, json);
    });
    insert.immediate();
    return "inserted";
  }

  getRecord(id: string, include_tombstoned = false): RecordEnvelope | null {
    const row = this.db.query(`
      SELECT r.envelope_json AS json
      FROM records r
      LEFT JOIN tombstones t ON t.record_id = r.id
      WHERE r.id = ? AND (? = 1 OR t.record_id IS NULL)
    `).get(id, include_tombstoned ? 1 : 0) as JsonRow | null;
    return row ? parseFrozen<RecordEnvelope>(row.json) : null;
  }

  listRecords(collections?: string[], limit = 100, offset = 0): RecordEnvelope[] {
    const params: Array<string | number> = [];
    const filters = ["t.record_id IS NULL"];
    if (collections?.length) {
      filters.push(`r.collection_id IN (${collections.map(() => "?").join(",")})`);
      params.push(...collections);
    }
    params.push(limit, offset);
    const rows = this.db.query(`
      SELECT r.envelope_json AS json
      FROM records r
      LEFT JOIN tombstones t ON t.record_id = r.id
      WHERE ${filters.join(" AND ")}
      ORDER BY r.rowid DESC
      LIMIT ? OFFSET ?
    `).all(...params) as JsonRow[];
    return rows.map((row) => parseFrozen<RecordEnvelope>(row.json));
  }

  tombstoneRecord(id: string, reason?: string): Tombstone {
    const record = this.getRecord(id, true);
    if (!record) throw new DataNodeError("record_not_found", "Record was not found", 404);
    const existing = this.getTombstone(id);
    if (existing) return existing;

    const tombstone: Tombstone = deepFreeze({
      record_id: id,
      collection_id: record.collection_id,
      ...(reason ? { reason } : {}),
      tombstoned_at: new Date().toISOString(),
    });
    const json = canonicalJson(tombstone);
    const insert = this.db.transaction(() => {
      this.db.query(`
        INSERT INTO tombstones (record_id, collection_id, reason, tombstoned_at)
        VALUES (?, ?, ?, ?)
      `).run(id, record.collection_id, reason ?? null, tombstone.tombstoned_at);
      this.db.query(`
        INSERT INTO changes (type, collection_id, record_id, at, payload_json)
        VALUES ('tombstone', ?, ?, ?, ?)
      `).run(record.collection_id, id, tombstone.tombstoned_at, json);
    });
    insert.immediate();
    return tombstone;
  }

  getTombstone(id: string): Tombstone | null {
    const row = this.db.query(`
      SELECT record_id, collection_id, reason, tombstoned_at
      FROM tombstones WHERE record_id = ?
    `).get(id) as (Tombstone & { reason: string | null }) | null;
    if (!row) return null;
    return deepFreeze({
      record_id: row.record_id,
      collection_id: row.collection_id,
      ...(row.reason ? { reason: row.reason } : {}),
      tombstoned_at: row.tombstoned_at,
    });
  }

  listChanges(afterSequence: number, collectionId: string | undefined, limit: number): Change[] {
    const rows = collectionId
      ? this.db.query(`
          SELECT sequence, type, collection_id, record_id, at, payload_json
          FROM changes WHERE sequence > ? AND collection_id = ? ORDER BY sequence LIMIT ?
        `).all(afterSequence, collectionId, limit) as ChangeRow[]
      : this.db.query(`
          SELECT sequence, type, collection_id, record_id, at, payload_json
          FROM changes WHERE sequence > ? ORDER BY sequence LIMIT ?
        `).all(afterSequence, limit) as ChangeRow[];

    return rows.map((row) => row.type === "record"
      ? deepFreeze({
          id: `change_${row.sequence}`,
          type: "record.created" as const,
          sequence: row.sequence,
          collection_id: row.collection_id,
          record_id: row.record_id,
          occurred_at: row.at,
          record: JSON.parse(row.payload_json) as RecordEnvelope,
        })
      : deepFreeze({
          id: `change_${row.sequence}`,
          type: "record.tombstoned" as const,
          sequence: row.sequence,
          collection_id: row.collection_id,
          record_id: row.record_id,
          occurred_at: row.at,
          tombstone: JSON.parse(row.payload_json) as Tombstone,
        }));
  }

  getOrCreateNodeId(preferred?: string): string {
    const existing = this.db.query("SELECT value FROM node_meta WHERE key = 'node_id'")
      .get() as { value: string } | null;
    if (existing) {
      if (preferred && preferred !== existing.value) {
        throw new DataNodeError("node_id_conflict", "Configured node_id differs from persisted node_id", 409);
      }
      return existing.value;
    }
    const nodeId = preferred ?? `node_${randomUUID()}`;
    this.db.query("INSERT INTO node_meta (key, value) VALUES ('node_id', ?)").run(nodeId);
    return nodeId;
  }

  indexRecord(record: RecordEnvelope, document: string): void {
    this.db.query("DELETE FROM record_fts WHERE record_id = ?").run(record.id);
    this.db.query(`
      INSERT INTO record_fts (record_id, collection_id, document) VALUES (?, ?, ?)
    `).run(record.id, record.collection_id, document);
  }

  listUnindexedRecords(): RecordEnvelope[] {
    const rows = this.db.query(`
      SELECT r.envelope_json AS json
      FROM records r
      LEFT JOIN tombstones t ON t.record_id = r.id
      LEFT JOIN record_fts f ON f.record_id = r.id
      WHERE t.record_id IS NULL AND f.record_id IS NULL
      ORDER BY r.rowid
    `).all() as JsonRow[];
    return rows.map((row) => parseFrozen<RecordEnvelope>(row.json));
  }

  removeRecord(recordId: string): void {
    this.db.query("DELETE FROM record_fts WHERE record_id = ?").run(recordId);
  }

  search(text: string, collections: string[] | undefined, limit: number, offset = 0): IndexCandidate[] {
    const query = toFtsQuery(text);
    if (!query) return [];
    const params: Array<string | number> = [query];
    const filters = ["record_fts MATCH ?"];
    if (collections?.length) {
      filters.push(`record_fts.collection_id IN (${collections.map(() => "?").join(",")})`);
      params.push(...collections);
    }
    params.push(limit, offset);
    const rows = this.db.query(`
      SELECT record_fts.record_id AS record_id, bm25(record_fts) AS rank
      FROM record_fts
      WHERE ${filters.join(" AND ")}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(...params) as Array<{ record_id: string; rank: number }>;
    return rows.map((row) => ({ record_id: row.record_id, score: Math.max(0, -row.rank) }));
  }

  close(): void {
    this.db.close(false);
  }

  private tightenFileModes(): void {
    if (!this.filesystemPath) return;
    chmodSync(this.filesystemPath, 0o600);
    for (const suffix of ["-wal", "-shm"]) {
      try {
        chmodSync(`${this.filesystemPath}${suffix}`, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

function parseFrozen<T>(json: string): T {
  return deepFreeze(JSON.parse(json) as T);
}

function toFtsQuery(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/["*:^(){}\[\]~+\-]/g, " ")
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `"${part}"`)
    .join(" AND ");
}
