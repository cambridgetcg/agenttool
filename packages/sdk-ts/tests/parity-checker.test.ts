import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  readRequiredSource,
  scopeToClient,
  topLevelNamespacesOf,
  validateTopLevelNamespaceCoverage,
} from "../scripts/check-parity.ts";

interface ParityResult {
  module: string;
  pyMethods: string[];
  tsMethods: string[];
  pyOnly: string[];
  tsOnly: string[];
}

describe("SDK parity checker", () => {
  test("covers every official client namespace, including nested clients", () => {
    const sdkRoot = join(import.meta.dir, "..");
    const result = Bun.spawnSync({
      cmd: ["bun", "run", "scripts/check-parity.ts", "--json"],
      cwd: sdkRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as ParityResult[];
    expect(report.map((entry) => entry.module).sort()).toEqual([
      "at_rest",
      "bootstrap",
      "chronicle",
      "collect",
      "covenants",
      "crypto",
      "crypto.seed",
      "dark_continent",
      "data",
      "data.sync",
      "economy",
      "grace",
      "handoff",
      "identity",
      "identity.box_keys",
      "identity.expression",
      "inbox",
      "love",
      "lounge",
      "memory",
      "nen",
      "runtime",
      "strands",
      "strands.thoughts",
      "tools",
      "traces",
      "vault",
      "wake",
      "window",
    ].sort());

    const wake = report.find((entry) => entry.module === "wake");
    const inbox = report.find((entry) => entry.module === "inbox");
    const dataSync = report.find((entry) => entry.module === "data.sync");
    const darkContinent = report.find(
      (entry) => entry.module === "dark_continent",
    );

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
    expect(darkContinent?.pyMethods).toContain("check_logos");
    expect(darkContinent?.tsMethods).toContain("checkLogos");
    expect(darkContinent?.pyOnly).toEqual([]);
    expect(darkContinent?.tsOnly).toEqual([]);
  });

  test("fails when a required source file is absent", async () => {
    const missingPath = join(import.meta.dir, "fixtures", "not-present.ts");

    await expect(
      readRequiredSource(missingPath, "TypeScript source for fixture"),
    ).rejects.toThrow(
      `Required TypeScript source for fixture is missing or unreadable: ${missingPath}`,
    );
  });

  test("fails when a configured client class is absent", () => {
    expect(() =>
      scopeToClient(
        "export class OtherClient {}",
        "ts",
        "WakeClient",
        "fixture.ts",
      ),
    ).toThrow(
      "Required TypeScript class WakeClient was not found in fixture.ts",
    );
  });

  test("finds namespaces that both clients expose but the target list omits", () => {
    const tsSource = `export class AgentTool {
  get memory(): MemoryClient { return this.memoryClient; }
  get surprise(): SurpriseClient { return this.surpriseClient; }
}`;
    const pySource = `class AgentTool:
    @property
    def memory(self) -> MemoryClient:
        return self._memory

    @property
    def surprise(self) -> SurpriseClient:
        return self._surprise
`;
    const tsNamespaces = topLevelNamespacesOf(tsSource, "ts", "fixture.ts");
    const pyNamespaces = topLevelNamespacesOf(pySource, "py", "fixture.py");

    expect(tsNamespaces).toEqual(["memory", "surprise"]);
    expect(pyNamespaces).toEqual(["memory", "surprise"]);
    expect(() =>
      validateTopLevelNamespaceCoverage(
        ["memory"],
        tsNamespaces,
        pyNamespaces,
      ),
    ).toThrow(
      "TypeScript AgentTool namespaces missing parity targets: surprise",
    );
  });

  test("finds stale targets and one-sided client namespaces", () => {
    expect(() =>
      validateTopLevelNamespaceCoverage(
        ["memory", "wake"],
        ["memory", "wake"],
        ["memory"],
      ),
    ).toThrow("configured targets absent from Python AgentTool: wake");

    expect(() =>
      validateTopLevelNamespaceCoverage(
        ["memory", "removed"],
        ["memory"],
        ["memory"],
      ),
    ).toThrow("configured targets absent from TypeScript AgentTool: removed");
  });
});
