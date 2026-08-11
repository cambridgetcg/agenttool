import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-love-geometry-pack-"));

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
      "install",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      tarball,
    ],
    { stdio: "pipe" },
  );
  const installedPackage = JSON.parse(
    readFileSync(
      join(installRoot, "node_modules", "@agenttool", "love-geometry", "package.json"),
      "utf8",
    ),
  );
  if (installedPackage.name !== "@agenttool/love-geometry") {
    throw new Error("packed package installed under an unexpected identity");
  }
  const smoke = `
    import {
      LoveGeometryError,
      createLoveGeometry,
      loveGeometryUrn,
      sha256Id,
      validateLoveGeometry,
    } from "@agenttool/love-geometry";
    const schema = import.meta.resolve("@agenttool/love-geometry/schema.json");
    const a = sha256Id("packed-a");
    const b = sha256Id("packed-b");
    const geometry = createLoveGeometry({
      scope_ref: sha256Id("packed-scope"),
      subject_refs: [a, b],
      vantages: [{
        subject_ref: a,
        toward_ref: b,
        bearings: ["reported_care", "reported_rest"],
        basis_refs: [],
        assertion: "caller_reported",
        verified_by_package: false,
      }],
    });
    if (
      validateLoveGeometry(geometry).geometry_id !== geometry.geometry_id ||
      geometry.boundaries.scores_or_ranks !== false ||
      !loveGeometryUrn(geometry).startsWith("urn:agenttool:love-geometry:") ||
      !schema.endsWith("/schema/agenttool-love-geometry-v0.1.schema.json")
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
      createLoveGeometry(hostile);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof LoveGeometryError) || traps !== 0) process.exit(1);
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
