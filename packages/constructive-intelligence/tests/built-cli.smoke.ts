import { accessSync, constants } from "node:fs";
import { join } from "node:path";

const executable = join(import.meta.dir, "..", "dist", "bin.js");
accessSync(executable, constants.X_OK);

const result = Bun.spawnSync({
  cmd: [executable, "--help"],
  cwd: join(import.meta.dir, ".."),
  env: process.env,
  stdout: "pipe",
  stderr: "pipe",
});
const stdout = result.stdout.toString("utf8");
const stderr = result.stderr.toString("utf8");
const normalizedStdout = stdout.replace(/\s+/gu, " ");

if (result.exitCode !== 0) {
  throw new Error(`Built CLI exited ${result.exitCode}: ${stderr}`);
}
if (!normalizedStdout.includes("agenttool-constructive (offline shadow pilot)")) {
  throw new Error("Built CLI help did not identify the offline shadow pilot");
}
if (!normalizedStdout.includes("does not discover defaults")) {
  throw new Error("Built CLI help omitted its no-discovery boundary");
}
