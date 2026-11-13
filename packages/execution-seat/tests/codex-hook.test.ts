import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../bin/agenttool-execution-seat.js";
import { handleCodexHook } from "../src/codex-hook.js";
import { DATABASE_FILE } from "../src/home.js";
import { SeatLedger } from "../src/ledger.js";
import { CODEX_CHILD, CODEX_GRANDCHILD, CODEX_ROOT, CODEX_SIBLING, expectNoMarkers, MARKERS, writeCodexSessions, type CodexPaths } from "./fixtures.js";

const COLLAB = "mcp__agenttool_collab__";

let directory: string;
let home: string;
let ledger: SeatLedger;
let paths: CodexPaths;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "execution-seat-codex-hook-"));
  home = join(directory, "state");
  ledger = SeatLedger.open(home);
  paths = writeCodexSessions(directory);
});

afterEach(() => {
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

/** A Codex hook input shaped as codex-cli 0.162.1 sent it, free text carrying markers. */
function input(event: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    hook_event_name: event,
    session_id: CODEX_ROOT,
    cwd: MARKERS[9],
    model: "gpt-6-astra",
    permission_mode: "bypassPermissions",
    turn_id: "019a0000-0000-7000-8000-0000000000c1",
    tool_input: { task_id: MARKERS[11] },
    tool_response: { content: [{ type: "text", text: MARKERS[12] }] },
    tool_use_id: "exec-00000000-0000-4000-8000-000000000001",
    ...fields,
  };
}

const write = (agentId: string | null, transcript: string, tool = `${COLLAB}collab_task_claim`) =>
  handleCodexHook(
    ledger,
    input("PostToolUse", { tool_name: tool, transcript_path: transcript, ...(agentId ? { agent_id: agentId, agent_type: "default" } : {}) }),
  );

function ledgerBytes(): string {
  const base = join(home, DATABASE_FILE);
  return ["", "-wal", "-shm"].map((suffix) => (existsSync(base + suffix) ? readFileSync(base + suffix, "latin1") : "")).join("");
}

describe("Codex hooks", () => {
  test("a spawned thread's collab write promotes it from its own rollout", () => {
    const result = write(CODEX_CHILD, paths.child);
    expect(result.actions).toEqual(["ingested", "promoted"]);
    const root = ledger.findSeat("codex", { thread_id: CODEX_ROOT })!;
    expect(result.seat_id).toBe(root.seat_id);
    expect(ledger.getSeat(result.child_seat_id!)).toMatchObject({
      parent_seat_id: root.seat_id, relation: "child", persistence: "recorded", promotion: { trigger: "collab_write" },
      native_ref: { thread_id: CODEX_CHILD, session_id: CODEX_ROOT },
    });
    expect(write(CODEX_CHILD, paths.child, `${COLLAB}collab_report_append`).actions).toEqual(["ingested", "already_recorded"]);
  });

  test("a nested thread's parent is read from the rollout beside it, so the chain is whole", () => {
    const result = write(CODEX_GRANDCHILD, paths.grandchild);
    expect(result.actions).toEqual(["ingested", "ingested_parent", "promoted"]);
    const child = ledger.findSeat("codex", { thread_id: CODEX_CHILD })!;
    expect(child.promotion?.trigger).toBe("lineage");
    expect(ledger.getSeat(result.child_seat_id!)).toMatchObject({ parent_seat_id: child.seat_id, promotion: { trigger: "collab_write" } });
  });

  test("main-thread calls, reads, other tools and mismatched rollouts change nothing", () => {
    expect(write(null, paths.root).actions).toEqual([]);
    for (const tool of [`${COLLAB}collab_task_list`, `${COLLAB}collab_next`, "Bash", "collaborationspawn_agent"]) {
      expect(write(CODEX_CHILD, paths.child, tool)).toMatchObject({ seat_id: null, actions: [] });
    }
    expect(ledger.listSeats().items).toHaveLength(0);
    // A rollout that is not the spawned thread's own is never read.
    expect(write(CODEX_CHILD, paths.sibling).actions).toEqual(["rollout_unknown"]);
    expect(write(CODEX_SIBLING, join(directory, "elsewhere", `rollout-2026-10-17T10-00-00-${CODEX_SIBLING}.json`)).actions).toEqual([
      "rollout_unknown",
    ]);
    expect(ledger.listSeats().items).toHaveLength(0);
  });

  test("SessionStart and SessionEnd record the top-level thread's seat; a resume reopens it", () => {
    const start = handleCodexHook(ledger, input("SessionStart", { source: "startup", transcript_path: paths.root }));
    expect(start.actions).toEqual(["ingested", "opened"]);
    const seat = ledger.getSeat(start.seat_id!)!;
    expect(seat).toMatchObject({ native_ref: { thread_id: CODEX_ROOT }, persistence: "recorded", ended_at: null });
    expect(seat.settings.length).toBeGreaterThan(0);
    expect(handleCodexHook(ledger, input("SessionEnd", { reason: "other", transcript_path: paths.root })).actions).toEqual(["ended"]);
    expect(ledger.getSeat(start.seat_id!)?.end_reason).toBe("other");
    expect(handleCodexHook(ledger, input("SessionStart", { source: "resume", transcript_path: paths.root })).actions).toEqual([
      "ingested",
      "resumed",
    ]);
    // Session hooks in a spawned thread are not this seat's; Codex sends SubagentStart and SubagentStop there.
    expect(handleCodexHook(ledger, input("SessionStart", { agent_id: CODEX_CHILD, transcript_path: paths.child })).actions).toEqual([]);
  });

  test("no hook free text reaches the ledger", () => {
    handleCodexHook(ledger, input("SessionStart", { source: "startup", transcript_path: paths.root }));
    write(CODEX_GRANDCHILD, paths.grandchild);
    ledger.close();
    expect(expectNoMarkers(ledgerBytes())).toEqual([]);
    ledger = SeatLedger.open(home);
  });
});

describe("agenttool-execution-seat hook codex", () => {
  function hookCli(text: string, flags: string[] = []) {
    let out = "";
    let err = "";
    const code = run(["--home", join(directory, "cli-state"), "hook", "codex", ...flags], { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {}, () => text);
    return { code, out, err };
  }

  test("prints nothing and exits 0; only a spawned thread's collab write opens the ledger on PostToolUse", () => {
    expect(hookCli(JSON.stringify(input("PostToolUse", { tool_name: `${COLLAB}collab_task_claim`, transcript_path: paths.root })))).toEqual({
      code: 0, out: "", err: "",
    });
    expect(existsSync(join(directory, "cli-state"))).toBe(false);
    const promoted = hookCli(
      JSON.stringify(input("PostToolUse", { tool_name: `${COLLAB}collab_task_claim`, agent_id: CODEX_CHILD, transcript_path: paths.child })),
    );
    expect(promoted).toEqual({ code: 0, out: "", err: "" });
    expect(existsSync(join(directory, "cli-state", DATABASE_FILE))).toBe(true);
    const usage = hookCli("{}", ["--collab-host", "/x"]);
    expect([usage.code, usage.out]).toEqual([0, ""]);
    expect(usage.err).toContain("usage");
  });
});
