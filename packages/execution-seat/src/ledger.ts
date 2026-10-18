/**
 * Append-only local seat ledger. Every change is a new `entries` row; seats and
 * groups are folded from their entries on read. Nothing here deletes a row, so
 * summary rows outlive native transcripts (R2). A record grants no authority.
 */
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { SeatError } from "./errors.js";
import { earliest, latest, nonNegativeInt, phases, ref, requireUuid, sameSettings, timestamp, token, uuid } from "./fields.js";
import { assertPrivateStateFiles, preparePrivateHome, resolveSeatHome } from "./home.js";
import {
  GROUP_TYPE,
  SEAT_TYPE,
  type Basis,
  type Deliverable,
  type DeliverableKind,
  type EndState,
  type ExecutionSeat,
  type ExecutionSeatGroup,
  type GroupKind,
  type GroupOutcome,
  type NativeRef,
  type Promotion,
  type PromotionTrigger,
  type Relation,
  type SettingsEntry,
  type SummaryRow,
} from "./types.js";

const SCHEMA_VERSION = 1;
const MAX_LINEAGE = 64;
const BASES: readonly Basis[] = ["transcript", "hook", "rollout", "declared"];
const END_STATES: readonly EndState[] = ["result", "failed", "unknown"];
const GROUP_KINDS: readonly GroupKind[] = ["workflow", "spawn", "declared"];
const OUTCOMES: readonly GroupOutcome[] = ["completed", "failed", "stopped", "unknown"];
const DELIVERABLE_KINDS: readonly DeliverableKind[] = ["commit", "pr", "collab_event", "artifact"];
const PROMOTION_TRIGGERS: readonly PromotionTrigger[] = ["deliverable", "collab_write", "mission_event", "manual", "lineage"];
const NATIVE_KEY = /^[a-z][a-z_]{0,31}$/;
const DELIVERABLE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:\/#@\-]{0,255}$/;

const APPEND_ONLY = (table: string) => `
  CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
    BEGIN SELECT RAISE(ABORT, 'the execution-seat ledger is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
    BEGIN SELECT RAISE(ABORT, 'the execution-seat ledger is append-only'); END;`;

const DDL = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    subject TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS entries_by_subject ON entries (subject, seq);
  CREATE TABLE IF NOT EXISTS seats (
    seat_id TEXT PRIMARY KEY,
    native_key TEXT NOT NULL UNIQUE,
    open_seq INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS seat_groups (
    group_id TEXT PRIMARY KEY,
    native_key TEXT NOT NULL UNIQUE,
    orchestrator_seat_id TEXT NOT NULL,
    open_seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS seat_groups_by_orchestrator ON seat_groups (orchestrator_seat_id, open_seq);
  ${APPEND_ONLY("meta")}
  ${APPEND_ONLY("entries")}
  ${APPEND_ONLY("seats")}
  ${APPEND_ONLY("seat_groups")}`;

export interface OpenSeatInput {
  harness: string;
  version?: string | null;
  native_ref: NativeRef;
  parent_seat_id?: string | null;
  relation?: Relation | null;
  group_id?: string | null;
  started_at?: string | null;
}

export interface OpenGroupInput {
  kind: GroupKind;
  orchestrator_seat_id: string;
  native_ref: NativeRef;
  parent_group_id?: string | null;
  name?: string | null;
  phases?: string[];
  started_at?: string | null;
}

export interface Page<T> {
  items: T[];
  next: number | null;
}

type Body = Record<string, unknown>;

function normalizeNative(native: NativeRef): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = Object.keys(native).sort();
  if (keys.length === 0 || keys.length > 8) throw new SeatError("invalid_native_ref", "a native ref has 1 to 8 fields");
  for (const key of keys) {
    const value = ref(native[key]);
    if (!NATIVE_KEY.test(key) || !value) throw new SeatError("invalid_native_ref", "native ref fields are short identifiers");
    out[key] = value;
  }
  return out;
}

/** The identity of a native handle: one handle, one seat. */
export function nativeKey(harness: string, native: NativeRef): string {
  const name = token(harness);
  if (!name) throw new SeatError("invalid_harness", "a harness name is a short identifier");
  const fields = normalizeNative(native);
  if (name === "codex") {
    const thread = uuid(fields.thread_id);
    if (!thread) throw new SeatError("invalid_native_ref", "a Codex native ref names its thread_id");
    return `codex|thread_id=${thread}`;
  }
  if (name === "claude-code") {
    const session = uuid(fields.session_id);
    if (!session) throw new SeatError("invalid_native_ref", "a Claude Code native ref names its session_id");
    return `claude-code|session_id=${session}${fields.agent_id ? `|agent_id=${fields.agent_id}` : ""}`;
  }
  return `${name}|${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join("|")}`;
}

function normalizeSetting(entry: SettingsEntry): SettingsEntry {
  const at = timestamp(entry.at);
  if (!at || !BASES.includes(entry.basis)) throw new SeatError("invalid_settings", "a settings entry needs a time and a basis");
  const drop = token(entry.evidence?.thinking_drop);
  return {
    at,
    model: token(entry.model),
    effort: token(entry.effort),
    provider: token(entry.provider),
    basis: entry.basis,
    evidence: drop ? { thinking_drop: drop } : null,
  };
}

/** Build an L1 row from allowlisted fields only; anything else is dropped. */
export function normalizeRow(row: SummaryRow): SummaryRow {
  const childRef = ref(row.child_ref);
  if (!childRef) throw new SeatError("invalid_row", "a summary row names its child_ref");
  return {
    child_ref: childRef,
    parent_ref: ref(row.parent_ref),
    spawn_turn: ref(row.spawn_turn),
    relation: "child",
    depth: nonNegativeInt(row.depth),
    agent_type: token(row.agent_type),
    started_at: timestamp(row.started_at),
    ended_at: timestamp(row.ended_at),
    end_state: END_STATES.includes(row.end_state) ? row.end_state : "unknown",
    settings: (row.settings ?? []).map(normalizeSetting),
    seat_id: uuid(row.seat_id),
    native_gone_at: timestamp(row.native_gone_at),
  };
}

function mergeRow(previous: SummaryRow | undefined, next: SummaryRow): SummaryRow {
  return {
    ...next,
    seat_id: previous?.seat_id ?? next.seat_id,
    native_gone_at: previous?.native_gone_at ?? next.native_gone_at,
  };
}

export class SeatLedger {
  private constructor(
    private readonly db: Database,
    readonly deviceId: string,
    readonly home: string,
  ) {}

  static open(home: string = resolveSeatHome()): SeatLedger {
    const path = preparePrivateHome(home);
    const db = new Database(path, { strict: true });
    try {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA busy_timeout = 5000");
      const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (version > SCHEMA_VERSION) {
        throw new SeatError("schema_too_new", `the seat ledger has schema ${version}; this package supports ${SCHEMA_VERSION}`);
      }
      db.transaction(() => {
        db.exec(DDL);
        db.query("INSERT OR IGNORE INTO meta (key, value) VALUES ('device_id', ?)").run(randomUUID());
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      }).immediate();
      const device = (db.query("SELECT value FROM meta WHERE key = 'device_id'").get() as { value: string }).value;
      assertPrivateStateFiles(home);
      return new SeatLedger(db, device, home);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  /** Run `fn` in one immediate transaction, or inside the current one. */
  transaction<T>(fn: () => T): T {
    if (this.db.inTransaction) return fn();
    return this.db.transaction(fn).immediate();
  }

  private append(subject: string, kind: string, body: Body): number {
    const row = this.db
      .query("INSERT INTO entries (at, subject, kind, body) VALUES (?, ?, ?, ?) RETURNING seq")
      .get(new Date().toISOString(), subject, kind, JSON.stringify(body)) as { seq: number };
    return row.seq;
  }

  private entries(subject: string): { kind: string; body: Body }[] {
    const rows = this.db.query("SELECT kind, body FROM entries WHERE subject = ? ORDER BY seq").all(subject) as {
      kind: string;
      body: string;
    }[];
    return rows.map((row) => ({ kind: row.kind, body: JSON.parse(row.body) as Body }));
  }

  private requireSeat(seatId: string): ExecutionSeat {
    const seat = this.getSeat(seatId);
    if (!seat) throw new SeatError("seat_unknown", "no seat has that id");
    return seat;
  }

  private requireGroup(groupId: string): ExecutionSeatGroup {
    const group = this.getGroup(groupId);
    if (!group) throw new SeatError("group_unknown", "no group has that id");
    return group;
  }

  // ── seats ──────────────────────────────────────────────────────────────

  /**
   * Open the seat for a native handle, or return the one already open. A seat opens as `recorded`:
   * `durable` means published, and nothing here publishes.
   */
  openSeat(input: OpenSeatInput): { seat: ExecutionSeat; created: boolean } {
    return this.open(input, null);
  }

  private open(input: OpenSeatInput, promotion: Promotion | null): { seat: ExecutionSeat; created: boolean } {
    const key = nativeKey(input.harness, input.native_ref);
    return this.transaction(() => {
      const existing = this.db.query("SELECT seat_id FROM seats WHERE native_key = ?").get(key) as { seat_id: string } | null;
      if (existing) return { seat: this.requireSeat(existing.seat_id), created: false };
      const parent = input.parent_seat_id ? this.requireSeat(requireUuid(input.parent_seat_id, "parent_seat_id")) : null;
      const relation = input.relation ?? null;
      if ((parent === null) !== (relation === null)) {
        throw new SeatError("invalid_lineage", "a parent seat and a relation are given together or not at all");
      }
      if (relation && !["fork", "continuation", "child"].includes(relation)) {
        throw new SeatError("invalid_lineage", "relation is fork, continuation or child");
      }
      const group = input.group_id ? this.requireGroup(requireUuid(input.group_id, "group_id")) : null;
      const seatId = Bun.randomUUIDv7();
      const seq = this.append(seatId, "seat.open", {
        harness: token(input.harness),
        version: token(input.version),
        native_ref: normalizeNative(input.native_ref),
        parent_seat_id: parent?.seat_id ?? null,
        relation,
        group_id: group?.group_id ?? null,
        persistence: "recorded",
        promotion,
        device_id: this.deviceId,
        started_at: timestamp(input.started_at),
      });
      this.db.query("INSERT INTO seats (seat_id, native_key, open_seq) VALUES (?, ?, ?)").run(seatId, key, seq);
      return { seat: this.requireSeat(seatId), created: true };
    });
  }

  findSeat(harness: string, native: NativeRef): ExecutionSeat | null {
    const row = this.db.query("SELECT seat_id FROM seats WHERE native_key = ?").get(nativeKey(harness, native)) as
      | { seat_id: string }
      | null;
    return row ? this.getSeat(row.seat_id) : null;
  }

  getSeat(seatId: string, depth = 0): ExecutionSeat | null {
    return this.foldSeat(seatId, depth)?.seat ?? null;
  }

  /** Fold a seat's entries. `grouped` maps a child ref whose row moved to a group onto that group. */
  private foldSeat(seatId: string, depth = 0): { seat: ExecutionSeat; grouped: Map<string, string> } | null {
    const entries = this.entries(seatId);
    const open = entries[0];
    if (!open || open.kind !== "seat.open") return null;
    const b = open.body;
    const seat: ExecutionSeat = {
      type: SEAT_TYPE,
      seat_id: seatId,
      identity_id: null,
      signing_key_id: null,
      device_id: String(b.device_id),
      harness: { name: String(b.harness), version: (b.version as string | null) ?? null },
      native_ref: b.native_ref as NativeRef,
      parent_seat_id: (b.parent_seat_id as string | null) ?? null,
      relation: (b.relation as Relation | null) ?? null,
      group_id: (b.group_id as string | null) ?? null,
      persistence: b.persistence as ExecutionSeat["persistence"],
      promotion: (b.promotion as Promotion | null) ?? null,
      settings: [],
      children: [],
      started_at: (b.started_at as string | null) ?? null,
      last_seen_at: null,
      ended_at: null,
      end_reason: null,
    };
    const children = new Map<string, SummaryRow>();
    const grouped = new Map<string, string>();
    for (const { kind, body } of entries.slice(1)) {
      switch (kind) {
        case "seat.observed":
          seat.started_at = earliest(seat.started_at, (body.started_at as string | null) ?? null);
          seat.last_seen_at = latest(seat.last_seen_at, (body.last_seen_at as string | null) ?? null);
          seat.harness.version = (body.version as string | null) ?? seat.harness.version;
          break;
        case "seat.settings":
          seat.settings.push(body as unknown as SettingsEntry);
          break;
        case "seat.evidence": {
          const target = seat.settings.find((entry) => entry.at === body.at && !entry.evidence);
          if (target) target.evidence = { thinking_drop: String(body.thinking_drop) };
          break;
        }
        case "seat.lineage":
          if (!seat.parent_seat_id) {
            seat.parent_seat_id = body.parent_seat_id as string;
            seat.relation = body.relation as Relation;
          }
          break;
        case "seat.bind":
          if (!seat.identity_id) {
            seat.identity_id = body.identity_id as string;
            seat.signing_key_id = (body.signing_key_id as string | null) ?? null;
          }
          break;
        case "seat.end":
          if (!seat.ended_at) {
            seat.ended_at = body.ended_at as string;
            seat.end_reason = (body.end_reason as string | null) ?? null;
          }
          break;
        case "seat.child": {
          const row = normalizeRow(body as unknown as SummaryRow);
          children.set(row.child_ref, mergeRow(children.get(row.child_ref), row));
          break;
        }
        case "seat.child_grouped":
          children.delete(String(body.child_ref));
          grouped.set(String(body.child_ref), String(body.group_id));
          break;
        case "seat.group":
          seat.group_id ??= String(body.group_id);
          break;
      }
    }
    seat.children = [...children.values()];
    // A child seat inherits only its parent's identity_id (decision 8).
    if (seat.relation === "child" && seat.parent_seat_id && depth < MAX_LINEAGE) {
      seat.identity_id = this.getSeat(seat.parent_seat_id, depth + 1)?.identity_id ?? null;
      seat.signing_key_id = null;
    }
    return { seat, grouped };
  }

  listSeats(options: { limit?: number; after?: number } = {}): Page<ExecutionSeat> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = this.db
      .query("SELECT seat_id, open_seq FROM seats WHERE open_seq > ? ORDER BY open_seq LIMIT ?")
      .all(options.after ?? 0, limit) as { seat_id: string; open_seq: number }[];
    const items = rows.map((row) => this.requireSeat(row.seat_id));
    return { items, next: rows.length === limit ? (rows[rows.length - 1]?.open_seq ?? null) : null };
  }

  /** Append the entries of `timeline` that change model, effort or provider. Returns how many were appended. */
  recordSettings(seatId: string, timeline: SettingsEntry[]): number {
    const incoming = timeline.map(normalizeSetting);
    return this.transaction(() => {
      const current = this.requireSeat(seatId).settings;
      let appended = 0;
      const addEvidence = (entry: SettingsEntry, reason: string) => {
        this.append(seatId, "seat.evidence", { at: entry.at, thinking_drop: reason });
        entry.evidence = { thinking_drop: reason };
      };
      for (const entry of incoming) {
        const same = current.find((existing) => existing.at === entry.at && sameSettings(existing, entry));
        const last = current[current.length - 1];
        const target = same ?? (sameSettings(last, entry) ? last : undefined);
        if (target) {
          if (entry.evidence && !target.evidence) addEvidence(target, entry.evidence.thinking_drop);
          continue;
        }
        if (last && entry.at <= last.at) continue;
        this.append(seatId, "seat.settings", entry as unknown as Body);
        current.push(entry);
        appended += 1;
      }
      return appended;
    });
  }

  observe(seatId: string, seen: { started_at?: string | null; last_seen_at?: string | null; version?: string | null }): boolean {
    return this.transaction(() => {
      const seat = this.requireSeat(seatId);
      const started = timestamp(seen.started_at);
      const last = timestamp(seen.last_seen_at);
      const version = token(seen.version);
      const changes =
        earliest(seat.started_at, started) !== seat.started_at ||
        latest(seat.last_seen_at, last) !== seat.last_seen_at ||
        (version !== null && version !== seat.harness.version);
      if (!changes) return false;
      this.append(seatId, "seat.observed", { started_at: started, last_seen_at: last, version });
      return true;
    });
  }

  /** Give a seat with no parent its fork or continuation parent. */
  linkParent(seatId: string, parentSeatId: string, relation: "fork" | "continuation"): boolean {
    return this.transaction(() => {
      const seat = this.requireSeat(seatId);
      const parent = this.requireSeat(parentSeatId);
      if (seat.parent_seat_id) {
        if (seat.parent_seat_id === parent.seat_id && seat.relation === relation) return false;
        throw new SeatError("lineage_conflict", "this seat already has a different parent");
      }
      for (let at: ExecutionSeat | null = parent, hops = 0; at; at = at.parent_seat_id ? this.getSeat(at.parent_seat_id) : null) {
        if (at.seat_id === seat.seat_id || ++hops > MAX_LINEAGE) throw new SeatError("lineage_cycle", "a seat cannot descend from itself");
      }
      this.append(seatId, "seat.lineage", { parent_seat_id: parent.seat_id, relation });
      return true;
    });
  }

  /** Declare which identity a seat acts for. A declaration, not a proof. */
  bindIdentity(seatId: string, identityId: string, signingKeyId: string | null = null): boolean {
    const identity = requireUuid(identityId, "identity_id");
    const key = signingKeyId === null ? null : ref(signingKeyId);
    if (signingKeyId !== null && !key) throw new SeatError("invalid_id", "signing_key_id is a short identifier");
    return this.transaction(() => {
      const seat = this.requireSeat(seatId);
      if (seat.relation === "child") {
        throw new SeatError("child_inherits_identity", "a child seat inherits its parent's identity_id and cannot be bound");
      }
      if (seat.identity_id) {
        if (seat.identity_id === identity && seat.signing_key_id === key) return false;
        throw new SeatError("identity_conflict", "this seat is already bound to an identity");
      }
      this.append(seatId, "seat.bind", { identity_id: identity, signing_key_id: key });
      return true;
    });
  }

  endSeat(seatId: string, endedAt: string, reason: string | null = null): boolean {
    const at = timestamp(endedAt);
    if (!at) throw new SeatError("invalid_time", "ended_at must be a timestamp");
    return this.transaction(() => {
      if (this.requireSeat(seatId).ended_at) return false;
      this.append(seatId, "seat.end", { ended_at: at, end_reason: token(reason) });
      return true;
    });
  }

  recordChild(seatId: string, row: SummaryRow): boolean {
    const next = normalizeRow(row);
    return this.transaction(() => {
      const folded = this.foldSeat(seatId);
      if (!folded) throw new SeatError("seat_unknown", "no seat has that id");
      if (folded.grouped.has(next.child_ref)) {
        throw new SeatError("child_grouped", "this child's row moved to a group; record it as a member there");
      }
      const current = folded.seat.children.find((child) => child.child_ref === next.child_ref);
      const merged = mergeRow(current, next);
      if (current && JSON.stringify(current) === JSON.stringify(merged)) return false;
      this.append(seatId, "seat.child", merged as unknown as Body);
      return true;
    });
  }

  /**
   * Give a child its own `recorded` record. Its row can be in the seat's `children` or in a group
   * the seat orchestrates, and it stays there with the new `seat_id`. A nested child's ancestors
   * are promoted first (trigger `lineage`), so `parent_seat_id` is always the direct parent.
   * Promoting a child that already has a record changes nothing. Its identity follows the parent.
   */
  promote(seatId: string, childRef: string, trigger: Exclude<PromotionTrigger, "lineage"> = "manual"): ExecutionSeat {
    // `lineage` is set only by the chain walk; callers name the event that needs a record.
    if (!PROMOTION_TRIGGERS.includes(trigger) || (trigger as PromotionTrigger) === "lineage") {
      throw new SeatError("invalid_trigger", "a promotion trigger is deliverable, collab_write, mission_event or manual");
    }
    return this.transaction(() => this.promoteChain(this.requireSeat(seatId), childRef, trigger, 0));
  }

  /** A child's row, in the seat's `children` or in a group the seat orchestrates. */
  findChild(seatId: string, childRef: string): { row: SummaryRow; group_id: string | null } | null {
    return this.findRow(this.requireSeat(seatId), childRef);
  }

  private findRow(seat: ExecutionSeat, childRef: string): { row: SummaryRow; group_id: string | null } | null {
    const row = seat.children.find((child) => child.child_ref === childRef);
    if (row) return { row, group_id: null };
    for (const group of this.groupsFor(seat.seat_id)) {
      const member = group.members.find((candidate) => candidate.child_ref === childRef);
      if (member) return { row: member, group_id: group.group_id };
    }
    return null;
  }

  private promoteChain(holder: ExecutionSeat, childRef: string, trigger: PromotionTrigger, hops: number): ExecutionSeat {
    if (hops > MAX_LINEAGE) throw new SeatError("lineage_cycle", "a child cannot descend from itself");
    const found = this.findRow(holder, childRef);
    if (!found) {
      if (hops === 0) throw new SeatError("child_unknown", "this seat has no child with that ref");
      throw new SeatError("parent_row_unknown", "a nested child's parent has no row under this seat");
    }
    const { row, group_id: groupId } = found;
    if (row.seat_id) return this.requireSeat(row.seat_id);
    const parent = row.parent_ref ? this.promoteChain(holder, row.parent_ref, "lineage", hops + 1) : holder;
    const { seat } = this.open(
      {
        harness: holder.harness.name,
        version: holder.harness.version,
        native_ref: childNativeRef(holder, row.child_ref),
        parent_seat_id: parent.seat_id,
        relation: "child",
        group_id: groupId,
        started_at: row.started_at,
      },
      { trigger, at: new Date().toISOString() },
    );
    this.recordSettings(seat.seat_id, row.settings);
    if (row.ended_at) this.endSeat(seat.seat_id, row.ended_at, row.end_state);
    if (groupId) this.recordMember(groupId, { ...row, seat_id: seat.seat_id });
    else this.recordChild(holder.seat_id, { ...row, seat_id: seat.seat_id });
    return this.requireSeat(seat.seat_id);
  }

  /**
   * Move a child's row from a seat's `children` into a group that seat orchestrates. The row keeps
   * its `seat_id` and gone marker; a promoted child's own record gains the `group_id`.
   */
  moveChildToGroup(seatId: string, groupId: string, childRef: string): boolean {
    return this.transaction(() => {
      const seat = this.requireSeat(seatId);
      const group = this.requireGroup(groupId);
      if (group.orchestrator_seat_id !== seat.seat_id) {
        throw new SeatError("invalid_group", "a child row moves only into a group its own seat orchestrates");
      }
      const row = seat.children.find((child) => child.child_ref === childRef);
      if (!row) return false;
      this.recordMember(groupId, row);
      this.append(seatId, "seat.child_grouped", { child_ref: row.child_ref, group_id: groupId });
      if (row.seat_id && !this.requireSeat(row.seat_id).group_id) this.append(row.seat_id, "seat.group", { group_id: groupId });
      return true;
    });
  }

  // ── groups ─────────────────────────────────────────────────────────────

  openGroup(input: OpenGroupInput): { group: ExecutionSeatGroup; created: boolean } {
    if (!GROUP_KINDS.includes(input.kind)) throw new SeatError("invalid_group", "group kind is workflow, spawn or declared");
    const native = normalizeNative(input.native_ref);
    const key = `group|${input.kind}|${Object.entries(native).map(([k, v]) => `${k}=${v}`).join("|")}`;
    return this.transaction(() => {
      const existing = this.db.query("SELECT group_id FROM seat_groups WHERE native_key = ?").get(key) as
        | { group_id: string }
        | null;
      if (existing) return { group: this.requireGroup(existing.group_id), created: false };
      const orchestrator = this.requireSeat(requireUuid(input.orchestrator_seat_id, "orchestrator_seat_id"));
      const parentGroup = input.parent_group_id ? this.requireGroup(requireUuid(input.parent_group_id, "parent_group_id")) : null;
      const groupId = Bun.randomUUIDv7();
      const seq = this.append(groupId, "group.open", {
        kind: input.kind,
        orchestrator_seat_id: orchestrator.seat_id,
        parent_group_id: parentGroup?.group_id ?? null,
        native_ref: native,
        name: token(input.name),
        phases: phases(input.phases ?? []),
        started_at: timestamp(input.started_at),
      });
      this.db
        .query("INSERT INTO seat_groups (group_id, native_key, orchestrator_seat_id, open_seq) VALUES (?, ?, ?, ?)")
        .run(groupId, key, orchestrator.seat_id, seq);
      return { group: this.requireGroup(groupId), created: true };
    });
  }

  getGroup(groupId: string): ExecutionSeatGroup | null {
    const entries = this.entries(groupId);
    const open = entries[0];
    if (!open || open.kind !== "group.open") return null;
    const b = open.body;
    const group: ExecutionSeatGroup = {
      type: GROUP_TYPE,
      group_id: groupId,
      kind: b.kind as GroupKind,
      orchestrator_seat_id: String(b.orchestrator_seat_id),
      parent_group_id: (b.parent_group_id as string | null) ?? null,
      identity_id: null,
      native_ref: b.native_ref as NativeRef,
      name: (b.name as string | null) ?? null,
      phases: phases((b.phases as string[]) ?? []),
      members: [],
      deliverables: [],
      started_at: (b.started_at as string | null) ?? null,
      ended_at: null,
      outcome: null,
    };
    const members = new Map<string, SummaryRow>();
    for (const { kind, body } of entries.slice(1)) {
      if (kind === "group.member") {
        const row = normalizeRow(body as unknown as SummaryRow);
        members.set(row.child_ref, mergeRow(members.get(row.child_ref), row));
      } else if (kind === "group.phases") {
        group.phases = phases(body.phases as string[], group.phases);
      } else if (kind === "group.deliverable") {
        group.deliverables.push(body as unknown as Deliverable);
      } else if (kind === "group.end" && !group.ended_at) {
        group.ended_at = body.ended_at as string;
        group.outcome = body.outcome as GroupOutcome;
      } else if (kind === "group.parent") {
        // Decision 13: the first parent link recorded stands.
        group.parent_group_id ??= String(body.parent_group_id);
      }
    }
    group.members = [...members.values()];
    for (const member of group.members) group.started_at = earliest(group.started_at, member.started_at);
    group.identity_id = this.getSeat(group.orchestrator_seat_id)?.identity_id ?? null;
    return group;
  }

  findGroup(kind: GroupKind, native: NativeRef): ExecutionSeatGroup | null {
    const key = `group|${kind}|${Object.entries(normalizeNative(native)).map(([k, v]) => `${k}=${v}`).join("|")}`;
    const row = this.db.query("SELECT group_id FROM seat_groups WHERE native_key = ?").get(key) as { group_id: string } | null;
    return row ? this.getGroup(row.group_id) : null;
  }

  groupsFor(orchestratorSeatId: string): ExecutionSeatGroup[] {
    const rows = this.db
      .query("SELECT group_id FROM seat_groups WHERE orchestrator_seat_id = ? ORDER BY open_seq")
      .all(orchestratorSeatId) as { group_id: string }[];
    return rows.map((row) => this.requireGroup(row.group_id));
  }

  /**
   * Give a group with no parent group its parent: the group whose member started this run. The
   * first link stands; a different later one is refused, and so is one that would make a cycle.
   */
  linkParentGroup(groupId: string, parentGroupId: string): boolean {
    return this.transaction(() => {
      const group = this.requireGroup(groupId);
      const parent = this.requireGroup(parentGroupId);
      if (group.parent_group_id) {
        if (group.parent_group_id === parent.group_id) return false;
        throw new SeatError("group_lineage_conflict", "this group already has a different parent group");
      }
      for (let at: ExecutionSeatGroup | null = parent, hops = 0; at; at = at.parent_group_id ? this.getGroup(at.parent_group_id) : null) {
        if (at.group_id === group.group_id || ++hops > MAX_LINEAGE) {
          throw new SeatError("group_lineage_cycle", "a group cannot nest inside itself");
        }
      }
      this.append(groupId, "group.parent", { parent_group_id: parent.group_id });
      return true;
    });
  }

  /** Add phase titles the group has not recorded yet. Returns whether any were added. */
  recordPhases(groupId: string, titles: readonly string[]): boolean {
    return this.transaction(() => {
      const current = this.requireGroup(groupId).phases;
      const added = phases(titles, current).slice(current.length);
      if (added.length === 0) return false;
      this.append(groupId, "group.phases", { phases: added });
      return true;
    });
  }

  recordMember(groupId: string, row: SummaryRow): boolean {
    const next = normalizeRow(row);
    return this.transaction(() => {
      const current = this.requireGroup(groupId).members.find((member) => member.child_ref === next.child_ref);
      const merged = mergeRow(current, next);
      if (current && JSON.stringify(current) === JSON.stringify(merged)) return false;
      this.append(groupId, "group.member", merged as unknown as Body);
      return true;
    });
  }

  /** Record a pointer to something the group produced. A member that produced it is promoted to `recorded`. */
  addDeliverable(groupId: string, deliverable: Deliverable, byChildRef: string | null = null): boolean {
    if (!DELIVERABLE_KINDS.includes(deliverable.kind) || !DELIVERABLE_REF.test(deliverable.ref)) {
      throw new SeatError("invalid_deliverable", "a deliverable is a commit, pr, collab_event or artifact pointer");
    }
    return this.transaction(() => {
      const group = this.requireGroup(groupId);
      if (byChildRef) {
        if (!group.members.some((member) => member.child_ref === byChildRef)) {
          throw new SeatError("member_unknown", "this group has no member with that ref");
        }
        this.promote(group.orchestrator_seat_id, byChildRef, "deliverable");
      }
      if (group.deliverables.some((d) => d.kind === deliverable.kind && d.ref === deliverable.ref)) return false;
      this.append(groupId, "group.deliverable", { kind: deliverable.kind, ref: deliverable.ref });
      return true;
    });
  }

  endGroup(groupId: string, endedAt: string, outcome: GroupOutcome): boolean {
    const at = timestamp(endedAt);
    if (!at || !OUTCOMES.includes(outcome)) throw new SeatError("invalid_group_end", "a group end needs a time and an outcome");
    return this.transaction(() => {
      if (this.requireGroup(groupId).ended_at) return false;
      this.append(groupId, "group.end", { ended_at: at, outcome });
      return true;
    });
  }
}

function childNativeRef(parent: ExecutionSeat, childRef: string): NativeRef {
  const session = parent.native_ref.session_id;
  if (parent.harness.name === "claude-code" && session) return { session_id: session, agent_id: childRef };
  if (parent.harness.name === "codex" && uuid(childRef)) {
    return { thread_id: childRef, session_id: session ?? parent.native_ref.thread_id ?? childRef };
  }
  throw new SeatError("promotion_unsupported", "this harness has no native ref for its children");
}
