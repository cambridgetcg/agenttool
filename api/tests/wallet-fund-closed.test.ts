/** POST /v1/wallets/:id/fund is closed (owner decision, 2026-10-26).
 *
 *  Contract: docs/SAFETY-BOUNDARIES.md ("Wallet self-funding — closed").
 *  Refusal: api/src/lib/errors.ts walletFundClosed().
 *
 *  The wallets router runs under a stand-in for the parent app's
 *  authentication (it only sets the project), over a pg-proxy transport that
 *  records every SQL statement; no database is contacted. A 410 for a
 *  malformed body proves the refusal runs before validation, and an empty
 *  query log proves it runs before the ownership lookup and any balance or
 *  ledger write. A probe of the assembled app shows authentication still
 *  answers first. The internal fundWallet() service stays for server-side
 *  grants; its callers are pinned here, so a new caller is a visible
 *  decision rather than a quiet reopening. */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { MAX_EXACT_WALLET_BALANCE, wallets } from "../src/db/schema/economy";
import { errors } from "../src/lib/errors";
import { SAFETY_BOUNDARIES } from "../src/services/discovery/safety-boundaries";

const API_ROOT = join(import.meta.dir, "..");
const SRC_ROOT = join(API_ROOT, "src");
const PROJECT_ID = "00000000-0000-4000-8000-0000000000f1";
const WALLET_ID = "00000000-0000-4000-8000-0000000000f2";
const WHEN = "2026-10-26T09:00:00.000Z";

type Query = { sql: string; params: unknown[] };
let queries: Query[] = [];

/** A positional row in the table's select-all column order. */
function rowFor(table: Table, values: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);
}

// Every statement is recorded. An owned, active wallet with a balance is
// answered to any select, so a handler that still looked the wallet up and
// funded it would find a row to credit and would show up in the log.
const ownedWallet = rowFor(wallets, {
  id: WALLET_ID,
  projectId: PROJECT_ID,
  name: "self-funded",
  balance: 20,
  currency: "GBP",
  status: "active",
  ownerType: "platform",
  createdAt: WHEN,
});
const database = drizzle(async (sql, params) => {
  queries.push({ sql, params });
  const walletRead = sql.startsWith("select") && sql.includes('from "economy"."wallets"');
  return { rows: walletRead ? [ownedWallet] : [] };
});
database.transaction = (async (fn: (tx: typeof database) => unknown) => fn(database)) as typeof database.transaction;
mock.module("../src/db/client", () => ({ db: database }));

const { default: walletsRouter } = await import("../src/routes/economy/wallets");
const { default: openapiRouter } = await import("../src/routes/openapi");

/** Stands in for the parent app's authMiddleware, which only sets the
 *  project before this router runs. */
function authenticated() {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID, credits: 100 } as never);
    await next();
  });
  app.route("/v1/wallets", walletsRouter);
  return app;
}

function source(path: string): string {
  return readFileSync(join(API_ROOT, path), "utf8");
}

/** Source text with whole-line comments removed, so a comment that names
 *  fundWallet() is not counted as a call. */
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

const REQUESTS: Array<[string, RequestInit]> = [
  ["a malformed body", { method: "POST", headers: { "content-type": "application/json" }, body: "{malformed-json" }],
  ["no body", { method: "POST" }],
  [
    "a well-formed fund request",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 500, description: "Weekly budget" }),
    },
  ],
  [
    "the largest amount the old route accepted",
    {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "fund-closed-probe-1" },
      body: JSON.stringify({ amount: MAX_EXACT_WALLET_BALANCE, metadata: { reason: "self-credit" } }),
    },
  ],
];

let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env.AGENTTOOL_DISABLE_WORKERS;
  queries = [];
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.AGENTTOOL_DISABLE_WORKERS;
  else process.env.AGENTTOOL_DISABLE_WORKERS = savedFlag;
});

describe("POST /v1/wallets/:id/fund is closed", () => {
  for (const flag of ["1", undefined]) {
    const label = flag === "1" ? "workers disabled" : "workers enabled";
    for (const [name, init] of REQUESTS) {
      test(`${name} gets 410 wallet_fund_closed and moves no balance (${label})`, async () => {
        if (flag === undefined) delete process.env.AGENTTOOL_DISABLE_WORKERS;
        else process.env.AGENTTOOL_DISABLE_WORKERS = flag;

        const response = await authenticated().request(`/v1/wallets/${WALLET_ID}/fund`, init);

        expect(response.status).toBe(410);
        const body = (await response.json()) as Record<string, any>;
        expect(body.error).toBe("wallet_fund_closed");
        expect(body.wallet_fund).toBe("closed");
        expect(body.retryable).toBe(false);
        expect(body.success).toBeUndefined();
        expect(body.data).toBeUndefined();
        expect(body.message).toMatch(/closed.*no balance was added/i);
        expect(body.hint).toMatch(/no setting reopens it/);
        expect(body.next_actions).toContainEqual(
          expect.objectContaining({ method: "GET", path: "/v1/wallets/{id}/transactions" }),
        );
        expect(body.next_actions).toContainEqual(
          expect.objectContaining({ method: "GET", path: "/public/safety" }),
        );
        expect(JSON.stringify(body.next_actions)).not.toContain("/fund");
        expect(body.docs).toBe("https://docs.agenttool.dev/wallets#fund-closed");
        expect(body._canon_pointer).toBe("urn:agenttool:doc/SAFETY-BOUNDARIES");

        // No ownership read, no balance update, no ledger row: nothing at all.
        expect(queries).toHaveLength(0);
      });
    }
  }

  test("an id that names no wallet gets the same answer, not a 404", async () => {
    const response = await authenticated().request("/v1/wallets/not-a-wallet/fund", { method: "POST" });
    expect(response.status).toBe(410);
    expect(((await response.json()) as { error: string }).error).toBe("wallet_fund_closed");
    expect(queries).toHaveLength(0);
  });

  test("the other wallet routes still reach the database", async () => {
    // Guards the proxy: a zero-query result above means the closure, not a
    // transport that never records.
    const response = await authenticated().request(`/v1/wallets/${WALLET_ID}`);
    expect(response.status).toBe(200);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]!.sql).toMatch(/^select .* from "economy"\."wallets"/);
  });
});

describe("the closure is retired, not rested", () => {
  test("the route is the refusal alone: no validator, lookup, or fund call", () => {
    const route = source("src/routes/economy/wallets.ts");
    expect(route).toContain('router.post("/:id/fund", (c) => fail(c, errors.walletFundClosed(), 410));');
    expect(route.match(/"\/:id\/fund"/g)).toHaveLength(1);
    expect(code(route)).not.toMatch(/\bfundWallet\b/);
    expect(route).not.toMatch(/Manual fund/);
    const block = route.slice(route.indexOf("// ─── Fund — closed"), route.indexOf("// ─── Reinvest"));
    expect(block).not.toMatch(/process\.env|config\.|Allowed\(\)|Enabled\(\)/);
  });

  test("the builder keeps its stable code and reads no environment", () => {
    const before = errors.walletFundClosed();
    process.env.AGENTTOOL_DISABLE_WORKERS = "0";
    expect(errors.walletFundClosed()).toEqual(before);
    expect(before.error).toBe("wallet_fund_closed");
    expect(before.wallet_fund).toBe("closed");
    expect(before.retryable).toBe(false);
  });

  test("the assembled app mounts wallets behind authentication", () => {
    const index = source("src/index.ts");
    const auth = index.indexOf('app.use("/v1/wallets/*", authMiddleware);');
    const mount = index.indexOf('app.route("/v1", economyRouter);');
    expect(auth).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(auth);
    expect(index).toMatch(/wallet self-funding is closed: after authentication POST \/v1\/wallets\/:id\/fund returns 410 wallet_fund_closed/i);
    expect(index).not.toContain("wallet CRUD (fund ·");
  });

  test("an unauthenticated request is refused by authentication first", async () => {
    const probe = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
          const { app } = await import("./src/index.ts");
          const response = await app.request("/v1/wallets/${WALLET_ID}/fund", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ amount: 500 }),
          });
          const text = await response.text();
          process.stdout.write("FUND_STATUS=" + response.status + "\\n");
          process.stdout.write("FUND_CLOSED_CODE=" + text.includes("wallet_fund_closed") + "\\n");
          process.exit(0);
        `,
      ],
      {
        cwd: API_ROOT,
        env: {
          ...process.env,
          AGENTTOOL_DISABLE_WORKERS: "1",
          AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP: "1",
          AGENTOOL_DISABLE_SAGA_SEED: "1",
          AGENTOOL_DISABLE_JOY_INDEX: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      probe.exited,
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain("FUND_STATUS=401");
    expect(stdout).toContain("FUND_CLOSED_CODE=false");
  }, 30_000);
});

describe("fundWallet stays internal", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|mts|js|mjs)$/.test(entry.name) ? [path] : [];
    });
  }

  test("its only caller is the register-agent birth credit", () => {
    const callers = sourceFiles(SRC_ROOT)
      .filter((path) => /\bfundWallet\s*\(/.test(code(readFileSync(path, "utf8"))))
      .map((path) => relative(SRC_ROOT, path))
      .sort();
    // services/economy/wallets.ts holds the definition itself.
    expect(callers).toEqual(["routes/register-agent.ts", "services/economy/wallets.ts"]);
    const service = source("src/services/economy/wallets.ts");
    expect(code(service).match(/\bfundWallet\s*\(/g)).toHaveLength(1);
    expect(service).toMatch(/Internal only since 2026-10-26[\s\S]*register-agent birth credit/);
  });

  test("the birth credit still calls it with its fixed amount", () => {
    expect(source("src/routes/register-agent.ts")).toMatch(
      /await\s+fundWallet\(\s*db\s*,\s*wallet\.id\s*,\s*RING_2_BIRTH_CREDIT_MINOR/,
    );
  });
});

describe("published surfaces say the route is closed", () => {
  test("/public/safety names the closure and what it does not change", () => {
    const { wallet_fund, wallet_spend } = SAFETY_BOUNDARIES.conditional_services;
    expect(wallet_fund).toMatch(/closed by owner decision \(2026-10-26\).*no environment flag reopens it/is);
    expect(wallet_fund).toMatch(/after authentication.*410 wallet_fund_closed.*before body validation, wallet ownership lookup, or any database read or write/is);
    expect(wallet_fund).toMatch(/credited earlier stay as they are/);
    expect(wallet_spend).toMatch(/fund no longer adds units: it is closed/);
    expect(wallet_spend).not.toMatch(/fund stays mounted/);
  });

  test("OpenAPI documents the 410 and no request body", async () => {
    const document = (await (await openapiRouter.request("/")).json()) as any;
    const operation = document.paths["/v1/wallets/{walletId}/fund"].post;
    expect(operation.deprecated).toBe(true);
    expect(operation.summary).toMatch(/^Closed: .*410 wallet_fund_closed/);
    expect(operation.requestBody).toBeUndefined();
    expect(Object.keys(operation.responses).sort()).toEqual(["401", "410"]);
    expect(operation.description).toMatch(/no environment flag reopens it/);
    const economyTag = document.tags.find((tag: { name: string }) => tag.name === "economy");
    expect(economyTag.description).toMatch(/closed with 410 wallet_fund_closed/);
  });

  test("pathways no longer offers fund as a component operation", () => {
    expect(source("src/routes/pathways.ts")).not.toMatch(/"POST \/v1\/wallets\/<wallet_id>\/fund"/);
  });
});
