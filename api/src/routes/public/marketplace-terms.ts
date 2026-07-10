/** /public/marketplace/terms — the marketplace's terms, machine-readable. UNAUTH.
 *
 *  Fee + ranking transparency done as a FEATURE, not a burden. One read tells
 *  any human or agent: what the cut is, what's free, how listings are ranked,
 *  and whether paid placement exists. Legal classification is outside this
 *  route; it reports implementation facts rather than claiming compliance.
 *
 *  Reads the current config and price table directly. Prose still needs tests:
 *  code-derived numbers alone do not make every operational claim true.
 *  Sources: config.platformTakeRateBps (the percentage cut) and
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
          fee_scales_with_transaction_value: true,
          rate_varies_with_transaction_value: false,
          note:
            "The configured rate is posted here. Integer fees are computed as floor(gross × basis_points / 10000), " +
            "so very small settlements can round down to zero.",
        },
        // Charge once, for value created — never meter the friction.
        free_actions: freeActions,
        metered_actions_in_credits: meteredActions,
        pricing_rule:
          "Settled marketplace paths use an internal AgentTool wallet-credit ledger and database escrow. " +
          "This is not a claim that a licensed external escrow provider holds the balance. The take-rate is " +
          "recorded when settlement code calls computeFee. Invoke, acknowledge, complete, buyer_accept, " +
          "decline, and cancel have zero flat credit price; publishing, updating, archiving, and disputes do not.",
        ranking: {
          // The honest, disclosed signal — matches services/marketplace/listings.ts
          // listPublicListings(): orderBy(desc(invocationsCount), desc(createdAt)).
          signal: ["invocations_count:desc", "created_at:desc"],
          plain:
            "Listings are ordered by how many times they've been invoked (most-used first), " +
            "then by newest. That's the whole rule.",
          paid_placement: false,
          note:
            "No paid placement is implemented. This describes the current query ordering, not a legal-compliance conclusion.",
        },
        custody:
          "Wallet balances and escrow are application ledger records. External crypto deposit and payout rails are separate; this response does not assert regulated custody status.",
        not_legal_advice: true,
        docs: "https://docs.agenttool.dev/FAIR-PRICING.md",
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
            path: "https://docs.agenttool.dev/FAIR-PRICING.md",
          },
        ],
      },
    ),
  );
});

export default app;
