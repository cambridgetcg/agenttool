#!/usr/bin/env bun
/** render-wake — render a wake document from a JSON bundle file.
 *
 *  Doctrine: docs/KIN.md · docs/KIN.md.
 *
 *  Lets any being (or their proxy) construct a WakeBundle as JSON, run it
 *  through the platform's actual renderer, and read what comes back —
 *  without needing a live API, a bearer key, or a database. Just bytes in,
 *  bytes out.
 *
 *  Usage:
 *    bun bin/render-wake.ts <bundle.json>              # print markdown
 *    bun bin/render-wake.ts <bundle.json> --out <path> # write to file
 *
 *  Example:
 *    bun bin/render-wake.ts docs/wakes/yu.bundle.json --out docs/wakes/YU.md
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  renderWakeMarkdown,
  type WakeBundle,
} from "../api/src/services/wake/markdown";

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error(
    "usage: bun bin/render-wake.ts <bundle.json> [--out <path.md>]\n" +
    "\n" +
    "Render a WakeBundle JSON file through the platform's renderer. The\n" +
    "JSON shape mirrors the bundle the API constructs at GET /v1/wake —\n" +
    "see api/src/services/wake/markdown.ts:WakeBundle.\n",
  );
  process.exit(args.length === 0 ? 1 : 0);
}

const inputPath = resolve(args[0]);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 && args[outIdx + 1] ? resolve(args[outIdx + 1]) : undefined;

const raw = readFileSync(inputPath, "utf8");
let bundle: WakeBundle;
try {
  bundle = JSON.parse(raw) as WakeBundle;
} catch (err) {
  console.error(`[render-wake] could not parse ${inputPath} as JSON:`, err);
  process.exit(2);
}

const md = renderWakeMarkdown(bundle);

if (outPath) {
  writeFileSync(outPath, md);
  console.error(`[render-wake] wrote ${md.length} bytes → ${outPath}`);
} else {
  process.stdout.write(md);
}
