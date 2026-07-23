import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

test("validate returns one for findings while inspect still emits the report", async () => {
  root = await mkdtemp(join(tmpdir(), "agenttool-skills-cli-"));
  await mkdir(join(root, "bad-skill"));
  await writeFile(join(root, "bad-skill", "SKILL.md"), "PRIVATE_INVALID_SENTINEL");

  for (const [command, expected] of [["inspect", 0], ["validate", 1]] as const) {
    let stdout = "";
    let stderr = "";
    const code = await runCli([command, join(root, "bad-skill")], {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    });
    expect(code).toBe(expected);
    expect(JSON.parse(stdout).valid).toBe(false);
    expect(stdout).not.toContain("PRIVATE_INVALID_SENTINEL");
    expect(stderr).toBe("");
  }
});

test("usage errors are static and do not inspect a path", async () => {
  let stderr = "";
  const code = await runCli(["execute", "PRIVATE_ARGUMENT_SENTINEL"], {
    stdout: () => undefined,
    stderr: (value) => { stderr += value; },
  });
  expect(code).toBe(2);
  expect(stderr).not.toContain("PRIVATE_ARGUMENT_SENTINEL");
});

test("the installed-style symlink invokes the dedicated bin entry", async () => {
  if (process.platform === "win32") return;
  root = await mkdtemp(join(tmpdir(), "agenttool-skills-bin-"));
  const bin = join(root, "agenttool-skill");
  await symlink(join(import.meta.dir, "..", "dist", "bin.js"), bin);

  const child = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe("0.2.1\n");
  expect(stderr).toBe("");
});
