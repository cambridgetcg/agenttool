import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");

async function runCli(...args: string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = Bun.spawn({
    cmd: [process.execPath, "run", "src/cli.ts", ...args],
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("projector CLI discovery", () => {
  test("explains commands and boundaries without loading configuration", async () => {
    const result = await runCli("--help");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("<install|run-once|status>");
    expect(result.stdout).toContain("AGENTTOOL_YUTABASE_TARGET_URL");
    expect(result.stdout).toContain("refuses non-loopback endpoints");
    expect(result.stdout).toContain("does not grant permission");
  });

  test("rejects ambiguous extra arguments with a stable usage line", async () => {
    const result = await runCli("status", "extra");

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "usage: agenttool-correspondence-yutabase-projector <install|run-once|status>\n",
    );
  });
});
