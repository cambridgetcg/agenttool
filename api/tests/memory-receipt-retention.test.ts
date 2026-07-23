import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const STORE = readFileSync(
  new URL("../src/services/memory/store.ts", import.meta.url),
  "utf8",
);
const ROUTE = readFileSync(
  new URL("../src/routes/memory/memories.ts", import.meta.url),
  "utf8",
);
const MIGRATION = readFileSync(
  new URL(
    "../migrations/20260713T120000_attestation_receipt_integrity.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("paid memory receipt retention", () => {
  test("delete locks the memory and refuses to cascade a paid receipt", () => {
    expect(STORE).toContain('.for("update")');
    expect(STORE).toContain("isNotNull(memoryAttestations.sourceGrantId)");
    expect(STORE).toContain("throw new PaidMemoryReceiptProtectedError()");
  });

  test("the authenticated API reports a stable conflict instead of deleting", () => {
    expect(ROUTE).toContain("error instanceof PaidMemoryReceiptProtectedError");
    expect(ROUTE).toContain('message: "paid_memory_receipt_preserved"');
    expect(ROUTE).toContain("new HTTPException(409");
  });

  test("the database also prevents a paid receipt cascade", () => {
    expect(MIGRATION).toContain("fk_memory_witness_grants_attestation");
    expect(MIGRATION).toContain("FOREIGN KEY (memory_attestation_id)");
    expect(MIGRATION).toContain("ON DELETE RESTRICT");
  });
});
