import { bytesToHex, sha256BytesId } from "@agenttool/wallet";
import { describe, expect, test } from "bun:test";

import {
  encodeCreateBountyOrderValue,
  encodeFulfillBountyValue,
  encodeSubmitComputationalClaimValue,
  deriveChainSettlementNullifier,
} from "../src/index.js";
import { buildFixture } from "./fixtures.js";

interface VectorValue {
  readonly hex: string;
  readonly sha256_id: string;
}

function wireDescription(bytes: Uint8Array): VectorValue {
  return { hex: bytesToHex(bytes), sha256_id: sha256BytesId(bytes) };
}

describe("generated Go protobuf parity", () => {
  test("matches standard Go marshal for zero/positive contracts, claim relations, and fulfillment", async () => {
    const goVector = await Bun.file(new URL(
      "../vectors/go-cosmos-protobuf-v0.1.json",
      import.meta.url,
    )).json() as {
      readonly consensus_hashes: { readonly settlement_nullifier: string };
      readonly values: Readonly<Record<string, VectorValue>>;
    };
    const fixture = buildFixture();
    const zero = {
      ...fixture.createBounty.value,
      work_contract: {
        ...fixture.createBounty.value.work_contract,
        min_corroborations: "0",
      },
    };
    expect(wireDescription(encodeCreateBountyOrderValue(zero)))
      .toEqual(goVector.values.create_bounty_min_corroborations_0);
    expect(wireDescription(encodeCreateBountyOrderValue(fixture.createBounty.value)))
      .toEqual(goVector.values.create_bounty_min_corroborations_2);
    expect(wireDescription(encodeSubmitComputationalClaimValue(fixture.submitClaim.value)))
      .toEqual(goVector.values.submit_computational_claim);
    expect(wireDescription(encodeFulfillBountyValue(fixture.fulfill.value)))
      .toEqual(goVector.values.fulfill_bounty);
    expect(deriveChainSettlementNullifier({
      work_spec_id: fixture.workSpec.work_spec_id,
      acceptance_hash: fixture.workSpec.acceptance_hash,
      input_root: fixture.workSpec.input_root,
      environment_root: fixture.workSpec.environment_root,
      artifact_root: fixture.artifact.artifact_root,
      worker_address: fixture.address,
    })).toBe(goVector.consensus_hashes.settlement_nullifier);
  });
});
