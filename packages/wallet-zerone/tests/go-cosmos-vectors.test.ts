import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
} from "@agenttool/wallet";

import {
  AGENTTOOL_ADAPTER_ID,
  AGENTTOOL_WORK_CLASS_ID,
  ZERONE_CORE_COMMIT,
  computeAgentToolInvocationContentHash,
  computeZeroneWitnessLinkHash,
  createAgentToolInvocationWitnessLink,
  encodeAgentToolInvocationProjection,
  encodeZeroneMsgSend,
} from "../src/index.js";
import {
  INVOCATION,
  RECIPIENT_ADDRESS,
  SECP_PRIVATE_KEY,
  SECP_PUBLIC_KEY,
  SOURCE_ADDRESS,
  attestationPayload,
  planFor,
  signedTransaction,
} from "./fixtures.js";

interface GoCosmosVector {
  readonly schema: string;
  readonly provenance: {
    readonly generator: string;
    readonly zerone_core_commit: string;
    readonly cosmos_sdk: string;
  };
  readonly profile: {
    readonly chain_reference: string;
    readonly account_number: string;
    readonly sequence: string;
    readonly gas_limit: string;
    readonly fee_amount_uzrn: string;
    readonly source_address: string;
    readonly recipient_address: string;
    readonly public_key_b64u: string;
  };
  readonly invocation: {
    readonly projection: typeof INVOCATION;
    readonly canonical_bytes_b64u: string;
    readonly content_hash_hex: string;
    readonly link_hash_hex: string;
    readonly attestation_value_b64u: string;
    readonly msg_send_value_b64u: string;
  };
  readonly direct_sign: {
    readonly body_bytes_b64u: string;
    readonly auth_info_bytes_b64u: string;
    readonly sign_doc_bytes_b64u: string;
    readonly simulation_tx_bytes_b64u: string;
    readonly signature_b64u: string;
    readonly signed_tx_bytes_b64u: string;
    readonly tx_hash: string;
  };
  readonly verified: Record<string, boolean>;
}

const vector = await Bun.file(
  new URL(
    "../vectors/agent-wallet-zerone-v0.1-vectors.json",
    import.meta.url,
  ),
).json() as GoCosmosVector;

function topLevelLengthDelimitedFields(
  bytes: Uint8Array,
): readonly Readonly<{ number: number; value: Uint8Array }>[] {
  const fields: Array<Readonly<{ number: number; value: Uint8Array }>> = [];
  let offset = 0;
  const readVarint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    while (offset < bytes.byteLength) {
      const octet = bytes[offset];
      if (octet === undefined) throw new Error("truncated varint");
      offset += 1;
      result |= BigInt(octet & 0x7f) << shift;
      if ((octet & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new Error("truncated varint");
  };
  while (offset < bytes.byteLength) {
    const tag = readVarint();
    if ((tag & 7n) !== 2n) throw new Error("unexpected wire type");
    const size = Number(readVarint());
    const end = offset + size;
    if (!Number.isSafeInteger(size) || end > bytes.byteLength) {
      throw new Error("invalid length");
    }
    fields.push(Object.freeze({
      number: Number(tag >> 3n),
      value: bytes.slice(offset, end),
    }));
    offset = end;
  }
  return fields;
}

describe("independent Zerone Go/Cosmos vectors", () => {
  test("pins live IDs and generator provenance", () => {
    expect(vector.schema).toBe("agent-wallet-zerone.go-cosmos-vectors/0.1");
    expect(vector.provenance.zerone_core_commit).toBe(ZERONE_CORE_COMMIT);
    expect(vector.provenance.cosmos_sdk).toBe("v0.50.15");
    expect(vector.provenance.generator).toBe(
      "packages/wallet-zerone/scripts/go-cosmos-fixture/main.go",
    );
    expect(AGENTTOOL_ADAPTER_ID).toBe("agenttool-invocation-v1");
    expect(AGENTTOOL_WORK_CLASS_ID).toBe("agenttool.invocation");
    expect(Object.values(vector.verified).every(Boolean)).toBe(true);
  });

  test("matches Go canonical JSON, keeper link hash, and generated messages", () => {
    expect(vector.invocation.projection).toEqual(INVOCATION);
    expect(base64UrlEncode(
      encodeAgentToolInvocationProjection(INVOCATION),
    )).toBe(vector.invocation.canonical_bytes_b64u);
    expect(bytesToHex(
      computeAgentToolInvocationContentHash(INVOCATION),
    )).toBe(vector.invocation.content_hash_hex);
    const link = createAgentToolInvocationWitnessLink({
      invocation: INVOCATION,
      source_id: INVOCATION.id,
      source_url:
        `https://api.agenttool.dev/v1/invocations/${INVOCATION.id}`,
      fetched_at_block: "699999",
    });
    expect(bytesToHex(computeZeroneWitnessLinkHash(link))).toBe(
      vector.invocation.link_hash_hex,
    );
    expect(base64UrlEncode(attestationPayload())).toBe(
      vector.invocation.attestation_value_b64u,
    );
    expect(base64UrlEncode(encodeZeroneMsgSend({
      from_address: SOURCE_ADDRESS,
      to_address: RECIPIENT_ADDRESS,
      amount: [{ denom: "uzrn", amount: "123456" }],
    }))).toBe(vector.invocation.msg_send_value_b64u);
  });

  test("matches Cosmos TxBody, AuthInfo, SignDoc, simulation TxRaw and signature", async () => {
    const { plan } = await planFor("attestation");
    expect(SOURCE_ADDRESS).toBe(vector.profile.source_address);
    expect(RECIPIENT_ADDRESS).toBe(vector.profile.recipient_address);
    expect(base64UrlEncode(SECP_PUBLIC_KEY)).toBe(
      vector.profile.public_key_b64u,
    );
    expect(plan.account_number).toBe(vector.profile.account_number);
    expect(plan.sequence).toBe(vector.profile.sequence);
    expect(plan.gas_limit).toBe(vector.profile.gas_limit);
    expect(plan.fee.amount).toBe(vector.profile.fee_amount_uzrn);
    expect(plan.body_bytes_b64u).toBe(vector.direct_sign.body_bytes_b64u);
    expect(plan.auth_info_bytes_b64u).toBe(
      vector.direct_sign.auth_info_bytes_b64u,
    );
    expect(plan.sign_doc_bytes_b64u).toBe(
      vector.direct_sign.sign_doc_bytes_b64u,
    );
    expect(plan.simulation_tx_bytes_b64u).toBe(
      vector.direct_sign.simulation_tx_bytes_b64u,
    );
    const signature = secp256k1.sign(
      base64UrlDecode(plan.sign_doc_bytes_b64u),
      SECP_PRIVATE_KEY,
      { prehash: true, lowS: true, format: "compact" },
    );
    expect(base64UrlEncode(signature)).toBe(
      vector.direct_sign.signature_b64u,
    );
  });

  test("contains exactly one empty simulation signature", () => {
    const fields = topLevelLengthDelimitedFields(
      base64UrlDecode(vector.direct_sign.simulation_tx_bytes_b64u),
    );
    expect(fields.map(({ number }) => number)).toEqual([1, 2, 3]);
    const signatures = fields.filter(({ number }) => number === 3);
    expect(signatures).toHaveLength(1);
    expect(signatures[0]?.value.byteLength).toBe(0);
  });

  test("matches Cosmos signed TxRaw and uppercase precomputed hash", async () => {
    const { transaction } = await signedTransaction("attestation");
    expect(transaction.tx_bytes_b64u).toBe(
      vector.direct_sign.signed_tx_bytes_b64u,
    );
    expect(transaction.tx_hash).toBe(vector.direct_sign.tx_hash);
    expect(vector.direct_sign.tx_hash).toMatch(/^[0-9A-F]{64}$/u);
  });
});
