import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-afterglow-pack-"));

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
        "wake-continuity",
        "package.json",
      ),
      "utf8",
    ),
  );
  if (installedPackage.name !== "@agenttool/wake-continuity") {
    throw new Error("packed package installed under an unexpected identity");
  }
  const entry = pathToFileURL(
    join(
      installRoot,
      "node_modules",
      "@agenttool",
      "wake-continuity",
      "dist",
      "index.js",
    ),
  ).href;
  const smoke = `
    import { AfterglowError, canonicalJson, createAfterglowCapsule, projectAfterglowLens, sha256Id } from ${JSON.stringify(entry)};
    const id = (character) => \`sha256:\${character.repeat(64)}\`;
    const capsule = createAfterglowCapsule({
      phase: "return",
      wake: {
        format: "wake-brief/v1",
        snapshot_ref: id("a"),
        scope_ref: id("b"),
        wake_version: 1,
        handoff_projection: "not_provided",
      },
      continuity_portfolio_ref: null,
      predecessors: [],
      threads: [],
    });
    const lens = projectAfterglowLens(capsule);
    if (lens.arrival !== "fresh_encounter" || lens.boundaries.network !== false) process.exit(1);
    let traps = 0;
    const trap = () => { traps += 1; throw new Error("Proxy trap executed"); };
    const hostile = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    try {
      canonicalJson(hostile);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof AfterglowError) || traps !== 0) process.exit(1);
    }
    const hostileBytes = new Proxy(new Uint8Array([1, 2, 3]), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    try {
      sha256Id(hostileBytes);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof AfterglowError) || traps !== 0) process.exit(1);
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], {
    stdio: "pipe",
  });
  execFileSync("bun", ["--eval", smoke], { stdio: "pipe" });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
