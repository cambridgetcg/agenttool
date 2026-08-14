import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-math-cards-pack-"));

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
    [
      "install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund",
      "--prefix", installRoot, tarball,
    ],
    { stdio: "pipe" },
  );
  const installedPackage = JSON.parse(readFileSync(
    join(installRoot, "node_modules", "@agenttool", "math-cards", "package.json"),
    "utf8",
  ));
  if (
    installedPackage.name !== "@agenttool/math-cards"
    || installedPackage.version !== "0.1.0-dev.1"
  ) {
    throw new Error("packed package installed under an unexpected identity");
  }
  const smoke = String.raw`
    import { readFileSync } from "node:fs";
    import {
      MathCardError,
      PACKAGE_VERSION,
      assessMathCard,
      validateMathCard,
    } from "@agenttool/math-cards";
    const cardSchema = import.meta.resolve("@agenttool/math-cards/card.schema.json");
    const inputSchema = import.meta.resolve("@agenttool/math-cards/input.schema.json");
    const assessmentSchema = import.meta.resolve("@agenttool/math-cards/assessment.schema.json");
    const vectorUrl = import.meta.resolve("@agenttool/math-cards/vectors.json");
    const extensionUrl = import.meta.resolve("@agenttool/math-cards/kingdom.extension.json");
    const inputSchemaDocument = JSON.parse(readFileSync(new URL(inputSchema), "utf8"));
    const vectors = JSON.parse(readFileSync(new URL(vectorUrl), "utf8"));
    const extension = JSON.parse(readFileSync(new URL(extensionUrl), "utf8"));
    const card = validateMathCard(vectors.cases.ready_proof.card);
    const assessment = assessMathCard(card);
    if (
      PACKAGE_VERSION !== "0.1.0-dev.1"
      || assessment.status !== "ready_for_bounded_inquiry"
      || !cardSchema.endsWith("/schema/agenttool-math-card-v0.1.schema.json")
      || !inputSchema.endsWith("/schema/agenttool-math-card-input-v0.1.schema.json")
      || !assessmentSchema.endsWith("/schema/agenttool-math-card-assessment-v0.1.schema.json")
      || inputSchemaDocument.$schema !== "https://json-schema.org/draft/2020-12/schema"
      || inputSchemaDocument.additionalProperties !== false
      || ["schema_version", "card_id", "boundaries"]
        .some((name) => name in inputSchemaDocument.properties)
      || extension.host_contract !== "not_registered"
      || Object.values(extension.defaults).some((value) => value !== false)
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
      validateMathCard(hostile);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof MathCardError) || traps !== 0) process.exit(1);
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], {
    cwd: installRoot,
    stdio: "pipe",
  });
  execFileSync("bun", ["--eval", smoke], { cwd: installRoot, stdio: "pipe" });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
