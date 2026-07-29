import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  base64UrlDecode,
  createSigningRequest,
} from "@agenttool/wallet";

import {
  createZeroneDirectSignPlan,
  createZeroneSignedPayload,
  createZeroneSigningRequest,
} from "../src/index.js";
import {
  ADAPTER_SNAPSHOT,
  SECP_PRIVATE_KEY,
  SECP_PUBLIC_KEY,
  accountObservation,
  authorizedPlan,
  signedTransaction,
} from "./fixtures.js";

function fixtureSignature(signDocB64u: string): Uint8Array {
  return secp256k1.sign(
    base64UrlDecode(signDocB64u),
    SECP_PRIVATE_KEY,
    { prehash: true, lowS: true, format: "compact" },
  );
}

describe("simulation-bound signing requests", () => {
  test("rejects a public core SigningRequest that bypassed adapter binding", async () => {
    const { authorization, plan } = await authorizedPlan("attestation");
    const bypass = createSigningRequest({
      request_id: "88888888-8888-4888-8888-888888888888",
      authorization,
      signer_key_id: plan.signer_key_id,
      unsigned_payload: base64UrlDecode(plan.sign_doc_bytes_b64u),
    });

    expect(() => createZeroneSignedPayload({
      plan,
      request: bypass,
      signature: fixtureSignature(plan.sign_doc_bytes_b64u),
    })).toThrow(/createZeroneSigningRequest/i);
  });

  test("rejects plan substitution across every chain-state/sign-byte input", async () => {
    const {
      authorization,
      binding,
      bundle,
      plan: planA,
      request: requestA,
      simulation,
    } = await authorizedPlan("attestation");

    const variants = [
      {
        name: "account number",
        account: accountObservation({ account_number: "8" }),
        fee: "222222",
        gas: "222222",
        snapshot: ADAPTER_SNAPSHOT,
      },
      {
        name: "sequence",
        account: accountObservation({ sequence: "10" }),
        fee: "222222",
        gas: "222222",
        snapshot: ADAPTER_SNAPSHOT,
      },
      {
        name: "fee",
        account: accountObservation(),
        fee: "222223",
        gas: "222222",
        snapshot: ADAPTER_SNAPSHOT,
      },
      {
        name: "gas",
        account: accountObservation(),
        fee: "222222",
        gas: "222221",
        snapshot: ADAPTER_SNAPSHOT,
      },
      {
        name: "adapter observation height",
        account: accountObservation(),
        fee: "222222",
        gas: "222222",
        snapshot: {
          ...ADAPTER_SNAPSHOT,
          observed_at_height: "700001",
        },
      },
    ] as const;

    for (const variant of variants) {
      const planB = createZeroneDirectSignPlan({
        intent: bundle.intent,
        network: "testnet",
        signer_public_key: SECP_PUBLIC_KEY,
        account_observation: variant.account,
        fee_amount_uzrn: variant.fee,
        gas_limit: variant.gas,
        adapter_snapshot: variant.snapshot,
      });
      expect(
        () => createZeroneSigningRequest({
          plan: planB,
          simulation,
          binding,
          authorization,
          request_id: "99999999-9999-4999-8999-999999999999",
        }),
        variant.name,
      ).toThrow(/exact plan/i);
      expect(
        () => createZeroneSignedPayload({
          plan: planB,
          request: requestA,
          signature: fixtureSignature(planB.sign_doc_bytes_b64u),
        }),
        `${variant.name} signed-payload substitution`,
      ).toThrow(/exact simulation-bound plan/i);
    }

    expect(planA.adapter_snapshot_height).toBe("700000");
  });

  test("does not accept a structurally cloned simulation binding", async () => {
    const {
      authorization,
      binding,
      plan,
      simulation,
    } = await authorizedPlan("attestation");
    expect(() => createZeroneSigningRequest({
      plan,
      simulation,
      binding: { ...binding },
      authorization,
      request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })).toThrow(/created for this exact plan/i);
  });

  test("accepts the exact adapter-created request and verifies its signature", async () => {
    const { transaction } = await signedTransaction("attestation");
    expect(transaction.tx_hash).toMatch(/^[0-9A-F]{64}$/u);
  });
});
