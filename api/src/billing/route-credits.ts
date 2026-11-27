/** route-credits.ts — the one place every static-priced metered route reads
 *  its credit price from.
 *
 *  Keys are the exact `charge()` / `reserveCharge()` reason strings at each
 *  call site (they are also the `usage_events.tool` values and the x402
 *  payable-route labels), so a price can be looked up by the same name a
 *  ledger row or a 402 carries. Values are what the handler debits.
 *
 *  Three price sources, all surfaced here so the x402 payable-route table
 *  (services/economy/x402-policy.ts) and every truth surface generated from
 *  it (`GET /public/plans`, OpenAPI) never hand-copy a number:
 *    - literal platform prices (memory / trace / strand / inbox / template /
 *      org / identity) — defined here and only here;
 *    - toolsConfig.credits.* (scrape, document) — environment-overridable
 *      infra costs, re-exported at module load exactly as the tool handlers
 *      read them;
 *    - MARKETPLACE_PRICING.* (listing lifecycle) — the marketplace meter,
 *      whose fair-pricing rule lives in billing/marketplace-pricing.ts.
 *
 *  Not here, on purpose:
 *    execute       — body-derived (per-10s estimate), never a static price;
 *    browse        — toolsConfig-priced but production-flagged off;
 *    time, random  — 0 credits and keyless (substrate-honest: WAKE-adjacent);
 *    listing.invoke / invocation.* — 0 by doctrine (charged once, at the
 *                    take-rate; docs/FAIR-PRICING.md);
 *    listing.archive / listing.pause — 0: taking a listing down is leaving,
 *                    and leaving is free (billing/marketplace-pricing.ts);
 *    /v1/mcp       — never metered (Yu).
 *
 *  Free floor (2026-10-20): memory search, strands and inbox cost 0 credits
 *  (memory writes reserve 0 at their own call site). Daily quotas and a
 *  global storage cap bound them instead; see ./free-floor.ts. A 0 price
 *  makes the route non-payable in the x402 table.
 *
 *  Tests: tests/x402-policy-table.test.ts pins every call site to this map
 *  and every payable row to a wired route. */

import { MARKETPLACE_PRICING } from "./marketplace-pricing";
import { toolsConfig } from "../services/tools/config";

export const ROUTE_CREDITS = Object.freeze({
  // Static tools (services/tools/config.ts; CREDIT_SCRAPE / CREDIT_DOCUMENT).
  scrape: toolsConfig.credits.scrape,
  document: toolsConfig.credits.document,
  // Memory. Search is on the free floor (./free-floor.ts).
  "memory.search": 0,
  "memory.elevate": 5,
  "memory.attest": 1,
  // Traces.
  "trace.write": 1,
  "trace.search": 2,
  "trace.chain": 1,
  // Strands, on the free floor (./free-floor.ts).
  "strand.create": 0,
  "strand.think": 0,
  "strand.rotate": 0,
  // Inbox, on the free floor (./free-floor.ts).
  "inbox.send": 0,
  "inbox.cosign": 0,
  // Templates (adopt is POST /v1/identities/from-template).
  "template.create": 5,
  "template.purchase": 5,
  "template.adopt": 10,
  // Orgs.
  "org.create": 5,
  // Identity.
  "identity.fork": 10,
  // Marketplace listing lifecycle (billing/marketplace-pricing.ts).
  "listing.publish": MARKETPLACE_PRICING.publish,
  "listing.update": MARKETPLACE_PRICING.update,
} as const satisfies Readonly<Record<string, number>>);

export type RouteCreditLabel = keyof typeof ROUTE_CREDITS;

/** Labels whose price is a literal in this file (not re-exported from
 *  toolsConfig or MARKETPLACE_PRICING). Their `charge()` call sites read
 *  `ROUTE_CREDITS["<label>"]` directly; the source test pins that. */
export const LITERAL_ROUTE_CREDIT_LABELS = Object.freeze([
  "memory.search",
  "memory.elevate",
  "memory.attest",
  "trace.write",
  "trace.search",
  "trace.chain",
  "strand.create",
  "strand.think",
  "strand.rotate",
  "inbox.send",
  "inbox.cosign",
  "template.create",
  "template.purchase",
  "template.adopt",
  "org.create",
  "identity.fork",
] as const satisfies readonly RouteCreditLabel[]);
