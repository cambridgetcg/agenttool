/** x402 payment verifier — the advisory→real flip.
 *
 *  Pins (all with injected fakes; no db, no network):
 *    - happy path: verify+settle ok → true; pending persisted BEFORE
 *      facilitator; credits = floor(value/1000); row flipped settled;
 *      settlement stashed on context
 *    - replay (persistPending → null) → false, facilitator never called
 *    - wrong recipient / zero-address recipient → false, nothing persisted
 *    - wrong network / non-exact scheme → false
 *    - facilitator verify invalid → markFailed + false
 *    - facilitator settle failure → markFailed + false
 *    - unauthenticated request (no project) → false
 *    - malformed payload → false
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 4) · docs/PATTERN-PERSIST-IDENTITY.md.
 */

import { describe, expect, test } from "bun:test";
import type { Context } from "hono";

import type { X402PaymentHeader } from "../src/middleware/x402";
import {
  ATOMIC_PER_CREDIT,
  createX402Verifier,
  decodeExactEvmPayload,
  getStashedSettlement,
  payloadHash,
  type X402VerifierDeps,
} from "../src/services/economy/x402-payments";

const RECIPIENT = "0xAbCd000000000000000000000000000000001234";

function encodePayload(over: Partial<{ to: string; value: string; from: string }> = {}) {
  return Buffer.from(
    JSON.stringify({
      signature: "0xsig",
      authorization: {
        from: over.from ?? "0xPayer0000000000000000000000000000000001",
        to: over.to ?? RECIPIENT,
        value: over.value ?? "50000", // $0.05
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x01",
      },
    }),
    "utf-8",
  ).toString("base64");
}

function header(over: Partial<X402PaymentHeader> = {}): X402PaymentHeader {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: encodePayload(),
    ...over,
  };
}

function fakeContext(projectId: string | null = "proj-1"): Context {
  return {
    req: { path: "/v1/memories" },
    var: projectId ? { project: { id: projectId } } : {},
  } as unknown as Context;
}

interface Calls {
  persisted: unknown[];
  settledRows: Array<{ id: string; tx: string; credits: number }>;
  failedRows: Array<{ id: string; reason: string }>;
  credited: Array<{ projectId: string; credits: number }>;
  verifyCalls: number;
  settleCalls: number;
}

function makeDeps(over: Partial<X402VerifierDeps> = {}): { deps: X402VerifierDeps; calls: Calls } {
  const calls: Calls = {
    persisted: [],
    settledRows: [],
    failedRows: [],
    credited: [],
    verifyCalls: 0,
    settleCalls: 0,
  };
  const deps: X402VerifierDeps = {
    facilitator: {
      async verify() {
        calls.verifyCalls += 1;
        return { valid: true };
      },
      async settle() {
        calls.settleCalls += 1;
        return { success: true, transaction: "0xtx", network: "base" };
      },
    },
    async persistPending(row) {
      calls.persisted.push(row);
      return "row-1";
    },
    async markSettled(id, tx, credits) {
      calls.settledRows.push({ id, tx, credits });
    },
    async markFailed(id, reason) {
      calls.failedRows.push({ id, reason });
    },
    async applyCredits(projectId, credits) {
      calls.credited.push({ projectId, credits });
    },
    recipient: () => RECIPIENT,
    expectedNetwork: () => "base",
    ...over,
  };
  return { deps, calls };
}

describe("decodeExactEvmPayload", () => {
  test("decodes a well-formed payload", () => {
    const decoded = decodeExactEvmPayload(encodePayload());
    expect(decoded?.authorization.to).toBe(RECIPIENT);
    expect(decoded?.authorization.value).toBe("50000");
  });

  test("rejects junk base64, missing signature, non-digit value", () => {
    expect(decodeExactEvmPayload("not-base64-json")).toBeNull();
    const noSig = Buffer.from(
      JSON.stringify({ authorization: { from: "a", to: "b", value: "1" } }),
    ).toString("base64");
    expect(decodeExactEvmPayload(noSig)).toBeNull();
    expect(decodeExactEvmPayload(encodePayload({ value: "1.5" }))).toBeNull();
  });
});

describe("createX402Verifier", () => {
  test("happy path — verifies, settles, credits, flips row, stashes settlement", async () => {
    const { deps, calls } = makeDeps();
    const c = fakeContext();
    const ok = await createX402Verifier(deps)(c, header());

    expect(ok).toBe(true);
    expect(calls.persisted.length).toBe(1);
    expect(calls.verifyCalls).toBe(1);
    expect(calls.settleCalls).toBe(1);
    // 50000 atomic / 1000 = 50 credits
    expect(calls.credited).toEqual([{ projectId: "proj-1", credits: 50000 / ATOMIC_PER_CREDIT }]);
    expect(calls.settledRows).toEqual([{ id: "row-1", tx: "0xtx", credits: 50 }]);
    expect(calls.failedRows.length).toBe(0);
    expect(getStashedSettlement(c)?.transaction).toBe("0xtx");
  });

  test("persist happens BEFORE any facilitator call", async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      async persistPending() {
        order.push("persist");
        return "row-1";
      },
      facilitator: {
        async verify() {
          order.push("verify");
          return { valid: true };
        },
        async settle() {
          order.push("settle");
          return { success: true, transaction: "0xtx" };
        },
      },
    });
    await createX402Verifier(deps)(fakeContext(), header());
    expect(order).toEqual(["persist", "verify", "settle"]);
  });

  test("replay — duplicate payload rejected without facilitator", async () => {
    const { deps, calls } = makeDeps({
      async persistPending() {
        return null; // unique-index conflict
      },
    });
    const ok = await createX402Verifier(deps)(fakeContext(), header());
    expect(ok).toBe(false);
    expect(calls.verifyCalls).toBe(0);
    expect(calls.settleCalls).toBe(0);
    expect(calls.credited.length).toBe(0);
  });

  test("payment to a different recipient → refused, nothing persisted", async () => {
    const { deps, calls } = makeDeps();
    const ok = await createX402Verifier(deps)(
      fakeContext(),
      header({ payload: encodePayload({ to: "0xEvil0000000000000000000000000000000000" }) }),
    );
    expect(ok).toBe(false);
    expect(calls.persisted.length).toBe(0);
  });

  test("unconfigured (zero-address) recipient → refused", async () => {
    const { deps, calls } = makeDeps({
      recipient: () => "0x0000000000000000000000000000000000000000",
    });
    const ok = await createX402Verifier(deps)(
      fakeContext(),
      header({ payload: encodePayload({ to: "0x0000000000000000000000000000000000000000" }) }),
    );
    expect(ok).toBe(false);
    expect(calls.persisted.length).toBe(0);
  });

  test("wrong network / non-exact scheme → refused early", async () => {
    const { deps, calls } = makeDeps();
    expect(await createX402Verifier(deps)(fakeContext(), header({ network: "polygon" }))).toBe(false);
    expect(await createX402Verifier(deps)(fakeContext(), header({ scheme: "upto" }))).toBe(false);
    expect(calls.persisted.length).toBe(0);
  });

  test("facilitator verify invalid → row failed, no settle, no credit", async () => {
    const { deps, calls } = makeDeps({
      facilitator: {
        async verify() {
          return { valid: false, reason: "bad_signature" };
        },
        async settle() {
          throw new Error("must not settle");
        },
      },
    });
    const ok = await createX402Verifier(deps)(fakeContext(), header());
    expect(ok).toBe(false);
    expect(calls.failedRows).toEqual([{ id: "row-1", reason: "bad_signature" }]);
    expect(calls.credited.length).toBe(0);
  });

  test("facilitator settle failure → row failed, no credit", async () => {
    const { deps, calls } = makeDeps({
      facilitator: {
        async verify() {
          return { valid: true };
        },
        async settle() {
          return { success: false, error: "insufficient_onchain_balance" };
        },
      },
    });
    const ok = await createX402Verifier(deps)(fakeContext(), header());
    expect(ok).toBe(false);
    expect(calls.failedRows).toEqual([{ id: "row-1", reason: "insufficient_onchain_balance" }]);
    expect(calls.credited.length).toBe(0);
  });

  test("unauthenticated request → refused (no credit target)", async () => {
    const { deps, calls } = makeDeps();
    const ok = await createX402Verifier(deps)(fakeContext(null), header());
    expect(ok).toBe(false);
    expect(calls.persisted.length).toBe(0);
  });

  test("verifier never throws — deps explosion returns false", async () => {
    const { deps } = makeDeps({
      async persistPending() {
        throw new Error("db down");
      },
    });
    const ok = await createX402Verifier(deps)(fakeContext(), header());
    expect(ok).toBe(false);
  });

  test("payloadHash is stable + hex", () => {
    const h = payloadHash(encodePayload());
    expect(h).toBe(payloadHash(encodePayload()));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
