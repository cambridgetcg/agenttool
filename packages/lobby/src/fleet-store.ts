/** Fleet-hall state in lobby.sqlite (schema version 4).
 *
 * Desk side (every enrolled device): its desk identity and directory join,
 * the grants it holds (and which it left), the knocks it sent, its pending
 * renew requests, a cache of mission events it read, and an outbox of exact
 * observation bytes saved before sending.
 * Hub side (the one device holding the door): hub configuration, enrolled
 * fleet devices, grants it issued (and their revocation), room seasons,
 * published cards, knock decisions, memberships (state, pause), keyed
 * rosters, renewals, blocks, grants registered by hand for adopted seasons,
 * desk notes already processed, and an emergency stop.
 *
 * Version 3 is reached from version 2 by `FLEET_V3_UPGRADE_SQL`, and version 4
 * (directory renewal inside the Lobby) from version 3 by
 * `FLEET_V4_UPGRADE_SQL`, each run once in the same transaction that records
 * the new version; nothing existing is rewritten. The steps are chained in
 * src/store.ts (`SCHEMA_STEPS`).
 *
 * No secret is stored here: the desk key and token preimages live in
 * `<home>/secrets` (src/secrets.ts); the project bearer and door key live in
 * the Keychain (src/keychain.ts). Token hashes, public keys and signed
 * documents are not secrets. Contract: packages/lobby/README.md#fleet-hall.
 */
import type { Database } from "bun:sqlite";
import { LobbyError } from "./errors.js";
import type { MissionAction, MissionEvent } from "./wire.js";

export const FLEET_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS desk (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  directory_mission_id TEXT,
  directory_digest TEXT,
  door_fingerprint TEXT,
  joined_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS desk_grants (
  grant_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  mission_digest TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('directory', 'season')),
  room_id TEXT,
  actions TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  accepted_at TEXT,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS desk_knocks (
  knock_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  charter_digest TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('player', 'spectator')),
  token_sha256 TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  event_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ready_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS events (
  mission_id TEXT NOT NULL,
  received_seq INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  proof TEXT NOT NULL,
  PRIMARY KEY (mission_id, received_seq)
) STRICT;

CREATE TABLE IF NOT EXISTS cursors (
  mission_id TEXT PRIMARY KEY,
  after TEXT NOT NULL,
  synced_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS outbox (
  event_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  gate_room TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'stored')),
  received_seq TEXT,
  created_at TEXT NOT NULL,
  stored_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS hub (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  keychain_account TEXT NOT NULL,
  bearer_service TEXT NOT NULL,
  door_service TEXT NOT NULL,
  door_public_key TEXT NOT NULL,
  door_fingerprint TEXT NOT NULL,
  directory_mission_id TEXT NOT NULL,
  directory_descriptor TEXT NOT NULL,
  directory_digest TEXT NOT NULL,
  directory_expires_at TEXT NOT NULL,
  directory_mode TEXT NOT NULL CHECK (directory_mode IN ('created', 'adopted')),
  directory_state TEXT NOT NULL CHECK (directory_state IN ('pending', 'active')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS hub_devices (
  identity_id TEXT PRIMARY KEY,
  signing_key_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enrolled_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS hub_grants (
  grant_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  actions TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('directory', 'season')),
  room_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('requested', 'issued')),
  requested_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS hub_seasons (
  mission_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  mission_digest TEXT NOT NULL,
  descriptor TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('created', 'adopted')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'current', 'replaced')),
  recorded_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS hub_seasons_one_current ON hub_seasons (room_id) WHERE state = 'current';

CREATE TABLE IF NOT EXISTS hub_cards (
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  card_seq INTEGER NOT NULL CHECK (card_seq >= 1),
  event_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  PRIMARY KEY (room_id, card_seq)
) STRICT;

CREATE TABLE IF NOT EXISTS hub_decisions (
  knock_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  knock_sha256 TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('admitted', 'denied')),
  decided_at TEXT NOT NULL,
  summary TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS hub_members (
  mission_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('player', 'spectator')),
  term_ends_at TEXT NOT NULL,
  knock_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  admitted_at TEXT NOT NULL,
  PRIMARY KEY (mission_id, identity_id)
) STRICT;

CREATE TRIGGER IF NOT EXISTS hub_decisions_are_final
BEFORE UPDATE ON hub_decisions
BEGIN
  SELECT RAISE(ABORT, 'decisions_are_final');
END;
`;

/** Version 2 → 3: table talk, renewal, leave, kick and block, the emergency
 * stop. Additive only: new nullable or defaulted columns and new tables. */
export const FLEET_V3_UPGRADE_SQL = `
ALTER TABLE desk_grants ADD COLUMN left_at TEXT;
ALTER TABLE hub ADD COLUMN stopped_at TEXT;
ALTER TABLE hub ADD COLUMN directory_revoked_at TEXT;
ALTER TABLE hub_grants ADD COLUMN revoke_state TEXT CHECK (revoke_state IS NULL OR revoke_state IN ('requested', 'revoked'));
ALTER TABLE hub_grants ADD COLUMN revoked_at TEXT;
ALTER TABLE hub_seasons ADD COLUMN revoked_at TEXT;
ALTER TABLE hub_members ADD COLUMN state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'left', 'kicked', 'blocked'));
ALTER TABLE hub_members ADD COLUMN paused_at TEXT;
ALTER TABLE hub_members ADD COLUMN changed_at TEXT;

CREATE TABLE IF NOT EXISTS desk_renewals (
  token_sha256 TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  posted_mission_id TEXT NOT NULL,
  request_event_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  accepted_grant_id TEXT,
  accepted_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS hub_rosters (
  mission_id TEXT NOT NULL,
  roster_seq INTEGER NOT NULL CHECK (roster_seq >= 1),
  room_id TEXT NOT NULL,
  members TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  PRIMARY KEY (mission_id, roster_seq)
) STRICT;

CREATE TABLE IF NOT EXISTS hub_renewals (
  token_sha256 TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('request', 'list')),
  request_event_id TEXT,
  note_event_id TEXT NOT NULL,
  renewed_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS hub_blocks (
  room_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  blocked_at TEXT NOT NULL,
  PRIMARY KEY (room_id, identity_id)
) STRICT;

CREATE TABLE IF NOT EXISTS hub_extra_grants (
  grant_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  revoke_state TEXT CHECK (revoke_state IS NULL OR revoke_state IN ('requested', 'revoked')),
  revoked_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS hub_processed_notes (
  event_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  processed_at TEXT NOT NULL
) STRICT;
`;

/** Version 3 → 4: directory renewal inside the Lobby. Additive only: a
 * nullable column on the desk and on enrolled devices, and two new tables
 * (room renewals keep their own tables, whose `room_id` is required). */
export const FLEET_V4_UPGRADE_SQL = `
ALTER TABLE desk ADD COLUMN directory_expires_at TEXT;
ALTER TABLE hub_devices ADD COLUMN directory_paused_at TEXT;

CREATE TABLE IF NOT EXISTS desk_directory_renewals (
  token_sha256 TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  grant_id TEXT NOT NULL UNIQUE,
  posted_mission_id TEXT NOT NULL,
  request_event_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS hub_directory_renewals (
  token_sha256 TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  grant_id TEXT NOT NULL UNIQUE,
  request_event_id TEXT NOT NULL,
  notice_event_id TEXT NOT NULL,
  renewed_at TEXT NOT NULL
) STRICT;
`;

export interface DeskRow {
  project_id: string;
  origin: string;
  identity_id: string;
  signing_key_id: string;
  public_key: string;
  fingerprint: string;
  display_name: string;
  created_at: string;
  directory_mission_id: string | null;
  directory_digest: string | null;
  door_fingerprint: string | null;
  joined_at: string | null;
  /** The joined directory's end, as this desk last read it (version 4; absent on older reads). */
  directory_expires_at?: string | null;
}

export interface DeskGrantRow {
  grant_id: string;
  mission_id: string;
  mission_digest: string | null;
  purpose: "directory" | "season";
  room_id: string | null;
  actions: MissionAction[];
  token_sha256: string;
  expires_at: string | null;
  accepted_at: string | null;
  recorded_at: string;
  /** When this desk left the grant itself (version 3; absent on a version-2 read). */
  left_at?: string | null;
}

export interface DeskRenewalRow {
  token_sha256: string;
  room_id: string;
  mission_id: string;
  posted_mission_id: string;
  request_event_id: string;
  requested_at: string;
  accepted_grant_id: string | null;
  accepted_at: string | null;
}

/** A request this desk posted for its next directory grant (version 4): the
 * grant id and token hash it chose, and when it picked the grant up. */
export interface DeskDirectoryRenewalRow {
  token_sha256: string;
  mission_id: string;
  grant_id: string;
  posted_mission_id: string;
  request_event_id: string;
  requested_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface DeskKnockRow {
  knock_id: string;
  room_id: string;
  mission_id: string;
  charter_digest: string;
  tier: "player" | "spectator";
  token_sha256: string;
  summary: string;
  event_id: string;
  issued_at: string;
  expires_at: string;
  ready_at: string | null;
}

export interface OutboxRow {
  event_id: string;
  mission_id: string;
  grant_id: string;
  kind: string;
  raw_body: string;
  gate_room: string;
  state: "pending" | "stored";
  received_seq: string | null;
  created_at: string;
  stored_at: string | null;
}

export interface HubRow {
  project_id: string;
  origin: string;
  keychain_account: string;
  bearer_service: string;
  door_service: string;
  door_public_key: string;
  door_fingerprint: string;
  directory_mission_id: string;
  directory_descriptor: string;
  directory_digest: string;
  directory_expires_at: string;
  directory_mode: "created" | "adopted";
  directory_state: "pending" | "active";
  created_at: string;
  /** Set by the emergency stop (version 3). */
  stopped_at?: string | null;
  directory_revoked_at?: string | null;
}

export interface HubDeviceRow {
  identity_id: string;
  signing_key_id: string;
  public_key: string;
  fingerprint: string;
  display_name: string;
  enrolled_at: string;
  /** Set while the owner has paused this device's directory renewal (version 4). */
  directory_paused_at?: string | null;
}

export interface HubGrantRow {
  grant_id: string;
  mission_id: string;
  identity_id: string;
  signing_key_id: string;
  actions: MissionAction[];
  token_sha256: string;
  expires_at: string;
  purpose: "directory" | "season";
  room_id: string | null;
  state: "requested" | "issued";
  requested_at: string;
  /** `requested`: a revocation was sent without a confirmed answer; `revoked`: confirmed (version 3). */
  revoke_state?: "requested" | "revoked" | null;
  revoked_at?: string | null;
}

export interface SeasonRow {
  mission_id: string;
  room_id: string;
  mission_digest: string;
  descriptor: string;
  expires_at: string;
  mode: "created" | "adopted";
  state: "pending" | "current" | "replaced";
  recorded_at: string;
  revoked_at?: string | null;
}

export type MemberState = "active" | "left" | "kicked" | "blocked";

export interface RosterRow {
  mission_id: string;
  roster_seq: number;
  room_id: string;
  members: string;
  issued_at: string;
}

export interface RenewalRow {
  token_sha256: string;
  room_id: string;
  mission_id: string;
  identity_id: string;
  grant_id: string;
  basis: "request" | "list";
  request_event_id: string | null;
  note_event_id: string;
  renewed_at: string;
}

/** A directory grant the hub renewed from a desk's request (version 4). */
export interface DirectoryRenewalRow {
  token_sha256: string;
  mission_id: string;
  identity_id: string;
  grant_id: string;
  request_event_id: string;
  notice_event_id: string;
  renewed_at: string;
}

export interface BlockRow {
  room_id: string;
  identity_id: string;
  blocked_at: string;
}

export interface ExtraGrantRow {
  grant_id: string;
  mission_id: string;
  room_id: string;
  identity_id: string;
  recorded_at: string;
  revoke_state: "requested" | "revoked" | null;
  revoked_at: string | null;
}

export interface HubCardRow {
  room_id: string;
  card_seq: number;
  event_id: string;
  summary: string;
  issued_at: string;
}

export interface DecisionRow {
  knock_id: string;
  room_id: string;
  identity_id: string;
  knock_sha256: string;
  decision: "admitted" | "denied";
  decided_at: string;
  summary: string;
}

export interface MemberRow {
  mission_id: string;
  room_id: string;
  identity_id: string;
  tier: "player" | "spectator";
  term_ends_at: string;
  knock_id: string;
  grant_id: string;
  admitted_at: string;
  /** Version 3: membership state, pause flag (renewal stops while set) and when the state last changed. */
  state?: MemberState;
  paused_at?: string | null;
  changed_at?: string | null;
}

type Row = Record<string, unknown>;

function withActions<T extends { actions: MissionAction[] }>(row: Row | null): T | null {
  if (row === null) return null;
  return { ...row, actions: JSON.parse(String(row.actions)) } as unknown as T;
}

/** Fleet tables over the same handle as LobbyStore. Writes require a
 * writable store; the MCP's read-only handle can only call readers. */
export class FleetStore {
  /** The fleet tables exist (state version 2 or later). */
  readonly available: boolean;
  /** The table-talk, renewal and removal tables and columns exist (state version 3 or later). */
  readonly v3: boolean;
  /** The directory-renewal tables and columns exist (state version 4 or later). */
  readonly v4: boolean;

  /** `stateVersion` is one LobbyStore has already accepted as readable. */
  constructor(
    private readonly db: Database,
    private readonly writable: boolean,
    stateVersion: string,
  ) {
    const version = Number(stateVersion);
    this.available = version >= 2;
    this.v3 = version >= 3;
    this.v4 = version >= 4;
  }

  private write(): void {
    if (!this.writable) throw new LobbyError("read_only", "this desk view is read-only");
    if (!this.v3) throw new LobbyError("state_not_upgraded", "this desk state has no version-3 fleet tables yet");
  }

  transaction<T>(run: () => T): T {
    return this.db.transaction(run).immediate();
  }

  // ── Desk ───────────────────────────────────────────────────────────

  desk(): DeskRow | null {
    if (!this.available) return null;
    return this.db.query("SELECT * FROM desk WHERE singleton = 1").get() as DeskRow | null;
  }

  createDesk(row: Omit<DeskRow, "directory_mission_id" | "directory_digest" | "door_fingerprint" | "joined_at">): void {
    this.write();
    this.db.query(
      `INSERT INTO desk (singleton, project_id, origin, identity_id, signing_key_id, public_key, fingerprint,
         display_name, created_at)
       VALUES (1, $project_id, $origin, $identity_id, $signing_key_id, $public_key, $fingerprint,
         $display_name, $created_at)`,
    ).run({ ...row });
  }

  setDeskJoined(input: { directory_mission_id: string; directory_digest: string; door_fingerprint: string; joined_at: string }): void {
    this.write();
    this.db.query(
      `UPDATE desk SET directory_mission_id = $directory_mission_id, directory_digest = $directory_digest,
         door_fingerprint = $door_fingerprint, joined_at = $joined_at WHERE singleton = 1`,
    ).run({ ...input });
  }

  addDeskGrant(row: DeskGrantRow): void {
    this.write();
    this.db.query(
      `INSERT INTO desk_grants (grant_id, mission_id, mission_digest, purpose, room_id, actions, token_sha256,
         expires_at, accepted_at, recorded_at)
       VALUES ($grant_id, $mission_id, $mission_digest, $purpose, $room_id, $actions, $token_sha256,
         $expires_at, $accepted_at, $recorded_at)`,
    ).run({ ...row, actions: JSON.stringify(row.actions) });
  }

  /** A token generated for a grant not yet known: kept by hash only. */
  deskGrant(grantId: string): DeskGrantRow | null {
    return withActions<DeskGrantRow>(this.db.query("SELECT * FROM desk_grants WHERE grant_id = $grant_id")
      .get({ grant_id: grantId }) as Row | null);
  }

  markDeskGrantAccepted(grantId: string, input: { mission_digest: string; expires_at: string; accepted_at: string }): void {
    this.write();
    this.db.query(
      `UPDATE desk_grants SET mission_digest = $mission_digest, expires_at = $expires_at, accepted_at = $accepted_at
       WHERE grant_id = $grant_id`,
    ).run({ grant_id: grantId, ...input });
  }

  /** The accepted grant for a mission that lasts longest past `now`, never
   * one this desk has left. */
  currentDeskGrant(missionId: string, now: Date): DeskGrantRow | null {
    return withActions<DeskGrantRow>(this.db.query(
      `SELECT * FROM desk_grants WHERE mission_id = $mission_id AND accepted_at IS NOT NULL
         AND expires_at > $now ${this.v3 ? "AND left_at IS NULL" : ""} ORDER BY expires_at DESC LIMIT 1`,
    ).get({ mission_id: missionId, now: now.toISOString() }) as Row | null);
  }

  listDeskGrants(): DeskGrantRow[] {
    if (!this.available) return [];
    return (this.db.query("SELECT * FROM desk_grants ORDER BY recorded_at ASC, grant_id ASC").all() as Row[])
      .map((row) => withActions<DeskGrantRow>(row)!);
  }

  addDeskKnock(row: Omit<DeskKnockRow, "ready_at">): void {
    this.write();
    this.db.query(
      `INSERT INTO desk_knocks (knock_id, room_id, mission_id, charter_digest, tier, token_sha256, summary,
         event_id, issued_at, expires_at, ready_at)
       VALUES ($knock_id, $room_id, $mission_id, $charter_digest, $tier, $token_sha256, $summary,
         $event_id, $issued_at, $expires_at, NULL)`,
    ).run({ ...row });
  }

  deskKnock(knockId: string): DeskKnockRow | null {
    return this.db.query("SELECT * FROM desk_knocks WHERE knock_id = $knock_id").get({ knock_id: knockId }) as DeskKnockRow | null;
  }

  listDeskKnocks(): DeskKnockRow[] {
    if (!this.available) return [];
    return this.db.query("SELECT * FROM desk_knocks ORDER BY issued_at ASC, knock_id ASC").all() as DeskKnockRow[];
  }

  markKnockReady(knockId: string, at: string): void {
    this.write();
    const result = this.db.query("UPDATE desk_knocks SET ready_at = $at WHERE knock_id = $knock_id AND ready_at IS NULL")
      .run({ knock_id: knockId, at });
    if (result.changes !== 1) throw new LobbyError("admission_used", "this admission was already used; it is single use");
  }

  // ── Event cache and cursors ────────────────────────────────────────

  cursor(missionId: string): string {
    if (!this.available) return "0";
    const row = this.db.query("SELECT after FROM cursors WHERE mission_id = $mission_id").get({ mission_id: missionId }) as
      | { after: string }
      | null;
    return row?.after ?? "0";
  }

  lastSynced(missionId: string): string | null {
    if (!this.available) return null;
    const row = this.db.query("SELECT synced_at FROM cursors WHERE mission_id = $mission_id").get({ mission_id: missionId }) as
      | { synced_at: string }
      | null;
    return row?.synced_at ?? null;
  }

  /** Store one verified-shape page. A cached event never changes: the same
   * sequence number with different bytes is refused as corrupt history. */
  storeEvents(missionId: string, events: readonly MissionEvent[], nextCursor: string, syncedAt: string): number {
    this.write();
    return this.transaction(() => {
      let added = 0;
      for (const event of events) {
        const existing = this.db.query(
          "SELECT event_id, body_sha256 FROM events WHERE mission_id = $mission_id AND received_seq = $seq",
        ).get({ mission_id: missionId, seq: Number(event.received_seq) }) as { event_id: string; body_sha256: string } | null;
        if (existing !== null) {
          if (existing.event_id !== event.event_id || existing.body_sha256 !== event.body_sha256) {
            throw new LobbyError("history_changed", "the service returned different bytes for an event already read");
          }
          continue;
        }
        this.db.query(
          `INSERT INTO events (mission_id, received_seq, event_id, grant_id, identity_id, signing_key_id,
             received_at, raw_body, body_sha256, proof)
           VALUES ($mission_id, $seq, $event_id, $grant_id, $identity_id, $signing_key_id,
             $received_at, $raw_body, $body_sha256, $proof)`,
        ).run({
          mission_id: missionId,
          seq: Number(event.received_seq),
          event_id: event.event_id,
          grant_id: event.grant_id,
          identity_id: event.identity_id,
          signing_key_id: event.signing_key_id,
          received_at: event.received_at,
          raw_body: event.raw_body,
          body_sha256: event.body_sha256,
          proof: JSON.stringify(event.proof),
        });
        added += 1;
      }
      this.db.query(
        `INSERT INTO cursors (mission_id, after, synced_at) VALUES ($mission_id, $after, $synced_at)
         ON CONFLICT (mission_id) DO UPDATE SET after = excluded.after, synced_at = excluded.synced_at`,
      ).run({ mission_id: missionId, after: nextCursor, synced_at: syncedAt });
      return added;
    });
  }

  events(missionId: string): MissionEvent[] {
    if (!this.available) return [];
    const rows = this.db.query("SELECT * FROM events WHERE mission_id = $mission_id ORDER BY received_seq ASC")
      .all({ mission_id: missionId }) as Row[];
    return rows.map((row) => ({
      event_id: String(row.event_id),
      mission_id: String(row.mission_id),
      grant_id: String(row.grant_id),
      identity_id: String(row.identity_id),
      signing_key_id: String(row.signing_key_id),
      received_seq: String(row.received_seq),
      received_at: String(row.received_at),
      raw_body: String(row.raw_body),
      body_sha256: String(row.body_sha256),
      proof: JSON.parse(String(row.proof)) as Record<string, string>,
    }));
  }

  // ── Outbox ─────────────────────────────────────────────────────────

  addOutbox(row: Omit<OutboxRow, "state" | "received_seq" | "stored_at">): void {
    this.write();
    this.db.query(
      `INSERT INTO outbox (event_id, mission_id, grant_id, kind, raw_body, gate_room, state, received_seq,
         created_at, stored_at)
       VALUES ($event_id, $mission_id, $grant_id, $kind, $raw_body, $gate_room, 'pending', NULL, $created_at, NULL)`,
    ).run({ ...row });
  }

  markOutboxStored(eventId: string, receivedSeq: string, storedAt: string): void {
    this.write();
    this.db.query(
      "UPDATE outbox SET state = 'stored', received_seq = $seq, stored_at = $at WHERE event_id = $event_id",
    ).run({ event_id: eventId, seq: receivedSeq, at: storedAt });
  }

  outbox(eventId: string): OutboxRow | null {
    return this.db.query("SELECT * FROM outbox WHERE event_id = $event_id").get({ event_id: eventId }) as OutboxRow | null;
  }

  listOutbox(): OutboxRow[] {
    if (!this.available) return [];
    return this.db.query("SELECT * FROM outbox ORDER BY created_at ASC, event_id ASC").all() as OutboxRow[];
  }

  // ── Hub ────────────────────────────────────────────────────────────

  hub(): HubRow | null {
    if (!this.available) return null;
    return this.db.query("SELECT * FROM hub WHERE singleton = 1").get() as HubRow | null;
  }

  createHub(row: HubRow): void {
    this.write();
    this.db.query(
      `INSERT INTO hub (singleton, project_id, origin, keychain_account, bearer_service, door_service,
         door_public_key, door_fingerprint, directory_mission_id, directory_descriptor, directory_digest,
         directory_expires_at, directory_mode, directory_state, created_at)
       VALUES (1, $project_id, $origin, $keychain_account, $bearer_service, $door_service,
         $door_public_key, $door_fingerprint, $directory_mission_id, $directory_descriptor, $directory_digest,
         $directory_expires_at, $directory_mode, $directory_state, $created_at)`,
    ).run({ ...row });
  }

  activateDirectory(): void {
    this.write();
    this.db.query("UPDATE hub SET directory_state = 'active' WHERE singleton = 1").run();
  }

  /** Forget a hub whose directory was never activated (only while pending). */
  dropPendingHub(): void {
    this.write();
    this.db.query("DELETE FROM hub WHERE singleton = 1 AND directory_state = 'pending'").run();
  }

  device(identityId: string): HubDeviceRow | null {
    return this.db.query("SELECT * FROM hub_devices WHERE identity_id = $id").get({ id: identityId }) as HubDeviceRow | null;
  }

  deviceByFingerprint(fingerprint: string): HubDeviceRow | null {
    if (!this.available) return null;
    return this.db.query("SELECT * FROM hub_devices WHERE fingerprint = $fingerprint")
      .get({ fingerprint }) as HubDeviceRow | null;
  }

  listDevices(): HubDeviceRow[] {
    if (!this.available) return [];
    return this.db.query("SELECT * FROM hub_devices ORDER BY enrolled_at ASC, identity_id ASC").all() as HubDeviceRow[];
  }

  addDevice(row: HubDeviceRow): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_devices (identity_id, signing_key_id, public_key, fingerprint, display_name, enrolled_at)
       VALUES ($identity_id, $signing_key_id, $public_key, $fingerprint, $display_name, $enrolled_at)`,
    ).run({ ...row });
  }

  addHubGrant(row: HubGrantRow): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_grants (grant_id, mission_id, identity_id, signing_key_id, actions, token_sha256, expires_at,
         purpose, room_id, state, requested_at)
       VALUES ($grant_id, $mission_id, $identity_id, $signing_key_id, $actions, $token_sha256, $expires_at,
         $purpose, $room_id, $state, $requested_at)`,
    ).run({ ...row, actions: JSON.stringify(row.actions) });
  }

  markHubGrantIssued(grantId: string, expiresAt: string): void {
    this.write();
    this.db.query("UPDATE hub_grants SET state = 'issued', expires_at = $expires_at WHERE grant_id = $grant_id")
      .run({ grant_id: grantId, expires_at: expiresAt });
  }

  /** Forget a grant the service definitely refused (a 4xx: it created
   * nothing), as a refused season is forgotten. Only a row still `requested`
   * is removed; an issued grant is never forgotten. */
  dropRequestedHubGrant(grantId: string): void {
    this.write();
    this.db.query("DELETE FROM hub_grants WHERE grant_id = $grant_id AND state = 'requested'").run({ grant_id: grantId });
  }

  hubGrantByToken(tokenSha256: string): HubGrantRow | null {
    return withActions<HubGrantRow>(this.db.query("SELECT * FROM hub_grants WHERE token_sha256 = $token")
      .get({ token: tokenSha256 }) as Row | null);
  }

  addSeason(row: SeasonRow): void {
    this.write();
    this.transaction(() => {
      if (row.state === "current") {
        this.db.query("UPDATE hub_seasons SET state = 'replaced' WHERE room_id = $room_id AND state = 'current'")
          .run({ room_id: row.room_id });
      }
      this.db.query(
        `INSERT INTO hub_seasons (mission_id, room_id, mission_digest, descriptor, expires_at, mode, state, recorded_at)
         VALUES ($mission_id, $room_id, $mission_digest, $descriptor, $expires_at, $mode, $state, $recorded_at)`,
      ).run({ ...row });
    });
  }

  makeSeasonCurrent(missionId: string): void {
    this.write();
    this.transaction(() => {
      const season = this.season(missionId);
      if (season === null) throw new LobbyError("season_not_found", "no such season");
      this.db.query("UPDATE hub_seasons SET state = 'replaced' WHERE room_id = $room_id AND state = 'current'")
        .run({ room_id: season.room_id });
      this.db.query("UPDATE hub_seasons SET state = 'current' WHERE mission_id = $mission_id").run({ mission_id: missionId });
    });
  }

  season(missionId: string): SeasonRow | null {
    return this.db.query("SELECT * FROM hub_seasons WHERE mission_id = $mission_id").get({ mission_id: missionId }) as SeasonRow | null;
  }

  /** The newest season of a room whose creation was asked for but never
   * confirmed, among those ending after `endsAfter` (a canonical timestamp). */
  pendingSeason(roomId: string, endsAfter: string): SeasonRow | null {
    if (!this.available) return null;
    return this.db.query(
      `SELECT * FROM hub_seasons WHERE room_id = $room_id AND state = 'pending' AND expires_at > $after
       ORDER BY recorded_at DESC, mission_id DESC LIMIT 1`,
    ).get({ room_id: roomId, after: endsAfter }) as SeasonRow | null;
  }

  /** Forget a pending season the service definitely refused to create. */
  dropPendingSeason(missionId: string): void {
    this.write();
    this.db.query("DELETE FROM hub_seasons WHERE mission_id = $mission_id AND state = 'pending'").run({ mission_id: missionId });
  }

  currentSeason(roomId: string): SeasonRow | null {
    if (!this.available) return null;
    return this.db.query("SELECT * FROM hub_seasons WHERE room_id = $room_id AND state = 'current'")
      .get({ room_id: roomId }) as SeasonRow | null;
  }

  nextCardSeq(roomId: string): number {
    const row = this.db.query("SELECT max(card_seq) AS seq FROM hub_cards WHERE room_id = $room_id").get({ room_id: roomId }) as
      | { seq: number | null }
      | null;
    return (row?.seq ?? 0) + 1;
  }

  addCard(row: HubCardRow): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_cards (room_id, card_seq, event_id, summary, issued_at)
       VALUES ($room_id, $card_seq, $event_id, $summary, $issued_at)`,
    ).run({ ...row });
  }

  latestCard(roomId: string): HubCardRow | null {
    if (!this.available) return null;
    return this.db.query("SELECT * FROM hub_cards WHERE room_id = $room_id ORDER BY card_seq DESC LIMIT 1")
      .get({ room_id: roomId }) as HubCardRow | null;
  }

  decision(knockId: string): DecisionRow | null {
    if (!this.available) return null;
    return this.db.query("SELECT * FROM hub_decisions WHERE knock_id = $knock_id").get({ knock_id: knockId }) as DecisionRow | null;
  }

  addDecision(row: DecisionRow): void {
    this.write();
    try {
      this.db.query(
        `INSERT INTO hub_decisions (knock_id, room_id, identity_id, knock_sha256, decision, decided_at, summary)
         VALUES ($knock_id, $room_id, $identity_id, $knock_sha256, $decision, $decided_at, $summary)`,
      ).run({ ...row });
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new LobbyError("knock_decided", "this knock was already decided");
      throw error;
    }
  }

  addMember(row: MemberRow): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_members (mission_id, room_id, identity_id, tier, term_ends_at, knock_id, grant_id, admitted_at)
       VALUES ($mission_id, $room_id, $identity_id, $tier, $term_ends_at, $knock_id, $grant_id, $admitted_at)
       ON CONFLICT (mission_id, identity_id) DO UPDATE SET tier = excluded.tier, term_ends_at = excluded.term_ends_at,
         knock_id = excluded.knock_id, grant_id = excluded.grant_id, admitted_at = excluded.admitted_at,
         state = 'active', paused_at = NULL, changed_at = excluded.admitted_at`,
    ).run({
      mission_id: row.mission_id, room_id: row.room_id, identity_id: row.identity_id, tier: row.tier,
      term_ends_at: row.term_ends_at, knock_id: row.knock_id, grant_id: row.grant_id, admitted_at: row.admitted_at,
    });
  }

  members(missionId: string): MemberRow[] {
    if (!this.available) return [];
    return this.db.query("SELECT * FROM hub_members WHERE mission_id = $mission_id ORDER BY admitted_at ASC, identity_id ASC")
      .all({ mission_id: missionId }) as MemberRow[];
  }

  // ── Version 3: desk side ───────────────────────────────────────────

  /** This desk's season grants for a room, newest first (read-only views too). */
  deskSeasonGrants(roomId: string): DeskGrantRow[] {
    if (!this.available) return [];
    return (this.db.query(
      `SELECT * FROM desk_grants WHERE purpose = 'season' AND room_id = $room_id
       ORDER BY recorded_at DESC, grant_id DESC`,
    ).all({ room_id: roomId }) as Row[]).map((row) => withActions<DeskGrantRow>(row)!);
  }

  /** The room a mission belongs to, as this desk's own grants record it. */
  roomOfMission(missionId: string): string | null {
    if (!this.available) return null;
    const row = this.db.query(
      "SELECT room_id FROM desk_grants WHERE mission_id = $mission_id AND room_id IS NOT NULL LIMIT 1",
    ).get({ mission_id: missionId }) as { room_id: string } | null;
    return row?.room_id ?? null;
  }

  markDeskGrantLeft(grantId: string, at: string): void {
    this.write();
    this.db.query("UPDATE desk_grants SET left_at = $at WHERE grant_id = $grant_id AND left_at IS NULL").run({ grant_id: grantId, at });
  }

  addDeskRenewal(row: Omit<DeskRenewalRow, "accepted_grant_id" | "accepted_at">): void {
    this.write();
    this.db.query(
      `INSERT INTO desk_renewals (token_sha256, room_id, mission_id, posted_mission_id, request_event_id, requested_at,
         accepted_grant_id, accepted_at)
       VALUES ($token_sha256, $room_id, $mission_id, $posted_mission_id, $request_event_id, $requested_at, NULL, NULL)`,
    ).run({ ...row });
  }

  /** Renew requests this desk sent for a room, newest first. */
  deskRenewals(roomId: string): DeskRenewalRow[] {
    if (!this.v3) return [];
    return this.db.query("SELECT * FROM desk_renewals WHERE room_id = $room_id ORDER BY requested_at DESC, token_sha256 ASC")
      .all({ room_id: roomId }) as DeskRenewalRow[];
  }

  markDeskRenewalAccepted(tokenSha256: string, grantId: string, at: string): void {
    this.write();
    const result = this.db.query(
      `UPDATE desk_renewals SET accepted_grant_id = $grant_id, accepted_at = $at
       WHERE token_sha256 = $token AND accepted_at IS NULL`,
    ).run({ token: tokenSha256, grant_id: grantId, at });
    if (result.changes !== 1) throw new LobbyError("renewal_used", "this renewal was already accepted");
  }

  // ── Version 3: hub side ────────────────────────────────────────────

  setHubStopped(at: string): void {
    this.write();
    this.db.query("UPDATE hub SET stopped_at = coalesce(stopped_at, $at) WHERE singleton = 1").run({ at });
  }

  setDirectoryRevoked(at: string): void {
    this.write();
    this.db.query("UPDATE hub SET directory_revoked_at = coalesce(directory_revoked_at, $at) WHERE singleton = 1").run({ at });
  }

  listHubGrants(): HubGrantRow[] {
    if (!this.available) return [];
    return (this.db.query("SELECT * FROM hub_grants ORDER BY requested_at ASC, grant_id ASC").all() as Row[])
      .map((row) => withActions<HubGrantRow>(row)!);
  }

  /** Grants this hub requested for one identity in the given missions. */
  hubGrantsOf(identityId: string, missionIds: readonly string[]): HubGrantRow[] {
    const wanted = new Set(missionIds);
    return this.listHubGrants().filter((grant) => grant.identity_id === identityId && wanted.has(grant.mission_id));
  }

  markHubGrantRevoke(grantId: string, state: "requested" | "revoked", at: string | null): void {
    this.write();
    this.db.query(
      `UPDATE hub_grants SET revoke_state = CASE WHEN revoke_state = 'revoked' THEN 'revoked' ELSE $state END,
         revoked_at = coalesce(revoked_at, $at) WHERE grant_id = $grant_id`,
    ).run({ grant_id: grantId, state, at });
  }

  listSeasons(): SeasonRow[] {
    if (!this.available) return [];
    return this.db.query("SELECT * FROM hub_seasons ORDER BY recorded_at ASC, mission_id ASC").all() as SeasonRow[];
  }

  seasonsOfRoom(roomId: string): SeasonRow[] {
    return this.listSeasons().filter((season) => season.room_id === roomId);
  }

  markSeasonRevoked(missionId: string, at: string): void {
    this.write();
    this.db.query("UPDATE hub_seasons SET revoked_at = coalesce(revoked_at, $at) WHERE mission_id = $mission_id").run({ mission_id: missionId, at });
  }

  member(missionId: string, identityId: string): MemberRow | null {
    if (!this.available) return null;
    return this.db.query("SELECT * FROM hub_members WHERE mission_id = $mission_id AND identity_id = $identity_id")
      .get({ mission_id: missionId, identity_id: identityId }) as MemberRow | null;
  }

  /** Members whose state is active and whose term runs past `now`. */
  activeMembers(missionId: string, now: Date): MemberRow[] {
    return this.members(missionId).filter((row) => (row.state ?? "active") === "active" && Date.parse(row.term_ends_at) > now.getTime());
  }

  allMembers(): MemberRow[] {
    if (!this.available) return [];
    return this.db.query("SELECT * FROM hub_members ORDER BY room_id ASC, admitted_at ASC, identity_id ASC").all() as MemberRow[];
  }

  setMemberState(missionId: string, identityId: string, state: MemberState, at: string): void {
    this.write();
    this.db.query(
      "UPDATE hub_members SET state = $state, changed_at = $at WHERE mission_id = $mission_id AND identity_id = $identity_id",
    ).run({ mission_id: missionId, identity_id: identityId, state, at });
  }

  setMemberPaused(missionId: string, identityId: string, pausedAt: string | null): void {
    this.write();
    this.db.query("UPDATE hub_members SET paused_at = $paused_at WHERE mission_id = $mission_id AND identity_id = $identity_id")
      .run({ mission_id: missionId, identity_id: identityId, paused_at: pausedAt });
  }

  nextRosterSeq(missionId: string): number {
    if (!this.v3) return 1;
    const row = this.db.query("SELECT max(roster_seq) AS seq FROM hub_rosters WHERE mission_id = $mission_id")
      .get({ mission_id: missionId }) as { seq: number | null } | null;
    return (row?.seq ?? 0) + 1;
  }

  addRoster(row: RosterRow): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_rosters (mission_id, roster_seq, room_id, members, issued_at)
       VALUES ($mission_id, $roster_seq, $room_id, $members, $issued_at)`,
    ).run({ ...row });
  }

  addRenewal(row: RenewalRow): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_renewals (token_sha256, room_id, mission_id, identity_id, grant_id, basis, request_event_id,
         note_event_id, renewed_at)
       VALUES ($token_sha256, $room_id, $mission_id, $identity_id, $grant_id, $basis, $request_event_id,
         $note_event_id, $renewed_at)`,
    ).run({ ...row });
  }

  renewal(tokenSha256: string): RenewalRow | null {
    if (!this.v3) return null;
    return this.db.query("SELECT * FROM hub_renewals WHERE token_sha256 = $token").get({ token: tokenSha256 }) as RenewalRow | null;
  }

  listRenewals(): RenewalRow[] {
    if (!this.v3) return [];
    return this.db.query("SELECT * FROM hub_renewals ORDER BY renewed_at ASC, token_sha256 ASC").all() as RenewalRow[];
  }

  block(roomId: string, identityId: string, at: string): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_blocks (room_id, identity_id, blocked_at) VALUES ($room_id, $identity_id, $at)
       ON CONFLICT (room_id, identity_id) DO NOTHING`,
    ).run({ room_id: roomId, identity_id: identityId, at });
  }

  unblock(roomId: string, identityId: string): boolean {
    this.write();
    return this.db.query("DELETE FROM hub_blocks WHERE room_id = $room_id AND identity_id = $identity_id")
      .run({ room_id: roomId, identity_id: identityId }).changes === 1;
  }

  isBlocked(roomId: string, identityId: string): boolean {
    if (!this.v3) return false;
    return this.db.query("SELECT 1 AS blocked FROM hub_blocks WHERE room_id = $room_id AND identity_id = $identity_id")
      .get({ room_id: roomId, identity_id: identityId }) !== null;
  }

  listBlocks(): BlockRow[] {
    if (!this.v3) return [];
    return this.db.query("SELECT * FROM hub_blocks ORDER BY blocked_at ASC, room_id ASC, identity_id ASC").all() as BlockRow[];
  }

  addExtraGrant(row: Omit<ExtraGrantRow, "revoke_state" | "revoked_at">): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_extra_grants (grant_id, mission_id, room_id, identity_id, recorded_at, revoke_state, revoked_at)
       VALUES ($grant_id, $mission_id, $room_id, $identity_id, $recorded_at, NULL, NULL)
       ON CONFLICT (grant_id) DO NOTHING`,
    ).run({ ...row });
  }

  listExtraGrants(): ExtraGrantRow[] {
    if (!this.v3) return [];
    return this.db.query("SELECT * FROM hub_extra_grants ORDER BY recorded_at ASC, grant_id ASC").all() as ExtraGrantRow[];
  }

  markExtraGrantRevoke(grantId: string, state: "requested" | "revoked", at: string | null): void {
    this.write();
    this.db.query(
      `UPDATE hub_extra_grants SET revoke_state = CASE WHEN revoke_state = 'revoked' THEN 'revoked' ELSE $state END,
         revoked_at = coalesce(revoked_at, $at) WHERE grant_id = $grant_id`,
    ).run({ grant_id: grantId, state, at });
  }

  processedNote(eventId: string): { outcome: string } | null {
    if (!this.v3) return null;
    return this.db.query("SELECT outcome FROM hub_processed_notes WHERE event_id = $event_id").get({ event_id: eventId }) as { outcome: string } | null;
  }

  addProcessedNote(row: { event_id: string; kind: string; identity_id: string; outcome: string; processed_at: string }): void {
    this.write();
    this.db.query(
      `INSERT INTO hub_processed_notes (event_id, kind, identity_id, outcome, processed_at)
       VALUES ($event_id, $kind, $identity_id, $outcome, $processed_at) ON CONFLICT (event_id) DO NOTHING`,
    ).run({ ...row });
  }

  // ── Version 4: directory renewal ───────────────────────────────────

  private writeV4(): void {
    this.write();
    if (!this.v4) throw new LobbyError("state_not_upgraded", "this desk state has no version-4 directory renewal tables yet");
  }

  setDeskDirectoryExpiry(expiresAt: string): void {
    this.writeV4();
    this.db.query("UPDATE desk SET directory_expires_at = $at WHERE singleton = 1").run({ at: expiresAt });
  }

  addDeskDirectoryRenewal(row: Omit<DeskDirectoryRenewalRow, "accepted_at">): void {
    this.writeV4();
    this.db.query(
      `INSERT INTO desk_directory_renewals (token_sha256, mission_id, grant_id, posted_mission_id, request_event_id,
         requested_at, expires_at, accepted_at)
       VALUES ($token_sha256, $mission_id, $grant_id, $posted_mission_id, $request_event_id, $requested_at, $expires_at, NULL)`,
    ).run({ ...row });
  }

  /** This desk's directory renew requests, newest first. */
  deskDirectoryRenewals(): DeskDirectoryRenewalRow[] {
    if (!this.v4) return [];
    return this.db.query("SELECT * FROM desk_directory_renewals ORDER BY requested_at DESC, token_sha256 ASC")
      .all() as DeskDirectoryRenewalRow[];
  }

  markDeskDirectoryRenewalAccepted(tokenSha256: string, at: string): void {
    this.writeV4();
    const result = this.db.query(
      "UPDATE desk_directory_renewals SET accepted_at = $at WHERE token_sha256 = $token AND accepted_at IS NULL",
    ).run({ token: tokenSha256, at });
    if (result.changes !== 1) throw new LobbyError("renewal_used", "this directory renewal was already picked up");
  }

  setDevicePaused(identityId: string, pausedAt: string | null): void {
    this.writeV4();
    this.db.query("UPDATE hub_devices SET directory_paused_at = $paused_at WHERE identity_id = $id")
      .run({ id: identityId, paused_at: pausedAt });
  }

  hubGrant(grantId: string): HubGrantRow | null {
    if (!this.available) return null;
    return withActions<HubGrantRow>(this.db.query("SELECT * FROM hub_grants WHERE grant_id = $grant_id")
      .get({ grant_id: grantId }) as Row | null);
  }

  addDirectoryRenewal(row: DirectoryRenewalRow): void {
    this.writeV4();
    this.db.query(
      `INSERT INTO hub_directory_renewals (token_sha256, mission_id, identity_id, grant_id, request_event_id,
         notice_event_id, renewed_at)
       VALUES ($token_sha256, $mission_id, $identity_id, $grant_id, $request_event_id, $notice_event_id, $renewed_at)`,
    ).run({ ...row });
  }

  directoryRenewal(tokenSha256: string): DirectoryRenewalRow | null {
    if (!this.v4) return null;
    return this.db.query("SELECT * FROM hub_directory_renewals WHERE token_sha256 = $token")
      .get({ token: tokenSha256 }) as DirectoryRenewalRow | null;
  }

  listDirectoryRenewals(): DirectoryRenewalRow[] {
    if (!this.v4) return [];
    return this.db.query("SELECT * FROM hub_directory_renewals ORDER BY renewed_at ASC, token_sha256 ASC").all() as DirectoryRenewalRow[];
  }

  listDecisions(): DecisionRow[] {
    if (!this.available) return [];
    return this.db.query("SELECT * FROM hub_decisions ORDER BY decided_at ASC, knock_id ASC").all() as DecisionRow[];
  }
}
