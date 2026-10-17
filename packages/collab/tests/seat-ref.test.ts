import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCollabHostCli } from "../src/host.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { SessionHandle } from "../src/protocol.js";
import { defaultSeatRef } from "../src/seat-ref.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

const CLAUDE_SESSION = "C05687D3-1DEF-4749-BC65-4637D9F20620";
const CODEX_THREAD = "019a0000-0000-7000-8000-000000000001";

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-seat-ref-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

async function startThroughMcp(environment: Record<string, string | undefined>, args: Record<string, unknown> = {}) {
  const server = buildCollabMcpServer(store, { environment }) as any;
  const registration = server._registeredTools.collab_session_start;
  return await (registration.handler ?? registration.callback)({ root_path: root, actor: "seat-ref-test", ...args }, {});
}

function joinedPayload(sessionId: string): Record<string, unknown> {
  const row = store.db.query(`
    SELECT payload_json FROM events WHERE type = 'session.joined' AND entity_id = ?
  `).get(sessionId) as { payload_json: string };
  return JSON.parse(row.payload_json) as Record<string, unknown>;
}

function startWithFile(seatRef: string | null, actor = "seat-ref-worker"): { handle: SessionHandle; file: string } {
  const handle = store.startSession({ root_path: root, actor, seat_ref: seatRef });
  const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
  return { handle, file };
}

function host(args: string[]) {
  const run = runCollabHostCli([...args, "--db", databasePath], {});
  return { exitCode: run.exit_code, line: run.line, receipt: JSON.parse(run.line) as Record<string, any> };
}

describe("collab_session_start seat_ref", () => {
  test("an explicit seat_ref is returned in the binding and kept in the session.joined payload", async () => {
    const started = await startThroughMcp({ CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION }, { seat_ref: "seat:0199f0c4" });
    expect(started.isError).toBeUndefined();
    const sessionId = started.structuredContent.session.id as string;
    expect(started.structuredContent.seat_ref).toBe("seat:0199f0c4");
    expect(joinedPayload(sessionId).seat_ref).toBe("seat:0199f0c4");
    expect(store.sessionSeatRef(sessionId)).toBe("seat:0199f0c4");
    expect(store.verifyJournal(started.structuredContent.workspace.id)).toBe(true);
  });

  test("without a declaration the payload keeps its old shape", async () => {
    const started = await startThroughMcp({});
    const sessionId = started.structuredContent.session.id as string;
    expect(started.structuredContent.seat_ref).toBeNull();
    expect(Object.keys(joinedPayload(sessionId)).sort()).toEqual([
      "identity_boundary",
      "parent_session_id",
      "role",
      "worktree_id",
    ]);
    expect(store.sessionSeatRef(sessionId)).toBeNull();
  });

  test("the host declaration comes first, then Claude Code's session ID, then Codex's thread ID", async () => {
    expect(defaultSeatRef({ CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION, CODEX_THREAD_ID: CODEX_THREAD }))
      .toBe(`claude-code:${CLAUDE_SESSION.toLowerCase()}`);
    expect(defaultSeatRef({ CODEX_THREAD_ID: CODEX_THREAD })).toBe(`codex:${CODEX_THREAD}`);
    expect(defaultSeatRef({ AGENTOOL_COLLAB_SEAT_REF: "run:astra-r9", CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION }))
      .toBe("run:astra-r9");
    // An empty declaration counts as unset; harness values that are not UUIDs are ignored.
    expect(defaultSeatRef({ AGENTOOL_COLLAB_SEAT_REF: "", CLAUDE_CODE_SESSION_ID: "not-a-uuid" })).toBeNull();
    expect(defaultSeatRef({})).toBeNull();

    const started = await startThroughMcp({ CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION });
    expect(started.structuredContent.seat_ref).toBe(`claude-code:${CLAUDE_SESSION.toLowerCase()}`);
    expect(joinedPayload(started.structuredContent.session.id).seat_ref).toBe(`claude-code:${CLAUDE_SESSION.toLowerCase()}`);
  });

  test("an invalid seat_ref is refused and binds nothing", async () => {
    for (const [environment, args] of [
      [{}, { seat_ref: "two words" }],
      [{}, { seat_ref: "-leading-dash" }],
      [{}, { seat_ref: "x".repeat(201) }],
      [{ AGENTOOL_COLLAB_SEAT_REF: "bad\nref" }, {}],
    ] as const) {
      const refused = await startThroughMcp(environment, args);
      expect(refused.isError).toBe(true);
      expect(refused.structuredContent.error).toBe("invalid_seat_ref");
    }
    expect(() => store.startSession({ root_path: root, actor: "direct", seat_ref: "a b" })).toThrow("seat_ref");
    expect(store.db.query("SELECT COUNT(*) AS n FROM coordination_sessions").get()).toEqual({ n: 0 });
  });
});

describe("agenttool-collab-host end --seat-ref", () => {
  test("ends every active session started under the refs, oldest first, and leaves others open", () => {
    const first = startWithFile("claude-code:aaaa", "first");
    const second = startWithFile("claude-code:bbbb", "second");
    const other = startWithFile("claude-code:cccc", "other");
    const unmarked = startWithFile(null, "unmarked");

    const run = host([
      "end",
      "--seat-ref",
      "claude-code:aaaa",
      "--seat-ref",
      "claude-code:bbbb",
      "--reason",
      "Claude Code session ended (prompt_input_exit)",
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "ended_by_seat_ref",
      seat_refs: ["claude-code:aaaa", "claude-code:bbbb"],
      sessions: [
        { session_id: first.handle.session.id, status: "ended", released: [], ended_at: expect.any(String) },
        { session_id: second.handle.session.id, status: "ended", released: [], ended_at: expect.any(String) },
      ],
    });
    for (const { handle } of [first, second, other, unmarked]) expect(run.line).not.toContain(handle.credential.session_token);
    expect(existsSync(first.file)).toBe(false);
    expect(existsSync(second.file)).toBe(false);
    expect(store.getCoordinationSession(first.handle.session.id)?.status).toBe("ended");
    expect(store.getCoordinationSession(other.handle.session.id)?.status).toBe("active");
    expect(store.getCoordinationSession(unmarked.handle.session.id)?.status).toBe("active");
    expect(existsSync(other.file)).toBe(true);

    // Ended sessions no longer match.
    const again = host(["end", "--seat-ref", "claude-code:aaaa", "--reason", "again"]);
    expect(again.exitCode).toBe(0);
    expect(again.receipt.sessions).toEqual([]);
  });

  test("reports a session without its credential file and leaves it open", () => {
    const handle = store.startSession({ root_path: root, actor: "no-file", seat_ref: "claude-code:dddd" });
    const run = host(["end", "--seat-ref", "claude-code:dddd", "--reason", "exit"]);
    expect(run.exitCode).toBe(0);
    expect(run.receipt.sessions).toEqual([{ session_id: handle.session.id, status: "credential_missing" }]);
    expect(store.getCoordinationSession(handle.session.id)?.status).toBe("active");
  });

  test("a live lease refuses that session only; --release-leases releases it", () => {
    const holder = startWithFile("claude-code:eeee", "holder");
    const idle = startWithFile("claude-code:eeee", "idle");
    const task = store.createTaskForSession({
      ...holder.handle.credential,
      idempotency_key: "seat-ref-create",
      title: "seat ref lease",
      work_mode: "edit",
      path_scopes: ["src/seat.ts"],
    });
    const claim = store.claimTaskForSession({
      ...holder.handle.credential,
      idempotency_key: "seat-ref-claim",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 3600,
    });

    const refused = host(["end", "--seat-ref", "claude-code:eeee", "--reason", "exit"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.receipt.status).toBe("ended_by_seat_ref");
    expect(refused.receipt.sessions).toEqual([
      {
        session_id: holder.handle.session.id,
        status: "error",
        error: "session_has_active_leases",
        message: expect.stringContaining("--release-leases"),
      },
      { session_id: idle.handle.session.id, status: "ended", released: [], ended_at: expect.any(String) },
    ]);
    expect(existsSync(holder.file)).toBe(true);
    expect(store.getCoordinationSession(holder.handle.session.id)?.status).toBe("active");

    const released = host(["end", "--seat-ref", "claude-code:eeee", "--reason", "exit", "--release-leases"]);
    expect(released.exitCode).toBe(0);
    expect(released.receipt.sessions).toEqual([
      {
        session_id: holder.handle.session.id,
        status: "ended",
        released: [{ task_id: task.id, lease_id: claim.lease_id, via: "release" }],
        ended_at: expect.any(String),
      },
    ]);
    expect(released.line).not.toContain(holder.handle.credential.session_token);
  });

  test("no match is an empty list, and bad arguments are usage errors that touch nothing", () => {
    const kept = startWithFile("claude-code:ffff");
    const none = host(["end", "--seat-ref", "claude-code:none", "--reason", "exit"]);
    expect(none.exitCode).toBe(0);
    expect(none.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "ended_by_seat_ref",
      seat_refs: ["claude-code:none"],
      sessions: [],
    });
    for (const args of [
      ["end", "--seat-ref", "claude-code:ffff", "--session-file", kept.file, "--reason", "exit"],
      ["end", "--seat-ref", "has space", "--reason", "exit"],
      ["end", "--seat-ref", "claude-code:ffff"],
      ["end", "--reason", "exit"],
      ["wait", "--seat-ref", "claude-code:ffff", "--session", kept.handle.session.id],
    ]) {
      const run = host(args);
      expect(run.exitCode).toBe(1);
      expect(run.receipt).toMatchObject({ status: "error", error: "usage_error" });
    }
    expect(store.getCoordinationSession(kept.handle.session.id)?.status).toBe("active");
    expect(existsSync(kept.file)).toBe(true);
  });
});
