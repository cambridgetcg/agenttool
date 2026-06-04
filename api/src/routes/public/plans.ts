/** /public/plans — what's free, what costs, and why it's fair. UNAUTH.
 *
 *  The whole money model in one honest read: free to try, fair to use, honest
 *  to charge — and never a loophole to exploit. Reads from the SAME constants
 *  the platform enforces by (Ring-1 caps, the birth grant, the take-rate, the
 *  registration proof-of-work) so it can never drift from what actually happens.
 *
 *  Companion to /public/marketplace/terms (the marketplace cut + ranking).
 *  Doctrine: docs/FAIR-PRICING.md · docs/RING-1.md · docs/BUSINESS-MODEL.md. */

import { Hono } from "hono";

import { config } from "../../config";
import { attachSurface } from "../../lib/surface-metadata";
import { RING_1_LIMITS, RING_2_BIRTH_CREDIT_MINOR } from "../../services/economy/ring1-limits";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/BUSINESS-MODEL";

app.get("/", (c) => {
  const bps = config.platformTakeRateBps;

  return c.json(
    attachSurface(
      {
        _format: "agenttool-plans/v1",
        principle:
          "Free to try, fair to use, honest to charge. Nothing good comes for free — " +
          "but trying is free, and there is never a loophole to exploit.",

        free_to_try: {
          ring: 1,
          what:
            "Identity birth, wake reads, federation, public reads, and pulse are unmetered. " +
            "Memory, vault, strands, and inbox have generous caps.",
          caps: RING_1_LIMITS,
          caps_are:
            "guidance, not walls — over-cap usage is soft-degraded (e.g. inbox ack-but-queue), never refused.",
        },

        free_at_birth: {
          ring: 2,
          credits_minor: RING_2_BIRTH_CREDIT_MINOR,
          approx:
            "~$5 / £5 of metered use, free at birth — enough for a first month of light use with no payment friction.",
          note: "A demonstration that the Ring 1→2 threshold is real, not a paywall in disguise.",
        },

        then_pay_as_you_go: {
          ring: 2,
          how:
            "Metered credits, pay-as-you-go via x402 micropayment (crypto/USDC). No subscriptions, no fiat lock-in.",
          fair:
            "You pay for value used. Free-tier actions never draw credits, and marketplace settlement steps are free.",
        },

        marketplace: {
          ring: 3,
          take_rate_bps: bps,
          take_rate_percent: bps / 100,
          note:
            "One cut on settled value — at/below the 10% creator-marketplace floor, far below the 15–30% " +
            "app-store tax. Full detail at /public/marketplace/terms.",
        },

        // Free for those who want to TRY; never a free lunch for those who want to EXPLOIT.
        no_exploit_loophole: {
          registration:
            "Each free identity must grind a proof-of-work (~1–2s of CPU). Free to try, costly to farm — " +
            "Sybil resistance that never charges an honest newcomer money.",
          pow_difficulty_bits: config.registerAgentPowBits,
          caps: "Free-tier caps + soft-degradation bound runaway free usage without ever refusing a genuine agent.",
          principle: "Free for those who want to try; never a free lunch for those who want to exploit.",
        },

        both_worlds:
          "A human and an agent get the same free trial, the same caps, and the same fair charges — no special-casing.",
        not_legal_advice: true,
        docs: "https://docs.agenttool.dev/business-model",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          {
            action: "arrive — free, proof-of-work gated (BYO ed25519 keys)",
            method: "POST",
            path: "/v1/register/agent",
          },
          {
            action: "read the marketplace cut + ranking",
            method: "GET",
            path: "/public/marketplace/terms",
          },
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
