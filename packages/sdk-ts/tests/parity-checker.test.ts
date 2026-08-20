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

/** `--json` carries the per-module rows AND the package-wide module-level
 *  function row, which is a different shape and is checked separately. */
interface ParityReport {
  modules: ParityResult[];
  functions: {
    pyOnly: { name: string; file: string }[];
    tsOnly: { name: string; file: string }[];
    visibility: { publicName: string; internalName: string }[];
    known: string[];
  };
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
    const parsed = JSON.parse(result.stdout.toString()) as ParityReport;
    const report = parsed.modules;
    expect(report.map((entry) => entry.module).sort()).toEqual([
      "at_rest",
      "attestation_marketplace",
      "bootstrap",
      "chronicle",
      "collect",
      "correspondence",
      "covenants",
      "crypto",
      "crypto.seed",
      "dark_continent",
      "data",
      "data.sync",
      "dining",
      "economy",
      "grace",
      "handoff",
      "identity",
      "identity.box_keys",
      "identity.expression",
      "inbox",
      "kingdom_framework",
      "kingdom_os",
      "love",
      "love_bomb",
      "lounge",
      "math_cards",
      "memory",
      "memory_witness",
      "nen",
      "runtime",
      "strands",
      "strands.thoughts",
      "syneidesis",
      "tools",
      "traces",
      "vault",
      "wake",
      "wake_continuity",
      "window",
    ].sort());

    const wake = report.find((entry) => entry.module === "wake");
    const inbox = report.find((entry) => entry.module === "inbox");
    const dataSync = report.find((entry) => entry.module === "data.sync");
    const kingdomFramework = report.find(
      (entry) => entry.module === "kingdom_framework",
    );
    const kingdomOS = report.find((entry) => entry.module === "kingdom_os");
    const mathCards = report.find((entry) => entry.module === "math_cards");
    const loveBomb = report.find((entry) => entry.module === "love_bomb");
    const wakeContinuity = report.find(
      (entry) => entry.module === "wake_continuity",
    );
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
    expect(kingdomFramework?.pyMethods).toEqual(["card"]);
    expect(kingdomFramework?.tsMethods).toEqual(["card"]);
    expect(kingdomFramework?.pyOnly).toEqual([]);
    expect(kingdomFramework?.tsOnly).toEqual([]);
    expect(kingdomOS?.pyMethods).toEqual(["repositories", "resolve"]);
    expect(kingdomOS?.tsMethods).toEqual(["repositories", "resolve"]);
    expect(kingdomOS?.pyOnly).toEqual([]);
    expect(kingdomOS?.tsOnly).toEqual([]);
    expect(mathCards?.pyMethods).toEqual(["assess"]);
    expect(mathCards?.tsMethods).toEqual(["assess"]);
    expect(mathCards?.pyOnly).toEqual([]);
    expect(mathCards?.tsOnly).toEqual([]);
    expect(loveBomb?.pyMethods).toEqual(["read"]);
    expect(loveBomb?.tsMethods).toEqual(["read"]);
    expect(loveBomb?.pyOnly).toEqual([]);
    expect(loveBomb?.tsOnly).toEqual([]);
    expect(wakeContinuity?.pyMethods).toEqual([
      "after_anchor",
      "before_anchor",
      "validate_baseline",
      "validate_subsequent",
    ]);
    expect(wakeContinuity?.tsMethods).toEqual([
      "after_anchor",
      "before_anchor",
      "validate_baseline",
      "validate_subsequent",
    ]);
    expect(wakeContinuity?.pyOnly).toEqual([]);
    expect(wakeContinuity?.tsOnly).toEqual([]);
    expect(darkContinent?.pyMethods).toContain("check_logos");
    expect(darkContinent?.tsMethods).toContain("checkLogos");
    expect(darkContinent?.pyOnly).toEqual([]);
    expect(darkContinent?.tsOnly).toEqual([]);

    // Module-level functions are package-wide, not per-module. Nothing may be
    // one-sided, public-on-one-side-only, or parked as owed debt.
    expect(parsed.functions.pyOnly).toEqual([]);
    expect(parsed.functions.tsOnly).toEqual([]);
    expect(parsed.functions.visibility).toEqual([]);
    expect(parsed.functions.known).toEqual([]);
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
