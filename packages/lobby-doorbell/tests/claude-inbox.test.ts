import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeInboxRing, inboxLines, socketOwnerPid } from "../src/claude-inbox.js";
import { defaultSeatRef, isSeatRef, MAX_SEAT_REF } from "../src/seat-ref.js";
import { packageRoot } from "./helpers.js";

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function fakeInbox() {
  const directory = mkdtempSync(join(tmpdir(), "ldb-"));
  directories.push(directory);
  const path = join(directory, `${process.pid}.sock`);
  const connections: string[][] = [];
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => { buffer += chunk; });
    socket.on("end", () => connections.push(buffer.split("\n").filter(Boolean)));
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(path, ready));
  return { path, connections };
}

describe("the Claude Code inbox ring", () => {
  test("posts the auth line, then one user line, and ends the connection", async () => {
    const inbox = await fakeInbox();
    const result = await claudeInboxRing(inbox.path, "inbox-token-for-tests")("[lobby bell v2] room ...");
    expect(result).toEqual({ ok: true, code: null });
    for (let tries = 0; tries < 50 && inbox.connections.length === 0; tries += 1) await Bun.sleep(10);
    expect(inbox.connections).toHaveLength(1);
    const [auth, line] = inbox.connections[0]!;
    expect(JSON.parse(auth!)).toEqual({ type: "auth", token: "inbox-token-for-tests" });
    expect(JSON.parse(line!)).toEqual({ type: "user", message: { role: "user", content: "[lobby bell v2] room ..." } });
    expect(line).not.toContain("inbox-token-for-tests");
  });

  test("a missing socket fails with a code, never throws, never echoes the token", async () => {
    const result = await claudeInboxRing(join(tmpdir(), "ldb-missing", "1.sock"), "inbox-token-for-tests")("x");
    expect(result.ok).toBe(false);
    expect(result.code).toMatch(/^E[A-Z]+$/);
  });

  test("the socket name gives the owner pid, as Claude Code names it", () => {
    expect(socketOwnerPid("/tmp/claude/21320.sock")).toBe(21320);
    expect(socketOwnerPid("/tmp/claude/inbox.sock")).toBeNull();
  });

  // Shape parity with collab's watcher: the two rings cannot drift apart unnoticed.
  const collab = join(packageRoot, "..", "collab", "integrations", "claude-code", "collab-doorbell-watch.ts");
  test.skipIf(!existsSync(collab))("the line constructor matches collab's ring()", () => {
    const source = readFileSync(collab, "utf8");
    const ours = readFileSync(join(packageRoot, "src", "claude-inbox.ts"), "utf8");
    for (const shape of [
      'JSON.stringify({ type: "user", message: { role: "user", content: text } })',
      "JSON.stringify({ type: \"auth\", token })",
    ]) {
      expect({ shape, collab: source.includes(shape), ours: ours.includes(shape) }).toEqual({ shape, collab: true, ours: true });
    }
    expect(source).toContain('const ownerPid = /^\\d+$/.test(socketName) ? Number(socketName) : null;');
    expect(inboxLines("t", "k")).toEqual(['{"type":"auth","token":"k"}', '{"type":"user","message":{"role":"user","content":"t"}}']);
    expect(inboxLines("t", undefined)).toEqual(['{"type":"user","message":{"role":"user","content":"t"}}']);
  });
});

describe("seat refs (copied from #491's seat-ref.ts, no override variable)", () => {
  // Shared test vectors; Build 5's seat leases use the same ones.
  const VECTORS: Array<[Record<string, string | undefined>, string | null]> = [
    [{ CLAUDE_CODE_SESSION_ID: "0F0E0D0C-0B0A-4908-8706-050403020100" }, "claude-code:0f0e0d0c-0b0a-4908-8706-050403020100"],
    [{ CLAUDE_CODE_SESSION_ID: "not-a-uuid", CODEX_THREAD_ID: "019A0000-0000-7000-8000-00000000000A" }, "codex:019a0000-0000-7000-8000-00000000000a"],
    [{ CLAUDE_CODE_SESSION_ID: "0f0e0d0c-0b0a-4908-8706-050403020100", CODEX_THREAD_ID: "019a0000-0000-7000-8000-00000000000a" }, "claude-code:0f0e0d0c-0b0a-4908-8706-050403020100"],
    [{ AGENTOOL_COLLAB_SEAT_REF: "declared:x", AGENTTOOL_LOBBY_SEAT_REF: "declared:y" }, null],
    [{}, null],
  ];

  test("the vectors", () => {
    for (const [env, expected] of VECTORS) expect({ env, ref: defaultSeatRef(env) }).toEqual({ env, ref: expected });
  });

  test("the grammar", () => {
    expect(isSeatRef("claude-code:0f0e0d0c-0b0a-4908-8706-050403020100")).toBe(true);
    expect(isSeatRef("a".repeat(MAX_SEAT_REF))).toBe(true);
    for (const bad of ["", "a".repeat(MAX_SEAT_REF + 1), ":leading", "has space", "new\nline", "é"]) expect(isSeatRef(bad)).toBe(false);
  });

  const collabRef = join(packageRoot, "..", "collab", "src", "seat-ref.ts");
  test.skipIf(!existsSync(collabRef))("matches collab's seat-ref.ts once it is on this branch", () => {
    const source = readFileSync(collabRef, "utf8");
    const ours = readFileSync(join(packageRoot, "src", "seat-ref.ts"), "utf8");
    for (const line of [
      "const SEAT_REF = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;",
      "const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
      "export const MAX_SEAT_REF = 200;",
      "  if (claude && UUID.test(claude)) return `claude-code:${claude.toLowerCase()}`;",
      "  if (codex && UUID.test(codex)) return `codex:${codex.toLowerCase()}`;",
    ]) expect({ line, collab: source.includes(line), ours: ours.includes(line) }).toEqual({ line, collab: true, ours: true });
  });
});
