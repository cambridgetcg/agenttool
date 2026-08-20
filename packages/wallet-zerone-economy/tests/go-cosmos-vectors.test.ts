import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  base64UrlDecode,
  base64UrlEncode,
} from "@agenttool/wallet";

import {
  ECONOMY_GAS,
  EXECUTION_SUPPORT,
  ZERONE_ECONOMY_CORE_COMMIT,
  ZERONE_ECONOMY_COSMOS_SDK,
  createZeroneEconomySignedPayload,
  decodeEconomyTxRaw,
  encodeEconomyAny,
  encodeEconomyAuthInfo,
  encodeEconomySignDoc,
  encodeEconomyTxBody,
  encodeEconomyTxRaw,
  verifyZeroneEconomySignedPayload,
  getZeroneEconomyModuleAccounts,
} from "../src/index.js";
import {
  SECP_PRIVATE_KEY,
  SECP_PUBLIC_KEY,
  SOURCE_ADDRESS,
  authorizedPlan,
  defaultProjections,
  planFor,
  profile,
  vector,
  walletBundle,
} from "./fixtures.js";

describe("independent Zerone economy Go/Cosmos vectors", () => {
  test("pins the exact source candidate and gas table", () => {
    expect(vector.schema).toBe(
      "agent-wallet-zerone-economy.go-cosmos-vectors/0.1",
    );
    expect(vector.provenance.zerone_core_commit).toBe(
      ZERONE_ECONOMY_CORE_COMMIT,
    );
    expect(vector.provenance.cosmos_sdk).toBe(ZERONE_ECONOMY_COSMOS_SDK);
    expect(Object.values(vector.verified).every(Boolean)).toBe(true);
    expect(vector.gas).toEqual({
      min_gas_limit: ECONOMY_GAS.min_gas_limit.toString(),
      create_bounty: ECONOMY_GAS.create_bounty.toString(),
      submit_claim: ECONOMY_GAS.submit_claim.toString(),
      fulfill_bounty: ECONOMY_GAS.fulfill_bounty.toString(),
      required_ordered_total: "144444",
      max_tx_gas: ECONOMY_GAS.max_gas_limit.toString(),
      min_gas_price_uzrn: "1",
    });
    expect(EXECUTION_SUPPORT.source_only).toBe(true);
    expect(EXECUTION_SUPPORT.activation_currentness_proven).toBe(false);
    expect(vector.fixture_boundary).toEqual({
      bundle_purpose: "byte_order_and_parity_only",
      bundle_same_transaction_lifecycle_viable: false,
      ordinary_execution_shape: "one_lifecycle_message_per_plan",
      multi_message_requirement:
        "independently_valid_combination_and_successful_exact_simulation",
    });
    const modules = getZeroneEconomyModuleAccounts("testnet");
    expect(modules.sponsorship).toBe(
      `cosmos:zerone-testnet-1:${vector.profile.sponsorship_module_address}`,
    );
    expect(modules.knowledge).toBe(
      `cosmos:zerone-testnet-1:${vector.profile.knowledge_module_address}`,
    );
  });

  test("matches one-message Go plans for each lifecycle step", async () => {
    const projections = defaultProjections();
    const cases = [
      {
        projection: projections[0]!,
        expected: vector.single_message_plans.create_bounty,
      },
      {
        projection: projections[1]!,
        expected: vector.single_message_plans.submit_claim,
      },
      {
        projection: projections[2]!,
        expected: vector.single_message_plans.fulfill_bounty,
      },
    ] as const;

    for (const { projection, expected } of cases) {
      const reserved = expected.reserved_spend_uzrn;
      const bundle = await walletBundle({
        projections: [projection],
        declared_spends: reserved === "0" ? [] : [{
          asset_id: profile.native_asset_id,
          amount_atomic: reserved,
        }],
      });
      const { plan, request } = await authorizedPlan({
        bundle,
        plan_overrides: {
          gas_limit: expected.required_gas,
          fee_amount_uzrn: expected.required_gas,
        },
      });
      expect(plan.messages).toHaveLength(1);
      expect(plan.required_gas_limit).toBe(expected.required_gas);
      expect(plan.total_reserved_spend_uzrn).toBe(reserved);
      expect(plan.body_bytes_b64u).toBe(expected.direct_sign.body_bytes_b64u);
      expect(plan.auth_info_bytes_b64u).toBe(expected.direct_sign.auth_info_bytes_b64u);
      expect(plan.sign_doc_bytes_b64u).toBe(expected.direct_sign.sign_doc_bytes_b64u);
      expect(plan.simulation_tx_bytes_b64u).toBe(
        expected.direct_sign.simulation_tx_bytes_b64u,
      );
      const payload = createZeroneEconomySignedPayload({
        plan,
        request,
        signature: base64UrlDecode(expected.direct_sign.signature_b64u),
      });
      expect(payload.signed_payload_b64u).toBe(
        expected.direct_sign.signed_tx_bytes_b64u,
      );
      expect(verifyZeroneEconomySignedPayload({
        plan,
        request,
        payload,
      }).tx_hash).toBe(expected.direct_sign.tx_hash);
    }
  });

  test("matches every generated Any and ordered TxBody byte", () => {
    const messages = [
      vector.messages.create_bounty,
      vector.messages.submit_claim,
      vector.messages.fulfill_bounty,
    ];
    for (const message of messages) {
      expect(base64UrlEncode(encodeEconomyAny({
        typeUrl: message.type_url,
        value: base64UrlDecode(message.value_b64u),
      }))).toBe(message.any_b64u);
    }
    expect(base64UrlEncode(encodeEconomyTxBody(messages.map((message) => ({
      typeUrl: message.type_url,
      value: base64UrlDecode(message.value_b64u),
    }))))).toBe(vector.direct_sign.body_bytes_b64u);
  });

  test("matches the non-lifecycle ordered bundle's Go direct-sign bytes", async () => {
    const { plan } = await planFor();
    expect(SOURCE_ADDRESS).toBe(vector.profile.source_address);
    expect(base64UrlEncode(SECP_PUBLIC_KEY)).toBe(vector.profile.public_key_b64u);
    expect(plan.zerone_core_commit).toBe(vector.provenance.zerone_core_commit);
    expect(plan.account_number).toBe(vector.profile.account_number);
    expect(plan.sequence).toBe(vector.profile.sequence);
    expect(plan.required_gas_limit).toBe(vector.gas.required_ordered_total);
    expect(plan.gas_limit).toBe(vector.profile.gas_limit);
    expect(plan.body_bytes_b64u).toBe(vector.direct_sign.body_bytes_b64u);
    expect(plan.auth_info_bytes_b64u).toBe(vector.direct_sign.auth_info_bytes_b64u);
    expect(plan.sign_doc_bytes_b64u).toBe(vector.direct_sign.sign_doc_bytes_b64u);
    expect(plan.simulation_tx_bytes_b64u).toBe(
      vector.direct_sign.simulation_tx_bytes_b64u,
    );
    expect(base64UrlEncode(encodeEconomyAuthInfo(
      SECP_PUBLIC_KEY,
      BigInt(vector.profile.sequence),
      { denom: "uzrn", amount: vector.profile.fee_amount_uzrn },
      BigInt(vector.profile.gas_limit),
    ))).toBe(vector.direct_sign.auth_info_bytes_b64u);
    expect(base64UrlEncode(encodeEconomySignDoc(
      base64UrlDecode(vector.direct_sign.body_bytes_b64u),
      base64UrlDecode(vector.direct_sign.auth_info_bytes_b64u),
      vector.profile.chain_reference,
      BigInt(vector.profile.account_number),
    ))).toBe(vector.direct_sign.sign_doc_bytes_b64u);
    expect(base64UrlEncode(encodeEconomyTxRaw(
      base64UrlDecode(vector.direct_sign.body_bytes_b64u),
      base64UrlDecode(vector.direct_sign.auth_info_bytes_b64u),
      new Uint8Array(),
    ))).toBe(vector.direct_sign.simulation_tx_bytes_b64u);
    const signature = secp256k1.sign(
      base64UrlDecode(plan.sign_doc_bytes_b64u),
      SECP_PRIVATE_KEY,
      { prehash: true, lowS: true, format: "compact" },
    );
    expect(base64UrlEncode(signature)).toBe(vector.direct_sign.signature_b64u);
  });

  test("creates and verifies the exact Go signed transaction", async () => {
    const { plan, request } = await authorizedPlan();
    const payload = createZeroneEconomySignedPayload({
      plan,
      request,
      signature: base64UrlDecode(vector.direct_sign.signature_b64u),
    });
    expect(payload.signed_payload_b64u).toBe(
      vector.direct_sign.signed_tx_bytes_b64u,
    );
    const transaction = verifyZeroneEconomySignedPayload({
      plan,
      request,
      payload,
    });
    expect(transaction.tx_hash).toBe(vector.direct_sign.tx_hash);
    const simulation = decodeEconomyTxRaw(
      base64UrlDecode(plan.simulation_tx_bytes_b64u),
    );
    expect(simulation.signature.byteLength).toBe(0);
  });
});
