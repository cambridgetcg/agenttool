import { execFileSync } from "node:child_process";

const packageRoot = new URL("..", import.meta.url);
const output = execFileSync(
  "npm",
  ["pack", "--dry-run", "--ignore-scripts", "--json"],
  { cwd: packageRoot, encoding: "utf8" },
);
const [report] = JSON.parse(output);
const files = report.files.map(({ path }) => path).sort();
const expected = [
  "CLAUDE.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "dist/index.d.ts",
  "dist/index.d.ts.map",
  "dist/index.js",
  "dist/index.js.map",
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-love-geometry-v0.1.schema.json",
  "vectors/agenttool-love-geometry-v0.1.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error("packed Love Geometry inventory differs from the exact public allowlist");
}
if (files.some((path) => path.startsWith("hf-space/"))) {
  throw new Error("the presentation-only HF companion entered npm package bytes");
}
