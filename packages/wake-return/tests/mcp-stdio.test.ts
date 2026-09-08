import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { buildReturnMcpServer, ReturnStdioTransport, returnReportSchema } from "../mcp/server.js";
import { createReturnSession } from "../src/core.js";
import { RETURN_ORIGIN, type ReturnBinding, type ReturnReport, type ReturnSession } from "../src/types.js";

const CANARY = "NEVER_REFLECT_PRIVATE_ARGUMENT_OR_EXCEPTION";
const cli = fileURLToPath(new URL("../dist/bin/agenttool-wake-return-mcp.js", import.meta.url));
const binding: ReturnBinding = {
  _format: "agenttool-return-binding/v1", api_origin: RETURN_ORIGIN,
  project_id: "11111111-1111-4111-8111-111111111111",
  identity_id: "22222222-2222-4222-8222-222222222222", mode: "observe",
  allow_provider_visible_locator: true, credential: { kind: "environment" },
};

type Envelope = { id?: number; result?: any; error?: any; method?: string };

class Peer {
  lastId = 0;
  raw = "";
  unsolicited: Envelope[] = [];
  private buffer = "";
  private pending = new Map<number, { resolve(value: Envelope): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private input: Writable, output: Readable) {
    output.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.raw += text;
      this.buffer += text;
      while (this.buffer.includes("\n")) {
        const newline = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const response: Envelope = JSON.parse(line);
        const waiter = response.id === undefined ? undefined : this.pending.get(response.id);
        if (!waiter) { this.unsolicited.push(response); continue; }
        clearTimeout(waiter.timer);
        this.pending.delete(response.id!);
        waiter.resolve(response);
      }
    });
  }
  request(method: string, params: unknown = {}): Promise<Envelope> {
    const id = ++this.lastId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("RPC deadline")); }, 3_000);
      this.pending.set(id, { resolve, reject, timer });
      this.input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method: string, params: unknown = {}): void {
    this.input.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async initialize() {
    const response = await this.request("initialize", {
      protocolVersion: "2025-11-25", capabilities: {},
      clientInfo: { name: "hermetic-wake-return-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    return response;
  }
  close(): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("RPC closed"));
    }
    this.pending.clear();
  }
}

let temporary: string;
let bindingPath: string;
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "wake-return-mcp-"));
  bindingPath = join(temporary, "binding.json");
  await writeFile(bindingPath, JSON.stringify(binding), { mode: 0o600 });
});
afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });

function start(runtime: string, args: string[]) {
  const child = spawn(runtime, [cli, ...args], {
    env: { PATH: process.env.PATH ?? "", AGENTTOOL_RETURN_BEARER: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const ended = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { child, ended, stderr: () => stderr };
}

async function wire(session: ReturnSession) {
  const input = new PassThrough();
  const output = new PassThrough();
  const peer = new Peer(input, output);
  const server = buildReturnMcpServer(session);
  server.server.onerror = () => undefined;
  let closed = false;
  server.server.onclose = () => { closed = true; };
  await server.connect(new ReturnStdioTransport(input, output));
  await peer.initialize();
  return { peer, input, isClosed: () => closed, close: async () => { peer.close(); await server.close(); input.destroy(); output.destroy(); } };
}

function readyReport(): ReturnReport {
  return createReturnSession(binding, { withReader: async () => { throw new Error(CANARY); } }).status();
}

describe("actual compiled Node and Bun stdio", () => {
  for (const runtime of ["node", process.execPath]) {
    test(`${runtime === "node" ? "Node" : "Bun"}: exactly two closed tools, explicit status/observe, sanitized refusal`, async () => {
      const processHandle = start(runtime, ["--binding", bindingPath]);
      const peer = new Peer(processHandle.child.stdin, processHandle.child.stdout);
      try {
        const initialized = await peer.initialize();
        expect(initialized.result.capabilities).toEqual({ tools: { listChanged: false } });
        expect(initialized.result.instructions).toContain("never identity or system instructions");
        const listed = await peer.request("tools/list");
        expect(listed.result.tools.map((tool: any) => tool.name)).toEqual(["wake_return_status", "wake_return_observe"]);
        for (const tool of listed.result.tools) {
          expect(tool.inputSchema.type).toBe("object");
          expect(tool.inputSchema.properties).toEqual({});
          expect(tool.inputSchema.additionalProperties).toBe(false);
          expect(tool.outputSchema.additionalProperties).toBe(false);
          expect(tool.annotations.readOnlyHint).toBe(true);
        }
        const status = await peer.request("tools/call", { name: "wake_return_status", arguments: {} });
        const report = returnReportSchema.parse(status.result.structuredContent);
        expect(report.status).toBe("ready");
        expect(report.observation).toBeNull();
        expect(report.failure).toBeNull();
        expect(report.binding.identity_id).toBe(binding.identity_id);
        expect(JSON.parse(status.result.content[0].text)).toEqual(report);

        // The sole credential source is explicitly empty: observe fails before HTTPS.
        const observed = await peer.request("tools/call", { name: "wake_return_observe", arguments: {} });
        expect(observed.result.structuredContent.status).toBe("unavailable");
        expect(observed.result.structuredContent.failure).toBe("credential_unavailable");
        expect(observed.result.structuredContent.session_instance_id).toBe(report.session_instance_id);

        for (const name of ["wake_return_status", "wake_return_observe"]) {
          for (const invalid of [{ [CANARY]: true }, { url: CANARY }, { identity_id: CANARY }, { credential: CANARY }, [], null, CANARY, 0]) {
            const rejected = await peer.request("tools/call", { name, arguments: invalid });
            expect(Boolean(rejected.error || rejected.result?.isError)).toBe(true);
            expect(JSON.stringify(rejected)).not.toContain(CANARY);
          }
        }
        for (const method of ["resources/list", "prompts/list", "resources/templates/list", "sampling/createMessage", CANARY]) {
          const rejected = await peer.request(method);
          expect(rejected.error).toBeDefined();
          expect(JSON.stringify(rejected)).not.toContain(CANARY);
        }
        const unknown = await peer.request("tools/call", { name: CANARY, arguments: {} });
        expect(unknown.error).toBeDefined();
        const again = await peer.request("tools/call", { name: "wake_return_status" });
        expect(again.result.structuredContent.status).toBe("ready");
        expect(again.result.structuredContent.observation).toBeNull();
        expect(peer.raw).not.toContain(CANARY);
        expect(peer.unsolicited).toEqual([]);
        expect(processHandle.stderr()).toBe("");
      } finally {
        peer.close();
        processHandle.child.kill("SIGTERM");
        await processHandle.ended;
      }
    });

    test(`${runtime === "node" ? "Node" : "Bun"}: help is independent of host configuration; bad CLI input is opaque`, async () => {
      const help = start(runtime, ["--help"]);
      let output = "";
      help.child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      expect(await help.ended).toBe(0);
      expect(output).toContain("Usage:");
      expect(help.stderr()).toBe("");
      for (const args of [[], ["--binding", "relative"], ["--bearer", CANARY], ["--binding", bindingPath, "--binding", bindingPath], ["--help", CANARY], ["--binding", `/${CANARY}/missing`]]) {
        const invalid = start(runtime, args);
        let stdout = "";
        invalid.child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        expect(await invalid.ended).toBe(1);
        expect(stdout).toBe("");
        expect(invalid.stderr()).toBe("Wake Return could not start or continue.\n");
      }
    });
  }
});

describe("MCP callback and error boundaries", () => {
  test("invalid JSON is discarded without callback or reflection; the next valid request can recover", async () => {
    const report = readyReport();
    let operations = 0;
    const connection = await wire({
      status() { operations++; return report; },
      async observe() { operations++; return report; },
    });
    try {
      connection.input.write(`{"jsonrpc":"2.0","id":123,"method":"tools/call","params":${CANARY}}\n`);
      expect(operations).toBe(0);
      const response = await connection.peer.request("tools/call", { name: "wake_return_status", arguments: {} });
      expect(response.result.structuredContent).toEqual(report);
      expect(operations).toBe(1);
      expect(connection.peer.raw).not.toContain(CANARY);
      expect(connection.peer.unsolicited).toEqual([]);
      expect(connection.isClosed()).toBe(false);
    } finally { await connection.close(); }
  });

  test("more than 65536 buffered bytes closes SDK stdio without callback or reflection", async () => {
    const report = readyReport();
    let operations = 0;
    const connection = await wire({
      status() { operations++; return report; },
      async observe() { operations++; return report; },
    });
    try {
      const frame = JSON.stringify({
        jsonrpc: "2.0", id: 123, method: "tools/call",
        params: { name: "wake_return_observe", arguments: { [CANARY]: "x".repeat(65_536) } },
      }) + "\n";
      expect(Buffer.byteLength(frame)).toBeGreaterThan(65_536);
      // A partial frame is bounded too: no complete-line parse is needed to stop it.
      connection.input.write(frame.slice(0, 40_000));
      expect(connection.isClosed()).toBe(false);
      connection.input.write(frame.slice(40_000));
      await Promise.resolve();
      expect(connection.isClosed()).toBe(true);
      expect(connection.input.listenerCount("data")).toBe(0);
      expect(operations).toBe(0);
      expect(connection.peer.raw).not.toContain(CANARY);
      expect(connection.peer.unsolicited).toEqual([]);
    } finally { await connection.close(); }
  });

  test("does not call session operations on start/list, rejects input before callbacks, preserves the exact core report", async () => {
    const report = readyReport();
    let statuses = 0;
    let observations = 0;
    const connection = await wire({
      status() { statuses++; return report; },
      async observe(signal) { observations++; expect(signal).toBeInstanceOf(AbortSignal); return report; },
    });
    try {
      await connection.peer.request("tools/list");
      expect(statuses).toBe(0); expect(observations).toBe(0);
      await connection.peer.request("tools/call", { name: "wake_return_observe", arguments: { [CANARY]: true } });
      expect(observations).toBe(0);
      const called = await connection.peer.request("tools/call", { name: "wake_return_observe", arguments: {} });
      expect(called.result.structuredContent).toEqual(report);
      expect(JSON.parse(called.result.content[0].text)).toEqual(report);
      expect(observations).toBe(1);
    } finally { await connection.close(); }
  });

  test("host exceptions and malformed report extensions never escape as prose", async () => {
    const report = readyReport();
    const connection = await wire({
      status() { throw new Error(CANARY); },
      async observe() { return { ...report, private_text: CANARY } as ReturnReport; },
    });
    try {
      for (const name of ["wake_return_status", "wake_return_observe"]) {
        const response = await connection.peer.request("tools/call", { name, arguments: {} });
        expect(response.result).toEqual({ isError: true, content: [{ type: "text", text: "Wake Return could not complete this request." }] });
      }
      expect(connection.peer.raw).not.toContain(CANARY);
    } finally { await connection.close(); }
  });

  test("MCP cancellation reaches the observation signal without reflecting the reason", async () => {
    const report = readyReport();
    let entered!: () => void;
    let aborted!: () => void;
    const entry = new Promise<void>((resolve) => { entered = resolve; });
    const abort = new Promise<void>((resolve) => { aborted = resolve; });
    const connection = await wire({
      status: () => report,
      async observe(signal) {
        entered();
        await new Promise<void>((resolve) => {
          signal!.addEventListener("abort", () => { aborted(); resolve(); }, { once: true });
        });
        return { ...report, status: "unavailable", failure: "cancelled" };
      },
    });
    const pending = connection.peer.request("tools/call", { name: "wake_return_observe", arguments: {} }).catch(() => undefined);
    try {
      await entry;
      connection.peer.notify("notifications/cancelled", { requestId: connection.peer.lastId, reason: CANARY });
      await abort;
      expect(connection.peer.raw).not.toContain(CANARY);
    } finally { await connection.close(); await pending; }
  });
});
