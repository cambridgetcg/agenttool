import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-dataset-influence-pack-"));

try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
    { cwd: packageRoot, encoding: "utf8" },
  );
  const [packed] = JSON.parse(packOutput);
  if (!packed?.filename) throw new Error("npm pack did not return a filename");
  const tarball = join(scratch, packed.filename);
  const installRoot = join(scratch, "install");
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--prefix", installRoot, tarball],
    { stdio: "pipe" },
  );
  const installedPackage = JSON.parse(readFileSync(
    join(installRoot, "node_modules", "@agenttool", "dataset-influence", "package.json"),
    "utf8",
  ));
  if (installedPackage.name !== "@agenttool/dataset-influence" || installedPackage.version !== "0.1.0-dev.0") {
    throw new Error("packed package installed under an unexpected identity");
  }
  const smoke = String.raw`
    import { readFileSync } from "node:fs";
    import {
      DatasetInfluenceError,
      PACKAGE_VERSION,
      validateDatasetLineage,
      validateShadowAttribution,
    } from "@agenttool/dataset-influence";
    const vectorUrl = import.meta.resolve("@agenttool/dataset-influence/vectors.json");
    const extensionUrl = import.meta.resolve("@agenttool/dataset-influence/kingdom.extension.json");
    const lineageSchemaUrl = import.meta.resolve("@agenttool/dataset-influence/lineage.schema.json");
    const vectors = JSON.parse(readFileSync(new URL(vectorUrl), "utf8"));
    const extension = JSON.parse(readFileSync(new URL(extensionUrl), "utf8"));
    validateDatasetLineage(vectors.cases.exact_lineage.artifact);
    const shadow = validateShadowAttribution(vectors.cases.exact_shadow_attribution.artifact);
    if (
      PACKAGE_VERSION !== "0.1.0-dev.0"
      || !lineageSchemaUrl.endsWith("/schema/agenttool-dataset-lineage-v0.1.schema.json")
      || extension.host_contract !== "not_registered"
      || Object.values(extension.defaults).some((value) => value !== false)
      || shadow.economic_effect !== "none"
      || shadow.authorizes_payment !== false
    ) process.exit(1);
    let traps = 0;
    const trap = () => { traps += 1; throw new Error("Proxy trap executed"); };
    const hostile = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    try {
      validateDatasetLineage(hostile);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof DatasetInfluenceError) || traps !== 0) process.exit(1);
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], { cwd: installRoot, stdio: "pipe" });
  execFileSync("bun", ["--eval", smoke], { cwd: installRoot, stdio: "pipe" });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
