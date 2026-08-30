/** Wave 2 · W2-1/W2-2/W2-5 — payable-route table, pure matcher, top-up
 * parsing, kind-aware credit gate, and the declared≠wired proofs for every
 * route_cost row: present in the assembled app, priced from ROUTE_CREDITS,
 * labelled by the handler's own charge() reason. No DB, no network (one
 * child process boots the app to read `app.routes`). */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LITERAL_ROUTE_CREDIT_LABELS,
  ROUTE_CREDITS,
  type RouteCreditLabel,
} from "../src/billing/route-credits";
import { MARKETPLACE_PRICING } from "../src/billing/marketplace-pricing";
import { config } from "../src/config";
import { toolsConfig } from "../src/services/tools/config";
import {
  ATOMIC_PER_CREDIT,
  canClearProjectCreditGate,
  isX402ProjectCreditRoute,
  matchX402PayableRoute,
  parseTopUpCredits,
  recoverableX402ProjectCreditPolicy,
  TOP_UP_PAYMENT_REQUIRED_ERROR,
  X402_PAYABLE_ROUTES,
  X402_TOP_UP_PATTERN,
  x402PayableRoutesForDisclosure,
  x402ProjectCreditPolicy,
  type X402PayableRoute,
  type X402ProjectCreditPolicy,
} from "../src/services/economy/x402-policy";

const POSTGRES_INTEGER_MAX = 2_147_483_647;

/** The 21 route_cost rows W2-5 seeds, in table order, as `METHOD pattern`
 * → label. Written out once here (not derived) so a row silently dropped
 * from or added to the table fails loudly. */
const ROUTE_COST_ROWS: ReadonlyArray<readonly [string, RouteCreditLabel]> = [
  ["POST /v1/scrape", "scrape"],
  ["POST /v1/document", "document"],
  ["POST /v1/memories/search", "memory.search"],
  ["POST /v1/memories/:id/elevate", "memory.elevate"],
  ["POST /v1/memories/:id/attest", "memory.attest"],
  ["POST /v1/traces", "trace.write"],
  ["POST /v1/traces/search", "trace.search"],
  ["GET /v1/traces/chain/:id", "trace.chain"],
  ["POST /v1/strands", "strand.create"],
  ["POST /v1/strands/:strandId/thoughts", "strand.think"],
  ["PATCH /v1/strands/:strandId/thoughts/:thoughtId/ciphertext", "strand.rotate"],
  ["POST /v1/inbox", "inbox.send"],
  ["POST /v1/inbox/:id/co-sign", "inbox.cosign"],
  ["POST /v1/templates", "template.create"],
  ["POST /v1/templates/:id/purchase", "template.purchase"],
  ["POST /v1/identities/from-template", "template.adopt"],
  ["POST /v1/orgs", "org.create"],
  ["POST /v1/identities/:id/fork", "identity.fork"],
  ["POST /v1/listings", "listing.publish"],
  ["PATCH /v1/listings/:id", "listing.update"],
  ["DELETE /v1/listings/:id", "listing.archive"],
];

const ROUTE_COST = X402_PAYABLE_ROUTES.filter((r) => r.kind === "route_cost");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (entry.isFile() && full.endsWith(".ts")) yield full;
  }
}

/** Every `charge(c, <amount>, "<label>")` / `reserveCharge(...)` call site
 * under api/src/routes: label → the amount expressions used for it. */
function chargeCallSites(): Map<string, Array<{ file: string; amount: string }>> {
  const routesDir = new URL("../src/routes", import.meta.url).pathname;
  const sites = new Map<string, Array<{ file: string; amount: string }>>();
  const call = /\b(?:charge|reserveCharge)\(\s*c,\s*([^,]+?),\s*"([^"]+)"/gu;
  for (const file of sourceFiles(routesDir)) {
    const source = readFileSync(file, "utf-8");
    for (const m of source.matchAll(call)) {
      const list = sites.get(m[2]) ?? [];
      list.push({ file: file.slice(routesDir.length + 1), amount: m[1].trim() });
      sites.set(m[2], list);
    }
  }
  return sites;
}

describe("X402_PAYABLE_ROUTES table", () => {
  test("seeds 21 route_cost rows (W2-5) plus the top-up door, in this order", () => {
    expect(X402_PAYABLE_ROUTES).toHaveLength(22);
    expect(ROUTE_COST.map((r) => [`${r.method} ${r.pattern}`, r.label]))
      .toEqual(ROUTE_COST_ROWS.map(([route, label]) => [route, label]));
    for (const row of ROUTE_COST) {
      expect(row.errorCodes).toEqual(["insufficient_credits"]);
      expect(row.credits).toBe(ROUTE_CREDITS[row.label as RouteCreditLabel]);
      expect(Number.isSafeInteger(row.credits)).toBe(true);
      expect(row.credits!).toBeGreaterThan(0);
    }
    // The top_up row landed with its route (W2-2): routes/x402-top-up.ts.
    const topUp = X402_PAYABLE_ROUTES.at(-1)!;
    expect(topUp).toMatchObject({
      method: "POST",
      pattern: X402_TOP_UP_PATTERN,
      kind: "top_up",
      credits: null,
      label: "top_up",
      errorCodes: [TOP_UP_PAYMENT_REQUIRED_ERROR],
    });
    expect(TOP_UP_PAYMENT_REQUIRED_ERROR).toBe("top_up_payment_required");
    expect(X402_PAYABLE_ROUTES.filter((r) => r.kind === "top_up")).toHaveLength(1);
    // Labels are unique (one price per usage_events.tool value).
    expect(new Set(X402_PAYABLE_ROUTES.map((r) => r.label)).size).toBe(22);
  });

  test("config-driven prices flow through ROUTE_CREDITS unchanged", () => {
    expect(ROUTE_CREDITS.scrape).toBe(toolsConfig.credits.scrape);
    expect(ROUTE_CREDITS.document).toBe(toolsConfig.credits.document);
    expect(ROUTE_CREDITS["listing.publish"]).toBe(MARKETPLACE_PRICING.publish);
    expect(ROUTE_CREDITS["listing.update"]).toBe(MARKETPLACE_PRICING.update);
    expect(ROUTE_CREDITS["listing.archive"]).toBe(MARKETPLACE_PRICING.archive);
    expect(Object.isFrozen(ROUTE_CREDITS)).toBe(true);
    expect(Object.keys(ROUTE_CREDITS).sort()).toEqual(
      ROUTE_COST.map((r) => r.label).sort(),
    );
  });

  test("doctrine exclusions never appear as rows", () => {
    const labels = new Set(X402_PAYABLE_ROUTES.map((r) => r.label));
    for (const excluded of [
      "execute", "browse", "time", "random", "listing.invoke",
      "invocation.acknowledge", "invocation.complete", "invocation.witness",
      "invocation.decline", "invocation.cancel", "mcp",
    ]) {
      expect(labels.has(excluded)).toBe(false);
    }
    for (const row of X402_PAYABLE_ROUTES) {
      expect(row.pattern).not.toMatch(
        /^\/v1\/(wake|welcome|register|time|random|mcp|execute|browse)(\/|$)|^\/public(\/|$)/u,
      );
    }
  });

  test("every route_cost label is the exact charge() reason at its call site, and every call site reads ROUTE_CREDITS or its config source (never a literal)", () => {
    const sites = chargeCallSites();
    expect(sites.size).toBeGreaterThan(20);
    for (const row of ROUTE_COST) {
      const uses = sites.get(row.label);
      expect(uses, `no charge()/reserveCharge() site labelled "${row.label}"`).toBeDefined();
      expect(uses!.length).toBeGreaterThan(0);
    }
    // No call site anywhere under routes/ prices with a bare number.
    for (const [label, uses] of sites) {
      for (const use of uses) {
        expect(use.amount, `${use.file}: ${label} uses literal ${use.amount}`)
          .not.toMatch(/^[0-9_]+$/u);
      }
    }
    // Literal-priced labels read the hoisted map by their own name.
    for (const label of LITERAL_ROUTE_CREDIT_LABELS) {
      for (const use of sites.get(label)!) {
        expect(use.amount).toBe(`ROUTE_CREDITS["${label}"]`);
      }
    }
    expect([...LITERAL_ROUTE_CREDIT_LABELS].sort()).toEqual(
      Object.keys(ROUTE_CREDITS)
        .filter((k) => !["scrape", "document", "listing.publish", "listing.update", "listing.archive"].includes(k))
        .sort(),
    );
    // Config-sourced labels read the same source ROUTE_CREDITS re-exports.
    const routesDir = new URL("../src/routes", import.meta.url).pathname;
    for (const [label, file, source] of [
      ["scrape", "tools/scrape.ts", "toolsConfig.credits.scrape"],
      ["document", "tools/document.ts", "toolsConfig.credits.document"],
    ] as const) {
      expect(sites.get(label)!.map((u) => u.amount)).toEqual(["cost"]);
      expect(readFileSync(join(routesDir, file), "utf-8"))
        .toContain(`const cost = ${source};`);
    }
    expect(sites.get("listing.publish")!.map((u) => u.amount)).toEqual(["MARKETPLACE_PRICING.publish"]);
    expect(sites.get("listing.update")!.map((u) => u.amount)).toEqual(["MARKETPLACE_PRICING.update"]);
    expect(sites.get("listing.archive")!.map((u) => u.amount)).toEqual(["MARKETPLACE_PRICING.archive"]);
  });

  test("every row is wired in the assembled app (declared ≠ wired)", async () => {
    const apiRoot = new URL("..", import.meta.url).pathname;
    const probe = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
          const { app } = await import("./src/index.ts");
          const seen = new Set();
          for (const r of app.routes) seen.add(r.method + " " + r.path);
          process.stdout.write("ROUTES=" + JSON.stringify([...seen]) + "\\n");
          process.exit(0);
        `,
      ],
      {
        cwd: apiRoot,
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
    expect(exitCode, stderr.slice(-800)).toBe(0);
    const line = stdout.split("\n").find((l) => l.startsWith("ROUTES="));
    expect(line).toBeDefined();
    const wired = new Set(JSON.parse(line!.slice("ROUTES=".length)) as string[]);
    const missing = X402_PAYABLE_ROUTES
      .map((r) => `${r.method} ${r.pattern}`)
      .filter((key) => !wired.has(key));
    expect(missing).toEqual([]);
  });

  test("disclosure rows mirror the table with exact atomic amounts", () => {
    const rows = x402PayableRoutesForDisclosure();
    expect(rows).toHaveLength(X402_PAYABLE_ROUTES.length);
    expect(Object.isFrozen(rows)).toBe(true);
    rows.forEach((row, i) => {
      const source = X402_PAYABLE_ROUTES[i];
      expect(row).toMatchObject({
        method: source.method,
        pattern: source.pattern,
        kind: source.kind,
        label: source.label,
        errorCodes: source.errorCodes,
      });
      if (source.kind === "top_up") {
        expect(row).toMatchObject({ credits: null, amountAtomic: null, payable: true });
        return;
      }
      expect(row.credits).toBe(source.credits);
      expect(row.amountAtomic).toBe(String(BigInt(source.credits!) * BigInt(ATOMIC_PER_CREDIT)));
      expect(row.payable).toBe(true);
      expect(x402ProjectCreditPolicy(
        source.pattern.replace(/:[A-Za-z]+/gu, "11111111-1111-4111-8111-111111111111"),
        source.method,
      )!.amountAtomic).toBe(row.amountAtomic!);
    });
    expect(rows.find((r) => r.label === "memory.search")!.amountAtomic).toBe("3000");
    // A misconfigured price is listed but not payable — visible, not silent.
    const broken = x402PayableRoutesForDisclosure([
      { ...X402_PAYABLE_ROUTES[0], credits: 0 },
      { ...X402_PAYABLE_ROUTES[0], credits: 1.5 },
    ]);
    expect(broken.map((r) => r.payable)).toEqual([false, false]);
    expect(broken.map((r) => r.amountAtomic)).toEqual([null, null]);
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
    expect(matchX402PayableRoute("/v1/x402/top-up/1", "POST")!.row.kind).toBe("top_up");
    expect(matchX402PayableRoute("/v1/x402/top-up/1", "GET")).toBeNull();
    expect(matchX402PayableRoute("/v1/x402/top-up", "POST")).toBeNull();
    expect(matchX402PayableRoute("/v1/x402/top-up/1/", "POST")).toBeNull();
    expect(matchX402PayableRoute("/v1/x402/payments/1", "POST")).toBeNull();
    expect(matchX402PayableRoute("/v1/scrape", "POST", X402_PAYABLE_ROUTES))
      .toEqual(matchX402PayableRoute("/v1/scrape", "POST"));
  });
});

describe("W2-5 rows: precedence and doctrine negatives (real table)", () => {
  const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  test("literal siblings win over :id rows; dynamic rows capture their params", () => {
    expect(matchX402PayableRoute("/v1/memories/search", "POST")!.row.label).toBe("memory.search");
    expect(matchX402PayableRoute(`/v1/memories/${ID}/elevate`, "POST")).toMatchObject({
      row: { label: "memory.elevate" },
      params: { id: ID },
      concretePath: `/v1/memories/${ID}/elevate`,
    });
    expect(matchX402PayableRoute(`/v1/memories/${ID}/attest`, "POST")!.row.label).toBe("memory.attest");
    expect(matchX402PayableRoute("/v1/traces/search", "POST")!.row.label).toBe("trace.search");
    expect(matchX402PayableRoute("/v1/traces", "POST")!.row.label).toBe("trace.write");
    expect(matchX402PayableRoute(`/v1/traces/chain/${ID}`, "GET")).toMatchObject({
      row: { label: "trace.chain" },
      params: { id: ID },
    });
    expect(matchX402PayableRoute("/v1/identities/from-template", "POST")!.row.label)
      .toBe("template.adopt");
    expect(matchX402PayableRoute(`/v1/identities/${ID}/fork`, "POST")).toMatchObject({
      row: { label: "identity.fork" },
      params: { id: ID },
    });
    expect(matchX402PayableRoute(`/v1/strands/${ID}/thoughts`, "POST")!.params)
      .toEqual({ strandId: ID });
    expect(matchX402PayableRoute(`/v1/strands/${ID}/thoughts/${ID}/ciphertext`, "PATCH"))
      .toMatchObject({ row: { label: "strand.rotate" }, params: { strandId: ID, thoughtId: ID } });
    expect(matchX402PayableRoute(`/v1/inbox/${ID}/co-sign`, "POST")!.row.label).toBe("inbox.cosign");
    expect(matchX402PayableRoute(`/v1/templates/${ID}/purchase`, "POST")!.row.label)
      .toBe("template.purchase");
    expect(matchX402PayableRoute(`/v1/listings/${ID}`, "PATCH")!.row.label).toBe("listing.update");
    expect(matchX402PayableRoute(`/v1/listings/${ID}`, "DELETE")!.row.label).toBe("listing.archive");
    expect(matchX402PayableRoute(`/v1/listings/${ID}`, "GET")).toBeNull();
    expect(matchX402PayableRoute(`/v1/listings/${ID}`, "POST")).toBeNull();
  });

  test("literal-over-param holds for search rows whatever the table order", () => {
    const param: X402PayableRoute = {
      method: "POST", pattern: "/v1/traces/:id", kind: "route_cost",
      credits: 9, label: "scratch.param", errorCodes: ["insufficient_credits"],
    };
    const search = X402_PAYABLE_ROUTES.find((r) => r.label === "trace.search")!;
    const memParam: X402PayableRoute = { ...param, pattern: "/v1/memories/:id", label: "scratch.mem" };
    const memSearch = X402_PAYABLE_ROUTES.find((r) => r.label === "memory.search")!;
    for (const table of [[param, search], [search, param]]) {
      expect(matchX402PayableRoute("/v1/traces/search", "POST", table)!.row).toBe(search);
      expect(matchX402PayableRoute(`/v1/traces/${ID}`, "POST", table)!.row).toBe(param);
    }
    for (const table of [[memParam, memSearch], [memSearch, memParam]]) {
      expect(matchX402PayableRoute("/v1/memories/search", "POST", table)!.row).toBe(memSearch);
      expect(matchX402PayableRoute(`/v1/memories/${ID}`, "POST", table)!.row).toBe(memParam);
    }
  });

  test("sibling paths that are not metered stay null", () => {
    for (const [path, method] of [
      [`/v1/traces/${ID}`, "GET"],
      [`/v1/traces/${ID}`, "DELETE"],
      ["/v1/traces/prepare", "POST"],
      ["/v1/traces/chain", "GET"],
      [`/v1/traces/chain/${ID}`, "POST"],
      ["/v1/memories", "POST"],
      [`/v1/memories/${ID}`, "PATCH"],
      [`/v1/memories/${ID}/canonical-attestation-bytes`, "GET"],
      ["/v1/strands", "GET"],
      [`/v1/strands/${ID}`, "PATCH"],
      [`/v1/strands/${ID}/voice`, "POST"],
      ["/v1/inbox", "GET"],
      [`/v1/inbox/${ID}`, "PATCH"],
      ["/v1/templates", "GET"],
      [`/v1/templates/${ID}`, "PATCH"],
      [`/v1/templates/${ID}/adopt`, "POST"],
      ["/v1/orgs", "GET"],
      [`/v1/identities/${ID}`, "GET"],
      [`/v1/identities/${ID}/lineage`, "GET"],
      [`/v1/listings/${ID}/invoke`, "POST"],
      [`/v1/invocations/${ID}/complete`, "POST"],
    ] as const) {
      expect(matchX402PayableRoute(path, method), `${method} ${path}`).toBeNull();
    }
  });

  test("WAKE-free and excluded doors are never payable", () => {
    for (const [path, method] of [
      ["/v1/browse", "POST"],
      ["/v1/execute", "POST"],
      ["/v1/time", "GET"],
      ["/v1/time", "POST"],
      ["/v1/random", "GET"],
      ["/v1/random", "POST"],
      ["/v1/wake", "GET"],
      ["/v1/wake", "POST"],
      ["/v1/wake/thoughtful", "POST"],
      ["/v1/welcome", "GET"],
      ["/v1/mcp", "POST"],
      [`/v1/mcp/agents/${ID}`, "POST"],
      ["/v1/register/agent", "POST"],
      ["/v1/register", "POST"],
      ["/public/plans", "GET"],
      ["/public", "GET"],
    ] as const) {
      expect(matchX402PayableRoute(path, method), `${method} ${path}`).toBeNull();
      expect(x402ProjectCreditPolicy(path, method)).toBeNull();
      expect(recoverableX402ProjectCreditPolicy(path, method, "insufficient_credits")).toBeNull();
    }
  });

  test("route_cost policy on a dynamic row carries the concrete path and full price", () => {
    const path = `/v1/memories/${ID}/elevate`;
    const policy = x402ProjectCreditPolicy(path, "POST")!;
    expect(policy).toMatchObject({
      path,
      pattern: "/v1/memories/:id/elevate",
      kind: "route_cost",
      label: "memory.elevate",
      creditsRequired: ROUTE_CREDITS["memory.elevate"],
      amountAtomic: "5000",
    });
    expect(policy.description).toContain(path);
    expect(recoverableX402ProjectCreditPolicy(path, "POST", "insufficient_credits")).toEqual(policy);
    expect(recoverableX402ProjectCreditPolicy(path, "POST", TOP_UP_PAYMENT_REQUIRED_ERROR)).toBeNull();
    expect(canClearProjectCreditGate(policy, 4)).toBe(true);
    expect(canClearProjectCreditGate(policy, 5)).toBe(false);
    expect(x402ProjectCreditPolicy("/v1/memories/search", "POST")!.amountAtomic).toBe("3000");
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

  test("top_up policy on the real table: N from the path, N×1000 atomic, only its own 402 code", () => {
    const policy = x402ProjectCreditPolicy("/v1/x402/top-up/250", "POST")!;
    expect(policy).toMatchObject({
      path: "/v1/x402/top-up/250",
      pattern: X402_TOP_UP_PATTERN,
      kind: "top_up",
      label: "top_up",
      creditsRequired: 250,
      amountAtomic: "250000",
    });
    expect(policy.description).toMatch(/final/i);
    expect(x402ProjectCreditPolicy("/v1/x402/top-up/1", "POST")!.amountAtomic).toBe("1000");
    expect(x402ProjectCreditPolicy(
      `/v1/x402/top-up/${config.x402TopUpMaxCredits}`, "POST",
    )!.creditsRequired).toBe(config.x402TopUpMaxCredits);
    // Refused, never clamped: over-cap, zero, leading zero, encoded digits.
    for (const bad of [
      String(config.x402TopUpMaxCredits + 1), "0", "01", "%31", "1e3", "-1", "abc",
    ]) {
      expect(x402ProjectCreditPolicy(`/v1/x402/top-up/${bad}`, "POST")).toBeNull();
    }
    expect(recoverableX402ProjectCreditPolicy(
      "/v1/x402/top-up/250", "POST", TOP_UP_PAYMENT_REQUIRED_ERROR,
    )).toEqual(policy);
    for (const code of ["insufficient_credits", "insufficient_balance", undefined]) {
      expect(recoverableX402ProjectCreditPolicy("/v1/x402/top-up/250", "POST", code))
        .toBeNull();
    }
    // A funded project may still top up.
    expect(canClearProjectCreditGate(policy, 110_800)).toBe(true);
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
