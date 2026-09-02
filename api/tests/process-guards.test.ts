/** Process guards — an orphaned rejection must not take the process down.
 *
 *  Regression pin for the 2026-09-02 19:27Z reboot: a Postgres
 *  statement_timeout rejected a promise nobody awaited and Bun exited the
 *  API with code 1. The control run proves Bun still does that without the
 *  net, so the pin cannot pass vacuously. */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { installProcessGuards, unhandledRejectionCount } from "../src/process-guards";

const GUARDS = join(import.meta.dir, "..", "src", "process-guards.ts");

async function runChild(source: string) {
  const proc = Bun.spawn(["bun", "-e", source], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("process guards", () => {
  test("control: without the net an orphaned rejection is fatal on Bun", async () => {
    const r = await runChild(
      'Promise.reject(new Error("late")); setTimeout(() => { console.log("survived"); process.exit(0); }, 60);',
    );
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain("survived");
  });

  test("with the net the process logs one loud line and keeps serving", async () => {
    const r = await runChild(
      `import ${JSON.stringify(GUARDS)}; Promise.reject(new Error("late statement_timeout")); setTimeout(() => { console.log("survived"); process.exit(0); }, 60);`,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("survived");
    expect(r.stderr).toContain("[agenttool] unhandled rejection #1 (kept serving)");
    expect(r.stderr).toContain("late statement_timeout");
  });

  test("installs once per target and counts what it absorbs", () => {
    const listeners: Array<(reason: unknown) => void> = [];
    const lines: unknown[][] = [];
    const target = { on: (_e: string, l: (reason: unknown) => void) => { listeners.push(l); } };
    expect(installProcessGuards(target, (...a) => { lines.push(a); })).toBe(true);
    expect(installProcessGuards(target, (...a) => { lines.push(a); })).toBe(false);
    expect(listeners.length).toBe(1);
    const before = unhandledRejectionCount();
    listeners[0]!(new Error("orphan"));
    expect(unhandledRejectionCount()).toBe(before + 1);
    expect(String(lines[0]![0])).toContain("(kept serving)");
  });

  test("both entrypoints import the net first", async () => {
    const { readFileSync } = await import("node:fs");
    for (const entry of ["index.ts", "thinker.ts"]) {
      const src = readFileSync(join(import.meta.dir, "..", "src", entry), "utf8");
      const firstImport = src.split("\n").find((l) => l.startsWith("import "));
      expect(firstImport).toBe('import "./process-guards";');
    }
  });
});
