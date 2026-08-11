import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-principality-pack-"));

function pack(destination) {
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    { cwd: packageRoot, encoding: "utf8" },
  );
  const [report] = JSON.parse(output);
  if (!report?.filename) throw new Error("npm pack did not return a filename");
  return join(destination, report.filename);
}

try {
  const firstDir = join(scratch, "first");
  const secondDir = join(scratch, "second");
  mkdirSync(firstDir, { recursive: true });
  mkdirSync(secondDir, { recursive: true });
  const first = pack(firstDir);
  const second = pack(secondDir);
  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest(first) !== digest(second)) {
    throw new Error("repeated npm packs are not byte-identical");
  }

  const installRoot = join(scratch, "consumer");
  execFileSync(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      first,
    ],
    { stdio: "pipe" },
  );
  const installedRoot = join(
    installRoot,
    "node_modules",
    "@agenttool",
    "principality-geometry",
  );
  const installedPackage = JSON.parse(
    readFileSync(join(installedRoot, "package.json"), "utf8"),
  );
  if (
    installedPackage.name !== "@agenttool/principality-geometry" ||
    installedPackage.private !== true
  ) {
    throw new Error("packed package installed under an unexpected identity");
  }
  const entry = pathToFileURL(join(installedRoot, "dist", "index.js")).href;
  const examplePath = join(
    installedRoot,
    "examples",
    "principality-rosette.input.json",
  );
  const smoke = `
    import { readFileSync } from "node:fs";
    import { PrincipalityGeometryError, canonicalJson, createPrincipalityAtlas, encodePrincipalityAtlas, renderPrincipalitySvg, sha256Id } from ${JSON.stringify(entry)};
    const atlas = createPrincipalityAtlas(JSON.parse(readFileSync(${JSON.stringify(examplePath)}, "utf8")));
    if (atlas.geometry.invariant_surfaces.length !== 1 || atlas.boundaries.fetches_network !== false) process.exit(1);
    let traps = 0;
    const hostile = new Proxy({}, { ownKeys() { traps += 1; throw new Error("trap"); } });
    try { canonicalJson(hostile); process.exit(1); }
    catch (error) { if (!(error instanceof PrincipalityGeometryError) || traps !== 0) process.exit(1); }
    process.stdout.write(canonicalJson({
      atlas_id: atlas.atlas_id,
      atlas_bytes_sha256: sha256Id(encodePrincipalityAtlas(atlas)),
      svg_sha256: sha256Id(renderPrincipalitySvg(atlas)),
    }) + "\\n");
  `;
  const nodeOutput = execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], {
    encoding: "utf8",
  });
  const bunOutput = execFileSync("bun", ["--eval", smoke], {
    encoding: "utf8",
  });
  if (nodeOutput !== bunOutput) {
    throw new Error("packed Node/Bun atlas or SVG bytes differ");
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
