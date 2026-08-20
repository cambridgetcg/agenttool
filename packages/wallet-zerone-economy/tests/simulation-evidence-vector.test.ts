import { describe, expect, test } from "bun:test";

import { verifyZeroneEconomySimulationEvidence } from "../src/index.js";
import { authorizedPlan } from "./fixtures.js";

const vector = await Bun.file(new URL(
  "../vectors/simulation-evidence-v0.1-vector.json",
  import.meta.url,
)).json() as Record<string, unknown>;

describe("canonical adapter-signed simulation evidence vector", () => {
  test("matches the deterministic plan, Wallet receipt, content ID, and signature", async () => {
    const fixture = await authorizedPlan();
    expect(vector).toEqual({
      schema: "agent-wallet-zerone-economy/simulation-evidence-vector/0.1",
      provenance: {
        generator: "packages/wallet-zerone-economy/tests/fixtures.ts:authorizedPlan",
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
    });
  });

  test("reload-verifies the checked-in record with strict Ed25519", () => {
    const evidence = (vector as { readonly evidence: unknown }).evidence;
    const verified = verifyZeroneEconomySimulationEvidence(evidence);
    expect(verified.content_id).toBe(
      "sha256:b77318a73b9182923c7e8011c86ea1b397b4594c523ceb4cbde7ab04155f0c4e",
    );
    expect(verified.record_id).toBe(
      "sha256:d57b4dc26d578fbd9a0889ddbe8ff641ae15095f97b457bd402a6e4faa05c382",
    );
  });
});
