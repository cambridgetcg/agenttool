import { resolve } from "node:path";

import { signedTransactionRecordFixture } from "../tests/fixtures.js";

const generatedAtRepositoryPath =
  "packages/wallet-zerone-economy/tests/fixtures.ts:signedTransactionRecordFixture";
const outputPath = resolve(
  import.meta.dir,
  "../vectors/signed-transaction-v0.1-vector.json",
);

const fixture = await signedTransactionRecordFixture();
const vector = {
  schema: "agent-wallet-zerone-economy/signed-transaction-vector/0.1",
  provenance: {
    generator: generatedAtRepositoryPath,
    content_domain: "agent-wallet-zerone-economy-signed-transaction/v1\\0",
    zerone_core_commit: fixture.plan.zerone_core_commit,
    cosmos_sdk: fixture.plan.cosmos_sdk,
  },
  plan: {
    plan_id: fixture.plan.plan_id,
    plan_content_id: fixture.record.plan_content_id,
    intent_record_id: fixture.plan.intent_record_id,
    request_id: fixture.request.request_id,
    sign_doc_bytes_hash: fixture.plan.sign_doc_bytes_hash,
  },
  record: fixture.record,
};
const expected = `${JSON.stringify(vector, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await Bun.file(outputPath).text();
  if (current !== expected) {
    throw new Error("signed transaction vector is stale; regenerate it");
  }
} else {
  await Bun.write(outputPath, expected);
}
