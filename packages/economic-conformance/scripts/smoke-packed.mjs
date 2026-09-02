import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("../", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-economic-conformance-pack-"));
const nestedNpmEnvironment = { ...process.env, npm_config_dry_run: "false" };

try {
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
    { cwd: packageRoot, encoding: "utf8", env: nestedNpmEnvironment },
  );
  const [packed] = JSON.parse(output);
  if (!packed?.filename) throw new Error("npm pack did not return a filename");
  const installRoot = join(scratch, "install");
  mkdirSync(installRoot);
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      join(scratch, packed.filename),
    ],
    {
      env: nestedNpmEnvironment,
      stdio: "pipe",
    },
  );
  const installedRoot = join(
    installRoot,
    "node_modules",
    "@agenttool",
    "economic-conformance",
  );
  const installedPackage = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  if (installedPackage.name !== "@agenttool/economic-conformance") {
    throw new Error("packed package installed under an unexpected identity");
  }
  const smoke = `
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    import {
      evaluateConformance,
      verifyOfficialVectorSources,
    } from "@agenttool/economic-conformance";
    const root = join(
      process.cwd(),
      "node_modules",
      "@agenttool",
      "economic-conformance",
    );
    const suite = verifyOfficialVectorSources(
      readFileSync(join(root, "vectors", "economic-kernel-v0.1.json")),
      readFileSync(join(root, "vectors", "manifest.json")),
    );
    const report = evaluateConformance(suite, {
      schema: "agenttool.economic-conformance-trace/1",
      suite_id: suite.suite_id,
      suite_revision: suite.suite_revision,
      producer_declared_ref: "adapter:packed-smoke",
      entries: [],
    });
    if (
      suite.cases.length !== 34
      || report.status !== "INCONCLUSIVE"
      || report.boundaries.producer_authenticated !== false
      || Object.hasOwn(report.cases[0], "expected")
      || Object.hasOwn(report.cases[0], "observed")
    ) process.exit(1);
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], {
    cwd: installRoot,
    stdio: "pipe",
  });
  execFileSync("bun", ["--eval", smoke], { cwd: installRoot, stdio: "pipe" });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
