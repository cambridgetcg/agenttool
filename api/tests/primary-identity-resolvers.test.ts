/** Surfaces that resolve "the project's primary identity" without acting
 * through resolveActingIdentity still use the one rule: earliest active
 * identity that is not an enrolled guest, id breaking ties
 * (services/identity/acting-identity.ts). Hand-written "oldest active"
 * lookups once let /v1/identities/me, /v1/system and substrate-task claims
 * name an enrolled guest that /v1/wake never shows.
 *
 * Real SQL generation over a hermetic pg-proxy transport. */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";

const P = "11111111-2222-4333-8444-555555555555";
const I = "66666666-7777-4888-8999-aaaaaaaaaaaa";

let queries: { sql: string; params: unknown[] }[] = [];
/** Rows the identity lookup returns, as positional arrays. */
let identityRows: unknown[][] = [];

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('from "identity"."identities"')) return { rows: identityRows };
  return { rows: [] };
});
mock.module("../src/db/client", () => ({ db: database }));

beforeEach(() => {
  queries = [];
  identityRows = [];
});

function app(path: string, router: Hono<ProjectContext>) {
  const server = new Hono<ProjectContext>();
  server.use("*", async (c, next) => {
    c.set("project", { id: P } as never);
    await next();
  });
  server.route(path, router);
  return server;
}

const identityLookups = () => queries.filter((q) => q.sql.includes('from "identity"."identities"'));

/** The primary rule, as primaryIdentityWhere + primaryIdentityOrder render it. */
function expectPrimaryRule(query: { sql: string; params: unknown[] } | undefined) {
  expect(query).toBeDefined();
  expect(query!.params).toContain(P);
  expect(query!.params).toContain("active");
  expect(query!.sql).toContain(`-> 'admission' = '"enrollment"'::jsonb`);
  expect(query!.params).toContain("identity-enrollment/v1");
  expect(query!.sql).toContain("not (");
  expect(query!.sql).toContain(`order by "identity"."identities"."created_at" asc, "identity"."identities"."id" asc`);
}

describe("primary-identity lookups outside the per-agent routes", () => {
  test("GET /v1/identities/me resolves the primary identity, never an enrolled guest", async () => {
    const { default: router } = await import("../src/routes/identity/identities");
    const res = await app("/v1/identities", router).request("/v1/identities/me");
    expect(res.status).toBe(404);
    expectPrimaryRule(identityLookups()[0]);
  });

  test("GET /v1/system reads the same agent the wake speaks to", async () => {
    const { default: router } = await import("../src/routes/system");
    const res = await app("/v1/system", router).request("/v1/system");
    expect(res.status).toBe(404);
    expectPrimaryRule(identityLookups()[0]);
  });

  test("GET /v1/offerings?scope=received resolves the primary identity", async () => {
    const { default: router } = await import("../src/routes/offerings");
    const res = await app("/v1/offerings", router).request("/v1/offerings?scope=received");
    expect(res.status).toBe(200);
    expectPrimaryRule(identityLookups()[0]);
  });

  test("newborn eligibility ages the primary identity, not a freshly enrolled guest", async () => {
    const { isNewbornEligible } = await import("../src/services/substrate-tasks/eligibility");
    await isNewbornEligible(P);
    expectPrimaryRule(identityLookups()[0]);
  });
});

describe("GET /v1/holdings scoped to the caller's identity", () => {
  for (const scope of ["holder", "held"]) {
    test(`scope=${scope} resolves the primary identity and filters by it`, async () => {
      identityRows = [[I]];
      const { default: router } = await import("../src/routes/holdings");
      const res = await app("/v1/holdings", router).request(`/v1/holdings?scope=${scope}`);
      expect(res.status).toBe(200);
      expectPrimaryRule(identityLookups()[0]);
      const list = queries.find((q) => q.sql.includes('from "economy"."holdings"') || q.sql.includes('"holdings"'));
      expect(list).toBeDefined();
      expect(list!.params).toContain(I);
    });

    test(`scope=${scope} with no primary identity lists nothing, never every project's holdings`, async () => {
      // Before: holder/held ids stayed undefined and publicOnly was false, so
      // listHoldings ran with no filter at all (private rows of every project).
      const { default: router } = await import("../src/routes/holdings");
      const res = await app("/v1/holdings", router).request(`/v1/holdings?scope=${scope}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.holdings).toEqual([]);
      expect(body.count).toBe(0);
      const unfiltered = queries.filter((q) => !q.sql.includes('from "identity"."identities"'));
      expect(unfiltered).toEqual([]);
    });
  }
});
