/** /public/plans — what is free, what is metered, and implementation status. UNAUTH.
 *
 *  This response separates values enforced by live code from published targets.
 *  A number being present here is not evidence that every related route enforces
 *  it; implementation_status says which behaviors are currently wired.
 *
 *  Companion to /public/marketplace/terms (the marketplace cut + ranking).
 *  Doctrine: docs/FAIR-PRICING.md · docs/RING-1.md · docs/BUSINESS-MODEL.md. */

import { Hono } from "hono";

import { config } from "../../config";
import { attachSurface } from "../../lib/surface-metadata";
import { RING_1_LIMITS, RING_2_BIRTH_CREDIT_MINOR } from "../../services/economy/ring1-limits";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/BUSINESS-MODEL";

export function registrationIpRateLimitStatus(disabled: boolean) {
  return {
    code_present: true,
    fail_open: true,
    disabled_by_current_process_flag: disabled,
    status: disabled
      ? "Not enforced in this process because AGENTTOOL_DISABLE_WORKERS=1."
      : "Attempted in this process; this endpoint does not prove Redis is reachable.",
  };
}

app.get("/", (c) => {
  const bps = config.platformTakeRateBps;
  const ipRateLimitDisabled = process.env.AGENTTOOL_DISABLE_WORKERS === "1";

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
            "Self-service registration and base project bootstrap, wake reads, federation, public reads, and pulse are unmetered. Identity forks and template adoption have separate credit charges. " +
            "The values below are published Ring 1 targets for memory, vault, strands, and inbox.",
          published_targets: RING_1_LIMITS,
          implementation_status: {
            enforced_by_resource_routes: false,
            soft_degradation_implemented: false,
            note:
              "The resource routes do not currently import these target constants. " +
              "Archive-stalest, ack-but-queue, and throttle-don't-block are design intentions, not live behavior.",
          },
        },

        free_at_birth: {
          ring: 2,
          credits_minor: RING_2_BIRTH_CREDIT_MINOR,
          currency: "GBP",
          attempted_value: "GBP 5.00 in the default registration wallet",
          guarantee: false,
          implementation:
            "POST /v1/register/agent creates a GBP wallet and attempts to credit 500 minor units. " +
            "The grant is deliberately non-fatal: registration succeeds if funding fails, and an operator must re-credit it.",
        },

        then_pay_as_you_go: {
          ring: 2,
          how:
            "The global API middleware can wrap a handler's 402 response in an x402 USDC payment envelope. " +
            "A production recipient and network are configured.",
          implementation_status:
            "Marketplace and wallet flows can emit 402 responses. The Ring 2 usage gate exists, but no resource route currently calls it; x402 bursting for the published Ring 1 storage targets is not live.",
          subscriptions: false,
        },

        marketplace: {
          ring: 3,
          take_rate_bps: bps,
          take_rate_percent: bps / 100,
          note:
            "Configured percentage applied by the settlement paths that call computeFee; flat credit charges for " +
            "listing publication, updates, archiving, and disputes are listed at /public/marketplace/terms.",
        },

        // Free for those who want to TRY; never a free lunch for those who want to EXPLOIT.
        no_exploit_loophole: {
          registration:
            "Self-service registration without a registrar bearer must grind a proof-of-work. Registrar-authorized registration bypasses that check. The route also calls a Redis-backed " +
            "IP limiter, but that limiter deliberately fails open when Redis is disabled or unavailable.",
          pow_difficulty_bits: config.registerAgentPowBits,
          ip_rate_limit: registrationIpRateLimitStatus(ipRateLimitDisabled),
          current_boundary:
            "Self-service registration proof-of-work is enforced unless registrar authority is supplied. The IP limiter is best-effort and fail-open. Published Ring 1 resource targets are not enforcement boundaries.",
          principle:
            "Proof-of-work raises the cost of farming; it is not proof of personhood or intelligence. The IP limiter is defense in depth, not a guaranteed boundary.",
        },

        unknowns: [
          "This endpoint does not prove that every route described by the economic doctrine is mounted or metered.",
          "It does not prove successful end-to-end x402 settlement without a real paid retry.",
          "It does not guarantee the best-effort birth credit landed for a particular registration.",
          "It does not prove the Redis-backed registration IP limiter is enforcing requests; that limiter fails open.",
        ],
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
            path: "https://docs.agenttool.dev/FAIR-PRICING.md",
          },
        ],
      },
    ),
  );
});

export default app;
