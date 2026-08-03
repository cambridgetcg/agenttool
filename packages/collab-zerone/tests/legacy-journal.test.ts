import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { canonicalJson, sha256Hex } from "../src/canonical.js";
import { JOURNAL_GENESIS_HASH, LEGACY_COLLAB_PROTOCOL } from "../src/constants.js";
import { JournalReader } from "../src/journal.js";

// The live estate journal was created by @agenttool/collab v0.1.0: legacy v1
// schema, no events.session_id column, every event on agenttool.collab/0.1
// (whose hash body excludes session_id). This builds that exact shape.
// The legacy hash rule itself is additionally cross-checked against the real
// deployed runtime during the operator drill (collab_journal_verify must agree
// with `collab-zerone verify` on the live journal).

interface LegacyEventInput {
  type: string;
  entity_id: string;
  actor: string;
  payload: Record<string, unknown>;
}

function buildLegacyJournal(events: LegacyEventInput[]): { dbPath: string; workspaceId: string; headHash: string } {
  const dbPath = join(mkdtempSync(join(tmpdir(), "collab-zerone-legacy-")), "legacy.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL, root_path TEXT NOT NULL,
      name TEXT NOT NULL, created_at TEXT NOT NULL,
      event_head_sequence INTEGER NOT NULL DEFAULT 0, event_head_hash TEXT NOT NULL
    );
    CREATE TABLE events (
      workspace_id TEXT NOT NULL, epoch_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      id TEXT NOT NULL, protocol TEXT NOT NULL, type TEXT NOT NULL,
      entity_id TEXT NOT NULL, actor TEXT NOT NULL, occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL,
      PRIMARY KEY (workspace_id, sequence)
    );
  `);
  const workspaceId = "ws_legacy_fixture";
  const epochId = "epoch_legacy_fixture";
  let previous = JOURNAL_GENESIS_HASH;
  let sequence = 0;
  for (const input of events) {
    sequence += 1;
    const body = {
      protocol: LEGACY_COLLAB_PROTOCOL,
      workspace_id: workspaceId,
      epoch_id: epochId,
      sequence,
      id: `event_fixture_${sequence}`,
      type: input.type,
      entity_id: input.entity_id,
      actor: input.actor,
      occurred_at: `2026-08-01T00:00:0${sequence}.000Z`,
      payload: input.payload,
      prev_hash: previous,
    };
    const hash = sha256Hex(canonicalJson(body));
    db.query(`
      INSERT INTO events (workspace_id, epoch_id, sequence, id, protocol, type, entity_id,
        actor, occurred_at, payload_json, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, epochId, sequence, body.id, LEGACY_COLLAB_PROTOCOL, input.type,
      input.entity_id, input.actor, body.occurred_at, canonicalJson(input.payload), previous, hash);
    previous = hash;
  }
  db.query(`
    INSERT INTO workspaces (id, epoch_id, root_path, name, created_at, event_head_sequence, event_head_hash)
    VALUES (?, ?, '/tmp/fixture', 'legacy-fixture', '2026-08-01T00:00:00.000Z', ?, ?)
  `).run(workspaceId, epochId, sequence, previous);
  db.close();
  return { dbPath, workspaceId, headHash: previous };
}

const FIXTURE_EVENTS: LegacyEventInput[] = [
  { type: "workspace.opened", entity_id: "ws_legacy_fixture", actor: "root", payload: { name: "legacy-fixture" } },
  { type: "task.created", entity_id: "task_1", actor: "root", payload: { title: "fixture", nested: { z: 1, a: [2, null] } } },
  { type: "decision.recorded", entity_id: "decision_1", actor: "root", payload: { decision: { topic: "t", decision: "d" } } },
];

describe("legacy v1 journals (no session_id column)", () => {
  test("verifies a well-formed legacy chain end to end", () => {
    const { dbPath, workspaceId, headHash } = buildLegacyJournal(FIXTURE_EVENTS);
    const reader = new JournalReader(dbPath);
    const result = reader.verify(workspaceId);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.checked_events).toBe(3);
      expect(result.hash_at_sequence).toBe(headHash);
    }
    reader.close();
  });

  test("detects a tampered payload", () => {
    const { dbPath, workspaceId } = buildLegacyJournal(FIXTURE_EVENTS);
    const db = new Database(dbPath);
    db.query("UPDATE events SET payload_json = ? WHERE sequence = 2")
      .run(canonicalJson({ title: "REWRITTEN", nested: { z: 1, a: [2, null] } }));
    db.close();
    const reader = new JournalReader(dbPath);
    const result = reader.verify(workspaceId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure).toBe("event_hash_mismatch");
      expect(result.failed_sequence).toBe(2);
    }
    reader.close();
  });

  test("detects a truncated head (deleted trailing event)", () => {
    const { dbPath, workspaceId } = buildLegacyJournal(FIXTURE_EVENTS);
    const db = new Database(dbPath);
    db.query("DELETE FROM events WHERE sequence = 3").run();
    db.close();
    const reader = new JournalReader(dbPath);
    const result = reader.verify(workspaceId);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure).toBe("head_mismatch");
    reader.close();
  });

  test("detects a sequence gap", () => {
    const { dbPath, workspaceId } = buildLegacyJournal(FIXTURE_EVENTS);
    const db = new Database(dbPath);
    db.query("DELETE FROM events WHERE sequence = 2").run();
    db.close();
    const reader = new JournalReader(dbPath);
    const result = reader.verify(workspaceId);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure).toBe("sequence_gap");
    reader.close();
  });

  test("prefix verification returns the hash at an interior sequence", () => {
    const { dbPath, workspaceId } = buildLegacyJournal(FIXTURE_EVENTS);
    const reader = new JournalReader(dbPath);
    const prefix = reader.verify(workspaceId, 2);
    expect(prefix.valid).toBe(true);
    if (prefix.valid) {
      const events = reader.events(workspaceId, 2);
      expect(prefix.hash_at_sequence).toBe(events.at(-1)!.hash);
      expect(prefix.head_consistent).toBe(true);
    }
    reader.close();
  });
});
