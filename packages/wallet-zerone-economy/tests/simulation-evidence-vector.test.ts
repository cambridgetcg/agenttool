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
    expect(fixture.plan.simulation_tx_bytes_hash).toBe(
      "sha256:c6c637e957026327638d47e0e26bc578e2212b1aa934a19cae08afbb645d9e68",
    );
    expect(fixture.simulation.record_id).toBe(
      "sha256:d6e81646cf3cdaf56d6eebd909f383417d02dd0c93e24ba17352714ddefdbf3d",
    );
    expect(fixture.evidence.block_hash).toBe("A".repeat(64));
    expect(fixture.evidence.signature.value).toBe(
      "8BC8G7_fNCizi9AYygV2KzscUqZjjnpK0tDxn2YkU08N6417WZe1RzXaxKXfSRA2eSDinE-kbNykBsptHCbrAQ",
    );
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
      "sha256:6452a8e4ddf431a1c290e371a0212458c17404846bc1c04833675b15f11d4b95",
    );
    expect(verified.record_id).toBe(
      "sha256:95850c524edf0e98a345e7a063d6f94a5d7cfda1a7cf8390e0291298ef214402",
    );
  });
});
