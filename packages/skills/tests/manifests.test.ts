import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectLocalSkills, stableStringify } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

test("inspects package and plugin declarations while redacting MCP env values", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenttool-skills-plugin-"));
  roots.push(root);
  await mkdir(join(root, "skills", "plugin-skill"), { recursive: true });
  await mkdir(join(root, ".codex-plugin"));
  await mkdir(join(root, ".claude-plugin"));
  await writeFile(join(root, "skills", "plugin-skill", "SKILL.md"),
    "---\nname: plugin-skill\ndescription: safe\n---\n# Safe\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@example/plugin",
    version: "1.2.3",
    engines: { node: ">=20", bun: ">=1.3" },
  }));
  const manifest = {
    name: "example-plugin",
    version: "1.2.3",
    skills: "./skills/",
    mcpServers: {
      local: {
        command: "PRIVATE_COMMAND_SENTINEL",
        args: ["PRIVATE_ARG_SENTINEL"],
        env: {
          SAFE_TOKEN: "${SAFE_TOKEN}",
          LITERAL_KEY: "PRIVATE_ENV_SENTINEL",
          DEFAULT_KEY: "${DEFAULT_KEY:-PRIVATE_DEFAULT_SENTINEL}",
        },
      },
    },
  };
  await writeFile(join(root, ".codex-plugin", "plugin.json"), JSON.stringify(manifest));
  await writeFile(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "example-plugin",
    version: "1.2.3",
  }));

  const report = await inspectLocalSkills(root);
  const serialized = stableStringify(report);
  expect(report.valid).toBe(true);
  expect(report.scope.inputKind).toBe("plugin");
  expect(report.package?.runtimes.map((runtime) => runtime.name)).toEqual(["bun", "node"]);
  expect(report.manifests.find((item) => item.kind === "codex")?.declaredSkillPaths).toEqual(["skills"]);
  expect(report.manifests.find((item) => item.kind === "codex")?.mcpServers[0]?.credentialBindings).toEqual([
    { name: "DEFAULT_KEY", source: ".codex-plugin/plugin.json#mcpServers.local.env", literalDeclared: true },
    { name: "LITERAL_KEY", source: ".codex-plugin/plugin.json#mcpServers.local.env", literalDeclared: true },
    { name: "SAFE_TOKEN", source: ".codex-plugin/plugin.json#mcpServers.local.env", literalDeclared: false },
  ]);
  for (const sentinel of [
    "PRIVATE_COMMAND_SENTINEL",
    "PRIVATE_ARG_SENTINEL",
    "PRIVATE_ENV_SENTINEL",
    "PRIVATE_DEFAULT_SENTINEL",
  ]) expect(serialized).not.toContain(sentinel);
});

test("rejects manifest traversal without echoing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenttool-skills-plugin-"));
  roots.push(root);
  await mkdir(join(root, ".codex-plugin"));
  await writeFile(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "example-plugin",
    version: "1.0.0",
    skills: "../PRIVATE_MANIFEST_ESCAPE",
  }));
  const report = await inspectLocalSkills(root);
  expect(report.issues.map((issue) => issue.code)).toContain("MANIFEST_PATH_TRAVERSAL");
  expect(stableStringify(report)).not.toContain("PRIVATE_MANIFEST_ESCAPE");
});

test("rejects Windows manifest paths and duplicate JSON keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenttool-skills-plugin-"));
  roots.push(root);
  await mkdir(join(root, ".codex-plugin"));
  await writeFile(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "example-plugin",
    version: "1.0.0",
    skills: "C:\\PRIVATE_WINDOWS_MANIFEST",
  }));
  const windowsPath = await inspectLocalSkills(root);
  expect(windowsPath.issues.map((issue) => issue.code)).toContain("MANIFEST_PATH_TRAVERSAL");
  expect(stableStringify(windowsPath)).not.toContain("PRIVATE_WINDOWS_MANIFEST");

  await writeFile(join(root, ".codex-plugin", "plugin.json"),
    '{"name":"first","name":"PRIVATE_DUPLICATE_SENTINEL","version":"1.0.0"}');
  const duplicate = await inspectLocalSkills(root);
  expect(duplicate.issues.map((issue) => issue.code)).toContain("PLUGIN_MANIFEST_INVALID");
  expect(stableStringify(duplicate)).not.toContain("PRIVATE_DUPLICATE_SENTINEL");
});

test("preserves and exactly checks manifest declarations that point to SKILL.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenttool-skills-plugin-"));
  roots.push(root);
  await mkdir(join(root, ".codex-plugin"));
  await mkdir(join(root, "skills", "file-skill"), { recursive: true });
  await writeFile(join(root, "skills", "file-skill", "SKILL.md"),
    "---\nname: file-skill\ndescription: safe\n---\n# Safe\n");
  await writeFile(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "example-plugin",
    version: "1.0.0",
    skills: "skills/file-skill/SKILL.md",
  }));
  const report = await inspectLocalSkills(root);
  expect(report.valid).toBe(true);
  expect(report.manifests[0]?.declaredSkillPaths).toEqual(["skills/file-skill/SKILL.md"]);

  await writeFile(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "example-plugin",
    version: "1.0.0",
    skills: "skills/SKILL.md",
  }));
  const missingExactFile = await inspectLocalSkills(root);
  expect(missingExactFile.valid).toBe(false);
  expect(missingExactFile.issues.map((issue) => issue.code)).toContain("DECLARED_SKILL_PATH_EMPTY");
});

test("accepts AgentTool Collab as a read-only integration fixture", async () => {
  const collab = join(import.meta.dir, "..", "..", "collab");
  const report = await inspectLocalSkills(collab);
  expect(report.valid).toBe(true);
  expect(report.skills.map((skill) => skill.name).sort()).toEqual([
    "coordinate-agent-work",
    "coordinate-agent-work-hermes",
  ]);
  expect(report.manifests.map((manifest) => manifest.kind)).toEqual(["claude", "codex"]);
});
