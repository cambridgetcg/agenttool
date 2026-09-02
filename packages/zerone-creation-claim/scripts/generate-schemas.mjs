import { readFile, writeFile } from "node:fs/promises";

import { SCHEMAS } from "../dist/index.js";

const check = process.argv.includes("--check");
for (const [name, schema] of Object.entries(SCHEMAS)) {
  const target = new URL(`../schema/${name}`, import.meta.url);
  const rendered = `${JSON.stringify(schema, null, 2)}\n`;
  if (check) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== rendered) throw new Error(`${name} is stale or nondeterministic`);
  } else {
    await writeFile(target, rendered);
  }
}
