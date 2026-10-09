import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCollabHostCli } from "../src/host.js";
import {
  HOST_BINDING_FORMAT,
  hostBindingPath,
  hostBindingRecorder,
  readHostBindings,
  removeHostBinding,
  writeHostBinding,
  type HostBinding,
} from "../src/host-binding.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { readProcessTable, type ProcessRecord, type ProcessTable } from "../src/process-tree.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const mcpEntry = join(packageRoot, "bin", "agenttool-collab-mcp.ts");

let directory: string;
let root: string;
let databasePath: string;
let sessionsDirectory: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-binding-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  sessionsDirectory = join(directory, "state", "collab-sessions");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function binding(sessionId: string, overrides: Partial<HostBinding> = {}): HostBinding {
  return {
    format: HOST_BINDING_FORMAT,
    session_id: sessionId,
    host_kind: "codex",
    host_pid: 4100,
    host_started_at: "Fri Oct 9 10:00:00 2026",
    mcp_pid: 4101,
    credential_file_path: join(sessionsDirectory, `${sessionId}.json`),
    written_at: "2026-10-09T10:00:05.000Z",
    ...overrides,
  };
}

function fakeTable(...records: Array<Partial<ProcessRecord> & { pid: number; ppid: number }>): ProcessTable {
  return new Map(records.map((entry) => [entry.pid, {
    started_at: "Fri Oct 9 10:00:00 2026",
    comm: "bun",
    args: "bun",
    ...entry,
  }]));
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("host binding files", () => {
  test("write, read and replace one private binding per session beside the credential files", () => {
    const first = binding("session_a");
    const path = writeHostBinding(databasePath, first);
    expect(path).toBe(join(sessionsDirectory, "session_a.host.json"));
    expect(hostBindingPath(databasePath, "session_a")).toBe(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(sessionsDirectory).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(first);
    expect(readHostBindings(databasePath)).toEqual([first]);

    const replaced = binding("session_a", { host_kind: "claude-code", host_pid: 5100, mcp_pid: 5101 });
    writeHostBinding(databasePath, replaced);
    expect(readHostBindings(databasePath)).toEqual([replaced]);
    expect(readdirSync(sessionsDirectory)).toEqual(["session_a.host.json"]);
  });

  test("refuses malformed bindings and unsafe session ids before touching disk", () => {
    for (const bad of [
      binding("../escape"),
      binding("session_a", { credential_file_path: "relative/session_a.json" }),
      binding("session_a", { host_pid: 1 }),
      binding("session_a", { host_kind: "hermes" as never }),
      binding("session_a", { host_started_at: " " }),
    ]) {
      expect(() => writeHostBinding(databasePath, bad)).toThrow();
    }
    expect(existsSync(sessionsDirectory)).toBe(false);
  });

  test("reads only well-formed private *.host.json files named for their session", () => {
    writeHostBinding(databasePath, binding("session_b"));
    writeHostBinding(databasePath, binding("session_a"));
    const write = (name: string, body: string, mode = 0o600) => {
      writeFileSync(join(sessionsDirectory, name), body, { mode });
      chmodSync(join(sessionsDirectory, name), mode);
    };
    write("session_c.host.json", "{not json");
    write("session_d.host.json", JSON.stringify(binding("session_other")));
    write("session_e.host.json", JSON.stringify(binding("session_e")), 0o644);
    write("session_f.json", JSON.stringify(binding("session_f")));
    write("knock-ledger.json", JSON.stringify({ format: "agenttool.collab-knock-ledger/1", tapped: {} }));
    symlinkSync(join(sessionsDirectory, "session_a.host.json"), join(sessionsDirectory, "session_g.host.json"));
    expect(readHostBindings(databasePath).map((entry) => entry.session_id)).toEqual(["session_a", "session_b"]);

    chmodSync(sessionsDirectory, 0o755);
    try {
      expect(readHostBindings(databasePath)).toEqual([]);
    } finally {
      chmodSync(sessionsDirectory, 0o700);
    }
    expect(readHostBindings(join(directory, "nowhere", "collab.sqlite"))).toEqual([]);
  });

  test("removal is idempotent and never follows a symlink", () => {
    writeHostBinding(databasePath, binding("session_a"));
    expect(removeHostBinding(databasePath, "session_a")).toBe(true);
    expect(existsSync(join(sessionsDirectory, "session_a.host.json"))).toBe(false);
    expect(removeHostBinding(databasePath, "session_a")).toBe(true);
    expect(removeHostBinding(databasePath, "../escape")).toBe(false);

    const target = join(directory, "target.json");
    writeFileSync(target, "keep");
    symlinkSync(target, join(sessionsDirectory, "session_link.host.json"));
    expect(removeHostBinding(databasePath, "session_link")).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("keep");
  });
});

describe("hostBindingRecorder", () => {
  const seat = fakeTable(
    { pid: 1, ppid: 0, comm: "/sbin/launchd" },
    { pid: 4100, ppid: 1, comm: "/Users/someone/.local/bin/claude", args: "claude", started_at: "Thu Oct 8 21:50:55 2026" },
    { pid: 4101, ppid: 4100, args: "bun /opt/homebrew/bin/agenttool-collab-mcp" },
  );

  test("records the MCP's direct parent as the host, and forgets on request", () => {
    const recorder = hostBindingRecorder(databasePath, {
      mcp_pid: 4101,
      process_table: () => seat,
      env: { CLAUDE_CODE_SESSION_ID: "claude-session" },
      now: () => new Date("2026-10-09T12:00:00.000Z"),
    });
    expect(recorder.record("session_a", join(sessionsDirectory, "session_a.json"))).toBe(true);
    expect(readHostBindings(databasePath)).toEqual([{
      format: HOST_BINDING_FORMAT,
      session_id: "session_a",
      host_kind: "claude-code",
      host_pid: 4100,
      host_started_at: "Thu Oct 8 21:50:55 2026",
      mcp_pid: 4101,
      credential_file_path: join(sessionsDirectory, "session_a.json"),
      written_at: "2026-10-09T12:00:00.000Z",
    }]);
    recorder.forget("session_a");
    expect(readHostBindings(databasePath)).toEqual([]);
  });

  test("leaves no stale binding when the host cannot be read", () => {
    writeHostBinding(databasePath, binding("session_a"));
    const blind = hostBindingRecorder(databasePath, { mcp_pid: 4101, process_table: () => null });
    expect(blind.record("session_a", join(sessionsDirectory, "session_a.json"))).toBe(false);
    expect(readHostBindings(databasePath)).toEqual([]);
  });
});

describe("binding lifecycle through the MCP server and the host CLI", () => {
  test("collab_session_start records the host and collab_session_end removes it", async () => {
    const recorder = hostBindingRecorder(databasePath, {
      mcp_pid: 4101,
      process_table: () => fakeTable(
        { pid: 4100, ppid: 1, comm: "codex", args: "codex" },
        { pid: 4101, ppid: 4100, args: "bun dist/agenttool-collab-mcp.js" },
      ),
      env: {},
    });
    const server = buildCollabMcpServer(store, { host_binding: recorder });
    const started = await callTool(server, "collab_session_start", { root_path: root, actor: "binding-start" });
    expect(started.isError).toBeUndefined();
    const sessionId = started.structuredContent.session.id as string;
    expect(started.structuredContent).not.toHaveProperty("host_binding");
    expect(readHostBindings(databasePath)).toEqual([expect.objectContaining({
      session_id: sessionId,
      host_kind: "codex",
      host_pid: 4100,
      mcp_pid: 4101,
      credential_file_path: store.defaultSessionCredentialPath(sessionId),
    })]);

    const ended = await callTool(server, "collab_session_end", { reason: "done" });
    expect(ended.isError).toBeUndefined();
    expect(readHostBindings(databasePath)).toEqual([]);
    expect(existsSync(store.defaultSessionCredentialPath(sessionId))).toBe(false);
  });

  test("a server built without a recorder writes no binding", async () => {
    const server = buildCollabMcpServer(store);
    const started = await callTool(server, "collab_session_start", { root_path: root, actor: "binding-none" });
    expect(started.isError).toBeUndefined();
    expect(readHostBindings(databasePath)).toEqual([]);
    expect(readdirSync(sessionsDirectory).filter((name) => name.endsWith(".host.json"))).toEqual([]);
  });

  test("agenttool-collab-host end removes the binding, for ended and already_ended alike", () => {
    for (const alreadyEnded of [false, true]) {
      const handle = store.startSession({ root_path: root, actor: `binding-host-end-${alreadyEnded}` });
      const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
      writeHostBinding(databasePath, binding(handle.session.id, { credential_file_path: file }));
      if (alreadyEnded) store.endSession({ ...handle.credential, reason: "ended in-process first" });

      const run = runCollabHostCli(
        ["end", "--session-file", file, "--reason", "host exit sweep", "--db", databasePath],
        {},
      );
      expect(run.exit_code).toBe(0);
      expect(JSON.parse(run.line!).status).toBe(alreadyEnded ? "already_ended" : "ended");
      expect(existsSync(hostBindingPath(databasePath, handle.session.id))).toBe(false);
    }
  });

  test("the bin's resume path records its real parent, and its session end removes the binding", async () => {
    const handle = store.startSession({ root_path: root, actor: "binding-resume" });
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
        clientInfo: { name: "binding-test", version: "0" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

      // The binding is written before the transport connects, so it exists by now.
      const recorded = readHostBindings(databasePath);
      expect(recorded).toEqual([{
        format: HOST_BINDING_FORMAT,
        session_id: handle.session.id,
        host_kind: "unknown",
        host_pid: process.pid,
        host_started_at: readProcessTable()!.get(process.pid)!.started_at,
        mcp_pid: child.pid,
        credential_file_path: file,
        written_at: expect.any(String),
      }]);

      const ended = await request(2, "tools/call", {
        name: "collab_session_end",
        arguments: { reason: "binding test done" },
      });
      expect(ended.isError).toBeUndefined();
      expect(readHostBindings(databasePath)).toEqual([]);
    } finally {
      child.kill();
      await child.exited;
    }
  });
});
