import { describe, expect, test } from "bun:test";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
} from "@agenttool/wallet";

import {
  decodeEconomyTxRaw,
  verifyZeroneEconomySignedTransactionRecord,
  type ZeroneEconomySignedTransactionRecord,
} from "../src/index.js";
import {
  signedTransactionRecordFixture,
  vector as goVector,
} from "./fixtures.js";

interface SignedTransactionVector {
  readonly schema: "agent-wallet-zerone-economy/signed-transaction-vector/0.1";
  readonly record: ZeroneEconomySignedTransactionRecord;
}

const vector = await Bun.file(new URL(
  "../vectors/signed-transaction-v0.1-vector.json",
  import.meta.url,
)).json() as SignedTransactionVector;

describe("portable signed transaction vector", () => {
  test("matches deterministic creation, reload, and the unchanged Go/Cosmos bytes", async () => {
    const fixture = await signedTransactionRecordFixture();
    expect(fixture.record).toEqual(vector.record);
    expect(verifyZeroneEconomySignedTransactionRecord(
      JSON.parse(canonicalJson(vector.record)),
    )).toEqual(vector.record);
    expect(vector.record.tx_bytes_b64u).toBe(
      goVector.single_message_plans.create_bounty.direct_sign.signed_tx_bytes_b64u,
    );
    expect(vector.record.tx_hash).toBe(
      goVector.single_message_plans.create_bounty.direct_sign.tx_hash,
    );
  });

  test("pins the complete record, exact TxRaw signature, and byte hashes", () => {
    expect(vector.record.content_id)
      .toBe("sha256:b0c962daa2bd247c21c24ddcf367ae5a9ee375e6439cf1cc1f599cd77cc9f24c");
    expect(vector.record.sign_doc_bytes_hash)
      .toBe("sha256:3d5c5cfd958cb6b7c29b13181fd396c73e9e94aeb92d819761dc9970b31138ea");
    expect(vector.record.tx_bytes_hash)
      .toBe("sha256:cec997f27b00e19354cb35d3467126d8eeb0d9b9e7a85430e0bae5158447e6c5");
    expect(vector.record.tx_hash)
      .toBe("CEC997F27B00E19354CB35D3467126D8EEB0D9B9E7A85430E0BAE5158447E6C5");
    expect(base64UrlEncode(decodeEconomyTxRaw(
      base64UrlDecode(vector.record.tx_bytes_b64u),
    ).signature)).toBe(
      "nPU6QlJBT3l4uvycKoKIex0E8lDU6bhAtReNX_eF10h0oPT2hhcZKDDZpr_F6diqc8-5GDnHlG-a2pOnrlhLVQ",
    );
  });
});
