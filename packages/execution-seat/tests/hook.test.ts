import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../bin/agenttool-execution-seat.js";
import { handleClaudeHook, HOSTS_DIRECTORY, type ClaudeHookOptions, type CollabRun } from "../src/claude-hook.js";
import { DATABASE_FILE } from "../src/home.js";
import { SeatLedger } from "../src/ledger.js";
import { CLAUDE_NEXT, CLAUDE_SESSION, expectNoMarkers, hookInput } from "./fixtures.js";

const PID = 4242;
const STARTED = "Sat Oct 17 09:00:00 2026";
const RESUMED_SESSION = "77777777-8888-4999-aaaa-bbbbbbbbbbbb";

let directory: string;
let home: string;
let ledger: SeatLedger;
let clock: number;
let collabCalls: string[][];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "execution-seat-hook-"));
  home = join(directory, "state");
  ledger = SeatLedger.open(home);
  clock = Date.parse("2026-10-17T09:00:00.000Z");
  collabCalls = [];
});

afterEach(() => {
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

const receipt = (statuses: string[]): CollabRun => ({
  exit_code: 0,
  timed_out: false,
  stdout: `${JSON.stringify({
    protocol: "agenttool.collab-host/1",
    status: "ended_by_seat_ref",
    seat_refs: [],
    sessions: statuses.map((status, index) => ({ session_id: `session_${index}`, status })),
  })}\n`,
});

function options(extra: Partial<ClaudeHookOptions> = {}): ClaudeHookOptions {
  return {
    pid: PID,
    now: () => new Date((clock += 1_000)).toISOString(),
    processStarted: () => STARTED,
    alive: () => true,
    collab: {
      host: "/opt/collab/dist/agenttool-collab-host.js",
      db: "/tmp/collab.sqlite",
      run: (argv) => {
        collabCalls.push(argv);
        return receipt(["ended"]);
      },
    },
    ...extra,
  };
}

const hook = (event: string, sessionId: string, fields: Record<string, unknown> = {}, extra: Partial<ClaudeHookOptions> = {}) =>
  handleClaudeHook(ledger, hookInput(event, sessionId, fields), options(extra));

const hostFile = (pid = PID) => join(home, HOSTS_DIRECTORY, `claude-code-${pid}.json`);
const seatOf = (sessionId: string) => ledger.findSeat("claude-code", { session_id: sessionId })!;
const refsOf = (argv: string[]) => argv.flatMap((arg, index) => (argv[index - 1] === "--seat-ref" ? [arg] : []));

function ledgerBytes(): string {
  const base = join(home, DATABASE_FILE);
  return ["", "-wal", "-shm"].map((suffix) => (existsSync(base + suffix) ? readFileSync(base + suffix, "latin1") : "")).join("");
}

describe("Claude Code session hooks", () => {
  test("SessionStart opens the seat, keeps a hook settings entry for a new session, and a private host file", () => {
    const started = hook("SessionStart", CLAUDE_SESSION, { source: "startup", model: "claude-opus-5-5", effort: { level: "xhigh" } });
    expect(started.actions).toEqual(["opened", "settings"]);
    const seat = seatOf(CLAUDE_SESSION);
    expect(seat.seat_id).toBe(started.seat_id!);
    expect(seat.settings).toEqual([
      { at: "2026-10-17T09:00:01.000Z", model: "claude-opus-5-5", effort: "xhigh", provider: null, basis: "hook", evidence: null },
    ]);
    expect(seat.last_seen_at).toBe("2026-10-17T09:00:01.000Z");
    expect(seat.ended_at).toBeNull();
    expect(statSync(join(home, HOSTS_DIRECTORY)).mode & 0o777).toBe(0o700);
    expect(statSync(hostFile()).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(hostFile(), "utf8"))).toEqual({
      pid: PID,
      process_started: STARTED,
      sessions: [CLAUDE_SESSION],
      last_end: null,
    });
  });

  test("a hook entry never shadows a transcript: only a brand-new startup session gets one", () => {
    expect(hook("SessionStart", CLAUDE_SESSION, { source: "resume", model: "claude-opus-5-5" }).actions).toEqual(["opened"]);
    expect(seatOf(CLAUDE_SESSION).settings).toEqual([]);
    expect(hook("SessionStart", CLAUDE_SESSION, { source: "startup", model: "claude-opus-5-5" }).actions).toEqual([]);
    expect(seatOf(CLAUDE_SESSION).settings).toEqual([]);
  });

  test("an exit ends the seat, ends the process's collab sessions by seat ref, and removes the host file", () => {
    hook("SessionStart", CLAUDE_SESSION, { source: "startup" });
    const ended = hook("SessionEnd", CLAUDE_SESSION, { reason: "prompt_input_exit" });
    expect(ended.actions).toEqual(["ended", "collab"]);
    expect(seatOf(CLAUDE_SESSION)).toMatchObject({ ended_at: "2026-10-17T09:00:02.000Z", end_reason: "prompt_input_exit" });
    expect(collabCalls).toEqual([[
      "/opt/collab/dist/agenttool-collab-host.js",
      "end",
      "--seat-ref",
      `claude-code:${CLAUDE_SESSION}`,
      "--reason",
      "Claude Code session ended (prompt_input_exit)",
      "--db",
      "/tmp/collab.sqlite",
    ]]);
    expect(ended.collab).toEqual({ seat_refs: [`claude-code:${CLAUDE_SESSION}`], summary: "collab sessions: ended 1" });
    expect(existsSync(hostFile())).toBe(false);
  });

  test("a resumed session reopens its seat, and can end again", () => {
    hook("SessionStart", CLAUDE_SESSION, { source: "startup" });
    hook("SessionEnd", CLAUDE_SESSION, { reason: "other" });
    const resumed = hook("SessionStart", CLAUDE_SESSION, { source: "resume" });
    expect(resumed.actions).toEqual(["resumed"]);
    expect(seatOf(CLAUDE_SESSION)).toMatchObject({ ended_at: null, end_reason: null, last_seen_at: "2026-10-17T09:00:03.000Z" });
    expect(hook("SessionEnd", CLAUDE_SESSION, { reason: "logout" }).actions).toEqual(["ended", "collab"]);
    expect(seatOf(CLAUDE_SESSION)).toMatchObject({ ended_at: "2026-10-17T09:00:04.000Z", end_reason: "logout" });
  });

  test("/clear is a continuation in the same process, and the exit covers both sessions", () => {
    hook("SessionStart", CLAUDE_SESSION, { source: "startup" });
    const cleared = hook("SessionEnd", CLAUDE_SESSION, { reason: "clear" });
    expect(cleared.actions).toEqual(["ended"]);
    expect(collabCalls).toEqual([]);
    expect(JSON.parse(readFileSync(hostFile(), "utf8")).last_end).toEqual({ session_id: CLAUDE_SESSION, reason: "clear" });

    const next = hook("SessionStart", CLAUDE_NEXT, { source: "clear" });
    expect(next.actions).toEqual(["opened", "continuation"]);
    expect(seatOf(CLAUDE_NEXT)).toMatchObject({ parent_seat_id: seatOf(CLAUDE_SESSION).seat_id, relation: "continuation" });

    hook("SessionEnd", CLAUDE_NEXT, { reason: "prompt_input_exit" });
    // The MCP servers kept the first session's ID, so both refs are ended.
    expect(collabCalls.map(refsOf)).toEqual([[`claude-code:${CLAUDE_SESSION}`, `claude-code:${CLAUDE_NEXT}`]]);
  });

  test("an in-process /resume is no lineage, but the exit still covers every session the process hosted", () => {
    hook("SessionStart", CLAUDE_SESSION, { source: "startup" });
    hook("SessionEnd", CLAUDE_SESSION, { reason: "resume" });
    expect(hook("SessionStart", RESUMED_SESSION, { source: "resume" }).actions).toEqual(["opened"]);
    expect(seatOf(RESUMED_SESSION).parent_seat_id).toBeNull();
    hook("SessionEnd", RESUMED_SESSION, { reason: "other" });
    expect(collabCalls.map(refsOf)).toEqual([[`claude-code:${CLAUDE_SESSION}`, `claude-code:${RESUMED_SESSION}`]]);
  });

  test("an unknown reason records the end but leaves collab and the host file alone", () => {
    hook("SessionStart", CLAUDE_SESSION, { source: "startup" });
    expect(hook("SessionEnd", CLAUDE_SESSION, { reason: "bypass_permissions_disabled" }).actions).toEqual(["ended", "unknown_reason"]);
    expect(collabCalls).toEqual([]);
    expect(existsSync(hostFile())).toBe(true);
  });

  test("a reused pid starts a fresh host file, and files of dead processes are pruned", () => {
    mkdirSync(join(home, HOSTS_DIRECTORY), { mode: 0o700 });
    writeFileSync(
      hostFile(),
      JSON.stringify({ pid: PID, process_started: "Thu Oct 15 08:00:00 2026", sessions: [RESUMED_SESSION], last_end: null }),
      { mode: 0o600 },
    );
    writeFileSync(hostFile(999), JSON.stringify({ pid: 999, process_started: null, sessions: [], last_end: null }), { mode: 0o600 });
    hook("SessionStart", CLAUDE_SESSION, { source: "startup" }, { alive: (pid) => pid !== 999 });
    expect(existsSync(hostFile(999))).toBe(false);
    hook("SessionEnd", CLAUDE_SESSION, { reason: "prompt_input_exit" });
    expect(collabCalls.map(refsOf)).toEqual([[`claude-code:${CLAUDE_SESSION}`]]);
  });

  test("without a collab host an exit only records the end; other events and bad input change nothing", () => {
    hook("SessionStart", CLAUDE_SESSION, { source: "startup" });
    expect(hook("SessionEnd", CLAUDE_SESSION, { reason: "other" }, { collab: null }).actions).toEqual(["ended"]);
    expect(existsSync(hostFile())).toBe(false);
    expect(handleClaudeHook(ledger, hookInput("PostToolUse", CLAUDE_SESSION), options()).actions).toEqual([]);
    expect(() => handleClaudeHook(ledger, hookInput("SessionStart", "not-a-uuid"), options())).toThrow("session_id");
    expect(ledger.listSeats().items).toHaveLength(1);
  });

  test("no hook free text reaches the ledger or a host file", () => {
    hook("SessionStart", CLAUDE_SESSION, { source: "startup", model: "claude-opus-5-5" });
    hook("SessionEnd", CLAUDE_SESSION, { reason: "clear" });
    hook("SessionStart", CLAUDE_NEXT, { source: "clear" });
    const hostFiles = readdirSync(join(home, HOSTS_DIRECTORY)).map((name) => readFileSync(join(home, HOSTS_DIRECTORY, name), "utf8"));
    ledger.close();
    expect(expectNoMarkers([ledgerBytes(), ...hostFiles].join("\n"))).toEqual([]);
    ledger = SeatLedger.open(home);
  });
});

describe("agenttool-execution-seat hook claude-code", () => {
  function hookCli(input: string, flags: string[] = [], env: Record<string, string> = { CLAUDE_PID: String(PID) }) {
    let out = "";
    let err = "";
    const code = run(
      ["--home", join(directory, "cli-state"), "hook", "claude-code", ...flags],
      { stdout: (text) => (out += text), stderr: (text) => (err += text) },
      env,
      () => input,
    );
    return { code, out, err };
  }

  test("prints nothing, exits 0, and runs the collab host it is given on exit", () => {
    const fakeHost = join(directory, "fake-collab-host.js");
    const argvFile = join(directory, "argv.json");
    writeFileSync(
      fakeHost,
      `require("node:fs").writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));\n` +
        `console.log(JSON.stringify({ protocol: "agenttool.collab-host/1", status: "ended_by_seat_ref", seat_refs: [], ` +
        `sessions: [{ session_id: "session_a", status: "ended" }, { session_id: "session_b", status: "credential_missing" }] }));\n`,
    );
    const start = hookCli(JSON.stringify(hookInput("SessionStart", CLAUDE_SESSION, { source: "startup" })));
    expect(start).toEqual({ code: 0, out: "", err: "" });
    const end = hookCli(JSON.stringify(hookInput("SessionEnd", CLAUDE_SESSION, { reason: "prompt_input_exit" })), [
      "--collab-host",
      fakeHost,
      "--collab-db",
      join(directory, "collab.sqlite"),
    ]);
    expect(end.code).toBe(0);
    expect(end.out).toBe("");
    expect(end.err).toBe("agenttool-execution-seat hook: collab sessions: ended 1, credential_missing 1\n");
    expect(JSON.parse(readFileSync(argvFile, "utf8"))).toEqual([
      "end",
      "--seat-ref",
      `claude-code:${CLAUDE_SESSION}`,
      "--reason",
      "Claude Code session ended (prompt_input_exit)",
      "--db",
      join(directory, "collab.sqlite"),
    ]);
  });

  test("bad input is one stderr line and still exit 0; other events never create a ledger", () => {
    const bad = hookCli("{not json");
    expect(bad.code).toBe(0);
    expect(bad.out).toBe("");
    expect(bad.err).toBe("agenttool-execution-seat hook: invalid_hook_input: hook input is not JSON\n");
    expect(hookCli(JSON.stringify(hookInput("PostToolUse", CLAUDE_SESSION)))).toEqual({ code: 0, out: "", err: "" });
    expect(hookCli("x".repeat(1_000_001))).toEqual({ code: 0, out: "", err: "" });
    expect(existsSync(join(directory, "cli-state"))).toBe(false);
    const usage = hookCli("{}", ["--unknown"]);
    expect(usage.code).toBe(0);
    expect(usage.err).toContain("usage");
  });
});
