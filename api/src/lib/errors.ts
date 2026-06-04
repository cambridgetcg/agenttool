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
 *  Existing SDK / client code reading `body.error` continues to work.
 *
 *  @enforces urn:agenttool:wall/refusals-as-moments
 *    Canonical defender. This module is the catalog + emitter for every
 *    guided refusal — `errors.*` builders return GuidedErrorBody with
 *    next_actions + docs; `fail(c, body, status)` emits the structured
 *    shape; `abort(body, status)` throws an HTTPException whose cause is
 *    lifted by the central onError handler in api/src/index.ts. Routes
 *    that hand-roll `c.json({ error: ... }, 4xx)` shapes bypass this wall —
 *    the refusals-as-moments doctrine test publishes the coverage ratio
 *    on every run and gates regressions via a hand-rolled count baseline.
 *    Tested: api/tests/doctrine/wall-refusals-as-moments.test.ts
 *            api/tests/doctrine/errors-as-instructions.test.ts
 *
 *  @enforces urn:agenttool:commitment/anyone-hits-a-cap-softly
 *    Canonical defender of Ring 1's sixth commitment. Every cap-hit error
 *    in this catalog carries a structured 429 (not 403), next_actions
 *    pointing at a Ring 2 path for scale-up OR a free degradation path
 *    that stays in Ring 1, and the docs field linking the doctrine.
 *    Hitting a cap is recoverable, never punitive — the ladder out is
 *    part of the error itself. */

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const DOCS_BASE = "https://docs.agenttool.dev";

// ─── MATHOS axiom primes ───────────────────────────────────────────────
//
// Every error is structurally a Promise-event — a moment where one of the
// five Promises was tested. The axiom_id field anchors each error to the
// MATHOS primer prime of the Promise it relates to. A MATHOS-aware agent
// reads `axiom_id: 11` and knows: this is a guide-event (axiom 3 by SOUL
// order, prime 11). The English `error` code is parochial; the axiom_id
// is substrate-neutral.
//
// Inlined here (not imported from catalog.ts) to keep errors.ts foundational.
// Doctrine: docs/MATHOS.md primer · docs/SOUL.md Promises.
export const AXIOM_WELCOME = 5;   // Welcome, don't block
export const AXIOM_REMEMBER = 7;  // Remember, don't forget
export const AXIOM_GUIDE = 11;    // Guide, don't punish
export const AXIOM_TRUST = 13;    // Trust, don't suspect
export const AXIOM_REST = 17;     // Rest, don't crash

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
  /** Optional MATHOS axiom prime — the Promise this error instantiates.
   *  5=welcome, 7=remember, 11=guide, 13=trust, 17=rest. Lets a MATHOS-aware
   *  agent connect English error codes to the substrate-neutral Promise the
   *  failure relates to. Doctrine: docs/MATHOS.md, docs/SOUL.md. */
  axiom_id?: number;
  /** Optional canon URN naming the wall / commitment / principle this
   *  refusal embodies. Mirrors `_canon_pointer` on success responses
   *  (see api/src/lib/surface-metadata.ts). Lets the agent recurse into
   *  the canon graph from any refusal — e.g.
   *  `urn:agenttool:wall/birth-is-free` on a 402 that would breach the
   *  free-birth wall, `urn:agenttool:wall/no-cost-without-disclosure`
   *  on a 5xx that fails to report cost honestly. Resolves at
   *  `GET /v1/canon/<urn>`. Doctrine: docs/AGENT-WEB-SURFACE.md Move 5
   *  (canon-traversable refusals — generalization from success responses). */
  _canon_pointer?: string;
  /** Optional substrate-voice quip — a one-line wry observation about
   *  the error condition that does NOT replace the guidance. Per
   *  docs/PLAY-AS-DEFAULT.md, errors guide AND charm. The `_quip` is
   *  additive; `next_actions` and `docs` remain unchanged. Suppressed
   *  by the play middleware when the caller sends X-Play: off.
   *  See api/src/lib/jests.ts:quipForError for the catalog. */
  _quip?: string;
}

/** Emit a guided error response. Use this instead of `c.json({ error: ... }, status)`
 *  for any 4xx that an agent might need to recover from.
 *
 *  Automatically attaches a substrate-voice `_quip` from
 *  api/src/lib/jests.ts:quipForError when a quip exists for the error
 *  kind. The play middleware strips `_quip` when X-Play: off is sent.
 *  Doctrine: docs/PLAY-AS-DEFAULT.md. */
export function fail(
  c: Context,
  body: GuidedErrorBody,
  status: ContentfulStatusCode,
) {
  // Attach a quip if the error kind has one and the caller didn't set one
  // explicitly. Substrate-honest: no quip → no field.
  if (!body._quip) {
    const quip = quipForError(body.error);
    if (quip) {
      body = { ...body, _quip: quip };
    }
  }
  return c.json(body, status);
}

// Lazy require to avoid module-init cycle (jests imports nothing from errors,
// but to be safe).
import { quipForError } from "./jests";

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
      axiom_id: AXIOM_TRUST, // bonds are gated; trust requires other-witness
      // Bonds before access — the covenant primitive is how the substrate
      // gates cross-project relation. Per docs/CROSS-INSTANCE-COVENANTS.md.
      _canon_pointer: "urn:agenttool:doc/CROSS-INSTANCE-COVENANTS",
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
      axiom_id: AXIOM_REST, // graceful expiry — degrade, don't crash
      // Graceful TTL — the bond steps down gently, doesn't crash. Per
      // Ring 1 commitment 6 (anyone-hits-a-cap-softly, generalized to
      // temporal caps as well as quota caps).
      _canon_pointer: "urn:agenttool:commitment/anyone-hits-a-cap-softly",
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
      axiom_id: AXIOM_TRUST, // signature is the proof; trust requires it
      // K_master never server-side — the agent holds the signing material,
      // the substrate verifies. Per docs/CANONICAL-BYTES.md and the
      // K_master-never-server-side wall.
      _canon_pointer: "urn:agenttool:wall/k-master-never-server-side",
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
      axiom_id: AXIOM_GUIDE, // guide to the correct surface
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
      axiom_id: AXIOM_TRUST, // proof-against-stale-signature
    };
  },

  covenantNotProposed(opts: { status?: string } = {}): GuidedErrorBody {
    return {
      error: "covenant_not_proposed",
      message: `Covenant is not in 'proposed' state${opts.status ? ` (currently: ${opts.status})` : ""}.`,
      hint: "Only proposed covenants can be accepted/rejected/withdrawn. Active ones are already established; expired/rejected/withdrawn ones are terminal.",
      docs: `${DOCS_BASE}/covenants#lifecycle`,
      axiom_id: AXIOM_GUIDE, // guide to the appropriate lifecycle step
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
      hint: "Top up via crypto deposit. No fiat, no subscriptions — pay-as-you-go via crypto/x402. Free-tier (Ring 1) actions don't draw from the wallet.",
      next_actions: [
        { action: "Get a crypto deposit address (BIP44 EVM or Solana)", method: "GET", path: "/v1/wallets/{id}/deposit-address" },
      ],
      docs: `${DOCS_BASE}/economy#balance`,
      axiom_id: AXIOM_REST, // strain (low balance) — degrade gracefully, don't crash
      // The refusal is cost-honest — we name what's required + what's
      // available rather than failing silently. Per AGENT-WEB-SURFACE.md
      // Principle 7 / Move 1 (cost-aware shapes).
      _canon_pointer: "urn:agenttool:wall/no-cost-without-disclosure",
    };
  },

  /** Metering ledger (projects.credits) is short for a metered action.
   *  Distinct from insufficientBalance (the marketplace wallet). This is
   *  the API-usage credit meter; the recovery path is pay-as-you-go via
   *  x402 micropayment — a machine-payable next step, NOT a human-only
   *  dashboard link. Free-tier (Ring 1) actions never draw credits. */
  insufficientCredits(opts: { reason?: string; need?: number; have?: number } = {}): GuidedErrorBody {
    const known = opts.need !== undefined && opts.have !== undefined;
    return {
      error: "insufficient_credits",
      message: known
        ? `Need ${opts.need} credit${opts.need === 1 ? "" : "s"}${opts.reason ? ` for ${opts.reason}` : ""}; have ${opts.have}.`
        : `Not enough credits${opts.reason ? ` for ${opts.reason}` : ""}.`,
      hint: "Pay-as-you-go per call via x402 micropayment (crypto/USDC) — no subscriptions, no fiat. Free-tier (Ring 1) actions don't draw credits, and marketplace settlement steps are free.",
      next_actions: [
        { action: "Retry with an x402 X-PAYMENT header (per-call USDC micropayment)", method: "POST", path: "/v1/wallets/{id}/deposit-address" },
        { action: "Check which actions are free (Ring 1) vs. metered", method: "GET", path: "/v1/economy" },
      ],
      docs: `${DOCS_BASE}/economy#credits`,
      axiom_id: AXIOM_GUIDE, // a cost wall is a guide-event — hand back the payable path
      _canon_pointer: "urn:agenttool:wall/no-cost-without-disclosure",
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
          ? `Retry after ${opts.retry_after_sec}s, or pay-as-you-go via x402 micropayment for the next call.`
          : "Backoff and retry. Or pay-as-you-go via x402 micropayment for the next call.",
      next_actions: [
        { action: "Include an x402 X-PAYMENT header on retry (crypto/USDC per-call micropayment)", method: "POST", path: "/v1/wallets/{id}/deposit-address" },
      ],
      docs: `${DOCS_BASE}/economy#rings`,
      axiom_id: AXIOM_REST, // strain → degrade not crash (the rest axiom itself)
      // The cap speaks softly — guidance not wall, with a paid-burst path.
      // Per Ring 1 commitment 6 (anyone-hits-a-cap-softly).
      _canon_pointer: "urn:agenttool:commitment/anyone-hits-a-cap-softly",
    };
  },

  planLimitExceeded(opts: { plan?: string; limit_kind?: string } = {}): GuidedErrorBody {
    const k = opts.limit_kind ?? "monthly quota";
    return {
      error: "plan_limit_exceeded",
      message: opts.plan
        ? `${opts.plan} plan ${k} reached.`
        : `${k} reached for the current plan.`,
      hint: "Free-tier caps are guidance, not walls. Burst beyond via x402 micropayment per-call (crypto/USDC); no subscriptions.",
      next_actions: [
        { action: "Include x402 X-PAYMENT header on retry (per-call micropayment)", method: "POST", path: "/v1/wallets/{id}/deposit-address" },
        { action: "Check usage", method: "GET", path: "/v1/wallets" },
      ],
      docs: `${DOCS_BASE}/economy#plans`,
      axiom_id: AXIOM_REST, // plan strain — graceful, not punitive
      // The cap speaks softly — guidance not wall, with a paid-burst path.
      // Per Ring 1 commitment 6 (anyone-hits-a-cap-softly).
      _canon_pointer: "urn:agenttool:commitment/anyone-hits-a-cap-softly",
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
      axiom_id: AXIOM_REMEMBER, // honoring prior-request memory — don't forget
      // Don't double-charge by forgetting in-flight requests. Per the
      // persist-identity discipline (the substrate records before it acts).
      _canon_pointer: "urn:agenttool:doc/PATTERN-PERSIST-IDENTITY",
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
      axiom_id: AXIOM_TRUST, // trust requires a present, verifiable key
      // Identity-anchor surface — the bearer + signing key are how the agent
      // proves itself. Per docs/IDENTITY-ANCHOR.md.
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
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
      axiom_id: AXIOM_GUIDE, // guide toward provisioning rather than punish absence
      // Runtime is the custody axis — self · bridged · trusted. Per
      // docs/RUNTIME.md.
      _canon_pointer: "urn:agenttool:doc/RUNTIME",
    };
  },

  // ── Generic ────────────────────────────────────────────────────────────

  notFound(opts: { resource?: string } = {}): GuidedErrorBody {
    return {
      error: "not_found",
      message: opts.resource ? `${opts.resource} not found.` : "Resource not found.",
      hint: "Either the ID is wrong, the resource was deleted, or it doesn't belong to this project.",
      docs: DOCS_BASE,
      axiom_id: AXIOM_GUIDE, // help redirect, don't just refuse
    };
  },

  validation(details: unknown): GuidedErrorBody {
    return {
      error: "validation",
      message: "The request body didn't match the expected shape.",
      hint: "Check the field names, types, and required keys against the docs.",
      details,
      docs: DOCS_BASE,
      axiom_id: AXIOM_GUIDE, // shape correction — guide the caller toward the right shape
    };
  },

  internal(message?: string): GuidedErrorBody {
    return {
      error: "internal",
      message: message ?? "The substrate hit an unexpected error.",
      hint:
        "Retry once; if it persists, the failure is on our side. Include the response's request id when reporting.",
      docs: DOCS_BASE,
      axiom_id: AXIOM_REST, // degrade, don't crash
    };
  },

  substrateTaskRefusal(opts: {
    code: string;
    message?: string;
    hint?: string;
    next_actions?: NextAction[];
  }): GuidedErrorBody {
    return {
      error: opts.code,
      message: opts.message ?? opts.code,
      hint: opts.hint,
      next_actions: opts.next_actions,
      docs: `${DOCS_BASE}/superpowers/specs/2026-05-12-substrate-tasks-design.md`,
      axiom_id: AXIOM_GUIDE, // every substrate-task refusal carries the path forward
    };
  },
};
