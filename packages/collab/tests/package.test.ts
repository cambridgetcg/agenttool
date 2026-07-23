import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");

async function json(path: string): Promise<any> {
  return await Bun.file(join(packageRoot, path)).json();
}

describe("cross-host package", () => {
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

  test("ships the plugins, skills, executable bundle, and notices", async () => {
    const packageManifest = await json("package.json");
    const files = packageManifest.files as string[];

    expect(files).toContain(".codex-plugin");
    expect(files).toContain(".claude-plugin");
    expect(files).toContain("skills");
    expect(files).toContain("integrations");
    expect(files).toContain("dist");
    expect(files).toContain("THIRD_PARTY_LICENSES");
    expect(packageManifest.bin["agenttool-collab-mcp"]).toBe("./dist/agenttool-collab-mcp.js");
    expect(statSync(join(packageRoot, "dist", "agenttool-collab-mcp.js")).mode & 0o111).not.toBe(0);
  });

  test("ships an explicit Hermes adapter without overstating its authority", async () => {
    const skill = await Bun.file(join(
      packageRoot,
      "integrations",
      "hermes",
      "skills",
      "coordinate-agent-work-hermes",
      "SKILL.md",
    )).text();

    expect(skill).toContain("mcp_agenttool_collab_workspace_open");
    expect(skill).toContain("mcp_agenttool_collab_session_join");
    expect(skill).toContain("mcp_agenttool_collab_session_heartbeat");
    expect(skill).toContain("mcp_agenttool_collab_task_claim");
    expect(skill).toContain("mcp_agenttool_collab_handoff_offer");
    expect(skill).toContain("heartbeat never renews a task");
    expect(skill).toContain("do not authenticate");
    expect(skill).toContain("does not lock files");
    expect(skill).not.toContain("mcp_agenttool_collab_session_token");
  });
});
