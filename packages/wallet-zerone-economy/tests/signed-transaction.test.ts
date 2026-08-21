import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
  canonicalJsonBytes,
  concatBytes,
  sha256BytesId,
} from "@agenttool/wallet";

import {
  ECONOMY_SIGNED_TRANSACTION_CONTENT_DOMAIN,
  createZeroneEconomySignedPayload,
  createZeroneEconomySignedTransactionRecord,
  decodeEconomyTxRaw,
  encodeEconomyTxRaw,
  verifyZeroneEconomySignedTransactionRecord,
  verifyZeroneEconomySignedPayload,
  type ZeroneEconomySignedTransactionRecord,
} from "../src/index.js";
import {
  authorizedPlan,
  SECP_PRIVATE_KEY,
  signedTransactionRecordFixture,
} from "./fixtures.js";

function recontent(
  value: ZeroneEconomySignedTransactionRecord,
  changes: Record<string, unknown>,
): ZeroneEconomySignedTransactionRecord {
  const { content_id: _priorContentId, ...priorContent } = value;
  const content = { ...priorContent, ...changes };
  return {
    ...content,
    content_id: sha256BytesId(concatBytes(
      new TextEncoder().encode(ECONOMY_SIGNED_TRANSACTION_CONTENT_DOMAIN),
      canonicalJsonBytes(content),
    )),
  } as ZeroneEconomySignedTransactionRecord;
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

function withTxBytes(
  record: ZeroneEconomySignedTransactionRecord,
  bytes: Uint8Array,
): ZeroneEconomySignedTransactionRecord {
  const hash = sha256BytesId(bytes);
  return recontent(record, {
    tx_bytes_b64u: base64UrlEncode(bytes),
    tx_bytes_hash: hash,
    tx_hash: hash.slice("sha256:".length).toUpperCase(),
  });
}

describe("portable Zerone economy signed transaction", () => {
  test("creates and reload-verifies the exact one-message TxRaw without process brands", async () => {
    const { record, transaction } = await signedTransactionRecordFixture();
    const reloaded = verifyZeroneEconomySignedTransactionRecord(
      JSON.parse(canonicalJson(record)),
    );
    expect(reloaded).toEqual(record);
    expect(reloaded.tx_hash).toBe(transaction.tx_hash);
    expect(reloaded.message.kind).toBe("create_bounty");
    expect(reloaded.message.reserved_spend_uzrn).toBe("500000");
    expect(reloaded.economic_effect).toMatchObject({
      direction: "outgoing",
      amount_atomic: "500000",
    });
  });

  test("creation refuses a multi-message plan even when its transaction is valid", async () => {
    const fixture = await authorizedPlan();
    const signature = secp256k1.sign(
      base64UrlDecode(fixture.plan.sign_doc_bytes_b64u),
      SECP_PRIVATE_KEY,
      { prehash: true, lowS: true, format: "compact" },
    );
    const payload = createZeroneEconomySignedPayload({
      plan: fixture.plan,
      request: fixture.request,
      signature,
    });
    const transaction = verifyZeroneEconomySignedPayload({
      plan: fixture.plan,
      request: fixture.request,
      payload,
    });
    expect(() => createZeroneEconomySignedTransactionRecord({
      plan: fixture.plan,
      request: fixture.request,
      transaction,
    })).toThrow(/one-message/i);
  });

  test("rejects rehashed message, key, chain, account, hash, signature, and high-S substitutions", async () => {
    const { record } = await signedTransactionRecordFixture();
    const wrongMessage = recontent(record, {
      message: { ...record.message, actor_address: `zrn1${"q".repeat(38)}` },
    });
    const wrongKey = recontent(record, {
      signer_public_key_b64u: base64UrlEncode(secp256k1.getPublicKey(
        Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 2 : 0),
        true,
      )),
    });
    const wrongChain = recontent(record, { chain_reference: "zerone-1" });
    const wrongAccount = recontent(record, { account_number: "8" });
    const wrongHash = recontent(record, { tx_hash: "A".repeat(64) });
    for (const hostile of [wrongMessage, wrongKey, wrongChain, wrongAccount, wrongHash]) {
      expect(() => verifyZeroneEconomySignedTransactionRecord(hostile)).toThrow();
    }

    const decoded = decodeEconomyTxRaw(base64UrlDecode(record.tx_bytes_b64u));
    const flipped = Uint8Array.from(decoded.signature);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => verifyZeroneEconomySignedTransactionRecord(withTxBytes(
      record,
      encodeEconomyTxRaw(decoded.bodyBytes, decoded.authInfoBytes, flipped),
    ))).toThrow(/signature/i);
    expect(() => verifyZeroneEconomySignedTransactionRecord(withTxBytes(
      record,
      encodeEconomyTxRaw(
        decoded.bodyBytes,
        decoded.authInfoBytes,
        highSSignature(decoded.signature),
      ),
    ))).toThrow(/high-S|signature/i);
    const noPrehash = secp256k1.sign(
      base64UrlDecode(record.sign_doc_bytes_b64u),
      SECP_PRIVATE_KEY,
      { prehash: false, lowS: true, format: "compact" },
    );
    expect(() => verifyZeroneEconomySignedTransactionRecord(withTxBytes(
      record,
      encodeEconomyTxRaw(decoded.bodyBytes, decoded.authInfoBytes, noPrehash),
    ))).toThrow(/prehash|signature/i);
  });

  test("rejects independently rehashed Body, AuthInfo, SignDoc, and object-shape substitutions", async () => {
    const { record } = await signedTransactionRecordFixture();
    const body = base64UrlDecode(record.body_bytes_b64u);
    const auth = base64UrlDecode(record.auth_info_bytes_b64u);
    const signDoc = base64UrlDecode(record.sign_doc_bytes_b64u);
    const changedBody = Uint8Array.from(body);
    changedBody[changedBody.length - 1] = (changedBody.at(-1) ?? 0) ^ 1;
    const changedAuth = Uint8Array.from(auth);
    changedAuth[changedAuth.length - 1] = (changedAuth.at(-1) ?? 0) ^ 1;
    const changedSignDoc = Uint8Array.from(signDoc);
    changedSignDoc[changedSignDoc.length - 1] = (changedSignDoc.at(-1) ?? 0) ^ 1;
    for (const hostile of [
      recontent(record, {
        body_bytes_b64u: base64UrlEncode(changedBody),
        body_bytes_hash: sha256BytesId(changedBody),
      }),
      recontent(record, {
        auth_info_bytes_b64u: base64UrlEncode(changedAuth),
        auth_info_bytes_hash: sha256BytesId(changedAuth),
      }),
      recontent(record, {
        sign_doc_bytes_b64u: base64UrlEncode(changedSignDoc),
        sign_doc_bytes_hash: sha256BytesId(changedSignDoc),
      }),
      { ...record, endpoint: "https://example.invalid" },
    ]) {
      expect(() => verifyZeroneEconomySignedTransactionRecord(hostile)).toThrow();
    }
    const getter = { ...record } as Record<string, unknown>;
    Object.defineProperty(getter, "tx_hash", {
      enumerable: true,
      get: () => record.tx_hash,
    });
    expect(() => verifyZeroneEconomySignedTransactionRecord(getter))
      .toThrow(/data propert|closed|snapshot/i);
  });

  test("keeps unsigned request and plan coordinates explicitly correspondence-only", async () => {
    const { record } = await signedTransactionRecordFixture();
    const changed = recontent(record, {
      request_id: "88888888-8888-4888-8888-888888888888",
      plan_id: `sha256:${"8".repeat(64)}`,
      plan_content_id: `sha256:${"9".repeat(64)}`,
    });
    expect(verifyZeroneEconomySignedTransactionRecord(changed)).toEqual(changed);
  });
});
