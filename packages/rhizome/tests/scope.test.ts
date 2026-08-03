/** Scope resolution: two derivations, a union, and a reported difference. */

import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileIgnoreFile, isIgnored } from "../src/gitignore.js";
import { deriveFromFilesystem, deriveFromGit, findRepoRoot, resolveScope } from "../src/scope.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agenttool-rhizome-"));
  roots.push(root);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "t"], { cwd: root });
  return root;
}

test("gitignore rules are read from the tree, including nested files and negations", () => {
  const rules = [
    ...compileIgnoreFile("", "node_modules/\ndist/\n!packages/keep/dist/\npackages/keep/dist/*\n!packages/keep/dist/ship.js\n"),
    ...compileIgnoreFile("api", "*.local\n"),
  ];
  expect(isIgnored("node_modules", true, rules)).not.toBeNull();
  expect(isIgnored("packages/a/node_modules", true, rules)).not.toBeNull();
  expect(isIgnored("packages/keep/dist", true, rules)).toBeNull();
  expect(isIgnored("packages/keep/dist/other.js", false, rules)).not.toBeNull();
  expect(isIgnored("packages/keep/dist/ship.js", false, rules)).toBeNull();
  expect(isIgnored("api/thing.local", false, rules)).not.toBeNull();
  expect(isIgnored("other/thing.local", false, rules)).toBeNull();
});

test("the corpus is the union of the derivations, not the intersection", async () => {
  const root = await repository();
  await writeFile(join(root, ".gitignore"), "ignored/\n");
  await writeFile(join(root, "tracked.ts"), "1;\n");
  await writeFile(join(root, "untracked.ts"), "1;\n");
  await mkdir(join(root, "ignored"));
  await writeFile(join(root, "ignored", "hidden.ts"), "1;\n");
  spawnSync("git", ["add", "tracked.ts", ".gitignore"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "one"], { cwd: root });

  const git = deriveFromGit(root);
  const walk = deriveFromFilesystem(root);
  expect(git.files).toEqual([".gitignore", "tracked.ts"]);
  expect(walk.files).toEqual([".gitignore", "tracked.ts", "untracked.ts"]);

  const scope = resolveScope(root);
  expect(scope.files).toContain("untracked.ts");
  expect(scope.files).not.toContain("ignored/hidden.ts");
  expect(scope.disagreements.map((item) => item.file)).toEqual(["untracked.ts"]);
  expect(scope.disagreements[0]?.absentFrom).toEqual(["git-tracked"]);
});

test("a tracked symlink is explained as a symlink, not as a matcher error", async () => {
  const root = await repository();
  await mkdir(join(root, "real"));
  await writeFile(join(root, "real", "doc.md"), "hello\n");
  await symlink(join(root, "real"), join(root, "mirror"));
  spawnSync("git", ["add", "-A"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "one"], { cwd: root });

  const scope = resolveScope(root);
  const disagreement = scope.disagreements.find((item) => item.file === "mirror");
  expect(disagreement?.reading).toContain("symlink");
  expect(disagreement?.reading).not.toContain("rhizome's own");
});

test("a force-added file is explained by the rule that should have excluded it", async () => {
  const root = await repository();
  await writeFile(join(root, ".gitignore"), "dist/\n");
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "bundle.js"), "1;\n");
  spawnSync("git", ["add", "-f", "dist/bundle.js", ".gitignore"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "one"], { cwd: root });

  const scope = resolveScope(root);
  const disagreement = scope.disagreements.find((item) => item.file === "dist/bundle.js");
  expect(disagreement?.reading).toContain("tracked despite matching an ignore rule");
});

test("file reads are cached, marker sweeps use the derived corpus, and unread files are published", async () => {
  const root = await repository();
  await writeFile(join(root, "a.ts"), "// @marker one\n");
  await writeFile(join(root, "b.ts"), "nothing\n");
  await writeFile(join(root, "c.bin"), Buffer.from([0x01, 0x00, 0x02]));

  const scope = resolveScope(root);
  expect(scope.filesContaining("@marker")).toEqual(["a.ts"]);
  expect(scope.lines("a.ts")[0]).toBe("// @marker one");
  expect(scope.read("c.bin")).toBeNull();
  expect(scope.unread).toContain("c.bin");
});

test("the repository root is found by walking up for .git", () => {
  expect(findRepoRoot(import.meta.dir)).toBe(resolveScope().root);
});
