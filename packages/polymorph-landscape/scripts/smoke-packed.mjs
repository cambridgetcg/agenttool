import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "agenttool-polymorph-landscape-pack-"));
try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], {
    cwd: packageRoot,
    encoding: "utf8",
  }));
  const tarball = join(scratch, packed[0].filename);
  const consumer = join(scratch, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  execFileSync("npm", ["install", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", tarball], {
    cwd: consumer,
    stdio: "pipe",
  });
  writeFileSync(join(consumer, "smoke.mjs"), `
    import assert from "node:assert/strict";
    import { createRitonavirCase, projectPolymorphLesson } from "@agenttool/polymorph-landscape";
    import landscapeSchema from "@agenttool/polymorph-landscape/landscape.schema.json" with { type: "json" };
    import ritonavir from "@agenttool/polymorph-landscape/examples/ritonavir.json" with { type: "json" };
    const { landscape, shift } = createRitonavirCase();
    assert.equal(landscape.landscape_id, ritonavir.landscape_id);
    assert.equal(landscapeSchema.additionalProperties, false);
    assert.equal(projectPolymorphLesson(landscape, shift, { language: "en" }).medical_advice, false);
  `);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "pipe" });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
