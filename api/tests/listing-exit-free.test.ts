/** Deletion scopes wave 1 (Q8 A): taking a listing down is free.
 *
 *  Before: DELETE /v1/listings/:id charged 1 credit before it looked the
 *  listing up, so a 404 had already debited the price, and a PATCH to
 *  status "archived" or "paused" cost the 1-credit update price.
 *
 *  Now: archive and pause are 0 credits; DELETE resolves ownership first, so
 *  an unknown or foreign id writes nothing; a PATCH whose only change is an
 *  off-switch status costs 0, while any other change keeps the update price.
 *
 *  Hermetic: the real router, charge() and listing store over a pg-proxy
 *  transport. Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §14. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../src/auth/middleware";
import { listings } from "../src/db/schema/marketplace";

const VIEWER = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LISTING = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const WHEN = "2026-10-12T09:00:00.000Z";

type Query = { sql: string; params: unknown[] };
let queries: Query[] = [];
let owner: string | null = VIEWER;

function listingRow(status: string) {
  const values: Record<string, unknown> = {
    id: LISTING, sellerIdentityId: LISTING, sellerDid: `did:at:${LISTING}`, projectId: owner,
    name: "a small tool", description: null, capabilityTags: [], inputSchema: null,
    outputSchema: null, pricingModel: "per_invocation", priceAmount: 10, priceCurrency: "credits",
    sellerWalletId: LISTING, slaSeconds: null, visibility: "public", status,
    invocationsCount: 0, revenueTotal: 0, revenueCount: 0, disputePolicy: null, metadata: {},
    createdAt: WHEN, updatedAt: WHEN,
  };
  return Object.keys(getTableColumns(listings)).map((key) => values[key] ?? null);
}

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('select') && sql.includes('from "marketplace"."listings"')) {
    if (!owner) return { rows: [] };
    // patchListing scopes its own read by project; getListing does not.
    if (sql.includes('"marketplace"."listings"."project_id" = $') && owner !== VIEWER) {
      return { rows: [] };
    }
    return { rows: [listingRow("active")] };
  }
  if (sql.startsWith('update "marketplace"."listings"')) {
    const status = params.find((value) => value === "archived" || value === "paused") ?? "active";
    return { rows: [listingRow(String(status))] };
  }
  return { rows: [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) =>
  fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

const { default: listingsRouter, statusOnlyOffSwitch } = await import("../src/routes/listings");
const { MARKETPLACE_PRICING } = await import("../src/billing/marketplace-pricing");

function app() {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: VIEWER, credits: 100 } as never);
    await next();
  });
  server.route("/v1/listings", listingsRouter);
  server.onError((err, c) =>
    err instanceof HTTPException ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500),
  );
  return server;
}

const usageInserts = () => queries.filter((q) => q.sql.startsWith('insert into "tools"."usage_events"'));
const creditDebits = () => queries.filter((q) => q.sql.startsWith('update "tools"."projects"'));

beforeEach(() => {
  queries = [];
  owner = VIEWER;
});

describe("listing off-switches cost nothing", () => {
  test("the price table makes archive and pause free and keeps update priced", () => {
    expect(MARKETPLACE_PRICING.archive).toBe(0);
    expect(MARKETPLACE_PRICING.pause).toBe(0);
    expect(MARKETPLACE_PRICING.update).toBeGreaterThan(0);
  });

  test("statusOnlyOffSwitch recognises only a lone archived or paused status", () => {
    expect(statusOnlyOffSwitch({ status: "archived" })).toBe("archived");
    expect(statusOnlyOffSwitch({ status: "paused" })).toBe("paused");
    expect(statusOnlyOffSwitch({ status: "archived", name: undefined })).toBe("archived");
    expect(statusOnlyOffSwitch({ status: "active" })).toBeNull();
    expect(statusOnlyOffSwitch({ status: "archived", name: "renamed" })).toBeNull();
    expect(statusOnlyOffSwitch({ status: "paused", dispute_policy: null })).toBeNull();
    expect(statusOnlyOffSwitch({})).toBeNull();
  });

  test("DELETE of an owned listing archives it and records a zero-credit event", async () => {
    const response = await app().request(`/v1/listings/${LISTING}`, { method: "DELETE" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.archived).toBe(true);
    expect(body.status).toBe("archived");
    expect(creditDebits()).toHaveLength(0);
    expect(usageInserts()).toHaveLength(1);
    expect(usageInserts()[0].params).toContain("listing.archive");
    expect(usageInserts()[0].params).toContain(0);
    // The ownership read comes before the usage event.
    const lookup = queries.findIndex((q) => q.sql.includes('from "marketplace"."listings"'));
    const usage = queries.findIndex((q) => q.sql.startsWith('insert into "tools"."usage_events"'));
    expect(lookup).toBeGreaterThanOrEqual(0);
    expect(lookup).toBeLessThan(usage);
  });

  test("DELETE of an unknown or foreign listing is a 404 that records nothing", async () => {
    for (const who of [null, OTHER]) {
      queries = [];
      owner = who;
      const response = await app().request(`/v1/listings/${LISTING}`, { method: "DELETE" });
      expect(response.status).toBe(404);
      expect(usageInserts()).toHaveLength(0);
      expect(creditDebits()).toHaveLength(0);
      expect(queries.some((q) => q.sql.startsWith('update "marketplace"."listings"'))).toBe(false);
    }
  });

  test("DELETE with a non-UUID id is a 404 without a query", async () => {
    const response = await app().request("/v1/listings/not-a-uuid", { method: "DELETE" });
    expect(response.status).toBe(404);
    expect(queries).toHaveLength(0);
  });

  for (const [status, label] of [["archived", "listing.archive"], ["paused", "listing.pause"]] as const) {
    test(`a PATCH that only sets status "${status}" is free`, async () => {
      const response = await app().request(`/v1/listings/${LISTING}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      expect(response.status).toBe(200);
      expect(creditDebits()).toHaveLength(0);
      expect(usageInserts()).toHaveLength(1);
      expect(usageInserts()[0].params).toContain(label);
    });
  }

  test("a PATCH that changes anything else keeps the update price", async () => {
    const response = await app().request(`/v1/listings/${LISTING}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived", name: "renamed on the way out" }),
    });
    // The proxy reports no balance, so the 1-credit debit is attempted and refused.
    expect(creditDebits()).toHaveLength(1);
    expect(creditDebits()[0].params).toContain(MARKETPLACE_PRICING.update);
    expect(response.status).toBe(402);
  });
});
