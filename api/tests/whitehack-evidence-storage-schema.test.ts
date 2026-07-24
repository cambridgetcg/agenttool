import { describe, expect, test } from "bun:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import inputSchema from "../../specs/agenttool-whitehack-evidence-storage-input-v1.schema.json";
import receiptSchema from "../../specs/agenttool-whitehack-evidence-storage-receipt-v1.schema.json";
import {
  MemoryBlockStore,
  generateIdentity,
} from "../../packages/data-protocol/src/index";
import { base64UrlEncode } from "../../packages/data-protocol/src/bytes";
import {
  canonicalWhitehackEvidenceStorageReceipt,
  normalizeWhitehackEvidenceCapsule,
  normalizeWhitehackEvidenceStorageInput,
} from "../../bin/_whitehack-evidence-storage";
import { storeWhitehackEvidence } from "../../bin/_whitehack-evidence-storage-service";
import { WHITEHACK_0_9_ALL_PROFILE_CANONICAL } from "../../bin/tests/fixtures/whitehack-evidence-capsule-v1-all-profiles";

const NOW = new Date("2026-07-24T12:00:00.000Z");

describe("Whitehack encrypted evidence storage JSON Schemas", () => {
  test("compile under AJV 2020 and validate real all-profile input and receipt records", async () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);

    expect(
      ajv.validateSchema(inputSchema),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(
      ajv.validateSchema(receiptSchema),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const validateInput = ajv.compile(inputSchema);
    const validateReceipt = ajv.compile(receiptSchema);

    const recipient = generateIdentity(
      "urn:test:whitehack-evidence-schema:recipient",
    );
    const input = normalizeWhitehackEvidenceStorageInput({
      document_type: "agenttool-whitehack-evidence-storage-input/v1",
      capsule: normalizeWhitehackEvidenceCapsule(
        JSON.parse(WHITEHACK_0_9_ALL_PROFILE_CANONICAL),
      ),
      recipient: {
        id: recipient.id,
        x25519_public_key: base64UrlEncode(recipient.boxPublicKey),
      },
      grant: { expires_at: null },
    });
    const serializedInput = JSON.parse(JSON.stringify(input));
    expect(
      validateInput(serializedInput),
      JSON.stringify(validateInput.errors),
    ).toBe(true);
    expect(serializedInput.capsule.finding_groups).toHaveLength(77);

    const receipt = await storeWhitehackEvidence(
      input,
      new MemoryBlockStore(),
      { now: () => NOW },
    );
    const serializedReceipt = JSON.parse(
      canonicalWhitehackEvidenceStorageReceipt(receipt),
    );
    expect(
      validateReceipt(serializedReceipt),
      JSON.stringify(validateReceipt.errors),
    ).toBe(true);
    expect(serializedReceipt.verification).toMatchObject({
      manifest_and_ciphertext_cids: true,
      decrypted_read_back_exact_bytes: true,
      capsule_schema_revalidated: true,
      fixed_size_frame_validated: true,
    });

    const leakedInput = structuredClone(serializedInput);
    leakedInput.capsule.finding_groups[0].snippet = "must remain impossible";
    expect(validateInput(leakedInput)).toBe(false);

    const leakedReceipt = structuredClone(serializedReceipt);
    leakedReceipt.capsule_sha256 = "a".repeat(64);
    expect(validateReceipt(leakedReceipt)).toBe(false);
  });
});
