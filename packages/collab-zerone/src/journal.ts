import { Database } from "bun:sqlite";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { JOURNAL_GENESIS_HASH, LEGACY_COLLAB_PROTOCOL } from "./constants.js";

export interface JournalWorkspace {
  id: string;
  epoch_id: string;
  root_path: string;
  name: string;
  created_at: string;
  event_head_sequence: number;
  event_head_hash: string;
}

export interface JournalEventRow {
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  id: string;
  protocol: string;
  type: string;
  entity_id: string;
  actor: string;
  session_id: string | null;
  occurred_at: string;
  payload_json: string;
  prev_hash: string;
  hash: string;
}

export type JournalVerification =
  | {
    valid: true;
    checked_events: number;
    hash_at_sequence: string;
    head_consistent: boolean;
  }
  | {
    valid: false;
    checked_events: number;
    failure:
      | "workspace_not_found"
      | "sequence_gap"
      | "prev_hash_mismatch"
      | "event_hash_mismatch"
      | "payload_unparseable"
      | "missing_events"
      | "head_mismatch";
    failed_sequence?: number;
  };

/**
 * Read-only view over an agenttool-collab SQLite journal.
 *
 * Deliberately does NOT use @agenttool/collab's CollabStore: opening a shared
 * database through a newer store would run schema migrations on a file that an
 * older deployed runtime still owns. This reader opens readonly and adapts to
 * both the legacy v1 schema (no events.session_id column) and v2+/v3 schemas.
 */
export class JournalReader {
  private readonly db: Database;
  private readonly hasSessionColumn: boolean;

  constructor(path: string) {
    this.db = new Database(path, { readonly: true });
    // Live journals are written concurrently; wait out WAL recovery instead
    // of surfacing a spurious "database is locked".
    this.db.exec("PRAGMA busy_timeout = 5000");
    const col = this.db
      .query("SELECT name FROM pragma_table_info('events') WHERE name = 'session_id'")
      .get() as { name: string } | null;
    this.hasSessionColumn = col !== null;
  }

  listWorkspaces(): JournalWorkspace[] {
    return this.db.query(`
      SELECT id, epoch_id, root_path, name, created_at, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY created_at
    `).all() as JournalWorkspace[];
  }

  getWorkspace(workspaceId: string): JournalWorkspace | null {
    return this.db.query(`
      SELECT id, epoch_id, root_path, name, created_at, event_head_sequence, event_head_hash
      FROM workspaces WHERE id = ?
    `).get(workspaceId) as JournalWorkspace | null;
  }

  events(workspaceId: string, uptoSequence?: number): JournalEventRow[] {
    const sessionColumn = this.hasSessionColumn ? "session_id" : "NULL AS session_id";
    const upperBound = uptoSequence === undefined ? "" : " AND sequence <= ?";
    const query = this.db.query(`
      SELECT workspace_id, epoch_id, sequence, id, protocol, type, entity_id, actor,
        ${sessionColumn}, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ?${upperBound} ORDER BY sequence
    `);
    const rows = uptoSequence === undefined
      ? query.all(workspaceId)
      : query.all(workspaceId, uptoSequence);
    return rows as JournalEventRow[];
  }

  /**
   * Recompute the hash chain from genesis. With uptoSequence, verifies the
   * prefix 1..uptoSequence and reports the recomputed hash at that sequence;
   * without it, verifies the whole journal including the stored head pointer.
   *
   * The workspace head and the event rows are read inside one deferred read
   * transaction: on a live journal, reading them in separate snapshots lets a
   * concurrent append masquerade as a head_mismatch tamper verdict.
   */
  verify(workspaceId: string, uptoSequence?: number): JournalVerification {
    const run = this.db.transaction(() => this.verifySnapshot(workspaceId, uptoSequence));
    return run.deferred() as JournalVerification;
  }

  private verifySnapshot(workspaceId: string, uptoSequence?: number): JournalVerification {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      return { valid: false, checked_events: 0, failure: "workspace_not_found" };
    }
    const rows = this.events(workspaceId, uptoSequence);
    let previous = JOURNAL_GENESIS_HASH;
    let checked = 0;
    for (const row of rows) {
      if (row.sequence !== checked + 1) {
        return { valid: false, checked_events: checked, failure: "sequence_gap", failed_sequence: row.sequence };
      }
      if (row.prev_hash !== previous) {
        return { valid: false, checked_events: checked, failure: "prev_hash_mismatch", failed_sequence: row.sequence };
      }
      let recomputed: string;
      try {
        recomputed = eventRowHash(row);
      } catch {
        return { valid: false, checked_events: checked, failure: "payload_unparseable", failed_sequence: row.sequence };
      }
      if (recomputed !== row.hash) {
        return { valid: false, checked_events: checked, failure: "event_hash_mismatch", failed_sequence: row.sequence };
      }
      previous = row.hash;
      checked += 1;
    }
    if (uptoSequence !== undefined) {
      if (checked !== uptoSequence) {
        return { valid: false, checked_events: checked, failure: "missing_events" };
      }
      return {
        valid: true,
        checked_events: checked,
        hash_at_sequence: previous,
        head_consistent: workspace.event_head_sequence >= uptoSequence,
      };
    }
    if (workspace.event_head_sequence !== checked || workspace.event_head_hash !== previous) {
      return { valid: false, checked_events: checked, failure: "head_mismatch" };
    }
    return { valid: true, checked_events: checked, hash_at_sequence: previous, head_consistent: true };
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Mirrors @agenttool/collab eventHash + eventFromRow: the hashed body is the
 * event minus its own hash, with session_id additionally excluded for legacy
 * agenttool.collab/0.1 events (which predate presence sessions).
 */
export function eventRowHash(row: JournalEventRow): string {
  const body: Record<string, unknown> = {
    protocol: row.protocol,
    workspace_id: row.workspace_id,
    epoch_id: row.epoch_id,
    sequence: row.sequence,
    id: row.id,
    type: row.type,
    entity_id: row.entity_id,
    actor: row.actor,
    occurred_at: row.occurred_at,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    prev_hash: row.prev_hash,
  };
  if (row.protocol !== LEGACY_COLLAB_PROTOCOL) {
    body.session_id = row.session_id;
  }
  return sha256Hex(canonicalJson(body));
}
