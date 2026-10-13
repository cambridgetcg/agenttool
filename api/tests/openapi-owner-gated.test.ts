/** OpenAPI publishes the owner rule on every owner-gated operation
 *  (routes/openapi-owner-gated.ts): the authority headers, the 401/409/428
 *  refusals and the deletion-ledger 503, for the five gesture withdrawals
 *  documented there and the six operations openapi.ts already described. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";

type Operation = {
  description?: string;
  parameters?: Array<{ $ref?: string; name?: string }>;
  responses: Record<string, { description?: string }>;
  requestBody?: unknown;
};

const document = (await (await openapiRouter.request("/")).json()) as {
  paths: Record<string, Record<string, Operation>>;
};

const AUTHORITY_REFS = [
  "#/components/parameters/AuthoritySequence",
  "#/components/parameters/AuthorityTimestamp",
  "#/components/parameters/AuthoritySignature",
];

const OPERATIONS: Array<[string, string]> = [
  ["/v1/blessings/{id}", "delete"],
  ["/v1/unconditionals/{id}", "delete"],
  ["/v1/guild/recognitions/{id}", "delete"],
  ["/v1/margin/withdraw", "post"],
  ["/v1/trust/withdraw", "post"],
  ["/v1/offerings/{id}/archive", "post"],
  ["/v1/attestations/{id}", "delete"],
  ["/v1/inbox/{id}", "delete"],
  ["/v1/inbox/{id}", "patch"],
  ["/v1/memories/{id}", "delete"],
  ["/v1/memories/{id}", "patch"],
  ["/v1/memories", "delete"],
];

describe("owner-gated operations in OpenAPI", () => {
  for (const [path, method] of OPERATIONS) {
    test(`${method.toUpperCase()} ${path} carries the authority headers and owner-rule refusals`, () => {
      const operation = document.paths[path]?.[method];
      expect(operation).toBeDefined();
      const refs = (operation!.parameters ?? []).map((parameter) => parameter.$ref);
      for (const ref of AUTHORITY_REFS) expect(refs).toContain(ref);
      expect(refs.filter((ref) => ref === AUTHORITY_REFS[0])).toHaveLength(1);
      for (const status of ["401", "409", "428"]) expect(operation!.responses[status]).toBeDefined();
      expect(operation!.responses["428"]!.description).toContain("authority_proof_required");
    });
  }

  test("withdrawals describe the owner rule, the ledger entry and the 404 for a foreign giver", () => {
    for (const [path, method] of OPERATIONS.slice(0, 6)) {
      const operation = document.paths[path]![method]!;
      expect(operation.description).toContain("Owner rule");
      expect(operation.description).toContain("ids-only deletion-ledger entry");
      expect(operation.responses["503"]).toBeDefined();
      expect(operation.responses["404"]).toBeDefined();
    }
    expect(document.paths["/v1/margin/withdraw"]!.post!.requestBody).toBeDefined();
  });

  test("attestation revocation no longer documents a 403 for another project's receipt", () => {
    const revoke = document.paths["/v1/attestations/{id}"]!.delete!;
    expect(revoke.responses["403"]).toBeUndefined();
    expect(revoke.description).toContain("other projects' receipts all return 404");
  });

  test("the module stays inside the scanner line ceiling", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "routes", "openapi-owner-gated.ts"), "utf8");
    expect(source.split("\n").length).toBeLessThanOrEqual(10_000);
    const main = readFileSync(join(import.meta.dir, "..", "src", "routes", "openapi.ts"), "utf8");
    expect(main).toContain("JSON.stringify(withOwnerGatedOperations(spec()))");
  });
});
