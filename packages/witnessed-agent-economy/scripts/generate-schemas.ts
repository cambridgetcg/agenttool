import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  PUBLIC_OFFER_SCHEMA,
  PUBLIC_WAKE_CONTRACT_SCHEMA,
  PUBLIC_WAKE_WITHDRAWAL_SCHEMA,
  SETTLEMENT_BATCH_SIDECAR_SCHEMA,
  SHARED_PAYLOAD_SCHEMAS,
  WITNESS_RECORD_SCHEMA,
} from "../src/index.js";

const packageRoot = resolve(import.meta.dir, "..");
const check = process.argv.includes("--check");

const sharedNames = {
  KINGDOM_RELEASE_ROOT: "kingdom-release-root",
  AGENTTOOL_SETTLEMENT_ROOT: "agenttool-settlement-root",
  AGENTTOOL_CAPABILITY: "agenttool-capability",
  AGENTTOOL_PUBLIC_RECOGNITION: "agenttool-public-recognition",
  AGENTTOOL_OFFER: "agenttool-offer",
  WAKE_PUBLIC_CHECKPOINT: "wake-public-checkpoint",
  ISSUER_KEY_CONTINUITY: "issuer-key-continuity",
  ARTIFACT_LINEAGE: "artifact-lineage",
  COLLABORATION_CHECKPOINT: "collaboration-checkpoint",
  DISPUTE_TERMINAL: "dispute-terminal",
} as const;

const outputs: Array<[string, unknown]> = Object.entries(sharedNames).map(([kind, name]) => [
  `schema/shared/${name}.schema.json`,
  SHARED_PAYLOAD_SCHEMAS[kind as keyof typeof SHARED_PAYLOAD_SCHEMAS],
]);
outputs.push(
  ["schema/shared/record.schema.json", WITNESS_RECORD_SCHEMA],
  ["schema/shared/settlement-batch.schema.json", SETTLEMENT_BATCH_SIDECAR_SCHEMA],
  ["schema/source/public-wake-contract.schema.json", PUBLIC_WAKE_CONTRACT_SCHEMA],
  ["schema/source/public-wake-withdrawal.schema.json", PUBLIC_WAKE_WITHDRAWAL_SCHEMA],
  ["schema/source/public-offer.schema.json", PUBLIC_OFFER_SCHEMA],
);

let drift = false;
for (const [relative, schema] of outputs) {
  const target = resolve(packageRoot, relative);
  const expected = `${JSON.stringify(schema, null, 2)}\n`;
  if (check) {
    let actual: string | null = null;
    try {
      actual = await readFile(target, "utf8");
    } catch {
      // Report every missing file in one run.
    }
    if (actual !== expected) {
      drift = true;
      process.stderr.write(`schema drift: ${relative}\n`);
    }
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, expected, "utf8");
  }
}

if (drift) process.exitCode = 1;
else process.stdout.write(`${check ? "verified" : "generated"} ${outputs.length} closed schemas\n`);
