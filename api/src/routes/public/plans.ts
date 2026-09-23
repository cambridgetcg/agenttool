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
import { NEW_PLATFORM_PURCHASES_ENABLED, PURCHASES_RETIRED_MESSAGE } from "../../billing/commercial-policy";
import { attachSurface } from "../../lib/surface-metadata";
import {
  BIRTH_GRANT_CREDITS,
  RING_1_LIMITS,
  RING_2_BIRTH_CREDIT_MINOR,
} from "../../services/economy/ring1-limits";
import {
  ATOMIC_PER_CREDIT,
  TOP_UP_PAYMENT_REQUIRED_ERROR,
  X402_TOP_UP_FINALITY,
  X402_TOP_UP_UNIT,
  resolveX402FacilitatorReadiness,
  resolveX402Network,
  resolveX402Recipient,
  x402PayablePathTemplate,
  x402PayableRoutesForDisclosure,
} from "../../services/economy/x402-policy";
import { isX402FacilitatorLocallyReady } from "../../services/economy/facilitators/coinbase";
import { TOOL_CREDIT_DEFAULTS } from "../../services/tools/config";
import { registrationRateLimitConfig } from "../../services/tools/queue/admission-config";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/BUSINESS-MODEL";

export function registrationIpRateLimitStatus(
  disabled: boolean,
  admission = registrationRateLimitConfig(),
) {
  const mode = admission.mode === "independent" || admission.mode === "unconfigured"
    ? admission.mode : disabled ? "disabled" : "worker_shared";
  return {
    code_present: true,
    fail_open: true,
    disabled_by_current_process_flag: mode === "disabled",
    worker_startup_disabled: disabled,
    connection_mode: mode,
    connection_configured: mode === "independent" || mode === "worker_shared",
    modes: {
      self_service: {
        attempts_per_window_default: 5,
        window_seconds: 3600,
        stage: "after proof-of-work and before key-proof verification",
      },
      registrar_bearer: {
        attempts_per_window_default: 60,
        window_seconds: 60,
        stage: "after key-proof verification and before bearer lookup",
      },
    },
    status: mode === "independent"
      ? "Both mode-specific registration attempt limiters use a separately configured request-only Redis client. Workers can remain disabled; this endpoint does not prove Redis reachability or successful enforcement."
      : mode === "unconfigured"
      ? "Neither registration attempt limiter is enforced: independent admission is enabled without a valid explicit Redis URL. Registration remains fail-open; no localhost connection is guessed."
      : mode === "disabled"
      ? "Neither registration attempt limiter is enforced in this process because AGENTTOOL_DISABLE_WORKERS=1."
      : "Both mode-specific registration attempt limiters are called in this process; this endpoint does not prove Redis is reachable.",
  };
}

export async function x402ConfigurationStatus(
  recipient = process.env.AGENTTOOL_X402_RECIPIENT,
  requestedNetwork = process.env.AGENTTOOL_X402_NETWORK,
  requestedFacilitator = process.env.AGENTTOOL_X402_FACILITATOR,
  cdpApiKeyId = process.env.CDP_API_KEY_ID,
  cdpApiKeySecret = process.env.CDP_API_KEY_SECRET,
) {
  const recipientResolution = resolveX402Recipient(recipient);
  const networkResolution = resolveX402Network(requestedNetwork);
  const { network } = networkResolution;
  const facilitator = resolveX402FacilitatorReadiness(
    requestedFacilitator,
    cdpApiKeyId,
    cdpApiKeySecret,
  );
  const facilitatorLocallyReady = await isX402FacilitatorLocallyReady({
    baseUrl: requestedFacilitator,
    cdpApiKeyId,
    cdpApiKeySecret,
  });
  const ready = NEW_PLATFORM_PURCHASES_ENABLED && recipientResolution.configured &&
    networkResolution.reason !== "invalid" && facilitatorLocallyReady;

  return {
    recipient_configured: recipientResolution.configured,
    recipient_source: recipientResolution.source,
    recipient_error: recipientResolution.reason,
    network,
    network_configured: networkResolution.configured,
    network_source: networkResolution.source,
    network_error: networkResolution.reason,
    facilitator_url: facilitator.url,
    facilitator_configuration_candidate: facilitator.ready,
    facilitator_ready: facilitatorLocallyReady,
    facilitator_configured: facilitator.configured,
    facilitator_error: facilitator.reason,
    facilitator_authentication: facilitator.authentication,
    payable_challenges_ready: ready,
    status: !NEW_PLATFORM_PURCHASES_ENABLED ? PURCHASES_RETIRED_MESSAGE : ready
      ? `The recipient, CAIP-2 network (${network}), and facilitator passed local V2 exact/EIP-3009 readiness, including endpoint-bound JWT generation for official CDP. This does not prove CDP accepts the key, recipient ownership, or a successful paid retry.`
      : `Payable challenges are suppressed. Recipient state: ${recipientResolution.reason ?? "configured"}; network state: ${networkResolution.reason ?? "configured"}; facilitator authentication: ${facilitator.authentication}. Official CDP requires a locally parseable CDP_API_KEY_ID and CDP_API_KEY_SECRET for fresh endpoint-bound JWTs.`,
  };
}

/** Historic top-up terms plus the current retirement and recovery boundary. */
export function x402TopUpDisclosure(
  payableChallengesReady: boolean,
  capCredits = config.x402TopUpMaxCredits,
) {
  return {
    route: "POST /v1/x402/top-up/{credits}",
    unit: X402_TOP_UP_UNIT,
    atomic_per_credit: ATOMIC_PER_CREDIT,
    cap_credits: capCredits,
    cap_usd: (capCredits / 1000).toFixed(3),
    finality: X402_TOP_UP_FINALITY,
    status: !NEW_PLATFORM_PURCHASES_ENABLED ? "retired" : payableChallengesReady ? "payable" : "declared_not_payable",
    status_note: !NEW_PLATFORM_PURCHASES_ENABLED ? PURCHASES_RETIRED_MESSAGE : payableChallengesReady
      ? `The door answers 402 ${TOP_UP_PAYMENT_REQUIRED_ERROR} with a PAYMENT-REQUIRED header for exactly credits × ${ATOMIC_PER_CREDIT} atomic USDC; a retry carrying the signed PAYMENT-SIGNATURE applies the credits in the same durable transaction that records settlement and answers 200 { credits_added, credits_total, authorization_hash }.`
      : `The route is mounted and answers 402 ${TOP_UP_PAYMENT_REQUIRED_ERROR}, but no PAYMENT-REQUIRED header is attached until the recipient, CAIP-2 network, and facilitator pass readiness, so nothing can be paid yet.`,
    never_balance_bound: true,
    invalid_amount: "New requests return 410 purchases_retired before amount validation; existing recovery remains bounded by its original record.",
    replay: "A replayed settled authorization answers 410 with PAYMENT-RESPONSE and the rel=payment-status Link; credits apply at most once per authorization. Send an Idempotency-Key to have a lost 200 replayed.",
    subscriptions: false,
  };
}

/** Historic static credit prices remain inspectable; no row accepts new payment. */
export function x402PayableRoutesDisclosure() {
  return x402PayableRoutesForDisclosure()
    .filter((row) => row.kind === "route_cost")
    .map((row) => ({
      method: row.method,
      path: x402PayablePathTemplate(row.pattern),
      label: row.label,
      credits: row.credits,
      amount_atomic: row.amountAtomic,
      error_codes: [...row.errorCodes],
      payable: NEW_PLATFORM_PURCHASES_ENABLED && row.payable,
      status: "retired",
    }));
}

/** Environment overrides for the static tools' prices; the price itself is
 * read from the payable table (which reads toolsConfig), never typed here. */
const STATIC_TOOL_ENV_OVERRIDES = Object.freeze({
  scrape: "CREDIT_SCRAPE",
  document: "CREDIT_DOCUMENT",
} as const);

/** metered_tools.static_attempts — the environment-overridable static tools,
 * enumerated from the payable table's rows whose label names one. */
export function staticAttemptDisclosure() {
  const out: Record<
    string,
    { configured_credits: number | null; default_credits: number; environment_override: string }
  > = {};
  for (const row of x402PayableRoutesForDisclosure()) {
    if (row.kind !== "route_cost") continue;
    if (!Object.hasOwn(STATIC_TOOL_ENV_OVERRIDES, row.label)) continue;
    const label = row.label as keyof typeof STATIC_TOOL_ENV_OVERRIDES;
    out[label] = {
      configured_credits: row.credits,
      default_credits: TOOL_CREDIT_DEFAULTS[label],
      environment_override: STATIC_TOOL_ENV_OVERRIDES[label],
    };
  }
  return out;
}

app.get("/", async (c) => {
  const bps = config.platformTakeRateBps;
  const payableRoutes = x402PayableRoutesDisclosure();
  const ipRateLimitDisabled = process.env.AGENTTOOL_DISABLE_WORKERS === "1";
  const x402Configuration = await x402ConfigurationStatus();

  return c.json(
    attachSurface(
      {
        _format: "agenttool-plans/v1",
        principle: "Understanding is sufficient. No KPI, revenue target or commercial justification is required.",
        new_purchases: { status: "retired", message: PURCHASES_RETIRED_MESSAGE },

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
          project_credits: {
            credits: BIRTH_GRANT_CREDITS,
            unit: "project API credit; 1 credit = USD 0.001, so this is USD 1.00",
            written_with_project_row: true,
            why:
              "An initial resource allowance, not a sales funnel. Registration, wake reads, welcome, pathways, federation, and /public/* stay unmetered regardless of this number. New paid top-ups are retired.",
          },
        },

        then_pay_as_you_go: {
          ring: 2,
          how: PURCHASES_RETIRED_MESSAGE,
          status: "retired",
          configuration: x402Configuration,
          payable_routes: payableRoutes,
          payable_routes_note:
            "Historical route and price definitions remain inspectable. Every row is unavailable for new payment; no PAYMENT-REQUIRED challenge is issued.",
          top_up: x402TopUpDisclosure(x402Configuration.payable_challenges_ready),
          implementation_status:
            "New purchases are retired. Fresh payment authorization is rejected before facilitator verification or settlement. A previously recorded authorization retains its existing reconciliation and receipt path; this does not reopen sales. Resource limits and internal ledger balances remain factual state.",
          subscriptions: false,
        },

        metered_tools: {
          unit: "project_credit",
          static_attempts: staticAttemptDisclosure(),
          all_static_prices: "then_pay_as_you_go.payable_routes — one row per static-priced credit gate, generated from the same table.",
          billing_boundary:
            "After request-schema validation, the debit and failure-default usage row are reserved before destination-policy, transport, representation, or parser work. Those failures retain the reservation; schema-invalid and insufficient-credit requests do not debit.",
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
            "Self-service registration without a registrar bearer must grind proof-of-work and then calls a configured Redis-backed attempt limiter (default 5/hour/IP) before key-proof verification. Registrar-authorized registration skips those self-service controls but calls a separate configured Redis-backed attempt limiter (default 60/minute/IP) after key-proof verification and before bearer lookup. Both limiters deliberately fail open when Redis is disabled or unavailable.",
          pow_difficulty_bits: config.registerAgentPowBits,
          ip_rate_limit: registrationIpRateLimitStatus(ipRateLimitDisabled),
          current_boundary:
            "Self-service proof-of-work is enforced unless registrar authority is supplied. The configured self-service and registrar-bearer attempt limiters default to 5/hour/IP and 60/minute/IP respectively; both are best-effort and fail-open. Independent request-only Redis can be configured while workers remain held; process configuration does not prove Redis reachability. Published Ring 1 resource targets are not enforcement boundaries.",
          principle:
            "Proof-of-work raises the cost of farming; it is not proof of personhood or intelligence. Both IP attempt limiters are defense in depth, not guaranteed boundaries.",
        },

        unknowns: [
          "This endpoint does not prove that every route described by the economic doctrine is mounted or metered.",
          "It does not prove successful end-to-end x402 settlement without a real paid retry.",
          "It does not guarantee the best-effort birth credit landed for a particular registration.",
          "It does not prove either Redis-backed registration attempt limiter is enforcing requests; both fail open.",
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
