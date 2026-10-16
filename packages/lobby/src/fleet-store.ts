/** Fleet-hall state in lobby.sqlite (schema version 2).
 *
 * Desk side (every enrolled device): its desk identity and directory join,
 * the grants it holds, the knocks it sent, a cache of mission events it read,
 * and an outbox of exact observation bytes saved before sending.
 * Hub side (the one device holding the door): hub configuration, enrolled
 * fleet devices, grants it issued, room seasons, published cards, knock
 * decisions and memberships.
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
}

export interface HubDeviceRow {
  identity_id: string;
  signing_key_id: string;
  public_key: string;
  fingerprint: string;
  display_name: string;
  enrolled_at: string;
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
}

type Row = Record<string, unknown>;

function withActions<T extends { actions: MissionAction[] }>(row: Row | null): T | null {
  if (row === null) return null;
  return { ...row, actions: JSON.parse(String(row.actions)) } as unknown as T;
}

/** Fleet tables over the same handle as LobbyStore. Writes require a
 * writable store; the MCP's read-only handle can only call readers. */
export class FleetStore {
  constructor(
    private readonly db: Database,
    private readonly writable: boolean,
    readonly available: boolean,
  ) {}

  private write(): void {
    if (!this.writable) throw new LobbyError("read_only", "this desk view is read-only");
    if (!this.available) throw new LobbyError("state_not_upgraded", "this desk state has no fleet tables yet");
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

  /** The accepted grant for a mission that lasts longest past `now`. */
  currentDeskGrant(missionId: string, now: Date): DeskGrantRow | null {
    return withActions<DeskGrantRow>(this.db.query(
      `SELECT * FROM desk_grants WHERE mission_id = $mission_id AND accepted_at IS NOT NULL
         AND expires_at > $now ORDER BY expires_at DESC LIMIT 1`,
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
         knock_id = excluded.knock_id, grant_id = excluded.grant_id, admitted_at = excluded.admitted_at`,
    ).run({ ...row });
  }

  members(missionId: string): MemberRow[] {
    if (!this.available) return [];
    return this.db.query("SELECT * FROM hub_members WHERE mission_id = $mission_id ORDER BY admitted_at ASC, identity_id ASC")
      .all({ mission_id: missionId }) as MemberRow[];
  }
}
