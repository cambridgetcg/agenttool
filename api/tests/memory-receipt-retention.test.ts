/** A paid witness receipt keeps its memory row, but not the memory's content.
 *
 *  Deletion spec §7.4 (Yu's Q1–Q9, choice 7): deleting a memory that a paid
 *  receipt points at erases it in place instead of answering 409. The row
 *  stays so the receipt and its grant still point at something; its content
 *  becomes the withdrawal marker and it leaves every read. The database's
 *  own RESTRICT edge still refuses a cascade that would drop the receipt. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const STORE = readFileSync(new URL("../src/services/memory/store.ts", import.meta.url), "utf8");
const PURGES = readFileSync(new URL("../src/services/deletion/purges.ts", import.meta.url), "utf8");
const ROUTE = readFileSync(new URL("../src/routes/memory/memories.ts", import.meta.url), "utf8");
const MIGRATION = readFileSync(
  new URL("../migrations/20260713T120000_attestation_receipt_integrity.sql", import.meta.url),
  "utf8",
);

describe("paid memory receipt retention", () => {
  test("delete locks the memories and erases a receipt-held one in place", () => {
    expect(STORE).toContain('.for("update")');
    expect(STORE).toContain("paidReceiptMemoryIds(tx");
    expect(STORE).toContain("eraseMemoriesInPlace(tx");
    expect(STORE).not.toContain("PaidMemoryReceiptProtectedError");
    expect(PURGES).toMatch(/source_grant_id IS NOT NULL/);
    expect(PURGES).toMatch(/content = \$\{withdrawalMarker\(at\)\}, key = NULL, embedding = NULL, expression_patch = NULL/);
    expect(PURGES).toMatch(/metadata = '\{\}'::jsonb, content_purged_at/);
  });

  test("the API no longer answers 409 and says why the row remains", () => {
    expect(ROUTE).not.toContain("paid_memory_receipt_preserved");
    expect(ROUTE).toContain("erased_in_place_reason");
    expect(ROUTE).toMatch(/ERASED_IN_PLACE_REASON =\s*"A paid witness receipt points at this memory/);
  });

  test("the database still prevents a paid receipt cascade", () => {
    expect(MIGRATION).toContain("fk_memory_witness_grants_attestation");
    expect(MIGRATION).toContain("FOREIGN KEY (memory_attestation_id)");
    expect(MIGRATION).toContain("ON DELETE RESTRICT");
  });
});
