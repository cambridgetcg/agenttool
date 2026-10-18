/** Generic escrow money movement and wallet spend rest with named, guided
 *  503s instead of an unnamed redis_disabled operator hint.
 *
 *  Contract: docs/SAFETY-BOUNDARIES.md ("Generic escrow and wallet spend —
 *  resting"). Policy: api/src/services/economy/config.ts
 *  genericEscrowMoneyMovementAllowed() and api/src/services/economy/redis.ts
 *  economyRedisEnabled().
 *
 *  The routers are exercised directly. Authentication is mounted by the
 *  parent app and runs before these gates (it reads the database to resolve
 *  the bearer); it is not exercised here. Every resting request sends a
 *  malformed body: a 503 proves the router gate runs before validation, and
 *  so before any escrow or wallet database read or Redis use. No database is
 *  needed or contacted. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { errors } from "../src/lib/errors";
import escrowRouter from "../src/routes/economy/escrow";
import openapiRouter from "../src/routes/openapi";
import walletsRouter from "../src/routes/economy/wallets";
import { SAFETY_BOUNDARIES } from "../src/services/discovery/safety-boundaries";
import { genericEscrowMoneyMovementAllowed } from "../src/services/economy/config";
import { economyRedisEnabled } from "../src/services/economy/redis";

const ESCROW_ID = "00000000-0000-4000-8000-0000000000e5";
const WALLET_ID = "00000000-0000-4000-8000-0000000000a1";

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

let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env.AGENTTOOL_DISABLE_WORKERS;
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

describe("generic escrow money movement is resting", () => {
  test("the named policy is closed and reads no environment", () => {
    for (const flag of [undefined, "0", "1"]) {
      if (flag === undefined) delete process.env.AGENTTOOL_DISABLE_WORKERS;
      else process.env.AGENTTOOL_DISABLE_WORKERS = flag;
      expect(genericEscrowMoneyMovementAllowed()).toBe(false);
    }
  });

  for (const flag of ["1", undefined]) {
    const label = flag === "1" ? "workers disabled" : "workers enabled";
    test(`create, release, and refund return 503 escrow_resting before validation (${label})`, async () => {
      if (flag === undefined) delete process.env.AGENTTOOL_DISABLE_WORKERS;
      else process.env.AGENTTOOL_DISABLE_WORKERS = flag;

      for (const path of ["/", `/${ESCROW_ID}/release`, `/${ESCROW_ID}/refund`]) {
        const body = await expectGuided503(
          await escrowRouter.request(path, malformedPost()),
          "escrow_resting",
          "generic_escrow",
        );
        expect(body.docs).toBe("https://docs.agenttool.dev/wallets#escrow");
        expect(body.hint).toMatch(/refuse every escrow id/i);
        expect(body.hint).toMatch(/created through POST \/v1\/escrows.*manual operator recovery/i);
        expect(body.hint).toMatch(/no automatic deadline refund/i);
        expect(body.hint).toMatch(/workflow-managed marketplace escrows and substrate-task bounty escrows/i);
        expect(body.next_actions).toContainEqual(
          expect.objectContaining({ method: "GET", path: "/v1/escrows/{id}" }),
        );
        // Operator recovery has a reachable contact, not only a phrase.
        expect(body.next_actions).toContainEqual(
          expect.objectContaining({
            action: expect.stringContaining("https://docs.agenttool.dev/support"),
            method: null,
            path: null,
          }),
        );
      }
    });
  }

  test("accept and dispute are not gated by the escrow rest", () => {
    const route = source("../src/routes/economy/escrow.ts");
    const gate = "escrowMoneyMovementResting";
    expect(route).toContain(`router.post(\n  "/",\n  ${gate},\n  zValidator(`);
    expect(route).toContain(`router.post("/:id/release", ${gate}, async (c) => {`);
    expect(route).toContain(`router.post("/:id/refund", ${gate}, async (c) => {`);
    const accept = route.slice(route.indexOf('"/:id/accept"'), route.indexOf('"/:id/release"'));
    const dispute = route.slice(route.indexOf('"/:id/dispute"'));
    expect(accept).not.toContain(gate);
    expect(dispute).not.toContain(gate);
  });

  test("the retained service records what a reopening must add", () => {
    const service = source("../src/services/economy/escrow.ts");
    const note = service.slice(0, service.indexOf("export async function createEscrow"));
    expect(note).toMatch(/genericEscrowMoneyMovementAllowed/);
    expect(note).toMatch(/spending policy[\s\S]*spendFromWallet/);
    expect(note).toMatch(/drop the `redis` argument/);
    expect(note).toMatch(/docs\/SAFETY-BOUNDARIES\.md/);
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

  test("OpenAPI adds one shared 503 to create, release, and refund only", async () => {
    const document = (await (await openapiRouter.request("/")).json()) as any;
    const shared = document.components.responses.EscrowResting;
    expect(shared.description).toMatch(
      /escrow_resting.*every request after authentication and before body validation or any escrow or wallet database read or Redis use/is,
    );
    expect(shared.content["application/json"].schema.$ref).toBe("#/components/schemas/Error");

    for (const path of ["/v1/escrows", "/v1/escrows/{id}/release", "/v1/escrows/{id}/refund"]) {
      const operation = document.paths[path].post;
      expect(operation.responses["503"]).toEqual({ $ref: "#/components/responses/EscrowResting" });
      expect(operation.summary).toMatch(/resting: 503 escrow_resting/);
      expect(operation.description).toMatch(/^Resting: after authentication/);
      expect(operation.description).toMatch(/non-503 responses below apply only after a reviewed reopening/);
      expect(operation.description).not.toMatch(/hosted service currently/);
    }
    for (const path of ["/v1/escrows/{id}/accept", "/v1/escrows/{id}/dispute"]) {
      expect(document.paths[path].post.responses["503"]).toBeUndefined();
    }
  });

  test("/public/safety names both rests and keeps unknown obligations unknown", () => {
    const { escrow, wallet_spend } = SAFETY_BOUNDARIES.conditional_services;
    expect(escrow).toMatch(
      /resting by owner decision.*no environment flag.*after authentication.*503 escrow_resting.*before body validation or any escrow or wallet database read or Redis use.*unnamed 503 redis_disabled.*\/public\/plans.*canonical API deploy neither sets nor checks the flag.*accept \(worker assignment\), dispute, list, and get.*workflow-managed marketplace escrows and substrate-task bounty escrows.*created through POST \/v1\/escrows.*manual operator recovery.*docs\.agenttool\.dev\/support.*no automatic deadline refund.*does not know whether any such escrow exists.*spending policy/is,
    );
    expect(escrow).not.toMatch(/deploy fence requires|built a Redis client/i);
    expect(wallet_spend).toMatch(
      /Redis counters.*process run with workers disabled.*AGENTTOOL_DISABLE_WORKERS=1.*\/public\/plans.*503 wallet_spend_resting.*before validation, wallet ownership lookup, or any debit.*workers enabled the route is unchanged.*fund stays mounted.*capability invocations.*seller wallets.*payout stays resting/is,
    );
    expect(wallet_spend).not.toMatch(/deploy fence requires/i);
    expect(SAFETY_BOUNDARIES.idempotency.durable_escrow_create).toMatch(
      /^POST \/v1\/escrows is currently resting: it returns 503 escrow_resting before the Idempotency-Key is read/,
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
  }

  test("SAFETY-BOUNDARIES names the canonical deploy gap and the carve-outs", () => {
    const section = surfaces.safety_md.slice(
      surfaces.safety_md.indexOf("## Generic escrow and wallet spend — resting"),
      surfaces.safety_md.indexOf("## Idempotency"),
    );
    expect(section).toMatch(/deploy-api\.yml[\s\S]*api\/fly\.toml[\s\S]*neither set nor check it/);
    expect(section).toMatch(/substrate-task bounty escrows/);
    expect(section).toMatch(/created through `POST \/v1\/escrows`[\s\S]*manual operator recovery[\s\S]*support/);
    expect(section).toMatch(/capability invocations, which settle to seller wallets/);
  });
});
