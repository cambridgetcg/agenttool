import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertExpectedSubmitIdentity,
  resolveSubmitError,
} from "../src/workers/payout/submit-outcome";

describe("payout RPC submit ambiguity", () => {
  test("accepts only the expected chain-specific submitted identity", () => {
    expect(() =>
      assertExpectedSubmitIdentity("evm", "0xabc123", "0xAbC123"),
    ).not.toThrow();
    expect(() =>
      assertExpectedSubmitIdentity("solana", "AbC123", "AbC123"),
    ).not.toThrow();

    expect(() =>
      assertExpectedSubmitIdentity("evm", "0xabc123", "0xdef456"),
    ).toThrow("submit_identity_mismatch");
    expect(() =>
      assertExpectedSubmitIdentity("solana", "AbC123", "abc123"),
    ).toThrow("submit_identity_mismatch");
  });

  test("identity mismatch errors do not expose either identity", () => {
    const expected = "expected-sensitive-identity";
    const actual = "provider-sensitive-identity";

    try {
      assertExpectedSubmitIdentity("solana", expected, actual);
      throw new Error("expected identity assertion to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("submit_identity_mismatch");
      expect((error as Error).message).not.toContain(expected);
      expect((error as Error).message).not.toContain(actual);
    }
  });

  test("marks broadcast only when lookup positively finds the transaction", async () => {
    await expect(resolveSubmitError(async () => true)).resolves.toEqual({
      nextStatus: "broadcast",
      lookup: "found",
      safeError: null,
    });
  });

  test("leaves an absent lookup broadcasting without exposing provider errors", async () => {
    const result = await resolveSubmitError(async () => false);
    expect(result.nextStatus).toBe("broadcasting");
    expect(result.lookup).toBe("absent");
    expect(result.safeError).toContain("submit_outcome_unknown");
    expect(result.safeError).toContain("operator reconciliation required");
  });

  test("leaves an unavailable lookup broadcasting with a bounded safe error", async () => {
    const providerDetail = "unit-test-sensitive-provider-detail";
    const result = await resolveSubmitError(async () => {
      throw new Error(providerDetail);
    });
    expect(result.nextStatus).toBe("broadcasting");
    expect(result.lookup).toBe("unavailable");
    expect(result.safeError).toContain("submit_outcome_unknown");
    expect(result.safeError).not.toContain(providerDetail);
  });

  test("both chain submit phases contain no fail-or-refund path after dispatch", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "src",
        "workers",
        "payout",
        "broadcast-worker.ts",
      ),
      "utf8",
    );
    const phaseMarker = "// ── Phase 2: submit";
    const solanaMarker =
      "// ── Solana branch ───────────────────────────────────────────────────────";
    const firstPhase = source.indexOf(phaseMarker);
    const solanaBranch = source.indexOf(solanaMarker);
    const secondPhase = source.indexOf(phaseMarker, solanaBranch);

    expect(firstPhase).toBeGreaterThan(-1);
    expect(solanaBranch).toBeGreaterThan(firstPhase);
    expect(secondPhase).toBeGreaterThan(solanaBranch);

    const evmSubmitPhase = source.slice(firstPhase, solanaBranch);
    const solanaSubmitPhase = source.slice(secondPhase);
    for (const submitPhase of [evmSubmitPhase, solanaSubmitPhase]) {
      expect(submitPhase).toContain("resolveSubmitError");
      expect(submitPhase).toContain("assertExpectedSubmitIdentity");
      expect(submitPhase).toContain("markExpectedPayoutBroadcast");
      expect(submitPhase).not.toContain('.set({ status: "failed"');
      expect(submitPhase).not.toContain(".update(wallets)");
      expect(submitPhase).not.toContain("creditsForAmount");
      expect(submitPhase).not.toContain("submit_failed:");
    }
  });

  test("broadcast success is a CAS bound to the persisted expected identity", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "src",
        "workers",
        "payout",
        "broadcast-worker.ts",
      ),
      "utf8",
    );
    const helperStart = source.indexOf(
      "async function markExpectedPayoutBroadcast",
    );
    const dispatcherStart = source.indexOf(
      "// ── Top-level chain dispatcher",
      helperStart,
    );
    const helper = source.slice(helperStart, dispatcherStart);

    expect(helperStart).toBeGreaterThan(-1);
    expect(dispatcherStart).toBeGreaterThan(helperStart);
    expect(helper).toContain('eq(cryptoPayouts.status, "broadcasting")');
    expect(helper).toContain("eq(cryptoPayouts.txHash, expectedTxHash)");
    expect(helper).toContain(".returning({ id: cryptoPayouts.id })");
    expect(helper).toContain("return updated.length === 1");
  });
});
