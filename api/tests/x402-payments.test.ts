/** x402 V2 durable lifecycle tests. All facilitator/DB behavior is injected. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono, type Context } from "hono";
import { privateKeyToAccount } from "viem/accounts";

import type { ProjectContext } from "../src/auth/middleware";
import {
  buildPaymentRequired,
  buildPaymentRequirements,
  encodeCanonicalBase64Json,
  getX402Payment,
  x402Middleware,
  type PaymentPayload,
} from "../src/middleware/x402";
import { rateLimitHeaders } from "../src/middleware/rate-limit-headers";
import { createX402PaymentsRouter } from "../src/routes/x402-payments";
import {
  authorizationIdentityHash,
  classifyExactEvmSignature,
  createX402Verifier,
  decodeExactEvmPayload,
  getStashedSettlement,
  payloadHash,
  type ExactEvmPayload,
  type X402NewPayment,
  type X402PaymentRecord,
  type X402VerifierDeps,
} from "../src/services/economy/x402-payments";
import {
  x402ProjectCreditPolicy,
  x402ProjectCreditResource,
} from "../src/services/economy/x402-policy";

const RECIPIENT = "0xAbcd000000000000000000000000000000001234";
const PAYER = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const POLICY = x402ProjectCreditPolicy("/v1/scrape", "POST")!;
const RESOURCE = x402ProjectCreditResource(
  POLICY,
  "http://localhost/v1/scrape",
  "http://localhost",
)!;
const REQUIREMENT = buildPaymentRequirements({
  amountAtomic: POLICY.amountAtomic,
  payTo: RECIPIENT,
});

function exactPayload(over: Partial<ExactEvmPayload["authorization"]> = {}): ExactEvmPayload {
  return {
    signature: `0x${"12".repeat(65)}`,
    authorization: {
      from: PAYER,
      to: RECIPIENT,
      value: POLICY.amountAtomic,
      validAfter: "0",
      validBefore: "1700000060",
      nonce: `0x${"34".repeat(32)}`,
      ...over,
    },
  };
}

function payment(over: Partial<PaymentPayload> = {}): PaymentPayload {
  return {
    x402Version: 2,
    resource: RESOURCE,
    accepted: REQUIREMENT,
    payload: exactPayload() as unknown as Record<string, unknown>,
    ...over,
  };
}

function fakeContext(
  projectId: string | null = PROJECT_ID,
  credits: unknown = 0,
  path = "/v1/scrape",
): Context {
  const context = {
    req: {
      path,
      method: "POST",
      url: `http://localhost${path}`,
    },
    var: projectId ? { project: { id: projectId, credits } } : {},
    set(key: string, value: unknown) {
      (this.var as Record<string, unknown>)[key] = value;
    },
  };
  return context as unknown as Context;
}

interface Calls {
  order: string[];
  verify: number;
  settle: number;
  external: number;
  finalize: number;
  failed: Array<{ reason: string; receipt: boolean }>;
}

function makeDeps(
  over: Partial<X402VerifierDeps> = {},
  initial: X402PaymentRecord[] = [],
): { deps: X402VerifierDeps; calls: Calls; rows: Map<string, X402PaymentRecord> } {
  const rows = new Map(initial.map((row) => [row.authorizationHash, row]));
  const calls: Calls = {
    order: [], verify: 0, settle: 0, external: 0, finalize: 0, failed: [],
  };
  const deps: X402VerifierDeps = {
    facilitator: {
      async verify() {
        calls.order.push("verify");
        calls.verify += 1;
        return { isValid: true, payer: PAYER };
      },
      async settle() {
        calls.order.push("settle");
        calls.settle += 1;
        return {
          success: true,
          transaction: "0xtx",
          network: "eip155:8453",
          payer: PAYER,
          amount: POLICY.amountAtomic,
        };
      },
    },
    async findByAuthorization(hash) {
      return rows.get(hash) ?? null;
    },
    async insertOrGet(row: X402NewPayment) {
      calls.order.push("inserted");
      const existing = rows.get(row.authorizationHash);
      if (existing) {
        return { record: existing, inserted: false, admission: "accepted" };
      }
      const record: X402PaymentRecord = { id: "row-1", status: "inserted", ...row };
      rows.set(row.authorizationHash, record);
      return { record, inserted: true, admission: "accepted" };
    },
    async markPending(id) {
      calls.order.push("pending");
      const row = [...rows.values()].find((candidate) => candidate.id === id);
      if (!row || row.status !== "inserted") return false;
      row.status = "pending";
      return true;
    },
    async markSettlementAttempted(id) {
      calls.order.push("settlement_attempted");
      const row = [...rows.values()].find((candidate) => candidate.id === id);
      if (!row || row.status !== "pending" || row.settlementAttemptedAt) return false;
      if (row) row.settlementAttemptedAt = new Date(0);
      return true;
    },
    async markFailed(id, reason, receipt) {
      const row = [...rows.values()].find((candidate) => candidate.id === id)!;
      row.status = "failed";
      row.failureReason = reason;
      row.receipt = receipt ?? null;
      calls.failed.push({ reason, receipt: Boolean(receipt) });
    },
    async persistExternalSettlement(id, receipt) {
      calls.order.push("external");
      calls.external += 1;
      const row = [...rows.values()].find((candidate) => candidate.id === id)!;
      row.status = "externally_settled";
      row.receipt = receipt;
      return row;
    },
    async finalizeCredits(id, _projectId, credits) {
      calls.order.push("finalize");
      calls.finalize += 1;
      const row = [...rows.values()].find((candidate) => candidate.id === id)!;
      if (row.status === "settled") {
        return { applied: false, balance: credits, status: "settled" };
      }
      row.status = "settled";
      row.creditsApplied = credits;
      return { applied: true, balance: credits, status: "settled" };
    },
    facilitatorUrl: () => "https://facilitator.example/x402",
    facilitatorReady: async () => true,
    recipient: () => RECIPIENT,
    expectedNetwork: () => "eip155:8453",
    storedNetworkMayApply: () => true,
    classifyAuthorizationSignature: async () => "facilitator_required",
    nowSeconds: () => 1_700_000_000,
    ...over,
  };
  return { deps, calls, rows };
}

function existingRecord(
  status: X402PaymentRecord["status"],
  options: {
    requirement?: typeof REQUIREMENT;
    exact?: ExactEvmPayload;
    resource?: typeof RESOURCE;
    creditsPurchased?: number;
  } = {},
): X402PaymentRecord {
  const requirement = options.requirement ?? REQUIREMENT;
  const exact = options.exact ?? exactPayload({
    to: requirement.payTo,
    value: requirement.amount,
  });
  const resource = options.resource ?? RESOURCE;
  const presented = payment({
    accepted: requirement,
    resource,
    payload: exact as unknown as Record<string, unknown>,
  });
  const identity = authorizationIdentityHash(requirement, exact);
  return {
    id: "existing-row",
    projectId: PROJECT_ID,
    payloadHash: payloadHash(presented),
    authorizationHash: identity,
    scheme: "exact",
    network: requirement.network,
    payer: exact.authorization.from,
    authorizationEvidence: exact.authorization,
    amountAtomic: requirement.amount,
    asset: requirement.asset,
    payTo: requirement.payTo,
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
    requirementExtra: requirement.extra,
    resource: resource.url,
    resourceInfo: resource,
    creditsPurchased: options.creditsPurchased ?? POLICY.creditsRequired,
    status,
    updatedAt: new Date(1_700_000_000_000),
    receipt: status === "externally_settled" || status === "settled"
      ? {
          success: true,
          transaction: "0xdurable",
          network: requirement.network,
          payer: exact.authorization.from,
          amount: requirement.amount,
        }
      : null,
  };
}

function projectMiddleware(credits = 0) {
  return async (c: Context<ProjectContext>, next: () => Promise<void>) => {
    c.set("project", {
      id: PROJECT_ID,
      name: "x402-test",
      plan: "credits",
      credits,
      createdAt: new Date(0),
    });
    await next();
  };
}

function settlementHeader(c: Context): string | undefined {
  const receipt = getStashedSettlement(c);
  return receipt ? encodeCanonicalBase64Json(receipt) : undefined;
}

describe("EIP-3009 validation and identity", () => {
  test("requires the full exact authorization and rejects Permit2", () => {
    expect(decodeExactEvmPayload(exactPayload())?.authorization.to).toBe(RECIPIENT);
    expect(decodeExactEvmPayload({
      signature: "0x12",
      permit2Authorization: {},
    })).toBeNull();
    expect(decodeExactEvmPayload({
      ...exactPayload(),
      authorization: { ...exactPayload().authorization, nonce: "0x01" },
    })).toBeNull();
  });

  test("semantic identity ignores JSON order/address case/signature aliases", () => {
    const first = exactPayload();
    const second: ExactEvmPayload = {
      authorization: {
        nonce: first.authorization.nonce.toUpperCase().replace("0X", "0x"),
        validBefore: first.authorization.validBefore,
        validAfter: first.authorization.validAfter,
        value: first.authorization.value,
        to: first.authorization.to.toLowerCase(),
        from: first.authorization.from.toUpperCase().replace("0X", "0x"),
      },
      signature: `0x${"ab".repeat(65)}`,
    };
    expect(authorizationIdentityHash(REQUIREMENT, first))
      .toBe(authorizationIdentityHash(REQUIREMENT, second));
    expect(payloadHash(payment())).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("offline EIP-712 recovery verifies EOAs and defers smart-wallet-shaped signatures", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const unsigned = exactPayload({ from: account.address });
    const signature = await account.signTypedData({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 8453,
        verifyingContract: REQUIREMENT.asset,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: account.address,
        to: RECIPIENT,
        value: BigInt(unsigned.authorization.value),
        validAfter: 0n,
        validBefore: 1_700_000_060n,
        nonce: unsigned.authorization.nonce,
      },
    });
    const signed = { ...unsigned, signature };
    expect(await classifyExactEvmSignature(REQUIREMENT, signed)).toBe("eoa_verified");
    expect(await classifyExactEvmSignature(REQUIREMENT, {
      ...signed,
      authorization: { ...signed.authorization, value: "1" },
    })).toBe("facilitator_required");
    expect(await classifyExactEvmSignature(REQUIREMENT, {
      ...signed,
      signature: `0x${"ab".repeat(512)}`,
    })).toBe("facilitator_required");
  });
});

describe("createX402Verifier durable state machine", () => {
  test("production admission serializes and caps unresolved identities on the DB clock", () => {
    const source = readFileSync(
      new URL("../src/services/economy/x402-payments.ts", import.meta.url),
      "utf-8",
    );
    const migration = readFileSync(
      new URL("../migrations/20260711T120000_x402_v2_reconciliation.sql", import.meta.url),
      "utf-8",
    );
    expect(source).toMatch(/pg_advisory_xact_lock\(hashtextextended/);
    expect(source).toMatch(/status} IN \('inserted', 'pending', 'failed'\)/);
    expect(source).toMatch(/now\(\) - interval '10 minutes'/);
    expect(source).toMatch(/isNull\(x402Payments\.settlementAttemptedAt\)/);
    expect(migration).toMatch(
      /idx_x402_project_status_created[\s\S]*\(project_id, status, created_at\)/,
    );
    for (const column of [
      "pay_to", "max_timeout_seconds", "requirement_extra",
      "resource_info", "credits_purchased",
    ]) expect(migration).toContain(column);
  });

  test("persists before I/O, persists external receipt before one credit", async () => {
    const { deps, calls, rows } = makeDeps();
    const c = fakeContext();
    expect(await createX402Verifier(deps)(c, payment())).toBe(true);
    expect(calls.order).toEqual([
      "inserted", "pending", "verify", "settlement_attempted", "settle", "external", "finalize",
    ]);
    expect(calls.external).toBe(1);
    expect(calls.finalize).toBe(1);
    expect([...rows.values()][0]).toMatchObject({
      status: "settled",
      creditsApplied: POLICY.creditsRequired,
      receipt: { transaction: "0xtx" },
    });
    expect((c as unknown as { var: { project: { credits: number } } }).var.project.credits)
      .toBe(POLICY.creditsRequired);
  });

  test("EOA fast path skips read-only facilitator verify but still settles authoritatively", async () => {
    const { deps, calls } = makeDeps({
      classifyAuthorizationSignature: async () => "eoa_verified",
    });
    expect(await createX402Verifier(deps)(fakeContext(), payment())).toBe(true);
    expect(calls.order).toEqual([
      "inserted", "pending", "settlement_attempted", "settle", "external", "finalize",
    ]);
    expect(calls.verify).toBe(0);
    expect(calls.settle).toBe(1);
  });

  test("bounded smart-account signatures use facilitator verify behind admission", async () => {
    const smartPayment = payment({
      payload: {
        ...exactPayload(),
        signature: `0x${"ab".repeat(512)}`,
      },
    });
    const { deps, calls } = makeDeps({
      classifyAuthorizationSignature: async () => "facilitator_required",
    });
    expect(await createX402Verifier(deps)(fakeContext(), smartPayment)).toBe(true);
    expect(calls.order.slice(0, 4)).toEqual(["inserted", "pending", "verify", "settlement_attempted"]);
    expect(calls.verify).toBe(1);
  });

  test("client-additive extra never becomes authoritative facilitator requirements", async () => {
    const accepted = {
      ...REQUIREMENT,
      extra: { ...REQUIREMENT.extra, clientHint: "untrusted" },
    };
    let verifyRequirements: typeof REQUIREMENT | undefined;
    let settleRequirements: typeof REQUIREMENT | undefined;
    const { deps, rows } = makeDeps({
      facilitator: {
        async verify(requirements) {
          verifyRequirements = requirements;
          return { isValid: true, payer: PAYER };
        },
        async settle(requirements) {
          settleRequirements = requirements;
          return {
            success: true,
            transaction: "0xtx",
            network: requirements.network,
            payer: PAYER,
            amount: requirements.amount,
          };
        },
      },
    });
    expect(await createX402Verifier(deps)(fakeContext(), payment({ accepted }))).toBe(true);
    expect(verifyRequirements?.extra).toEqual(REQUIREMENT.extra);
    expect(settleRequirements?.extra).toEqual(REQUIREMENT.extra);
    expect(verifyRequirements?.extra).not.toHaveProperty("clientHint");
    expect([...rows.values()][0]?.requirementExtra).toEqual(REQUIREMENT.extra);
  });

  test("validates accepted requirement, resource, authorization and project before insert", async () => {
    const variants: Array<{ c?: Context; payment: PaymentPayload }> = [
      { payment: payment({ accepted: { ...REQUIREMENT, amount: "1" } }) },
      { payment: payment({ resource: { ...RESOURCE, url: "https://evil.example/v1/scrape" } }) },
      { payment: payment({ payload: exactPayload({ to: "0x2222222222222222222222222222222222222222" }) as unknown as Record<string, unknown> }) },
      { c: fakeContext(null), payment: payment() },
    ];
    for (const variant of variants) {
      const { deps, calls } = makeDeps();
      expect(await createX402Verifier(deps)(variant.c ?? fakeContext(), variant.payment))
        .toBe(false);
      expect(calls.order).toEqual([]);
    }
  });

  test("rejects stale/oversized authorization windows before insert", async () => {
    const cases: Array<Partial<ExactEvmPayload["authorization"]>> = [
      { validBefore: "1699999999" },
      { validAfter: "1700000010" },
      { validBefore: "1700009999" },
    ];
    for (const authorization of cases) {
      const { deps, calls } = makeDeps();
      const candidate = payment({
        payload: exactPayload(authorization) as unknown as Record<string, unknown>,
      });
      expect(await createX402Verifier(deps)(fakeContext(), candidate)).toBe(false);
      expect(calls.order).toEqual([]);
    }
  });

  test("bounds forged-signature classification behind durable admission", async () => {
    const { deps, calls, rows } = makeDeps({
      classifyAuthorizationSignature: async () => "invalid",
    });
    expect(await createX402Verifier(deps)(fakeContext(), payment())).toBe(false);
    expect(calls.order).toEqual(["inserted", "pending"]);
    expect([...rows.values()][0]?.status).toBe("failed");
    expect(calls.verify).toBe(0);
    expect(calls.settle).toBe(0);
  });

  test("accepts omitted V2 resource but rejects mutation when present", async () => {
    const { deps } = makeDeps();
    const withoutResource = payment();
    delete withoutResource.resource;
    expect(await createX402Verifier(deps)(fakeContext(), withoutResource)).toBe(true);
  });

  test("pending duplicates suppress a new challenge and I/O", async () => {
    for (const status of ["pending"] as const) {
      const row = existingRecord(status);
      const { deps, calls } = makeDeps({}, [row]);
      const app = new Hono<ProjectContext>();
      app.use("*", projectMiddleware());
      app.use("*", x402Middleware({
        buildPaymentRequired: () => buildPaymentRequired(RESOURCE, [REQUIREMENT]),
        verifyPayment: createX402Verifier(deps),
        buildSettlementHeader: settlementHeader,
      }));
      app.post("/v1/scrape", (c) => c.json({ error: "insufficient_credits" }, 402));
      const res = await app.request("http://localhost/v1/scrape", {
        method: "POST",
        headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(payment()) },
      });
      expect(res.status).toBe(402);
      expect(res.headers.get("payment-required")).toBeNull();
      expect(res.headers.get("payment-response")).toBeNull();
      expect(res.headers.get("link")).toContain(row.authorizationHash);
      expect(calls.verify).toBe(0);
      expect(calls.settle).toBe(0);
    }
  });

  test("durable admission cap or DB admission failure suppresses payment prompts", async () => {
    for (const mode of ["cap", "db"] as const) {
      const { deps, calls } = makeDeps({
        async insertOrGet() {
          if (mode === "db") throw new Error("db unavailable");
          return { record: null, inserted: false, admission: "rate_limited" };
        },
      });
      const app = new Hono<ProjectContext>();
      app.use("*", projectMiddleware());
      app.use("*", x402Middleware({
        buildPaymentRequired: () => buildPaymentRequired(RESOURCE, [REQUIREMENT]),
        verifyPayment: createX402Verifier(deps),
        buildSettlementHeader: settlementHeader,
      }));
      app.post("/v1/scrape", (c) => c.json({ error: "insufficient_credits" }, 402));
      const res = await app.request("http://localhost/v1/scrape", {
        method: "POST",
        headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(payment()) },
      });
      expect(res.headers.get("payment-required")).toBeNull();
      expect(res.headers.get("retry-after")).toBe("600");
      expect(calls.verify).toBe(0);
      expect(calls.settle).toBe(0);
    }
  });

  test("an inserted row is safely claimed by the inserted-to-pending CAS", async () => {
    const row = existingRecord("inserted");
    const { deps, calls } = makeDeps({}, [row]);
    expect(await createX402Verifier(deps)(fakeContext(), payment())).toBe(true);
    expect(calls.order).toEqual([
      "pending", "verify", "settlement_attempted", "settle", "external", "finalize",
    ]);
  });

  test("externally-settled duplicate finalizes once; settled duplicate never recredits", async () => {
    const row = existingRecord("externally_settled");
    const { deps, calls } = makeDeps({}, [row]);
    const first = fakeContext();
    expect(await createX402Verifier(deps)(first, payment())).toBe(true);
    expect(calls.finalize).toBe(1);
    expect(getStashedSettlement(first)?.transaction).toBe("0xdurable");

    const second = fakeContext();
    expect(await createX402Verifier(deps)(second, payment())).toBe(false);
    expect(calls.finalize).toBe(1);
    expect(getStashedSettlement(second)?.transaction).toBe("0xdurable");
    expect(calls.verify).toBe(0);
    expect(calls.settle).toBe(0);
  });

  test("recipient, network, origin and price drift cannot strand durable external credit", async () => {
    const oldRecipient = "0x9999999999999999999999999999999999999999";
    const oldRequirement = buildPaymentRequirements({
      amountAtomic: "7000",
      payTo: oldRecipient,
      network: "eip155:8453",
    });
    const oldResource = {
      ...RESOURCE,
      url: "https://old-api.example/v1/scrape",
      description: "Old immutable scrape purchase",
    };
    const oldExact = exactPayload({ to: oldRecipient, value: "7000" });
    const oldPayment = payment({
      accepted: oldRequirement,
      resource: oldResource,
      payload: oldExact as unknown as Record<string, unknown>,
    });
    const row = existingRecord("externally_settled", {
      requirement: oldRequirement,
      exact: oldExact,
      resource: oldResource,
      creditsPurchased: 7,
    });
    const { deps, calls } = makeDeps({
      recipient: () => "0x8888888888888888888888888888888888888888",
      expectedNetwork: () => "eip155:137",
      facilitatorReady: async () => { throw new Error("must not gate reconciliation"); },
    }, [row]);
    const context = fakeContext();
    expect(await createX402Verifier(deps)(context, oldPayment)).toBe(true);
    expect(calls.verify).toBe(0);
    expect(calls.settle).toBe(0);
    expect(calls.finalize).toBe(1);
    expect(row.creditsApplied).toBe(7);
    expect((context as unknown as { var: { project: { credits: number } } }).var.project.credits)
      .toBe(7);
  });

  test("stored Base-Sepolia rows are status-only when the runtime disallows testnet", async () => {
    const testnetRequirement = buildPaymentRequirements({
      amountAtomic: POLICY.amountAtomic,
      payTo: RECIPIENT,
      network: "eip155:84532",
    });
    const testnetExact = exactPayload();
    const testnetPayment = payment({
      accepted: testnetRequirement,
      payload: testnetExact as unknown as Record<string, unknown>,
    });
    for (const status of ["inserted", "externally_settled"] as const) {
      const row = existingRecord(status, {
        requirement: testnetRequirement,
        exact: testnetExact,
      });
      const { deps, calls } = makeDeps({
        storedNetworkMayApply: () => false,
      }, [row]);
      const context = fakeContext();
      expect(await createX402Verifier(deps)(context, testnetPayment)).toBe(false);
      expect(calls.order).toEqual([]);
      expect(calls.settle).toBe(0);
      expect(calls.finalize).toBe(0);
      expect((context as unknown as { _x402SuppressChallenge?: boolean })._x402SuppressChallenge)
        .toBe(true);
    }
  });

  test("expired durable pending/external duplicates still suppress or reconcile", async () => {
    const inserted = existingRecord("inserted");
    const insertedDeps = makeDeps({ nowSeconds: () => 1_800_000_000 }, [inserted]);
    const insertedContext = fakeContext();
    expect(await createX402Verifier(insertedDeps.deps)(insertedContext, payment())).toBe(false);
    expect(insertedDeps.calls.order).toEqual([]);
    expect((insertedContext as unknown as { _x402SuppressChallenge?: boolean })._x402SuppressChallenge)
      .toBe(true);

    const pending = existingRecord("pending");
    const pendingDeps = makeDeps({ nowSeconds: () => 1_800_000_000 }, [pending]);
    const pendingContext = fakeContext();
    expect(await createX402Verifier(pendingDeps.deps)(pendingContext, payment())).toBe(false);
    expect((pendingContext as unknown as { _x402SuppressChallenge?: boolean })._x402SuppressChallenge)
      .toBe(true);

    const external = existingRecord("externally_settled");
    const externalDeps = makeDeps({ nowSeconds: () => 1_800_000_000 }, [external]);
    expect(await createX402Verifier(externalDeps.deps)(fakeContext(), payment())).toBe(true);
    expect(externalDeps.calls.finalize).toBe(1);
  });

  test("definitive verify failure is failed and may issue a fresh challenge", async () => {
    const { deps, calls } = makeDeps({
      facilitator: {
        async verify() { return { isValid: false, invalidReason: "bad_signature" }; },
        async settle() { throw new Error("must not settle"); },
      },
    });
    const c = fakeContext();
    expect(await createX402Verifier(deps)(c, payment())).toBe(false);
    expect(calls.failed).toEqual([{ reason: "bad_signature", receipt: false }]);
  });

  test("definitive settle failure persists and emits its receipt while allowing a fresh challenge", async () => {
    const failedReceipt = {
      success: false,
      transaction: "",
      network: "eip155:8453" as const,
      payer: PAYER,
      errorReason: "insufficient_funds",
    };
    const { deps, calls, rows } = makeDeps({
      facilitator: {
        async verify() { return { isValid: true, payer: PAYER }; },
        async settle() { return failedReceipt; },
      },
    });
    const app = new Hono<ProjectContext>();
    app.use("*", projectMiddleware());
    app.use("*", x402Middleware({
      buildPaymentRequired: () => buildPaymentRequired(RESOURCE, [REQUIREMENT]),
      verifyPayment: createX402Verifier(deps),
      buildSettlementHeader: settlementHeader,
    }));
    app.post("/v1/scrape", (c) => c.json({ error: "insufficient_credits" }, 402));
    const res = await app.request("http://localhost/v1/scrape", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(payment()) },
    });
    expect(res.headers.get("payment-response")).toBeTruthy();
    expect(res.headers.get("payment-required")).toBeTruthy();
    expect(calls.failed).toEqual([{ reason: "insufficient_funds", receipt: true }]);
    expect([...rows.values()][0]).toMatchObject({
      status: "failed",
      failureReason: "insufficient_funds",
      receipt: failedReceipt,
    });
  });

  test("ambiguous verify/settle I/O stays pending and never rechallenges", async () => {
    for (const point of ["verify", "settle"] as const) {
      const { deps, rows } = makeDeps({
        facilitator: {
          async verify() {
            if (point === "verify") throw new Error("timeout");
            return { isValid: true, payer: PAYER };
          },
          async settle() { throw new Error("connection reset"); },
        },
      });
      const app = new Hono<ProjectContext>();
      app.use("*", projectMiddleware());
      app.use("*", x402Middleware({
        buildPaymentRequired: () => buildPaymentRequired(RESOURCE, [REQUIREMENT]),
        verifyPayment: createX402Verifier(deps),
        buildSettlementHeader: settlementHeader,
      }));
      app.post("/v1/scrape", (c) => c.json({ error: "insufficient_credits" }, 402));
      const res = await app.request("http://localhost/v1/scrape", {
        method: "POST",
        headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(payment()) },
      });
      expect(res.headers.get("payment-required")).toBeNull();
      expect(res.headers.get("link")).toContain("payment-status");
      expect([...rows.values()][0]?.status).toBe("pending");
    }
  });

  test("invalid success receipt is ambiguous and never rechallenges", async () => {
    const { deps } = makeDeps({
      facilitator: {
        async verify() { return { isValid: true, payer: PAYER }; },
        async settle() {
          return {
            success: true,
            transaction: "0xtx",
            network: "eip155:8453",
            payer: PAYER,
            amount: "1",
          };
        },
      },
    });
    const c = fakeContext();
    expect(await createX402Verifier(deps)(c, payment())).toBe(false);
    expect((c as unknown as { _x402SuppressChallenge?: boolean })._x402SuppressChallenge)
      .toBe(true);
  });

  test("local finalize failure leaves durable external state and emits receipt", async () => {
    const { deps, rows, calls } = makeDeps({
      async finalizeCredits() {
        calls.order.push("finalize");
        calls.finalize += 1;
        throw new Error("transaction rollback");
      },
    });
    const app = new Hono<ProjectContext>();
    app.use("*", projectMiddleware());
    app.use("*", x402Middleware({
      buildPaymentRequired: () => buildPaymentRequired(RESOURCE, [REQUIREMENT]),
      verifyPayment: createX402Verifier(deps),
      buildSettlementHeader: settlementHeader,
    }));
    app.post("/v1/scrape", (c) => c.json({ error: "insufficient_credits" }, 402));
    const res = await app.request("http://localhost/v1/scrape", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(payment()) },
    });
    expect([...rows.values()][0]?.status).toBe("externally_settled");
    expect(res.headers.get("payment-response")).toBeTruthy();
    expect(res.headers.get("payment-required")).toBeNull();
    expect(res.headers.get("link")).toContain("payment-status");
  });

  test("settlement receipt and refreshed balance survive downstream 400", async () => {
    const { deps } = makeDeps();
    const app = new Hono<ProjectContext>();
    app.use("*", projectMiddleware());
    app.use("*", x402Middleware({
      buildPaymentRequired: () => null,
      verifyPayment: createX402Verifier(deps),
      buildSettlementHeader: settlementHeader,
    }));
    app.use("*", rateLimitHeaders());
    app.post("/v1/scrape", (c) => c.json({ error: "invalid_body" }, 400));
    const res = await app.request("http://localhost/v1/scrape", {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encodeCanonicalBase64Json(payment()) },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("payment-response")).toBeTruthy();
    expect(res.headers.get("x-credits-balance")).toBe(String(POLICY.creditsRequired));
    expect(getX402Payment).toBeDefined();
  });
});

describe("project-scoped payment status route", () => {
  test("disallowed Base-Sepolia status never promises settlement or credit application", async () => {
    const requirement = buildPaymentRequirements({
      amountAtomic: POLICY.amountAtomic,
      payTo: RECIPIENT,
      network: "eip155:84532",
    });
    for (const status of ["inserted", "pending", "externally_settled"] as const) {
      const row = existingRecord(status, { requirement });
      const router = createX402PaymentsRouter(
        async () => row,
        () => 1_700_000_020_000,
        () => false,
      );
      const app = new Hono<ProjectContext>();
      app.use("*", projectMiddleware());
      app.route("/v1/x402/payments", router);
      const response = await app.request(`/v1/x402/payments/${row.authorizationHash}`);
      expect(response.headers.get("retry-after")).toBeNull();
      expect(await response.json()).toMatchObject({
        next_action: "payment_network_not_applicable_in_current_environment",
        retry_after_seconds: null,
      });
    }
  });

  test("pending/no-marker status waits through validBefore grace then directs a no-signature challenge", async () => {
    const row = existingRecord("pending");
    const load = async () => row;

    const liveApp = new Hono<ProjectContext>();
    liveApp.use("*", projectMiddleware());
    liveApp.route(
      "/v1/x402/payments",
      createX402PaymentsRouter(load, () => 1_700_000_020_000),
    );
    const live = await liveApp.request(`/v1/x402/payments/${row.authorizationHash}`);
    expect(live.headers.get("retry-after")).toBe("45");
    expect(await live.json()).toMatchObject({
      next_action: "await_current_attempt",
      retry_after_seconds: 45,
    });

    const expiredApp = new Hono<ProjectContext>();
    expiredApp.use("*", projectMiddleware());
    expiredApp.route(
      "/v1/x402/payments",
      createX402PaymentsRouter(load, () => 1_700_000_066_000),
    );
    const expired = await expiredApp.request(`/v1/x402/payments/${row.authorizationHash}`);
    expect(expired.headers.get("retry-after")).toBeNull();
    expect(await expired.json()).toMatchObject({
      next_action: "request_fresh_challenge_without_payment_signature",
      retry_after_seconds: null,
      reconciles: "payment_and_project_credit_only",
    });
  });

  test("expired inserted status directs a fresh no-signature challenge", async () => {
    const row = existingRecord("inserted");
    const router = createX402PaymentsRouter(
      async () => row,
      () => 1_700_000_061_000,
    );
    const app = new Hono<ProjectContext>();
    app.use("*", projectMiddleware());
    app.route("/v1/x402/payments", router);
    const response = await app.request(`/v1/x402/payments/${row.authorizationHash}`);
    expect(await response.json()).toMatchObject({
      next_action: "request_fresh_challenge_without_payment_signature",
    });
  });

  test("passes authenticated project id, returns failure detail, and is no-store", async () => {
    const row = existingRecord("failed");
    row.failureReason = "bad_signature";
    let seenProject = "";
    const router = createX402PaymentsRouter(async (projectId, hash) => {
      seenProject = projectId;
      return hash === row.authorizationHash ? row : null;
    });
    const app = new Hono<ProjectContext>();
    app.use("*", projectMiddleware());
    app.route("/v1/x402/payments", router);
    const res = await app.request(`/v1/x402/payments/${row.authorizationHash}`);
    expect(seenProject).toBe(PROJECT_ID);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({
      payment_id: row.authorizationHash,
      status: "failed",
      failure_reason: "bad_signature",
      reconciles: "payment_and_project_credit_only",
    });
  });

  test("malformed and missing ids are no-store 404", async () => {
    const router = createX402PaymentsRouter(async () => null);
    const app = new Hono<ProjectContext>();
    app.use("*", projectMiddleware());
    app.route("/v1/x402/payments", router);
    for (const id of ["bad", "a".repeat(64)]) {
      const res = await app.request(`/v1/x402/payments/${id}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});
