/** Wave 2 · W2-1 — payable-route table, pure matcher, top-up parsing, and
 * kind-aware credit gate. No DB, no network. */

import { describe, expect, test } from "bun:test";

import { config } from "../src/config";
import { toolsConfig } from "../src/services/tools/config";
import {
  ATOMIC_PER_CREDIT,
  canClearProjectCreditGate,
  isX402ProjectCreditRoute,
  matchX402PayableRoute,
  parseTopUpCredits,
  recoverableX402ProjectCreditPolicy,
  X402_PAYABLE_ROUTES,
  x402ProjectCreditPolicy,
  type X402PayableRoute,
  type X402ProjectCreditPolicy,
} from "../src/services/economy/x402-policy";

const POSTGRES_INTEGER_MAX = 2_147_483_647;

describe("X402_PAYABLE_ROUTES table", () => {
  test("seeds exactly the two existing route_cost rows at toolsConfig prices", () => {
    expect(X402_PAYABLE_ROUTES.map((r) => `${r.method} ${r.pattern}`)).toEqual([
      "POST /v1/scrape",
      "POST /v1/document",
    ]);
    const byLabel = Object.fromEntries(
      X402_PAYABLE_ROUTES.map((r) => [r.label, r] as const),
    );
    expect(byLabel.scrape).toMatchObject({
      kind: "route_cost",
      credits: toolsConfig.credits.scrape,
      errorCodes: ["insufficient_credits"],
    });
    expect(byLabel.document).toMatchObject({
      kind: "route_cost",
      credits: toolsConfig.credits.document,
      errorCodes: ["insufficient_credits"],
    });
    // No top_up row until its route exists (W2-2): declared ≠ wired.
    expect(X402_PAYABLE_ROUTES.some((r) => r.kind === "top_up")).toBe(false);
  });

  test("table and rows are frozen", () => {
    expect(Object.isFrozen(X402_PAYABLE_ROUTES)).toBe(true);
    for (const row of X402_PAYABLE_ROUTES) {
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.errorCodes)).toBe(true);
    }
  });

  test("one credit is one thousand atomic USDC units", () => {
    expect(ATOMIC_PER_CREDIT).toBe(1000);
  });
});

describe("matchX402PayableRoute", () => {
  test("resolves static rows with an empty param bag and the concrete path", () => {
    const scrape = matchX402PayableRoute("/v1/scrape", "POST");
    expect(scrape).not.toBeNull();
    expect(scrape!.row.label).toBe("scrape");
    expect(scrape!.params).toEqual({});
    expect(scrape!.concretePath).toBe("/v1/scrape");
    expect(matchX402PayableRoute("/v1/document", "post")!.row.label)
      .toBe("document");
  });

  test("trailing slash, subpaths, prefixes and unknown paths are null", () => {
    expect(matchX402PayableRoute("/v1/scrape/", "POST")).toBeNull();
    expect(matchX402PayableRoute("/v1/scrape/x", "POST")).toBeNull();
    expect(matchX402PayableRoute("/v1", "POST")).toBeNull();
    expect(matchX402PayableRoute("/v1/scrapes", "POST")).toBeNull();
    expect(matchX402PayableRoute("v1/scrape", "POST")).toBeNull();
    expect(matchX402PayableRoute("", "POST")).toBeNull();
    expect(matchX402PayableRoute("//v1/scrape", "POST")).toBeNull();
    expect(matchX402PayableRoute("/v1/mcp", "POST")).toBeNull();
  });

  test("method mismatch is null", () => {
    for (const method of ["GET", "PATCH", "DELETE", "PUT", "OPTIONS"]) {
      expect(matchX402PayableRoute("/v1/scrape", method)).toBeNull();
    }
    expect(isX402ProjectCreditRoute("/v1/scrape", "GET")).toBe(false);
    expect(isX402ProjectCreditRoute("/v1/scrape", "POST")).toBe(true);
    expect(isX402ProjectCreditRoute("/v1/scrape/", "POST")).toBe(false);
  });
});

describe("matcher params + precedence (scratch table, real algorithm)", () => {
  const TOP_UP: X402PayableRoute = {
    method: "POST",
    pattern: "/v1/x402/top-up/:credits",
    kind: "top_up",
    credits: null,
    label: "top_up",
    errorCodes: [],
  };
  const LITERAL: X402PayableRoute = {
    method: "POST",
    pattern: "/v1/x402/top-up/status",
    kind: "route_cost",
    credits: 1,
    label: "status",
    errorCodes: ["insufficient_credits"],
  };

  test("params capture raw segments and never match empty", () => {
    const m = matchX402PayableRoute("/v1/x402/top-up/250", "POST", [TOP_UP]);
    expect(m).toMatchObject({
      params: { credits: "250" },
      concretePath: "/v1/x402/top-up/250",
    });
    expect(m!.row).toBe(TOP_UP);
    expect(Object.isFrozen(m!.params)).toBe(true);
    // Raw, undecoded: a percent-encoded segment is captured as-is.
    expect(matchX402PayableRoute("/v1/x402/top-up/%31", "POST", [TOP_UP])!.params.credits)
      .toBe("%31");
    expect(matchX402PayableRoute("/v1/x402/top-up/", "POST", [TOP_UP])).toBeNull();
    expect(matchX402PayableRoute("/v1/x402/top-up", "POST", [TOP_UP])).toBeNull();
    expect(matchX402PayableRoute("/v1/x402/top-up/1/2", "POST", [TOP_UP])).toBeNull();
    expect(matchX402PayableRoute("/v1/x402/top-up/1", "GET", [TOP_UP])).toBeNull();
  });

  test("literal beats param regardless of table order", () => {
    expect(matchX402PayableRoute("/v1/x402/top-up/status", "POST", [TOP_UP, LITERAL])!.row)
      .toBe(LITERAL);
    expect(matchX402PayableRoute("/v1/x402/top-up/status", "POST", [LITERAL, TOP_UP])!.row)
      .toBe(LITERAL);
    expect(matchX402PayableRoute("/v1/x402/top-up/7", "POST", [LITERAL, TOP_UP])!.row)
      .toBe(TOP_UP);
    // Equal specificity keeps table order.
    const twin: X402PayableRoute = { ...TOP_UP, label: "twin" };
    expect(matchX402PayableRoute("/v1/x402/top-up/7", "POST", [twin, TOP_UP])!.row)
      .toBe(twin);
  });

  test("default table is the frozen export", () => {
    expect(matchX402PayableRoute("/v1/x402/top-up/1", "POST")).toBeNull();
    expect(matchX402PayableRoute("/v1/scrape", "POST", X402_PAYABLE_ROUTES))
      .toEqual(matchX402PayableRoute("/v1/scrape", "POST"));
  });
});

describe("parseTopUpCredits", () => {
  const CAP = config.x402TopUpMaxCredits;

  test("default cap is 10,000 credits (USD 10)", () => {
    expect(CAP).toBe(10_000);
  });

  test("accepts canonical positive integers within cap", () => {
    expect(parseTopUpCredits("1", CAP)).toBe(1);
    expect(parseTopUpCredits("250", CAP)).toBe(250);
    expect(parseTopUpCredits("10000", CAP)).toBe(10_000);
  });

  test("refuses everything that is not a canonical in-cap positive integer", () => {
    for (const raw of [
      "0", "abc", "01", "1e9", "-1", "", "+1", " 1", "1 ", "1.0", "0x10",
      "10001", "2147483648", "99999999999999999999",
    ]) {
      expect(parseTopUpCredits(raw, CAP)).toBeNull();
    }
    expect(parseTopUpCredits(undefined, CAP)).toBeNull();
    expect(parseTopUpCredits(null, CAP)).toBeNull();
  });

  test("cap override is honoured and never clamps", () => {
    expect(parseTopUpCredits("10001", 20_000)).toBe(10_001);
    expect(parseTopUpCredits("2147483647", POSTGRES_INTEGER_MAX)).toBe(POSTGRES_INTEGER_MAX);
    expect(parseTopUpCredits("2147483648", POSTGRES_INTEGER_MAX)).toBeNull();
    expect(parseTopUpCredits("6", 5)).toBeNull();
    expect(parseTopUpCredits("5", 5)).toBe(5);
    expect(parseTopUpCredits("1", 0)).toBeNull();
    expect(parseTopUpCredits("1", -1)).toBeNull();
    expect(parseTopUpCredits("1", Number.NaN)).toBeNull();
  });
});

describe("kind-aware policy + gate", () => {
  test("route_cost policy carries kind, label, pattern and the concrete path", () => {
    const policy = x402ProjectCreditPolicy("/v1/scrape", "POST")!;
    expect(policy).toMatchObject({
      path: "/v1/scrape",
      pattern: "/v1/scrape",
      kind: "route_cost",
      label: "scrape",
      creditsRequired: toolsConfig.credits.scrape,
      amountAtomic: String(BigInt(toolsConfig.credits.scrape) * 1000n),
    });
  });

  test("route_cost is recoverable only for its declared error codes", () => {
    const policy = x402ProjectCreditPolicy("/v1/document", "POST")!;
    expect(recoverableX402ProjectCreditPolicy("/v1/document", "POST", "insufficient_credits"))
      .toEqual(policy);
    expect(recoverableX402ProjectCreditPolicy("/v1/document", "POST", "insufficient_balance"))
      .toBeNull();
    expect(recoverableX402ProjectCreditPolicy("/v1/document", "POST", undefined))
      .toBeNull();
  });

  test("route_cost gate is balance-bound and overflow-safe", () => {
    const policy = x402ProjectCreditPolicy("/v1/scrape", "POST")!;
    const need = policy.creditsRequired;
    expect(canClearProjectCreditGate(policy, 0)).toBe(true);
    expect(canClearProjectCreditGate(policy, need - 1)).toBe(true);
    expect(canClearProjectCreditGate(policy, need)).toBe(false);
    expect(canClearProjectCreditGate(policy, need + 1_000)).toBe(false);
    expect(canClearProjectCreditGate(policy, -1)).toBe(false);
    expect(canClearProjectCreditGate(policy, 1.5)).toBe(false);
    expect(canClearProjectCreditGate(policy, "0")).toBe(false);
    expect(canClearProjectCreditGate(policy, undefined)).toBe(false);
  });

  test("top_up gate is never balance-bound; only INTEGER overflow refuses", () => {
    const topUp: X402ProjectCreditPolicy = {
      path: "/v1/x402/top-up/250",
      pattern: "/v1/x402/top-up/:credits",
      kind: "top_up",
      label: "top_up",
      creditsRequired: 250,
      amountAtomic: "250000",
      description: "test",
    };
    expect(canClearProjectCreditGate(topUp, 0)).toBe(true);
    expect(canClearProjectCreditGate(topUp, 249)).toBe(true);
    expect(canClearProjectCreditGate(topUp, 250)).toBe(true);
    expect(canClearProjectCreditGate(topUp, 110_800)).toBe(true);
    expect(canClearProjectCreditGate(topUp, POSTGRES_INTEGER_MAX - 250)).toBe(true);
    expect(canClearProjectCreditGate(topUp, POSTGRES_INTEGER_MAX - 249)).toBe(false);
    expect(canClearProjectCreditGate(topUp, -1)).toBe(false);
    expect(canClearProjectCreditGate(topUp, 1.5)).toBe(false);
    expect(canClearProjectCreditGate(topUp, null)).toBe(false);
  });
});
