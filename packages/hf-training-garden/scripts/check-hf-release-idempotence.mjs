import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const datasetRoot = `${packageRoot}/hf/dataset`;

function walk(root, relative = "") {
  const path = relative ? `${root}/${relative}` : root;
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, child) : [child];
  });
}

function snapshot() {
  return walk(datasetRoot).sort().map((path) => ({
    path,
    sha256: createHash("sha256")
      .update(readFileSync(`${datasetRoot}/${path}`))
      .digest("hex"),
  }));
}

const before = snapshot();
execFileSync(process.execPath, ["hf/scripts/build-release.mjs"], {
  cwd: packageRoot,
  stdio: "inherit",
});
const after = snapshot();

if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error("HF companion generation is not byte-idempotent");
}
