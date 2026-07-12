import { describe, expect, test } from "bun:test";
import { join } from "node:path";

interface ParityResult {
  module: string;
  pyMethods: string[];
  tsMethods: string[];
  pyOnly: string[];
  tsOnly: string[];
}

describe("SDK parity checker", () => {
  test("counts async generators and nested data.sync methods", () => {
    const sdkRoot = join(import.meta.dir, "..");
    const result = Bun.spawnSync({
      cmd: ["bun", "run", "scripts/check-parity.ts", "--json"],
      cwd: sdkRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as ParityResult[];
    const wake = report.find((entry) => entry.module === "wake");
    const inbox = report.find((entry) => entry.module === "inbox");
    const dataSync = report.find((entry) => entry.module === "data.sync");

    expect(wake).toBeDefined();
    expect(wake?.pyMethods).toContain("voice");
    expect(wake?.tsMethods).toContain("voice");
    expect(wake?.pyOnly).toEqual([]);
    expect(inbox?.tsMethods).toContain("voice");
    expect(inbox?.tsMethods).not.toContain("push");
    expect(dataSync?.pyMethods).toEqual(["pull", "status"]);
    expect(dataSync?.tsMethods).toEqual(["pull", "status"]);
    expect(dataSync?.pyOnly).toEqual([]);
    expect(dataSync?.tsOnly).toEqual([]);
  });
});
