import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertExpectedSubmitIdentity,
  resolveSubmitError,
  submittedIdentityMatches,
} from "../src/workers/payout/submit-outcome";

describe("payout RPC submit ambiguity", () => {
  test("accepts only strict chain-specific submitted identities", () => {
    const evm = `0x${"a".repeat(64)}`;
    const otherEvm = `0x${"b".repeat(64)}`;
    expect(
      submittedIdentityMatches(
        "evm",
        evm,
        evm.toUpperCase().replace("0X", "0x"),
      ),
    ).toBe(true);
    expect(submittedIdentityMatches("evm", evm, otherEvm)).toBe(false);
    expect(submittedIdentityMatches("evm", evm, "0x01")).toBe(false);
    expect(
      submittedIdentityMatches("solana", "signature-a", "signature-a"),
    ).toBe(true);
    expect(
      submittedIdentityMatches("solana", "signature-a", "signature-b"),
    ).toBe(false);

    expect(() =>
      assertExpectedSubmitIdentity(
        "evm",
        evm,
        evm.toUpperCase().replace("0X", "0x"),
      ),
    ).not.toThrow();
    expect(() =>
      assertExpectedSubmitIdentity("evm", evm, otherEvm),
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
      expect(submitPhase).toContain("markPersistedIdentityBroadcast");
      expect(submitPhase).toContain(
        "recordPersistedIdentitySubmitAmbiguity",
      );
      expect(submitPhase).not.toContain('.set({ status: "failed"');
      expect(submitPhase).not.toContain(".update(wallets)");
      expect(submitPhase).not.toContain("creditsForAmount");
      expect(submitPhase).not.toContain("submit_failed:");
    }
  });

  test("broadcast success and ambiguity writes bind persisted identity and network", () => {
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
      "async function markPersistedIdentityBroadcast",
    );
    const dispatcherStart = source.indexOf(
      "// ── Top-level chain dispatcher",
      helperStart,
    );
    const helpers = source.slice(helperStart, dispatcherStart);

    expect(helperStart).toBeGreaterThan(-1);
    expect(dispatcherStart).toBeGreaterThan(helperStart);
    expect(helpers).toContain('eq(cryptoPayouts.status, "broadcasting")');
    expect(helpers.match(/eq\(cryptoPayouts\.txHash, txHash\)/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
    expect(
      helpers.match(/eq\(cryptoPayouts\.network, network\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(helpers).toContain(".returning({ id: cryptoPayouts.id })");
    expect(helpers).toContain("return updated.length === 1");
  });
});
