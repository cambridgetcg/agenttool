import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { AgentBrowser } from "../src/browser.js";
import { resolveBrowserCapabilities } from "../src/capabilities.js";
import { serveBrowserMcpStdio } from "../src/mcp.js";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-06-18";
const PROTOCOL_VERSION_META_KEY =
  "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_META_KEY =
  "io.modelcontextprotocol/clientCapabilities";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function fakeBrowser() {
  let capabilityReads = 0;
  let closeCalls = 0;
  const browser = {
    capabilities() {
      capabilityReads += 1;
      return resolveBrowserCapabilities({ authority: "public" });
    },
    async close() {
      closeCalls += 1;
    },
  } as unknown as AgentBrowser;

  return {
    browser,
    get capabilityReads() {
      return capabilityReads;
    },
    get closeCalls() {
      return closeCalls;
    },
  };
}

function modernParams(params: Record<string, unknown> = {}) {
  return {
    ...params,
    _meta: {
      [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
      [CLIENT_CAPABILITIES_META_KEY]: {},
    },
  };
}

function openStdio(browser: AgentBrowser) {
  const input = new PassThrough();
  const output = new PassThrough();
  const pending: JsonRpcResponse[] = [];
  const waiters: Array<(message: JsonRpcResponse) => void> = [];
  let buffer = "";

  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as JsonRpcResponse;
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else pending.push(message);
    }
  });

  const errors: Error[] = [];
  const handle = serveBrowserMcpStdio(browser, {
    transport: new StdioServerTransport(input, output),
    onerror(error) {
      errors.push(error);
    },
  });

  return {
    errors,
    send(message: Record<string, unknown>) {
      input.write(`${JSON.stringify(message)}\n`);
    },
    async receive(): Promise<JsonRpcResponse> {
      const queued = pending.shift();
      if (queued) return queued;
      return await new Promise<JsonRpcResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.indexOf(onMessage);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("timed out waiting for MCP stdio response"));
        }, 2_000);
        const onMessage = (message: JsonRpcResponse) => {
          clearTimeout(timeout);
          resolve(message);
        };
        waiters.push(onMessage);
      });
    },
    async close() {
      await handle.close();
      input.destroy();
      output.destroy();
    },
  };
}

describe("browser MCP stdio negotiation", () => {
  test("serves modern discovery and tools with exact per-request claims", async () => {
    const fake = fakeBrowser();
    const stdio = openStdio(fake.browser);
    try {
      stdio.send({
        jsonrpc: "2.0",
        id: 1,
        method: "server/discover",
        params: modernParams(),
      });
      const discovery = await stdio.receive();

      expect(discovery.error).toBeUndefined();
      expect(discovery.result?.supportedVersions).toContain(
        MODERN_PROTOCOL_VERSION,
      );

      stdio.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: modernParams(),
      });
      const tools = await stdio.receive();

      expect(tools.error).toBeUndefined();
      expect(
        (tools.result?.tools as Array<{ name: string }>).map(
          (tool) => tool.name,
        ),
      ).toContain("browser_capabilities");
      expect(fake.capabilityReads).toBe(1);
      expect(stdio.errors).toEqual([]);
    } finally {
      await stdio.close();
    }
    expect(fake.closeCalls).toBe(0);
  });

  test("serves the legacy initialize and tools/list exchange", async () => {
    const fake = fakeBrowser();
    const stdio = openStdio(fake.browser);
    try {
      stdio.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LEGACY_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "agenttool-browser-legacy-test",
            version: "1.0.0",
          },
        },
      });
      const initialized = await stdio.receive();

      expect(initialized.error).toBeUndefined();
      expect(initialized.result?.protocolVersion).toBe(
        LEGACY_PROTOCOL_VERSION,
      );

      stdio.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      });
      stdio.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });
      const tools = await stdio.receive();

      expect(tools.error).toBeUndefined();
      expect(
        (tools.result?.tools as Array<{ name: string }>).map(
          (tool) => tool.name,
        ),
      ).toContain("browser_capabilities");
      expect(fake.capabilityReads).toBe(1);
      expect(stdio.errors).toEqual([]);
    } finally {
      await stdio.close();
    }
    expect(fake.closeCalls).toBe(0);
  });

  test("rejects a malformed modern claim without creating a server", async () => {
    const fake = fakeBrowser();
    const stdio = openStdio(fake.browser);
    try {
      stdio.send({
        jsonrpc: "2.0",
        id: 1,
        method: "server/discover",
        params: {
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
          },
        },
      });
      const rejection = await stdio.receive();

      expect(rejection.result).toBeUndefined();
      expect(rejection.error).toMatchObject({
        code: -32602,
      });
      expect(rejection.error?.message).toContain("Invalid _meta envelope");
      expect(fake.capabilityReads).toBe(0);
    } finally {
      await stdio.close();
    }
    expect(fake.closeCalls).toBe(0);
  });

  test("rebuilds a fresh legacy server after an unpinned modern probe", async () => {
    const fake = fakeBrowser();
    const stdio = openStdio(fake.browser);
    try {
      stdio.send({
        jsonrpc: "2.0",
        id: 1,
        method: "server/discover",
        params: modernParams(),
      });
      expect((await stdio.receive()).error).toBeUndefined();

      stdio.send({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: LEGACY_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "agenttool-browser-era-switch-test",
            version: "1.0.0",
          },
        },
      });
      const initialized = await stdio.receive();

      expect(initialized.error).toBeUndefined();
      expect(initialized.result?.protocolVersion).toBe(
        LEGACY_PROTOCOL_VERSION,
      );
      expect(fake.capabilityReads).toBe(2);
    } finally {
      await stdio.close();
    }
    expect(fake.closeCalls).toBe(0);
  });
});
