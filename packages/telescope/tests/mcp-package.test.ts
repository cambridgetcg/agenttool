import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const bundlePath = join(packageRoot, "dist", "agenttool-telescope-mcp.js");

async function json(path: string): Promise<any> {
  return await Bun.file(join(packageRoot, path)).json();
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

class StdioMcpHarness {
  private readonly child: any;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffered = "";
  private nextId = 1;

  constructor(runtime: string) {
    this.child = Bun.spawn([runtime, bundlePath], {
      cwd: packageRoot,
      env: {
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
      clientInfo: {
        name: "agenttool-telescope-test",
        version: "0.2.0",
      },
    });
    await this.notify("notifications/initialized", {});
    return result;
  }

  async listTools(): Promise<any> {
    return await this.request("tools/list", {});
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    return await this.request("tools/call", {
      name,
      arguments: args,
    });
  }

  async close(): Promise<void> {
    this.child.kill();
    await this.child.exited;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<any> {
    const id = this.nextId++;
    await this.write({ jsonrpc: "2.0", id, method, params });
    while (true) {
      const response = (await this.read()) as unknown as JsonRpcResponse;
      if (response.id !== id) continue;
      if (response.error) {
        throw new Error(
          `MCP ${method} failed (${response.error.code}): ${response.error.message}`,
        );
      }
      return response.result;
    }
  }

  private async notify(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.write({ jsonrpc: "2.0", method, params });
  }

  private async write(message: Record<string, unknown>): Promise<void> {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    await this.child.stdin.flush();
  }

  private async read(): Promise<Record<string, unknown>> {
    while (true) {
      const newline = this.buffered.indexOf("\n");
      if (newline >= 0) {
        const line = this.buffered.slice(0, newline).trim();
        this.buffered = this.buffered.slice(newline + 1);
        if (line) return JSON.parse(line) as Record<string, unknown>;
        continue;
      }
      const next = await this.reader.read();
      if (next.done) {
        throw new Error("MCP stdio process closed before replying");
      }
      this.buffered += this.decoder.decode(next.value, { stream: true });
    }
  }
}

describe("cross-host Telescope package", () => {
  test("aligns package, plugin, and one bundled runtime", async () => {
    const packageManifest = await json("package.json");
    const codex = await json(".codex-plugin/plugin.json");
    const claude = await json(".claude-plugin/plugin.json");

    expect(packageManifest.version).toBe("0.2.0");
    expect(packageManifest.dependencies).toBeUndefined();
    expect(codex.version).toBe(packageManifest.version);
    expect(claude.version).toBe(packageManifest.version);
    expect(codex.name).toBe(claude.name);
    expect(codex.skills).toBe("./skills/");
    expect(codex.mcpServers["agenttool-telescope"]).toEqual({
      type: "stdio",
      command: "node",
      args: ["dist/agenttool-telescope-mcp.js"],
      cwd: ".",
    });
    expect(claude.mcpServers["agenttool-telescope"]).toEqual({
      command: "node",
      args: [
        "${CLAUDE_PLUGIN_ROOT}/dist/agenttool-telescope-mcp.js",
      ],
    });
  });

  test("ships plugins, skills, executable bundle, and complete notices", async () => {
    const packageManifest = await json("package.json");
    const files = packageManifest.files as string[];
    const thirdParty = await Bun.file(
      join(packageRoot, "THIRD_PARTY_LICENSES"),
    ).text();
    const bundle = await Bun.file(bundlePath).text();

    for (const entry of [
      ".codex-plugin",
      ".claude-plugin",
      "skills",
      "integrations",
      "dist",
      "THIRD_PARTY_LICENSES",
    ]) {
      expect(files).toContain(entry);
    }
    expect(packageManifest.bin["agenttool-telescope-mcp"]).toBe(
      "dist/agenttool-telescope-mcp.js",
    );
    expect(statSync(bundlePath).mode & 0o111).not.toBe(0);
    expect(thirdParty).toContain("@modelcontextprotocol/core 2.0.0-beta.5");
    expect(thirdParty).toContain("@modelcontextprotocol/server 2.0.0-beta.5");
    expect(thirdParty).toContain("zod 4.4.3");
    const bundledPackages = [
      ...new Set([
        ...bundle.matchAll(
          /node_modules\/(?:@[^/]+\/[^/]+|[^/]+)/g,
        ),
      ].map(([name]) => name)),
    ].sort();
    expect(bundledPackages).toEqual([
      "node_modules/@modelcontextprotocol/core",
      "node_modules/@modelcontextprotocol/server",
      "node_modules/zod",
    ]);
  });

  test("ships one portable skill and collision-free Hermes adapter", async () => {
    const skill = await Bun.file(
      join(packageRoot, "skills", "inspect-agent-surfaces", "SKILL.md"),
    ).text();
    const hermes = await Bun.file(
      join(
        packageRoot,
        "integrations",
        "hermes",
        "skills",
        "inspect-agent-surfaces-hermes",
        "SKILL.md",
      ),
    ).text();

    expect(skill).toContain("`telescope_scan`");
    expect(skill).toContain("publisher_assertion");
    expect(skill).toContain("intentionally omits arbitrary-path verifier tools");
    expect(skill).not.toContain("telescope_verify_artifact");
    expect(skill).not.toContain("telescope_verify_package");
    expect(hermes).toContain("server name `agenttool-telescope`");
    expect(hermes).toContain(
      "mcp_agenttool_telescope_telescope_scan",
    );
  });

  for (const runtime of [
    ["Node", Bun.which("node")],
    ["Bun", process.execPath],
  ] as const) {
    test(`handshakes, lists, and rejects unsafe input under ${runtime[0]}`, async () => {
      if (!runtime[1]) throw new Error(`${runtime[0]} runtime is unavailable`);
      const harness = new StdioMcpHarness(runtime[1]);
      try {
        const initialized = await harness.initialize();
        expect(initialized.serverInfo).toEqual({
          name: "agenttool-telescope",
          version: "0.2.0",
        });
        const listed = await harness.listTools();
        expect(listed.tools).toHaveLength(1);
        expect(listed.tools[0].name).toBe("telescope_scan");
        expect(listed.tools[0].inputSchema.additionalProperties).toBe(false);
        expect(listed.tools[0].outputSchema).toEqual(
          await json(
            "schema/agenttool-telescope-report-v0.1.schema.json",
          ),
        );

        const rejected = await harness.callTool("telescope_scan", {
          target: "http://localhost",
        });
        expect(rejected.isError).toBe(true);
        expect(JSON.parse(rejected.content[0].text).error.code).toBe(
          "https_required",
        );
      } finally {
        await harness.close();
      }
    });
  }
});
