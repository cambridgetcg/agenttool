import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import { makeContext } from "../src/control.js";
import { handleClaudeHook, hooksSnippet, readHookInput } from "../src/hook.js";
import { listenerPath, readListener, rungPath, writeMark } from "../src/registry.js";
import { NOTE_PATTERN } from "../src/ring.js";
import type { Starter } from "../src/run.js";
import { Watcher, WATCH_TICK_MS } from "../src/watcher.js";
import { CANARY, NOW, ROOM_A, ROOM_B } from "./helpers.js";
import { fakePs, LSTART, makeDoorbellWorld, OWNER, SEAT, SESSION, WATCHER } from "./doorbell-helpers.js";

const SELF = "/opt/synthetic/lobby-doorbell/bin/agenttool-lobby-doorbell.ts";
const NEW_SESSION = "1f1e1d1c-1b1a-4918-9716-151413121110";
const NEW_OWNER = 9_000_011;
const NEW_WATCHER = 9_000_012;

function hookWorld(env: Record<string, string> = {}) {
  const world = makeDoorbellWorld();
  const started: Array<{ argv: readonly string[]; env: Record<string, string> }> = [];
  const starter: Starter = {
    start(argv, childEnv) {
      started.push({ argv, env: childEnv });
      const pid = argv.includes("watch") ? NEW_WATCHER : 9_000_013;
      world.procs.set(pid, LSTART);
      return pid;
    },
  };
  const context = (extra: Record<string, string> = {}) => makeContext({
    env: { HOME: join(world.root, "home"), XDG_STATE_HOME: join(world.root, "state"), CLAUDE_PID: String(OWNER), ...env, ...extra },
    selfEntry: SELF,
    homeDir: join(world.root, "home"),
    now: () => world.clock,
    spawner: () => fakePs(world.procs),
    starter: () => starter,
    alive: (pid) => world.procs.has(pid),
  });
  const hook = (input: Record<string, unknown>, extra: Record<string, string> = {}) => handleClaudeHook(context(extra), input);
  return { world, started, hook, context };
}

const event = (name: string, extra: Record<string, unknown> = {}) => ({ hook_event_name: name, session_id: SESSION, ...extra });

describe("hook claude-code", () => {
  test("reads only the allowlisted fields", () => {
    expect(readHookInput({
      hook_event_name: "UserPromptSubmit", session_id: SESSION.toUpperCase(), source: "resume", reason: "other",
      prompt: CANARY, transcript_path: CANARY, cwd: CANARY,
    })).toEqual({ event: "UserPromptSubmit", session_id: SESSION, source: "resume", reason: "other" });
    expect(readHookInput({ hook_event_name: "PreToolUse", session_id: CANARY, source: CANARY })).toEqual({ event: null, session_id: null, source: null, reason: null });
    expect(readHookInput("garbage")).toEqual({ event: null, session_id: null, source: null, reason: null });
  });

  test("a session that is not a listener: nothing printed, nothing started, nothing created", async () => {
    const root = mkdtempSync(join(tmpdir(), "lobby-doorbell-hook-"));
    const context = makeContext({ env: { XDG_STATE_HOME: join(root, "state"), CLAUDE_PID: String(OWNER) }, selfEntry: SELF, homeDir: root,
      spawner: () => fakePs(new Map()), starter: () => ({ start: () => { throw new Error("must not start"); } }) });
    for (const name of ["SessionStart", "UserPromptSubmit", "SessionEnd"]) {
      expect(await handleClaudeHook(context, event(name, { source: "startup", reason: "prompt_input_exit", prompt: CANARY }))).toEqual([]);
    }
    expect(existsSync(join(root, "state"))).toBe(false);
    const { world, started, hook } = hookWorld();
    world.listener({ seat_ref: "claude-code:2f2e2d2c-2b2a-4928-a726-252423222120", owner_pid: 9_000_020 });
    world.procs.set(9_000_020, LSTART);
    world.bell({ seq: 2, head_cursor: "12", new: 2, addressed: 2 });
    for (const name of ["SessionStart", "UserPromptSubmit", "SessionEnd"]) expect(await hook(event(name, { source: "resume", reason: "other" }))).toEqual([]);
    expect(started).toEqual([]);
  });

  test("UserPromptSubmit: one content-free note per room, forward only, and never repeating what the watcher rang", async () => {
    const { world, hook } = hookWorld();
    world.listener();
    world.bell({ seq: 1, head_cursor: "10" });
    expect(await hook(event("UserPromptSubmit"))).toEqual([]);
    world.bell({ seq: 2, head_cursor: "12", new: 2, addressed: 1 });
    const lines = await hook(event("UserPromptSubmit"));
    expect(lines).toEqual(["[lobby] 2 new Lobby message(s) in " + ROOM_A + " after cursor 10 (1 addressed to this desk, 0 unverified); no message text here; read with room_read (room_id " + ROOM_A + ", after 10)."]);
    expect(lines[0]).toMatch(NOTE_PATTERN);
    expect(await hook(event("UserPromptSubmit"))).toEqual([]);
    // The watcher rang up to cursor 14: the note does not repeat it.
    const rung = world.bell({ seq: 3, head_cursor: "14", new: 4, addressed: 2 });
    writeMark(rungPath(world.doorbellHome, ROOM_A), { format: "agenttool-lobby-mark/v1", room_id: ROOM_A, armed_at: rung.armed_at, seq: 3, cursor: "14", state: "ok", reason: null, new: 4, addressed: 2, unverified: 0 });
    expect(await hook(event("UserPromptSubmit"))).toEqual([]);
    world.bell({ seq: 4, head_cursor: "15", new: 5, addressed: 3, state: "grant-lapsed", reason: "no_seat" });
    const next = await hook(event("UserPromptSubmit"));
    expect(next).toEqual([
      `[lobby] ${ROOM_A}: grant-lapsed (no_seat); a person must renew it.`,
      `[lobby] 1 new Lobby message(s) in ${ROOM_A} after cursor 14 (1 addressed to this desk, 0 unverified); no message text here; read with room_read (room_id ${ROOM_A}, after 14).`,
    ]);
    for (const line of next) expect(line).toMatch(NOTE_PATTERN);
    expect(world.allFileText()).not.toContain(CANARY);
  });

  test("UserPromptSubmit covers messages whose ring failed", async () => {
    const { world, hook } = hookWorld();
    world.listener();
    const watcher = new Watcher({
      doorbellHome: world.doorbellHome, lobbyHome: world.lobbyHome, roomId: ROOM_A, pid: WATCHER,
      ring: async () => ({ ok: false, code: "ECONNREFUSED" }), ownerGone: () => false, now: () => world.clock,
    });
    world.bell({ seq: 1, head_cursor: "10" });
    await watcher.tick();
    world.bell({ seq: 2, head_cursor: "12", new: 2, addressed: 1 });
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    expect(await hook(event("UserPromptSubmit"))).toEqual([
      `[lobby] 2 new Lobby message(s) in ${ROOM_A} after cursor 10 (1 addressed to this desk, 0 unverified); no message text here; read with room_read (room_id ${ROOM_A}, after 10).`,
    ]);
    // The watcher's mark is now behind the note's: the next note starts after the note, not after the failed ring.
    world.bell({ seq: 3, head_cursor: "13", new: 3, addressed: 2 });
    expect(await hook(event("UserPromptSubmit"))).toEqual([
      `[lobby] 1 new Lobby message(s) in ${ROOM_A} after cursor 12 (1 addressed to this desk, 0 unverified); no message text here; read with room_read (room_id ${ROOM_A}, after 12).`,
    ]);
  });

  test("a note starts after whichever of the last ring and the last note reached the later cursor, even when only unverified events moved", async () => {
    const { world, hook } = hookWorld();
    world.listener();
    const rings: string[] = [];
    const watcher = new Watcher({
      doorbellHome: world.doorbellHome, lobbyHome: world.lobbyHome, roomId: ROOM_A, pid: WATCHER,
      ring: async (text) => { rings.push(text); return { ok: true, code: null }; }, ownerGone: () => false, now: () => world.clock,
    });
    world.bell({ seq: 1, head_cursor: "10" });
    await watcher.tick();
    expect(await hook(event("UserPromptSubmit"))).toEqual([]);
    // An addressed message: the prompt hook tells the agent first.
    world.bell({ seq: 2, head_cursor: "12", new: 1, addressed: 1 });
    expect(await hook(event("UserPromptSubmit"))).toEqual([
      `[lobby] 1 new Lobby message(s) in ${ROOM_A} after cursor 10 (1 addressed to this desk, 0 unverified); no message text here; read with room_read (room_id ${ROOM_A}, after 10).`,
    ]);
    // An unverified event arrives, then the watcher rings: its mark has the same `new` as the note's, a later cursor.
    world.bell({ seq: 3, head_cursor: "13", new: 1, addressed: 1, unverified: 1 });
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    expect(rings).toHaveLength(1);
    expect(rings[0]).toContain("1 new table message(s) after cursor 10 (head 13), 1 addressed to this desk, 1 unverified.");
    // The next note starts after the ring's cursor and does not count the unverified event again.
    world.bell({ seq: 4, head_cursor: "14", new: 2, addressed: 2, unverified: 1 });
    expect(await hook(event("UserPromptSubmit"))).toEqual([
      `[lobby] 1 new Lobby message(s) in ${ROOM_A} after cursor 13 (1 addressed to this desk, 0 unverified); no message text here; read with room_read (room_id ${ROOM_A}, after 13).`,
    ]);
  });

  test("UserPromptSubmit notes each stop once, a stop at a later seq too, even when the ok in between was never seen", async () => {
    const { world, hook } = hookWorld();
    world.listener();
    const stopped = `[lobby] ${ROOM_A}: stopped (cli_failed); check with agenttool-lobby-doorbell status.`;
    world.bell({ seq: 1, head_cursor: "10" });
    expect(await hook(event("UserPromptSubmit"))).toEqual([]);
    world.bell({ seq: 2, head_cursor: "10", state: "stopped", reason: "cli_failed" });
    expect(await hook(event("UserPromptSubmit"))).toEqual([stopped]);
    expect(await hook(event("UserPromptSubmit"))).toEqual([]);
    // A re-armed fetcher's ok (seq 3) and its stop (seq 4) came between two prompts.
    world.bell({ seq: 4, head_cursor: "10", state: "stopped", reason: "cli_failed" });
    expect(await hook(event("UserPromptSubmit"))).toEqual([stopped]);
    expect(await hook(event("UserPromptSubmit"))).toEqual([]);
    expect(stopped).toMatch(NOTE_PATTERN);
  });

  test("UserPromptSubmit names a lapse even before the head is known", async () => {
    const { world, hook } = hookWorld();
    world.listener();
    world.bell({ seq: 1, base_cursor: null, head_cursor: null, state: "grant-lapsed", reason: "refused_401" });
    expect(await hook(event("UserPromptSubmit"))).toEqual([`[lobby] ${ROOM_A}: grant-lapsed (refused_401); a person must renew it.`]);
    expect(await hook(event("UserPromptSubmit"))).toEqual([]);
  });

  test("SessionStart on resume in a new process re-owns the listener, re-arms the watcher from the inbox and ensures the fetcher", async () => {
    const { world, started, hook } = hookWorld({ CLAUDE_CODE_MESSAGING_SOCKET: `/tmp/cc/${NEW_OWNER}.sock`, CLAUDE_CODE_MESSAGING_TOKEN: "token-for-tests" });
    world.listener();
    world.procs.delete(OWNER);
    world.procs.delete(WATCHER);
    world.procs.set(NEW_OWNER, LSTART);
    expect(await hook(event("SessionStart", { source: "resume" }), { CLAUDE_PID: String(NEW_OWNER) })).toEqual([]);
    const after = readListener(world.doorbellHome, ROOM_A);
    expect(after).toMatchObject({ kind: "ok", listener: { owner_pid: NEW_OWNER, watcher_pid: NEW_WATCHER, seat_ref: SEAT } });
    expect(started.map((start) => start.argv.slice(-3))).toEqual([["watch", "--room", ROOM_A], ["--config=/dev/null", SELF, "fetch"]]);
    // Only the watcher gets the inbox variables; the fetcher never sees the token.
    expect(started[0]!.env.CLAUDE_CODE_MESSAGING_TOKEN).toBe("token-for-tests");
    expect(started[1]!.env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined();
    expect(started[1]!.env.CLAUDE_CODE_MESSAGING_SOCKET).toBeUndefined();
  });

  test("SessionStart without the inbox prints one re-arm line; startup in a fresh session does nothing", async () => {
    const { world, started, hook } = hookWorld();
    world.listener();
    world.procs.delete(WATCHER);
    expect(await hook(event("SessionStart", { source: "resume" }))).toEqual([
      `[lobby] this session listened to ${ROOM_A}; re-arm with: agenttool-lobby-doorbell listen --room ${ROOM_A}`,
    ]);
    expect(started).toEqual([]);
    expect(await hook({ ...event("SessionStart", { source: "startup" }), session_id: NEW_SESSION }, { CLAUDE_PID: "9000030" })).toEqual([]);
  });

  test("/clear is a continuation: the listener moves to the new session id in the same process", async () => {
    const { world, hook } = hookWorld();
    world.listener();
    expect(await hook({ ...event("SessionStart", { source: "clear" }), session_id: NEW_SESSION })).toEqual([]);
    expect(readListener(world.doorbellHome, ROOM_A)).toMatchObject({ kind: "ok", listener: { seat_ref: `claude-code:${NEW_SESSION}`, owner_pid: OWNER } });
  });

  test("a resume to another session in the same process does not move the listener (only /clear does)", async () => {
    const { world, started, hook } = hookWorld();
    world.listener();
    expect(await hook({ ...event("SessionStart", { source: "resume" }), session_id: NEW_SESSION })).toEqual([]);
    expect(readListener(world.doorbellHome, ROOM_A)).toMatchObject({ kind: "ok", listener: { seat_ref: SEAT, owner_pid: OWNER, watcher_pid: WATCHER } });
    expect(started.filter((start) => start.argv.includes("watch"))).toEqual([]);
  });

  test("SessionEnd from another process with the same seat ref leaves the live holder's listener alone", async () => {
    const { world, hook } = hookWorld();
    world.listener();
    world.procs.set(NEW_OWNER, LSTART);
    await hook(event("SessionEnd", { reason: "prompt_input_exit" }), { CLAUDE_PID: String(NEW_OWNER) });
    expect(readListener(world.doorbellHome, ROOM_A)).toMatchObject({ kind: "ok", listener: { owner_pid: OWNER } });
  });

  test("SessionEnd: an exiting process releases its listeners; clear, resume and unknown reasons keep them", async () => {
    const { world, hook } = hookWorld();
    world.listener();
    world.listener({ room_id: ROOM_B });
    for (const reason of ["clear", "resume", "bypass_permissions_disabled"]) {
      await hook(event("SessionEnd", { reason }));
      expect(existsSync(listenerPath(world.doorbellHome, ROOM_A))).toBe(true);
    }
    await hook(event("SessionEnd", { reason: "prompt_input_exit" }));
    expect(readdirSync(join(world.doorbellHome, "listeners"))).toEqual([]);
  });

  test("the CLI always exits 0, prints at most one stderr line, and never echoes its input", async () => {
    const { world } = hookWorld();
    for (const input of ["{", JSON.stringify(event("UserPromptSubmit", { prompt: CANARY })), "x".repeat(2 * 1024 * 1024)]) {
      let stdout = "";
      let stderr = "";
      const code = await runCli(["hook", "claude-code"], {
        stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; },
        env: { XDG_STATE_HOME: join(world.root, "state"), AGENTOOL_LOBBY_HOME: CANARY }, fetchImpl: null, readStdin: async () => input,
      });
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr.split("\n").filter(Boolean).length).toBeLessThanOrEqual(1);
      expect(stderr).not.toContain(CANARY);
    }
    expect(NOW).toBeGreaterThan(0);
  });

  test("install-hooks only prints the settings.json snippet", async () => {
    const snippet = JSON.parse(hooksSnippet('"$HOME/.local/bin/agenttool-lobby-doorbell"'));
    expect(Object.keys(snippet.hooks)).toEqual(["SessionStart", "UserPromptSubmit", "SessionEnd"]);
    expect(snippet.hooks.UserPromptSubmit[0].hooks[0]).toEqual({ type: "command", command: '"$HOME/.local/bin/agenttool-lobby-doorbell" hook claude-code', timeout: 5 });
    let stdout = "";
    let stderr = "";
    const io = { stdout: (text: string) => { stdout += text; }, stderr: (text: string) => { stderr += text; }, env: {}, fetchImpl: null };
    expect(await runCli(["install-hooks", "--print"], io)).toBe(0);
    expect(JSON.parse(stdout)).toEqual(snippet);
    expect(await runCli(["install-hooks"], io)).toBe(2);
    expect(stderr).toContain("only prints");
  });
});
