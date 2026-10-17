import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_FILE } from "../src/home.js";
import { ingestClaudeSession, ingestCodexRollout } from "../src/ingest.js";
import { SeatLedger } from "../src/ledger.js";
import {
  CLAUDE_NEXT,
  CLAUDE_SESSION,
  CODEX_CHILD,
  CODEX_FORK,
  CODEX_GRANDCHILD,
  CODEX_ROOT,
  expectNoMarkers,
  writeClaudeProject,
  writeCodexSessions,
} from "./fixtures.js";

const IDENTITY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_IDENTITY = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

let directory: string;
let home: string;
let ledger: SeatLedger;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "execution-seat-ledger-"));
  home = join(directory, "state");
  ledger = SeatLedger.open(home);
});

afterEach(() => {
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

function ledgerBytes(): string {
  const base = join(home, DATABASE_FILE);
  return ["", "-wal", "-shm"].map((suffix) => (existsSync(base + suffix) ? readFileSync(base + suffix, "latin1") : "")).join("");
}

describe("private, append-only ledger", () => {
  test("creates a 0700 home and a 0600 database, and refuses wider modes", () => {
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, DATABASE_FILE)).mode & 0o777).toBe(0o600);
    ledger.close();
    chmodSync(home, 0o755);
    expect(() => SeatLedger.open(home)).toThrow("must be 700");
    chmodSync(home, 0o700);
    chmodSync(join(home, DATABASE_FILE), 0o644);
    expect(() => SeatLedger.open(home)).toThrow("must be 600");
    chmodSync(join(home, DATABASE_FILE), 0o600);
    ledger = SeatLedger.open(home);
  });

  test("refuses updates and deletes at the storage layer", () => {
    ingestClaudeSession(ledger, writeClaudeProject(directory));
    const raw = new Database(join(home, DATABASE_FILE));
    try {
      expect(() => raw.exec("UPDATE entries SET body = '{}'")).toThrow("append-only");
      expect(() => raw.exec("DELETE FROM entries")).toThrow("append-only");
      expect(() => raw.exec("DELETE FROM seats")).toThrow("append-only");
    } finally {
      raw.close();
    }
  });

  test("keeps one device id across reopenings", () => {
    const device = ledger.deviceId;
    ledger.close();
    ledger = SeatLedger.open(home);
    expect(ledger.deviceId).toBe(device);
  });
});

describe("seats", () => {
  test("one native handle is one seat, and re-ingesting appends nothing", () => {
    const transcript = writeClaudeProject(directory);
    const first = ingestClaudeSession(ledger, transcript);
    expect(first).toMatchObject({ created: true, settings_appended: 3, rows_recorded: 5, rows_marked_gone: 0, warnings: [] });
    const entries = () => (new Database(join(home, DATABASE_FILE), { readonly: true }).query("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n;
    const before = entries();
    const again = ingestClaudeSession(ledger, transcript);
    expect(again).toMatchObject({ seat_id: first.seat_id, created: false, settings_appended: 0, rows_recorded: 0 });
    expect(entries()).toBe(before);
    const seat = ledger.findSeat("claude-code", { session_id: CLAUDE_SESSION });
    expect(seat).toMatchObject({
      type: "execution-seat/v1",
      seat_id: first.seat_id,
      persistence: "durable",
      relation: null,
      device_id: ledger.deviceId,
      harness: { name: "claude-code", version: "2.1.302" },
      started_at: "2026-10-17T09:00:00.000Z",
      last_seen_at: "2026-10-17T09:04:00.000Z",
    });
    expect(seat?.settings[1]?.evidence).toEqual({ thinking_drop: "model_mismatch" });
    expect(seat?.children.map((row) => row.child_ref).sort()).toEqual(["anested02", "aplain01"]);
    expect(seat?.children.find((row) => row.child_ref === "anested02")?.parent_ref).toBe("aplain01");
  });

  test("a continued-in pointer opens the next session as a continuation seat", () => {
    const first = ingestClaudeSession(ledger, writeClaudeProject(directory));
    const next = ledger.findSeat("claude-code", { session_id: CLAUDE_NEXT });
    expect(next).toMatchObject({ parent_seat_id: first.seat_id, relation: "continuation" });
  });

  test("settings only grow when model, effort or provider changes", () => {
    const { seat } = ledger.openSeat({ harness: "declared-harness", native_ref: { run: "r1" } });
    const at = (minute: number) => `2026-10-17T12:0${minute}:00.000Z`;
    const entry = (minute: number, effort: string) => ({
      at: at(minute), model: "m", effort, provider: null, basis: "declared" as const, evidence: null,
    });
    expect(ledger.recordSettings(seat.seat_id, [entry(1, "high"), entry(2, "high"), entry(3, "low")])).toBe(2);
    expect(ledger.recordSettings(seat.seat_id, [entry(4, "low"), entry(5, "high")])).toBe(1);
    expect(ledger.getSeat(seat.seat_id)?.settings.map((e) => e.effort)).toEqual(["high", "low", "high"]);
  });

  test("identity: a root seat binds once; a child inherits only identity_id and cannot be bound", () => {
    const first = ingestClaudeSession(ledger, writeClaudeProject(directory));
    expect(ledger.bindIdentity(first.seat_id, IDENTITY, "key-01")).toBe(true);
    expect(ledger.bindIdentity(first.seat_id, IDENTITY, "key-01")).toBe(false);
    expect(() => ledger.bindIdentity(first.seat_id, OTHER_IDENTITY)).toThrow("already bound");
    const child = ledger.promoteChild(first.seat_id, "aplain01");
    expect(child).toMatchObject({
      relation: "child", parent_seat_id: first.seat_id, persistence: "recorded",
      identity_id: IDENTITY, signing_key_id: null, native_ref: { session_id: CLAUDE_SESSION, agent_id: "aplain01" },
    });
    expect(child.settings.map((e) => e.model)).toEqual(["claude-sonnet-5-5"]);
    expect(child.ended_at).toBe("2026-10-17T09:00:40.000Z");
    expect(() => ledger.bindIdentity(child.seat_id, OTHER_IDENTITY)).toThrow("inherits");
    expect(ledger.getSeat(first.seat_id)?.children.find((row) => row.child_ref === "aplain01")?.seat_id).toBe(child.seat_id);
  });

  test("persistence never moves back down", () => {
    const first = ingestClaudeSession(ledger, writeClaudeProject(directory));
    const child = ledger.promoteChild(first.seat_id, "aplain01", "recorded");
    expect(ledger.setPersistence(child.seat_id, "durable")).toBe(true);
    expect(() => ledger.setPersistence(child.seat_id, "recorded")).toThrow("never moves back down");
    expect(ledger.promoteChild(first.seat_id, "aplain01", "recorded").persistence).toBe("durable");
  });

  test("summary rows outlive the native transcript (R2) and are marked gone once", () => {
    const transcript = writeClaudeProject(directory);
    const first = ingestClaudeSession(ledger, transcript);
    const subagents = join(directory, "projects", "-Users-someone", CLAUDE_SESSION, "subagents");
    rmSync(join(subagents, "agent-anested02.jsonl"));
    rmSync(join(subagents, "workflows"), { recursive: true });
    const second = ingestClaudeSession(ledger, transcript);
    expect(second.rows_marked_gone).toBe(4);
    expect(ingestClaudeSession(ledger, transcript).rows_marked_gone).toBe(0);
    const seat = ledger.getSeat(first.seat_id);
    expect(seat?.children).toHaveLength(2);
    expect(seat?.children.find((row) => row.child_ref === "anested02")?.native_gone_at).not.toBeNull();
    expect(seat?.children.find((row) => row.child_ref === "aplain01")?.native_gone_at).toBeNull();
    const [group] = ledger.groupsFor(first.seat_id);
    expect(group?.members).toHaveLength(3);
    expect(group?.members.every((row) => row.native_gone_at !== null)).toBe(true);
  });

  test("lists seats with pagination and no cap on how many an identity holds", () => {
    for (let index = 0; index < 7; index += 1) {
      const { seat } = ledger.openSeat({ harness: "declared-harness", native_ref: { run: `r${index}` } });
      ledger.bindIdentity(seat.seat_id, IDENTITY);
    }
    const first = ledger.listSeats({ limit: 4 });
    expect(first.items).toHaveLength(4);
    const second = ledger.listSeats({ limit: 4, after: first.next ?? 0 });
    expect(second.items).toHaveLength(3);
    expect(second.next).toBeNull();
    expect([...first.items, ...second.items].every((seat) => seat.identity_id === IDENTITY)).toBe(true);
  });
});

describe("groups", () => {
  test("a workflow run is one group whose members are L1 rows with no labels", () => {
    const first = ingestClaudeSession(ledger, writeClaudeProject(directory));
    ledger.bindIdentity(first.seat_id, IDENTITY);
    const [group] = ledger.groupsFor(first.seat_id);
    expect(group).toMatchObject({
      type: "execution-seat-group/v1", kind: "workflow", orchestrator_seat_id: first.seat_id, identity_id: IDENTITY,
      native_ref: { session_id: CLAUDE_SESSION, workflow_run_id: "wf_run0001-abc" }, name: null, phases: [],
      started_at: "2026-10-17T09:10:00.000Z", ended_at: null, outcome: null,
    });
    const states = Object.fromEntries(group!.members.map((row) => [row.child_ref, [row.end_state, row.ended_at]]));
    expect(states).toEqual({
      awfok01: ["result", "2026-10-17T09:12:00.000Z"],
      awffail02: ["failed", "2026-10-17T09:11:00.000Z"],
      awfopen03: ["unknown", null],
    });
  });

  test("a deliverable is a pointer, and the member that produced it is promoted", () => {
    const first = ingestClaudeSession(ledger, writeClaudeProject(directory));
    const [group] = ledger.groupsFor(first.seat_id);
    expect(ledger.addDeliverable(group!.group_id, { kind: "commit", ref: "9405412" }, "awfok01")).toBe(true);
    expect(ledger.addDeliverable(group!.group_id, { kind: "commit", ref: "9405412" })).toBe(false);
    expect(() => ledger.addDeliverable(group!.group_id, { kind: "commit", ref: "has spaces in it" })).toThrow("pointer");
    const after = ledger.getGroup(group!.group_id)!;
    expect(after.deliverables).toEqual([{ kind: "commit", ref: "9405412" }]);
    const member = after.members.find((row) => row.child_ref === "awfok01")!;
    expect(ledger.getSeat(member.seat_id!)).toMatchObject({ group_id: group!.group_id, relation: "child", persistence: "recorded" });
    expect(ledger.endGroup(group!.group_id, "2026-10-17T09:20:00.000Z", "completed")).toBe(true);
    expect(ledger.getGroup(group!.group_id)).toMatchObject({ ended_at: "2026-10-17T09:20:00.000Z", outcome: "completed" });
  });
});

describe("Codex ingest", () => {
  test("spawned threads are rows under the root seat; a fork is a new seat with a parent", () => {
    const paths = writeCodexSessions(directory);
    const child = ingestCodexRollout(ledger, paths.child);
    const grandchild = ingestCodexRollout(ledger, paths.grandchild);
    const root = ingestCodexRollout(ledger, paths.root);
    expect(child.seat_id).toBe(root.seat_id);
    expect(grandchild.seat_id).toBe(root.seat_id);
    expect(root.created).toBe(false);
    const seat = ledger.findSeat("codex", { thread_id: CODEX_ROOT })!;
    expect(seat.settings.map((e) => e.effort)).toEqual(["max", "ultra", "max"]);
    expect(seat.harness.version).toBe("0.162.1");
    const rows = Object.fromEntries(seat.children.map((row) => [row.child_ref, row]));
    expect(rows[CODEX_CHILD]).toMatchObject({ parent_ref: null, depth: 1, agent_type: "explorer", end_state: "unknown" });
    expect(rows[CODEX_GRANDCHILD]).toMatchObject({ parent_ref: CODEX_CHILD, depth: 2 });
    const fork = ingestCodexRollout(ledger, paths.fork);
    expect(ledger.getSeat(fork.seat_id)).toMatchObject({ parent_seat_id: root.seat_id, relation: "fork", native_ref: { thread_id: CODEX_FORK } });
  });
});

test("no free text from native files reaches the ledger bytes", () => {
  ingestClaudeSession(ledger, writeClaudeProject(directory));
  const paths = writeCodexSessions(join(directory, "codex"));
  for (const path of Object.values(paths)) ingestCodexRollout(ledger, path);
  const first = ledger.findSeat("claude-code", { session_id: CLAUDE_SESSION })!;
  ledger.promoteChild(first.seat_id, "aplain01");
  ledger.close();
  const raw = new Database(join(home, DATABASE_FILE));
  raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  raw.close();
  expect(expectNoMarkers(ledgerBytes())).toEqual([]);
  ledger = SeatLedger.open(home);
});

test("a fresh home under a missing parent is created privately", () => {
  ledger.close();
  const nested = join(directory, "a", "b", "c");
  mkdirSync(join(directory, "a"), { recursive: true, mode: 0o700 });
  ledger = SeatLedger.open(nested);
  expect(statSync(nested).mode & 0o777).toBe(0o700);
});
