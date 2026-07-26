import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveSubmitError,
  submittedIdentityMatches,
} from "../src/workers/payout/submit-outcome";

describe("payout RPC submit ambiguity", () => {
  test("accepts only the locally persisted submit identity", () => {
    const evm = `0x${"a".repeat(64)}`;
    expect(submittedIdentityMatches("evm", evm, evm.toUpperCase().replace("0X", "0x")))
      .toBe(true);
    expect(
      submittedIdentityMatches("evm", evm, `0x${"b".repeat(64)}`),
    ).toBe(false);
    expect(submittedIdentityMatches("evm", evm, "0x01")).toBe(false);
    expect(submittedIdentityMatches("solana", "signature-a", "signature-a"))
      .toBe(true);
    expect(submittedIdentityMatches("solana", "signature-a", "signature-b"))
      .toBe(false);
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
      expect(submitPhase).toContain("submittedIdentityMatches");
      expect(submitPhase).toContain("markPersistedIdentityBroadcast");
      expect(submitPhase).toContain(
        "recordPersistedIdentitySubmitAmbiguity",
      );
      expect(submitPhase).not.toContain('.set({ status: "failed"');
      expect(submitPhase).not.toContain(".update(wallets)");
      expect(submitPhase).not.toContain("creditsForAmount");
      expect(submitPhase).not.toContain("submit_failed:");
    }
    expect(source).toContain("eq(cryptoPayouts.txHash, txHash)");
    expect(source.match(/eq\(cryptoPayouts\.txHash, txHash\)/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
  });
});
