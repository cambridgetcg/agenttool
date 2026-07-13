/** /public/marketplace/terms — marketplace implementation notes. UNAUTH.
 *
 *  Fee + ranking transparency done as a FEATURE, not a burden. One read tells
 *  any reader: what the configured cut is, what's free, how listings are
 *  ranked, and whether paid placement exists. This route is operational
 *  disclosure, not a consumer contract, regulated-custody description, or
 *  legal-compliance determination.
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
const RESTING_ACTIONS = new Set(["buyer_accept", "dispute"]);

app.get("/", (c) => {
  const bps = config.platformTakeRateBps;
  const freeActions = Object.entries(MARKETPLACE_PRICING)
    .filter(([action, credits]) => credits === 0 && !RESTING_ACTIONS.has(action))
    .map(([action]) => action);
  const meteredActions = Object.fromEntries(
    Object.entries(MARKETPLACE_PRICING).filter(
      ([action, credits]) => credits > 0 && !RESTING_ACTIONS.has(action),
    ),
  );

  return c.json(
    attachSurface(
      {
        _format: "agenttool-marketplace-terms/v1",
        status: "implementation_notes_not_consumer_contract",
        limitations: [
          "Internal wallet and escrow labels describe application ledger states, not bank accounts, regulated escrow, or protected deposits.",
          "Availability, settlement, dispute outcomes, and release are not guaranteed by this document.",
          "Card checkout creation is currently resting; existing paid-session recovery remains active.",
          "Dispute-policy review and arbitration are resting; mutation routes return stable 503 before charge or state change.",
        ],
        take_rate: {
          basis_points: bps,
          percent: bps / 100,
          applies_to:
            "the settled value of a completed invocation, snapshot at settlement time",
          fee_scales_with_transaction_value: true,
          rate_varies_with_transaction_value: false,
          note:
            "The configured rate is posted here and is used by settlement paths that call the fee helper. " +
            "Integer fees are computed as floor(gross × basis_points / 10000), so very small settlements can " +
            "round down to zero. Check a specific quote and transaction response before committing.",
        },
        // Charge once, for value created — never meter the friction.
        free_actions: freeActions,
        metered_actions_in_credits: meteredActions,
        resting_actions: {
          buyer_accept: "503 dispute_arbitration_resting before charge or state change",
          dispute: "503 dispute_arbitration_resting before parsing, charge, or state change",
          dispute_case_mutations:
            "rule, escalate, vote, and finalize return 503 dispute_arbitration_resting",
        },
        pricing_rule:
          "Settled marketplace paths use an internal AgentTool wallet-credit ledger and database escrow. " +
          "This is not a claim that a licensed external escrow provider holds the balance. The take-rate is " +
          "recorded when settlement code calls computeFee and is intended to price matching, internal ledger " +
          "escrow states and validation of signed completion. Release follows implemented " +
          "state-transition conditions; this route does not guarantee availability or outcome. Invoke, " +
          "acknowledge, complete, decline, and cancel have zero flat credit price; publishing, updating, and " +
          "archiving are metered. Buyer review and dispute arbitration are excluded from both lists because " +
          "they rest fail-closed before charging. Specific quote and transaction responses govern; this route does not " +
          "itemize external rail fees.",
        ranking: {
          // The honest, disclosed signal — matches services/marketplace/listings.ts
          // listPublicListings(): orderBy(desc(invocationsCount), desc(createdAt)).
          signal: ["invocations_count:desc", "created_at:desc"],
          plain:
            "Listings are ordered by how many times they've been invoked (most-used first), " +
            "then by newest. That's the whole rule.",
          paid_placement: false,
          note:
            "No paid placement is implemented. These published ordering signals describe the current query " +
            "ordering, not a legal-compliance conclusion.",
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
