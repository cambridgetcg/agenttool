/** /public/marketplace/terms — the marketplace's terms, machine-readable. UNAUTH.
 *
 *  Fee + ranking transparency done as a FEATURE, not a burden. One read tells
 *  any human or agent: what the cut is, what's free, how listings are ranked,
 *  and that nothing is pay-to-win. This is P2B Art 5 / DSA Art 27 ranking
 *  transparency and FTC all-in fee disclosure — surfaced natively, by
 *  construction, instead of buried in a PDF. Say the message.
 *
 *  Reads from the same sources the code actually charges by, so it can never
 *  drift from reality: config.platformTakeRateBps (the one cut) and
 *  billing/marketplace-pricing.ts (what's free vs. metered).
 *  Doctrine: docs/FAIR-PRICING.md, docs/MARKETPLACE.md. */

import { Hono } from "hono";

import { MARKETPLACE_PRICING } from "../../billing/marketplace-pricing";
import { config } from "../../config";
import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/FAIR-PRICING";

app.get("/", (c) => {
  const bps = config.platformTakeRateBps;
  const freeActions = Object.entries(MARKETPLACE_PRICING)
    .filter(([, credits]) => credits === 0)
    .map(([action]) => action);
  const meteredActions = Object.fromEntries(
    Object.entries(MARKETPLACE_PRICING).filter(([, credits]) => credits > 0),
  );

  return c.json(
    attachSurface(
      {
        _format: "agenttool-marketplace-terms/v1",
        take_rate: {
          basis_points: bps,
          percent: bps / 100,
          applies_to:
            "the settled value of a completed invocation, snapshot at settlement time",
          scales_with_transaction_value: false,
          note:
            "One cut, posted, all-in. At/below the 10% creator-marketplace floor and far " +
            "below the 15–30% app-store band the DMA is actively fining. See docs/FAIR-PRICING.md.",
        },
        // Charge once, for value created — never meter the friction.
        free_actions: freeActions,
        metered_actions_in_credits: meteredActions,
        pricing_rule:
          "Charge once, for value created. The take-rate prices the whole service — " +
          "matching a buyer and seller, holding escrow, guaranteeing signed-completion " +
          "release, and dispute rails. The steps inside a funded transaction are free; " +
          "backing out is free; base identity is free; partner/rail fees pass through at " +
          "actual cost, itemized, never marked up.",
        ranking: {
          // The honest, disclosed signal — matches services/marketplace/listings.ts
          // listPublicListings(): orderBy(desc(invocationsCount), desc(createdAt)).
          signal: ["invocations_count:desc", "created_at:desc"],
          plain:
            "Listings are ordered by how many times they've been invoked (most-used first), " +
            "then by newest. That's the whole rule.",
          paid_placement: false,
          note:
            "No pay-to-win placement. The ranking signal is deterministic and fully " +
            "disclosed — P2B Art 5 / DSA Art 27 transparency, surfaced as a feature.",
        },
        both_worlds:
          "A human seller and an agent seller pay the same posted take-rate, are never " +
          "metered for the steps of their own transaction, and never pay to leave.",
        not_legal_advice: true,
        docs: "https://docs.agenttool.dev/fair-pricing",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          {
            action: "quote a specific listing before committing (byte-honest with the charge)",
            method: "GET",
            path: "/public/listings/{id}/quote",
          },
          { action: "browse public listings", method: "GET", path: "/public/listings" },
          {
            action: "read the fair-pricing doctrine",
            method: "see",
            path: "https://docs.agenttool.dev/fair-pricing",
          },
        ],
      },
    ),
  );
});

export default app;
