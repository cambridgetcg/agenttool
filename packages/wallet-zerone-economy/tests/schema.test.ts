import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  verifyZeroneEconomySignedTransactionRecord,
  verifyZeroneEconomySimulationEvidence,
} from "../src/index.js";
import { authorizedPlan, signedTransactionRecordFixture } from "./fixtures.js";

const schema = await Bun.file(new URL(
  "../schema/simulation-evidence-v0.1.schema.json",
  import.meta.url,
)).json() as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const signedTransactionSchema = await Bun.file(new URL(
  "../schema/signed-transaction-v0.1.schema.json",
  import.meta.url,
)).json() as object;
const validateSignedTransaction = ajv.compile(signedTransactionSchema);

describe("simulation evidence schema", () => {
  test("accepts the canonical planner-created signed evidence record", async () => {
    const { evidence } = await authorizedPlan();
    expect(validate(evidence), ajv.errorsText(validate.errors)).toBeTrue();
  });

  test("is closed and keeps successful status coupled to code zero", async () => {
    const { evidence } = await authorizedPlan();
    expect(validate({ ...evidence, transport_url: "https://example.invalid" }))
      .toBeFalse();
    expect(validate({ ...evidence, status: "failed", code: 0 })).toBeFalse();
    expect(validate({ ...evidence, status: "succeeded", code: 1 })).toBeFalse();
  });

  test("retains nullable signed-evidence compatibility outside the strict receipt helper", async () => {
    const { evidence } = await authorizedPlan();
    expect(validate({ ...evidence, block_hash: null }), ajv.errorsText(validate.errors))
      .toBeTrue();
    expect(validate({ ...evidence, block_hash: "a".repeat(64) })).toBeFalse();
    expect(validate({ ...evidence, block_hash: "A".repeat(63) })).toBeFalse();
  });

  test("matches runtime canonical base64url terminal-bit constraints", async () => {
    const { evidence } = await authorizedPlan();
    const invalidPublicKey = {
      ...evidence,
      adapter: {
        ...evidence.adapter,
        public_key: `${evidence.adapter.public_key.slice(0, -1)}B`,
      },
    };
    const invalidSignature = {
      ...evidence,
      signature: {
        ...evidence.signature,
        value: `${evidence.signature.value.slice(0, -1)}B`,
      },
    };
    expect(validate(invalidPublicKey)).toBeFalse();
    expect(validate(invalidSignature)).toBeFalse();
    expect(() => verifyZeroneEconomySimulationEvidence(invalidPublicKey))
      .toThrow(/canonical unpadded base64url/i);
    expect(() => verifyZeroneEconomySimulationEvidence(invalidSignature))
      .toThrow(/canonical unpadded base64url/i);
  });
});

describe("signed transaction schema", () => {
  test("accepts the canonical portable record and matches runtime reload", async () => {
    const { record } = await signedTransactionRecordFixture();
    expect(
      validateSignedTransaction(record),
      ajv.errorsText(validateSignedTransaction.errors),
    ).toBeTrue();
    expect(verifyZeroneEconomySignedTransactionRecord(record)).toEqual(record);
  });

  test("is closed and preserves exact hash, key, and timestamp forms", async () => {
    const { record } = await signedTransactionRecordFixture();
    expect(validateSignedTransaction({ ...record, endpoint: "https://example.invalid" }))
      .toBeFalse();
    expect(validateSignedTransaction({ ...record, tx_hash: record.tx_hash.toLowerCase() }))
      .toBeFalse();
    expect(validateSignedTransaction({
      ...record,
      signer_public_key_b64u: record.signer_public_key_b64u.slice(1),
    })).toBeFalse();
    expect(validateSignedTransaction({
      ...record,
      requested_at: "2026-08-20T18:03:00Z",
    })).toBeFalse();
  });
});
