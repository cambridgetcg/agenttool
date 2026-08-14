import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCodexUsageMcpServer } from "../src/mcp.js";
import { CodexUsageReader } from "../src/reader.js";
import { usageSnapshotWithDeltaSchema } from "../src/schemas.js";
import { createUsageFixture } from "./fixture.js";

const roots: string[] = [];
const packageRoot = resolve(import.meta.dir, "..");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

class StdioHarness {
  private readonly child: ReturnType<typeof Bun.spawn>;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffered = "";
  private nextId = 1;

  constructor(databasePath: string, codexHome: string, threadId: string) {
    this.child = Bun.spawn([
      process.execPath,
      join(packageRoot, "bin", "agenttool-codex-usage.ts"),
      "mcp",
    ], {
      cwd: packageRoot,
      env: {
        AGENTOOL_CODEX_USAGE_DB: databasePath,
        CODEX_HOME: codexHome,
        CODEX_THREAD_ID: threadId,
        PATH: process.env.PATH ?? "",
        TMPDIR: tmpdir(),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.reader = this.child.stdout.getReader();
  }

  async initialize(): Promise<any> {
    const result = await this.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "agenttool-codex-usage-test", version: "0.1.0" },
    });
    await this.notify("notifications/initialized", {});
    return result;
  }

  async listTools(): Promise<any> {
    return await this.request("tools/list", {});
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return await this.request("tools/call", { name, arguments: args });
  }

  async close(): Promise<void> {
    this.child.kill();
    await this.child.exited;
  }

  private async request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    await this.write({ jsonrpc: "2.0", id, method, params });
    while (true) {
      const response = await this.read() as JsonRpcResponse;
      if (response.id !== id) continue;
      if (response.error) {
        throw new Error(`MCP ${method} failed (${response.error.code}): ${response.error.message}`);
      }
      return response.result;
    }
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.write({ jsonrpc: "2.0", method, params });
  }

  private async write(message: Record<string, unknown>): Promise<void> {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    await this.child.stdin.flush();
  }

  private async read(): Promise<unknown> {
    while (true) {
      const newline = this.buffered.indexOf("\n");
      if (newline >= 0) {
        const line = this.buffered.slice(0, newline);
        this.buffered = this.buffered.slice(newline + 1);
        if (line.trim()) return JSON.parse(line);
      }
      const next = await this.reader.read();
      if (next.done) throw new Error("MCP process ended before returning a response");
      this.buffered += this.decoder.decode(next.value, { stream: true });
    }
  }
}

describe("Codex usage MCP", () => {
  test("exposes only read-only usage tools and returns structured snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "agenttool-codex-usage-mcp-"));
    roots.push(root);
    const nowSeconds = 2_000_000_000;
    const { databasePath, sessionsRoot } = createUsageFixture(root, [{
      id: "019mcp00-0000-7000-8000-000000000000",
      tokens: 321,
      createdAt: nowSeconds - 10,
      updatedAt: nowSeconds - 1,
    }]);
    const reader = new CodexUsageReader({
      databasePath,
      rolloutRoots: [sessionsRoot],
      now: () => nowSeconds * 1000,
    });
    const server = buildCodexUsageMcpServer(reader);
    const registered = (server as any)._registeredTools as Record<
      string,
      { annotations?: Record<string, boolean>; handler?: Function; callback?: Function }
    >;
    expect(Object.keys(registered).sort()).toEqual([
        "codex_usage_doctor",
        "codex_usage_self",
        "codex_usage_session",
        "codex_usage_sessions",
        "codex_usage_snapshot",
    ]);
    for (const tool of Object.values(registered)) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect((tool as any).outputSchema).toBeDefined();
    }
    const snapshotTool = registered.codex_usage_snapshot!;
    const result = await (snapshotTool.handler ?? snapshotTool.callback)!({
      include_breakdown: false,
    }, {});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      schema: "agenttool.codex-token-usage/0.1",
      totals: { cumulative_tokens: 321 },
      delta_since_previous_sample: null,
    });
    expect(() => usageSnapshotWithDeltaSchema.parse(result.structuredContent)).not.toThrow();

    const writer = new Database(databasePath, { strict: true });
    writer.query("UPDATE threads SET tokens_used = 350").run();
    const advanced = await (snapshotTool.handler ?? snapshotTool.callback)!({
      include_breakdown: false,
    }, {});
    expect(advanced.structuredContent.delta_since_previous_sample).toMatchObject({
      comparison: "comparable",
      cumulative_tokens_delta: 29,
      session_deltas: [{ comparison: "advanced", cumulative_tokens_delta: 29 }],
    });

    const independentScope = await (snapshotTool.handler ?? snapshotTool.callback)!({
      active_window_seconds: 600,
      include_breakdown: false,
    }, {});
    expect(independentScope.structuredContent.delta_since_previous_sample).toBeNull();

    writer.query("UPDATE threads SET tokens_used = 3").run();
    writer.close();
    const reset = await (snapshotTool.handler ?? snapshotTool.callback)!({
      include_breakdown: false,
    }, {});
    expect(reset.structuredContent.delta_since_previous_sample).toMatchObject({
      comparison: "counter_reset_or_source_changed",
      cumulative_tokens_delta: null,
      session_deltas: [{ comparison: "counter_reset", cumulative_tokens_delta: null }],
    });
    await server.close();
  });

  test("completes a real stdio handshake without leaking fixture canaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "agenttool-codex-usage-stdio-"));
    roots.push(root);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const threadId = "019stdio-0000-7000-8000-000000000000";
    const { databasePath } = createUsageFixture(root, [{
      id: threadId,
      tokens: 654,
      createdAt: nowSeconds - 10,
      updatedAt: nowSeconds - 1,
    }]);
    const harness = new StdioHarness(databasePath, root, threadId);
    try {
      const initialized = await harness.initialize();
      expect(initialized.serverInfo).toEqual({
        name: "agenttool-codex-usage",
        version: "0.1.0",
      });
      const listed = await harness.listTools();
      expect(listed.tools).toHaveLength(5);
      for (const tool of listed.tools) {
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.outputSchema.additionalProperties).toBe(false);
      }
      const result = await harness.callTool("codex_usage_self", {
        include_breakdown: false,
      });
      expect(result.structuredContent.session).toMatchObject({
        is_self: true,
        cumulative_tokens: 654,
      });
      const encoded = JSON.stringify(result);
      expect(encoded).not.toContain("TOP SECRET THREAD TITLE");
      expect(encoded).not.toContain("/TOP/SECRET/CWD");
      expect(encoded).not.toContain(threadId);
      expect(encoded).not.toContain(root);
      const rejected = await harness.callTool("codex_usage_doctor", { extra: true });
      expect(rejected.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
