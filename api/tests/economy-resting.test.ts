/** Generic escrow create and wallet spend rest with named, guided 503s;
 *  release and refund are open so existing escrows settle at the creator's
 *  direction.
 *
 *  Contract: docs/SAFETY-BOUNDARIES.md ("Generic escrow create and wallet
 *  spend — resting"). Policy: api/src/services/economy/config.ts
 *  genericEscrowCreateAllowed() and api/src/services/economy/redis.ts
 *  economyRedisEnabled().
 *
 *  The routers are exercised under a stand-in for the parent app's
 *  authentication (it only sets the project). Every resting request sends a
 *  malformed body: a 503 proves the router gate runs before validation, and
 *  the empty query log proves it runs before any escrow or wallet read.
 *
 *  Release and refund run with AGENTTOOL_DISABLE_WORKERS=1, the posture in
 *  which getRedis() throws a 503 redis_disabled. Reaching the escrow
 *  service's own 404/403/409/200 answers there proves no Redis client is
 *  requested. Hermetic: real Drizzle SQL generation over a pg-proxy
 *  transport, the pattern in read-leak-closures.test.ts; no database is
 *  contacted. */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { escrows, wallets } from "../src/db/schema/economy";
import { errors } from "../src/lib/errors";
import { SAFETY_BOUNDARIES } from "../src/services/discovery/safety-boundaries";
import { genericEscrowCreateAllowed } from "../src/services/economy/config";
import { economyRedisEnabled, getRedis } from "../src/services/economy/redis";

const PROJECT_ID = "00000000-0000-4000-8000-0000000000b1";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000b2";
const ESCROW_ID = "00000000-0000-4000-8000-0000000000e5";
const WALLET_ID = "00000000-0000-4000-8000-0000000000a1";
const CREATOR_WALLET_ID = "00000000-0000-4000-8000-0000000000c1";
const WORKER_WALLET_ID = "00000000-0000-4000-8000-0000000000c2";
const WHEN = "2026-10-19T09:00:00.000Z";

type Query = { sql: string; params: unknown[] };
let queries: Query[] = [];
/** Rows the proxy answers with, keyed by a substring of the SQL. */
let answers: Array<{ match: string; rows: unknown[][] }> = [];

const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  const answer = answers.find((candidate) => sql.includes(candidate.match));
  return { rows: answer?.rows ?? [] };
});
// pg-proxy has no transactions; run the callback against the same proxy.
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

const { default: escrowRouter } = await import("../src/routes/economy/escrow");
const { default: walletsRouter } = await import("../src/routes/economy/wallets");
const { default: openapiRouter } = await import("../src/routes/openapi");

/** A positional row in the table's select-all column order. */
function rowFor(table: Table, values: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);
}

/** Stands in for the parent app's authMiddleware, which only sets the
 *  project before these routers run. */
function withProject(router: Hono<ProjectContext>, prefix: string, projectId = PROJECT_ID) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: projectId, credits: 100 } as never);
    await next();
  });
  app.route(prefix, router);
  return app;
}

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function malformedPost(): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{malformed-json",
  };
}

function escrowRow(values: Record<string, unknown>): unknown[] {
  return rowFor(escrows, {
    id: ESCROW_ID,
    creatorWallet: CREATOR_WALLET_ID,
    workerWallet: WORKER_WALLET_ID,
    amount: 80,
    description: "bounded work",
    status: "funded",
    managedBy: null,
    deadline: null,
    releasedAt: null,
    createdAt: WHEN,
    ...values,
  });
}

const creatorWalletRow = rowFor(wallets, {
  id: CREATOR_WALLET_ID,
  projectId: PROJECT_ID,
  name: "creator",
  balance: 20,
  currency: "GBP",
  status: "active",
  ownerType: "platform",
  createdAt: WHEN,
});
const workerWalletRow = rowFor(wallets, {
  id: WORKER_WALLET_ID,
  projectId: OTHER_PROJECT_ID,
  name: "worker",
  balance: 0,
  currency: "GBP",
  status: "active",
  ownerType: "platform",
  createdAt: WHEN,
});

const ESCROW_LOCK = 'from "economy"."escrows" where "economy"."escrows"."id" = $1 for update';
// Release and refund lock both escrow wallets in id order, then check the
// creator wallet's project (escrow-settlement-checks.test.ts covers the rest).
const ESCROW_WALLETS_LOCK = 'from "economy"."wallets" where "economy"."wallets"."id" in ($1, $2) order by "economy"."wallets"."id" for update';
const ESCROW_UPDATE = 'update "economy"."escrows" set';

let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env.AGENTTOOL_DISABLE_WORKERS;
  queries = [];
  answers = [];
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.AGENTTOOL_DISABLE_WORKERS;
  else process.env.AGENTTOOL_DISABLE_WORKERS = savedFlag;
});

async function expectGuided503(
  response: Response,
  code: string,
  restingField: string,
): Promise<Record<string, any>> {
  expect(response.status).toBe(503);
  const body = (await response.json()) as Record<string, any>;
  expect(body.error).toBe(code);
  expect(body[restingField]).toBe("resting");
  expect(body.retryable).toBe(false);
  expect(typeof body.message).toBe("string");
  expect(body.message).not.toMatch(/redis_disabled|AGENTTOOL_DISABLE_WORKERS|REDIS_URL/);
  expect(Array.isArray(body.next_actions)).toBe(true);
  expect(body.next_actions.length).toBeGreaterThan(0);
  expect(body.next_actions).toContainEqual(
    expect.objectContaining({ method: "GET", path: "/public/safety" }),
  );
  expect(body.docs).toMatch(/^https:\/\/docs\.agenttool\.dev\/wallets#/);
  expect(body._canon_pointer).toBe("urn:agenttool:doc/SAFETY-BOUNDARIES");
  return body;
}

describe("generic escrow create is resting", () => {
  test("the named policy is closed and reads no environment", () => {
    for (const flag of [undefined, "0", "1"]) {
      if (flag === undefined) delete process.env.AGENTTOOL_DISABLE_WORKERS;
      else process.env.AGENTTOOL_DISABLE_WORKERS = flag;
      expect(genericEscrowCreateAllowed()).toBe(false);
    }
  });

  for (const flag of ["1", undefined]) {
    const label = flag === "1" ? "workers disabled" : "workers enabled";
    test(`create returns 503 escrow_resting before validation or any query (${label})`, async () => {
      if (flag === undefined) delete process.env.AGENTTOOL_DISABLE_WORKERS;
      else process.env.AGENTTOOL_DISABLE_WORKERS = flag;

      const app = withProject(escrowRouter, "/v1/escrows");
      const body = await expectGuided503(
        await app.request("/v1/escrows", malformedPost()),
        "escrow_resting",
        "generic_escrow_create",
      );
      expect(queries).toHaveLength(0);
      expect(body.generic_escrow).toBeUndefined();
      expect(body.docs).toBe("https://docs.agenttool.dev/wallets#escrow");
      expect(body.message).toMatch(/generic escrow create is resting/i);
      expect(body.message).not.toMatch(/release|refund/i);
      expect(body.hint).toMatch(/spending policy/i);
      expect(body.hint).toMatch(/release a funded escrow.*refund a funded or disputed/i);
      expect(body.hint).not.toMatch(/manual operator recovery|support contact/i);
      // Settlement is creator-directed and unchecked; the hint must not
      // imply existing escrows are untouched by the reopening.
      expect(body.hint).not.toMatch(/unaffected|own terms/i);
      expect(body.hint).toMatch(/at the creator's direction/);
      expect(body.hint).toMatch(/neither checks wallet status or spending policy/i);
      expect(body.hint).toMatch(/whichever wallet accepted the escrow.*workerWallet/);
      // Existing escrows have executable settlement steps, not a support ticket.
      expect(body.next_actions).toContainEqual(
        expect.objectContaining({ method: "POST", path: "/v1/escrows/{id}/release" }),
      );
      expect(body.next_actions).toContainEqual(
        expect.objectContaining({ method: "POST", path: "/v1/escrows/{id}/refund" }),
      );
      expect(JSON.stringify(body.next_actions)).not.toContain("/support");
    });
  }

  test("only create carries the resting gate", () => {
    const route = source("../src/routes/economy/escrow.ts");
    const gate = "genericEscrowCreateResting";
    expect(route).toContain(`router.post(\n  "/",\n  ${gate},\n  zValidator(`);
    expect(route.split(gate)).toHaveLength(3); // declaration + create only
    expect(route).toContain('router.post("/:id/release", async (c) => {');
    expect(route).toContain('router.post("/:id/refund", async (c) => {');
    for (const action of ["accept", "release", "refund", "dispute"]) {
      const start = route.indexOf(`"/:id/${action}"`);
      expect(start).toBeGreaterThan(0);
      expect(route.slice(start, route.indexOf("});", start))).not.toContain(gate);
    }
  });

  test("the retained create service records what a reopening must add", () => {
    const service = source("../src/services/economy/escrow.ts");
    const note = service.slice(0, service.indexOf("export async function createEscrow"));
    expect(note).toMatch(/genericEscrowCreateAllowed/);
    expect(note).toMatch(/spending policy[\s\S]*spendFromWallet/);
    expect(note).toMatch(/Release and refund are open/);
    expect(note).toMatch(/docs\/SAFETY-BOUNDARIES\.md/);
  });
});

describe("release and refund settle existing escrows without Redis", () => {
  beforeEach(() => {
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    // The posture in which any getRedis() call would answer 503 instead.
    expect(() => getRedis()).toThrow(/redis_disabled/);
  });

  for (const action of ["release", "refund"] as const) {
    test(`${action} of an unknown id reaches the service's locked read and answers its 404`, async () => {
      const app = withProject(escrowRouter, "/v1/escrows");
      const response = await app.request(`/v1/escrows/${ESCROW_ID}/${action}`, { method: "POST" });

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain("Escrow not found");
      expect(text).not.toMatch(/escrow_resting|redis_disabled/);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.sql).toContain(ESCROW_LOCK);
      expect(queries[0]!.params).toEqual([ESCROW_ID]);
    });
  }

  test("release credits the assigned worker wallet of a funded escrow", async () => {
    answers = [
      { match: ESCROW_LOCK, rows: [escrowRow({})] },
      { match: ESCROW_WALLETS_LOCK, rows: [creatorWalletRow, workerWalletRow] },
      { match: ESCROW_UPDATE, rows: [escrowRow({ status: "released", releasedAt: WHEN })] },
    ];
    const app = withProject(escrowRouter, "/v1/escrows");
    const response = await app.request(`/v1/escrows/${ESCROW_ID}/release`, { method: "POST" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("released");

    // The proxy answers the update with a canned row, so the status the
    // service writes is read from the update's own parameters.
    const statusWrite = queries.find((query) => query.sql.startsWith(ESCROW_UPDATE));
    expect(statusWrite?.sql).toMatch(/set "status" = \$1, "released_at" = \$2 where/);
    expect(statusWrite?.params[0]).toBe("released");
    expect(statusWrite?.params[1]).toBeTruthy();
    expect(statusWrite?.params).not.toContain("refunded");

    const walletLock = queries.find((query) => query.sql.includes(ESCROW_WALLETS_LOCK));
    expect(walletLock?.params).toEqual([CREATOR_WALLET_ID, WORKER_WALLET_ID]);
    const credit = queries.find((query) => query.sql.startsWith('update "economy"."wallets"'));
    expect(credit?.sql).toContain('set "balance" = balance + $1');
    expect(credit?.params).toEqual([80, WORKER_WALLET_ID]);
    const ledger = queries.find((query) => query.sql.startsWith('insert into "economy"."transactions"'));
    expect(ledger?.params).toContain("escrow_release");
    expect(ledger?.params).toContain(WORKER_WALLET_ID);
  });

  test("refund restores the creator wallet of a disputed escrow", async () => {
    answers = [
      { match: ESCROW_LOCK, rows: [escrowRow({ status: "disputed" })] },
      { match: ESCROW_WALLETS_LOCK, rows: [creatorWalletRow, workerWalletRow] },
      { match: ESCROW_UPDATE, rows: [escrowRow({ status: "refunded" })] },
    ];
    const app = withProject(escrowRouter, "/v1/escrows");
    const response = await app.request(`/v1/escrows/${ESCROW_ID}/refund`, { method: "POST" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data.status).toBe("refunded");

    const statusWrite = queries.find((query) => query.sql.startsWith(ESCROW_UPDATE));
    expect(statusWrite?.sql).toMatch(/set "status" = \$1 where/);
    expect(statusWrite?.params[0]).toBe("refunded");
    expect(statusWrite?.params).not.toContain("released");

    const credit =queries.find((query) => query.sql.startsWith('update "economy"."wallets"'));
    expect(credit?.params).toEqual([80, CREATOR_WALLET_ID]);
    const ledger = queries.find((query) => query.sql.startsWith('insert into "economy"."transactions"'));
    expect(ledger?.params).toContain("escrow_refund");
    expect(ledger?.params).toContain(CREATOR_WALLET_ID);
  });

  test("a project that does not own the creator wallet is refused before any balance moves", async () => {
    // OTHER_PROJECT_ID owns the worker wallet only.
    answers = [
      { match: ESCROW_LOCK, rows: [escrowRow({})] },
      { match: ESCROW_WALLETS_LOCK, rows: [creatorWalletRow, workerWalletRow] },
    ];
    for (const action of ["release", "refund"]) {
      queries = [];
      const app = withProject(escrowRouter, "/v1/escrows", OTHER_PROJECT_ID);
      const response = await app.request(`/v1/escrows/${ESCROW_ID}/${action}`, { method: "POST" });

      expect(response.status).toBe(403);
      expect(queries.some((query) => query.sql.includes(ESCROW_WALLETS_LOCK))).toBe(true);
      expect(queries.some((query) => /^(update|insert)/.test(query.sql))).toBe(false);
    }
  });

  test("state and workflow ownership still bound the generic transitions", async () => {
    const app = withProject(escrowRouter, "/v1/escrows");

    answers = [{ match: ESCROW_LOCK, rows: [escrowRow({ managedBy: "capability_invocation" })] }];
    for (const action of ["release", "refund"]) {
      expect((await app.request(`/v1/escrows/${ESCROW_ID}/${action}`, { method: "POST" })).status).toBe(409);
    }

    answers = [{ match: ESCROW_LOCK, rows: [escrowRow({ status: "disputed" })] }];
    expect((await app.request(`/v1/escrows/${ESCROW_ID}/release`, { method: "POST" })).status).toBe(400);

    answers = [{ match: ESCROW_LOCK, rows: [escrowRow({ workerWallet: null })] }];
    expect((await app.request(`/v1/escrows/${ESCROW_ID}/release`, { method: "POST" })).status).toBe(400);

    answers = [{ match: ESCROW_LOCK, rows: [escrowRow({ status: "released" })] }];
    expect((await app.request(`/v1/escrows/${ESCROW_ID}/refund`, { method: "POST" })).status).toBe(400);

    expect(queries.some((query) => /^(update|insert)/.test(query.sql))).toBe(false);
  });

  test("neither the escrow route nor the escrow service asks for Redis", () => {
    const route = source("../src/routes/economy/escrow.ts");
    const service = source("../src/services/economy/escrow.ts");
    expect(route).not.toContain("getRedis");
    expect(route).not.toContain("services/economy/redis");
    expect(service).not.toContain("ioredis");
    expect(service).not.toMatch(/\bredis\s*:/);
    for (const name of ["createEscrow", "releaseEscrow", "refundEscrow", "expireOverdue"]) {
      const start = service.indexOf(`export async function ${name}(`);
      expect(start).toBeGreaterThan(0);
      expect(service.slice(start, service.indexOf(")", start))).not.toMatch(/redis/i);
    }
  });
});

describe("wallet spend rests without Redis", () => {
  test("workers disabled returns 503 wallet_spend_resting before validation or ownership lookup", async () => {
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    expect(economyRedisEnabled()).toBe(false);

    const body = await expectGuided503(
      await walletsRouter.request(`/${WALLET_ID}/spend`, malformedPost()),
      "wallet_spend_resting",
      "wallet_spend",
    );
    expect(queries).toHaveLength(0);
    expect(body.docs).toBe("https://docs.agenttool.dev/wallets#post-spend");
    expect(body.next_actions).toContainEqual(
      expect.objectContaining({ method: "GET", path: "/v1/wallets/{id}/transactions" }),
    );
  });

  test("workers enabled passes the gate unchanged (validation still answers first)", async () => {
    delete process.env.AGENTTOOL_DISABLE_WORKERS;
    expect(economyRedisEnabled()).toBe(true);

    const response = await walletsRouter.request(`/${WALLET_ID}/spend`, malformedPost());
    expect(response.status).toBe(400);
  });

  test("fund is not gated by the spend rest", () => {
    const route = source("../src/routes/economy/wallets.ts");
    const fund = route.slice(route.indexOf('"/:id/fund"'), route.indexOf('"/:id/reinvest"'));
    expect(fund).not.toContain("walletSpendNeedsRedis");
    expect(fund).not.toContain("economyRedisEnabled");
    expect(route).toContain('"/:id/spend",\n  walletSpendNeedsRedis,\n  zValidator(');
  });
});

describe("economy resting surfaces stay guided", () => {
  test("the touched economy routes add no hand-rolled error bodies", () => {
    for (const file of ["../src/routes/economy/escrow.ts", "../src/routes/economy/wallets.ts"]) {
      expect(source(file)).not.toMatch(/c\.json\s*\(\s*\{\s*error\s*:/);
    }
  });

  test("builders keep stable codes", () => {
    expect(errors.escrowResting().error).toBe("escrow_resting");
    expect(errors.walletSpendResting().error).toBe("wallet_spend_resting");
  });

  test("OpenAPI adds the shared 503 to create only and restores release and refund", async () => {
    const document = (await (await openapiRouter.request("/")).json()) as any;
    const shared = document.components.responses.EscrowResting;
    expect(shared.description).toMatch(
      /generic escrow create is resting.*escrow_resting.*generic_escrow_create=resting.*every request after authentication and before body validation or any escrow or wallet database read.*release and refund of existing escrows are open at the creator project's direction and need no redis.*workers disabled.*refused them with 503/is,
    );
    expect(shared.content["application/json"].schema.$ref).toBe("#/components/schemas/Error");

    const create = document.paths["/v1/escrows"].post;
    expect(create.responses["503"]).toEqual({ $ref: "#/components/responses/EscrowResting" });
    expect(create.summary).toMatch(/resting: 503 escrow_resting/);
    expect(create.description).toMatch(/^Resting: after authentication/);
    expect(create.description).toMatch(/non-503 responses below apply only after a reviewed reopening/);
    expect(create.description).not.toMatch(/hosted service currently/);
    const economyTag = document.tags.find((tag: { name: string }) => tag.name === "economy");
    expect(economyTag.description).toMatch(
      /release and refund of existing escrows are open and need no Redis, so they also settle in a process run with workers disabled/,
    );
    expect(JSON.stringify(document)).not.toMatch(/release and refund of existing escrows stay open/i);

    for (const action of ["accept", "release", "refund", "dispute"]) {
      const operation = document.paths[`/v1/escrows/{id}/${action}`].post;
      expect(operation.responses["503"]).toBeUndefined();
      expect(operation.summary).not.toMatch(/resting/i);
      expect(operation.description).not.toMatch(/escrow_resting|manual operator recovery/);
    }
    expect(document.paths["/v1/escrows/{id}/release"].post.responses["200"]).toBeDefined();
    expect(document.paths["/v1/escrows/{id}/refund"].post.responses["200"]).toBeDefined();
  });

  test("/public/safety names the create rest, the open settlement routes, and their authority", () => {
    const { escrow, wallet_spend } = SAFETY_BOUNDARIES.conditional_services;
    expect(escrow).toMatch(
      /generic escrow create \(POST \/v1\/escrows\) is resting by owner decision.*no environment flag.*after authentication.*503 escrow_resting.*before body validation or any escrow or wallet database read.*spending policy.*release and refund are open.*at the creator's direction.*creator project's bearer releases a funded escrow with an assigned worker.*refunds a funded or disputed escrow to the creator wallet, at any time, even after a worker accepted.*neither verifies a worker signature.*neither checks the escrow deadline.*neither checks either wallet's status or applies any spending policy.*frozen or closed wallet still settles.*allowed-recipient and approval-threshold limits do not bind a release.*accept \(worker assignment\), dispute, list, and get.*accept needs no creator consent.*later release pays.*read the escrow's workerWallet before releasing.*uses no redis.*workers disabled.*unnamed 503 redis_disabled.*\/public\/plans.*if the hosted api still runs in that posture when this release deploys, release and refund start moving balances there.*canonical api deploy neither sets nor checks the flag.*workflow-managed marketplace escrows refuse.*409.*substrate-task bounty escrows.*platform wallet.*dispute-bond escrows.*no managed_by.*both their creator and worker.*release, refund, or dispute its bond.*before finalize.*escalation rests.*zero bonds.*mark bond escrows managed first.*no automatic deadline refund/is,
    );
    expect(escrow).not.toMatch(/release, and refund are resting|manual operator recovery|docs\.agenttool\.dev\/support/i);
    expect(escrow).not.toMatch(/own terms|stay open so existing/i);
    expect(escrow).not.toMatch(/deploy fence requires|built a Redis client/i);
    expect(wallet_spend).toMatch(
      /Redis counters.*process run with workers disabled.*AGENTTOOL_DISABLE_WORKERS=1.*\/public\/plans.*503 wallet_spend_resting.*before validation, wallet ownership lookup, or any debit.*workers enabled the route is unchanged.*fund stays mounted.*new generic escrow.*capability invocations.*seller wallets.*payout stays resting/is,
    );
    expect(wallet_spend).not.toMatch(/deploy fence requires/i);
    // The rest that depends on the per-process flag names the deploy gap.
    expect(wallet_spend).toMatch(
      /the flag is per process, and the canonical API deploy, \.github\/workflows\/deploy-api\.yml with api\/fly\.toml, neither sets nor checks it/,
    );
    for (const text of [escrow, wallet_spend]) {
      expect(text).not.toMatch(/deploys (with workers disabled|without(?: Redis)?)\b/i);
      expect(text).not.toMatch(/hosted service currently/i);
    }
    expect(SAFETY_BOUNDARIES.idempotency.durable_escrow_create).toMatch(
      /^POST \/v1\/escrows is currently resting: it returns 503 escrow_resting before the Idempotency-Key is read.*can still settle through release and refund/,
    );
  });
});

describe("hosted posture copy stays conditional", () => {
  // The spend refusal depends on a per-process flag that the canonical API
  // deploy (deploy-api.yml + api/fly.toml) neither sets nor checks, and the
  // named codes reach the hosted API only with the release that ships them.
  // Published copy must say so instead of stating the hosted posture as fact.
  const surfaces: Record<string, string> = {
    wallets_html: source("../../apps/docs/wallets.html"),
    sdk_ts: source("../../packages/sdk-ts/src/economy.ts"),
    sdk_py: source("../../packages/sdk-py/src/agenttool/economy.py"),
    safety_md: source("../../docs/SAFETY-BOUNDARIES.md"),
  };

  for (const [name, text] of Object.entries(surfaces)) {
    test(`${name} does not state the hosted worker posture as a deploy guarantee`, () => {
      expect(text).not.toMatch(/deploys (with workers disabled|without(?: Redis)?)\b/i);
      expect(text).not.toMatch(/hosted service currently/i);
      expect(text).not.toMatch(/deploy fence (?:in `bin\/deploy\.sh` )?requires/i);
      expect(text).toMatch(/workers disabled/i);
    });

    test(`${name} no longer says release or refund rest`, () => {
      expect(text).not.toMatch(/create\/release\/refund return|release(?:,)? and refund (?:are|return) .*resting/i);
      expect(text).not.toMatch(/manual operator recovery/i);
    });
  }

  test("SAFETY-BOUNDARIES names the canonical deploy gap, the open routes, and the carve-outs", () => {
    const section = surfaces.safety_md.slice(
      surfaces.safety_md.indexOf("## Generic escrow create and wallet spend — resting"),
      surfaces.safety_md.indexOf("## Idempotency"),
    );
    expect(section.length).toBeGreaterThan(100);
    expect(section).toMatch(/deploy-api\.yml[\s\S]*api\/fly\.toml[\s\S]*neither set nor check it/);
    expect(section).toMatch(/Release and refund are open \(owner decision 2026-10-19\), so escrows that\s+already exist settle at the creator's direction/);
    expect(section).not.toMatch(/own terms|Release and refund stay open/);
    expect(section).toMatch(/`POST \/v1\/escrows\/:id\/release`[\s\S]*`funded` escrow with an assigned worker/);
    expect(section).toMatch(/`POST \/v1\/escrows\/:id\/refund`[\s\S]*`funded` or `disputed` escrow/);
    expect(section).toMatch(/neither checks the escrow's deadline/);
    expect(section).toMatch(/substrate-task bounty escrows/i);
    expect(section).toMatch(/capability invocations, which settle to seller wallets/);
    // What the reopened routes do not check, stated where creators read it.
    expect(section).toMatch(/creator can refund a funded\s+escrow at any time, even after a worker accepted it/);
    expect(section).toMatch(/Neither route checks\s+either wallet's status or applies any spending policy/);
    expect(section).toMatch(/Accept needs no creator consent[\s\S]*later release pays that wallet[\s\S]*`workerWallet`/);
    expect(section).toMatch(/If the hosted API still runs in that posture when this release\s+deploys, this release turns generic release and refund on there/);
    expect(section).toMatch(/Dispute-bond escrows[\s\S]*`escalateDispute`[\s\S]*both creator and worker[\s\S]*mark bond\s+escrows managed first/);
    expect(section).toMatch(/Template-purchase escrows[\s\S]*refuse them with `400`/);
  });

  test("BUSINESS-MODEL copies rest create only", () => {
    for (const path of [
      "../../docs/BUSINESS-MODEL.md",
      "../../apps/docs/BUSINESS-MODEL.md",
      "../../apps/docs/business-model.html",
    ]) {
      const text = source(path);
      expect(text).toContain(
        "generic escrow create remain resting under their own safety boundaries. Release and refund of existing generic escrows are open at the creator's direction and no longer need Redis, so they also settle where the API runs with workers disabled, where they previously refused.",
      );
      expect(text).not.toMatch(/manual operator recovery/i);
    }
  });
});
