import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  sealTransactionIntent,
  sha256BytesId,
  type TransactionIntent,
  type TransactionIntentCore,
  type Verified,
} from "@agenttool/wallet";

import {
  AGENTTOOL_ADAPTER_ID,
  AGENTTOOL_WORK_CLASS_ID,
  COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  ZERONE_LIMITS,
  ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION,
  createAgentToolInvocationWitnessLink,
  createZeroneDirectSignPlan,
  createZeroneSignedPayload,
  encodeZeroneMsgSubmitExternalAttestation,
  verifyZeroneSignedPayload,
} from "../src/index.js";
import {
  ADAPTER_SNAPSHOT,
  INVOCATION,
  MATCHING_ACCOUNT_KEY,
  RECIPIENT_ACCOUNT,
  SECP_PRIVATE_KEY,
  SECP_PUBLIC_KEY,
  SOURCE_ADDRESS,
  accountObservation,
  authorizedPlan,
  delegate,
  planFor,
  walletIntent,
} from "./fixtures.js";

async function resealIntent(
  intent: Verified<TransactionIntent>,
  change: (
    core: TransactionIntentCore,
  ) => TransactionIntentCore,
): Promise<Verified<TransactionIntent>> {
  const { record_id: _recordId, signature: _signature, ...unsigned } = intent;
  const core: TransactionIntentCore = {
    ...unsigned,
    calls: unsigned.calls.map((call) => ({
      ...call,
      native_value:
        call.native_value === null ? null : { ...call.native_value },
    })),
    declared_spends: unsigned.declared_spends.map((spend) => ({ ...spend })),
    max_fee: { ...unsigned.max_fee },
  };
  return sealTransactionIntent(change(core), delegate.signer);
}

function alternateSecpPublicKey(): Uint8Array {
  const key = Uint8Array.from(SECP_PRIVATE_KEY);
  key[31] = 2;
  return secp256k1.getPublicKey(key, true);
}

function mutateTxRawField(
  encoded: string,
  fieldNumber: 1 | 2,
): Uint8Array {
  const bytes = base64UrlDecode(encoded);
  let offset = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 0;
    while (offset < bytes.byteLength) {
      const octet = bytes[offset];
      if (octet === undefined) throw new Error("truncated TxRaw varint");
      offset += 1;
      result += (octet & 0x7f) * (2 ** shift);
      if ((octet & 0x80) === 0) return result;
      shift += 7;
    }
    throw new Error("truncated TxRaw varint");
  };
  while (offset < bytes.byteLength) {
    const tag = varint();
    if ((tag & 7) !== 2) {
      throw new Error("unexpected TxRaw fixture");
    }
    const number = tag >> 3;
    const length = varint();
    if (number === fieldNumber) {
      const changed = Uint8Array.from(bytes);
      changed[offset + length - 1] ^= 1;
      return changed;
    }
    offset += length;
  }
  throw new Error("TxRaw field absent");
}

function highSSignature(signature: Uint8Array): Uint8Array {
  const output = Uint8Array.from(signature);
  let lowS = 0n;
  for (const octet of output.subarray(32)) {
    lowS = (lowS << 8n) | BigInt(octet);
  }
  let highS = secp256k1.Point.Fn.ORDER - lowS;
  for (let index = 63; index >= 32; index -= 1) {
    output[index] = Number(highS & 0xffn);
    highS >>= 8n;
  }
  return output;
}

describe("Zerone signer and account binding", () => {
  test("accepts an unset account key or the exact registered secp256k1 key", async () => {
    await expect(planFor("attestation")).resolves.toBeDefined();
    await expect(planFor("attestation", {
      account_observation: accountObservation(MATCHING_ACCOUNT_KEY),
    })).resolves.toBeDefined();
  });

  test("rejects signer/address mismatch, Ed25519, unknown, and changed keys", async () => {
    await expect(planFor("attestation", {
      signer_public_key: alternateSecpPublicKey(),
    })).rejects.toThrow(/derive.*source account/i);

    const accountKeys = [
      {
        public_key_type_url: "/cosmos.crypto.ed25519.PubKey",
        public_key_b64u: base64UrlEncode(new Uint8Array(32).fill(7)),
      },
      {
        public_key_type_url: "/example.crypto.UnknownPubKey",
        public_key_b64u: base64UrlEncode(SECP_PUBLIC_KEY),
      },
      {
        public_key_type_url: COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
        public_key_b64u: base64UrlEncode(alternateSecpPublicKey()),
      },
      {
        public_key_type_url: COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
        public_key_b64u: null,
      },
    ] as const;
    for (const accountKey of accountKeys) {
      await expect(planFor("attestation", {
        account_observation: accountObservation(accountKey),
      })).rejects.toThrow(/unset or the exact same.*secp256k1/i);
    }
  });

  test("rejects high-S signatures and changed Body/AuthInfo bytes", async () => {
    const { plan, request } = await authorizedPlan("attestation");
    const signature = secp256k1.sign(
      base64UrlDecode(plan.sign_doc_bytes_b64u),
      SECP_PRIVATE_KEY,
      { prehash: true, lowS: true, format: "compact" },
    );
    expect(() => createZeroneSignedPayload({
      plan,
      request,
      signature: highSSignature(signature),
    })).toThrow(/invalid or malleable/i);

    const payload = createZeroneSignedPayload({ plan, request, signature });
    for (const field of [1, 2] as const) {
      const changed = mutateTxRawField(payload.signed_payload_b64u, field);
      expect(() => verifyZeroneSignedPayload({
        plan,
        request,
        payload: {
          ...payload,
          signed_payload_b64u: base64UrlEncode(changed),
          signed_payload_hash: sha256BytesId(changed),
        },
      })).toThrow(/exact planned body and AuthInfo/i);
    }
  });
});

describe("Zerone fee, gas, spend, message, and snapshot binding", () => {
  test("enforces 1 uzrn/gas, chain gas bounds, and intent max_fee", async () => {
    await expect(planFor("send", {
      fee_amount_uzrn: "222221",
      gas_limit: "222222",
    })).rejects.toThrow(/1 uzrn per gas/i);
    await expect(planFor("send", {
      fee_amount_uzrn: ZERONE_LIMITS.min_gas_limit.toString(),
      gas_limit: (ZERONE_LIMITS.min_gas_limit - 1n).toString(),
    })).rejects.toThrow(/below the pinned Zerone minimum/i);
    await expect(planFor("send", {
      fee_amount_uzrn: (ZERONE_LIMITS.max_gas_limit + 1n).toString(),
      gas_limit: (ZERONE_LIMITS.max_gas_limit + 1n).toString(),
    })).rejects.toThrow(/per-transaction cap/i);
    await expect(planFor("send", {
      fee_amount_uzrn: "500001",
      gas_limit: "222222",
    })).rejects.toThrow(/intent.max_fee/i);
  });

  test("sums the pinned ZRNGasDecorator cost for every message", async () => {
    const { intent: sendIntent } = await walletIntent("send");
    const twoSends = await resealIntent(sendIntent, (core) => ({
      ...core,
      calls: [...core.calls, ...core.calls.map((call) => ({
        ...call,
        native_value:
          call.native_value === null ? null : { ...call.native_value },
      }))],
      declared_spends: [{
        asset_id: core.declared_spends[0]?.asset_id ?? "",
        amount_atomic: "246912",
      }],
    }));
    const sendBase = {
      intent: twoSends,
      network: "testnet" as const,
      signer_public_key: SECP_PUBLIC_KEY,
      account_observation: accountObservation(),
    };
    expect(() => createZeroneDirectSignPlan({
      ...sendBase,
      fee_amount_uzrn: "41999",
      gas_limit: "41999",
    })).toThrow(/per-message requirement 42000/i);
    const sendPlan = createZeroneDirectSignPlan({
      ...sendBase,
      fee_amount_uzrn: "42000",
      gas_limit: "42000",
    });
    expect(sendPlan.required_gas_limit).toBe("42000");

    const { intent: attestationIntent } = await walletIntent("attestation");
    const duplicateAttestations = await resealIntent(
      attestationIntent,
      (core) => ({
        ...core,
        calls: [...core.calls, ...core.calls],
        declared_spends: [{
          asset_id: core.declared_spends[0]?.asset_id ?? "",
          amount_atomic: "2000000",
        }],
      }),
    );
    expect(() => createZeroneDirectSignPlan({
      intent: duplicateAttestations,
      network: "testnet",
      signer_public_key: SECP_PUBLIC_KEY,
      account_observation: accountObservation(),
      fee_amount_uzrn: "44444",
      gas_limit: "44444",
      adapter_snapshot: ADAPTER_SNAPSHOT,
    })).toThrow(/same attestation source_id twice/i);

    const secondInvocation = {
      ...INVOCATION,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    const secondLink = createAgentToolInvocationWitnessLink({
      invocation: secondInvocation,
      source_id: secondInvocation.id,
      source_url:
        `https://api.agenttool.dev/v1/invocations/${secondInvocation.id}`,
      fetched_at_block: "699999",
    });
    const secondPayload = encodeZeroneMsgSubmitExternalAttestation({
      submitter: SOURCE_ADDRESS,
      adapter_id: AGENTTOOL_ADAPTER_ID,
      work_class_id: AGENTTOOL_WORK_CLASS_ID,
      link: secondLink,
      bond_uzrn: "1000000",
    });
    const twoAttestations = await resealIntent(
      attestationIntent,
      (core) => {
        const firstCall = core.calls[0];
        if (firstCall === undefined) {
          throw new Error("attestation fixture call missing");
        }
        return {
          ...core,
          calls: [
            ...core.calls,
            {
              ...firstCall,
              payload_b64u: base64UrlEncode(secondPayload),
              payload_hash: sha256BytesId(secondPayload),
            },
          ],
          declared_spends: [{
            asset_id: core.declared_spends[0]?.asset_id ?? "",
            amount_atomic: "2000000",
          }],
        };
      },
    );
    const attestationBase = {
      intent: twoAttestations,
      network: "testnet" as const,
      signer_public_key: SECP_PUBLIC_KEY,
      account_observation: accountObservation(),
      adapter_snapshot: ADAPTER_SNAPSHOT,
    };
    expect(() => createZeroneDirectSignPlan({
      ...attestationBase,
      fee_amount_uzrn: "44443",
      gas_limit: "44443",
    })).toThrow(/per-message requirement 44444/i);
    const attestationPlan = createZeroneDirectSignPlan({
      ...attestationBase,
      fee_amount_uzrn: "44444",
      gas_limit: "44444",
    });
    expect(attestationPlan.required_gas_limit).toBe("44444");
  });

  test("pins bond, declared spend, module target, and exact wallet method", async () => {
    const { intent } = await walletIntent("attestation");
    const cases = [
      await resealIntent(intent, (core) => ({
        ...core,
        declared_spends: [{
          asset_id: core.declared_spends[0]?.asset_id ?? "",
          amount_atomic: "999999",
        }],
      })),
      await resealIntent(intent, (core) => ({
        ...core,
        calls: core.calls.map((call) => ({
          ...call,
          native_value: call.native_value === null
            ? null
            : { ...call.native_value, amount_atomic: "1000001" },
        })),
        declared_spends: [{
          asset_id: core.declared_spends[0]?.asset_id ?? "",
          amount_atomic: "1000001",
        }],
      })),
      await resealIntent(intent, (core) => ({
        ...core,
        calls: core.calls.map((call) => ({
          ...call,
          target_account: RECIPIENT_ACCOUNT,
        })),
      })),
      await resealIntent(intent, (core) => ({
        ...core,
        calls: core.calls.map((call) => ({
          ...call,
          method: "zerone.substrate_bridge.v1.MsgDifferent",
        })),
      })),
    ];
    const messages = [
      /declared_spends/i,
      /payload bond and native_value differ/i,
      /module account/i,
      /Only MsgSend transfers/i,
    ];
    for (const [index, changed] of cases.entries()) {
      expect(() => createZeroneDirectSignPlan({
        intent: changed,
        network: "testnet",
        signer_public_key: SECP_PUBLIC_KEY,
        account_observation: accountObservation(),
        fee_amount_uzrn: "222222",
        gas_limit: "222222",
        adapter_snapshot: ADAPTER_SNAPSHOT,
      })).toThrow(messages[index]);
    }

    const { plan } = await planFor("attestation");
    expect(plan.simulation_effects).toEqual([
      {
        action: "call",
        target_account:
          "cosmos:zerone-testnet-1:zrn17s8zugqf6tja9srze24jl94a2k6scz4qx2gswf",
        method: ZERONE_WALLET_METHOD_SUBMIT_EXTERNAL_ATTESTATION,
        asset_id: null,
        amount_atomic: "0",
      },
      {
        action: "transfer",
        target_account:
          "cosmos:zerone-testnet-1:zrn17s8zugqf6tja9srze24jl94a2k6scz4qx2gswf",
        method: null,
        asset_id: "cosmos:zerone-testnet-1/denom:uzrn",
        amount_atomic: "1000000",
      },
    ]);
  });

  test("requires an active, compatible, sufficiently recent adapter snapshot", async () => {
    const snapshots = [
      { ...ADAPTER_SNAPSHOT, status: "suspended" as const },
      { ...ADAPTER_SNAPSHOT, allowed_work_class_ids: ["other.class"] },
      {
        ...ADAPTER_SNAPSHOT,
        required_qualification_domain: "qualified.agent",
      },
      {
        ...ADAPTER_SNAPSHOT,
        allowed_work_class_ids: [
          "agenttool.invocation",
          "agenttool.invocation",
        ],
      },
      { ...ADAPTER_SNAPSHOT, min_attestation_bond_uzrn: "1000001" },
      { ...ADAPTER_SNAPSHOT, observed_at_height: "699998" },
    ];
    const messages = [
      /not active/i,
      /does not allow/i,
      /qualification proofs/i,
      /must not contain duplicates/i,
      /below.*minimum/i,
      /newer than.*snapshot/i,
    ];
    for (const [index, snapshot] of snapshots.entries()) {
      await expect(planFor("attestation", {
        adapter_snapshot: snapshot,
      })).rejects.toThrow(messages[index]);
    }
    const { bundle } = await planFor("attestation");
    expect(() => createZeroneDirectSignPlan({
      intent: bundle.intent,
      network: "testnet",
      signer_public_key: SECP_PUBLIC_KEY,
      account_observation: accountObservation(),
      fee_amount_uzrn: "222222",
      gas_limit: "222222",
    })).toThrow(/requires.*active adapter snapshot/i);
  });
});
