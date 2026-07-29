import { describe, expect, test } from "bun:test";
import {
  base64UrlEncode,
  bytesToHex,
  concatBytes,
  equalBytes,
} from "@agenttool/wallet";

import {
  AGENTTOOL_ADAPTER_ID,
  AGENTTOOL_WORK_CLASS_ID,
  computeAgentToolInvocationContentHash,
  computeZeroneWitnessLinkHash,
  createAgentToolInvocationWitnessLink,
  createZeroneWitnessLink,
  decodeZeroneMsgSend,
  decodeZeroneMsgSubmitExternalAttestation,
  encodeAgentToolInvocationProjection,
  encodeZeroneMsgSend,
  encodeZeroneMsgSubmitExternalAttestation,
  type AgentToolInvocationProjection,
  type ZeroneExternalSource,
} from "../src/index.js";
import {
  INVOCATION,
  RECIPIENT_ADDRESS,
  SOURCE_ADDRESS,
  attestationPayload,
} from "./fixtures.js";

const sourceUrl =
  `https://api.agenttool.dev/v1/invocations/${INVOCATION.id}`;

function messageForLink(
  link: ReturnType<typeof createZeroneWitnessLink>,
): Uint8Array {
  return encodeZeroneMsgSubmitExternalAttestation({
    submitter: SOURCE_ADDRESS,
    adapter_id: AGENTTOOL_ADAPTER_ID,
    work_class_id: AGENTTOOL_WORK_CLASS_ID,
    link,
    bond_uzrn: "1000000",
  });
}

function wireFields(bytes: Uint8Array): readonly Uint8Array[] {
  const fields: Uint8Array[] = [];
  let offset = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 0;
    while (offset < bytes.byteLength) {
      const octet = bytes[offset];
      if (octet === undefined) throw new Error("truncated varint");
      offset += 1;
      result += (octet & 0x7f) * (2 ** shift);
      if ((octet & 0x80) === 0) return result;
      shift += 7;
    }
    throw new Error("truncated varint");
  };
  while (offset < bytes.byteLength) {
    const start = offset;
    const tag = varint();
    if ((tag & 7) !== 2) throw new Error("unexpected fixture wire type");
    const size = varint();
    offset += size;
    if (offset > bytes.byteLength) throw new Error("truncated field");
    fields.push(bytes.slice(start, offset));
  }
  return fields;
}

describe("AgentTool invocation witness boundary", () => {
  test("accepts only released, completed, settled invocation projections", () => {
    expect(() => createAgentToolInvocationWitnessLink({
      invocation: INVOCATION,
      source_id: INVOCATION.id,
      source_url: sourceUrl,
      fetched_at_block: "699999",
    })).not.toThrow();

    const rejected: readonly AgentToolInvocationProjection[] = [
      { ...INVOCATION, status: "escrowed" },
      { ...INVOCATION, status: "refunded" },
      { ...INVOCATION, completion_sig: null },
      { ...INVOCATION, completion_sig: "" },
      { ...INVOCATION, settled_at: null },
      { ...INVOCATION, settled_at: "" },
    ];
    for (const invocation of rejected) {
      expect(() => createAgentToolInvocationWitnessLink({
        invocation,
        source_id: invocation.id,
        source_url: sourceUrl,
        fetched_at_block: "699999",
      })).toThrow(/released.*completion_sig.*settled_at/i);
    }
  });

  test("binds source_id to the exact projected invocation id", () => {
    expect(() => createAgentToolInvocationWitnessLink({
      invocation: INVOCATION,
      source_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source_url:
        "https://api.agenttool.dev/v1/invocations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      fetched_at_block: "699999",
    })).toThrow(/canonical invocation id/i);
  });

  test("matches Go JSON HTML and line-separator escaping", () => {
    const bytes = encodeAgentToolInvocationProjection({
      ...INVOCATION,
      buyer_did: "did:example:<tag>&\u2028\u2029",
    });
    const json = new TextDecoder().decode(bytes);
    expect(json).toContain(
      "did:example:\\u003ctag\\u003e\\u0026\\u2028\\u2029",
    );
    expect(json).not.toContain("<tag>");
  });

  test("rejects noncanonical or over-broad source URLs", () => {
    const invalidUrls = [
      sourceUrl.replace("https:", "http:"),
      sourceUrl.replace("api.agenttool.dev", "user@api.agenttool.dev"),
      `${sourceUrl}?raw=1`,
      `${sourceUrl}#fragment`,
      sourceUrl.replace("/v1/invocations/", "/v1/invocations//"),
      sourceUrl.replace("https://", "https://api.agenttool.dev:443/../"),
    ];
    for (const source_url of invalidUrls) {
      expect(() => createAgentToolInvocationWitnessLink({
        invocation: INVOCATION,
        source_id: INVOCATION.id,
        source_url,
        fetched_at_block: "699999",
      })).toThrow(/source_url|canonical HTTPS/i);
    }
  });

  test("rejects unbound source.adapter_id and non-32-byte hashes", () => {
    const contentHash = computeAgentToolInvocationContentHash(INVOCATION);
    const valid = createZeroneWitnessLink({
      source_id: INVOCATION.id,
      source_url: sourceUrl,
      content_hash: contentHash,
      fetched_at_block: "699999",
    });
    const unboundSource: ZeroneExternalSource = {
      ...valid.source,
      adapter_id: "attacker-controlled" as "",
    };
    expect(() => computeZeroneWitnessLinkHash({
      adapter_id: AGENTTOOL_ADAPTER_ID,
      source: unboundSource,
    })).toThrow(/must stay empty/i);
    expect(() => createZeroneWitnessLink({
      source_id: INVOCATION.id,
      source_url: sourceUrl,
      content_hash: contentHash.slice(0, 31),
      fetched_at_block: "699999",
    })).toThrow(/32 bytes/i);
    expect(() => messageForLink({
      ...valid,
      link_hash: valid.link_hash.slice(0, 31),
    })).toThrow(/32 bytes/i);
  });

  test("keeps unbound URL out of keeper hash but inside signed message bytes", () => {
    const contentHash = computeAgentToolInvocationContentHash(INVOCATION);
    const primary = createZeroneWitnessLink({
      source_id: INVOCATION.id,
      source_url: sourceUrl,
      content_hash: contentHash,
      fetched_at_block: "699999",
    });
    const mirror = createZeroneWitnessLink({
      source_id: INVOCATION.id,
      source_url:
        `https://mirror.agenttool.dev/v1/invocations/${INVOCATION.id}`,
      content_hash: contentHash,
      fetched_at_block: "699999",
    });
    expect(bytesToHex(primary.link_hash)).toBe(bytesToHex(mirror.link_hash));
    expect(equalBytes(messageForLink(primary), messageForLink(mirror))).toBe(
      false,
    );
  });
});

describe("strict supported protobuf subset", () => {
  test("round-trips only canonical MsgSend and attestation bytes", () => {
    const send = encodeZeroneMsgSend({
      from_address: SOURCE_ADDRESS,
      to_address: RECIPIENT_ADDRESS,
      amount: [{ denom: "uzrn", amount: "123456" }],
    });
    expect(base64UrlEncode(encodeZeroneMsgSend(
      decodeZeroneMsgSend(send),
    ))).toBe(base64UrlEncode(send));
    const attestation = attestationPayload();
    expect(base64UrlEncode(encodeZeroneMsgSubmitExternalAttestation(
      decodeZeroneMsgSubmitExternalAttestation(attestation),
    ))).toBe(base64UrlEncode(attestation));
  });

  test("rejects unknown, duplicate, and reordered protobuf fields", () => {
    const send = encodeZeroneMsgSend({
      from_address: SOURCE_ADDRESS,
      to_address: RECIPIENT_ADDRESS,
      amount: [{ denom: "uzrn", amount: "123456" }],
    });
    const parts = wireFields(send);
    expect(parts).toHaveLength(3);
    expect(() => decodeZeroneMsgSend(
      concatBytes(send, Uint8Array.of(0x22, 0x00)),
    )).toThrow(/unsupported|reordered/i);
    expect(() => decodeZeroneMsgSend(
      concatBytes(send, parts[0] ?? new Uint8Array()),
    )).toThrow(/duplicated|reordered/i);
    expect(() => decodeZeroneMsgSend(concatBytes(
      parts[1] ?? new Uint8Array(),
      parts[0] ?? new Uint8Array(),
      parts[2] ?? new Uint8Array(),
    ))).toThrow(/reordered/i);

    const attestation = attestationPayload();
    expect(() => decodeZeroneMsgSubmitExternalAttestation(
      concatBytes(attestation, Uint8Array.of(0x30, 0x00)),
    )).toThrow(/unsupported|reordered/i);
  });
});
