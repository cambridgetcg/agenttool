import { execFileSync } from "node:child_process";

const packageRoot = new URL("..", import.meta.url);
const output = execFileSync(
  "npm",
  ["pack", "--dry-run", "--ignore-scripts", "--json"],
  { cwd: packageRoot, encoding: "utf8" },
);
const [report] = JSON.parse(output);
const files = report.files.map(({ path }) => path).sort();
const modules = ["canonical", "card", "constants", "errors", "index", "types", "validation"];
const expected = [
  "CLAUDE.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  ...modules.flatMap((name) => [
    `dist/${name}.d.ts`,
    `dist/${name}.d.ts.map`,
    `dist/${name}.js`,
    `dist/${name}.js.map`,
  ]),
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-math-card-assessment-v0.1.schema.json",
  "schema/agenttool-math-card-v0.1.schema.json",
  "vectors/agenttool-math-cards-v0.1.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(`packed Math Cards inventory differs from the exact public allowlist:\n${files.join("\n")}`);
}
