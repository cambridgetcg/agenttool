import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  sha256Id,
  sha256BytesId,
  signingDigest,
  type SignedPayload,
} from "@agenttool/wallet";
import {
  MESSAGE_TYPE_URLS,
  decodeCreateBountyOrderValue,
  encodeCreateBountyOrderValue,
} from "@agenttool/zerone-agent-economy";

import {
  ECONOMY_SIMULATION_EVIDENCE_SIGNING_DOMAIN,
  createZeroneEconomySimulationEvidence,
  createZeroneEconomyDirectSignPlan,
  createZeroneEconomySignedPayload,
  createZeroneEconomySigningRequest,
  createZeroneEconomySimulationBinding,
  decodeEconomyAny,
  createZeroneEconomySimulationReceiptCore,
  decodeEconomyAuthInfo,
  decodeEconomySignDoc,
  decodeEconomyTxBody,
  decodeEconomyTxRaw,
  encodeEconomyAny,
  encodeEconomyAuthInfo,
  encodeEconomyTxBody,
  encodeEconomyTxRaw,
  getZeroneEconomyModuleAccounts,
  verifyZeroneEconomySignedPayload,
  verifyZeroneEconomySimulationEvidence,
} from "../src/index.js";
import {
  ACTIVATION_OBSERVATION,
  OTHER_ACCOUNT,
  OTHER_ADDRESS,
  SECP_PRIVATE_KEY,
  SECP_PUBLIC_KEY,
  SIMULATION_BLOCK_HASH,
  SOURCE_ACCOUNT,
  accountObservation,
  authorizedPlan,
  defaultProjections,
  owner,
  planFor,
  profile,
  projectionFromBytes,
  simulationAdapter,
  vector,
  walletBundle,
} from "./fixtures.js";

async function signedEvidenceMutation(
  evidence: Awaited<ReturnType<typeof authorizedPlan>>["evidence"],
  changes: Readonly<Record<string, unknown>>,
  authority = simulationAdapter,
): Promise<unknown> {
  const {
    content_id: _contentId,
    record_id: _recordId,
    signature: _signature,
    ...originalContent
  } = structuredClone(evidence);
  const content = { ...originalContent, ...changes };
  const core = { ...content, content_id: sha256Id(content) };
  const signature = {
    algorithm: "Ed25519" as const,
    value: await authority.signer.sign_digest(signingDigest(
      ECONOMY_SIMULATION_EVIDENCE_SIGNING_DOMAIN,
      core,
    )),
  };
  return {
    ...core,
    record_id: sha256Id({ ...core, signature }),
    signature,
  };
}

function highSSignature(signature: Uint8Array): Uint8Array {
  const output = Uint8Array.from(signature);
  let lowS = 0n;
  for (const octet of output.subarray(32)) lowS = (lowS << 8n) | BigInt(octet);
  let highS = secp256k1.Point.Fn.ORDER - lowS;
  for (let index = 63; index >= 32; index -= 1) {
    output[index] = Number(highS & 0xffn);
    highS >>= 8n;
  }
  return output;
}

function signedPayloadFor(
  request: Awaited<ReturnType<typeof authorizedPlan>>["request"],
  bytes: Uint8Array,
): SignedPayload {
  return {
    request_id: request.request_id,
    signer_key_id: request.signer_key_id,
    unsigned_payload_hash: request.unsigned_payload_hash,
    signed_payload_b64u: base64UrlEncode(bytes),
    signed_payload_hash: sha256BytesId(bytes),
    operation_id: null,
  };
}

describe("economy actor, module, order, and spend binding", () => {
  test("derives escrow/review spend and leaves Fulfill fee-only", async () => {
    const { plan } = await planFor();
    expect(plan.total_reserved_spend_uzrn).toBe("600000");
    expect(plan.economic_effects).toEqual([
      {
        message_index: 0,
        kind: "escrow_lock",
        module: "sponsorship",
        direction: "outgoing",
        asset_id: profile.native_asset_id,
        amount_atomic: "500000",
        condition: "message_success",
      },
      {
        message_index: 1,
        kind: "review_fee",
        module: "knowledge",
        direction: "outgoing",
        asset_id: profile.native_asset_id,
        amount_atomic: "100000",
        condition: "message_success",
      },
      {
        message_index: 2,
        kind: "fulfillment_request",
        module: "sponsorship",
        direction: "conditional_incoming",
        asset_id: profile.native_asset_id,
        amount_atomic: null,
        condition: "keeper_state_and_message_success",
      },
    ]);

    const fulfill = defaultProjections()[2]!;
    const bundle = await walletBundle({
      projections: [fulfill],
      declared_spends: [],
    });
    const feeOnly = await planFor({
      bundle,
      plan_overrides: {
        gas_limit: "22222",
        fee_amount_uzrn: "22222",
      },
    });
    expect(feeOnly.plan.total_reserved_spend_uzrn).toBe("0");
    expect(feeOnly.plan.simulation_effects).toHaveLength(1);
    expect(feeOnly.plan.simulation_effects[0]?.action).toBe("call");
  });

  test("rejects reordered and duplicated projections", async () => {
    const projections = defaultProjections();
    const reordered = [projections[1]!, projections[0]!, projections[2]!];
    const reorderedBundle = await walletBundle({ projections: reordered });
    await expect(planFor({ bundle: reorderedBundle })).rejects.toThrow(/unique.*order/i);

    const duplicated = [projections[0]!, projections[0]!, projections[2]!];
    const duplicatedBundle = await walletBundle({ projections: duplicated });
    await expect(planFor({ bundle: duplicatedBundle })).rejects.toThrow(/unique.*order/i);
  });

  test("rejects actor and module-target substitution", async () => {
    const honest = await walletBundle();
    const metadataOnly = honest.projections.map((projection, index) => (
      index === 0
        ? {
            ...projection,
            value: { ...projection.value, sponsor: OTHER_ADDRESS },
          }
        : projection
    )) as typeof honest.projections;
    await expect(planFor({
      bundle: Object.freeze({ ...honest, projections: metadataOnly }),
    })).rejects.toThrow(/value does not match decoded canonical protobuf bytes/i);

    const createBytes = base64UrlDecode(vector.messages.create_bounty.value_b64u);
    const create = decodeCreateBountyOrderValue(createBytes);
    const actorChanged = encodeCreateBountyOrderValue({
      ...create,
      sponsor: OTHER_ADDRESS,
    });
    const changedProjection = projectionFromBytes({
      type_url: MESSAGE_TYPE_URLS.create_bounty,
      value_bytes: actorChanged,
    });
    await expect(planFor({
      bundle: Object.freeze({
        ...honest,
        projections: [changedProjection, ...honest.projections.slice(1)],
      }),
    })).rejects.toThrow(/decoded actor/i);

    const modules = getZeroneEconomyModuleAccounts("testnet");
    const wrongCalls = honest.intent.calls.map((call, index) => (
      index === 0 ? { ...call, target_account: modules.knowledge } : call
    ));
    const wrongTarget = await walletBundle({ calls: wrongCalls });
    await expect(planFor({ bundle: wrongTarget })).rejects.toThrow(/module.*method.*payload.*spend/i);

    const wrongValueCalls = honest.intent.calls.map((call, index) => (
      index === 0 && call.native_value !== null
        ? {
            ...call,
            native_value: { ...call.native_value, amount_atomic: "1" },
          }
        : call
    ));
    const wrongValue = await walletBundle({ calls: wrongValueCalls });
    await expect(planFor({ bundle: wrongValue })).rejects.toThrow(/module.*method.*payload.*spend/i);
  });

  test("rejects noncanonical and unknown protobuf fields", async () => {
    const base = defaultProjections();
    const original = base[0]!;
    const value = original.value;
    const bytes = base64UrlDecode(original.protobuf_value_b64u);
    const unknownField = Uint8Array.from([...bytes, 0x98, 0x06, 0x01]);
    const unknownProjection = projectionFromBytes({
      type_url: original.type_url,
      value_bytes: unknownField,
      value,
    });
    const bundle = await walletBundle();
    await expect(planFor({
      bundle: Object.freeze({
        ...bundle,
        projections: [unknownProjection, ...bundle.projections.slice(1)],
      }),
    })).rejects.toThrow(/unsupported protobuf fields|missing.*reordered/i);

    const nonminimalTag = Uint8Array.from([0x8a, 0x00, ...bytes.slice(1)]);
    const noncanonicalProjection = projectionFromBytes({
      type_url: original.type_url,
      value_bytes: nonminimalTag,
      value,
    });
    await expect(planFor({
      bundle: Object.freeze({
        ...bundle,
        projections: [noncanonicalProjection, ...bundle.projections.slice(1)],
      }),
    })).rejects.toThrow(/canonical protobuf varint|not minimally encoded/i);

    const { plan } = await planFor();
    const appendUnknown = (valueBytes: Uint8Array): Uint8Array => Uint8Array.from([
      ...valueBytes,
      0x98,
      0x06,
      0x01,
    ]);
    const first = plan.messages[0]!;
    expect(() => decodeEconomyAny(appendUnknown(encodeEconomyAny({
      typeUrl: first.type_url,
      value: base64UrlDecode(first.value_b64u),
    })), "any")).toThrow(/unsupported|reordered|canonical/i);
    expect(() => decodeEconomyTxBody(appendUnknown(
      base64UrlDecode(plan.body_bytes_b64u),
    ))).toThrow(/unsupported|count|canonical/i);
    expect(() => decodeEconomyAuthInfo(appendUnknown(
      base64UrlDecode(plan.auth_info_bytes_b64u),
    ))).toThrow(/unsupported|reordered|canonical/i);
    expect(() => decodeEconomySignDoc(appendUnknown(
      base64UrlDecode(plan.sign_doc_bytes_b64u),
    ))).toThrow(/unsupported|reordered|canonical/i);
    expect(() => decodeEconomyTxRaw(appendUnknown(
      base64UrlDecode(plan.simulation_tx_bytes_b64u),
    ))).toThrow(/unsupported|reordered|canonical/i);
    expect(() => decodeEconomyTxBody(Uint8Array.from([
      0x8a,
      0x00,
      ...base64UrlDecode(plan.body_bytes_b64u).slice(1),
    ]))).toThrow(/minimally encoded/i);
  });

  test("rejects product and uint64 overflow before intent metadata can matter", async () => {
    const original = decodeCreateBountyOrderValue(
      base64UrlDecode(vector.messages.create_bounty.value_b64u),
    );
    const overflowing = encodeCreateBountyOrderValue({
      ...original,
      price_per_artifact: ((1n << 256n) - 1n).toString(),
      target_count: 2,
    });
    const projection = projectionFromBytes({
      type_url: MESSAGE_TYPE_URLS.create_bounty,
      value_bytes: overflowing,
    });
    const bundle = await walletBundle();
    await expect(planFor({
      bundle: Object.freeze({
        ...bundle,
        projections: [projection, ...bundle.projections.slice(1)],
      }),
    })).rejects.toThrow(/overflows.*uint256/i);

    await expect(planFor({
      plan_overrides: {
        activation_observation: {
          ...ACTIVATION_OBSERVATION,
          observed_at_height: (1n << 64n).toString(),
        },
      },
    })).rejects.toThrow(/uint64/i);
  });
});

describe("activation, account, gas, simulation, and signature binding", () => {
  test("rejects under-gas, under-fee, chain, commit, and account drift", async () => {
    await expect(planFor({
      plan_overrides: { gas_limit: "144443" },
    })).rejects.toThrow(/below.*requirement/i);
    await expect(planFor({
      plan_overrides: { fee_amount_uzrn: "144443" },
    })).rejects.toThrow(/below.*minimum/i);
    await expect(planFor({
      plan_overrides: {
        activation_observation: {
          ...ACTIVATION_OBSERVATION,
          chain_id: "cosmos:zerone-1",
        },
      },
    })).rejects.toThrow(/exact reviewed source commit.*chain/i);
    await expect(planFor({
      plan_overrides: {
        activation_observation: {
          ...ACTIVATION_OBSERVATION,
          zerone_core_commit: "f".repeat(40),
        },
      },
    })).rejects.toThrow(/exact reviewed source commit/i);
    for (const activation_observation of [
      { ...ACTIVATION_OBSERVATION, cosmos_sdk: "v0.53.9" },
      {
        ...ACTIVATION_OBSERVATION,
        sponsorship_consensus_version: 3,
      },
      {
        ...ACTIVATION_OBSERVATION,
        knowledge_consensus_version: 8,
      },
    ]) {
      await expect(planFor({
        plan_overrides: { activation_observation: activation_observation as never },
      })).rejects.toThrow(/exact reviewed source commit.*module versions/i);
    }
    await expect(planFor({
      plan_overrides: {
        account_observation: accountObservation({
          account: OTHER_ACCOUNT,
        }),
      },
    })).rejects.toThrow(/exact Wallet intent source/i);
    await expect(planFor({
      plan_overrides: {
        account_observation: accountObservation({
          public_key_type_url: "/cosmos.crypto.secp256k1.PubKey",
          public_key_b64u: base64UrlEncode(
            secp256k1.getPublicKey(Uint8Array.from(SECP_PRIVATE_KEY, (value, index) => (
              index === 31 ? 2 : value
            )), true),
          ),
        }),
      },
    })).rejects.toThrow(/different registered public key/i);
    for (const drift of [
      { account_number: (1n << 64n).toString() },
      { sequence: (1n << 64n).toString() },
    ]) {
      await expect(planFor({
        plan_overrides: {
          account_observation: accountObservation(drift),
        },
      })).rejects.toThrow(/uint64/i);
    }
    await expect(authorizedPlan({
      plan_overrides: {
        account_observation: accountObservation({
          observed_at_height: "700002",
        }),
      },
    })).rejects.toThrow(/after activation and account observations/i);
  });

  test("rejects the exact receipt-A plus fabricated-result-B sequence substitution", async () => {
    const a = await authorizedPlan();
    expect(() => createZeroneEconomySimulationBinding({
      plan: a.plan,
      simulation: a.simulation,
      simulation_result: a.simulationResult,
    } as never)).toThrow(/created or reload-verified/i);

    const b = await planFor({
      bundle: a.bundle,
      plan_overrides: {
        account_observation: accountObservation({ sequence: "10" }),
      },
    });
    const fabricatedResultB = {
      ...a.simulationResult,
      simulation_tx_bytes_hash: b.plan.simulation_tx_bytes_hash,
    };
    expect(fabricatedResultB.simulation_tx_bytes_hash).not.toBe(
      a.simulationResult.simulation_tx_bytes_hash,
    );
    expect(() => createZeroneEconomySimulationBinding({
      plan: b.plan,
      simulation: a.simulation,
      simulation_result: fabricatedResultB,
    } as never)).toThrow(/created or reload-verified/i);
    expect(() => createZeroneEconomySimulationBinding({
      plan: b.plan,
      simulation: a.simulation,
      evidence: a.evidence,
    })).toThrow(/exact planned TxRaw/i);
    const unverifiedForgedEvidence = {
      ...structuredClone(a.evidence),
      plan_id: b.plan.plan_id,
      simulation_tx_bytes_hash: b.plan.simulation_tx_bytes_hash,
    };
    let evidenceReads = 0;
    expect(() => createZeroneEconomySimulationBinding({
      plan: b.plan,
      simulation: a.simulation,
      get evidence() {
        evidenceReads += 1;
        return evidenceReads === 1 ? a.evidence : unverifiedForgedEvidence;
      },
    } as never)).toThrow(/exact planned TxRaw/i);
    expect(evidenceReads).toBe(1);

    expect(() => createZeroneEconomySigningRequest({
      plan: a.plan,
      simulation: a.simulation,
      binding: { ...a.binding },
      authorization: a.authorization,
      request_id: "88888888-8888-4888-8888-888888888888",
      requested_at: a.authorization.checked_at,
    })).toThrow(/exact activation-bound plan/i);
    expect(b.plan.sign_doc_bytes_hash).not.toBe(a.plan.sign_doc_bytes_hash);
    expect(() => createZeroneEconomySigningRequest({
      plan: b.plan,
      simulation: a.simulation,
      binding: a.binding,
      authorization: a.authorization,
      request_id: "99999999-9999-4999-8999-999999999999",
      requested_at: a.authorization.checked_at,
    })).toThrow(/exact activation-bound plan/i);
  });

  test("requires and snapshots one canonical observed block hash in the receipt core", async () => {
    const a = await authorizedPlan();
    const receiptInput = {
      plan: a.plan,
      simulation: a.simulationResult,
      intent: a.bundle.intent,
      adapter: simulationAdapter.key,
      simulation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      block_hash: SIMULATION_BLOCK_HASH,
      simulated_at: "2026-08-20T18:02:30.000Z",
      valid_until: "2026-08-20T18:05:30.000Z",
    } as const;
    expect(createZeroneEconomySimulationReceiptCore(receiptInput).block_hash)
      .toBe(SIMULATION_BLOCK_HASH);

    for (const blockHash of [
      null,
      undefined,
      "",
      "A".repeat(63),
      "A".repeat(65),
      "a".repeat(64),
      `0x${"A".repeat(64)}`,
      `${"A".repeat(63)}G`,
    ]) {
      expect(() => createZeroneEconomySimulationReceiptCore({
        ...receiptInput,
        block_hash: blockHash,
      } as never)).toThrow(/64 uppercase hexadecimal characters/i);
    }

    let reads = 0;
    const snapshotted = createZeroneEconomySimulationReceiptCore({
      ...receiptInput,
      get block_hash() {
        reads += 1;
        return reads === 1 ? SIMULATION_BLOCK_HASH : null;
      },
    } as never);
    expect(reads).toBe(1);
    expect(snapshotted.block_hash).toBe(SIMULATION_BLOCK_HASH);
  });

  test("requires strict adapter-signed evidence and rejects key, field, and timestamp tamper", async () => {
    const a = await authorizedPlan();
    await expect(createZeroneEconomySimulationEvidence({
      plan: a.plan,
      simulation: a.simulation,
      simulation_result: a.simulationResult,
      signer: owner.signer,
    })).rejects.toThrow(/exact adapter authority/i);

    const noncanonicalBlockHash = await signedEvidenceMutation(a.evidence, {
      block_hash: "a".repeat(64),
    });
    expect(() => verifyZeroneEconomySimulationEvidence(noncanonicalBlockHash))
      .toThrow(/64 uppercase hexadecimal characters/i);

    const legacyNullBlockHash = verifyZeroneEconomySimulationEvidence(
      await signedEvidenceMutation(a.evidence, { block_hash: null }),
    );
    expect(legacyNullBlockHash.block_hash).toBeNull();
    expect(() => createZeroneEconomySimulationBinding({
      plan: a.plan,
      simulation: a.simulation,
      evidence: legacyNullBlockHash,
    })).toThrow(/every exact plan and Wallet receipt field/i);

    const {
      record_id: _recordId,
      signature: originalSignature,
      ...core
    } = structuredClone(a.evidence);
    const replacement = originalSignature.value[0] === "A" ? "B" : "A";
    const signature = {
      ...originalSignature,
      value: replacement + originalSignature.value.slice(1),
    };
    expect(() => verifyZeroneEconomySimulationEvidence({
      ...core,
      record_id: sha256Id({ ...core, signature }),
      signature,
    })).toThrow(/invalid strict Ed25519 signature/i);

    const wrongAuthority = verifyZeroneEconomySimulationEvidence(
      await signedEvidenceMutation(a.evidence, { adapter: owner.key }, owner),
    );
    expect(() => createZeroneEconomySimulationBinding({
      plan: a.plan,
      simulation: a.simulation,
      evidence: wrongAuthority,
    })).toThrow(/every exact plan and Wallet receipt field/i);

    const alteredPlan = verifyZeroneEconomySimulationEvidence(
      await signedEvidenceMutation(a.evidence, {
        plan_id: `sha256:${"f".repeat(64)}`,
      }),
    );
    expect(() => createZeroneEconomySimulationBinding({
      plan: a.plan,
      simulation: a.simulation,
      evidence: alteredPlan,
    })).toThrow(/every exact plan and Wallet receipt field/i);

    const alteredBlock = verifyZeroneEconomySimulationEvidence(
      await signedEvidenceMutation(a.evidence, {
        block_ref: "zerone-testnet-1:700002",
      }),
    );
    expect(() => createZeroneEconomySimulationBinding({
      plan: a.plan,
      simulation: a.simulation,
      evidence: alteredBlock,
    })).toThrow(/every exact plan and Wallet receipt field/i);

    const alteredTimestamp = verifyZeroneEconomySimulationEvidence(
      await signedEvidenceMutation(a.evidence, {
        simulated_at: "2026-08-20T18:02:31.000Z",
      }),
    );
    expect(() => createZeroneEconomySimulationBinding({
      plan: a.plan,
      simulation: a.simulation,
      evidence: alteredTimestamp,
    })).toThrow(/every exact plan and Wallet receipt field/i);

    const invalidLifetime = structuredClone(a.evidence) as Record<string, unknown>;
    invalidLifetime.valid_until = invalidLifetime.simulated_at;
    expect(() => verifyZeroneEconomySimulationEvidence(invalidLifetime))
      .toThrow(/lifetime must be positive/i);
  });

  test("reload-verifies canonical evidence before restoring its runtime brand", async () => {
    const a = await authorizedPlan();
    const reloadedValue = JSON.parse(JSON.stringify(a.evidence)) as unknown;
    expect(() => createZeroneEconomySimulationBinding({
      plan: a.plan,
      simulation: a.simulation,
      evidence: reloadedValue as never,
    })).toThrow(/created or reload-verified/i);

    const reloaded = verifyZeroneEconomySimulationEvidence(reloadedValue);
    expect(reloaded).toEqual(a.evidence);
    const rebound = createZeroneEconomySimulationBinding({
      plan: a.plan,
      simulation: a.simulation,
      evidence: reloaded,
    });
    expect(rebound.simulation_evidence_content_id).toBe(a.evidence.content_id);
    expect(rebound.simulation_evidence_record_id).toBe(a.evidence.record_id);

    const fieldTamper = structuredClone(a.evidence) as Record<string, unknown>;
    fieldTamper.gas_used = "1";
    expect(() => verifyZeroneEconomySimulationEvidence(fieldTamper))
      .toThrow(/content_id does not match/i);
  });

  test("binds signing-request time to authorization and the evidence window", async () => {
    const a = await authorizedPlan();
    for (const [requestedAt, pattern] of [
      ["2026-08-20T18:02:29.000Z", /inside the signed simulation evidence window/i],
      ["2026-08-20T18:05:30.000Z", /inside the signed simulation evidence window/i],
      ["2026-08-20T18:03:00Z", /canonical timestamp|milliseconds/i],
    ] as const) {
      expect(() => createZeroneEconomySigningRequest({
        plan: a.plan,
        simulation: a.simulation,
        binding: a.binding,
        authorization: a.authorization,
        request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        requested_at: requestedAt,
      })).toThrow(pattern);
    }
  });

  test("rejects high-S signatures and prehash confusion", async () => {
    const { plan, request } = await authorizedPlan();
    const lowS = secp256k1.sign(
      base64UrlDecode(plan.sign_doc_bytes_b64u),
      SECP_PRIVATE_KEY,
      { prehash: true, lowS: true, format: "compact" },
    );
    expect(() => createZeroneEconomySignedPayload({
      plan,
      request,
      signature: highSSignature(lowS),
    })).toThrow(/high-S|malleable|wrong prehash/i);
    const noPrehash = secp256k1.sign(
      base64UrlDecode(plan.sign_doc_bytes_b64u),
      SECP_PRIVATE_KEY,
      { prehash: false, lowS: true, format: "compact" },
    );
    expect(() => createZeroneEconomySignedPayload({
      plan,
      request,
      signature: noPrehash,
    })).toThrow(/prehash/i);
  });

  test("rejects TxBody/AuthInfo and request substitution", async () => {
    const a = await authorizedPlan();
    const signature = base64UrlDecode(vector.direct_sign.signature_b64u);
    const reversedMessages = [...a.plan.messages].reverse().map((message) => ({
      typeUrl: message.type_url,
      value: base64UrlDecode(message.value_b64u),
    }));
    const changedBody = encodeEconomyTxBody(reversedMessages);
    const changedBodyTx = encodeEconomyTxRaw(
      changedBody,
      base64UrlDecode(a.plan.auth_info_bytes_b64u),
      signature,
    );
    expect(() => verifyZeroneEconomySignedPayload({
      plan: a.plan,
      request: a.request,
      payload: signedPayloadFor(a.request, changedBodyTx),
    })).toThrow(/exact planned TxBody/i);

    const changedAuth = encodeEconomyAuthInfo(
      SECP_PUBLIC_KEY,
      10n,
      a.plan.fee,
      BigInt(a.plan.gas_limit),
    );
    const changedAuthTx = encodeEconomyTxRaw(
      base64UrlDecode(a.plan.body_bytes_b64u),
      changedAuth,
      signature,
    );
    expect(() => verifyZeroneEconomySignedPayload({
      plan: a.plan,
      request: a.request,
      payload: signedPayloadFor(a.request, changedAuthTx),
    })).toThrow(/exact planned TxBody and AuthInfo/i);

    const b = await authorizedPlan({
      plan_overrides: {
        account_observation: accountObservation({ sequence: "10" }),
      },
    });
    expect(() => createZeroneEconomySignedPayload({
      plan: a.plan,
      request: b.request,
      signature,
    })).toThrow(/exact simulation-bound economy plan/i);
  });
});
