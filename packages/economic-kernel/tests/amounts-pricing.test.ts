import { describe, expect, test } from "bun:test";

import {
  EconomicKernelError,
  SCHEMAS,
  UINT256_MAX,
  addAmounts,
  amount,
  convertAmount,
  selectEffectivePriceRevision,
  validateEconomicQuote,
  validatePriceBookTimeline,
  validatePriceRevision,
} from "../src/index.js";
import { BASE_USDC, GBP, PROJECT_CREDIT, START, makeUnits, price, quote } from "./fixtures.js";

describe("typed exact amounts", () => {
  test("uses canonical decimal strings and BigInt above the JS safe range", () => {
    const units = makeUnits();
    const left = amount(GBP, "9007199254740993", units);
    const right = amount(GBP, "7", units);
    expect(addAmounts(left, right, units).amount_atomic).toBe("9007199254741000");
  });

  test.each(["+1", "01", "1e3", "1.0", " 1", "１", "-0", "-1"])(
    "rejects non-canonical wire amount %s",
    (bad) => {
      const units = makeUnits();
      expect(() => amount(GBP, bad, units)).toThrow(EconomicKernelError);
    },
  );

  test("rejects JSON numbers, overflow, and cross-unit arithmetic", () => {
    const units = makeUnits();
    expect(() => amount(GBP, 1 as unknown as string, units)).toThrow();
    expect(() => amount(GBP, (UINT256_MAX + 1n).toString(), units)).toThrow();
    expect(() => addAmounts(amount(GBP, "1", units), amount(BASE_USDC, "1", units), units)).toThrow();
    expect(() => addAmounts(amount(GBP, UINT256_MAX.toString(), units), amount(GBP, "1", units), units)).toThrow();
  });

  test("does not alias wallet credit and project API credit", () => {
    const units = makeUnits();
    expect(() => addAmounts(
      amount(PROJECT_CREDIT, "1", units),
      amount("agenttool:wallet-credit/1", "1", units),
      units,
    )).toThrow();
  });
});

describe("immutable price revisions", () => {
  test("converts exactly using a pinned reduced rational revision", () => {
    const units = makeUnits();
    const result = convertAmount(amount(BASE_USDC, "9007199254741000", units), price(), START, units);
    expect(result.exact).toBe(true);
    if (result.exact) expect(result.output.amount_atomic).toBe("9007199254741");
  });

  test("returns no spendable output when RETURN_REMAINDER is inexact", () => {
    const units = makeUnits();
    const result = convertAmount(amount(BASE_USDC, "1", units), price({
      input_atomic_per_lot: "3",
      output_atomic_per_lot: "2",
      rounding: "RETURN_REMAINDER",
    }), START, units);
    expect(result).toMatchObject({ exact: false, dividend: "2", divisor: "3", remainder: "2" });
    expect("output" in result).toBe(false);
  });

  test("rejects inexact EXACT_ONLY, unreduced ratios, and wrong units", () => {
    const units = makeUnits();
    expect(() => convertAmount(amount(BASE_USDC, "1", units), price(), START, units)).toThrow();
    expect(() => validatePriceRevision(price({ input_atomic_per_lot: "2000", output_atomic_per_lot: "2" }), units)).toThrow();
    expect(() => convertAmount(amount(GBP, "1000", units), price(), START, units)).toThrow();
  });

  test("uses half-open intervals and a contiguous predecessor chain", () => {
    const units = makeUnits();
    const boundary = "2027-01-01T00:00:00.000Z";
    const first = price({ effective_until: boundary });
    const second = price({
      revision: "2",
      input_atomic_per_lot: "2000",
      effective_from: boundary,
      supersedes_price_revision_id: first.price_revision_id,
    });
    const timeline = validatePriceBookTimeline([first, second], units);
    expect(selectEffectivePriceRevision(timeline, "2026-12-31T23:59:59.999Z", units).revision).toBe("1");
    expect(selectEffectivePriceRevision(timeline, boundary, units).revision).toBe("2");
  });

  test("rejects simultaneous 1000 and 10000 rates in one price book", () => {
    const units = makeUnits();
    const first = price({ effective_until: "2027-06-01T00:00:00.000Z" });
    const conflicting = price({
      revision: "2",
      input_atomic_per_lot: "10000",
      effective_from: "2027-01-01T00:00:00.000Z",
      supersedes_price_revision_id: first.price_revision_id,
    });
    expect(() => validatePriceBookTimeline([first, conflicting], units)).toThrow();
  });

  test("rejects a mutation that reuses an immutable revision identifier", () => {
    const units = makeUnits();
    const first = price({ effective_until: "2027-01-01T00:00:00.000Z" });
    const changed = price({
      revision: "2",
      input_atomic_per_lot: "2000",
      effective_from: "2027-01-01T00:00:00.000Z",
      supersedes_price_revision_id: first.price_revision_id,
    });
    const reused = { ...changed, price_revision_id: first.price_revision_id };
    expect(() => validatePriceBookTimeline([first, reused], units)).toThrow();
    expect(() => validatePriceRevision(reused, units)).toThrow();
  });

  test("rejects unknown fields instead of silently accepting new semantics", () => {
    const units = makeUnits();
    expect(() => validatePriceRevision({ ...price(), latest: true }, units)).toThrow();
    expect(price().schema).toBe(SCHEMAS.priceRevision);
  });
});

describe("content-derived quote terms", () => {
  test("has one identity independent of object key insertion order", () => {
    const canonical = quote();
    const reordered = quote({
      input: {
        amount_atomic: "1000",
        unit_id: BASE_USDC,
        schema: SCHEMAS.amount,
      },
    });
    expect(reordered.quote_id).toBe(canonical.quote_id);
  });

  test("rejects underpayment terms hidden behind a reused quote id", () => {
    const units = makeUnits();
    const original = quote();
    const changed = quote({
      input: amount(BASE_USDC, "2000", units),
      output: amount(PROJECT_CREDIT, "2", units),
    });
    expect(() => validateEconomicQuote({ ...changed, quote_id: original.quote_id }, units)).toThrow();
  });
});
