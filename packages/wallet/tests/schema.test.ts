import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  RECORD_SCHEMAS,
  sealContinuityEvent,
  sealSigningReceipt,
  sha256BytesId,
  validateSimulationCore,
  type ContinuityEventCore,
  type SigningReceiptCore,
} from "../src/index.js";
import {
  POLICY_HASH,
  NATIVE_ASSET,
  TARGET,
  owner,
  receiptAuthority,
  signedBundle,
  simulationCore,
} from "./fixtures.js";

const schema = JSON.parse(await readFile(
  join(import.meta.dir, "..", "schema", "agent-wallet-v0.1.schema.json"),
  "utf8",
)) as object;
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

async function records() {
  const bundle = await signedBundle();
  const unsigned = new Uint8Array([1, 2, 3]);
  const signed = new Uint8Array([4, 5, 6]);
  const receiptCore: SigningReceiptCore = {
    schema: RECORD_SCHEMAS.signing_receipt,
    receipt_id: "99999999-9999-4999-8999-999999999999",
    request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    wallet_id: bundle.descriptor.wallet_id,
    descriptor_id: bundle.descriptor.record_id,
    grant_id: bundle.capability.grant_id,
    capability_record_id: bundle.capability.record_id,
    intent_id: bundle.intent.intent_id,
    intent_record_id: bundle.intent.record_id,
    simulation_record_id: bundle.simulation.record_id,
    source_account: bundle.intent.source_account,
    signer_key_id: receiptAuthority.key.key_id,
    receipt_authority: receiptAuthority.key,
    unsigned_payload_hash: sha256BytesId(unsigned),
    signed_payload_hash: sha256BytesId(signed),
    policy_hash: POLICY_HASH,
    operation_id: "0xfixture",
    signed_at: "2026-07-21T10:02:30.000Z",
  };
  const continuityCore: ContinuityEventCore = {
    schema: RECORD_SCHEMAS.continuity,
    event_id: "55555555-5555-4555-8555-555555555555",
    wallet_id: bundle.descriptor.wallet_id,
    sequence: 1,
    previous_record_id: null,
    event_kind: "capability_revoked",
    previous_value: null,
    next_value: null,
    revocation_nonce: 1,
    actor: owner.key,
    reason: "Fixture capability epoch rotation",
    effective_at: "2026-07-21T10:04:00.000Z",
  };
  return [
    bundle.descriptor,
    bundle.capability,
    bundle.intent,
    bundle.simulation,
    await sealSigningReceipt(receiptCore, receiptAuthority.signer),
    await sealContinuityEvent(continuityCore, owner.signer),
  ];
}

describe("bundled Agent Wallet schema", () => {
  test("strictly validates every emitted signed record", async () => {
    for (const record of await records()) {
      expect(validate(record), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  test("rejects unknown fields and secret-bearing additions", async () => {
    for (const signed of await records()) {
      expect(validate({ ...signed, private_key: "must-never-cross" })).toBe(false);
    }
  });

  test("keeps six disjoint schema discriminators", async () => {
    expect((await records()).map(({ schema }) => schema)).toEqual([
      RECORD_SCHEMAS.descriptor,
      RECORD_SCHEMAS.capability,
      RECORD_SCHEMAS.intent,
      RECORD_SCHEMAS.simulation,
      RECORD_SCHEMAS.signing_receipt,
      RECORD_SCHEMAS.continuity,
    ]);
  });

  test("accepts opaque chain-native block identifiers", async () => {
    const bundle = await signedBundle();
    const simulation = validateSimulationCore(simulationCore({
      intent: bundle.intent,
      overrides: { block_hash: "0x00000abc" },
    }));
    expect(simulation.block_hash).toBe("0x00000abc");
  });

  test("represents zero-amount approval revocation effects", async () => {
    const bundle = await signedBundle();
    const simulation = validateSimulationCore(simulationCore({
      intent: bundle.intent,
      overrides: {
        effects: [{
          action: "approve",
          target_account: TARGET,
          method: "approve",
          asset_id: NATIVE_ASSET,
          amount_atomic: "0",
        }],
      },
    }));
    expect(simulation.effects[0]?.amount_atomic).toBe("0");
  });
});
