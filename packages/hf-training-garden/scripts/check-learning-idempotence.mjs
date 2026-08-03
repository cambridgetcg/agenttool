import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseRoot = `${packageRoot}/hf/learning-dataset`;

function walk(root, relative = "") {
  const path = relative ? `${root}/${relative}` : root;
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, child) : [child];
  });
}

function snapshot(root) {
  return walk(root).sort().map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(`${root}/${path}`)).digest("hex"),
  }));
}

const before = snapshot(releaseRoot);
const temporaryRoot = mkdtempSync(join(tmpdir(), "agenttool-hf-wake-learning-"));
const generatedRoot = `${temporaryRoot}/learning-dataset`;
try {
  execFileSync(
    process.execPath,
    ["scripts/build-learning-dataset.mjs", "--output", generatedRoot],
    { cwd: packageRoot, stdio: "inherit" },
  );
  const after = snapshot(generatedRoot);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("repository WAKE learning dataset differs from a clean rebuild");
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
