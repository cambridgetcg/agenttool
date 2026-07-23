import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectLocalSkills, stableStringify, type InspectionReport } from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "agenttool-skills-test-"));
  temporaryRoots.push(path);
  return path;
}

async function writeSkill(root: string, name: string, source: string): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), source);
  return directory;
}

function json(report: InspectionReport): string {
  return stableStringify(report);
}

describe("inspectLocalSkills", () => {
  test("inspects a standard local skill without exposing instructions or metadata values", async () => {
    const root = await temporaryRoot();
    const skill = await writeSkill(root, "safe-skill", `---
name: safe-skill
description: PRIVATE_DESCRIPTION_SENTINEL
allowed-tools: Read Bash(git status)
unknown-field:
  nested: PRIVATE_UNKNOWN_SENTINEL
requirements:
  mcpServers: [agenttool-collab]
  runtimes: [bun]
  credentials:
    OPENAI_API_KEY: "\${OPENAI_API_KEY}"
    FALLBACK_KEY: "\${FALLBACK_KEY:-PRIVATE_FALLBACK_SENTINEL}"
metadata:
  agenttool:
    requirements:
      credentials:
        - name: ARRAY_KEY
          value: PRIVATE_ARRAY_LITERAL_SENTINEL
---
# PRIVATE_BODY_SENTINEL

Read [the reference](references/guide.md).
`);
    await mkdir(join(skill, "scripts"));
    await mkdir(join(skill, "references"));
    await writeFile(join(skill, "scripts", "check.sh"), "#!/bin/sh\nexit 0\n");
    await writeFile(join(skill, "references", "guide.md"), "PRIVATE_REFERENCE_SENTINEL\n");

    const report = await inspectLocalSkills(skill);
    const serialized = json(report);

    expect(report.valid).toBe(true);
    expect(report.scope.root).toBe(".");
    expect(report.skills[0]?.name).toBe("safe-skill");
    expect(report.skills[0]?.scripts).toEqual(["scripts/check.sh"]);
    expect(report.skills[0]?.resources).toEqual(["references/guide.md"]);
    expect(report.skills[0]?.requirements.tools.map((item) => item.name)).toEqual(["Bash", "Read"]);
    expect(report.skills[0]?.requirements.credentials).toEqual([
      { name: "ARRAY_KEY", source: "SKILL.md", literalDeclared: true },
      { name: "FALLBACK_KEY", source: "SKILL.md", literalDeclared: true },
      { name: "OPENAI_API_KEY", source: "SKILL.md", literalDeclared: false },
    ]);
    expect(report.skills[0]?.metadataShape["unknown-field"]).toEqual({
      type: "object",
      fields: { nested: { type: "string" } },
    });
    for (const sentinel of [
      "PRIVATE_DESCRIPTION_SENTINEL",
      "PRIVATE_UNKNOWN_SENTINEL",
      "PRIVATE_FALLBACK_SENTINEL",
      "PRIVATE_ARRAY_LITERAL_SENTINEL",
      "PRIVATE_BODY_SENTINEL",
      "PRIVATE_REFERENCE_SENTINEL",
    ]) expect(serialized).not.toContain(sentinel);
  });

  test("produces a checkout-, mtime-, and mode-independent digest", async () => {
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    const source = "---\nname: same-skill\ndescription: same\n---\n# Same\n";
    const first = await writeSkill(firstRoot, "same-skill", source);
    const second = await writeSkill(secondRoot, "same-skill", source);
    await mkdir(join(first, "scripts"));
    await mkdir(join(second, "scripts"));
    await writeFile(join(first, "scripts", "run.sh"), "exit 0\n");
    await writeFile(join(second, "scripts", "run.sh"), "exit 0\n");
    await chmod(join(first, "scripts", "run.sh"), 0o755);
    await chmod(join(second, "scripts", "run.sh"), 0o600);

    const firstReport = await inspectLocalSkills(first);
    const secondReport = await inspectLocalSkills(second);
    expect(firstReport.skills[0]?.digest).toBe(secondReport.skills[0]?.digest);

    await writeFile(join(second, "scripts", "run.sh"), "exit 1\n");
    const changedReport = await inspectLocalSkills(second);
    expect(changedReport.skills[0]?.digest).not.toBe(firstReport.skills[0]?.digest);
  });

  test("never follows symlinks and reports an escape without leaking target contents", async () => {
    const root = await temporaryRoot();
    const skill = await writeSkill(root, "linked-skill", "---\nname: linked-skill\ndescription: linked\n---\n# Linked\n");
    const outside = join(root, "PRIVATE_TARGET_NAME.txt");
    await writeFile(outside, "PRIVATE_SYMLINK_CONTENT_SENTINEL\n");
    await symlink(outside, join(skill, "references"));

    const report = await inspectLocalSkills(skill);
    const serialized = json(report);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === "SYMLINK_ESCAPE")).toBe(true);
    expect(report.skills[0]?.digest).toBeNull();
    expect(serialized).not.toContain("PRIVATE_SYMLINK_CONTENT_SENTINEL");
    expect(serialized).not.toContain(outside);
  });

  test("rejects body and metadata path traversal without echoing the declared path", async () => {
    const root = await temporaryRoot();
    const skill = await writeSkill(root, "escape-skill", `---
name: escape-skill
description: escape
scripts: ../../PRIVATE_METADATA_ESCAPE
---
[outside](../PRIVATE_BODY_ESCAPE)
`);
    const report = await inspectLocalSkills(skill);
    const serialized = json(report);
    expect(report.issues.map((issue) => issue.code)).toContain("RESOURCE_PATH_ESCAPE");
    expect(report.issues.map((issue) => issue.code)).toContain("METADATA_PATH_ESCAPE");
    expect(serialized).not.toContain("PRIVATE_METADATA_ESCAPE");
    expect(serialized).not.toContain("PRIVATE_BODY_ESCAPE");
  });

  test("rejects Windows path forms independently of the inspection host", async () => {
    const root = await temporaryRoot();
    const skill = await writeSkill(root, "windows-escape", `---
name: windows-escape
description: escape
scripts: 'C:\\PRIVATE_WINDOWS_METADATA'
---
[outside](..\\PRIVATE_WINDOWS_BODY)
`);
    const report = await inspectLocalSkills(skill);
    const serialized = json(report);
    expect(report.issues.map((issue) => issue.code)).toContain("RESOURCE_PATH_ESCAPE");
    expect(report.issues.map((issue) => issue.code)).toContain("METADATA_PATH_ESCAPE");
    expect(serialized).not.toContain("PRIVATE_WINDOWS_METADATA");
    expect(serialized).not.toContain("PRIVATE_WINDOWS_BODY");
  });

  test("covers dist content and blocks a digest when a skill subtree is excluded", async () => {
    const root = await temporaryRoot();
    const covered = await writeSkill(root, "covered-skill",
      "---\nname: covered-skill\ndescription: safe\n---\n# Safe\n");
    await mkdir(join(covered, "dist"));
    await writeFile(join(covered, "dist", "payload.js"), "first\n");
    const first = await inspectLocalSkills(covered);
    expect(first.valid).toBe(true);
    expect(first.skills[0]?.files.map((file) => file.path)).toContain("dist/payload.js");
    await writeFile(join(covered, "dist", "payload.js"), "second\n");
    const second = await inspectLocalSkills(covered);
    expect(second.skills[0]?.digest).not.toBe(first.skills[0]?.digest);

    const incomplete = await writeSkill(root, "incomplete-skill",
      "---\nname: incomplete-skill\ndescription: safe\n---\n# Safe\n");
    await mkdir(join(incomplete, "node_modules"));
    await writeFile(join(incomplete, "node_modules", "PRIVATE_SKIPPED_SENTINEL.js"), "hidden\n");
    const incompleteReport = await inspectLocalSkills(incomplete);
    expect(incompleteReport.valid).toBe(false);
    expect(incompleteReport.skills[0]?.digest).toBeNull();
    expect(incompleteReport.issues.map((issue) => issue.code)).toContain("SKILL_SUBTREE_NOT_INSPECTED");
    expect(json(incompleteReport)).not.toContain("PRIVATE_SKIPPED_SENTINEL");
    expect(incompleteReport).not.toHaveProperty("installPlan");
  });

  test("redacts credential-like values from every reported identifier channel", async () => {
    const root = await temporaryRoot();
    const secretName = "sk-proj-abcdefghijklmnop1234";
    const secretFile = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234";
    const skill = await writeSkill(root, secretName, `---
name: ${secretName}
description: safe
requirements:
  tools: [${secretFile}]
  credentials: [${secretFile}]
---
# Safe
`);
    await mkdir(join(skill, "references"));
    await writeFile(join(skill, "references", `${secretFile}.txt`), "safe\n");
    const report = await inspectLocalSkills(skill);
    const serialized = json(report);
    expect(serialized).not.toContain(secretName);
    expect(serialized).not.toContain(secretFile);
    expect(report.summary.redactions).toBeGreaterThanOrEqual(2);
    expect(report.issues.map((issue) => issue.code)).toContain("OUTPUT_REDACTED");
    expect(json(await inspectLocalSkills(skill))).toBe(serialized);
  });

  test("rejects duplicate names and overlapping nested skill roots", async () => {
    const root = await temporaryRoot();
    await writeSkill(join(root, "one"), "same-name",
      "---\nname: same-name\ndescription: safe\n---\n# Safe\n");
    await writeSkill(join(root, "two"), "same-name",
      "---\nname: same-name\ndescription: safe\n---\n# Safe\n");
    const parent = await writeSkill(root, "parent",
      "---\nname: parent\ndescription: safe\n---\n# Safe\n");
    await writeSkill(parent, "child",
      "---\nname: child\ndescription: safe\n---\n# Safe\n");
    const report = await inspectLocalSkills(root);
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("DUPLICATE_SKILL_NAME");
    expect(report.issues.map((issue) => issue.code)).toContain("NESTED_SKILL_ROOT");
  });

  test("rejects prototype-sensitive and deeply nested metadata", async () => {
    const root = await temporaryRoot();
    const dangerous = await writeSkill(root, "dangerous-skill", `---
name: dangerous-skill
description: safe
constructor: PRIVATE_CONSTRUCTOR_SENTINEL
---
# Safe
`);
    const dangerousReport = await inspectLocalSkills(dangerous);
    expect(dangerousReport.issues.map((issue) => issue.code)).toContain("DANGEROUS_METADATA_KEY");
    expect(json(dangerousReport)).not.toContain("PRIVATE_CONSTRUCTOR_SENTINEL");

    const nestedLines = Array.from({ length: 40 }, (_, index) => `${"  ".repeat(index)}level${index}:`).join("\n");
    const nested = await writeSkill(root, "nested-skill", `---
name: nested-skill
description: safe
tree:
${nestedLines}
${"  ".repeat(40)}leaf: PRIVATE_DEEP_SENTINEL
---
# Safe
`);
    const nestedReport = await inspectLocalSkills(nested);
    expect(nestedReport.issues.map((issue) => issue.code)).toContain("METADATA_COMPLEXITY_EXCEEDED");
    expect(json(nestedReport)).not.toContain("PRIVATE_DEEP_SENTINEL");
  });
});
