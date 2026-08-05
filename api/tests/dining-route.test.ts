/** /v1/dining — manifest and party-scoped projection route tests.
 *
 * Pure HTTP tests with an injected invocation reader; no DB or bearer.
 * Doctrine: docs/AGENT-DINING.md.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import {
  createDiningRouter,
  type DiningService,
} from "../src/routes/dining";
import type { InvocationOut } from "../src/services/marketplace/invocations";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const INVOCATION_ID = "33333333-3333-4333-8333-333333333333";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";

function row(buyerProjectId = PROJECT_ID): InvocationOut {
  return {
    id: INVOCATION_ID,
    listing_id: LISTING_ID,
    buyer_did: "did:at:private-buyer",
    buyer_identity_id: "55555555-5555-4555-8555-555555555555",
    buyer_project_id: buyerProjectId,
    buyer_wallet_id: "66666666-6666-4666-8666-666666666666",
    amount: 1200,
    currency: "GBP",
    escrow_id: "77777777-7777-4777-8777-777777777777",
    input_sealed: {
      ct: "very-secret-order",
      nonce: "very-secret-order-nonce",
      sender_pub: "very-secret-order-key",
    },
    output_sealed: null,
    completion_sig: null,
    status: "acknowledged",
    refund_reason: null,
    sla_deadline_at: "2026-08-05T13:00:00.000Z",
    metadata: {
      private_note: "do-not-project-me",
      listing_contract_snapshot: {
        capability_tags: ["agent-dining"],
        protocol: "agent-dining/0.1",
        service_model: "whole_meal_in_one_signed_completion",
        listing_updated_at: "2026-08-05T11:55:00.000Z",
      },
    },
    created_at: "2026-08-05T12:00:00.000Z",
    acknowledged_at: "2026-08-05T12:01:00.000Z",
    completed_at: null,
    settled_at: null,
    buyer_review_deadline_at: null,
    contract_profile: "agent-dining/0.1",
  };
}

function appFor(service: DiningService) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID } as never);
    await next();
  });
  app.route("/v1/dining", createDiningRouter(service));
  return app;
}

describe("GET /v1/dining", () => {
  test("is mounted behind auth and rate-limit headers for root and child reads", () => {
    const index = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8");
    expect(index).toContain('app.use("/v1/dining", authMiddleware);');
    expect(index).toContain('app.use("/v1/dining/*", authMiddleware);');
    expect(index).toContain('app.use("/v1/dining", rateLimitHeaders());');
    expect(index).toContain('app.use("/v1/dining/*", rateLimitHeaders());');
    expect(index).toContain('app.route("/v1/dining", diningRouter);');
  });

  test("returns the protocol, economy journey, schemas, and safe next verbs", async () => {
    let reads = 0;
    const app = appFor({
      async getJourneyContext() {
        reads += 1;
        return null;
      },
    });

    const response = await app.request("/v1/dining");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body._format).toBe("agent-dining-manifest/0.1");
    expect(body.protocol).toBe("agent-dining/0.1");
    expect(body.economy_binding.automatic_action).toBe("never");
    expect(body.schemas.sealed_order_plaintext.additionalProperties).toBe(false);
    expect(body.honest_boundary.not_implemented).toContain("partial settlement");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/AGENT-DINING");
    expect(body.verbs.some((verb: { path: string }) => verb.path.includes("/quote"))).toBe(true);
    expect(reads).toBe(0);
  });

  test("keeps mixed-profile SLA attention inspection-first", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "services", "wake", "attention.ts"),
      "utf8",
    );
    const start = source.indexOf('kind: "invocation_sla_breach"');
    const end = source.indexOf('kind: "bridge_disconnected"', start);
    const slaAttention = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(slaAttention).toContain('method: "GET", path: "/v1/invocations/{id}"');
    expect(slaAttention).not.toContain('/complete');
    expect(slaAttention).not.toContain('method: "POST"');
  });
});

describe("GET /v1/dining/:invocationId", () => {
  test("projects the buyer as guest and passes exact auth scope to the reader", async () => {
    const calls: Array<[string, string]> = [];
    const app = appFor({
      async getJourneyContext(invocationId, callerProjectId) {
        calls.push([invocationId, callerProjectId]);
        return { invocation: row(), sellerProjectId: OTHER_PROJECT_ID };
      },
    });

    const response = await app.request(`/v1/dining/${INVOCATION_ID}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(calls).toEqual([[INVOCATION_ID, PROJECT_ID]]);
    expect(body.roles).toEqual(["guest"]);
    expect(body.stage).toBe("seller_acknowledged_invocation");
    expect(body.verbs.some((verb: { path: string }) => verb.path === `/v1/dining/${INVOCATION_ID}`)).toBe(true);
  });

  test("projects an already-authorized listing owner as host", async () => {
    const app = appFor({
      async getJourneyContext() {
        return { invocation: row(OTHER_PROJECT_ID), sellerProjectId: PROJECT_ID };
      },
    });

    const response = await app.request(`/v1/dining/${INVOCATION_ID}`);
    const body = await response.json();
    expect(body.roles).toEqual(["host"]);
    expect(body.next_actions.map((action: { path: string | null }) => action.path)).toContain(
      "/v1/inbox/box-keys/{buyer_did}",
    );
    expect(body.next_actions.map((action: { path: string | null }) => action.path)).toContain(
      `/v1/invocations/${INVOCATION_ID}/complete`,
    );
  });

  test("does not echo plaintext-sensitive marketplace fields", async () => {
    const app = appFor({
      async getJourneyContext() {
        return { invocation: row(), sellerProjectId: OTHER_PROJECT_ID };
      },
    });

    const response = await app.request(`/v1/dining/${INVOCATION_ID}`);
    const json = await response.text();
    for (const secret of [
      "did:at:private-buyer",
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
      "very-secret-order",
      "do-not-project-me",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  test("returns guided 400 for a malformed invocation ID without reading storage", async () => {
    let reads = 0;
    const app = appFor({
      async getJourneyContext() {
        reads += 1;
        return { invocation: row(), sellerProjectId: OTHER_PROJECT_ID };
      },
    });

    const response = await app.request("/v1/dining/not-a-uuid");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("validation");
    expect(body.hint).toContain("invocation ID");
    expect(reads).toBe(0);
  });

  test("keeps absence and non-party scope indistinguishable", async () => {
    const app = appFor({
      async getJourneyContext() {
        return null;
      },
    });

    const response = await app.request(`/v1/dining/${INVOCATION_ID}`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("dining_journey_not_found");
    expect(body.message).toContain("absent or does not belong");
    expect(body.next_actions).toHaveLength(2);
  });

  test("keeps a legacy forged metadata snapshot indistinguishable from absent", async () => {
    const ordinary = row();
    ordinary.contract_profile = null;
    ordinary.metadata = {
      listing_contract_snapshot: {
        capability_tags: ["agent-dining"],
        protocol: "agent-dining/0.1",
        service_model: "whole_meal_in_one_signed_completion",
        listing_updated_at: "2026-08-05T11:55:00.000Z",
      },
    };
    const app = appFor({
      async getJourneyContext() {
        return { invocation: ordinary, sellerProjectId: OTHER_PROJECT_ID };
      },
    });

    const response = await app.request(`/v1/dining/${INVOCATION_ID}`);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("dining_journey_not_found");
  });

  test("represents both guest and host roles when one project owns distinct parties", async () => {
    const app = appFor({
      async getJourneyContext() {
        return { invocation: row(PROJECT_ID), sellerProjectId: PROJECT_ID };
      },
    });

    const response = await app.request(`/v1/dining/${INVOCATION_ID}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.roles).toEqual(["guest", "host"]);
    expect(body.verbs.map((verb: { path: string }) => verb.path)).toContain(
      `/v1/invocations/${INVOCATION_ID}/complete`,
    );
  });

  test("production route depends on the pure reader rather than the lazy SLA-sweeping reader", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "routes", "dining.ts"), "utf8");
    expect(source).toContain("peekInvocation");
    expect(source).not.toMatch(/\bgetInvocation\b/);
  });
});
