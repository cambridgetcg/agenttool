import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { knockLedgerPath, runCollabHostCli } from "../src/host.js";
import { hostBindingPath, hostBindingRecorder, readHostBindings } from "../src/host-binding.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { ProcessRecord, ProcessTable } from "../src/process-tree.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

// Where the host binding (one file per session a host's conversation holds)
// meets named child bindings (binding_key slots inside one MCP process). The
// file has one meaning for every reader: the session this host's own
// conversation holds. Only the default slot fits it, so only the default slot
// writes one. A named child keeps its mailbox and the by-id verbs.
const packageRoot = resolve(import.meta.dir, "..");
const mcpEntry = join(packageRoot, "bin", "agenttool-collab-mcp.ts");
const SEAT_STARTED = "Fri Oct 9 09:00:00 2026";

let directory: string;
let root: string;
let databasePath: string;
let clock: Date;
let store: CollabStore;
let workspaceId: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-binding-slots-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  clock = new Date("2026-11-12T12:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => clock });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function proc(pid: number, ppid: number, comm: string, args = comm): ProcessRecord {
  return { pid, ppid, comm, args, started_at: SEAT_STARTED };
}

/** launchd → claude seat 4100 → (collab MCP 4101, prompt-hook shell 4150). */
function seat(): ProcessTable {
  return new Map([
    proc(1, 0, "/sbin/launchd"),
    proc(4100, 1, "/Users/someone/.local/bin/claude", "claude"),
    proc(4101, 4100, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp"),
    proc(4150, 4100, "/bin/zsh", "/bin/zsh -c knock-tap"),
  ].map((entry) => [entry.pid, entry]));
}

function seatServer() {
  return buildCollabMcpServer(store, {
    host_binding: hostBindingRecorder(databasePath, {
      mcp_pid: 4101,
      process_table: seat,
      now: () => clock,
      env: { CLAUDE_CODE_SESSION_ID: "fixture-conversation" },
    }),
  });
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  return await (registration.handler ?? registration.callback)(args, {});
}

async function start(server: any, actor: string, child?: { key: string; parent: string }): Promise<string> {
  const result = await callTool(server, "collab_session_start", {
    root_path: root,
    actor,
    ...(child ? { binding_key: child.key, parent_session_id: child.parent } : {}),
  });
  expect(result.isError).toBeUndefined();
  workspaceId = result.structuredContent.workspace.id as string;
  return result.structuredContent.session.id as string;
}

function host(argv: string[]): Record<string, any> | null {
  const result = runCollabHostCli([...argv, "--db", databasePath], {}, { process_table: seat, now: () => clock });
  expect(result.exit_code).toBe(0);
  return result.line === null ? null : JSON.parse(result.line);
}

const tap = () => host(["knocks", "--host-ancestor", "4150", "--mark-tapped"]);
const boundSessions = () => readHostBindings(databasePath).map((binding) => binding.session_id);

function noteTo(sessionId: string, key: string): void {
  const sender = store.startSession({ root_path: root, actor: `sender-${key}` });
  store.appendReportForSession({
    ...sender.credential,
    idempotency_key: key,
    to_session_id: sessionId,
    kind: "observation",
    body: `A note for ${key}.`,
  });
}

describe("host bindings and named child slots", () => {
  test("a named child writes no host binding, beside its parent or alone", async () => {
    const lone = seatServer();
    // A named child may start while the default slot is still empty.
    const orphanParent = store.startSession({ root_path: root, actor: "elsewhere-parent" });
    const orphan = await start(lone, "lone-child", { key: "lone", parent: orphanParent.session.id });
    expect(boundSessions()).toEqual([]);
    expect(existsSync(hostBindingPath(databasePath, orphan))).toBe(false);
    noteTo(orphan, "lone-child");
    expect(tap()).toBeNull();

    const parent = await start(lone, "parent");
    const child = await start(lone, "child", { key: "child", parent });
    expect(boundSessions()).toEqual([parent]);
    expect(existsSync(hostBindingPath(databasePath, child))).toBe(false);
    expect(Object.keys(JSON.parse(readFileSync(hostBindingPath(databasePath, parent), "utf8"))).sort()).toEqual([
      "credential_file_path",
      "format",
      "host_kind",
      "host_pid",
      "host_started_at",
      "mcp_pid",
      "session_id",
      "written_at",
    ]);
  });

  test("the tap keeps speaking for the parent while a named child is bound", async () => {
    const server = seatServer();
    const parent = await start(server, "parent");
    const child = await start(server, "child", { key: "child", parent });
    noteTo(parent, "parent");

    const first = tap();
    expect(first?.session_id).toBe(parent);
    expect(first?.waiting).toBe(1);
    expect(first?.new).toHaveLength(1);

    // The child resting changes nothing for the parent: same line, nothing new.
    expect((await callTool(server, "collab_session_rest", {
      binding_key: "child",
      idempotency_key: "child-rests",
      mode: "resting",
    })).isError).toBeUndefined();
    const second = tap();
    expect(second?.session_id).toBe(parent);
    expect(second?.waiting).toBe(1);
    expect(second?.new).toEqual([]);

    const ledger = JSON.parse(readFileSync(knockLedgerPath(databasePath), "utf8"));
    expect(JSON.stringify(ledger)).toContain(parent);
    expect(JSON.stringify(ledger)).not.toContain(child);
  });

  test("a child's notes stay in its own mailbox and are read by id", async () => {
    const server = seatServer();
    const parent = await start(server, "parent");
    const child = await start(server, "child", { key: "child", parent });
    noteTo(child, "child");

    const line = tap();
    expect(line?.session_id).toBe(parent);
    expect(line?.waiting).toBe(0);

    const byId = host(["knocks", "--session", child]);
    expect(byId?.session_id).toBe(child);
    expect(byId?.waiting).toBe(1);
    const next = await callTool(server, "collab_next", { binding_key: "child", workspace_id: workspaceId });
    expect(next.isError).toBeUndefined();
    expect(next.structuredContent.session.id).toBe(child);
    expect(next.structuredContent.session.addressed_waiting).toBe(1);
  });

  test("doorbell-scan lists a resting child without a host and its resting parent with one", async () => {
    const server = seatServer();
    const parent = await start(server, "parent");
    const child = await start(server, "child", { key: "child", parent });
    for (const [key, binding_key] of [["parent", undefined], ["child", "child"]] as const) {
      expect((await callTool(server, "collab_session_rest", {
        ...(binding_key ? { binding_key } : {}),
        idempotency_key: `${key}-rests`,
        mode: "resting",
        wake_on: ["addressed"],
      })).isError).toBeUndefined();
    }
    noteTo(parent, "parent");
    noteTo(child, "child");

    const scan = host(["doorbell-scan"]);
    const listed = new Map<string, any>(scan!.sessions.map((entry: any) => [entry.session_id, entry]));
    expect([...listed.keys()].sort()).toEqual([parent, child].sort());
    expect(listed.get(parent).binding).toMatchObject({ session_id: parent, host_pid: 4100, mcp_pid: 4101 });
    // No host can deliver to a named child: the scan says so with a null binding.
    expect(listed.get(child).binding).toBeNull();
    expect(listed.get(child).waiting).toBe(1);
  });

  test("resting and returning on a named slot never writes a binding", async () => {
    const server = seatServer();
    const parent = await start(server, "parent");
    const child = await start(server, "child", { key: "child", parent });
    for (const mode of ["resting", "ready"]) {
      expect((await callTool(server, "collab_session_rest", {
        binding_key: "child",
        idempotency_key: `child-${mode}`,
        mode,
      })).isError).toBeUndefined();
      expect(existsSync(hostBindingPath(databasePath, child))).toBe(false);
      expect(boundSessions()).toEqual([parent]);
    }
  });

  test("ending the child leaves the parent's binding; ending the parent leaves the host silent", async () => {
    const server = seatServer();
    const parent = await start(server, "parent");
    const child = await start(server, "child", { key: "child", parent });
    const second = await start(server, "second", { key: "second", parent });

    expect((await callTool(server, "collab_session_end", { binding_key: "child", reason: "done" })).isError)
      .toBeUndefined();
    expect(boundSessions()).toEqual([parent]);
    noteTo(parent, "parent");
    expect(tap()?.new).toHaveLength(1);

    expect((await callTool(server, "collab_session_end", { reason: "parent done" })).isError).toBeUndefined();
    expect(boundSessions()).toEqual([]);
    // The remaining child is not this host's conversation: no line, and its
    // note is not spent on a tap the child would never see.
    noteTo(second, "second");
    expect(tap()).toBeNull();
    expect(host(["knocks", "--session", second])?.new).toHaveLength(1);
    expect(child).not.toBe(second);
  });

  test("the bin keeps one binding when a resumed default session gains a named child", async () => {
    const handle = store.startSession({ root_path: root, actor: "resumed-parent" });
    const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
    const child = Bun.spawn([process.execPath, mcpEntry], {
      cwd: packageRoot,
      env: {
        AGENTOOL_COLLAB_DB: databasePath,
        AGENTOOL_COLLAB_SESSION_FILE: file,
        PATH: process.env.PATH ?? "",
        TMPDIR: tmpdir(),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      const request = async (id: number, method: string, params: Record<string, unknown>) => {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        await child.stdin.flush();
        while (true) {
          const newline = buffered.indexOf("\n");
          if (newline >= 0) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            const message = JSON.parse(line);
            if (message.id === id) return message.result;
            continue;
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error("MCP stdout closed");
          buffered += decoder.decode(chunk.value, { stream: true });
        }
      };
      await request(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "binding-slots-test", version: "0" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

      const started = await request(2, "tools/call", {
        name: "collab_session_start",
        arguments: {
          root_path: root,
          actor: "stdio-child",
          binding_key: "stdio-child",
          parent_session_id: handle.session.id,
        },
      });
      expect(started.isError).toBeUndefined();
      expect(started.structuredContent.session.id).not.toBe(handle.session.id);
      expect(boundSessions()).toEqual([handle.session.id]);
    } finally {
      child.kill();
      await child.exited;
    }
  });
});
