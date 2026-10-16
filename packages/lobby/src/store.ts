/** lobby.sqlite: the local hall, the private ledger, the pin book and the
 * append-only audit log of consequential acts.
 *
 * Contract: packages/lobby/README.md. Consequential acts are two-step: a
 * `plan*` call builds the exact canonical bytes to show on /dev/tty, and the
 * matching `apply*` call commits those same bytes with an audit entry in one
 * transaction, after re-checking that nothing changed since the preview.
 * No method here performs I/O beyond this local SQLite file.
 */
import { Database } from "bun:sqlite";
import { isAbsolute, normalize } from "node:path";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { LobbyError } from "./errors.js";
import { existingPrivateDatabase, preparePrivateHome } from "./home.js";
import {
  assertDid,
  assertFingerprint,
  assertKid,
  newPinRecord,
  type PinInput,
  type PinRecord,
} from "./pins.js";
import {
  assertRoomId,
  mentionsDeviceOnlyWork,
  newRoomCard,
  promotedCard,
  ROOM_STATUSES,
  validateRoomCard,
  type Door,
  type NewRoomInput,
  type PromotionChange,
  type RandomBytes,
  type RoomCard,
  type RoomStatus,
  type SlotTier,
} from "./room.js";
import { codePointLength, TERMINAL_UNSAFE } from "./text.js";
import { FLEET_SCHEMA_SQL, FleetStore } from "./fleet-store.js";

/** Version 2 adds the fleet-hall tables (src/fleet-store.ts). A version-1
 * file is upgraded explicitly when the CLI opens it for writing; the
 * read-only MCP handle reads version 1 as "no fleet state yet". */
export const STATE_SCHEMA_VERSION = "2";
const READABLE_VERSIONS = ["1", "2"] as const;
export const ACT_SCHEMA = "agenttool-lobby-act/v1" as const;
const GENESIS_HASH = "0".repeat(64);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS rooms (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL UNIQUE
    CHECK (length(room_id) = 37 AND substr(room_id, 1, 5) = 'room_'
      AND substr(room_id, 6) NOT GLOB '*[^0-9a-f]*'),
  card TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recruiting', 'in_play', 'resting', 'closed')),
  door TEXT NOT NULL CHECK (door IN ('invite', 'knock')),
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
  residency TEXT NOT NULL CHECK (residency IN ('device', 'fleet', 'open')),
  hostable INTEGER NOT NULL CHECK (hostable IN (0, 1)),
  device_pinned INTEGER NOT NULL CHECK (device_pinned IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (residency <> 'device' OR (hostable = 0 AND visibility = 'private')),
  CHECK (visibility = 'private' OR residency = 'open'),
  CHECK (device_pinned = 0 OR residency = 'device')
) STRICT;

CREATE TRIGGER IF NOT EXISTS rooms_device_pin_is_sticky
BEFORE UPDATE OF device_pinned ON rooms
WHEN OLD.device_pinned = 1 AND NEW.device_pinned <> 1
BEGIN
  SELECT RAISE(ABORT, 'device_pin_is_sticky');
END;

CREATE TRIGGER IF NOT EXISTS rooms_are_not_deleted
BEFORE DELETE ON rooms
BEGIN
  SELECT RAISE(ABORT, 'rooms_close_rather_than_delete');
END;

CREATE TABLE IF NOT EXISTS ledger (
  room_id TEXT PRIMARY KEY REFERENCES rooms(room_id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('workspace', 'path', 'none')),
  target TEXT NOT NULL,
  linked_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS pins (
  did TEXT NOT NULL,
  kid TEXT NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  petname TEXT NOT NULL,
  how_obtained TEXT NOT NULL,
  pinned_at TEXT NOT NULL,
  PRIMARY KEY (did, kid)
) STRICT;

CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  act TEXT NOT NULL,
  subject TEXT NOT NULL,
  bytes TEXT NOT NULL,
  bytes_sha256 TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS audit_rows_are_not_updated
BEFORE UPDATE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit_is_append_only');
END;

CREATE TRIGGER IF NOT EXISTS audit_rows_are_not_deleted
BEFORE DELETE ON audit
BEGIN
  SELECT RAISE(ABORT, 'audit_is_append_only');
END;
`;

export interface RoomFilter {
  tag?: string;
  status?: RoomStatus;
  door?: Door;
  tier?: SlotTier;
}

export type LedgerTargetKind = "workspace" | "path" | "none";

export interface LedgerEntry {
  room_id: string;
  target_kind: LedgerTargetKind;
  target: string;
  linked_at: string;
}

export interface AuditEntry {
  seq: number;
  at: string;
  act: string;
  subject: string;
  bytes: string;
  bytes_sha256: string;
  prev_hash: string;
  hash: string;
}

/** What the terminal shows and the audit log keeps, byte for byte. */
export interface ActPreview {
  act: string;
  subject: string;
  at: string;
  summary: string[];
  bytes: string;
  sha256: string;
}

export interface PromotionPlan extends ActPreview {
  act: "room.promote";
  before: RoomCard;
  after: RoomCard;
}

export interface PinAddPlan extends ActPreview {
  act: "pin.add";
  pin: PinRecord;
}

export interface PinRemovePlan extends ActPreview {
  act: "pin.remove";
  pin: PinRecord;
}

export type PinSelector = { fingerprint: string } | { did: string; kid: string };

interface RoomRow {
  card: string;
  device_pinned: number;
}

interface PinRow {
  did: string;
  kid: string;
  public_key: string;
  fingerprint: string;
  petname: string;
  how_obtained: string;
  pinned_at: string;
}

const COLLAB_WORKSPACE_ID = /^ws_[0-9a-f]{24}$/;

/** Classify a private-ledger target: a Collab workspace id, an absolute
 * local path, or the literal "none". Relative paths and "~" are refused. */
export function parseLedgerTarget(value: unknown): { kind: LedgerTargetKind; target: string } {
  if (value === "none") return { kind: "none", target: "none" };
  if (typeof value === "string" && COLLAB_WORKSPACE_ID.test(value)) {
    return { kind: "workspace", target: value };
  }
  if (
    typeof value === "string"
    && isAbsolute(value)
    && !value.includes("\0")
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    && !TERMINAL_UNSAFE.test(value)
    && codePointLength(value) <= 4096
  ) {
    return { kind: "path", target: normalize(value) };
  }
  throw new LobbyError(
    "invalid_ledger_target",
    "a ledger target is a ws_ workspace id, an absolute path, or the literal none",
  );
}

function roomMatches(card: RoomCard, filter: RoomFilter): boolean {
  if (filter.tag !== undefined && !card.tags.includes(filter.tag)) return false;
  if (filter.status !== undefined && card.status !== filter.status) return false;
  if (filter.door !== undefined && card.door !== filter.door) return false;
  if (filter.tier !== undefined && !card.slots.some((slot) => slot.tier === filter.tier && slot.count > 0)) {
    return false;
  }
  return true;
}

function residencyTriple(card: RoomCard) {
  return { hostable: card.hostable, residency: card.residency, visibility: card.visibility };
}

export class LobbyStore {
  /** Fleet-hall tables on the same handle (src/fleet-store.ts). */
  readonly fleet: FleetStore;

  private constructor(
    private readonly db: Database,
    readonly readonly: boolean,
    readonly stateVersion: string,
  ) {
    this.fleet = new FleetStore(db, !readonly, stateVersion === STATE_SCHEMA_VERSION);
  }

  /** Open (creating if needed) the desk state for read and write. */
  static open(home: string): LobbyStore {
    const path = preparePrivateHome(home);
    const db = new Database(path, { create: false, readwrite: true, strict: true });
    try {
      db.exec("PRAGMA busy_timeout = 2000");
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA journal_mode = DELETE");
      db.exec("PRAGMA secure_delete = ON");
      db.transaction(() => {
        db.exec(SCHEMA_SQL);
        const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as
          | { value: string }
          | null;
        if (row === null) {
          db.query("INSERT INTO meta (key, value) VALUES ('schema_version', $value)")
            .run({ value: STATE_SCHEMA_VERSION });
        } else if (row.value === "1") {
          // Explicit upgrade 1 -> 2: add the fleet tables; nothing existing changes.
          db.query("UPDATE meta SET value = $value WHERE key = 'schema_version'").run({ value: STATE_SCHEMA_VERSION });
        } else if (row.value !== STATE_SCHEMA_VERSION) {
          throw new LobbyError("unsupported_state_version", "lobby.sqlite was written by another desk version");
        }
        db.exec(FLEET_SCHEMA_SQL);
      }).immediate();
    } catch (error) {
      db.close();
      throw error;
    }
    return new LobbyStore(db, false, STATE_SCHEMA_VERSION);
  }

  /** Read-only view for the MCP server. Creates nothing; null when absent. */
  static openReadOnly(home: string): LobbyStore | null {
    const path = existingPrivateDatabase(home);
    if (path === null) return null;
    const db = new Database(path, { readonly: true, strict: true });
    try {
      db.exec("PRAGMA busy_timeout = 2000");
      db.exec("PRAGMA query_only = ON");
      const hasMeta = db.query(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
      ).get();
      if (hasMeta === null) {
        db.close();
        return null;
      }
      const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as
        | { value: string }
        | null;
      if (row === null || !(READABLE_VERSIONS as readonly string[]).includes(row.value)) {
        throw new LobbyError("unsupported_state_version", "lobby.sqlite was written by another desk version");
      }
      return new LobbyStore(db, true, row.value);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private requireWritable(): void {
    if (this.readonly) throw new LobbyError("read_only", "this desk view is read-only");
  }

  // ── Rooms ────────────────────────────────────────────────────────────

  addRoom(input: NewRoomInput, now = new Date(), random?: RandomBytes): RoomCard {
    this.requireWritable();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const card = newRoomCard(input, now, random);
      const pinned = mentionsDeviceOnlyWork(card) ? 1 : 0;
      try {
        this.db.query(
          `INSERT INTO rooms (room_id, card, status, door, visibility, residency, hostable,
             device_pinned, created_at, updated_at)
           VALUES ($room_id, $card, $status, $door, $visibility, $residency, $hostable,
             $device_pinned, $created_at, $updated_at)`,
        ).run({
          room_id: card.room_id,
          card: canonicalJson(card),
          status: card.status,
          door: card.door,
          visibility: card.visibility,
          residency: card.residency,
          hostable: card.hostable ? 1 : 0,
          device_pinned: pinned,
          created_at: card.created_at,
          updated_at: card.updated_at,
        });
        return card;
      } catch (error) {
        if (String(error).includes("UNIQUE") && attempt < 2) continue;
        throw error;
      }
    }
    throw new LobbyError("room_id_collision", "could not mint a fresh room id");
  }

  countRooms(): number {
    const row = this.db.query("SELECT count(*) AS n FROM rooms").get() as { n: number };
    return row.n;
  }

  /** Exact filters, no ranking; order is created_at, then room_id. */
  listRooms(filter: RoomFilter = {}): RoomCard[] {
    const rows = this.db.query("SELECT card, device_pinned FROM rooms ORDER BY created_at ASC, room_id ASC")
      .all() as RoomRow[];
    return rows.map((row) => this.parseRow(row)).filter((card) => roomMatches(card, filter));
  }

  getRoom(roomId: string): RoomCard | null {
    const row = this.roomRow(assertRoomId(roomId));
    return row === null ? null : this.parseRow(row);
  }

  /** True when the room is pinned to this device (sticky once set). */
  isDevicePinned(roomId: string): boolean {
    const row = this.roomRow(assertRoomId(roomId));
    if (row === null) throw new LobbyError("room_not_found", "no such room in the local hall");
    return row.device_pinned === 1 || mentionsDeviceOnlyWork(this.parseRow(row));
  }

  setStatus(roomId: string, status: RoomStatus, now = new Date()): RoomCard {
    this.requireWritable();
    if (!(ROOM_STATUSES as readonly string[]).includes(status)) {
      throw new LobbyError("invalid_status", `status must be one of: ${ROOM_STATUSES.join(", ")}`);
    }
    return this.db.transaction(() => {
      const current = this.requireRoom(roomId);
      if (current.status === status) return current;
      const next = validateRoomCard({ ...current, status, updated_at: now.toISOString() });
      this.writeRoom(next);
      return next;
    }).immediate();
  }

  private roomRow(roomId: string): RoomRow | null {
    return this.db.query("SELECT card, device_pinned FROM rooms WHERE room_id = $room_id")
      .get({ room_id: roomId }) as RoomRow | null;
  }

  private parseRow(row: RoomRow): RoomCard {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.card);
    } catch {
      throw new LobbyError("state_corrupt", "a stored room card is not valid JSON");
    }
    const card = validateRoomCard(parsed);
    if (row.device_pinned === 1 && card.residency !== "device") {
      throw new LobbyError("state_corrupt", "a device-pinned room left the device");
    }
    return card;
  }

  private requireRoom(roomId: string): RoomCard {
    const card = this.getRoom(roomId);
    if (card === null) throw new LobbyError("room_not_found", "no such room in the local hall");
    return card;
  }

  private writeRoom(card: RoomCard): void {
    const pinned = mentionsDeviceOnlyWork(card) ? 1 : 0;
    this.db.query(
      `UPDATE rooms SET card = $card, status = $status, door = $door, visibility = $visibility,
         residency = $residency, hostable = $hostable,
         device_pinned = max(device_pinned, $device_pinned), updated_at = $updated_at
       WHERE room_id = $room_id`,
    ).run({
      room_id: card.room_id,
      card: canonicalJson(card),
      status: card.status,
      door: card.door,
      visibility: card.visibility,
      residency: card.residency,
      hostable: card.hostable ? 1 : 0,
      device_pinned: pinned,
      updated_at: card.updated_at,
    });
  }

  // ── Private ledger (never exported by any MCP tool) ─────────────────

  link(roomId: string, targetInput: string, now = new Date()): LedgerEntry {
    this.requireWritable();
    const { kind, target } = parseLedgerTarget(targetInput);
    return this.db.transaction(() => {
      this.requireRoom(roomId);
      const entry: LedgerEntry = {
        room_id: roomId,
        target_kind: kind,
        target,
        linked_at: now.toISOString(),
      };
      this.db.query(
        `INSERT INTO ledger (room_id, target_kind, target, linked_at)
         VALUES ($room_id, $target_kind, $target, $linked_at)
         ON CONFLICT (room_id) DO UPDATE SET target_kind = excluded.target_kind,
           target = excluded.target, linked_at = excluded.linked_at`,
      ).run({ ...entry });
      return entry;
    }).immediate();
  }

  getLink(roomId: string): LedgerEntry | null {
    return this.db.query(
      "SELECT room_id, target_kind, target, linked_at FROM ledger WHERE room_id = $room_id",
    ).get({ room_id: assertRoomId(roomId) }) as LedgerEntry | null;
  }

  // ── Consequential: promotion ────────────────────────────────────────

  planPromotion(roomId: string, change: PromotionChange, now = new Date()): PromotionPlan {
    const before = this.requireRoom(roomId);
    if (this.isDevicePinned(roomId)) {
      throw new LobbyError("device_pinned", "this room is pinned to this device and can never be promoted");
    }
    const at = now.toISOString();
    const after = promotedCard(before, change, at);
    const record = {
      schema: ACT_SCHEMA,
      act: "room.promote",
      at,
      room_id: roomId,
      before: residencyTriple(before),
      after: residencyTriple(after),
      card: after,
    };
    const bytes = canonicalJson(record);
    return {
      act: "room.promote",
      subject: roomId,
      at,
      summary: [
        `room ${roomId}`,
        `residency ${before.residency} -> ${after.residency}`,
        `visibility ${before.visibility} -> ${after.visibility}`,
        `hostable ${before.hostable} -> ${after.hostable}`,
      ],
      bytes,
      sha256: sha256Hex(bytes),
      before,
      after,
    };
  }

  applyPromotion(plan: PromotionPlan): RoomCard {
    this.requireWritable();
    this.assertPlanBytes(plan, {
      schema: ACT_SCHEMA,
      act: "room.promote",
      at: plan.at,
      room_id: plan.subject,
      before: residencyTriple(plan.before),
      after: residencyTriple(plan.after),
      card: plan.after,
    });
    return this.db.transaction(() => {
      const current = this.requireRoom(plan.subject);
      if (canonicalJson(current) !== canonicalJson(plan.before)) {
        throw new LobbyError("changed_since_preview", "the room changed after the preview; nothing was written");
      }
      if (this.isDevicePinned(plan.subject)) {
        throw new LobbyError("device_pinned", "this room is pinned to this device and can never be promoted");
      }
      const after = validateRoomCard(plan.after);
      this.writeRoom(after);
      this.appendAudit(plan);
      return after;
    }).immediate();
  }

  // ── Consequential: pin book ─────────────────────────────────────────

  listPins(): PinRecord[] {
    return this.db.query(
      `SELECT did, kid, public_key, fingerprint, petname, how_obtained, pinned_at
       FROM pins ORDER BY fingerprint ASC`,
    ).all() as PinRow[];
  }

  findPin(selector: PinSelector): PinRecord | null {
    if ("fingerprint" in selector) {
      return this.db.query(
        `SELECT did, kid, public_key, fingerprint, petname, how_obtained, pinned_at
         FROM pins WHERE fingerprint = $fingerprint`,
      ).get({ fingerprint: assertFingerprint(selector.fingerprint) }) as PinRow | null;
    }
    return this.db.query(
      `SELECT did, kid, public_key, fingerprint, petname, how_obtained, pinned_at
       FROM pins WHERE did = $did AND kid = $kid`,
    ).get({ did: assertDid(selector.did), kid: assertKid(selector.kid) }) as PinRow | null;
  }

  planPinAdd(input: PinInput, now = new Date()): PinAddPlan {
    const at = now.toISOString();
    const pin = newPinRecord(input, at);
    if (this.findPin({ did: pin.did, kid: pin.kid }) !== null) {
      throw new LobbyError("pin_exists", "this did and kid are already pinned; remove the old pin first");
    }
    if (this.findPin({ fingerprint: pin.fingerprint }) !== null) {
      throw new LobbyError("fingerprint_exists", "this public key is already pinned under another did or kid");
    }
    const bytes = canonicalJson({ schema: ACT_SCHEMA, act: "pin.add", at, pin });
    return {
      act: "pin.add",
      subject: pin.fingerprint,
      at,
      summary: [
        `fingerprint ${pin.fingerprint}`,
        `did ${pin.did}`,
        `kid ${pin.kid}`,
        `petname ${JSON.stringify(pin.petname)} (your label, not proof of anything)`,
        `obtained ${JSON.stringify(pin.how_obtained)}`,
      ],
      bytes,
      sha256: sha256Hex(bytes),
      pin,
    };
  }

  applyPinAdd(plan: PinAddPlan): PinRecord {
    this.requireWritable();
    this.assertPlanBytes(plan, { schema: ACT_SCHEMA, act: "pin.add", at: plan.at, pin: plan.pin });
    return this.db.transaction(() => {
      try {
        this.db.query(
          `INSERT INTO pins (did, kid, public_key, fingerprint, petname, how_obtained, pinned_at)
           VALUES ($did, $kid, $public_key, $fingerprint, $petname, $how_obtained, $pinned_at)`,
        ).run({ ...plan.pin });
      } catch (error) {
        if (String(error).includes("UNIQUE")) {
          throw new LobbyError("pin_exists", "a matching pin appeared after the preview; nothing was written");
        }
        throw error;
      }
      this.appendAudit(plan);
      return plan.pin;
    }).immediate();
  }

  /** Pin a key as one step of a larger act the person already confirmed
   * (fleet join pins the door key); that act's bytes are its audit entry. */
  insertPinWithinAct(pin: PinRecord): void {
    this.requireWritable();
    if (this.findPin({ did: pin.did, kid: pin.kid }) !== null || this.findPin({ fingerprint: pin.fingerprint }) !== null) {
      throw new LobbyError("pin_exists", "this key or did and kid is already pinned");
    }
    this.db.query(
      `INSERT INTO pins (did, kid, public_key, fingerprint, petname, how_obtained, pinned_at)
       VALUES ($did, $kid, $public_key, $fingerprint, $petname, $how_obtained, $pinned_at)`,
    ).run({ ...pin });
  }

  planPinRemove(selector: PinSelector, now = new Date()): PinRemovePlan {
    const pin = this.findPin(selector);
    if (pin === null) throw new LobbyError("pin_not_found", "no such pin in the pin book");
    const at = now.toISOString();
    const bytes = canonicalJson({ schema: ACT_SCHEMA, act: "pin.remove", at, pin });
    return {
      act: "pin.remove",
      subject: pin.fingerprint,
      at,
      summary: [
        `fingerprint ${pin.fingerprint}`,
        `did ${pin.did}`,
        `kid ${pin.kid}`,
        `petname ${JSON.stringify(pin.petname)}`,
      ],
      bytes,
      sha256: sha256Hex(bytes),
      pin: { ...pin },
    };
  }

  applyPinRemove(plan: PinRemovePlan): void {
    this.requireWritable();
    this.assertPlanBytes(plan, { schema: ACT_SCHEMA, act: "pin.remove", at: plan.at, pin: plan.pin });
    this.db.transaction(() => {
      const current = this.findPin({ fingerprint: plan.pin.fingerprint });
      if (current === null || canonicalJson(current) !== canonicalJson(plan.pin)) {
        throw new LobbyError("changed_since_preview", "the pin changed after the preview; nothing was written");
      }
      this.db.query("DELETE FROM pins WHERE fingerprint = $fingerprint").run({ fingerprint: plan.pin.fingerprint });
      this.appendAudit(plan);
    }).immediate();
  }

  // ── Audit log ───────────────────────────────────────────────────────

  listAudit(): AuditEntry[] {
    return this.db.query(
      "SELECT seq, at, act, subject, bytes, bytes_sha256, prev_hash, hash FROM audit ORDER BY seq ASC",
    ).all() as AuditEntry[];
  }

  /** Recompute the hash chain. Tamper-evident only against partial edits:
   * anyone who can rewrite the whole file can rewrite the whole chain. */
  verifyAudit(): { ok: boolean; entries: number; first_bad_seq: number | null } {
    let previous = GENESIS_HASH;
    const entries = this.listAudit();
    for (const entry of entries) {
      const expected = auditHash(previous, entry.at, entry.act, entry.subject, sha256Hex(entry.bytes));
      if (entry.prev_hash !== previous || entry.bytes_sha256 !== sha256Hex(entry.bytes) || entry.hash !== expected) {
        return { ok: false, entries: entries.length, first_bad_seq: entry.seq };
      }
      previous = entry.hash;
    }
    return { ok: true, entries: entries.length, first_bad_seq: null };
  }

  /** Append one act's exact bytes to the audit chain on its own. Fleet acts
   * call this right after the terminal confirmation and before any network
   * effect, so the log keeps what the person confirmed even if the network
   * step then fails or is uncertain. */
  recordAct(plan: ActPreview): void {
    this.requireWritable();
    this.db.transaction(() => this.appendAudit(plan)).immediate();
  }

  private appendAudit(plan: ActPreview): void {
    const last = this.db.query("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").get() as
      | { hash: string }
      | null;
    const previous = last?.hash ?? GENESIS_HASH;
    const bytesSha = sha256Hex(plan.bytes);
    this.db.query(
      `INSERT INTO audit (at, act, subject, bytes, bytes_sha256, prev_hash, hash)
       VALUES ($at, $act, $subject, $bytes, $bytes_sha256, $prev_hash, $hash)`,
    ).run({
      at: plan.at,
      act: plan.act,
      subject: plan.subject,
      bytes: plan.bytes,
      bytes_sha256: bytesSha,
      prev_hash: previous,
      hash: auditHash(previous, plan.at, plan.act, plan.subject, bytesSha),
    });
  }

  /** A plan's shown bytes must still be the canonical encoding of what will
   * be written; a mutated plan object is refused rather than recorded. */
  private assertPlanBytes(plan: ActPreview, record: unknown): void {
    const bytes = canonicalJson(record);
    if (bytes !== plan.bytes || sha256Hex(bytes) !== plan.sha256) {
      throw new LobbyError("plan_mismatch", "the act differs from the bytes that were shown; nothing was written");
    }
  }
}

function auditHash(previous: string, at: string, act: string, subject: string, bytesSha: string): string {
  return sha256Hex(canonicalJson({ act, at, bytes_sha256: bytesSha, prev_hash: previous, subject }));
}
