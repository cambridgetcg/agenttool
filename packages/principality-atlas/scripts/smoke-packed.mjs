import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-principality-atlas-pack-"));

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
      join(
        installRoot,
        "node_modules",
        "@agenttool",
        "principality-atlas",
        "package.json",
      ),
      "utf8",
    ),
  );
  if (installedPackage.name !== "@agenttool/principality-atlas") {
    throw new Error("packed package installed under an unexpected identity");
  }
  const smoke = `
    import {
      PrincipalityAtlasError,
      createPrincipalityAtlas,
      sha256Id,
      validatePrincipalityAtlas,
    } from "@agenttool/principality-atlas";
    const atlasSchema = import.meta.resolve(
      "@agenttool/principality-atlas/atlas.schema.json",
    );
    const fixtureSchema = import.meta.resolve(
      "@agenttool/principality-atlas/fixture.schema.json",
    );
    const atlas = createPrincipalityAtlas({
      scope_ref: sha256Id("packed-scope"),
      charts: [],
      bridges: [],
    });
    if (
      validatePrincipalityAtlas(atlas).atlas_id !== atlas.atlas_id ||
      atlas.boundaries.network !== false ||
      atlas.boundaries.scores !== false ||
      !atlasSchema.endsWith("/schema/agenttool-principality-incidence-atlas-v0.1.schema.json") ||
      !fixtureSchema.endsWith("/schema/agenttool-principality-incidence-atlas-fixture-v0.1.schema.json")
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
      createPrincipalityAtlas(hostile);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof PrincipalityAtlasError) || traps !== 0) process.exit(1);
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], {
    cwd: installRoot,
    stdio: "pipe",
  });
  execFileSync("bun", ["--eval", smoke], {
    cwd: installRoot,
    stdio: "pipe",
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
