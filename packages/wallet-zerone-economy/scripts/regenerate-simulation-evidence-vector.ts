import { resolve } from "node:path";

import { authorizedPlan } from "../tests/fixtures.js";

const generatedAtRepositoryPath =
  "packages/wallet-zerone-economy/tests/fixtures.ts:authorizedPlan";
const outputPath = resolve(
  import.meta.dir,
  "../vectors/simulation-evidence-v0.1-vector.json",
);

const fixture = await authorizedPlan();
const vector = {
  schema: "agent-wallet-zerone-economy/simulation-evidence-vector/0.1",
  provenance: {
    generator: generatedAtRepositoryPath,
    signing_domain: "agent-wallet-zerone-economy-simulation-evidence/v1",
    zerone_core_commit: fixture.plan.zerone_core_commit,
    cosmos_sdk: fixture.plan.cosmos_sdk,
  },
  plan: {
    plan_id: fixture.plan.plan_id,
    account_number: fixture.plan.account_number,
    sequence: fixture.plan.sequence,
    simulation_tx_bytes_hash: fixture.plan.simulation_tx_bytes_hash,
  },
  wallet_simulation_record_id: fixture.simulation.record_id,
  evidence: fixture.evidence,
};
const expected = `${JSON.stringify(vector, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await Bun.file(outputPath).text();
  if (current !== expected) {
    throw new Error("simulation evidence vector is stale; regenerate it");
  }
} else {
  await Bun.write(outputPath, expected);
}
