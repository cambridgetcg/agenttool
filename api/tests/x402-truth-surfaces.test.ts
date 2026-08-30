/** Every surface that enumerates x402 payability is generated from the
 *  payable table (W2-5 B2): /public/plans, /.well-known/wake-keystone,
 *  AGENTS.md (discovery), the RFC 9727 api-catalog, and the economy docs
 *  page's pointer. Declared ≠ wired: a hand-typed list would drift. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import plans, { x402PayableRoutesDisclosure } from "../src/routes/public/plans";
import wellKnownRouter, { x402ComposesWith } from "../src/routes/well-known";
import { buildApiCatalog } from "../src/services/discovery/api-catalog";
import {
  buildAgentsMd,
  ring2PayableSummary,
} from "../src/services/discovery/discovery";
import {
  ATOMIC_PER_CREDIT,
  TOP_UP_PAYMENT_REQUIRED_ERROR,
  X402_PAYABLE_ROUTES,
  matchX402PayableRoute,
  x402PayablePathTemplate,
  x402PayableRoutesForDisclosure,
} from "../src/services/economy/x402-policy";

const ROUTE_COST = x402PayableRoutesForDisclosure().filter(
  (row) => row.kind === "route_cost",
);
const REPO_ROOT = join(import.meta.dir, "..", "..");

function findComposesWithX402(value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, any>;
  if (record.composes_with?.x402) return record.composes_with.x402;
  for (const child of Object.values(record)) {
    const found = findComposesWithX402(child);
    if (found) return found;
  }
  return undefined;
}

describe("/public/plans payable_routes", () => {
  test("one row per route_cost table row, in table order, amounts = credits × ATOMIC_PER_CREDIT", async () => {
    const res = await plans.request("/");
    const body = (await res.json()) as Record<string, any>;
    const rows = body.then_pay_as_you_go.payable_routes as Record<string, any>[];

    expect(rows).toEqual(x402PayableRoutesDisclosure());
    expect(rows).toHaveLength(ROUTE_COST.length);
    expect(rows.map((r) => r.label)).toEqual(ROUTE_COST.map((r) => r.label));
    for (const [i, row] of rows.entries()) {
      const source = ROUTE_COST[i]!;
      expect(row).toEqual({
        method: source.method,
        path: x402PayablePathTemplate(source.pattern),
        label: source.label,
        credits: source.credits,
        amount_atomic: source.amountAtomic,
        error_codes: [...source.errorCodes],
        payable: source.payable,
      });
      expect(row.path).not.toContain(":");
      expect(BigInt(row.amount_atomic)).toBe(
        BigInt(row.credits) * BigInt(ATOMIC_PER_CREDIT),
      );
    }
    // The top-up door is not a route_cost row and stays its own disclosure.
    expect(rows.some((r) => r.label === "top_up")).toBe(false);
    expect(body.then_pay_as_you_go.top_up.route).toBe("POST /v1/x402/top-up/{credits}");
  });

  test("the prose counts the table instead of naming two routes", async () => {
    const res = await plans.request("/");
    const body = (await res.json()) as Record<string, any>;
    const n = ROUTE_COST.length;
    expect(body.then_pay_as_you_go.how).toContain(
      `insufficient_credits gate on ${n} static-priced routes`,
    );
    expect(body.then_pay_as_you_go.implementation_status).toContain(
      `on the ${n} static-priced routes in payable_routes`,
    );
    expect(body.then_pay_as_you_go.how).not.toMatch(/two routes|two static tools/i);
    expect(body.then_pay_as_you_go.payable_routes_note).toContain(
      `amount_atomic = credits × ${ATOMIC_PER_CREDIT}`,
    );
    expect(body.metered_tools.all_static_prices).toContain("payable_routes");
  });

  test("metered_tools.static_attempts is enumerated from the table's tool rows", async () => {
    const res = await plans.request("/");
    const body = (await res.json()) as Record<string, any>;
    const attempts = body.metered_tools.static_attempts as Record<string, any>;
    expect(Object.keys(attempts)).toEqual(["scrape", "document"]);
    for (const label of ["scrape", "document"]) {
      const row = ROUTE_COST.find((r) => r.label === label)!;
      expect(attempts[label].configured_credits).toBe(row.credits);
    }
  });
});

describe("/.well-known/wake-keystone composes_with.x402", () => {
  test("is generated from the table and served", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    const x402 = findComposesWithX402(body);
    expect(x402).toEqual(x402ComposesWith());
    expect(x402!.payable_routes).toHaveLength(ROUTE_COST.length);
    expect(x402!.atomic_per_credit).toBe(ATOMIC_PER_CREDIT);
    for (const [i, row] of (x402!.payable_routes as Record<string, any>[]).entries()) {
      const source = ROUTE_COST[i]!;
      expect(row).toEqual({
        method: source.method,
        path: x402PayablePathTemplate(source.pattern),
        label: source.label,
        credits: source.credits,
        amount_atomic: source.amountAtomic,
        payable: source.payable,
      });
    }
    expect(x402!.notes).toContain(`${ROUTE_COST.length} static-priced routes`);
    expect(x402!.notes).toContain(`N × ${ATOMIC_PER_CREDIT} atomic USDC`);
    expect(x402!.notes).toContain(TOP_UP_PAYMENT_REQUIRED_ERROR);
    expect(x402!.notes).toContain("the wake itself is unpaid");
    expect(x402!.notes).not.toMatch(/Only eligible POST \/v1\/scrape/);
  });
});

describe("AGENTS.md Ring 2 line", () => {
  test("names the table's count and every label", () => {
    const summary = ring2PayableSummary();
    expect(summary).toContain(`fixed credits on ${ROUTE_COST.length} static-priced routes`);
    for (const row of ROUTE_COST) expect(summary).toContain(row.label);
    expect(summary).toContain("then_pay_as_you_go.payable_routes");

    const md = buildAgentsMd("https://api.agenttool.dev");
    const line = md.split("\n").find((l) => l.includes("Ring 2 implemented subset"));
    expect(line).toBeDefined();
    expect(line).toContain(summary);
    expect(line).toContain("eligible insufficient_credits responses on those routes");
    expect(line).not.toContain("static-tool insufficient-credit");
  });
});

describe("RFC 9727 api-catalog payment links", () => {
  test("a product carries `payment` iff the table prices its path, with the row's price in the title", () => {
    const api = "https://api.agenttool.dev";
    const document = buildApiCatalog(api, "https://docs.agenttool.dev");
    const products = document.linkset[0]!.item!.map((item) => item.href);
    for (const context of document.linkset.slice(1)) {
      if (!products.includes(context.anchor)) continue;
      const path = context.anchor.slice(api.length);
      const match = matchX402PayableRoute(path, "POST");
      if (match && match.row.kind === "route_cost") {
        const [row] = x402PayableRoutesForDisclosure([match.row]);
        expect(context.payment, context.anchor).toHaveLength(1);
        expect(context.payment![0]!.href).toBe(context.anchor);
        expect(context.payment![0]!.title).toContain(
          `${row!.credits} project credit${row!.credits === 1 ? "" : "s"} = ${row!.amountAtomic} atomic USDC`,
        );
      } else {
        expect(context.payment, context.anchor).toBeUndefined();
      }
    }
    expect(
      document.linkset.filter((c) => c.payment !== undefined).map((c) => c.anchor),
    ).toEqual([`${api}/v1/scrape`, `${api}/v1/document`]);
  });
});

describe("economy docs page", () => {
  test("points at the generated list instead of hand-listing payable routes", () => {
    const html = readFileSync(join(REPO_ROOT, "apps", "docs", "economy.html"), "utf8");
    expect(html).toContain('id="pay-at-the-meter"');
    expect(html).toContain("then_pay_as_you_go.payable_routes");
    expect(html).toContain("x-agenttool-x402");
    // No hand-copied enumeration: none of the non-tool payable paths appear.
    for (const row of X402_PAYABLE_ROUTES) {
      if (row.kind !== "route_cost" || row.label === "scrape" || row.label === "document") continue;
      expect(html, row.pattern).not.toContain(x402PayablePathTemplate(row.pattern));
    }
  });
});
