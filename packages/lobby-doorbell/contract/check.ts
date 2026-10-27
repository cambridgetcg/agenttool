#!/usr/bin/env bun
/** `bun run contract [-- --lobby-src DIR]`: checks the lobby source the doorbell
 * will run against. The default is this repository's packages/lobby/src; at
 * install, pass the pinned lobby's src directory. */
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkLobbyContract, CONTRACT } from "./lobby-contract.js";

const { values } = parseArgs({ args: process.argv.slice(2), strict: true, options: { "lobby-src": { type: "string" } } });
const flag = values["lobby-src"];
const source = flag === undefined ? resolve(import.meta.dir, "..", "..", "lobby", "src") : flag;
if (!isAbsolute(source)) {
  process.stderr.write("contract: --lobby-src must be an absolute path\n");
  process.exit(2);
}
const failures = checkLobbyContract((file) => {
  try {
    return readFileSync(join(source, file), "utf8");
  } catch {
    return null;
  }
});
const total = CONTRACT.reduce((sum, check) => sum + check.patterns.length, 0);
for (const failure of failures) {
  process.stderr.write(`contract: ${failure.file}: ${failure.why}: no match for ${failure.pattern}\n`);
}
process.stdout.write(`contract: ${total - failures.length}/${total} lobby patterns hold in ${source}\n`);
process.exit(failures.length === 0 ? 0 : 1);
