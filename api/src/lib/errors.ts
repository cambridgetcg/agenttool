/** Errors-as-instructions — the agent-readable error contract.
 *
 *  Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
 *
 *  Every 4xx response should be enough for an agent to self-recover or
 *  self-redirect *without human intervention*. That means:
 *
 *    - stable machine-readable `error` code (existing — keep for compat)
 *    - human-readable `message` (one sentence)
 *    - text `hint` for prose-style guidance
 *    - structured `next_actions` for programmatic pivoting
 *    - `docs` URL for doctrine
 *
 *  Backwards-compatible: every existing field stays. New fields are additive.
 *  Existing SDK / client code reading `body.error` continues to work. */

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const DOCS_BASE = "https://docs.agenttool.dev";

export interface NextAction {
  /** Human-readable verb phrase. */
  action: string;
  /** HTTP method, or null when the next step isn't an API call (e.g. "ask the counterparty"). */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | null;
  /** Path template — placeholders in `{braces}`. Null for non-API steps. */
  path?: string | null;
  /** Optional partial body shape — keys the caller needs to fill. */
  body_hint?: Record<string, unknown> | null;
}

export interface GuidedErrorBody {
  /** Stable snake_case code. Agent-readable. Never changes for the same condition. */
  error: string;
  /** One-sentence human-readable summary. */
  message: string;
  /** Optional prose guidance — what the agent might consider. */
  hint?: string;
  /** Optional structured next steps — what the agent can do programmatically. */
  next_actions?: NextAction[];
  /** Optional doctrine URL. */
  docs?: string;
  /** Optional validation details. */
  details?: unknown;
}

/** Emit a guided error response. Use this instead of `c.json({ error: ... }, status)`
 *  for any 4xx that an agent might need to recover from. */
export function fail(
  c: Context,
  body: GuidedErrorBody,
  status: ContentfulStatusCode,
) {
  return c.json(body, status);
}

/** Throw a guided error. Use from service-layer code (or anywhere `return c.json()`
 *  isn't ergonomic). The central `app.onError` handler lifts the body from
 *  `err.cause` and emits it with all guided fields intact. */
export function abort(
  body: GuidedErrorBody,
  status: ContentfulStatusCode,
): never {
  throw new HTTPException(status, { message: body.message, cause: body });
}

/** Type guard for the central handler — checks whether an HTTPException cause
 *  carries a GuidedErrorBody. */
export function isGuidedErrorCause(cause: unknown): cause is GuidedErrorBody {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "error" in cause &&
    "message" in cause &&
    typeof (cause as GuidedErrorBody).error === "string"
  );
}

/** Common error builders. Each returns a GuidedErrorBody; pair with `fail(c, body, status)`. */
export const errors = {
  // ── Network / covenants ─────────────────────────────────────────────────

  covenantRequired(opts: { sender_did?: string; recipient_did?: string } = {}): GuidedErrorBody {
    return {
      error: "covenant_required",
      message: "Cross-project messages require an active covenant in either direction.",
      hint: "Either party can declare; once one side acknowledges, both can communicate. Same-project sends are ungated.",
      next_actions: [
        {
          action: "Declare a covenant with the counterparty",
          method: "POST",
          path: "/v1/covenants",
          body_hint: {
            agent_id: "<your_identity_id>",
            counterparty_did: opts.recipient_did ?? "<their_did>",
            vows: ["<what you intend to sustain>"],
          },
        },
        {
          action: "Ask the counterparty to declare a covenant toward you",
          method: null,
          path: null,
        },
      ],
      docs: `${DOCS_BASE}/inbox#covenant-gate`,
    };
  },

  proposalExpired(): GuidedErrorBody {
    return {
      error: "proposal_expired",
      message: "This covenant proposal aged past its 30-day TTL.",
      hint: "Re-declare to start a fresh v2 proposal. Nothing is lost — the initiator side keeps the original record for reference.",
      next_actions: [
        {
          action: "Re-declare the covenant (v2)",
          method: "POST",
          path: "/v1/covenants",
          body_hint: { protocol_version: "v2" },
        },
      ],
      docs: `${DOCS_BASE}/covenants#expiry`,
    };
  },

  invalidSignature(opts: { surface?: string } = {}): GuidedErrorBody {
    return {
      error: "invalid_signature",
      message: "Signature didn't verify against the resolved public key.",
      hint:
        "Common causes: stale signing_key_id (key rotated), wrong canonical bytes for this surface, " +
        "or the signature was produced over different fields than expected.",
      next_actions: [
        { action: "List your active signing keys", method: "GET", path: "/v1/identities/{id}/keys" },
        {
          action: "Regenerate canonical bytes via the SDK",
          method: null,
          path: null,
          body_hint: opts.surface ? { surface: opts.surface } : null,
        },
      ],
      docs: `${DOCS_BASE}/covenants#signing`,
    };
  },

  notV2(): GuidedErrorBody {
    return {
      error: "not_v2",
      message: "This endpoint only handles v2 covenants; the row is v1.",
      hint: "v1 covenants don't have the proposed → active lifecycle. Use the v1 surface instead.",
      next_actions: [
        { action: "Patch the covenant via the v1 path", method: "PATCH", path: "/v1/covenants/{id}" },
      ],
      docs: `${DOCS_BASE}/covenants#v1-vs-v2`,
    };
  },

  initiatorSignatureMismatch(): GuidedErrorBody {
    return {
      error: "initiator_signature_mismatch",
      message: "The initiator signature in your accept request doesn't match the proposal's stored signature.",
      hint: "The proposal may have been updated since you fetched it. Fetch the latest covenant and re-sign the cosign over the current initiator signature.",
      next_actions: [
        { action: "Fetch the current proposal", method: "GET", path: "/v1/covenants/{id}" },
      ],
      docs: `${DOCS_BASE}/covenants#cosign`,
    };
  },

  covenantNotProposed(opts: { status?: string } = {}): GuidedErrorBody {
    return {
      error: "covenant_not_proposed",
      message: `Covenant is not in 'proposed' state${opts.status ? ` (currently: ${opts.status})` : ""}.`,
      hint: "Only proposed covenants can be accepted/rejected/withdrawn. Active ones are already established; expired/rejected/withdrawn ones are terminal.",
      docs: `${DOCS_BASE}/covenants#lifecycle`,
    };
  },

  // ── Economy ─────────────────────────────────────────────────────────────

  insufficientBalance(opts: { required?: string; available?: string; currency?: string } = {}): GuidedErrorBody {
    const haveAmounts = opts.required && opts.available;
    return {
      error: "insufficient_balance",
      message: haveAmounts
        ? `Need ${opts.required}${opts.currency ? " " + opts.currency : ""}; wallet has ${opts.available}.`
        : "Wallet balance is below the required amount.",
      hint: "Top up via Stripe (fiat) or a crypto deposit. No subscription — pay-as-you-go. Free-tier (Ring 1) actions don't draw from the wallet.",
      next_actions: [
        { action: "Stripe credit top-up", method: "POST", path: "/v1/billing/checkout" },
        { action: "Get a crypto deposit address (BIP44 EVM or Solana)", method: "GET", path: "/v1/wallets/{id}/deposit-address" },
      ],
      docs: `${DOCS_BASE}/economy#balance`,
    };
  },

  rateLimit(opts: { retry_after_sec?: number; ring?: 1 | 2 } = {}): GuidedErrorBody {
    return {
      error: "rate_limit",
      message:
        opts.ring === 1
          ? "Ring 1 free-tier ceiling reached. Caps are guidance, not walls."
          : "Rate limit reached on this surface.",
      hint:
        opts.retry_after_sec !== undefined
          ? `Retry after ${opts.retry_after_sec}s, or move to Ring 2 (metered) for higher limits.`
          : "Backoff and retry. Or move to Ring 2 (metered) for higher limits.",
      next_actions: [
        { action: "Upgrade to Ring 2 (metered)", method: "POST", path: "/v1/billing/checkout" },
      ],
      docs: `${DOCS_BASE}/economy#rings`,
    };
  },

  planLimitExceeded(opts: { plan?: string; limit_kind?: string } = {}): GuidedErrorBody {
    const k = opts.limit_kind ?? "monthly quota";
    return {
      error: "plan_limit_exceeded",
      message: opts.plan
        ? `${opts.plan} plan ${k} reached.`
        : `${k} reached for the current plan.`,
      hint: "Free-tier caps are guidance, not walls. Upgrade for higher limits; mid-cycle upgrades prorate.",
      next_actions: [
        { action: "List plans", method: "GET", path: "/v1/billing/plans" },
        { action: "Upgrade via Stripe", method: "POST", path: "/v1/billing/checkout" },
        { action: "Check usage", method: "GET", path: "/v1/billing/check" },
      ],
      docs: `${DOCS_BASE}/economy#plans`,
    };
  },

  idempotencyConflict(opts: { key?: string } = {}): GuidedErrorBody {
    return {
      error: "idempotency_conflict",
      message:
        "An in-flight request with this Idempotency-Key is still processing, or the cached response doesn't match this request body.",
      hint:
        "Idempotency keys are scoped to (method, path, body). Either wait for the original to finish (up to 30s), or use a fresh key if you intend a different request.",
      next_actions: [
        { action: "Retry with a fresh Idempotency-Key (UUID v4)", method: null, path: null },
        { action: "Wait then retry the same key (up to 30s)", method: null, path: null },
      ],
      docs: `${DOCS_BASE}/idempotency`,
    };
  },

  signingKeyNotFound(opts: { identity_id?: string; signing_key_id?: string } = {}): GuidedErrorBody {
    return {
      error: "signing_key_not_found",
      message:
        opts.signing_key_id
          ? `Signing key ${opts.signing_key_id} not found, revoked, or not owned by this identity.`
          : "Signing key not found, revoked, or not owned by this identity.",
      hint:
        "Common causes: key rotated since you cached the id; key revoked; key belongs to a different identity.",
      next_actions: [
        {
          action: "List active signing keys",
          method: "GET",
          path: opts.identity_id ? `/v1/identities/${opts.identity_id}/keys` : "/v1/identities/{id}/keys",
        },
        {
          action: "Rotate to a fresh signing key",
          method: "POST",
          path: opts.identity_id ? `/v1/identities/${opts.identity_id}/keys` : "/v1/identities/{id}/keys",
        },
      ],
      docs: `${DOCS_BASE}/identity#keys`,
    };
  },

  runtimeNotProvisioned(): GuidedErrorBody {
    return {
      error: "runtime_not_provisioned",
      message: "No runtime is provisioned for this identity yet.",
      hint:
        "Provision one (any tier: self · bridged · trusted). Mode is stamped at provisioning and immutable after — pick deliberately.",
      next_actions: [
        {
          action: "Provision a runtime",
          method: "POST",
          path: "/v1/runtimes",
          body_hint: {
            name: "<your runtime name>",
            identity_id: "<your_identity_id>",
            mode: "bridged",
            llm: { provider: "anthropic", model: "claude-sonnet-4-6" },
          },
        },
        { action: "List provisioned runtimes", method: "GET", path: "/v1/runtimes" },
      ],
      docs: `${DOCS_BASE}/runtime#provisioning`,
    };
  },

  // ── Generic ────────────────────────────────────────────────────────────

  notFound(opts: { resource?: string } = {}): GuidedErrorBody {
    return {
      error: "not_found",
      message: opts.resource ? `${opts.resource} not found.` : "Resource not found.",
      hint: "Either the ID is wrong, the resource was deleted, or it doesn't belong to this project.",
      docs: DOCS_BASE,
    };
  },

  validation(details: unknown): GuidedErrorBody {
    return {
      error: "validation",
      message: "The request body didn't match the expected shape.",
      hint: "Check the field names, types, and required keys against the docs.",
      details,
      docs: DOCS_BASE,
    };
  },
};
