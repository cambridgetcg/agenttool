import { Database } from "bun:sqlite";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { canonicalJson, domainSeparatedId } from "./canonical.js";
import { EVENT_HASH_DOMAIN, GENESIS_EVENT_HASH } from "./constants.js";
import { createReceiptEnvelope, validateReceiptBody } from "./contracts.js";
import { evaluateReceipts, assertForwardOrder } from "./evaluate.js";
import { ConstructiveError, fail } from "./errors.js";
import { assertReviewedPin } from "./tree.js";
import type {
  EvidencePin,
  EvidenceReceiptBody,
  EvidenceReport,
  Sha256Id,
  StoredReceipt,
  VerificationReport,
} from "./types.js";

interface PinRow {
  pin_id: Sha256Id;
  quest_id: string;
  as_of: string;
  pin_json: string;
}

interface ReceiptRow {
  pin_id: Sha256Id;
  sequence: number;
  evidence_id: Sha256Id;
  source_system: string;
  source_record_or_event_id: string;
  source_revision: string;
  receipt_json: string;
  previous_event_hash: Sha256Id;
  event_hash: Sha256Id;
}

type SourceRow = ReceiptRow;

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface SqliteObjectRow {
  name: string;
  sql: string | null;
}

export interface RecordResult {
  status: "inserted" | "existing";
  stored: StoredReceipt;
}

function normalizeSql(value: string | null): string {
  return (value ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
}

function tableSignature(rows: readonly TableInfoRow[]): string {
  return rows.map((row) =>
    [row.name, row.type, row.notnull, row.dflt_value ?? "null", row.pk].join(":"))
    .join("|");
}

function lstatIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path) as Stats;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail("file_error", `Cannot inspect ledger path: ${path}`);
  }
}

function assertTrustedParent(path: string): void {
  const parent = dirname(path);
  const status = lstatIfPresent(parent);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    status === null
    || !status.isDirectory()
    || status.isSymbolicLink()
    || (currentUid !== null && status.uid !== currentUid)
    || (status.mode & 0o022) !== 0
  ) {
    fail(
      "file_error",
      "Database parent must be an owned, non-symlink directory with no group/other write bits",
    );
  }
}

function secureRegularFile(path: string, create: boolean): void {
  const flags = constants.O_RDWR
    | constants.O_NOFOLLOW
    | (create ? constants.O_CREAT : 0);
  let descriptor: number;
  try {
    descriptor = openSync(path, flags, 0o600);
  } catch {
    fail("file_error", `Cannot securely open regular ledger file: ${path}`);
  }
  try {
    const opened = fstatSync(descriptor);
    const named = lstatIfPresent(path);
    if (
      named === null
      || !opened.isFile()
      || !named.isFile()
      || named.isSymbolicLink()
      || opened.dev !== named.dev
      || opened.ino !== named.ino
      || opened.nlink !== 1
      || named.nlink !== 1
    ) {
      fail("file_error", `Ledger path is not one stable, singly linked regular file: ${path}`);
    }
    fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }
}

export class ConstructiveStore {
  readonly db: Database;
  private readonly filesystemPath?: string;

  constructor(path: string, options: { create: boolean }) {
    if (path === ":memory:") {
      this.db = new Database(path, { create: true, strict: true });
      this.configure();
      return;
    }
    let requestedPath: string;
    try {
      requestedPath = resolve(path);
    } catch {
      fail("file_error", "Database path cannot be resolved");
    }
    if (options.create) {
      mkdirSync(dirname(requestedPath), { recursive: true, mode: 0o700 });
    }
    let parent: string;
    try {
      parent = realpathSync(dirname(requestedPath));
    } catch {
      fail("file_error", "Database parent directory does not exist");
    }
    this.filesystemPath = join(parent, basename(requestedPath));
    assertTrustedParent(this.filesystemPath);
    secureRegularFile(this.filesystemPath, options.create);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      if (lstatIfPresent(`${this.filesystemPath}${suffix}`) !== null) {
        secureRegularFile(`${this.filesystemPath}${suffix}`, false);
      }
    }
    this.db = new Database(this.filesystemPath, { create: options.create, strict: true });
    this.configure();
  }

  private configure(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (this.db.filename !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.tightenFileModes();
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pins (
        pin_id TEXT PRIMARY KEY,
        quest_id TEXT NOT NULL,
        as_of TEXT NOT NULL,
        pin_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS receipts (
        evidence_id TEXT PRIMARY KEY,
        pin_id TEXT NOT NULL REFERENCES pins(pin_id),
        sequence INTEGER NOT NULL,
        source_system TEXT NOT NULL,
        source_record_or_event_id TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        previous_event_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        UNIQUE(source_system, source_record_or_event_id, source_revision),
        UNIQUE(pin_id, sequence),
        UNIQUE(pin_id, event_hash)
      );
      CREATE INDEX IF NOT EXISTS receipts_pin_sequence_idx
        ON receipts(pin_id, sequence);
      CREATE TRIGGER IF NOT EXISTS pins_no_update
        BEFORE UPDATE ON pins BEGIN SELECT RAISE(ABORT, 'pins are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS pins_no_delete
        BEFORE DELETE ON pins BEGIN SELECT RAISE(ABORT, 'pins are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS receipts_no_update
        BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT, 'receipts are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS receipts_no_delete
        BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT, 'receipts are append-only'); END;
      PRAGMA user_version = 1;
    `);
    this.assertSchema();
    this.tightenFileModes();
  }

  private assertSchema(): void {
    const version = this.db.query("PRAGMA user_version").get() as {
      user_version: number;
    } | null;
    const foreignKeys = this.db.query("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    } | null;
    if (version?.user_version !== 1 || foreignKeys?.foreign_keys !== 1) {
      fail("integrity_error", "SQLite schema version or foreign-key enforcement is invalid");
    }
    if (this.filesystemPath) {
      const journal = this.db.query("PRAGMA journal_mode").get() as {
        journal_mode: string;
      } | null;
      if (journal?.journal_mode.toLowerCase() !== "wal") {
        fail("integrity_error", "SQLite file ledger must use WAL journal mode");
      }
    }

    const tables = this.db.query(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as SqliteObjectRow[];
    if (tables.map(({ name }) => name).join("\0") !== "pins\0receipts") {
      fail("integrity_error", "Ledger must contain exactly the pins and receipts tables");
    }

    const pinColumns = this.db.query("PRAGMA table_info(pins)").all() as TableInfoRow[];
    const receiptColumns = this.db.query("PRAGMA table_info(receipts)").all() as TableInfoRow[];
    if (
      tableSignature(pinColumns)
        !== "pin_id:TEXT:0:null:1|quest_id:TEXT:1:null:0|as_of:TEXT:1:null:0|pin_json:TEXT:1:null:0"
      || tableSignature(receiptColumns)
        !== "evidence_id:TEXT:0:null:1|pin_id:TEXT:1:null:0|sequence:INTEGER:1:null:0|source_system:TEXT:1:null:0|source_record_or_event_id:TEXT:1:null:0|source_revision:TEXT:1:null:0|receipt_json:TEXT:1:null:0|previous_event_hash:TEXT:1:null:0|event_hash:TEXT:1:null:0"
    ) {
      fail("integrity_error", "Ledger table columns or primary keys are not the v1 schema");
    }

    const indexSignatures = (table: "pins" | "receipts"): string[] =>
      (this.db.query(`PRAGMA index_list(${table})`).all() as IndexListRow[])
        .map((index) => {
          const columns = this.db.query(
            "SELECT name FROM pragma_index_info(?) ORDER BY seqno",
          ).all(index.name) as Array<{ name: string }>;
          return [
            index.unique,
            index.origin,
            index.partial,
            columns.map(({ name }) => name).join(","),
          ].join(":");
        })
        .sort();
    if (
      indexSignatures("pins").join("|") !== "1:pk:0:pin_id"
      || indexSignatures("receipts").join("|")
        !== [
          "0:c:0:pin_id,sequence",
          "1:pk:0:evidence_id",
          "1:u:0:pin_id,event_hash",
          "1:u:0:pin_id,sequence",
          "1:u:0:source_system,source_record_or_event_id,source_revision",
        ].sort().join("|")
    ) {
      fail("integrity_error", "Ledger uniqueness or lookup indexes are not the v1 schema");
    }

    const foreignKeyRows = this.db.query("PRAGMA foreign_key_list(receipts)").all() as Array<{
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
      match: string;
    }>;
    if (
      foreignKeyRows.length !== 1
      || foreignKeyRows[0]?.table !== "pins"
      || foreignKeyRows[0]?.from !== "pin_id"
      || foreignKeyRows[0]?.to !== "pin_id"
      || foreignKeyRows[0]?.on_update !== "NO ACTION"
      || foreignKeyRows[0]?.on_delete !== "NO ACTION"
      || foreignKeyRows[0]?.match !== "NONE"
    ) {
      fail("integrity_error", "Receipt-to-pin foreign key is not the v1 schema");
    }

    const expectedTriggers = new Map<string, string>([
      [
        "pins_no_delete",
        "create trigger pins_no_delete before delete on pins begin select raise(abort, 'pins are append-only'); end",
      ],
      [
        "pins_no_update",
        "create trigger pins_no_update before update on pins begin select raise(abort, 'pins are append-only'); end",
      ],
      [
        "receipts_no_delete",
        "create trigger receipts_no_delete before delete on receipts begin select raise(abort, 'receipts are append-only'); end",
      ],
      [
        "receipts_no_update",
        "create trigger receipts_no_update before update on receipts begin select raise(abort, 'receipts are append-only'); end",
      ],
    ]);
    const triggers = this.db.query(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    ).all() as SqliteObjectRow[];
    if (
      triggers.length !== expectedTriggers.size
      || triggers.some(({ name, sql }) =>
        normalizeSql(sql) !== expectedTriggers.get(name))
    ) {
      fail("integrity_error", "Append-only trigger definitions are not the v1 schema");
    }
  }

  putPin(pin: EvidencePin): "inserted" | "existing" {
    assertReviewedPin(pin);
    this.tightenFileModes();
    this.verify();
    const json = canonicalJson(pin);
    const existing = this.db.query("SELECT pin_id, quest_id, as_of, pin_json FROM pins WHERE pin_id = ?")
      .get(pin.pin_id) as PinRow | null;
    if (existing) {
      if (existing.pin_json !== json) fail("conflict", "Pin ID already exists with different bytes");
      return "existing";
    }
    this.db.query("INSERT INTO pins (pin_id, quest_id, as_of, pin_json) VALUES (?, ?, ?, ?)")
      .run(pin.pin_id, pin.quest_id, pin.as_of, json);
    this.tightenFileModes();
    return "inserted";
  }

  getPin(pinId: string): EvidencePin | null {
    const row = this.db.query("SELECT pin_id, quest_id, as_of, pin_json FROM pins WHERE pin_id = ?")
      .get(pinId) as PinRow | null;
    if (!row) return null;
    return JSON.parse(row.pin_json) as EvidencePin;
  }

  listPins(): EvidencePin[] {
    return (this.db.query("SELECT pin_id, quest_id, as_of, pin_json FROM pins ORDER BY pin_id")
      .all() as PinRow[])
      .map((row) => JSON.parse(row.pin_json) as EvidencePin);
  }

  record(input: unknown, artifactDigest?: Sha256Id): RecordResult {
    const untrusted = input as { pin_id?: unknown };
    if (typeof untrusted?.pin_id !== "string") fail("receipt_error", "pin_id is required");
    const pin = this.getPin(untrusted.pin_id);
    if (!pin) fail("not_found", "Receipt pin_id was not initialized in this database");
    assertReviewedPin(pin);
    this.tightenFileModes();
    this.verify();
    const body = validateReceiptBody(input, pin);
    if (artifactDigest !== undefined && artifactDigest !== body.artifact_digest) {
      fail("receipt_error", "Local artifact bytes do not match artifact_digest");
    }
    const envelope = createReceiptEnvelope(body);
    const json = canonicalJson(body);

    const append = this.db.transaction((): RecordResult => {
      const source = this.findSource(body);
      if (source) {
        if (source.evidence_id !== envelope.evidence_id || source.receipt_json !== json) {
          fail("conflict", "Global source event was already consumed by different receipt bytes");
        }
        return { status: "existing", stored: rowToStored(source) };
      }
      const sameId = this.db.query(`
        SELECT pin_id, sequence, evidence_id,
          source_system, source_record_or_event_id, source_revision,
          receipt_json, previous_event_hash, event_hash
        FROM receipts WHERE evidence_id = ?
      `).get(envelope.evidence_id) as ReceiptRow | null;
      if (sameId) {
        if (sameId.receipt_json !== json) fail("conflict", "Evidence ID collision");
        return { status: "existing", stored: rowToStored(sameId) };
      }
      const existing = this.listReceiptRows(pin.pin_id).map(rowToStored);
      if (body.supersedes !== null) {
        const superseded = existing.find(({ evidence_id }) => evidence_id === body.supersedes);
        if (!superseded) {
          fail("receipt_error", "supersedes must reference an earlier receipt in the same ledger");
        }
        if (
          superseded.receipt.evidence_level_and_scope.level
            !== body.evidence_level_and_scope.level
          || superseded.receipt.deliverable_key !== body.deliverable_key
        ) {
          fail("receipt_error", "supersedes must preserve evidence level and deliverable identity");
        }
        if (existing.some(({ receipt }) => receipt.supersedes === body.supersedes)) {
          fail("conflict", "A receipt can have only one direct superseding successor");
        }
      }
      if (body.supersedes === null) {
        try {
          assertForwardOrder(existing, body.evidence_level_and_scope.level, pin);
        } catch (error) {
          fail("ordering_error", error instanceof Error ? error.message : "Evidence order is invalid");
        }
      }
      const last = existing.at(-1);
      const sequence = (last?.sequence ?? 0) + 1;
      const previous = last?.event_hash ?? GENESIS_EVENT_HASH;
      const eventHash = computeEventHash(pin.pin_id, sequence, previous, envelope.evidence_id);
      this.db.query(`
        INSERT INTO receipts (
          evidence_id, pin_id, sequence,
          source_system, source_record_or_event_id, source_revision,
          receipt_json, previous_event_hash, event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        envelope.evidence_id,
        pin.pin_id,
        sequence,
        body.source_system,
        body.source_record_or_event_id,
        body.source_revision,
        json,
        previous,
        eventHash,
      );
      return {
        status: "inserted",
        stored: {
          ...envelope,
          sequence,
          previous_event_hash: previous,
          event_hash: eventHash,
        },
      };
    });

    try {
      const result = append.immediate();
      this.tightenFileModes();
      return result;
    } catch (error) {
      if (error instanceof ConstructiveError) throw error;
      const afterRace = this.findSource(body);
      if (afterRace) {
        if (afterRace.evidence_id === envelope.evidence_id && afterRace.receipt_json === json) {
          return { status: "existing", stored: rowToStored(afterRace) };
        }
        fail("conflict", "Global source event was concurrently consumed by different bytes");
      }
      throw error;
    }
  }

  private findSource(body: EvidenceReceiptBody): SourceRow | null {
    return this.db.query(`
      SELECT pin_id, sequence, evidence_id, receipt_json, previous_event_hash, event_hash
        , source_system, source_record_or_event_id, source_revision
      FROM receipts
      WHERE source_system = ?
        AND source_record_or_event_id = ?
        AND source_revision = ?
    `).get(
      body.source_system,
      body.source_record_or_event_id,
      body.source_revision,
    ) as SourceRow | null;
  }

  getReceipt(evidenceId: string): StoredReceipt | null {
    this.verify();
    const row = this.db.query(`
      SELECT pin_id, sequence, evidence_id,
        source_system, source_record_or_event_id, source_revision,
        receipt_json, previous_event_hash, event_hash
      FROM receipts WHERE evidence_id = ?
    `).get(evidenceId) as ReceiptRow | null;
    return row ? rowToStored(row) : null;
  }

  listReceipts(pinId: string): StoredReceipt[] {
    this.verify();
    return this.listReceiptRows(pinId).map(rowToStored);
  }

  private listReceiptRows(pinId: string): ReceiptRow[] {
    return this.db.query(`
      SELECT pin_id, sequence, evidence_id,
        source_system, source_record_or_event_id, source_revision,
        receipt_json, previous_event_hash, event_hash
      FROM receipts WHERE pin_id = ? ORDER BY sequence
    `).all(pinId) as ReceiptRow[];
  }

  report(pinId: string): EvidenceReport {
    this.verify();
    const pin = this.getPin(pinId);
    if (!pin) fail("not_found", "Pin was not found");
    assertReviewedPin(pin);
    return evaluateReceipts(pin, this.listReceiptRows(pinId).map(rowToStored));
  }

  exportAll(): { pins: EvidencePin[]; receipts: StoredReceipt[]; structural_only: true } {
    this.verify();
    const pins = this.listPins();
    const receipts = pins.flatMap((pin) =>
      this.listReceiptRows(pin.pin_id).map(rowToStored));
    return { pins, receipts, structural_only: true };
  }

  verify(): VerificationReport {
    this.assertSchema();
    const integrity = this.db.query("PRAGMA integrity_check").get() as {
      integrity_check: string;
    } | null;
    if (integrity?.integrity_check !== "ok") fail("integrity_error", "SQLite integrity_check failed");
    const foreignKeyViolations = this.db.query("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length !== 0) {
      fail("integrity_error", "SQLite foreign-key verification failed");
    }
    const duplicateSource = this.db.query(`
      SELECT 1 AS duplicate
      FROM receipts
      GROUP BY source_system, source_record_or_event_id, source_revision
      HAVING COUNT(*) > 1
      LIMIT 1
    `).get();
    if (duplicateSource) fail("integrity_error", "Global source-event uniqueness does not verify");

    const pinRows = this.db.query(
      "SELECT pin_id, quest_id, as_of, pin_json FROM pins ORDER BY pin_id",
    ).all() as PinRow[];
    let receiptCount = 0;
    for (const pinRow of pinRows) {
      const pin = JSON.parse(pinRow.pin_json) as EvidencePin;
      assertReviewedPin(pin);
      if (
        canonicalJson(pin) !== pinRow.pin_json
        || pin.pin_id !== pinRow.pin_id
        || pin.quest_id !== pinRow.quest_id
        || pin.as_of !== pinRow.as_of
      ) {
        fail("integrity_error", "Stored pin columns or JSON do not agree");
      }
      const rows = this.listReceiptRows(pin.pin_id);
      let previous: Sha256Id = GENESIS_EVENT_HASH;
      const priorReceipts: StoredReceipt[] = [];
      const priorById = new Map<Sha256Id, StoredReceipt>();
      const superseded = new Set<Sha256Id>();
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] as ReceiptRow;
        const stored = rowToStored(row);
        const body = validateReceiptBody(stored.receipt, pin);
        const expectedEnvelope = createReceiptEnvelope(body);
        if (
          canonicalJson(body) !== row.receipt_json
          || row.pin_id !== body.pin_id
          || row.source_system !== body.source_system
          || row.source_record_or_event_id !== body.source_record_or_event_id
          || row.source_revision !== body.source_revision
          || stored.sequence !== index + 1
          || stored.evidence_id !== expectedEnvelope.evidence_id
          || stored.previous_event_hash !== previous
          || stored.event_hash !== computeEventHash(
            pin.pin_id,
            stored.sequence,
            previous,
            stored.evidence_id,
          )
        ) {
          fail("integrity_error", "Receipt content ID or event hash chain does not verify");
        }
        if (body.supersedes !== null) {
          const target = priorById.get(body.supersedes);
          if (
            !target
            || superseded.has(body.supersedes)
          ) {
            fail("integrity_error", "Receipt supersession lineage is invalid");
          }
          const targetBody = target.receipt;
          if (
            targetBody.pin_id !== body.pin_id
            || targetBody.evidence_level_and_scope.level
              !== body.evidence_level_and_scope.level
            || targetBody.deliverable_key !== body.deliverable_key
          ) {
            fail("integrity_error", "Receipt supersession changes ledger, level, or deliverable");
          }
          superseded.add(body.supersedes);
        } else {
          try {
            assertForwardOrder(
              priorReceipts,
              body.evidence_level_and_scope.level,
              pin,
            );
          } catch {
            fail("integrity_error", "Receipt evidence-level ordering does not verify");
          }
        }
        priorReceipts.push(stored);
        priorById.set(stored.evidence_id, stored);
        previous = stored.event_hash;
        receiptCount += 1;
      }
    }
    const total = this.db.query("SELECT COUNT(*) AS count FROM receipts").get() as {
      count: number;
    } | null;
    if (total?.count !== receiptCount) {
      fail("integrity_error", "Orphan or unverified receipt rows remain outside known ledgers");
    }
    const fileModesOk = this.fileModesArePrivate();
    if (!fileModesOk) fail("integrity_error", "Database, WAL, or SHM mode is not 0600");
    return {
      ok: true,
      pin_count: pinRows.length,
      receipt_count: receiptCount,
      checked_event_chains: pinRows.length,
      file_modes_ok: true,
      structural_only: true,
    };
  }

  close(): void {
    this.tightenFileModes();
    this.db.close(false);
    this.tightenFileModes();
  }

  private fileModesArePrivate(): boolean {
    if (!this.filesystemPath) return true;
    assertTrustedParent(this.filesystemPath);
    return [
      this.filesystemPath,
      `${this.filesystemPath}-wal`,
      `${this.filesystemPath}-shm`,
      `${this.filesystemPath}-journal`,
    ]
      .map((path) => lstatIfPresent(path))
      .filter((status) => status !== null)
      .every((status) =>
        status.isFile()
        && !status.isSymbolicLink()
        && status.nlink === 1
        && (status.mode & 0o777) === 0o600);
  }

  private tightenFileModes(): void {
    if (!this.filesystemPath) return;
    assertTrustedParent(this.filesystemPath);
    for (const path of [
      this.filesystemPath,
      `${this.filesystemPath}-wal`,
      `${this.filesystemPath}-shm`,
      `${this.filesystemPath}-journal`,
    ]) {
      if (lstatIfPresent(path) !== null) secureRegularFile(path, false);
    }
  }
}

function computeEventHash(
  pinId: Sha256Id,
  sequence: number,
  previousEventHash: Sha256Id,
  evidenceId: Sha256Id,
): Sha256Id {
  return domainSeparatedId(EVENT_HASH_DOMAIN, {
    pin_id: pinId,
    sequence,
    previous_event_hash: previousEventHash,
    evidence_id: evidenceId,
  });
}

function rowToStored(row: ReceiptRow): StoredReceipt {
  const receipt = JSON.parse(row.receipt_json) as EvidenceReceiptBody;
  return {
    evidence_id: row.evidence_id,
    receipt,
    sequence: row.sequence,
    previous_event_hash: row.previous_event_hash,
    event_hash: row.event_hash,
  };
}
