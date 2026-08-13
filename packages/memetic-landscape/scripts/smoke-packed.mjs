import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "agenttool-memetic-landscape-pack-"));
try {
  const packed = JSON.parse(execFileSync("npm", [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    scratch,
  ], {
    cwd: packageRoot,
    encoding: "utf8",
  }));
  const tarball = join(scratch, packed[0].filename);
  const consumer = join(scratch, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  execFileSync("npm", [
    "install",
    "--ignore-scripts",
    "--no-package-lock",
    "--no-audit",
    "--no-fund",
    tarball,
  ], {
    cwd: consumer,
    stdio: "pipe",
  });
  writeFileSync(join(consumer, "smoke.mjs"), `
    import assert from "node:assert/strict";
    import { createBrainrotTeachingCase, projectMemeticLesson } from "@agenttool/memetic-landscape";
    import landscapeSchema from "@agenttool/memetic-landscape/landscape.schema.json" with { type: "json" };
    import analogySchema from "@agenttool/memetic-landscape/analogy.schema.json" with { type: "json" };
    import brainrot from "@agenttool/memetic-landscape/examples/brainrot.json" with { type: "json" };
    const { landscape, shift, analogy } = createBrainrotTeachingCase();
    assert.equal(landscape.landscape_id, brainrot.landscape_id);
    assert.equal(landscapeSchema.additionalProperties, false);
    assert.equal(analogySchema.additionalProperties, false);
    assert.equal(projectMemeticLesson(landscape, shift, analogy, { language: "en" }).spread_optimization, false);
  `);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "pipe" });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
