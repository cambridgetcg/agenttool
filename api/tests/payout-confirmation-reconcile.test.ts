import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { nextPayoutScanCursor } from "../src/workers/payout/confirm-worker";

const source = readFileSync(
  join(
    __dirname,
    "..",
    "src",
    "workers",
    "payout",
    "confirm-worker.ts",
  ),
  "utf8",
);

describe("payout confirmation reconciliation", () => {
  test("full ambiguity pages advance while a short page wraps", () => {
    const fullPage = Array.from({ length: 50 }, (_, index) => ({
      id: `00000000-0000-0000-0000-${index.toString().padStart(12, "0")}`,
    }));

    expect(nextPayoutScanCursor(fullPage)).toBe(fullPage.at(-1)!.id);
    expect(nextPayoutScanCursor(fullPage.slice(0, 49))).toBeNull();
    expect(nextPayoutScanCursor([])).toBeNull();
  });

  test("keeps ambiguity keyset rotation beside persistent confirmation fairness", () => {
    expect(source).toContain("nextBroadcastingBatch(network)");
    expect(source).toContain(".orderBy(asc(cryptoPayouts.id))");
    expect(source).toContain("gt(cryptoPayouts.id, afterId)");
    expect(source).toContain("lastCheckedAt} ASC NULLS FIRST");
    expect(source).toContain("cryptoPayouts.requestedAt");
    expect(source).toContain("eq(cryptoPayouts.network, network)");
  });

  test("only positive expected-id evidence can advance broadcasting", () => {
    const start = source.indexOf(
      "async function reconcileBroadcastingRow(row: Row)",
    );
    const end = source.indexOf("async function runBounded(", start);
    const reconcileRow = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(reconcileRow).toContain("txExistsOnChain");
    expect(reconcileRow).toContain("solanaTxExists");
    expect(reconcileRow).toContain("if (!found) return");
    expect(reconcileRow).toContain('.set({ status: "broadcast", error: null })');
    expect(reconcileRow).toContain("eq(cryptoPayouts.id, row.id)");
    expect(reconcileRow).toContain(
      'eq(cryptoPayouts.status, "broadcasting")',
    );
    expect(reconcileRow).toContain(
      "eq(cryptoPayouts.network, row.network)",
    );
    expect(reconcileRow).toContain("eq(cryptoPayouts.txHash, row.txHash)");
    expect(reconcileRow).not.toContain("submitSignedTx");
    expect(reconcileRow).not.toContain("submitSolanaTx");
    expect(reconcileRow).not.toContain("refundPayoutAndFail");
    expect(reconcileRow).not.toContain('status: "failed"');
    expect(reconcileRow).not.toContain('status: "confirmed"');
  });

  test("provider errors cannot place credential-bearing URLs in confirm logs", () => {
    expect(source).not.toContain("err.message");
    expect(source).not.toContain("console.error(\"[payout-confirm] tick error:\", err)");
    expect(source).toContain(
      "confirmation lookup unavailable; state unchanged",
    );
    expect(source).toContain(
      "expected-transaction lookup unavailable; left broadcasting",
    );
  });
});
