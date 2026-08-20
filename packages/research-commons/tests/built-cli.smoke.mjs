import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const input = fileURLToPath(
  new URL("../examples/amplitude-bootstrap-garden/simulation.json", import.meta.url),
);
const cwd = fileURLToPath(new URL("..", import.meta.url));

const validation = JSON.parse(execFileSync(
  process.execPath,
  [cli, "validate", "--input", "examples/amplitude-bootstrap-garden/simulation.json"],
  { cwd, encoding: "utf8" },
));
if (validation.valid !== true || validation.structural_only !== true) {
  throw new Error("built validate command did not produce a structural-only success");
}

const simulation = JSON.parse(execFileSync(
  process.execPath,
  [cli, "simulate", "--input", input],
  { cwd, encoding: "utf8" },
));
if (
  simulation.conservation?.total_committed !== 100 ||
  simulation.conservation?.total_delivered !== 40 ||
  simulation.conservation?.total_undelivered !== 60
) {
  throw new Error("built simulate command did not preserve the frozen Garden conservation vector");
}
