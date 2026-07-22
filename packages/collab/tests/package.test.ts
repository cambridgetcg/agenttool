import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");

async function json(path: string): Promise<any> {
  return await Bun.file(join(packageRoot, path)).json();
}

describe("dual-host package", () => {
  test("points Codex and Claude at one bundled MCP runtime", async () => {
    const packageManifest = await json("package.json");
    const codex = await json(".codex-plugin/plugin.json");
    const claude = await json(".claude-plugin/plugin.json");

    expect(codex.version).toBe(packageManifest.version);
    expect(claude.version).toBe(packageManifest.version);
    expect(codex.skills).toBe("./skills/");
    expect(codex.mcpServers["agenttool-collab"]).toEqual({
      type: "stdio",
      command: "bun",
      args: ["dist/agenttool-collab-mcp.js"],
      cwd: ".",
    });
    expect(claude.mcpServers["agenttool-collab"]).toEqual({
      command: "bun",
      args: ["${CLAUDE_PLUGIN_ROOT}/dist/agenttool-collab-mcp.js"],
    });
  });

  test("ships the plugin, shared skill, executable bundle, and notices", async () => {
    const packageManifest = await json("package.json");
    const files = packageManifest.files as string[];

    expect(files).toContain(".codex-plugin");
    expect(files).toContain(".claude-plugin");
    expect(files).toContain("skills");
    expect(files).toContain("dist");
    expect(files).toContain("THIRD_PARTY_LICENSES");
    expect(packageManifest.bin["agenttool-collab-mcp"]).toBe("./dist/agenttool-collab-mcp.js");
    expect(statSync(join(packageRoot, "dist", "agenttool-collab-mcp.js")).mode & 0o111).not.toBe(0);
  });
});
