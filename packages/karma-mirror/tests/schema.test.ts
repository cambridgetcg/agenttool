import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { fixture, mirrorRequest } from "./helpers.js";

const schemaDirectory = join(import.meta.dir, "..", "schema");

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(schemaDirectory, name), "utf8"));
}

function validators() {
  const receipt = loadSchema("karma-mirror-receipt-v1.schema.json");
  const window = loadSchema("karma-mirror-receipt-window-v1.schema.json");
  const tend = loadSchema("karma-mirror-tend-report-v1.schema.json");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(receipt);
  return {
    receipt: ajv.getSchema(receipt.$id as string),
    window: ajv.compile(window),
    tend: ajv.compile(tend),
  };
}

describe("strict portable schemas", () => {
  test("compile together and accept emitted receipt windows and TEND reports", async () => {
    const validate = validators();
    const { key, mirror } = fixture();
    await mirror.handle(mirrorRequest("/v1/execute", {
      token: key,
      method: "POST",
      body: JSON.stringify({ language: "bash", code: "curl https://example.test" }),
    }));
    await mirror.handle(mirrorRequest("/v1/malware", {
      token: key,
      method: "POST",
      body: JSON.stringify({ sample_b64: Buffer.from("schema sample").toString("base64") }),
    }));

    const snapshot = mirror.receiptSnapshot();
    const report = mirror.incidentClarityReport();
    for (const receipt of snapshot.receipts) {
      expect(validate.receipt?.(receipt), JSON.stringify(validate.receipt?.errors)).toBe(
        true,
      );
    }
    expect(validate.window(snapshot), JSON.stringify(validate.window.errors)).toBe(true);
    expect(validate.tend(report), JSON.stringify(validate.tend.errors)).toBe(true);
  });

  test("rejects authority drift and branch-local evidence drift", async () => {
    const validate = validators();
    const { key, mirror } = fixture();
    await mirror.handle(mirrorRequest("/v1/execute", {
      token: key,
      method: "POST",
      body: JSON.stringify({ language: "bash", code: "pwd" }),
    }));
    const receipt = structuredClone(mirror.receiptSnapshot().receipts[0]);
    expect(receipt).toBeDefined();
    if (!receipt) throw new Error("receipt missing");
    receipt.evidence = {};
    expect(validate.receipt?.(receipt)).toBe(false);

    const report = structuredClone(mirror.incidentClarityReport()) as Record<
      string,
      unknown
    >;
    const nonClaims = report.non_claims as Record<string, unknown>;
    nonClaims.grants_transfer_authority = true;
    expect(validate.tend(report)).toBe(false);
  });
});
