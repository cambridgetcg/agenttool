import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-economic-kernel-pack-"));
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
    { env: nestedNpmEnvironment, stdio: "pipe" },
  );
  const installedPackage = JSON.parse(readFileSync(
    join(installRoot, "node_modules", "@agenttool", "economic-kernel", "package.json"),
    "utf8",
  ));
  if (installedPackage.name !== "@agenttool/economic-kernel") {
    throw new Error("packed package installed under an unexpected identity");
  }
  const smoke = `
    import {
      ECONOMIC_KERNEL_PROTOCOL,
      SCHEMAS,
      UnitRegistry,
      amount,
      evaluateEconomicAdmission,
    } from "@agenttool/economic-kernel";
    const units = new UnitRegistry([{
      schema: SCHEMAS.unit,
      unit_id: "iso4217:gbp:minor",
      dimension: "FIAT",
      decimals: 2,
      ledger_domain: "ledger:gbp",
      transferability: "TRANSFERABLE",
    }]);
    const exact = amount("iso4217:gbp:minor", "9007199254740993", units);
    const admission = evaluateEconomicAdmission({
      action_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      gate_evidence_ref: "gate:packed-smoke",
      gate_revision: "1",
      evaluated_at: "2026-09-02T00:00:00.000Z",
      valid_until: "2026-09-02T00:01:00.000Z",
      authority: "ALLOW",
      safety: "ALLOW",
      participation: "NOT_REQUIRED",
      payment: "NOT_REQUIRED",
    });
    if (
      ECONOMIC_KERNEL_PROTOCOL !== "agenttool.economic-kernel/0.1" ||
      exact.amount_atomic !== "9007199254740993" ||
      admission.outcome !== "ADMIT" ||
      admission.rights_conditional_on_payment !== false
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
