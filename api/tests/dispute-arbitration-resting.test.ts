import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import disputeCasesRouter from "../src/routes/dispute-cases";
import listingsRouter, { invocationsRouter } from "../src/routes/listings";
import openapiRouter from "../src/routes/openapi";
import {
  AGENT_TXT_SAFETY,
  SAFETY_BOUNDARIES,
  WAKE_SAFETY_BOUNDARIES,
} from "../src/services/discovery/safety-boundaries";
import {
  assertDisputeArbitrationAvailable,
  DISPUTE_ARBITRATION_RESTING_CODE,
  DISPUTE_ARBITRATION_RESTING_MESSAGE,
} from "../src/services/marketplace/dispute-rest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const disputeRoutes = source("../src/routes/dispute-cases.ts");
const listingRoutes = source("../src/routes/listings.ts");
const publicListingRoutes = source("../src/routes/public/listings.ts");
const disputeService = source("../src/services/marketplace/disputes.ts");
const listingService = source("../src/services/marketplace/listings.ts");
const invocationService = source("../src/services/marketplace/invocations.ts");
const migration = source(
  "../migrations/20260713T150000_dispute_arbitration_resting.sql",
);

function sourceSlice(body: string, start: string, end?: string): string {
  const startAt = body.indexOf(start);
  const endAt = end ? body.indexOf(end, startAt + start.length) : body.length;
  expect(startAt).toBeGreaterThanOrEqual(0);
  expect(endAt).toBeGreaterThan(startAt);
  return body.slice(startAt, endAt);
}

async function expectRestingResponse(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: DISPUTE_ARBITRATION_RESTING_CODE,
    hint: DISPUTE_ARBITRATION_RESTING_MESSAGE,
    retryable: false,
    docs: "/public/safety",
  });
}

describe("dispute arbitration resting routes", () => {
  test("the shared boundary throws the stable 503 code", () => {
    try {
      assertDisputeArbitrationAvailable();
      throw new Error("expected dispute arbitration to be resting");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(503);
      expect((error as Error).message).toBe(
        DISPUTE_ARBITRATION_RESTING_CODE,
      );
    }
  });

  test("rule, escalate, vote, and finalize return 503 without parsing a body", async () => {
    for (const action of ["rule", "escalate", "vote", "finalize"]) {
      const response = await disputeCasesRouter.request(`/case-id/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{malformed-json",
      });
      await expectRestingResponse(response);
    }
  });

  test("invocation accept and dispute return 503 without parsing or charging", async () => {
    for (const action of ["accept", "dispute"]) {
      const response = await invocationsRouter.request(`/invocation-id/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{malformed-json",
      });
      await expectRestingResponse(response);
    }
  });

  test("listing policy creation and patching return 503 before charge", async () => {
    const create = await listingsRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seller_identity_id: "11111111-1111-4111-8111-111111111111",
        seller_wallet_id: "22222222-2222-4222-8222-222222222222",
        name: "Resting policy",
        price_amount: 1,
        price_currency: "GBP",
        dispute_policy: { arbiter_claim: "self-asserted-claim" },
      }),
    });
    await expectRestingResponse(create);

    const patch = await listingsRouter.request(
      "/33333333-3333-4333-8333-333333333333",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dispute_policy: { arbiter_claim: "self-asserted-claim" },
        }),
      },
    );
    await expectRestingResponse(patch);

    for (const route of [
      sourceSlice(
        listingRoutes,
        'app.post("/", async (c) => {',
        "// ── GET /v1/listings",
      ),
      sourceSlice(
        listingRoutes,
        'app.patch("/:id", async (c) => {',
        "// ── DELETE /v1/listings",
      ),
    ]) {
      const restAt = route.indexOf("disputeArbitrationRestResponse(c)");
      expect(restAt).toBeGreaterThanOrEqual(0);
      expect(restAt).toBeLessThan(route.indexOf("await charge(c,"));
    }
  });

  test("the mounted mutation handlers contain no charge or request-body work", () => {
    for (const action of ["rule", "escalate", "vote", "finalize"]) {
      const handler = sourceSlice(
        disputeRoutes,
        `app.post(\"/:id/${action}\"`,
        "\n});",
      );
      expect(handler).toContain("disputeArbitrationRestResponse(c)");
      expect(handler).not.toContain("c.req.json");
      expect(handler).not.toContain("charge(c,");
    }

    for (const action of ["accept", "dispute"]) {
      const handler = sourceSlice(
        listingRoutes,
        `invocationsRouter.post(\"/:id/${action}\"`,
        "\n});",
      );
      expect(handler).toContain("disputeArbitrationRestResponse(c)");
      expect(handler).not.toContain("c.req.json");
      expect(handler).not.toContain("charge(c,");
    }
  });

  test("OpenAPI exposes only 503 on every resting mutation", async () => {
    const spec = await (await openapiRouter.request("/")).json() as any;
    for (const path of [
      "/v1/invocations/{id}/accept",
      "/v1/invocations/{id}/dispute",
      "/v1/dispute-cases/{id}/rule",
      "/v1/dispute-cases/{id}/escalate",
      "/v1/dispute-cases/{id}/vote",
      "/v1/dispute-cases/{id}/finalize",
    ]) {
      const responses = spec.paths[path].post.responses;
      expect(Object.keys(responses)).toEqual(["503"]);
      expect(
        responses["503"].content["application/json"].schema.properties.error.const,
      ).toBe(DISPUTE_ARBITRATION_RESTING_CODE);
    }
    expect(spec.paths["/v1/listings"].post.responses["503"]).toBeDefined();
    expect(spec.paths["/v1/listings/{id}"].patch.responses["503"]).toBeDefined();
    expect(spec.paths["/v1/invocations/{id}/complete"].post.responses["503"]).toBeDefined();
  });

  test("OpenAPI publishes both read-only historical dispute views without active arbitration claims", async () => {
    const spec = await (await openapiRouter.request("/")).json() as any;
    const filed = spec.paths["/v1/dispute-cases"].get;
    const publicCase = spec.paths["/public/dispute-cases/{id}"].get;

    expect(filed.security).toBeUndefined();
    expect(filed.description).toMatch(
      /read-only.*bearer project is the filer.*only supported role is filer.*does not advance deadlines.*lazy arbitration transition/is,
    );
    expect(filed.parameters.find((parameter: any) => parameter.name === "role").schema)
      .toEqual({ type: "string", enum: ["filer"], default: "filer" });
    expect(filed.responses["200"].content["application/json"].schema.required)
      .toEqual(["dispute_cases", "count", "role"]);
    expect(filed.responses["400"].description).toMatch(/role_unsupported.*role=filer/is);

    expect(publicCase.security).toEqual([]);
    expect(publicCase.description).toMatch(
      /unauthenticated.*read-only.*evidence and project identifiers are omitted.*arbitration is resting.*no claim.*qualification.*fairness.*signatures.*pool selection.*verifiable or reproducible/is,
    );
    const projection = publicCase.responses["200"].content["application/json"].schema;
    expect(projection.required).toContain("pool_votes");
    expect(projection.required).toContain("_note");
    expect(projection.properties).not.toHaveProperty("evidence");
    expect(projection.properties).not.toHaveProperty("filer_project_id");
    expect(projection.properties).not.toHaveProperty("filer_identity_id");
    expect(publicCase.responses["404"]).toBeDefined();
    expect(spec.paths["/public/dispute-cases/{id}"].post).toBeUndefined();
  });

  test("authenticated dispute reads contain no lazy mutation", () => {
    expect(disputeRoutes).not.toContain("maybeExpireFirstArbiterSla");
  });

  test("live safety projections state the resting boundary", () => {
    expect(SAFETY_BOUNDARIES.conditional_services.dispute_arbitration).toMatch(
      /resting.*503.*62 listings.*112 invocations.*zero dispute cases.*zero bonds.*does not currently claim a qualified arbiter pool or route money/is,
    );
    expect(AGENT_TXT_SAFETY["Dispute-Arbitration"]).toMatch(
      /resting.*503.*no current qualified-arbiter.*money-routing claim/is,
    );
    expect(WAKE_SAFETY_BOUNDARIES.dispute_arbitration).toMatch(
      /resting_arbitration_routes_stable_503.*legacy_policy_listings_not_invokable.*no_current_qualified_arbiter_or_ruling_based_money_routing_claim/,
    );
  });

  test("the public quote marks legacy policies unavailable and never enables disputes", () => {
    const quote = sourceSlice(
      publicListingRoutes,
      'app.get("/:id/quote"',
      "export default app",
    );
    expect(quote).toContain("invocation_available: !disputePolicyPresent");
    expect(quote).toContain(
      'unavailable_reason: disputePolicyPresent\n      ? "dispute_arbitration_resting"',
    );
    expect(quote).toContain("disputes_enabled: false");
    expect(quote).not.toContain("disputes_enabled: true");

    const legacyNote = sourceSlice(
      quote,
      "(disputePolicyPresent",
      ': "Completion releases escrow',
    );
    expect(legacyNote).toContain("Do not invoke this listing while resting.");
    expect(legacyNote).not.toContain("To invoke:");

    const availableNote = sourceSlice(
      quote,
      ': "Completion releases escrow',
      '"See docs/MARKETPLACE.md."',
    );
    expect(availableNote).toContain(
      "To invoke: POST /v1/listings/:id/invoke.",
    );
  });
});

describe("dispute arbitration resting services", () => {
  test("every arbitration mutation fails before database or state work", () => {
    const mutations = [
      ["export async function fileDispute", "export async function submitFirstRuling"],
      ["export async function submitFirstRuling", "export async function escalateDispute"],
      ["export async function escalateDispute", "export async function submitPoolVote"],
      ["export async function submitPoolVote", "export async function finalizeCase"],
      ["export async function finalizeCase", "export async function disputerSummary"],
      ["export async function maybeExpireFirstArbiterSla", undefined],
    ] as const;

    for (const [start, end] of mutations) {
      const body = sourceSlice(disputeService, start, end);
      const guardAt = body.indexOf("assertDisputeArbitrationAvailable();");
      const databaseAt = body.indexOf("db.transaction");
      expect(guardAt).toBeGreaterThanOrEqual(0);
      expect(databaseAt).toBeGreaterThan(guardAt);
    }

    const accept = sourceSlice(
      invocationService,
      "export async function buyerAcceptInvocation",
    );
    expect(accept.indexOf("assertDisputeArbitrationAvailable();")).toBeLessThan(
      accept.indexOf("db.transaction"),
    );
  });

  test("listing create and patch reject a policy before database access", () => {
    for (const operation of [
      sourceSlice(
        listingService,
        "export async function createListing",
        "export async function getListing",
      ),
      sourceSlice(
        listingService,
        "export async function patchListing",
        "export async function listingSummaryForProject",
      ),
    ]) {
      const guardAt = operation.indexOf("assertDisputeArbitrationAvailable();");
      const databaseAt = operation.indexOf("await db");
      expect(guardAt).toBeGreaterThanOrEqual(0);
      expect(databaseAt).toBeGreaterThan(guardAt);
    }
  });

  test("completion refuses a legacy policy before status or money changes", () => {
    const complete = sourceSlice(
      invocationService,
      "export async function completeInvocation",
      "export async function declineInvocation",
    );
    const guardAt = complete.indexOf("assertDisputeArbitrationAvailable();");
    expect(complete).toContain(
      "listing.disputePolicy !== null && listing.disputePolicy !== undefined",
    );
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeLessThan(complete.indexOf('inv.status !== "acknowledged"'));
    expect(guardAt).toBeLessThan(complete.indexOf("verifyInvocationCompletion({"));
    expect(guardAt).toBeLessThan(complete.indexOf(".update(wallets)"));
  });

  test("invocation creation refuses a legacy policy before buyer or money work", () => {
    const invoke = sourceSlice(
      invocationService,
      "export async function invokeListing",
      "export async function acknowledgeInvocation",
    );
    const listingAt = invoke.indexOf(".from(listings)");
    const guardAt = invoke.indexOf("assertDisputeArbitrationAvailable();");
    const buyerAt = invoke.indexOf(".from(identities)");
    const walletAt = invoke.indexOf(".from(wallets)");
    const transactionAt = invoke.indexOf("db.transaction");

    expect(invoke).toContain(
      "listing.disputePolicy !== null && listing.disputePolicy !== undefined",
    );
    expect(listingAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeGreaterThan(listingAt);
    expect(guardAt).toBeLessThan(buyerAt);
    expect(guardAt).toBeLessThan(walletAt);
    expect(guardAt).toBeLessThan(transactionAt);
  });

  test("acknowledgement reads the policy and rests before state or SLA work", () => {
    const acknowledge = sourceSlice(
      invocationService,
      "export async function acknowledgeInvocation",
      "export interface CompleteInput",
    );
    const listingAt = acknowledge.indexOf(".from(listings)");
    const guardAt = acknowledge.indexOf("assertDisputeArbitrationAvailable();");

    expect(acknowledge).toContain(
      "disputePolicy: listings.disputePolicy",
    );
    expect(acknowledge).toContain(
      "listing.disputePolicy !== null && listing.disputePolicy !== undefined",
    );
    expect(guardAt).toBeGreaterThan(listingAt);
    expect(guardAt).toBeLessThan(
      acknowledge.indexOf('inv.status !== "escrowed"'),
    );
    expect(guardAt).toBeLessThan(
      acknowledge.indexOf("if (inv.slaDeadlineAt"),
    );
    expect(guardAt).toBeLessThan(acknowledge.indexOf(".update(invocations)"));
  });
});

describe("dispute arbitration resting migration", () => {
  test("the database validates a NULL-only listing policy constraint", () => {
    const addAt = migration.indexOf(
      "ADD CONSTRAINT listings_dispute_policy_resting",
    );
    const validateAt = migration.indexOf(
      "VALIDATE CONSTRAINT listings_dispute_policy_resting",
    );
    expect(addAt).toBeGreaterThanOrEqual(0);
    expect(migration).toContain("CHECK (dispute_policy IS NULL) NOT VALID");
    expect(validateAt).toBeGreaterThan(addAt);
    expect(migration).not.toMatch(
      /UPDATE\s+marketplace\.listings|DELETE\s+FROM\s+marketplace\.listings/i,
    );
  });
});
