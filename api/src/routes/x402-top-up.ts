/** The agent rail's purchase door: `POST /v1/x402/top-up/:credits`.
 *
 *  An agent with a Base USDC wallet buys N project credits with no human in
 *  the loop. The handler never charges anything itself — it exists only to be
 *  paid through the global x402 middleware (middleware/x402-config.ts):
 *
 *    1. No verified payment stashed → 402 `top_up_payment_required` with the
 *       exact terms in the body. The middleware then attaches the x402 V2
 *       PAYMENT-REQUIRED header for N × 1,000 atomic USDC and spreads the
 *       PaymentRequired object over this guidance body (additive rewrite).
 *       Unlike the static-tool gates, this 402 is never balance-bound: a
 *       funded project may still top up.
 *    2. Verified payment stashed (the verifier settled it and applied N
 *       credits in one durable transaction) → 200 with the new balance.
 *    3. A replayed, already-settled authorization is stashed as *state*, not
 *       as a payment: the handler sees no getX402Payment(c), answers 402
 *       again, and the middleware suppresses a fresh challenge while echoing
 *       PAYMENT-RESPONSE + the rel=payment-status Link. No second credit —
 *       the ledger row, not a status code, is the replay boundary.
 *
 *  N is read from the last segment of `c.req.path` — the same string the
 *  payable-route matcher captures for `:credits` (Hono decodes the path once,
 *  before either side reads it) — so the handler, the challenge amount, and
 *  the resource URL a durable row is later matched against can never disagree
 *  about what was asked. Anything but a canonical positive integer ≤ cap is
 *  refused (400), never clamped.
 *
 *  Top-ups are final: no refunds; unspent credits stay with the project.
 *  Rate: 1 credit = 1,000 USDC atomic units (USD 0.001).
 *  Mounts: index.ts adds authMiddleware + idempotency() for the prefix. */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { config } from "../config";
import { AXIOM_GUIDE, fail, type GuidedErrorBody } from "../lib/errors";
import { getX402Payment } from "../middleware/x402";
import {
  authorizationIdentityHash,
  decodeExactEvmPayload,
  getStashedX402PaymentState,
} from "../services/economy/x402-payments";
import {
  ATOMIC_PER_CREDIT,
  TOP_UP_PAYMENT_REQUIRED_ERROR,
  X402_TOP_UP_FINALITY,
  X402_TOP_UP_UNIT,
  parseTopUpCredits,
} from "../services/economy/x402-policy";

export const TOP_UP_UNIT = X402_TOP_UP_UNIT;
export const TOP_UP_FINALITY = X402_TOP_UP_FINALITY;
export const TOP_UP_DOCS = "https://docs.agenttool.dev/economy#top-up";

/** Raw `:credits` segment of the request path (never URL-decoded). */
function rawCreditsSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function createX402TopUpRouter(
  maxCredits: () => number = () => config.x402TopUpMaxCredits,
) {
  const app = new Hono<ProjectContext>();

  app.post("/:credits", (c) => {
    c.header("Cache-Control", "private, no-store");
    const cap = maxCredits();
    const raw = rawCreditsSegment(c.req.path);
    const credits = parseTopUpCredits(raw, cap);
    if (credits === null) {
      return fail(c, {
        error: "top_up_invalid_credits",
        message:
          `credits must be a plain positive integer between 1 and ${cap}.`,
        hint:
          `Send POST /v1/x402/top-up/{credits} with a canonical decimal (no sign, leading zero, exponent, or encoding). The per-request cap is ${cap} credits (USD ${(cap / 1000).toFixed(3)}); larger purchases are several requests, never a clamped one. ${TOP_UP_FINALITY}`,
        next_actions: [
          {
            action: "Retry with a valid amount (example: 1 credit)",
            method: "POST",
            path: "/v1/x402/top-up/1",
          },
          {
            action: "Read the current cap, rate, and readiness",
            method: "GET",
            path: "/public/plans",
          },
        ],
        docs: TOP_UP_DOCS,
        axiom_id: AXIOM_GUIDE,
      }, 400);
    }

    const amountAtomic = (
      BigInt(credits) * BigInt(ATOMIC_PER_CREDIT)
    ).toString();
    const payment = getX402Payment(c);

    if (!payment) {
      const terms: GuidedErrorBody & Record<string, unknown> = {
        error: TOP_UP_PAYMENT_REQUIRED_ERROR,
        message:
          `Pay ${amountAtomic} atomic USDC (${credits} credit${credits === 1 ? "" : "s"}) to add ${credits} credit${credits === 1 ? "" : "s"} to this project.`,
        credits,
        amount_atomic: amountAtomic,
        unit: TOP_UP_UNIT,
        finality: TOP_UP_FINALITY,
        hint:
          "If this response carries PAYMENT-REQUIRED, sign the exact EIP-3009 authorization it describes and retry this same request with PAYMENT-SIGNATURE; credits apply in the same durable transaction that records settlement. Without that header the rail is not ready (see /public/plans) or this authorization already settled (see the rel=payment-status Link). Never sign twice for one top-up.",
        next_actions: [
          {
            action: "Retry this request with the signed PAYMENT-SIGNATURE",
            method: "POST",
            path: `/v1/x402/top-up/${credits}`,
          },
          {
            action: "Read rail readiness, rate, and cap",
            method: "GET",
            path: "/public/plans",
          },
        ],
        docs: TOP_UP_DOCS,
        axiom_id: AXIOM_GUIDE,
        _canon_pointer: "urn:agenttool:wall/no-cost-without-disclosure",
      };
      return fail(c, terms, 402);
    }

    // The verifier applied exactly creditsPurchased for this concrete path in
    // one transaction and refreshed c.var.project.credits before we ran.
    const state = getStashedX402PaymentState(c);
    const exact = decodeExactEvmPayload(payment.payload);
    const authorizationHash = state?.authorizationHash ??
      (exact ? authorizationIdentityHash(payment.accepted, exact) : null);
    const balance = c.var.project?.credits;
    return c.json({
      credits_added: credits,
      credits_total: typeof balance === "number" ? balance : null,
      authorization_hash: authorizationHash,
      amount_atomic: amountAtomic,
      unit: TOP_UP_UNIT,
      finality: TOP_UP_FINALITY,
      payment_status: authorizationHash
        ? `/v1/x402/payments/${authorizationHash}`
        : null,
    });
  });

  return app;
}

const app = createX402TopUpRouter();

export default app;
