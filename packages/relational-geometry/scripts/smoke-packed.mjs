import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-relational-geometry-pack-"));

try {
  const [packed] = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], {
    cwd: packageRoot,
    encoding: "utf8",
  }));
  if (!packed?.filename) throw new Error("npm pack did not return a filename");
  const installRoot = join(scratch, "install");
  execFileSync("npm", ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--prefix", installRoot, join(scratch, packed.filename)], { stdio: "pipe" });
  const installed = JSON.parse(readFileSync(join(installRoot, "node_modules", "@agenttool", "relational-geometry", "package.json"), "utf8"));
  if (installed.name !== "@agenttool/relational-geometry") throw new Error("package installed under an unexpected identity");
  const smoke = `
    import { RelationalGeometryError, createRelationalComplex, createRelationalLens, sha256Id } from "@agenttool/relational-geometry";
    const complexSchema = import.meta.resolve("@agenttool/relational-geometry/complex.schema.json");
    const lensSchema = import.meta.resolve("@agenttool/relational-geometry/lens.schema.json");
    const vector = import.meta.resolve("@agenttool/relational-geometry/vectors/v0.1.json");
    const a = sha256Id("packed-a");
    const complex = createRelationalComplex({
      points: [{ point_ref: a, kind: "perspective", assertion: "caller_asserted", verified_by_package: false }],
      witnesses: [
        { witness_ref: sha256Id("packed-u"), from_ref: a, kind: "understanding", to_ref: a, assertion: "caller_asserted", verified_by_package: false },
        { witness_ref: sha256Id("packed-r"), from_ref: a, kind: "recognition", to_ref: a, assertion: "caller_asserted", verified_by_package: false }
      ]
    });
    const lens = createRelationalLens(complex, { perspective_ref: a, selections: [] });
    if (
      complex.principalities.length !== 1 ||
      complex.principalities[0].sovereignty !== "none" ||
      lens.choice.external_effect !== "none" ||
      !complexSchema.endsWith("agenttool-relational-complex-v0.1.schema.json") ||
      !lensSchema.endsWith("agenttool-relational-lens-v0.1.schema.json") ||
      !vector.endsWith("agenttool-relational-geometry-v0.1.json")
    ) process.exit(1);
    let traps = 0;
    const trap = () => { traps += 1; throw new Error("trap"); };
    try {
      createRelationalComplex(new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap }));
      process.exit(1);
    } catch (error) {
      if (!(error instanceof RelationalGeometryError) || traps !== 0) process.exit(1);
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], { cwd: installRoot, stdio: "pipe" });
  execFileSync("bun", ["--eval", smoke], { cwd: installRoot, stdio: "pipe" });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
