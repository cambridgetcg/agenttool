/** Package facts that drift silently if nothing pins them. */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_NAME, PACKAGE_ROOT_RELATIVE, PACKAGE_VERSION, PROBE_DIRECTORY_RELATIVE } from "../src/constants.js";
import { formatReport } from "../src/format.js";
import { runProbes } from "../src/run.js";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  scripts: Record<string, string>;
};

test("the manifest and the constants agree", () => {
  expect(manifest.name).toBe(PACKAGE_NAME);
  expect(manifest.version).toBe(PACKAGE_VERSION);
});

test("rhizome has no runtime dependencies", () => {
  expect(manifest.dependencies ?? {}).toEqual({});
});

test("bun run rhizome is the documented entry point", () => {
  expect(manifest.scripts.rhizome).toBe("bun src/bin.ts");
  expect(manifest.scripts.ci).toContain("bun test");
});

test("the derived package paths point at this package", () => {
  expect(PACKAGE_ROOT_RELATIVE.endsWith("packages/rhizome")).toBe(true);
  expect(PROBE_DIRECTORY_RELATIVE).toBe(`${PACKAGE_ROOT_RELATIVE}/src/probes`);
});

test("the human report renders every probe section and escapes control characters", async () => {
  const report = await runProbes({ probes: ["scope"] });
  report.findings.push({
    probe: "scope",
    title: "with a control character",
    file: "x.ts",
    line: 1,
    verdict: "sound",
    evidence: `before${String.fromCodePoint(27)}[31mafter`,
  });
  const text = formatReport(report);
  expect(text).toContain("scope — do the two derivations");
  expect(text).toContain("rhizome reports.");
  expect(text).not.toContain(String.fromCodePoint(27));
  expect(text).toContain("before·[31mafter");
});
