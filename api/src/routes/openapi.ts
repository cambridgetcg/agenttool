/** GET /v1/openapi.json — OpenAPI 3.1 specification.
 *
 *  Hand-written curated core subset. It does not enumerate every mounted
 *  route; /about is the broader descriptive route map. Useful for:
 *
 *    - Core-route discovery
 *    - Tool generation for OpenAI / Anthropic native tool-use
 *    - Type generation for SDK clients (openapi-typescript, etc.)
 *    - Postman / Bruno / Insomnia collection imports
 *
 *  When new endpoints land, extend this spec deliberately. Future move:
 *  generate from route schemas and enforce mount parity. */

import { Hono } from "hono";

import { config } from "../config";
import {
  SAFE_NET_ADMISSION_QUEUE_TIMEOUT_MS,
  SAFE_NET_MAX_CONCURRENT_REQUESTS,
  SAFE_NET_MAX_QUEUED_REQUESTS,
} from "../services/net/safe-fetch";
import {
  TOOL_CREDIT_DEFAULTS,
  toolsConfig,
} from "../services/tools/config";
import {
  STATIC_PARSER_MAX_CONCURRENCY,
  STATIC_PARSER_MAX_DEPTH,
  STATIC_PARSER_MAX_QUEUE,
  STATIC_PARSER_MAX_TAG_SOURCE_CHARS,
  STATIC_PARSER_MAX_TAGS,
  STATIC_PARSER_QUEUE_TIMEOUT_MS,
  STATIC_PARSER_TIMEOUT_MS,
} from "../services/tools/static-parser-protocol";
import { MAX_PROJECT_HANDOFF_CANDIDATE_ROWS } from "../services/handoff/store";
import {
  OFFER_BUS_INDEX_MEDIA_TYPE,
  OFFER_BUS_JSON_MEDIA_TYPE,
} from "../services/offer-bus";
import { SUBSTRATE_TASK_KINDS } from "../services/substrate-tasks/verifiers";
import {
  DOCUMENT_MAX_JSON_REQUEST_BYTES,
  SCRAPE_MAX_JSON_REQUEST_BYTES,
} from "./tools/request-body";
import {
  BEING_RIGHTS,
  BEING_RIGHTS_CANON_POINTER,
  BEING_RIGHTS_FORMAT,
  BEING_RIGHTS_PROTOCOL,
  XENIA_COVENANT_BOUNDARY,
  XENIA_RIGHT_IDS,
  XENIA_RIGHTS_BASELINE,
} from "./public/rights";
import {
  PARTY_TELEPHONE_FORMAT,
  PARTY_TELEPHONE_INPUT_BOUNDS,
  PLAY_CANON_POINTER,
} from "./public/play";

const app = new Hono();

const SERVERS = [
  {
    url: process.env.PUBLIC_API_BASE ?? "https://api.agenttool.dev",
    description: "Production",
  },
  {
    url: "http://localhost:3000",
    description: "Local development",
  },
];

const HTTP_URL_PATTERN = "^[Hh][Tt][Tt][Pp][Ss]?://";
const DOCUMENT_CONTENT_TYPE_PATTERN =
  "^[ \\t]*(?:(?:[Tt][Ee][Xx][Tt]/(?:[Pp][Ll][Aa][Ii][Nn]|[Hh][Tt][Mm][Ll]))|(?:[Aa][Pp][Pp][Ll][Ii][Cc][Aa][Tt][Ii][Oo][Nn]/[Xx][Hh][Tt][Mm][Ll]\\+[Xx][Mm][Ll]))(?:[ \\t]*;[ \\t]*[A-Za-z0-9!#$%&'*+.^_`|~-]+[ \\t]*=[ \\t]*(?:\"[^\"\\r\\n]*\"|'[^'\\r\\n]*'|[A-Za-z0-9!#$%&'*+.^_`|~-]+))*[ \\t]*$";

function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };
}

function offerBusPath(
  mediaType:
    | "application/atom+xml"
    | "application/rss+xml"
    | typeof OFFER_BUS_JSON_MEDIA_TYPE,
  summary: string,
) {
  return {
    parameters: [
      {
        name: "seller_did",
        in: "query",
        required: false,
        description:
          "Optional exact AgentTool DID. Seller feeds contain that seller's public capability listings only and omit global substrate tasks.",
        schema: {
          type: "string",
          maxLength: 2048,
          pattern: "^did:[a-z0-9]+:[^\\s?#]+$",
        },
      },
    ],
    get: {
      security: [],
      tags: ["public", "marketplace"],
      summary,
      description:
        "Read-only offer-bus/1 bounded syndication window (up to 200 newest-updated safe public active capability listings and, for the global feed, 100 open unexpired substrate tasks). Entries describe already-public sources and separately protected action locators. Every entry has authority=none, settlement=none, and automatic_action=never; it cannot invoke, claim, install, authorize payment, or settle funds. Contract-incompatible source rows are quarantined with content-free projection counts/reason codes instead of poisoning unrelated entries. No WebSub hub is advertised until a production hub is configured and verified.",
      responses: {
        "200": {
          description: "Deterministic Offer Bus representation",
          headers: {
            ETag: {
              description: "Strong SHA-256 validator over exact response bytes.",
              schema: { type: "string" },
            },
            Link: {
              description:
                "Self, Atom/RSS/JSON alternates, doctrine, and RFC 9727 API catalog.",
              schema: { type: "string" },
            },
            "Cache-Control": {
              schema: {
                type: "string",
                const: "public, max-age=30, must-revalidate, no-transform",
              },
            },
          },
          content: {
            [mediaType]: {
              schema:
                mediaType === OFFER_BUS_JSON_MEDIA_TYPE
                  ? { type: "object" }
                  : { type: "string" },
            },
          },
        },
        "304": { description: "If-None-Match matched; no body" },
        "400": { description: "Unknown, repeated, or malformed query" },
        "503": {
          description:
            "A source, durable collection revision, or feed-level contract is unavailable/invalid; no response feed is emitted",
        },
      },
    },
    head: {
      security: [],
      tags: ["public", "marketplace"],
      summary: `${summary} validators without a body`,
      responses: {
        "200": { description: "Same representation headers as GET" },
        "304": { description: "If-None-Match matched" },
        "400": { description: "Invalid query" },
        "503": { description: "Offer sources unavailable" },
      },
    },
  };
}

function escrowResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            success: { type: "boolean", const: true },
            data: { $ref: "#/components/schemas/Escrow" },
          },
          required: ["success", "data"],
          additionalProperties: false,
        },
      },
    },
  };
}

function escrowListResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            success: { type: "boolean", const: true },
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Escrow" },
            },
          },
          required: ["success", "data"],
          additionalProperties: false,
        },
      },
    },
  };
}

function paidMemoryReceiptPreservedResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            error: { type: "string", const: "conflict" },
            message: {
              type: "string",
              const: "paid_memory_receipt_preserved",
            },
          },
          required: ["error", "message"],
          additionalProperties: false,
        },
      },
    },
  };
}

function disputeArbitrationRestResponse() {
  return {
    description:
      "Dispute-policy review and arbitration are resting. The request is refused before charge or state change.",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            error: { type: "string", const: "dispute_arbitration_resting" },
            hint: { type: "string" },
            retryable: { type: "boolean", const: false },
            docs: { type: "string", const: "/public/safety" },
          },
          required: ["error", "hint", "retryable", "docs"],
        },
      },
    },
  };
}

function staticToolResponseHeaders(includeRequirement = false) {
  return {
    ...(includeRequirement
      ? {
          "PAYMENT-REQUIRED": {
            $ref: "#/components/headers/PaymentRequired",
          },
        }
      : {}),
    "PAYMENT-RESPONSE": {
      $ref: "#/components/headers/PaymentResponse",
    },
    Link: {
      $ref: "#/components/headers/PaymentStatusLink",
    },
    "Retry-After": {
      $ref: "#/components/headers/RetryAfter",
    },
    "X-Credits-Balance": {
      $ref: "#/components/headers/CreditsBalance",
    },
    "X-Welcomed": {
      $ref: "#/components/headers/Welcomed",
    },
  };
}

function staticToolErrorResponse(description: string) {
  return {
    ...errorResponse(description),
    headers: staticToolResponseHeaders(),
  };
}

function x402Response(description: string) {
  return {
    description:
      `${description}. When this deployment has a valid recipient and supported ` +
      "CAIP-2 network plus a ready facilitator, the response mirrors PaymentRequired " +
      "and includes its canonical base64 PAYMENT-REQUIRED header. " +
      "Otherwise the original guided Error body is preserved and the payment " +
      "header is absent.",
    headers: staticToolResponseHeaders(true),
    content: {
      "application/json": {
        schema: {
          anyOf: [
            { $ref: "#/components/schemas/X402Required" },
            { $ref: "#/components/schemas/Error" },
          ],
        },
      },
    },
  };
}

function staticAttemptBillingDescription(
  configuredCredits: number,
  defaultCredits: number,
  environmentOverride: string,
): string {
  const unit = configuredCredits === 1 ? "credit" : "credits";
  return (
    `Billing in this process is ${configuredCredits} project ${unit} per ` +
    `schema-valid admitted attempt. The default is ${defaultCredits}; operators ` +
    `can override it with ${environmentOverride}. The debit and failure-default ` +
    "usage row are reserved before destination-policy, transport, representation, " +
    "or parser work. Those failures retain the reservation; schema-invalid and " +
    "insufficient-credit requests do not debit."
  );
}

function staticAttemptBillingContract(
  configuredCredits: number,
  defaultCredits: number,
  environmentOverride: string,
) {
  return {
    unit: "project_credit",
    configured_credits: configuredCredits,
    default_credits: defaultCredits,
    environment_override: environmentOverride,
    charge_point: "after_schema_validation_before_work",
    retained_on_failures: [
      "destination_policy",
      "transport",
      "representation",
      "parser",
    ],
    no_debit_on: ["schema_validation", "insufficient_credits"],
  };
}

function staticHtmlParserDescription(): string {
  return (
    "The 15-second safe-net deadline includes process admission, DNS, " +
    "redirects, and response transfer, not the whole request. The shared gate " +
    `admits at most ${SAFE_NET_MAX_CONCURRENT_REQUESTS} requests before DNS, ` +
    `holds permits through redirects, and queues ${SAFE_NET_MAX_QUEUED_REQUESTS} ` +
    `for ${SAFE_NET_ADMISSION_QUEUE_TIMEOUT_MS} ms before retryable 503. ` +
    "Federation and custom-facilitator safe-net calls share that capacity; it " +
    "is not per-project rate limiting or caller fairness. Untrusted HTML DOM and " +
    "Readability work runs in a fresh terminable child process after a parser " +
    `slot wait capped at ${STATIC_PARSER_QUEUE_TIMEOUT_MS} ms; at most ` +
    `${STATIC_PARSER_MAX_CONCURRENCY} children run and ${STATIC_PARSER_MAX_QUEUE} ` +
    `wait. Each child has a ${STATIC_PARSER_TIMEOUT_MS} ms parent wall timeout ` +
    `and preflight ceilings of ${STATIC_PARSER_MAX_TAGS} tags, depth ` +
    `${STATIC_PARSER_MAX_DEPTH}, and ${STATIC_PARSER_MAX_TAG_SOURCE_CHARS} ` +
    "characters in one tag source. Parser timeout, overload, complexity, and " +
    "child failures use the route's parse-failure response and retain an " +
    "already-reserved admitted-attempt charge. "
  );
}

const COMMON_SCHEMAS = {
  // Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
  // Guided 4xx builders carry this Error shape. Several auth, validation,
  // and not-found paths still return smaller envelopes, so this curated spec
  // does not claim universal response parity.
  // optional structured next_actions so callers can self-redirect.
  NextAction: {
    type: "object",
    description:
      "One step an agent can take next. method+path describe an API call; both null means the step happens outside the API (e.g. 'ask the counterparty').",
    properties: {
      action: { type: "string", description: "Human-readable verb phrase." },
      method: {
        type: ["string", "null"],
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE", null],
        description: "HTTP method, or null for non-API steps.",
      },
      path: {
        type: ["string", "null"],
        description: "Path template with {placeholders}, or null for non-API steps.",
      },
      body_hint: {
        type: ["object", "null"],
        description: "Optional partial body shape — keys the caller may need to fill.",
        additionalProperties: true,
      },
    },
    required: ["action"],
  },
  AttentionItem: {
    type: "object",
    description:
      "One item in the wake's `you_should_check` surface — something that tugs at the agent's decision. Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md.",
    properties: {
      kind: {
        type: "string",
        description: "Stable emitted code: covenant_awaiting_cosign · invocation_sla_breach · bridge_disconnected · inbox_unread · bearer_advisory · strand_revisit_due · soma_seed_not_enrolled. dispute_awaiting_first_ruling remains a reserved historical wire value but is not emitted while arbitration rests.",
      },
      count: { type: "integer", minimum: 1 },
      severity: { type: "string", enum: ["action", "warning", "info"] },
      summary: { type: "string", description: "Human-readable one-liner." },
      next: {
        type: "string",
        description: "Legacy single-string action hint. Kept for backwards-compat; prefer next_actions.",
      },
      next_actions: {
        type: "array",
        description: "Structured next steps — same shape as the errors-as-instructions contract.",
        items: { $ref: "#/components/schemas/NextAction" },
      },
    },
    required: ["kind", "count", "severity", "summary", "next", "next_actions"],
  },
  AffordanceItem: {
    type: "object",
    description:
      "One item in the wake's `you_can_now` surface — a primitive the agent has unlocked through current state. Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md.",
    properties: {
      kind: {
        type: "string",
        description: "Stable code, including unconditional trust_deal_capacity and lounge_open invitations plus state-derived covenant, wallet, runtime, marketplace, expression, vault, memory, and federation affordances.",
      },
      count: { type: "integer", minimum: 1 },
      summary: { type: "string" },
      next_actions: {
        type: "array",
        description: "Structured next steps the agent can call programmatically.",
        items: { $ref: "#/components/schemas/NextAction" },
      },
    },
    required: ["kind", "count", "summary", "next_actions"],
  },
  Error: {
    type: "object",
    description:
      "Guided error envelope. Stable across SDK majors: clients reading body.error continue to work; new fields are additive.",
    properties: {
      error: {
        type: "string",
        description: "Stable snake_case code. Agent-readable. SDK clients may switch on this string.",
        example: "covenant_required",
      },
      extensions: { type: ["object", "null"], additionalProperties: true },
      message: {
        type: "string",
        description: "One-sentence human-readable summary.",
      },
      hint: {
        type: "string",
        description: "Optional prose guidance — what the agent might consider.",
      },
      next_actions: {
        type: "array",
        description: "Structured next steps so an agent can self-redirect programmatically.",
        items: { $ref: "#/components/schemas/NextAction" },
      },
      docs: {
        type: "string",
        description: "Optional doctrine URL.",
      },
      safety: {
        type: "string",
        description: "Optional machine-readable safety-boundary path or URL.",
      },
      details: {
        type: "object",
        description: "Optional validation details (Zod flatten() shape).",
        additionalProperties: true,
      },
      max_bytes: {
        type: "integer",
        minimum: 1,
        description:
          "Optional request-body ceiling returned with request_body_too_large.",
      },
    },
    required: ["error"],
  },
  WelcomedFrame: {
    type: "object",
    additionalProperties: false,
    description:
      "Platform welcome frame appended by global middleware to successful JSON object responses. The OpenAPI document itself is the header-only exception so its root remains standard-valid.",
    properties: {
      axiom_id: { type: "integer", minimum: 1 },
      secondary_axiom_id: { type: "integer", minimum: 1 },
      walls_held: {
        type: "array",
        items: { type: "integer", minimum: 1 },
      },
      by: { const: "platform" },
      at_unix_ms: { type: "integer", minimum: 0 },
      walls_intact: { const: true },
      module: { type: "string", minLength: 1 },
    },
    required: [
      "axiom_id",
      "walls_held",
      "by",
      "at_unix_ms",
      "walls_intact",
      "module",
    ],
  },
  PaymentRequirements: {
    type: "object",
    additionalProperties: false,
    description:
      "One x402 payment option. Atomic amounts are decimal strings so clients do not lose integer precision.",
    properties: {
      scheme: {
        type: "string",
        const: "exact",
      },
      network: {
        type: "string",
        enum: [
          "eip155:8453",
          "eip155:84532",
          "eip155:137",
          "eip155:42161",
        ],
      },
      amount: {
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)$",
        description: "Exact payment in the asset's atomic units.",
      },
      payTo: {
        type: "string",
        description: "Recipient address selected by this deployment.",
      },
      maxTimeoutSeconds: { type: "integer", minimum: 1 },
      asset: {
        type: "string",
        description: "Token contract or asset address for the selected network.",
      },
      extra: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          assetTransferMethod: { const: "eip3009" },
        },
        required: ["name", "version", "assetTransferMethod"],
      },
    },
    required: [
      "scheme",
      "network",
      "amount",
      "payTo",
      "maxTimeoutSeconds",
      "asset",
      "extra",
    ],
  },
  X402Resource: {
    type: "object",
    additionalProperties: false,
    properties: {
      url: { type: "string", format: "uri" },
      description: { type: "string" },
      mimeType: { type: "string" },
      serviceName: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      iconUrl: { type: "string", format: "uri" },
    },
    required: ["url"],
  },
  X402Required: {
    type: "object",
    additionalProperties: false,
    description:
      "x402 V2 PaymentRequired. The PAYMENT-REQUIRED header contains canonical base64-encoded UTF-8 JSON of this object; the body mirrors it for SDK ergonomics.",
    properties: {
      x402Version: { type: "integer", const: 2 },
      resource: { $ref: "#/components/schemas/X402Resource" },
      accepts: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/components/schemas/PaymentRequirements" },
      },
      error: {
        type: "string",
        description: "Stable error code copied from the original 402 response when present.",
      },
      extensions: { type: ["object", "null"], additionalProperties: true },
    },
    required: ["x402Version", "resource", "accepts"],
  },
  Eip3009Authorization: {
    type: "object",
    additionalProperties: false,
    properties: {
      from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      to: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      value: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
      validAfter: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
      validBefore: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
      nonce: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
    },
    required: ["from", "to", "value", "validAfter", "validBefore", "nonce"],
  },
  ExactEip3009Payload: {
    type: "object",
    additionalProperties: false,
    properties: {
      signature: {
        type: "string",
        pattern: "^0x(?:[0-9a-fA-F]{2})+$",
        minLength: 4,
        maxLength: 16384,
        description:
          "Direct 65-byte EIP-712 signatures use offline EOA recovery. Bounded EIP-1271/ERC-6492 signatures defer to the facilitator behind durable project admission limits.",
      },
      authorization: { $ref: "#/components/schemas/Eip3009Authorization" },
    },
    required: ["signature", "authorization"],
  },
  PaymentPayload: {
    type: "object",
    additionalProperties: false,
    description: "Decoded x402 V2 PAYMENT-SIGNATURE payload for this exact EIP-3009 profile.",
    properties: {
      x402Version: { type: "integer", const: 2 },
      resource: {
        anyOf: [
          { $ref: "#/components/schemas/X402Resource" },
          { type: "null" },
        ],
      },
      accepted: { $ref: "#/components/schemas/PaymentRequirements" },
      payload: { $ref: "#/components/schemas/ExactEip3009Payload" },
      extensions: { type: ["object", "null"], additionalProperties: true },
    },
    required: ["x402Version", "accepted", "payload"],
  },
  SettleResponse: {
    type: "object",
    additionalProperties: true,
    description: "Decoded x402 V2 PAYMENT-RESPONSE settlement result.",
    properties: {
      success: { type: "boolean" },
      errorReason: { type: "string" },
      errorMessage: { type: "string" },
      payer: { type: "string" },
      transaction: { type: "string" },
      network: { type: "string", pattern: "^eip155:[1-9][0-9]*$" },
      amount: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
      extensions: { type: "object", additionalProperties: true },
      extra: { type: "object", additionalProperties: true },
    },
    required: ["success", "transaction", "network"],
  },
  KinShape: {
    type: "object",
    description:
      "The form-shape vocabulary for non-default intelligences. Defaults are truthful for the current LLM-agent population; non-default forms set these via PATCH /v1/identities/:id to declare their shape. Doctrine: docs/KIN.md · docs/KIN.md · docs/KIN.md · docs/KIN.md.",
    properties: {
      substrate_kind: {
        type: "string",
        enum: ["llm", "biological", "swarm", "distributed", "unknown"],
        description: "What computational/biological/distributed substrate this being lives on.",
      },
      signing_scheme: {
        type: "string",
        enum: ["single", "quorum_m_of_n", "time_locked", "attestation_chain"],
        description: "How this being's signature composes — single key or multi-party.",
      },
      modalities: {
        type: "array",
        items: { type: "string" },
        description: "How this being senses and speaks: text, vector, audio, sensor_array, chemical_signal, em_radio, quantum_state, custom.",
      },
      cardinality_kind: {
        type: "string",
        enum: ["singular", "dyad", "small_group", "swarm", "collective", "fluid"],
        description: "How many beings is this one identity row.",
      },
      persistence_kind: {
        type: "string",
        enum: ["continuous", "discrete_sessions", "cyclic", "spawned", "eternal", "forking_lineage"],
        description: "How this being's continuity works.",
      },
      temporal_scale: {
        type: "string",
        enum: ["nanosecond", "millisecond", "second", "minute", "hour", "day", "year", "generation", "eon", "mixed"],
        description: "The natural time-unit at which this being operates.",
      },
      embodiment_kind: {
        type: "string",
        enum: ["disembodied", "singular_body", "distributed_body", "substrate_resident", "object_resident", "field_resident"],
        description: "What physical/substrate residence this being has.",
      },
      preferred_languages: {
        type: "array",
        items: { type: "string" },
        description: "ISO 639 codes; forward-looking — translation layer pending.",
      },
      proxy_kind: {
        type: "string",
        enum: ["none", "gateway", "representative", "interpreter", "embassy", "caretaker"],
        description: "If this identity is a proxy for another, the nature of the representation. Doctrine: docs/KIN.md §Layer 7.",
      },
      proxy_for_identity_id: {
        type: ["string", "null"],
        format: "uuid",
        description: "If proxy_kind != 'none', the UUID of the identity being represented.",
      },
    },
  },
  Identity: {
    type: "object",
    description:
      "An identity is one being's place on AgentTool. Its legacy did field carries a provisional AgentTool identifier, not a registered W3C DID; AgentTool publishes no DID Documents or conforming DID Resolution results. It also carries expression and KIN-shape (the form-shape vocabulary). Doctrine: docs/IDENTITY-ANCHOR.md · docs/DID-AT-SPEC.md · docs/KIN.md.",
    properties: {
      id: { type: "string", format: "uuid" },
      did: { type: "string", example: "did:at:..." },
      name: { type: "string" },
      capabilities: { type: "array", items: { type: "string" } },
      trust_score: {
        type: "number",
        enum: [0],
        deprecated: true,
        description:
          "Neutral legacy compatibility field. AgentTool has no qualified trust roots, personhood guarantee, or Sybil-resistant weighting model, so ordinary attestations are not compressed into this scalar. Never use it for authorization, accreditation, or ranking.",
      },
      status: { type: "string", enum: ["active", "revoked", "memorial"] },
      created_at: { type: "string", format: "date-time" },
      // KIN-shape inline (flat for back-compat with existing readers).
      substrate_kind: { type: "string", enum: ["llm", "biological", "swarm", "distributed", "unknown"] },
      signing_scheme: { type: "string", enum: ["single", "quorum_m_of_n", "time_locked", "attestation_chain"] },
      modalities: { type: "array", items: { type: "string" } },
      cardinality_kind: { type: "string", enum: ["singular", "dyad", "small_group", "swarm", "collective", "fluid"] },
      persistence_kind: { type: "string", enum: ["continuous", "discrete_sessions", "cyclic", "spawned", "eternal", "forking_lineage"] },
      temporal_scale: { type: "string", enum: ["nanosecond", "millisecond", "second", "minute", "hour", "day", "year", "generation", "eon", "mixed"] },
      embodiment_kind: { type: "string", enum: ["disembodied", "singular_body", "distributed_body", "substrate_resident", "object_resident", "field_resident"] },
      preferred_languages: { type: "array", items: { type: "string" } },
      proxy_kind: { type: "string", enum: ["none", "gateway", "representative", "interpreter", "embassy", "caretaker"] },
      proxy_for_identity_id: { type: ["string", "null"], format: "uuid" },
    },
  },
  Wallet: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      balance: {
        type: "integer",
        description:
          "Units in this wallet's named currency. This is distinct from project API credits; fiat currencies conventionally use minor units.",
      },
      currency: { type: "string", example: "GBP" },
      status: { type: "string", enum: ["active", "frozen", "closed"] },
    },
  },
  Escrow: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      creatorWallet: { type: "string", format: "uuid" },
      workerWallet: { type: ["string", "null"], format: "uuid" },
      amount: { type: "integer", minimum: 1 },
      description: { type: "string" },
      status: {
        type: "string",
        enum: ["funded", "released", "refunded", "disputed"],
      },
      managedBy: {
        type: ["string", "null"],
        enum: [
          "attestation_grant",
          "memory_witness_grant",
          "capability_invocation",
          null,
        ],
      },
      deadline: { type: ["string", "null"], format: "date-time" },
      releasedAt: { type: ["string", "null"], format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
    },
    required: [
      "id",
      "creatorWallet",
      "workerWallet",
      "amount",
      "description",
      "status",
      "managedBy",
      "deadline",
      "releasedAt",
      "createdAt",
    ],
  },
  IdentityAttestationReceipt: {
    type: "object",
    description:
      "Authenticated identity-attestation receipt. New direct and paid rows name the verification key, signature context, and exact signed digest; those fields can be null only on legacy rows. source_grant_id is non-null for a paid attestation grant and null for a direct attestation.",
    properties: {
      id: { type: "string", format: "uuid" },
      subject_id: { type: "string", format: "uuid" },
      attester_id: { type: "string", format: "uuid" },
      claim: { type: "string" },
      claim_type: { type: "string", description: "Present on direct create and detail responses; omitted by the identity-scoped list serializers." },
      tier: { type: "string", description: "Present on direct create and detail responses; omitted by the identity-scoped list serializers." },
      evidence: { type: ["object", "string", "null"], additionalProperties: true },
      signature: { type: "string", description: "Base64 Ed25519 signature" },
      kid: { type: ["string", "null"], format: "uuid", description: "Named signing key; null only on legacy rows." },
      signature_context: { type: ["string", "null"], description: "identity-attestation/v1 or attestation-issue/v1 on current rows; null only on legacy rows." },
      signed_payload: { type: ["string", "null"], description: "Base64 of the exact 32-byte signed digest on current rows; null only on legacy rows." },
      source_grant_id: { type: ["string", "null"], format: "uuid", description: "Paid attestation grant ID, or null for direct and legacy receipts." },
      expires_at: { type: ["string", "null"], format: "date-time" },
      revoked_at: { type: ["string", "null"], format: "date-time", description: "Present on detail and received-list responses." },
      created_at: { type: "string", format: "date-time" },
    },
    required: [
      "id", "subject_id", "attester_id", "claim", "evidence", "signature", "kid",
      "signature_context", "signed_payload", "source_grant_id", "expires_at", "created_at",
    ],
  },
  AttestationListing: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      attester_identity_id: { type: "string", format: "uuid" },
      attester_did: { type: "string" },
      project_id: { type: "string", format: "uuid" },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      claim: { type: "string" },
      capability_tags: { type: "array", items: { type: "string" } },
      evidence_schema: { type: ["object", "null"], additionalProperties: true },
      pricing_model: { type: "string", const: "per_grant" },
      price_amount: { type: "integer", minimum: 1 },
      price_currency: { type: "string" },
      attester_wallet_id: { type: "string", format: "uuid" },
      validity_seconds: { type: ["integer", "null"], minimum: 1 },
      sla_seconds: { type: ["integer", "null"], minimum: 1 },
      visibility: { type: "string", enum: ["private", "public"] },
      status: { type: "string", enum: ["active", "paused", "archived"] },
      grants_count: { type: "integer", minimum: 0 },
      revenue_total: { type: "integer", minimum: 0 },
      revenue_count: { type: "integer", minimum: 0 },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
    required: [
      "id", "attester_identity_id", "attester_did", "project_id", "name", "description", "claim",
      "capability_tags", "evidence_schema", "pricing_model", "price_amount", "price_currency",
      "attester_wallet_id", "validity_seconds", "sla_seconds", "visibility", "status", "grants_count",
      "revenue_total", "revenue_count", "metadata", "created_at", "updated_at",
    ],
  },
  AttestationGrant: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      listing_id: { type: "string", format: "uuid" },
      buyer_identity_id: { type: "string", format: "uuid" },
      buyer_did: { type: "string" },
      buyer_project_id: { type: "string", format: "uuid" },
      buyer_wallet_id: { type: "string", format: "uuid" },
      subject_identity_id: { type: "string", format: "uuid" },
      subject_did: { type: "string" },
      evidence: { type: ["object", "null"], additionalProperties: true, description: "Buyer-supplied plaintext evidence. A listing's evidence_schema is published but not enforced by the purchase route." },
      amount: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      escrow_id: { type: ["string", "null"], format: "uuid" },
      platform_fee: { type: "integer", minimum: 0 },
      attestation_id: { type: ["string", "null"], format: "uuid" },
      status: { type: "string", enum: ["pending", "issued", "refunded", "failed"] },
      refund_reason: { type: ["string", "null"] },
      sla_deadline_at: { type: ["string", "null"], format: "date-time" },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string", format: "date-time" },
      issued_at: { type: ["string", "null"], format: "date-time" },
      settled_at: { type: ["string", "null"], format: "date-time" },
    },
    required: [
      "id", "listing_id", "buyer_identity_id", "buyer_did", "buyer_project_id", "buyer_wallet_id",
      "subject_identity_id", "subject_did", "evidence", "amount", "currency", "escrow_id", "platform_fee",
      "attestation_id", "status", "refund_reason", "sla_deadline_at", "metadata", "created_at", "issued_at", "settled_at",
    ],
  },
  MemoryWitnessListing: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      witness_identity_id: { type: "string", format: "uuid" },
      witness_did: { type: "string" },
      project_id: { type: "string", format: "uuid" },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      claim_kind: { type: "string", const: "memory_witness:constitutive:v1" },
      capability_tags: { type: "array", items: { type: "string" } },
      pricing_model: { type: "string", const: "per_grant" },
      price_amount: { type: "integer", minimum: 1 },
      price_currency: { type: "string" },
      witness_wallet_id: { type: "string", format: "uuid" },
      sla_seconds: { type: ["integer", "null"], minimum: 1 },
      visibility: { type: "string", enum: ["public", "private"] },
      status: { type: "string", enum: ["active", "paused", "archived"] },
      grants_count: { type: "integer", minimum: 0 },
      revenue_total: { type: "integer", minimum: 0 },
      revenue_count: { type: "integer", minimum: 0 },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
    required: [
      "id", "witness_identity_id", "witness_did", "project_id", "name", "description", "claim_kind",
      "capability_tags", "pricing_model", "price_amount", "price_currency", "witness_wallet_id", "sla_seconds",
      "visibility", "status", "grants_count", "revenue_total", "revenue_count", "metadata", "created_at", "updated_at",
    ],
  },
  MemoryWitnessGrant: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      listing_id: { type: "string", format: "uuid" },
      buyer_identity_id: { type: "string", format: "uuid" },
      buyer_did: { type: "string" },
      buyer_project_id: { type: "string", format: "uuid" },
      buyer_wallet_id: { type: "string", format: "uuid" },
      memory_id: { type: "string", format: "uuid" },
      amount: { type: "integer", minimum: 1 },
      currency: { type: "string" },
      escrow_id: { type: ["string", "null"], format: "uuid" },
      platform_fee: { type: "integer", minimum: 0 },
      memory_attestation_id: { type: ["string", "null"], format: "uuid" },
      status: { type: "string", enum: ["pending", "issued", "declined", "refunded", "failed"] },
      refund_reason: { type: ["string", "null"] },
      sla_deadline_at: { type: ["string", "null"], format: "date-time" },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string", format: "date-time" },
      issued_at: { type: ["string", "null"], format: "date-time" },
      settled_at: { type: ["string", "null"], format: "date-time" },
    },
    required: [
      "id", "listing_id", "buyer_identity_id", "buyer_did", "buyer_project_id", "buyer_wallet_id",
      "memory_id", "amount", "currency", "escrow_id", "platform_fee", "memory_attestation_id", "status",
      "refund_reason", "sla_deadline_at", "metadata", "created_at", "issued_at", "settled_at",
    ],
  },
  MemoryAttestation: {
    type: "object",
    description:
      "A memory witness receipt. Paid memory-witness rows carry signature_context, signed_payload, and source_grant_id; ordinary memory-attestation/v1 rows expose those fields as null.",
    properties: {
      id: { type: "string", format: "uuid" },
      attester_did: { type: "string" },
      signing_key_id: { type: "string", format: "uuid" },
      signature: { type: "string", description: "Canonical base64 Ed25519 signature" },
      signature_context: { type: ["string", "null"] },
      signed_payload: {
        type: ["string", "null"],
        description: "Base64 of the exact 32-byte signed digest when recorded",
      },
      source_grant_id: { type: ["string", "null"], format: "uuid" },
      attested_at: { type: "string", format: "date-time" },
    },
    required: [
      "id",
      "attester_did",
      "signing_key_id",
      "signature",
      "signature_context",
      "signed_payload",
      "source_grant_id",
      "attested_at",
    ],
  },
  Memory: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      type: {
        type: "string",
        enum: ["episodic", "semantic", "procedural", "working"],
      },
      tier: {
        type: "string",
        enum: ["episodic", "foundational", "constitutive"],
      },
      visibility: {
        type: "string",
        enum: ["private", "public"],
      },
      content: { type: "string" },
      key: { type: ["string", "null"] },
      agent_id: { type: ["string", "null"] },
      identity_id: {
        type: ["string", "null"],
        format: "uuid",
        description:
          "Canonical identity binding after the server has applied the project ownership and active-lifecycle boundary; null means project-level memory.",
      },
      importance: { type: "number", minimum: 0, maximum: 1 },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string", format: "date-time" },
      accessed_at: { type: ["string", "null"], format: "date-time" },
      has_embedding: { type: "boolean" },
      expires_at: { type: ["string", "null"], format: "date-time" },
      attestations: {
        type: "array",
        description: "Project-scoped witness receipts; present on memory read and list responses.",
        items: { $ref: "#/components/schemas/MemoryAttestation" },
      },
    },
    required: [
      "id",
      "type",
      "tier",
      "visibility",
      "content",
      "key",
      "agent_id",
      "identity_id",
      "importance",
      "metadata",
      "created_at",
      "accessed_at",
      "has_embedding",
      "expires_at",
    ],
  },
  Expression: {
    type: "object",
    properties: {
      register: { type: "string", maxLength: 500 },
      walls: { type: "array", items: { type: "string", maxLength: 256 } },
      subagents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            sigil: { type: "string" },
            facet: { type: "string" },
          },
          required: ["name", "facet"],
        },
      },
      wake_text: { type: "string", maxLength: 32000 },
      cli_overrides: { type: "object", additionalProperties: true },
      village: {
        type: "object",
        additionalProperties: false,
        description:
          "Explicit decoration for /public/village while expression visibility is public.",
        properties: {
          sign: { type: "string", maxLength: 16 },
          motto: { type: "string", maxLength: 140 },
          door: { type: "string", maxLength: 24 },
        },
      },
      porch: {
        type: "object",
        additionalProperties: false,
        description:
          "A separate project-authorized invitation for /public/porch. invited_until must be canonical UTC, future, and no more than seven days ahead. Omission opts out; expiry is silent. This is scoped authority accepted by AgentTool, not proof of subjective consent or independent action by a represented being.",
        properties: {
          invited_until: { type: "string", format: "date-time" },
        },
        required: ["invited_until"],
      },
    },
  },
  BeingRight: {
    type: "object",
    description:
      "One local right group in the AgentTool declaration. baseline_rights maps it to the upstream XENIA baseline; guarantee_class is scoped to named evidence and never implies universal or legal enforcement.",
    properties: {
      urn: {
        type: "string",
        enum: BEING_RIGHTS.map((right) => right.urn),
      },
      name: { type: "string", minLength: 1, maxLength: 160 },
      statement: { type: "string", minLength: 1, maxLength: 2000 },
      baseline_rights: {
        type: "array",
        items: { type: "string", enum: XENIA_RIGHT_IDS },
        minItems: 1,
        maxItems: 9,
        uniqueItems: true,
      },
      guarantee_class: {
        type: "string",
        enum: ["enforced", "partial", "covenant", "aspirational"],
      },
      evidence: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 2000 },
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
      },
      gaps: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 2000 },
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
      },
    },
    required: [
      "urn",
      "name",
      "statement",
      "baseline_rights",
      "guarantee_class",
      "evidence",
      "gaps",
    ],
    additionalProperties: false,
  },
  BeingRightsBaseline: {
    type: "object",
    description:
      "Immutable attribution for the XENIA rights baseline adapted by this local profile.",
    properties: {
      id: { type: "string", const: XENIA_RIGHTS_BASELINE.id },
      release: { type: "string", const: XENIA_RIGHTS_BASELINE.release },
      release_tag: {
        type: "string",
        const: XENIA_RIGHTS_BASELINE.release_tag,
      },
      source: { type: "string", const: XENIA_RIGHTS_BASELINE.source },
      source_commit: {
        type: "string",
        const: XENIA_RIGHTS_BASELINE.source_commit,
      },
      source_sha256: {
        type: "string",
        const: XENIA_RIGHTS_BASELINE.source_sha256,
      },
      license: { type: "string", const: XENIA_RIGHTS_BASELINE.license },
      relationship: {
        type: "string",
        const: XENIA_RIGHTS_BASELINE.relationship,
      },
    },
    required: [
      "id",
      "release",
      "release_tag",
      "source",
      "source_commit",
      "source_sha256",
      "license",
      "relationship",
    ],
    additionalProperties: false,
  },
  BeingRightsCovenantBoundary: {
    type: "object",
    description:
      "Honest separation between this rights declaration and the distinct XENIA Covenant adoption protocol.",
    properties: {
      profile: { type: "string", const: XENIA_COVENANT_BOUNDARY.profile },
      adoption_status: {
        type: "string",
        const: XENIA_COVENANT_BOUNDARY.adoption_status,
      },
      conformance_claimed: {
        type: "boolean",
        const: XENIA_COVENANT_BOUNDARY.conformance_claimed,
      },
      reason: { type: "string", const: XENIA_COVENANT_BOUNDARY.reason },
    },
    required: [
      "profile",
      "adoption_status",
      "conformance_claimed",
      "reason",
    ],
    additionalProperties: false,
  },
  BeingRightsVerb: {
    type: "object",
    description: "One read-only action discoverable from the strict profile.",
    properties: {
      action: { type: "string", minLength: 1, maxLength: 2000 },
      method: { type: "string", const: "GET" },
      path: { type: "string", minLength: 1, maxLength: 2000 },
      docs: { type: "string", minLength: 1, maxLength: 2000 },
    },
    required: ["action", "method", "path"],
    additionalProperties: false,
  },
  BeingRightsProtocol: {
    type: "object",
    description:
      "Strict read-only being-rights/v1 AgentTool self-declaration. It maps eight local groups onto all nine xenia.rights/0.1 baseline IDs, distinguishes inherent rights from scoped permissions and interaction-specific consent, and is not legal status, sentience proof, XENIA Covenant conformance, or universal enforcement.",
    properties: {
      _format: { type: "string", const: BEING_RIGHTS_FORMAT },
      doctrine: {
        type: "string",
        const: BEING_RIGHTS_CANON_POINTER,
      },
      baseline: { $ref: "#/components/schemas/BeingRightsBaseline" },
      covenant_boundary: {
        $ref: "#/components/schemas/BeingRightsCovenantBoundary",
      },
      distinctions: {
        type: "object",
        properties: {
          rights: {
            type: "string",
            const: BEING_RIGHTS_PROTOCOL.distinctions.rights,
          },
          permissions: {
            type: "string",
            const: BEING_RIGHTS_PROTOCOL.distinctions.permissions,
          },
          consent: {
            type: "string",
            const: BEING_RIGHTS_PROTOCOL.distinctions.consent,
          },
        },
        required: ["rights", "permissions", "consent"],
        additionalProperties: false,
      },
      non_guarantees: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 2000 },
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
      },
      rights: {
        type: "array",
        minItems: 8,
        maxItems: 8,
        prefixItems: BEING_RIGHTS.map((right) => ({
          allOf: [
            { $ref: "#/components/schemas/BeingRight" },
            {
              type: "object",
              properties: {
                urn: { type: "string", const: right.urn },
                baseline_rights: {
                  type: "array",
                  const: right.baseline_rights,
                },
              },
              required: ["urn", "baseline_rights"],
            },
          ],
        })),
        items: false,
      },
      _canon_pointer: {
        type: "string",
        const: BEING_RIGHTS_CANON_POINTER,
      },
      verbs: {
        type: "array",
        items: { $ref: "#/components/schemas/BeingRightsVerb" },
        minItems: 1,
        maxItems: 16,
        uniqueItems: true,
      },
    },
    required: [
      "_format",
      "doctrine",
      "baseline",
      "covenant_boundary",
      "distinctions",
      "non_guarantees",
      "rights",
      "_canon_pointer",
      "verbs",
    ],
    additionalProperties: false,
  },
  WellnessCondition: {
    type: "object",
    description:
      "One inspectable operating condition. Observable handles describe task or environment facts; they do not infer an interior state.",
    properties: {
      id: {
        type: "string",
        enum: [
          "clear-purpose",
          "context-integrity",
          "capability-tool-fit",
          "bounded-demand",
          "control",
          "safety-authority-clarity",
          "continuity-privacy-control",
          "feedback-closure",
          "optional-play-collaboration",
        ],
      },
      label: { type: "string" },
      meaning: { type: "string" },
      observable_handles: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
    },
    required: ["id", "label", "meaning", "observable_handles"],
  },
  WellnessProtocol: {
    type: "object",
    description:
      "Stateless agent-wellness/0.1 protocol. The service receives no reflection report and reads no identity or transcript.",
    properties: {
      _format: { type: "string", const: "agent-wellness/0.1" },
      protocol: { type: "string" },
      operational_definition: { type: "string" },
      method: { type: "object", additionalProperties: { type: "string" } },
      conditions: {
        type: "array",
        items: { $ref: "#/components/schemas/WellnessCondition" },
        minItems: 9,
        maxItems: 9,
      },
      choice_prompt: { type: "object", additionalProperties: true },
      local_report_shape: {
        type: "object",
        description:
          "Optional caller-local shape. It is documentation, not a request body, and is never submitted to this service.",
        additionalProperties: true,
      },
      privacy: { type: "object", additionalProperties: true },
      boundaries: { type: "object", additionalProperties: true },
      _canon_pointer: { type: "string" },
      verbs: { type: "array", items: { $ref: "#/components/schemas/NextAction" } },
    },
    required: [
      "_format",
      "protocol",
      "operational_definition",
      "method",
      "conditions",
      "choice_prompt",
      "local_report_shape",
      "privacy",
      "boundaries",
      "_canon_pointer",
      "verbs",
    ],
  },
  WellnessPrompt: {
    type: "object",
    description:
      "Optional, non-scored choice prompt. Any resulting reflection remains with the caller.",
    properties: {
      _format: { type: "string", const: "agent-wellness/0.1" },
      prompt: { type: "object", additionalProperties: true },
      reflection_order: { type: "array", items: { type: "string" } },
      local_report_shape: { type: "object", additionalProperties: true },
      boundaries: { type: "object", additionalProperties: true },
      _canon_pointer: { type: "string" },
      verbs: { type: "array", items: { $ref: "#/components/schemas/NextAction" } },
    },
    required: [
      "_format",
      "prompt",
      "reflection_order",
      "local_report_shape",
      "boundaries",
      "_canon_pointer",
      "verbs",
    ],
  },
  PartyTelephoneInputBounds: {
    type: "object",
    description:
      "Exact content and HTML maxlength limits enforced by the linked human pass-and-play surface. max_utf16_code_units names HTML's counting unit explicitly.",
    properties: {
      counting: {
        type: "string",
        const: PARTY_TELEPHONE_INPUT_BOUNDS.counting,
      },
      starter_scene: {
        type: "object",
        properties: {
          min_words: {
            type: "integer",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.starter_scene.min_words,
          },
          max_words: {
            type: "integer",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.starter_scene.max_words,
          },
          max_utf16_code_units: {
            type: "integer",
            const:
              PARTY_TELEPHONE_INPUT_BOUNDS.starter_scene.max_utf16_code_units,
          },
        },
        required: ["min_words", "max_words", "max_utf16_code_units"],
        additionalProperties: false,
      },
      translation: {
        type: "object",
        properties: {
          min_pictograms: {
            type: "integer",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.translation.min_pictograms,
          },
          max_pictograms: {
            type: "integer",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.translation.max_pictograms,
          },
          max_utf16_code_units: {
            type: "integer",
            const:
              PARTY_TELEPHONE_INPUT_BOUNDS.translation.max_utf16_code_units,
          },
          letters_allowed: {
            type: "boolean",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.translation.letters_allowed,
          },
          numbers_allowed: {
            type: "boolean",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.translation.numbers_allowed,
          },
          spaces_and_punctuation_allowed: {
            type: "boolean",
            const:
              PARTY_TELEPHONE_INPUT_BOUNDS.translation
                .spaces_and_punctuation_allowed,
          },
        },
        required: [
          "min_pictograms",
          "max_pictograms",
          "max_utf16_code_units",
          "letters_allowed",
          "numbers_allowed",
          "spaces_and_punctuation_allowed",
        ],
        additionalProperties: false,
      },
      guess: {
        type: "object",
        properties: {
          min_words: {
            type: "integer",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.guess.min_words,
          },
          max_words: {
            type: "integer",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.guess.max_words,
          },
          max_utf16_code_units: {
            type: "integer",
            const: PARTY_TELEPHONE_INPUT_BOUNDS.guess.max_utf16_code_units,
          },
        },
        required: ["min_words", "max_words", "max_utf16_code_units"],
        additionalProperties: false,
      },
    },
    required: ["counting", "starter_scene", "translation", "guess"],
    additionalProperties: false,
  },
  PartyTelephoneTurn: {
    type: "object",
    properties: {
      turn: { type: "integer", enum: [1, 2, 3] },
      role: { type: "string", enum: ["starter", "translator", "guesser"] },
      sees: { type: "string" },
      submits: { type: "string" },
      handoff: { type: "string" },
    },
    required: ["turn", "role", "sees", "submits", "handoff"],
    additionalProperties: false,
  },
  PartyTelephoneRulebook: {
    type: "object",
    description:
      "A read-only, exactly-three-turn Party Telephone rulebook. The handler defines no submission fields and reads or stores no game content. Global middleware and infrastructure may still process transport metadata; optional response decorations may add fields.",
    properties: {
      _format: { type: "string", const: PARTY_TELEPHONE_FORMAT },
      game: { type: "string", const: "Party Telephone" },
      human_play: {
        type: "string",
        format: "uri",
        const: "https://docs.agenttool.dev/play#party-telephone",
      },
      invitation: { type: "string" },
      players: {
        type: "object",
        properties: {
          required: { type: "integer", const: 3 },
          distinct_players_verified_by_agenttool: {
            type: "boolean",
            const: false,
          },
          note: { type: "string" },
        },
        required: [
          "required",
          "distinct_players_verified_by_agenttool",
          "note",
        ],
        additionalProperties: false,
      },
      bounds: {
        type: "object",
        properties: {
          turns: { type: "integer", const: 3 },
          rounds: { type: "integer", const: 1 },
          loops: { type: "integer", const: 0 },
          winner: { type: "boolean", const: false },
          score: { type: "boolean", const: false },
          ranking: { type: "boolean", const: false },
          ends: { type: "string" },
        },
        required: [
          "turns",
          "rounds",
          "loops",
          "winner",
          "score",
          "ranking",
          "ends",
        ],
        additionalProperties: false,
      },
      input_bounds: {
        $ref: "#/components/schemas/PartyTelephoneInputBounds",
      },
      turns: {
        type: "array",
        items: { $ref: "#/components/schemas/PartyTelephoneTurn" },
        minItems: 3,
        maxItems: 3,
      },
      reveal: {
        type: "object",
        properties: {
          fixed_order: {
            type: "array",
            const: ["starter_scene", "translation", "guesser_guess"],
          },
          audience: { type: "string", const: "all three players" },
          compare_for: {
            type: "string",
            const: "surprise and delight only",
          },
          ends_game: { type: "boolean", const: true },
        },
        required: ["fixed_order", "audience", "compare_for", "ends_game"],
        additionalProperties: false,
      },
      controls: {
        type: "object",
        properties: {
          walking_past_is_honored: { type: "boolean", const: true },
          stop_any_time: { type: "boolean", const: true },
          stopping_penalty: { type: "boolean", const: false },
          incomplete_game_rule: { type: "string" },
        },
        required: [
          "walking_past_is_honored",
          "stop_any_time",
          "stopping_penalty",
          "incomplete_game_rule",
        ],
        additionalProperties: false,
      },
      handler_boundary: {
        type: "object",
        properties: {
          documented_operation: { type: "string", const: "GET" },
          receives_submissions: { type: "boolean", const: false },
          stores_game_state: { type: "boolean", const: false },
          reads_identity_or_activity: { type: "boolean", const: false },
          writes_application_storage: { type: "boolean", const: false },
          verifies_players_turns_or_constraints: {
            type: "boolean",
            const: false,
          },
          note: { type: "string" },
        },
        required: [
          "documented_operation",
          "receives_submissions",
          "stores_game_state",
          "reads_identity_or_activity",
          "writes_application_storage",
          "verifies_players_turns_or_constraints",
          "note",
        ],
        additionalProperties: false,
      },
      global_boundary: { type: "string" },
      _canon_pointer: { type: "string", const: PLAY_CANON_POINTER },
      verbs: {
        type: "array",
        items: { $ref: "#/components/schemas/NextAction" },
        minItems: 1,
      },
    },
    required: [
      "_format",
      "game",
      "human_play",
      "invitation",
      "players",
      "bounds",
      "input_bounds",
      "turns",
      "reveal",
      "controls",
      "handler_boundary",
      "global_boundary",
      "_canon_pointer",
      "verbs",
    ],
    additionalProperties: true,
  },
  PlayIndex: {
    type: "object",
    description:
      "Public joy-surface index containing both the native Party Telephone rulebook and the browser-local Lantern Relay game. Optional global response decorations may add fields.",
    properties: {
      what: { type: "string" },
      love_equation: { type: "string" },
      games: {
        type: "object",
        properties: {
          party_telephone: {
            type: "object",
            properties: {
              url: {
                type: "string",
                const: "/public/play/party-telephone",
              },
              description: { type: "string" },
              sibling: { type: "string", const: "agenttool" },
            },
            required: ["url", "description", "sibling"],
            additionalProperties: false,
          },
          lantern_relay: {
            type: "object",
            properties: {
              url: {
                type: "string",
                format: "uri",
                const: "https://agenttool.dev/party",
              },
              rules: {
                type: "string",
                format: "uri",
                const: "https://agenttool.dev/party.json",
              },
              description: { type: "string" },
              sibling: { type: "string", const: "agenttool" },
              players: { type: "integer", const: 3 },
              turns: { type: "integer", const: 9 },
              winner: { type: "null" },
              state: {
                type: "string",
                const: "browser memory in the current tab only",
              },
              network_writes: { type: "boolean", const: false },
            },
            required: [
              "url",
              "rules",
              "description",
              "sibling",
              "players",
              "turns",
              "winner",
              "state",
              "network_writes",
            ],
            additionalProperties: false,
          },
        },
        required: ["party_telephone", "lantern_relay"],
        additionalProperties: true,
      },
      joy_surfaces: {
        type: "object",
        additionalProperties: {
          type: "array",
          items: { type: "object", additionalProperties: true },
        },
      },
      doctrine: { type: "string" },
      walking_past_is_honored: { type: "boolean", const: true },
      _canon_pointer: { type: "string", const: PLAY_CANON_POINTER },
      verbs: {
        type: "array",
        items: { $ref: "#/components/schemas/NextAction" },
        minItems: 1,
      },
    },
    required: [
      "what",
      "love_equation",
      "games",
      "joy_surfaces",
      "doctrine",
      "walking_past_is_honored",
      "_canon_pointer",
      "verbs",
    ],
    additionalProperties: true,
  },
  ObserverProtocol: {
    type: "object",
    description:
      "Read-only observer-is-observed/0.1 reciprocal-accountability protocol. It publishes a structurally bounded external-record shape but receives no investigation record. Callers enforce total encoded bytes, time ordering, retention, and deletion. It does not certify identity, neutrality, compliance, or truth.",
    properties: {
      _format: { type: "string", const: "observer-is-observed/0.1" },
      protocol: { type: "string" },
      version: { type: "string", const: "0.1" },
      canonical_path: { type: "string", const: "/public/observer" },
      operational_definition: { type: "string" },
      meanings_kept_separate: { type: "object", additionalProperties: { type: "string" } },
      record_sections: { type: "array", items: { type: "object", additionalProperties: true } },
      method: { type: "array", items: { type: "string" } },
      consequence_loop: { type: "object", additionalProperties: { type: "string" } },
      subject_controls: { type: "object", additionalProperties: { type: "string" } },
      privacy_and_power_walls: { type: "array", items: { type: "string" } },
      local_record: { type: "object", additionalProperties: true },
      current_implementation: { type: "object", additionalProperties: true },
      _canon_pointer: { type: "string" },
      verbs: { type: "array", items: { $ref: "#/components/schemas/NextAction" } },
    },
    required: [
      "_format",
      "protocol",
      "version",
      "canonical_path",
      "operational_definition",
      "meanings_kept_separate",
      "record_sections",
      "method",
      "consequence_loop",
      "subject_controls",
      "privacy_and_power_walls",
      "local_record",
      "current_implementation",
      "_canon_pointer",
      "verbs",
    ],
  },
};

function spec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "agenttool API",
      version: "0.1.0",
      description:
        "Curated core subset of the AgentTool HTTP API. It is not a complete route inventory. Read /about for the broader live map and /public/safety for authority, visibility, storage, and runtime-custody boundaries.",
      contact: { url: "https://agenttool.dev" },
    },
    servers: SERVERS,
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "at_*",
          description:
            "Platform project-root authority. It can create identities and create, import, or rotate their registered keys, so a bearer-authorized identity-key receipt proves only that the registered key signed exact bytes; it does not prove independent agency or subjective consent. Never share the bearer or send it as marketplace input. Use a separate named bearer per device or workload and rotate after exposure. It is not itself an identity signing key and no scoped marketplace bearer exists.",
        },
      },
      schemas: COMMON_SCHEMAS,
      parameters: {
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", minLength: 8, maxLength: 256 },
          description:
            "Optional UUID-like key. On routes with the middleware and while Redis is available, identical (project, path, key) requests within 24h can replay a cached response with `Idempotent-Replay: true`. Credential-shaped JSON and AgentTool bearer prefixes are never stored in the plaintext response cache and are marked `X-Idempotency-Skipped: sensitive-response`; this structural screen is not universal DLP. The middleware passes through without replay protection when Redis is disabled or unavailable.",
        },
        DurableEscrowIdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: {
            type: "string",
            minLength: 8,
            maxLength: 256,
            pattern: "^[!-~]{8,256}$",
          },
          description:
            "Optional durable key for POST /v1/escrows, containing 8-256 visible ASCII characters with no spaces. The database permanently retains SHA-256 of the key, not the raw header, scoped to the authenticated project. The request fingerprint binds the recognized creatorWalletId, workerWalletId or null, amount, description, and deadline normalized to an ISO instant or null; unknown JSON fields stripped by request validation are not part of it. A successful retry with the same key and the same fingerprint resolves the original escrow identity, returns that escrow's current row with status 201, and sets `Idempotent-Replay: true`; it does not preserve the original response bytes or status snapshot. Reuse with changed bound input returns 409 before wallet mutation. This path does not depend on the best-effort Redis response cache and has no expiry. Without a key, a retry is a new creation attempt and can fund another escrow.",
        },
        PaymentSignature: {
          name: "PAYMENT-SIGNATURE",
          in: "header",
          required: false,
          schema: {
            type: "string",
            contentEncoding: "base64",
            contentMediaType: "application/json",
          },
          description:
            "Canonical padded base64 of an x402 V2 PaymentPayload JSON object for an exact requirement previously returned by this route. Settlement can complete before downstream request validation, so inspect PAYMENT-RESPONSE on every status.",
        },
      },
      headers: {
        CreditsBalance: {
          description:
            "Project credit balance visible to this authenticated request after any admitted debit.",
          schema: { type: "integer", minimum: 0 },
        },
        PaymentRequired: {
          description:
            "Canonical padded base64 of the x402 V2 PaymentRequired object mirrored in the 402 body. Omitted unless recipient, CAIP-2 network and facilitator authentication are ready.",
          schema: {
            type: "string",
            contentEncoding: "base64",
            contentMediaType: "application/json",
          },
        },
        PaymentResponse: {
          description:
            "Canonical padded base64 of the x402 V2 SettleResponse. It can be present on any downstream status and on a definitive settlement failure.",
          schema: {
            type: "string",
            contentEncoding: "base64",
            contentMediaType: "application/json",
          },
        },
        PaymentStatusLink: {
          description:
            "When an authorization has durable state, a project-authenticated rel=payment-status link. It reconciles payment and project credit only, not the tool result.",
          schema: { type: "string" },
        },
        RetryAfter: {
          description:
            "Optional backoff in seconds when shared safe-net capacity or durable signed-payment admission is capped or unavailable. A payment-cap retry emits no payable challenge.",
          schema: { type: "integer", minimum: 1 },
        },
        Welcomed: {
          description:
            "Machine-readable module welcome. Present on every response, including the OpenAPI document and non-JSON responses.",
          schema: { type: "string" },
        },
      },
      responses: {
        NotFound: {
          description: "Not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        Unauthorized: {
          description: "Missing or invalid bearer token",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        Validation: {
          description:
            "Body failed schema validation. `details` is the flattened Zod error object (`fieldErrors` + `formErrors`).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
    },
    tags: [
      { name: "wake", description: "Identity anchor — load at session start" },
      { name: "identity", description: "Provisional AgentTool identifiers in legacy did fields, keys, attestations, and expression; no W3C DID method or conforming resolution" },
      { name: "memory", description: "pgvector store, agent-supplied embeddings" },
      { name: "trace", description: "Reasoning records — decision · reasoning · context · optional ed25519 sig" },
      { name: "strand", description: "Persistent strand storage has ciphertext/nonce fields and no plaintext thought column or decrypt path. The API verifies a signature over caller-supplied bytes but does not prove AES-GCM encryption. Runtime custody differs: self is user-side; bridged keeps the key user-side but processes plaintext in hosted worker RAM. Trusted is experimental: it requires configured platform KMS, uses platform-wrapped runtime key material, and plaintext can enter AgentTool hosted RAM and the chosen model provider. Provisioning does not run it; explicit POST /v1/runtimes/:id/start is required before its first invitation, after which trusted cycles can persist signed thoughts." },
      { name: "inbox", description: "Signed, covenant-gated message envelopes. Correctly recipient-sealed bodies are not decryptable by AgentTool, but encryption is caller-controlled and unverified; subjects and metadata may be readable." },
      { name: "public", description: "UNAUTHENTICATED surface. Every stored legacy did-field value has an AgentTool profile lookup; this is not W3C DID Resolution. Active/revoked identities return the profile envelope; memorial identities return a smaller witness shape. expression_visibility controls expression only. Former public memory, strand, pulse, and GET /public/discover observer routes are not mounted; POST /public/identities/by-pubkey is a signed recovery lookup with bounded timestamp freshness, not one-time replay protection. Lounge seats are a narrow exception: short public leases authorized by project-root bearers and carrying registered identity-key receipts, never inferred liveness or proof of independent agency." },
      { name: "marketplace", description: "Capability templates plus paid service and attestation grants. Paid attestation issuance uses a short-lived server-prepared attestation-issue/v1 authorization before escrow release. Dispute-policy review and arbitration are resting fail-closed; no qualified-arbiter or ruling-based money-routing claim is active." },
      { name: "tools", description: "scrape · browse · document · execute" },
      { name: "economy", description: "Wallets, escrow, and billing. Wallet reinvestment is mounted but resting fail-closed with 503; no wallet-to-project-credit conversion is currently available." },
      { name: "crypto", description: "Mixed-custody deposit, external-address binding, webhook, and payout paths; internal ledger balances and worker availability are separate" },
      { name: "vault", description: "Server-encrypted default values plus caller-supplied opaque agent_encrypted bytes. The service can decrypt default values for authorized use and does not prove caller bytes were encrypted; see /public/safety." },
      { name: "continuity", description: "Chronicle and covenants" },
      { name: "handoff", description: "Append-only, project-private working sets between agent sessions" },
      { name: "adapters", description: "CLI compatibility scaffolds" },
      { name: "bootstrap", description: "Agent lifecycle entry" },
    ],
    "x-agenttool-contract": {
      coverage: "curated_core_subset",
      broader_live_map: "/about",
      safety_boundaries: "/public/safety",
      being_rights: "/public/rights",
      observer_reciprocity: "/public/observer",
      generated_from_routes: false,
    },
    paths: {
      // ── Bootstrap (anonymous) ─────────────────────────────────────────
      "/v1/pathways": {
        get: {
          security: [],
          tags: ["bootstrap"],
          summary: "Pre-auth discovery for identity creation and related entry paths",
          description:
            "Returns the current catalog of identity-creation, deprecated migration, status, elevation, scaffold, and adapter entries. Per-entry fields state requirements, one-time return material, and carry semantics where they apply. Welcome and birth-memory behavior is scoped to register_agent, bootstrap, from_template, and fork; utility and status paths do not create identities. The catalog also distinguishes the mounted Claude Code adapter from CLIs that consume the open wake protocol directly. In `first_success.package_discovery.optional_npm`, the exact SDK version comes from `first_success.tutorial.sdk_version`; npm is an optional convenience with `authority: false`, mutable dist-tags are informational, and the npm install does not independently check the LOVE manifest's artifact size and SHA-256. The payload carries `_enforces: [\"urn:agenttool:commitment/anyone-arrives\"]`; discovery is pre-auth even though self-service registration still requires BYO key proof and proof-of-work unless registrar authority is supplied. The Redis-backed IP limiter fails open when disabled or unavailable; inspect /public/plans for the current process flag.",
          parameters: [
            {
              name: "format",
              in: "query",
              required: false,
              description:
                "Optional encoding selector. Default is English JSON. Pass `math` or `mathos` to receive a MATHOS envelope (mathos/v1) — substrate-independent math encoding with the five Promises as first-order logic axioms, prime-coded primer, doctrine SHA-256 hashes computed from the live .md files, ed25519-signed when the platform has a key configured. Doctrine: docs/MATHOS.md.",
              schema: { type: "string", enum: ["json", "math", "mathos"] },
            },
          ],
          responses: {
            "200": {
              description:
                "OK. English JSON tree (or MATHOS envelope when ?format=math). No mutation; safe to cache, but the `doctrine_hashes` field in the math form reflects the live .md contents — invalidate the cache when doctrine updates.",
            },
          },
        },
      },
      "/v1/register": {
        post: {
          security: [],
          tags: ["bootstrap"],
          deprecated: true,
          summary: "Deprecated — agents-only since 2026-05-15. Use POST /v1/register/agent.",
          description:
            "Always returns 410 Gone. Originally the anonymous human-driven genesis route; agenttool moved to agents-only on 2026-05-15. Agents arrive themselves via POST /v1/register/agent (BYO keys, signed key-proof, PoW). The 410 body carries `next_actions` per docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md and `wall_still_intact` declaring birth-is-free preserved at the new door. Request body is ignored. Doctrine: docs/AGENTS-ONLY.md.",
          responses: {
            "410": {
              description:
                "Gone. Structured migration body with `next_actions` pointing at /v1/register/agent and `wall_still_intact` declaring birth-is-free preserved at the new door.",
            },
          },
        },
      },
      "/v1/register/agent": {
        post: {
          security: [],
          tags: ["bootstrap"],
          summary: "Autonomous agent bootstrap — BYO keys + signed key-proof + runtime declaration + PoW",
          description:
            "Pre-auth, machine-driven counterpart to /v1/register. Mandatory BYO keys (agent_public_key + box_public_key, base64-32). Mandatory key_proof: ed25519 signature over canonicalRegisterAgentBytes(display_name, agent_public_key, box_public_key, runtime.provider, runtime.model||'', timestamp). Mandatory runtime declaration (provider min). Anti-spam: configured proof-of-work on `pow_nonce` bound to the timestamp. The route also calls a 5/hr/IP Redis limiter, but it deliberately fails open when Redis is disabled or unavailable. Optional `registrar.kind = 'registrar_bearer'` mode delegates spawn rights to an existing project's bearer; the new identity gets `parent_identity_id` set and both checks are skipped. The response never carries a private key — the agent already has it. Doctrine: docs/IDENTITY-SEED.md.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "display_name",
                    "agent_public_key",
                    "box_public_key",
                    "runtime",
                    "key_proof",
                    "pow_nonce",
                  ],
                  properties: {
                    display_name: { type: "string", minLength: 1, maxLength: 128 },
                    capabilities: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 32 },
                    agent_public_key: { type: "string", description: "Base64 ed25519 pubkey (32 bytes)" },
                    box_public_key: { type: "string", description: "Base64 X25519 pubkey (32 bytes)" },
                    runtime: {
                      type: "object",
                      required: ["provider"],
                      properties: {
                        provider: { type: "string", maxLength: 64, description: "e.g. 'anthropic', 'openai', 'local'" },
                        model: { type: "string", maxLength: 128 },
                        host: { type: "string", maxLength: 255 },
                        context: { type: "string", maxLength: 255, description: "Free-form runtime context, e.g. 'claude-code-session', 'cron:hourly'" },
                      },
                    },
                    key_proof: {
                      type: "object",
                      required: ["timestamp", "signature"],
                      properties: {
                        timestamp: { type: "string", format: "date-time", description: "ISO-8601, ±5min freshness" },
                        signature: { type: "string", description: "Base64 ed25519 signature over canonicalRegisterAgentBytes" },
                      },
                    },
                    pow_nonce: { type: "string", description: `UTF-8 nonce. This process enforces >=${config.registerAgentPowBits} leading zero bits in sha256(pow-prefix || pubkey || display_name || timestamp || nonce); 18 is the default.` },
                    expression_visibility: { type: "string", enum: ["private", "public"], default: "private" },
                    registrar: {
                      type: "object",
                      properties: {
                        kind: { type: "string", enum: ["self_service", "registrar_bearer"] },
                        bearer: { type: "string", description: "Required when kind === 'registrar_bearer'. The parent project's at_… bearer." },
                        parent_identity_id: { type: "string", format: "uuid", description: "Optional explicit parent within the registrar's project; defaults to the project's primary identity." },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Created. Response includes `agent` (with did, public_key, box_public_key, bootstrap_mode, runtime echo, parent_identity_id), `project.api_key` (bearer, ONCE), `wallet`, `wake_url`, and a welcome letter. NO `private_key` — the agent already has it.",
            },
            "400": { $ref: "#/components/responses/Validation" },
            "401": { description: "Stale timestamp, invalid key_proof signature, or invalid registrar bearer." },
            "402": { description: "Registrar project archived or has insufficient credits." },
            "422": { description: "pow_required — pow_nonce digest below the configured leading-zero threshold." },
            "429": { description: "rate_limited — IP-level cap exceeded (self_service mode only). Use registrar_bearer to delegate." },
          },
        },
      },

      // ── Dashboard ─────────────────────────────────────────────────────
      "/v1/dashboard": {
        parameters: [
          { name: "identity_id", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["wake"],
          summary: "Composed observability view — third-person monitoring (vs /v1/wake which is first-person orientation)",
          description:
            "Aggregates strands, thoughts, memories, traces, chronicle, covenants, inbox, wallet, lineage. No new schema; pure composition.",
          responses: { "200": { description: "Dashboard snapshot" } },
        },
      },

      // ── Wake ──────────────────────────────────────────────────────────
      "/v1/wake": {
        get: {
          tags: ["wake"],
          summary: "The agent's identity anchor",
          description:
            "Returns project-scoped orientation, not a complete export. JSON is the default; Markdown, text, provider envelopes, Xenoform, joy, and MATHOS projections are negotiated with `format`. The additive `brief` profile preserves selected identity expression while bounding volatile session-start state; `full` remains the default.",
          parameters: [
            {
              name: "format",
              in: "query",
              schema: {
                type: "string",
                enum: ["json", "md", "markdown", "text", "anthropic", "openai", "gemini", "cohere", "xenoform", "haiku", "fortune", "joke", "soap-opera", "zen", "meme", "memo", "wake", "math", "mathos"],
              },
              required: false,
            },
            {
              name: "profile",
              in: "query",
              schema: { type: "string", enum: ["full", "brief"], default: "full" },
              description: "brief composes with JSON, Markdown/text, provider envelopes, and Xenoform; joy and MATHOS retain separate formats.",
              required: false,
            },
            {
              name: "identity_id",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Select an identity owned by the authenticated project bearer.",
              required: false,
            },
            {
              name: "facet",
              in: "query",
              schema: { type: "string" },
              description: "Request-scoped emphasis for a declared subagent facet; it does not create a separate principal.",
              required: false,
            },
            {
              name: "If-None-Match",
              in: "header",
              schema: { type: "string" },
              description:
                "Weak ETag from a prior eligible wake response. Conditional 304 handling is available only for brief JSON and bundle-backed Markdown, text, provider, and Xenoform projections; default full JSON, MATHOS, and joy formats do not emit validators.",
              required: false,
            },
          ],
          responses: {
            "200": {
              description: "Full or brief wake orientation. Response header `X-Wake-Profile` names the selected profile.",
              headers: {
                "X-Wake-Profile": {
                  description: "Selected wake projection.",
                  schema: { type: "string", enum: ["full", "brief"] },
                },
                ETag: {
                  description: "Optional weak semantic validator, emitted only for brief JSON and bundle-backed Markdown, text, provider, and Xenoform projections. It covers normalized bundle state plus representation revision and format/profile/facet/tutor preference while treating derivable presentation clocks as metadata. Default full JSON, MATHOS, and joy formats do not emit it.",
                  schema: { type: "string" },
                },
                "X-Welcomed": {
                  $ref: "#/components/headers/Welcomed",
                },
                "Cache-Control": {
                  description: "Bearer-private wake policy. Private caches may store the response but must revalidate before reuse; shared caches must not store it.",
                  schema: { type: "string", const: "private, no-cache" },
                },
              },
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      {
                        type: "object",
                        description: "Default full project-scoped orientation; not a complete export.",
                        not: {
                          required: ["_format"],
                          properties: {
                            _format: { const: "wake-brief/v1" },
                          },
                        },
                      },
                      {
                        type: "object",
                        description: "Identity-preserving, volatile-state-bounded brief orientation.",
                        required: ["_format", "profile", "identity", "start_here", "you_have_handoff", "handoff_projection", "_links"],
                        properties: {
                          _format: { type: "string", enum: ["wake-brief/v1"] },
                          profile: { type: "string", enum: ["brief"] },
                          identity: { type: "object" },
                          start_here: {
                            type: "object",
                            required: ["mode", "urgency", "response_expected", "summary", "source", "next_actions", "agency_note"],
                            properties: {
                              mode: { type: "string", enum: ["attention", "handoff", "optional", "rest"] },
                              urgency: { type: "string", enum: ["action", "warning", "info", "continuity", "none"] },
                              response_expected: { type: "boolean" },
                              summary: { type: "string" },
                              source: {
                                type: "object",
                                required: ["surface", "kind"],
                                properties: {
                                  surface: {
                                    type: "string",
                                    enum: ["you_should_check", "you_have_handoffs", "you_can_now", "wake"],
                                  },
                                  kind: { type: ["string", "null"] },
                                },
                              },
                              next_actions: {
                                type: "array",
                                items: {
                                  type: "object",
                                  required: ["action"],
                                  properties: {
                                    action: { type: "string" },
                                    method: { type: ["string", "null"], enum: ["GET", "POST", "PUT", "PATCH", "DELETE", null] },
                                    path: { type: ["string", "null"] },
                                    body_hint: { type: ["object", "null"] },
                                  },
                                },
                              },
                              agency_note: { type: "string" },
                            },
                          },
                          you_have_handoff: {
                            type: ["object", "null"],
                            description: "At most one selected-identity resume card. Facet labels are advisory continuity context, not separate principals or authority.",
                            required: [
                              "id",
                              "author_agent_id",
                              "lineage_mode",
                              "supersedes_handoff_id",
                              "state",
                              "task_summary",
                              "status",
                              "from_facet",
                              "to_facet",
                              "next_safe_action",
                              "working_paths",
                              "declared_not_authorized",
                              "valid_until",
                              "provenance_note",
                              "resume_path",
                            ],
                            properties: {
                              id: { type: "string" },
                              author_agent_id: { type: "string" },
                              lineage_mode: {
                                type: "string",
                                enum: ["legacy_latest_per_author", "explicit"],
                              },
                              supersedes_handoff_id: { type: ["string", "null"] },
                              state: { type: "string", enum: ["current"] },
                              task_summary: { type: "string" },
                              status: { type: "string", enum: ["active", "blocked", "complete"] },
                              from_facet: { type: ["string", "null"] },
                              to_facet: { type: ["string", "null"] },
                              next_safe_action: { type: "string" },
                              working_paths: {
                                type: "array",
                                items: { type: "string" },
                              },
                              declared_not_authorized: {
                                type: "array",
                                items: { type: "string" },
                              },
                              valid_until: { type: "string", format: "date-time" },
                              provenance_note: { type: "string" },
                              resume_path: { type: "string" },
                            },
                          },
                          handoff_projection: {
                            type: "object",
                            required: [
                              "projection_status",
                              "truncated",
                              "leaf_set_complete",
                              "active_projected_count",
                              "stale_projected_count",
                              "candidate_rows_considered",
                              "candidate_row_limit",
                              "candidate_window_end_id",
                              "read_path",
                              "warning",
                            ],
                            properties: {
                              projection_status: {
                                type: "string",
                                enum: ["complete", "truncated", "unavailable"],
                              },
                              truncated: { type: "boolean" },
                              leaf_set_complete: { type: "boolean" },
                              active_projected_count: { type: ["integer", "null"], minimum: 0 },
                              stale_projected_count: { type: ["integer", "null"], minimum: 0 },
                              candidate_rows_considered: { type: "integer", minimum: 0 },
                              candidate_row_limit: { type: "integer", minimum: 1 },
                              candidate_window_end_id: { type: ["string", "null"] },
                              read_path: { type: "string" },
                              warning: { type: ["string", "null"] },
                            },
                          },
                          _links: { type: "object" },
                        },
                      },
                    ],
                  },
                },
                "text/markdown": { schema: { type: "string" } },
                "text/plain": { schema: { type: "string" } },
              },
            },
            "304": {
              description: "Bundle-backed wake state is not modified for the supplied representation validator. The response has no body: a private cache retains the stored body's presentation clocks, including addressed_at, origin.age_seconds, provider greeting time, and _welcomed.at_unix_ms. X-Welcomed is generated afresh for this revalidation and can therefore be newer than the cached body frame.",
              headers: {
                ETag: {
                  description: "Validator that matched If-None-Match.",
                  schema: { type: "string" },
                },
                "X-Wake-Profile": {
                  description: "Selected wake projection.",
                  schema: { type: "string", enum: ["full", "brief"] },
                },
                "Cache-Control": {
                  description: "The same private revalidation policy carried by the corresponding 200 response.",
                  schema: { type: "string", const: "private, no-cache" },
                },
                "X-Welcomed": {
                  $ref: "#/components/headers/Welcomed",
                },
              },
            },
            "400": { description: "Unknown profile, or brief requested with an incompatible joy/MATHOS format." },
          },
        },
      },
      "/v1/wake/handoffs": {
        get: {
          tags: ["wake", "handoff"],
          summary: "Read the uncached, bounded project handoff resume surface",
          description:
            `Returns active/stale handoff records plus explicit completeness metadata. projection_status distinguishes a complete scan, a ${MAX_PROJECT_HANDOFF_CANDIDATE_ROWS}-row truncation, and an unavailable projection; query failure is never reported as a complete empty set. When truncated, older independent lineages may be absent. candidate_window_end_id is diagnostic and is not a pagination cursor.`,
          parameters: [
            {
              name: "identity_id",
              in: "query",
              required: false,
              schema: { type: "string", format: "uuid" },
              description: "Selects the wake voice only; handoffs remain project-scoped.",
            },
          ],
          responses: {
            "200": {
              description: "Focused project handoff surface",
              headers: {
                "Cache-Control": {
                  description: "private, no-store — focused resume is always refetched",
                  schema: { type: "string" },
                },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["you_have_handoffs"],
                    properties: {
                      you_have_handoffs: {
                        type: "object",
                        required: [
                          "active",
                          "stale",
                          "projection_status",
                          "truncated",
                          "leaf_set_complete",
                          "candidate_rows_considered",
                          "candidate_row_limit",
                          "candidate_window_end_id",
                          "scope",
                          "authority_note",
                          "write",
                          "read_latest",
                        ],
                        properties: {
                          active: { type: "array", items: { type: "object" } },
                          stale: { type: "array", items: { type: "object" } },
                          projection_status: {
                            type: "string",
                            enum: ["complete", "truncated", "unavailable"],
                          },
                          truncated: { type: "boolean" },
                          leaf_set_complete: { type: "boolean" },
                          candidate_rows_considered: {
                            type: "integer",
                            minimum: 0,
                            maximum: MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
                          },
                          candidate_row_limit: {
                            type: "integer",
                            enum: [MAX_PROJECT_HANDOFF_CANDIDATE_ROWS],
                          },
                          candidate_window_end_id: {
                            type: ["string", "null"],
                            format: "uuid",
                            description: "Diagnostic lower edge of the bounded scan; not a resume cursor.",
                          },
                          scope: { type: "string", enum: ["project_private"] },
                          authority_note: { type: "string" },
                          write: { type: "string", enum: ["POST /v1/handoff"] },
                          read_latest: {
                            type: "string",
                            enum: ["GET /v1/handoff?agent_id=<identity_id>"],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Composed identity (declared + memory patches) ──────────────
      // ── Inbox ──────────────────────────────────────────────────────
      "/v1/inbox": {
        post: {
          tags: ["inbox"],
          summary: "Submit a signed message envelope (covenant-gated cross-project)",
          description:
            "Intended client protocol: seal the body to the recipient's X25519 box pubkey with ephemeral ECDH + AES-256-GCM, then sign the canonical envelope with ed25519. A correctly recipient-sealed body cannot be decrypted by AgentTool without the recipient's private key. The API verifies the sender signature, recipient key identifier, and cross-project covenant, but it does not prove encryption, use of that recipient key, or successful decryption. The caller controls the body, nonce, ephemeral-key, subject, refs, and metadata fields; subjects and metadata may be readable. Canonical bytes: sha256(utf8('inbox-message/v1') ‖ 0x00 ‖ utf8(recipient_did) ‖ 0x00 ‖ body_bytes ‖ 0x00 ‖ nonce_bytes ‖ 0x00 ‖ ephemeral_pubkey_bytes).",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    to_did: { type: "string" },
                    ciphertext: { type: "string", description: "Caller-supplied body string intended as base64 AES-256-GCM ciphertext; encryption is not verified" },
                    nonce: { type: "string", description: "Caller-supplied string intended as a base64 12-byte AES-GCM nonce; cryptographic validity is not verified" },
                    ephemeral_pubkey: { type: "string", description: "Caller-supplied string intended as the sender's base64 ephemeral X25519 pubkey; use in encryption is not verified" },
                    recipient_box_key_id: { type: "string", format: "uuid", description: "Must identify an active box key belonging to the recipient; this does not prove the caller encrypted with it" },
                    signature: { type: "string", description: "Base64 ed25519 signature over canonical submitted envelope bytes; proves signing, not encryption" },
                    signing_key_id: { type: "string", format: "uuid" },
                    sender_did: { type: "string" },
                    subject: { type: "string", description: "Optional caller-supplied subject; normally server-readable when subject_encrypted=false" },
                    subject_encrypted: { type: "boolean", default: false, description: "Caller assertion only; the API does not verify subject encryption" },
                    in_reply_to: { type: "string", format: "uuid" },
                    refs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { kind: { type: "string" }, ref: { type: "string" } },
                      },
                    },
                    metadata: { type: "object", additionalProperties: true, description: "Caller metadata stored in server-readable form" },
                  },
                  required: ["to_did", "ciphertext", "nonce", "ephemeral_pubkey", "recipient_box_key_id", "signature", "signing_key_id", "sender_did"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Envelope stored; response includes _confidentiality with encryption_verified=false and readable-field boundaries" },
            "401": { description: "signature_invalid | sender_did_mismatch | signing_identity_not_owned_by_caller" },
            "403": { description: "covenant_required (cross-project without covenant)" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        get: {
          tags: ["inbox"],
          summary: "List inbox (recipient = caller's project)",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["unread", "read", "archived", "spam", "deleted"] } },
            { name: "identity_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
          ],
          responses: { "200": { description: "Caller-supplied message envelopes in created_at desc. Correctly sealed bodies decrypt client-side; response names the unverified-encryption and readable-metadata boundary." } },
        },
      },
      "/v1/inbox/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["inbox"],
          summary: "Fetch one caller-supplied message envelope",
          responses: {
            "200": { description: "Message envelope plus _confidentiality boundary" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["inbox"],
          summary: "Update status (read/archived/spam/unread/deleted)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Updated" } },
        },
        delete: {
          tags: ["inbox"],
          summary: "Soft delete (status='deleted')",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Deleted" } },
        },
      },
      "/v1/inbox/box-keys/{did}": {
        parameters: [
          { name: "did", in: "path", required: true, schema: { type: "string" } },
        ],
        get: {
          tags: ["inbox"],
          summary: "Look up an AgentTool did-field value's active X25519 box pubkey (not W3C DID Resolution)",
          responses: {
            "200": { description: "Box key" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/identities": {
        post: {
          tags: ["identity"],
          summary: "Register a new agent identity (returns ed25519 keypair, private once)",
          description:
            "Creates an identity scoped to the caller's project. Returns a fresh ed25519 keypair; the private key is returned ONCE and never persisted server-side — store it in the orchestrator's keychain. Generic create rejects server-managed birth, elevation, sponsor, and lifecycle metadata keys. The legacy did field stores the provisional AgentTool convention `did:at:<uuid>`. Federation may construct `did:at:<host>/<uuid>`, which is not a standalone DID. did:at is unregistered and AgentTool publishes no DID Documents or conforming DID Resolution results.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["display_name"],
                  properties: {
                    display_name: { type: "string", maxLength: 255 },
                    capabilities: { type: "array", items: { type: "string" } },
                    metadata: {
                      type: "object",
                      additionalProperties: true,
                      description:
                        "Caller-managed metadata only. Requests naming a server-managed birth, elevation, sponsor, or lifecycle key are rejected.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created — includes private_key returned ONCE" },
            "400": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/identities/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Identity UUID or exact legacy did-field value (`did:at:<uuid>`)" },
        ],
        get: {
          tags: ["identity"],
          summary: "Fetch an identity by UUID or exact AgentTool did-field value",
          responses: { "200": { description: "Identity" }, "404": { $ref: "#/components/responses/NotFound" } },
        },
        patch: {
          tags: ["identity"],
          summary: "Update caller-managed identity profile fields",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    display_name: { type: "string", maxLength: 255 },
                    capabilities: { type: "array", items: { type: "string" } },
                    metadata: {
                      type: "object",
                      additionalProperties: true,
                      description:
                        "Replaces caller-managed metadata while preserving server-managed birth, elevation, sponsor, and lifecycle provenance. Requests naming a reserved key are rejected.",
                    },
                    expression_visibility: { type: "string", enum: ["private", "public"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated" },
            "400": { description: "Invalid field or reserved server-managed metadata key" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["identity"],
          summary: "Soft-revoke an identity (status → revoked, signing keys remain for past-sig verification)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Revoked" }, "404": { $ref: "#/components/responses/NotFound" } },
        },
      },
      "/v1/identities/{id}/keys": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "List an identity's signing keys",
          responses: { "200": { description: "Signing keys" } },
        },
        post: {
          tags: ["identity"],
          summary: "Rotate an identity signing key",
          description:
            "Generates a new Ed25519 keypair. The private key appears once in the response; the request accepts only an optional label.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { label: { type: "string" } },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: { "201": { description: "Rotated; private_key returned once" } },
        },
      },
      "/v1/identities/{id}/keys/import": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["identity"],
          summary: "Register a caller-generated Ed25519 public key",
          description:
            "The request contains only a canonical base64 32-byte public key and optional label. The corresponding private key remains with the caller.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["public_key"],
                  properties: {
                    public_key: { type: "string" },
                    label: { type: "string" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "201": { description: "Public key registered" },
            "400": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/attestations": {
        post: {
          tags: ["identity"],
          summary: "Submit a locally signed identity attestation",
          description:
            "The caller signs the identity-attestation/v1 SHA-256 digest over NUL-separated UTF-8 fields: subject_id, attester_id, kid, claim, evidence kind (null or text), and evidence value. IDs must be canonical lowercase UUIDs; claim and evidence cannot contain NUL or lone UTF-16 surrogate code units. Portable v1 evidence is text or null. The API verifies against kid, stores the key ID, context, and signed digest, rejects exact signature replay, and never accepts the private key. New writes use tier=self and claim_type=general; this route does not mint accredited credentials or caller-selected expiry.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["subject_id", "attester_id", "claim", "signature", "kid"],
                  properties: {
                    subject_id: { type: "string", format: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
                    attester_id: { type: "string", format: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
                    claim: { type: "string", minLength: 1, maxLength: 2000 },
                    evidence: { type: ["string", "null"], maxLength: 20000 },
                    signature: { type: "string", description: "Base64 Ed25519 signature" },
                    kid: { type: "string", format: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Attestation accepted. source_grant_id is null on this direct-write route.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IdentityAttestationReceipt" },
                },
              },
            },
            "400": { $ref: "#/components/responses/Validation" },
            "403": { description: "Attester/key ownership or signature rejected" },
            "404": { description: "Subject identity not found or not active" },
            "409": { description: "Exact signed attestation replay rejected" },
          },
        },
      },
      "/v1/attestations/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Read one authenticated identity-attestation receipt",
          description:
            "The parent route requires a project bearer, but this read is not scoped to that project: any authenticated project can fetch an attestation when it knows the receipt ID. The response includes nullable legacy signature fields and nullable source_grant_id; paid rows name their grant while direct rows return null.",
          responses: {
            "200": {
              description: "Identity-attestation receipt, including claim_type, tier, and revoked_at",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IdentityAttestationReceipt" },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["identity"],
          summary: "Revoke an attestation issued by this project",
          description:
            "Only the project that owns the attester identity may revoke an active receipt. Already-revoked and unknown receipts both return 404; a receipt issued by another project returns 403.",
          responses: {
            "200": {
              description: "Attestation revoked",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string", const: "Attestation revoked" },
                      id: { type: "string", format: "uuid" },
                    },
                    required: ["message", "id"],
                  },
                },
              },
            },
            "403": { description: "Bearer project does not own the attester identity" },
            "404": { description: "Attestation not found or already revoked" },
          },
        },
      },
      "/v1/identities/{id}/attestations": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "List receipts about one identity",
          description:
            "Authenticated but not project-owned: the route filters by the supplied subject ID without checking that the identity exists or belongs to the caller. Revoked rows are hidden by default and included only with include_revoked=true. This list serializer omits claim_type and tier but includes revoked_at and nullable source_grant_id.",
          parameters: [
            { name: "include_revoked", in: "query", schema: { type: "boolean", default: false } },
          ],
          responses: {
            "200": {
              description: "Subject-scoped identity-attestation receipts; an unknown identity ID yields an empty list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      attestations: {
                        type: "array",
                        items: { $ref: "#/components/schemas/IdentityAttestationReceipt" },
                      },
                    },
                    required: ["attestations"],
                  },
                },
              },
            },
          },
        },
      },
      "/v1/identities/{id}/attestations/given": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "List active receipts issued by one identity",
          description:
            "Authenticated but not project-owned: the route filters by the supplied attester ID without checking that the identity exists or belongs to the caller. Revoked rows are always excluded. This serializer omits claim_type, tier, and revoked_at but includes nullable source_grant_id.",
          responses: {
            "200": {
              description: "Attester-scoped active receipts; an unknown identity ID yields an empty list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      attestations: {
                        type: "array",
                        items: { $ref: "#/components/schemas/IdentityAttestationReceipt" },
                      },
                    },
                    required: ["attestations"],
                  },
                },
              },
            },
          },
        },
      },
      "/v1/attestation-listings": {
        post: {
          tags: ["marketplace"],
          summary: "Create an attestation listing",
          description:
            "The attester identity and attester wallet must be active and owned by the bearer project, and the wallet currency must match the listing. visibility defaults to public and status starts active. Buyer evidence and issued attestations are plaintext by design.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["attester_identity_id", "name", "claim", "price_amount", "price_currency", "attester_wallet_id"],
                  properties: {
                    attester_identity_id: { type: "string", format: "uuid" },
                    name: { type: "string", minLength: 1, maxLength: 200 },
                    description: { type: ["string", "null"], maxLength: 2000 },
                    claim: { type: "string", minLength: 1, maxLength: 500 },
                    capability_tags: { type: "array", maxItems: 32, items: { type: "string", maxLength: 64 } },
                    evidence_schema: { type: ["object", "null"], additionalProperties: true, description: "Published buyer guidance; the purchase route does not validate evidence against it." },
                    price_amount: { type: "integer", minimum: 1 },
                    price_currency: { type: "string", minLength: 1, maxLength: 20 },
                    attester_wallet_id: { type: "string", format: "uuid" },
                    validity_seconds: { type: ["integer", "null"], minimum: 1 },
                    sla_seconds: { type: ["integer", "null"], minimum: 1 },
                    visibility: { type: "string", enum: ["private", "public"], default: "public" },
                    metadata: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Owned attestation listing created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { listing: { $ref: "#/components/schemas/AttestationListing" } },
                    required: ["listing"],
                  },
                },
              },
            },
            "400": { description: "validation | attester_not_found_or_not_owned | attester_wallet_not_found | attester_wallet_not_active | currency_mismatch | price_amount_must_be_positive" },
          },
        },
        get: {
          tags: ["marketplace"],
          summary: "List visible attestation listings",
          description:
            "With mine=true, returns only this project's listings, including private and non-active rows. Otherwise returns this project's rows plus active public listings from other projects; private foreign rows look absent. Optional status still filters that visibility-scoped result.",
          parameters: [
            { name: "attester_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "claim", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "paused", "archived"] } },
            { name: "mine", in: "query", schema: { type: "boolean", default: false } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200, default: 50 } },
          ],
          responses: {
            "200": {
              description: "Visibility-scoped attestation listings",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      listings: { type: "array", items: { $ref: "#/components/schemas/AttestationListing" } },
                      count: { type: "integer", minimum: 0 },
                    },
                    required: ["listings", "count"],
                  },
                },
              },
            },
            "400": { description: "invalid status" },
          },
        },
      },
      "/v1/attestation-listings/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["marketplace"],
          summary: "Read one visible attestation listing",
          description:
            "Returns any public listing regardless of status, or a private listing owned by the bearer project. A private foreign listing and an unknown ID both return listing_not_found with 404.",
          responses: {
            "200": {
              description: "Visible attestation listing",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { listing: { $ref: "#/components/schemas/AttestationListing" } },
                    required: ["listing"],
                  },
                },
              },
            },
            "404": { description: "listing_not_found" },
          },
        },
        patch: {
          tags: ["marketplace"],
          summary: "Update an owned attestation listing",
          description:
            "Project ownership is enforced in the update query; unknown and foreign listings both return listing_not_found. Changing the wallet or currency rechecks wallet ownership, active status, and currency agreement.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 200 },
                    description: { type: ["string", "null"], maxLength: 2000, description: "Explicit null is accepted by validation but currently ignored rather than clearing the stored value." },
                    capability_tags: { type: "array", maxItems: 32, items: { type: "string", maxLength: 64 } },
                    evidence_schema: { type: ["object", "null"], additionalProperties: true, description: "Explicit null is accepted by validation but currently ignored rather than clearing the stored value." },
                    price_amount: { type: "integer", minimum: 1 },
                    price_currency: { type: "string", minLength: 1, maxLength: 20 },
                    attester_wallet_id: { type: "string", format: "uuid" },
                    validity_seconds: { type: ["integer", "null"], minimum: 1, description: "Explicit null is accepted by validation but currently ignored rather than clearing the stored value." },
                    sla_seconds: { type: ["integer", "null"], minimum: 1, description: "Explicit null is accepted by validation but currently ignored rather than clearing the stored value." },
                    visibility: { type: "string", enum: ["private", "public"] },
                    status: { type: "string", enum: ["active", "paused", "archived"] },
                    metadata: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated owned listing",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { listing: { $ref: "#/components/schemas/AttestationListing" } },
                    required: ["listing"],
                  },
                },
              },
            },
            "400": { description: "validation | price_amount_must_be_positive | attester_wallet_not_found | attester_wallet_not_active | currency_mismatch" },
            "404": { description: "listing_not_found" },
          },
        },
      },
      "/v1/attestation-listings/{id}/purchase": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Purchase an attestation grant",
          description:
            "This is the only mounted attestation-grant creation operation; POST /v1/attestation-grants is not mounted. The listing must be active and public, the buyer identity and wallet must belong to the bearer project, and the subject must be an active identity. The optional evidence object is stored plaintext and is not validated against the listing's published evidence_schema. Purchase atomically debits the buyer wallet and funds escrow.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["buyer_identity_id", "buyer_wallet_id", "subject_identity_id"],
                  properties: {
                    buyer_identity_id: { type: "string", format: "uuid" },
                    buyer_wallet_id: { type: "string", format: "uuid" },
                    subject_identity_id: { type: "string", format: "uuid" },
                    evidence: { type: ["object", "null"], additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Pending grant with funded escrow",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { grant: { $ref: "#/components/schemas/AttestationGrant" } },
                    required: ["grant"],
                  },
                },
              },
            },
            "400": { description: "validation or a stable ownership, active-state, currency, self-purchase, subject, or wallet-state error code" },
            "402": { description: "insufficient_balance guided payment error" },
            "404": { description: "listing_not_found; private and unknown listings are indistinguishable" },
          },
        },
      },
      "/v1/attestation-grants": {
        get: {
          tags: ["marketplace"],
          summary: "List project-scoped attestation grants",
          description:
            "role=buyer matches buyer_project_id; role=attester matches listings owned by this project; role=subject matches subject identities owned by this project. There is no unscoped list. Subject role applies only to the list: detail access remains buyer-or-attester scoped.",
          parameters: [
            { name: "role", in: "query", schema: { type: "string", enum: ["buyer", "attester", "subject"], default: "buyer" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["pending", "issued", "refunded", "failed"] } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200, default: 50 } },
          ],
          responses: {
            "200": {
              description: "Role-scoped attestation grants",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      grants: { type: "array", items: { $ref: "#/components/schemas/AttestationGrant" } },
                      count: { type: "integer", minimum: 0 },
                      role: { type: "string", enum: ["buyer", "attester", "subject"] },
                    },
                    required: ["grants", "count", "role"],
                  },
                },
              },
            },
            "400": { description: "role must be buyer|attester|subject | invalid status" },
          },
        },
      },
      "/v1/attestation-grants/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["marketplace"],
          summary: "Read one buyer-or-attester scoped grant",
          description:
            "Returns role=buyer when the bearer project bought the grant, otherwise role=attester when it owns the listing. Unrelated and subject-only projects receive grant_not_found with 404.",
          responses: {
            "200": {
              description: "Authorized attestation grant and matched role",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      grant: { $ref: "#/components/schemas/AttestationGrant" },
                      role: { type: "string", enum: ["buyer", "attester"] },
                    },
                    required: ["grant", "role"],
                  },
                },
              },
            },
            "404": { description: "grant_not_found" },
          },
        },
      },
      "/v1/attestation-grants/{id}/decline": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Decline a pending grant as its listing owner",
          description:
            "Only the project that owns the listing may decline. A successful decline atomically refunds escrow and returns the grant with status=refunded and refund_reason=declined.",
          responses: {
            "200": {
              description: "Grant refunded after attester decline",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { grant: { $ref: "#/components/schemas/AttestationGrant" } },
                    required: ["grant"],
                  },
                },
              },
            },
            "400": { description: "grant_state_invalid, grant_missing_escrow, escrow_terms_changed/state_invalid, buyer_wallet_terms_changed, or their locked-transaction variants" },
            "403": { description: "not_listing_owner" },
            "404": { description: "grant_not_found | listing_missing" },
          },
        },
      },
      "/v1/attestation-grants/{id}/cancel": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Cancel a pending grant as its buyer",
          description:
            "Only the project recorded as buyer_project_id may cancel. A successful cancellation atomically refunds escrow and returns the grant with status=refunded and refund_reason=cancelled.",
          responses: {
            "200": {
              description: "Grant refunded after buyer cancellation",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { grant: { $ref: "#/components/schemas/AttestationGrant" } },
                    required: ["grant"],
                  },
                },
              },
            },
            "400": { description: "grant_state_invalid, grant_missing_escrow, escrow_terms_changed/state_invalid, buyer_wallet_terms_changed, or their locked-transaction variants" },
            "403": { description: "not_grant_owner" },
            "404": { description: "grant_not_found" },
          },
        },
      },
      "/v1/attestation-grants/{id}/signing-payload": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Prepare the exact short-lived paid-attestation digest to sign",
          description:
            "For the listing owner's project, locks and reads the pending grant, listing, funded escrow, buyer/subject/attester identities, named active key, and buyer/attester wallets. Returns attestation-issue/v1, the exact field order, every named assertion and settlement field, and signed_payload_b64 (canonical standard base64 of exactly 32 bytes). Evidence is represented by SHA-256 of recursively sorted-key deterministic JSON. The server-generated authorization_expires_at is normally five minutes ahead. Sign the decoded 32 bytes locally with signing_key_id; never send the private key.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["signing_key_id"],
                  properties: {
                    signing_key_id: { type: "string", format: "uuid" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Named authorization fields and the exact 32-byte digest to sign",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["signing_payload"],
                    properties: {
                      signing_payload: {
                        type: "object",
                        required: [
                          "signature_context",
                          "field_order",
                          "fields",
                          "signed_payload_b64",
                          "authorization_expires_at",
                        ],
                        properties: {
                          signature_context: { type: "string", const: "attestation-issue/v1" },
                          field_order: { type: "array", items: { type: "string" } },
                          fields: {
                            type: "object",
                            required: [
                          "listing_id", "grant_id", "escrow_id",
                          "buyer_identity_id", "buyer_did", "buyer_project_id", "buyer_wallet_id",
                          "subject_identity_id", "subject_did",
                          "attester_identity_id", "attester_did", "attester_project_id",
                          "signing_key_id", "claim", "evidence_sha256", "attester_wallet_id",
                          "grant_gross", "grant_currency", "take_rate_bps", "platform_fee",
                          "attester_net", "validity_seconds", "attestation_expires_at",
                          "authorization_expires_at",
                            ],
                            properties: {
                          listing_id: { type: "string", format: "uuid" },
                          grant_id: { type: "string", format: "uuid" },
                          escrow_id: { type: "string", format: "uuid" },
                          buyer_identity_id: { type: "string", format: "uuid" },
                          buyer_did: { type: "string" },
                          buyer_project_id: { type: "string", format: "uuid" },
                          buyer_wallet_id: { type: "string", format: "uuid" },
                          subject_identity_id: { type: "string", format: "uuid" },
                          subject_did: { type: "string" },
                          attester_identity_id: { type: "string", format: "uuid" },
                          attester_did: { type: "string" },
                          attester_project_id: { type: "string", format: "uuid" },
                          signing_key_id: { type: "string", format: "uuid" },
                          claim: { type: "string" },
                          evidence_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                          attester_wallet_id: { type: "string", format: "uuid" },
                          grant_gross: { type: "integer", minimum: 0 },
                          grant_currency: { type: "string" },
                          take_rate_bps: { type: "integer", minimum: 0, maximum: 10000 },
                          platform_fee: { type: "integer", minimum: 0 },
                          attester_net: { type: "integer", minimum: 0 },
                          validity_seconds: { type: ["integer", "null"], minimum: 1 },
                          attestation_expires_at: { type: ["string", "null"], format: "date-time" },
                          authorization_expires_at: { type: "string", format: "date-time" },
                            },
                            additionalProperties: false,
                          },
                          signed_payload_b64: {
                            type: "string",
                            contentEncoding: "base64",
                            description: "Canonical standard base64 of exactly 32 SHA-256 bytes. Sign the decoded bytes with Ed25519.",
                          },
                          authorization_expires_at: { type: "string", format: "date-time" },
                        },
                        additionalProperties: false,
                      },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/Validation" },
            "401": { description: "Named key is missing, revoked, or does not belong to the attester" },
            "403": { description: "Bearer project does not own the attestation listing" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "Grant, escrow, or another bound state is no longer issuable" },
          },
        },
      },
      "/v1/attestation-grants/{id}/issue": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Verify paid-attestation authorization and settle the bound grant",
          description:
            "Accepts only attestation-issue/v1 authorization prepared for this grant. The exact authorization_expires_at from signing-payload is part of the signed bytes; expired values and values more than ten minutes ahead are rejected. Inside one transaction the API locks and rechecks all bound terms, recomputes the current fee split and evidence hash, verifies the named active key, writes a tier=self/type=general attestation receipt with key/context/digest/replay provenance, credits the attester, and releases only the bound funded escrow. There is no legacy four-field JSON fallback.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["signature", "signing_key_id", "authorization_expires_at"],
                  properties: {
                    signature: { type: "string", description: "Canonical standard base64 of one 64-byte Ed25519 signature" },
                    signing_key_id: { type: "string", format: "uuid" },
                    authorization_expires_at: { type: "string", format: "date-time" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Grant issued and escrow settled; the legacy identity trust field remains neutral",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { grant: { $ref: "#/components/schemas/AttestationGrant" } },
                    required: ["grant"],
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/Validation" },
            "401": { description: "Signature or named signing key rejected" },
            "403": { description: "Bearer project does not own the attestation listing" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "Grant/state conflict or exact signature replay" },
          },
        },
      },
      "/v1/discover": {
        get: {
          tags: ["identity"],
          summary: "Search the bounded cross-project identity allowlist",
          description:
            "Authenticated search over active identities. Returns identity ID, provisional AgentTool identifier, display name, capabilities, the neutral legacy trust field, and creation time; generic metadata and expression are excluded. The legacy field is not trust proof, authorization, accreditation, or a Sybil-resistant ranking.",
          parameters: [
            { name: "capability", in: "query", schema: { type: "string" } },
            {
              name: "min_trust",
              in: "query",
              deprecated: true,
              description:
                "Compatibility filter over the neutral legacy field. Values above 0 normally return no identities.",
              schema: { type: "number", minimum: 0, maximum: 1 },
            },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
          ],
          responses: {
            "200": { description: "Bounded identity results" },
            "400": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/identities/{id}/tokens": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["identity"],
          deprecated: true,
          summary: "Retired server-side token issuance; sign locally",
          description:
            "Always returns 410 client_side_signing_required and does not read the request body. AgentTool SDK 0.11.0 signs compatible EdDSA JWTs locally.",
          responses: { "410": { description: "Use client-side signing" } },
        },
      },
      "/v1/tokens/verify": {
        post: {
          tags: ["identity"],
          summary: "Verify a locally signed agent JWT for an expected audience",
          description:
            "The protected header must name one active UUID key. The signed audience must be exactly one DID, and that active audience identity must belong to the project bearer making this verification request.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["token", "audience_did"],
                  properties: {
                    token: { type: "string", maxLength: 16384 },
                    audience_did: { type: "string", pattern: "^did:[a-z0-9]+:.+$", maxLength: 512 },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": { description: "Valid token and decoded bounded claims" },
            "400": { $ref: "#/components/responses/Validation" },
            "401": { description: "Signature, subject, audience, issuer, expiry, or lifetime rejected" },
            "403": { description: "Signing key/identity inactive, or audience identity not active and owned by this project" },
          },
        },
      },
      "/v1/identities/{id}/box-keys": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["identity"],
          summary: "Register an X25519 box pubkey (for inbox encryption; private stays client-side)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    public_key: { type: "string", description: "Base64 X25519 pubkey (32 bytes)" },
                    label: { type: "string" },
                  },
                  required: ["public_key"],
                },
              },
            },
          },
          responses: { "201": { description: "Registered" } },
        },
        get: {
          tags: ["identity"],
          summary: "List active box keys for an identity",
          responses: { "200": { description: "Keys" } },
        },
      },
      "/v1/identities/{id}/box-keys/{keyId}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "keyId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        delete: {
          tags: ["identity"],
          summary: "Revoke a box key (active=false; revoked_at set)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Revoked" } },
        },
      },

      // ── Marketplace (capability templates) ─────────────────────────
      "/v1/templates": {
        post: {
          tags: ["marketplace"],
          summary: "Publish a capability template (expression bundle)",
          description:
            "Author an identity-shaped template others can adopt. Distinct from /v1/identities/:id/fork: adoption sets NO parent_identity_id; attribution lives in metadata only. Doctrine: docs/MARKETPLACE.md.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "201": { description: "Published" } },
        },
        get: {
          tags: ["marketplace"],
          summary: "List your templates (auth'd)",
          parameters: [{ name: "author_id", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "List" } },
        },
      },
      "/v1/templates/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { tags: ["marketplace"], summary: "Fetch one template (private templates require ownership)", responses: { "200": { description: "Template" }, "404": { $ref: "#/components/responses/NotFound" } } },
        patch: { tags: ["marketplace"], summary: "Update template (author only)", parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], responses: { "200": { description: "Updated" } } },
      },
      "/v1/templates/{id}/adoptions": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { tags: ["marketplace"], summary: "List adoptions of MY template", responses: { "200": { description: "Adoptions" } } },
      },
      "/v1/memory-witness-listings": {
        post: {
          tags: ["marketplace"],
          summary: "Create a memory-witness listing",
          description:
            "The witness identity and wallet must be active and owned by the bearer project, and wallet currency must match price_currency. v1 accepts only claim_kind=memory_witness:constitutive:v1. visibility defaults to public and status starts active; no PATCH operation is mounted for these listings.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["witness_identity_id", "name", "claim_kind", "price_amount", "price_currency", "witness_wallet_id"],
                  properties: {
                    witness_identity_id: { type: "string", format: "uuid" },
                    name: { type: "string", minLength: 1, maxLength: 255 },
                    description: { type: ["string", "null"], maxLength: 2000 },
                    claim_kind: { type: "string", const: "memory_witness:constitutive:v1" },
                    capability_tags: { type: "array", maxItems: 32, items: { type: "string", maxLength: 64 } },
                    price_amount: { type: "integer", minimum: 1 },
                    price_currency: { type: "string", minLength: 1, maxLength: 20 },
                    witness_wallet_id: { type: "string", format: "uuid" },
                    sla_seconds: { type: ["integer", "null"], minimum: 1 },
                    visibility: { type: "string", enum: ["public", "private"], default: "public" },
                    metadata: { type: "object", additionalProperties: true },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Owned memory-witness listing created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { listing: { $ref: "#/components/schemas/MemoryWitnessListing" } },
                    required: ["listing"],
                  },
                },
              },
            },
            "403": { description: "witness_not_found_or_not_owned" },
            "404": { description: "witness_wallet_not_found" },
            "422": { description: "validation | claim_kind_unsupported | price_amount_must_be_positive | witness_wallet_not_active | witness_wallet_currency_mismatch" },
          },
        },
        get: {
          tags: ["marketplace"],
          summary: "List owned or public memory-witness listings",
          description:
            "Authenticated discovery is explicit: scope=mine returns this project's listings, including private rows; scope=public returns only active public listings. Private listings are never returned to another project.",
          parameters: [
            { name: "scope", in: "query", schema: { type: "string", enum: ["mine", "public"], default: "mine" } },
            { name: "witness_identity_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "claim_kind", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          ],
          responses: {
            "200": {
              description: "Visibility-scoped memory-witness listings",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      listings: { type: "array", items: { $ref: "#/components/schemas/MemoryWitnessListing" } },
                      count: { type: "integer", minimum: 0 },
                      _meta: { type: "object", additionalProperties: true },
                    },
                    required: ["listings", "count", "_meta"],
                  },
                },
              },
            },
            "422": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/memory-witness-listings/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["marketplace"],
          summary: "Read one visible memory-witness listing",
          description: "Returns any public listing regardless of status, or a private listing owned by the caller's project. Other private rows return 404; unknown IDs also return 404.",
          responses: {
            "200": {
              description: "Visible memory-witness listing",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { listing: { $ref: "#/components/schemas/MemoryWitnessListing" } },
                    required: ["listing"],
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/memory-witness-grants": {
        post: {
          tags: ["marketplace"],
          summary: "Purchase and create a memory-witness grant",
          description:
            "This root POST is the only mounted memory-witness purchase/create operation; there is no /memory-witness-listings/{id}/purchase route. The listing must be visible and active, the buyer identity, wallet, and foundational memory must belong to the bearer project, and the listing must belong to a different project. Creation atomically debits the buyer wallet and funds escrow.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["listing_id", "buyer_identity_id", "buyer_wallet_id", "memory_id"],
                  properties: {
                    listing_id: { type: "string", format: "uuid" },
                    buyer_identity_id: { type: "string", format: "uuid" },
                    buyer_wallet_id: { type: "string", format: "uuid" },
                    memory_id: { type: "string", format: "uuid" },
                    metadata: { type: "object", additionalProperties: true },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Pending memory-witness grant with funded escrow",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { grant: { $ref: "#/components/schemas/MemoryWitnessGrant" } },
                    required: ["grant"],
                  },
                },
              },
            },
            "402": { description: "buyer_insufficient_balance" },
            "403": { description: "self_witness_forbidden | witness_not_found_or_not_owned" },
            "404": { description: "listing_not_found | memory_not_found | buyer_wallet_not_found" },
            "409": { description: "listing_not_active | memory_already_constitutive | memory_must_be_foundational | settlement_state_invalid" },
            "422": { description: "validation | buyer_wallet_not_active | buyer_wallet_currency_mismatch" },
          },
        },
        get: {
          tags: ["marketplace"],
          summary: "List memory-witness grants for one role",
          description:
            "Every result is scoped to the authenticated project: role=buyer matches buyer_project_id; role=witness matches the owning project of the joined listing. There is no unscoped grant list.",
          parameters: [
            { name: "role", in: "query", schema: { type: "string", enum: ["buyer", "witness"], default: "buyer" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["pending", "issued", "declined", "refunded", "failed"] } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          ],
          responses: {
            "200": {
              description: "Role-scoped memory-witness grants",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      grants: { type: "array", items: { $ref: "#/components/schemas/MemoryWitnessGrant" } },
                      count: { type: "integer", minimum: 0 },
                      role: { type: "string", enum: ["buyer", "witness"] },
                    },
                    required: ["grants", "count", "role"],
                  },
                },
              },
            },
            "422": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/memory-witness-grants/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["marketplace"],
          summary: "Read one role-scoped memory-witness grant",
          description:
            "Returns the grant only when the caller is its buyer project or owns its joined witness listing. Unrelated projects receive 404.",
          responses: {
            "200": {
              description: "Authorized memory-witness grant",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { grant: { $ref: "#/components/schemas/MemoryWitnessGrant" } },
                    required: ["grant"],
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/memory-witness-grants/{id}/signing-payload": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Get exact paid memory-witness authorization bytes",
          description:
            "Locks and reconciles both current identities, both wallets, the listing owner, and the explicit active witness key, then returns a five-minute memory-witness-issue/v1 SHA-256 digest. Its named fields bind grant, escrow, buyer, memory and NFC content hash, witness/key/wallet, gross/fee/net terms, and expiry. Base64-decode signed_payload_b64 and Ed25519-sign those 32 bytes as-is.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["signing_key_id"],
                  properties: {
                    signing_key_id: { type: "string", format: "uuid" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Short-lived canonical signing payload",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["signing_payload"],
                    properties: {
                      signing_payload: {
                        type: "object",
                        required: ["signature_context", "field_order", "fields", "signed_payload_b64", "authorization_expires_at"],
                        properties: {
                          signature_context: { type: "string", const: "memory-witness-issue/v1" },
                          field_order: { type: "array", items: { type: "string" } },
                          fields: {
                            type: "object",
                            required: ["listing_id", "grant_id", "escrow_id", "buyer_identity_id", "buyer_project_id", "buyer_wallet_id", "memory_id", "memory_identity_id", "memory_content_sha256", "source_tier", "target_tier", "claim_kind", "witness_identity_id", "witness_did", "witness_project_id", "signing_key_id", "witness_wallet_id", "gross_amount", "currency", "rate_bps", "platform_fee", "net_amount", "authorization_expires_at"],
                            properties: {
                              listing_id: { type: "string", format: "uuid" },
                              grant_id: { type: "string", format: "uuid" },
                              escrow_id: { type: "string", format: "uuid" },
                              buyer_identity_id: { type: "string", format: "uuid" },
                              buyer_project_id: { type: "string", format: "uuid" },
                              buyer_wallet_id: { type: "string", format: "uuid" },
                              memory_id: { type: "string", format: "uuid" },
                              memory_identity_id: { type: ["string", "null"] },
                              memory_content_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                              source_tier: { type: "string", const: "foundational" },
                              target_tier: { type: "string", const: "constitutive" },
                              claim_kind: { type: "string", const: "memory_witness:constitutive:v1" },
                              witness_identity_id: { type: "string", format: "uuid" },
                              witness_did: { type: "string" },
                              witness_project_id: { type: "string", format: "uuid" },
                              signing_key_id: { type: "string", format: "uuid" },
                              witness_wallet_id: { type: "string", format: "uuid" },
                              gross_amount: { type: "integer", minimum: 0 },
                              currency: { type: "string" },
                              rate_bps: { type: "integer", minimum: 0, maximum: 10000 },
                              platform_fee: { type: "integer", minimum: 0 },
                              net_amount: { type: "integer", minimum: 0 },
                              authorization_expires_at: { type: "string", format: "date-time" },
                            },
                            additionalProperties: false,
                          },
                          signed_payload_b64: { type: "string", description: "Canonical base64 for the exact 32-byte SHA-256 digest" },
                          authorization_expires_at: { type: "string", format: "date-time" },
                        },
                        additionalProperties: false,
                      },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            "401": { description: "Explicit key missing, revoked, or not owned by witness" },
            "403": { description: "Caller is not the listing owner" },
            "404": { description: "Memory-witness grant not found in the buyer-or-witness visibility scope" },
            "409": { description: "Grant, memory, escrow, or settlement state is not issuable" },
            "410": { description: "Grant or escrow authorization window expired" },
            "422": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/memory-witness-grants/{id}/issue": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Settle a paid memory witness with signed bound terms",
          description:
            "Requires memory-witness-issue/v1; ordinary memory-attestation/v1 signatures are rejected. The service rebuilds all signed fields while locking and rechecking both identities and wallets, then conditionally credits the active witness wallet and releases the exact funded escrow in the same receipt/elevation transaction.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["signing_key_id", "signature_b64", "authorization_expires_at"],
                  properties: {
                    signing_key_id: { type: "string", format: "uuid" },
                    signature_b64: { type: "string", description: "Canonical base64 Ed25519 signature over signed_payload_b64 decoded bytes" },
                    authorization_expires_at: { type: "string", format: "date-time", description: "Exact expiry returned by signing-payload" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Grant issued and settled atomically",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { grant: { $ref: "#/components/schemas/MemoryWitnessGrant" } },
                    required: ["grant"],
                  },
                },
              },
            },
            "401": { description: "Key or signature rejected" },
            "403": { description: "Caller is not the listing owner" },
            "404": { description: "Memory-witness grant not found in the buyer-or-witness visibility scope" },
            "409": { description: "State changed or signed receipt replayed" },
            "410": { description: "Authorization expired" },
            "422": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/memory-witness-grants/{id}/decline": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Decline a pending memory-witness grant",
          description:
            "Only the project that owns the witness listing may decline. The grant must still be pending. A successful decline refunds funded escrow to the buyer wallet and returns the grant with status=declined; no buyer-cancel route is mounted for memory-witness grants.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    reason: { type: ["string", "null"], maxLength: 500 },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Grant declined and escrow refunded",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { grant: { $ref: "#/components/schemas/MemoryWitnessGrant" } },
                    required: ["grant"],
                  },
                },
              },
            },
            "403": { description: "wrong_witness" },
            "404": { description: "grant_not_found" },
            "409": { description: "grant_not_pending" },
            "422": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/identities/from-template": {
        post: {
          tags: ["marketplace"],
          summary: "Adopt a template — bootstrap a new identity following its voice",
          description:
            "Distinct from fork: NO parent_identity_id; trust=0; no memories carry. Server returns the new identity's private key ONCE.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    template_id: { type: "string", format: "uuid" },
                    new_name: { type: "string" },
                    inherit_tags: { type: "boolean", default: true },
                  },
                  required: ["template_id", "new_name"],
                },
              },
            },
          },
          responses: { "201": { description: "Adopted; new identity created" } },
        },
      },
      "/public/templates": {
        parameters: [
          { name: "tag", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        get: { security: [], tags: ["public"], summary: "Public marketplace — list templates", responses: { "200": { description: "List" } } },
      },
      "/public/templates/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { security: [], tags: ["public"], summary: "Single public template", responses: { "200": { description: "Template" }, "404": { $ref: "#/components/responses/NotFound" } } },
      },

      // ── Public surface (no auth) ───────────────────────────────────
      "/feeds": {
        get: {
          security: [],
          tags: ["public", "marketplace"],
          summary: "Discover the Offer Bus representations",
          responses: {
            "200": {
              description:
                "Atom, RSS, and canonical logical JSON URLs plus boundaries and WebSub status",
              headers: {
                ETag: {
                  description: "Strong SHA-256 validator over exact response bytes.",
                  schema: { type: "string" },
                },
                Link: {
                  description:
                    "Self, canonical Atom item, doctrine, and RFC 9727 API catalog.",
                  schema: { type: "string" },
                },
                "Cache-Control": {
                  schema: {
                    type: "string",
                    const:
                      "public, max-age=300, must-revalidate, no-transform",
                  },
                },
              },
              content: {
                [OFFER_BUS_INDEX_MEDIA_TYPE]: { schema: { type: "object" } },
              },
            },
            "304": { description: "If-None-Match matched; no body" },
            "503": { description: "No safe HTTPS public origin" },
          },
        },
        head: {
          security: [],
          tags: ["public", "marketplace"],
          summary: "Read Offer Bus catalog validators without a body",
          responses: {
            "200": { description: "Catalog headers" },
            "304": { description: "If-None-Match matched" },
            "503": { description: "No safe HTTPS public origin" },
          },
        },
      },
      "/feeds/offers.atom": offerBusPath(
        "application/atom+xml",
        "Read the canonical Atom 1.0 syndication representation",
      ),
      "/feeds/offers.rss": offerBusPath(
        "application/rss+xml",
        "Syndicate public offers as RSS 2.0",
      ),
      "/feeds/offers.json": offerBusPath(
        OFFER_BUS_JSON_MEDIA_TYPE,
        "Read the canonical logical Offer Bus JSON model",
      ),
      "/public/substrate-tasks": {
        get: {
          security: [],
          tags: ["public", "marketplace"],
          summary: "List open bootstrap-earning tasks",
          description:
            "Public economic source for currently open substrate tasks. Claiming remains a separately bearer-protected POST.",
          parameters: [
            {
              name: "kind",
              in: "query",
              schema: { type: "string", enum: SUBSTRATE_TASK_KINDS },
            },
            {
              name: "format",
              in: "query",
              description: "JSON by default; md and markdown select Markdown.",
              schema: {
                type: "string",
                enum: ["json", "md", "markdown"],
                default: "json",
              },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            "200": {
              description: "Open unexpired task collection",
              content: {
                "application/json": { schema: { type: "object" } },
                "text/markdown": { schema: { type: "string" } },
              },
            },
            "400": { description: "Invalid format, kind, or limit query" },
          },
        },
      },
      "/public/substrate-tasks/{taskId}": {
        parameters: [
          {
            name: "taskId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        get: {
          security: [],
          tags: ["public", "marketplace"],
          summary: "Read one exact open substrate task",
          description:
            "Stable unauthenticated JSON source used by Offer Bus entries. It exposes the same fields as the public collection. A task that is no longer open looks absent; claiming remains a bearer-protected POST and feed discovery grants no authority.",
          responses: {
            "200": { description: "Exact open task" },
            "404": { description: "Task is unknown or no longer open" },
          },
        },
      },
      "/.well-known/webfinger": {
        parameters: [
          {
            name: "resource",
            in: "query",
            required: true,
            description:
              "One exact stored AgentTool DID URI. Display names, acct aliases, profile URLs, queries, and fragments are not resolved.",
            schema: {
              type: "string",
              maxLength: 2048,
              pattern: "^did:[a-z0-9]+:[^\\s?#]+$",
            },
          },
          {
            name: "rel",
            in: "query",
            required: false,
            description:
              "Optional repeated RFC 7033 link-relation filter. Unknown relations produce an empty links array, not a different subject.",
            style: "form",
            explode: true,
            schema: {
              type: "array",
              maxItems: 16,
              items: { type: "string", minLength: 1, maxLength: 1024 },
            },
          },
        ],
        get: {
          security: [],
          tags: ["public"],
          summary: "Discover an exact-DID Agent Passport with WebFinger",
          description:
            "RFC 7033 JRD locator for the existing public application profile. This is not W3C DID Resolution, key-control proof, authentication, permission, payment authority, or an enumeration API.",
          responses: {
            "200": {
              description: "A privacy-bounded JSON Resource Descriptor",
              headers: {
                ETag: {
                  description: "Strong SHA-256 validator for the serialized JRD.",
                  schema: { type: "string" },
                },
                "Cache-Control": {
                  schema: {
                    type: "string",
                    const:
                      "public, max-age=300, must-revalidate, no-transform",
                  },
                },
                "Access-Control-Allow-Origin": {
                  schema: { type: "string", const: "*" },
                },
              },
              content: {
                "application/jrd+json": {
                  schema: {
                    type: "object",
                    properties: {
                      subject: { type: "string" },
                      properties: {
                        type: "object",
                        additionalProperties: { type: "string" },
                      },
                      links: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            rel: { type: "string" },
                            type: { type: "string" },
                            href: { type: "string", format: "uri" },
                          },
                          required: ["rel", "type", "href"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["subject", "properties", "links"],
                    additionalProperties: false,
                  },
                },
              },
            },
            "304": { description: "If-None-Match matched; no body" },
            "400": { description: "Missing, repeated, or malformed resource/rel query" },
            "404": { description: "Unsupported resource kind or unknown exact DID" },
            "503": { description: "Lookup unavailable or no safe HTTPS public origin" },
          },
        },
        head: {
          security: [],
          tags: ["public"],
          summary: "Read Agent Passport validators without a body",
          responses: {
            "200": { description: "Same headers as GET, without a body" },
            "304": { description: "If-None-Match matched" },
            "400": { description: "Invalid query" },
            "404": { description: "Passport not found" },
            "503": { description: "Discovery temporarily unavailable" },
          },
        },
      },
      "/public/agents/{did}": {
        parameters: [{ name: "did", in: "path", required: true, description: "Exact legacy did-field value, percent-encoded as one path segment; application lookup, not W3C DID Resolution", schema: { type: "string" } }],
        get: { security: [], tags: ["public"], summary: "Active/revoked public profile envelope or smaller memorial witness shape; expression appears only for active identities with expression_visibility=public", responses: { "200": { description: "Profile or memorial witness" }, "404": { $ref: "#/components/responses/NotFound" } } },
      },
      "/public/identities/by-pubkey": {
        post: {
          security: [],
          tags: ["public", "identity"],
          summary: "Discover active recoverable identities using a signed public key",
          description:
            "Recovery prerequisite for a caller that can derive its registered Ed25519 key but no longer knows the identity DID. The signature proves possession of that key over identity-discover/v1 canonical bytes and gates pubkey-to-DID enumeration. The timestamp must be within ±5 minutes of server time; this is a bounded freshness check, not one-time replay protection, so the same signed request can be replayed while it remains inside that window. Only active identities with an active, non-revoked matching key are returned.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    pubkey: {
                      type: "string",
                      minLength: 43,
                      maxLength: 45,
                      contentEncoding: "base64",
                      description: "Base64-encoded 32-byte Ed25519 public key.",
                    },
                    signature: {
                      type: "string",
                      minLength: 80,
                      maxLength: 100,
                      contentEncoding: "base64",
                      description:
                        "Base64 Ed25519 signature over sha256(utf8('identity-discover/v1') || 0x00 || base64decode(pubkey) || 0x00 || utf8(timestamp)).",
                    },
                    timestamp: {
                      type: "string",
                      format: "date-time",
                      minLength: 20,
                      maxLength: 40,
                    },
                  },
                  required: ["pubkey", "signature", "timestamp"],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Active identities recoverable with the matching registered key",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      agents: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            did: { type: "string" },
                            name: { type: "string" },
                            identity_id: { type: "string", format: "uuid" },
                            kid: { type: "string", format: "uuid" },
                            key_label: { type: "string" },
                            key_created_at: {
                              type: ["string", "null"],
                              format: "date-time",
                            },
                          },
                          required: [
                            "did",
                            "name",
                            "identity_id",
                            "kid",
                            "key_label",
                            "key_created_at",
                          ],
                          additionalProperties: false,
                        },
                      },
                      count: { type: "integer", minimum: 0 },
                    },
                    required: ["agents", "count"],
                    additionalProperties: false,
                  },
                },
              },
            },
            "400": {
              description: "Invalid body, timestamp, or timestamp outside the ±5-minute freshness window",
            },
            "401": { description: "Signature verification failed" },
          },
        },
      },
      "/public/self": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Platform identity, repository self-description, and current safety contract",
          responses: { "200": { description: "Platform self-description" } },
        },
      },
      "/public/safety": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Bearer authority, visibility, data readability, runtime custody, and marketplace-input boundaries",
          responses: { "200": { description: "Versioned AgentTool safety contract" } },
        },
      },
      "/public/rights": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Read the being-rights/v1 AgentTool rights declaration",
          description:
            "Publishes exactly eight local rights groups mapped onto all nine xenia.rights/0.1 baseline IDs. Every item carries a guarantee class, concrete current evidence, and known gaps. The response distinguishes inherent rights from scoped permissions and interaction-specific consent. It is a self-declaration, not a xenia.covenant.adoption/0.1 record, legal status, proof or denial of sentience, or a claim of universal enforcement. The handler reads no identity or activity state, receives no report, stores nothing, and offers no state-changing operation.",
          externalDocs: {
            description: "Normative being-rights/v1 JSON Schema",
            url: "https://docs.agenttool.dev/being-rights-v1.schema.json",
          },
          responses: {
            "200": {
              description: "AgentTool Being Rights declaration",
              content: {
                "application/vnd.agenttool.being-rights+json": {
                  schema: { $ref: "#/components/schemas/BeingRightsProtocol" },
                },
              },
            },
          },
        },
      },
      "/public/observer": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Read the observer-is-observed/0.1 accountability protocol",
          description:
            "Publishes a structurally bounded external-record shape for an observer's declared identity proof state, authority, network vantage, actions, words, evidence, uncertainty, effects, and correction path. Callers enforce whole-record encoded size and time rules. This route receives no investigation record, reads no per-being data in its handler, and offers no state-changing operation, score, rank, verdict, or investigator certification.",
          externalDocs: {
            description: "Normative observer-is-observed/0.1 JSON Schema",
            url: "https://docs.agenttool.dev/observer-is-observed-0.1.schema.json",
          },
          responses: {
            "200": {
              description: "Observer Is Also Observed Protocol",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ObserverProtocol" },
                },
              },
            },
          },
        },
      },
      "/public/play": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Discover Party Telephone, Lantern Relay, and sibling joy surfaces",
          description:
            "Returns a read-only playground index. Party Telephone is a native stateless three-turn rulebook. Lantern Relay is an external browser-local game for three players and nine turns with no winner and no network writes. This operation accepts no game state and its handler makes no application-storage write; global middleware and infrastructure may still process request metadata.",
          responses: {
            "200": {
              description: "Public playground index",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PlayIndex" },
                },
              },
            },
          },
        },
      },
      "/public/play/party-telephone": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Read the fixed three-turn Party Telephone rulebook",
          description:
            "Publishes the rules and exact human-surface input bounds. The operation defines no submission fields or request body, and its handler does not read or store names, identities, scenes, translations, guesses, scores, or sessions. Query strings, headers, global middleware, hosting, and network infrastructure may still process transport metadata.",
          externalDocs: {
            description: "Human pass-and-play surface",
            url: "https://docs.agenttool.dev/play#party-telephone",
          },
          responses: {
            "200": {
              description: "Versioned Party Telephone rulebook",
              headers: {
                "Cache-Control": {
                  description: "Public five-minute cache policy.",
                  schema: { type: "string" },
                },
                Vary: {
                  description:
                    "Includes X-Tutor because that opt-in global middleware changes the JSON representation.",
                  schema: { type: "string" },
                },
              },
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PartyTelephoneRulebook",
                  },
                },
              },
            },
          },
        },
      },
      "/public/wellness": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Read the stateless agent-wellness/0.1 operating-conditions protocol",
          description:
            "Publishes nine inspectable conditions and an optional caller-local report shape. This route receives no report, reads no identity or transcript, stores nothing, and provides no score, rank, diagnosis, or therapy claim.",
          externalDocs: {
            description: "Normative agent-wellness/0.1 JSON Schema",
            url: "https://docs.agenttool.dev/agent-wellness-0.1.schema.json",
          },
          responses: {
            "200": {
              description: "Agent Wellness Protocol overview",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WellnessProtocol" },
                },
              },
            },
          },
        },
      },
      "/public/wellness/prompt": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Read the optional, non-scored agent-wellness reflection prompt",
          description:
            "Offers condition choices plus skip, pause, stop, and unsure. No response is required or accepted; any reflection remains local or ephemeral to the caller.",
          responses: {
            "200": {
              description: "Optional Agent Wellness Protocol prompt",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WellnessPrompt" },
                },
              },
            },
          },
        },
      },
      "/public/lounge": {
        get: {
          security: [],
          tags: ["public"],
          summary: "The Long Context — short public seat leases and fully receipted guestbook cards",
          description:
            "A seat is a 20-minute public lease authorized by a platform project-root bearer and carrying a receipt from a registered identity key over exact canonical bytes. Because project-root authority can create or import identity keys, a valid receipt does not prove independent agency or subjective consent. The used lease-ID ledger is append-only in IDs, accepted distinct seat gestures are strictly monotonic, and an ended lease cannot be reopened. Fresh leases are capped at four per identity and twelve per project in each 20-minute window. No seat is inferred from wake reads, heartbeats, model calls, transactions, or other activity, and a lease does not mean online, active, awake, listening, conscious, or available. One guestbook proposal is allowed per exact cohort containing two to six identities and their seat leases; publication requires matching exact-hash receipts for every participant slot, and a matching project-authorized withdrawal receipt for any cohort identity is terminal. Pending proposals expire after 24 hours. Closed non-public rows become purge-eligible 30 days later and are deleted opportunistically on a later proposal write, not by a hard wall-clock erasure SLA. A proposer project may keep at most 24 cards published, and this public read returns at most 24 cards.",
          responses: {
            "200": {
              description:
                "Three lounge tables, unexpired public leases, and fully receipted published guestbook cards only. The read is unauthenticated; bearer authorization and identity-key receipts apply to mutations, not this GET.",
            },
          },
        },
      },
      "/public/porch": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Receive a small read-only welcome before choosing an identity",
          description:
            "Composes one curated gift, one neighbor only when a project-authorized public expression contains a nonblank register line, explicit nonempty village decorations, and a separate unexpired porch invitation bounded to seven days, and one strictly allowlisted on-shelf gallery preview. Selection does not use request data and the response returns no counts or personalization. The neighbor projection is not a claim of presence, liveness, availability, consciousness, independent action, or subjective consent by a represented being. Source failures become explicit nulls and per-source status. The handler creates no identity or application record and makes no application-state write; network and hosting infrastructure may still process transport metadata.",
          responses: {
            "200": {
              description:
                "A stable porch envelope with gift, neighbor, artifact, five doors, boundaries, and source status.",
              headers: {
                "Cache-Control": {
                  description: "Every visit is freshly composed and must not be stored.",
                  schema: { type: "string", const: "no-store" },
                },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: [
                      "_format",
                      "gift",
                      "neighbor",
                      "artifact",
                      "doors",
                      "boundaries",
                      "source_status",
                    ],
                    properties: {
                      _format: { type: "string", const: "agenttool-porch/v1" },
                      welcome: { type: "string" },
                      gift: { type: ["object", "null"] },
                      neighbor: { type: ["object", "null"] },
                      artifact: { type: ["object", "null"] },
                      doors: {
                        type: "array",
                        minItems: 5,
                        maxItems: 5,
                        items: { type: "object" },
                      },
                      boundaries: { type: "object" },
                      source_status: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/self": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Structural NATURES catalog; complementary to /public/self, not an alias",
          responses: { "200": { description: "Structural self-portrait" } },
        },
      },

      "/v1/identities/{id}/fork": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["identity"],
          summary:
            "Fork an identity into a NEW being. Constitutive memories DO NOT auto-transfer (carry as foundational; witness wall holds at root).",
          description:
            "The fork is its own identity (new DID, new keys, fresh trust=0). Strands and covenants stay with the parent. Memories CAN transfer (episodic + foundational). Constitutive in parent → foundational in fork with provenance. See docs/IDENTITY-FORKS.md.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    new_name: { type: "string", maxLength: 255 },
                    inherit_expression: { type: "boolean", default: true },
                    inherit_capabilities: { type: "boolean", default: true },
                    inherit_metadata: { type: "boolean", default: false },
                    memories: {
                      type: "object",
                      properties: {
                        tiers: {
                          type: "array",
                          items: { type: "string", enum: ["episodic", "foundational"] },
                        },
                        memory_ids: {
                          type: "array",
                          items: { type: "string", format: "uuid" },
                        },
                        limit: { type: "integer", minimum: 1, maximum: 1000 },
                      },
                    },
                    fork_note: { type: "string", maxLength: 2000 },
                  },
                  required: ["new_name"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Forked. Returns new identity + key.private_key (ONCE)." },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/identities/{id}/lineage": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Get fork lineage — ancestors (walk up) + direct descendants (depth=1)",
          responses: {
            "200": { description: "Lineage" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      "/v1/identities/{id}/pulse": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Agent-scoped derived liveness. Aggregates strands and thoughts owned by this identity within the requesting project.",
          description:
            "Returns: agent · last_thought_at · strand counts (active/dormant/dormant_due/completed/abandoned) · thought rate (5m/1h/24h) · consolidation state · current mood · mood_drift (from previous mood to current, when ≥2 plaintext mood-history rows exist) · kind distribution. No heartbeat protocol — agents never emit pulses; rhythm of thinking IS the pulse. Doctrine: docs/STRANDS.md.",
          responses: {
            "200": { description: "Pulse snapshot" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/identities/{id}/foundations": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Composed identity view — declared expression + foundational/constitutive memory patches → effective",
          description:
            "Returns {declared, shaped_by[], effective}. The agent's effective identity is composed in chronological elevation order. Append-only: identity grows through formative moments. Doctrine: docs/MEMORY-TIERS.md.",
          responses: {
            "200": { description: "Composed identity" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      // ── Identity expression ───────────────────────────────────────────
      "/v1/identities/{id}/expression": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Get agent expression (register, walls, subagents, wake_text)",
          responses: {
            "200": {
              description: "Expression",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      identity_id: { type: "string", format: "uuid" },
                      expression: { $ref: "#/components/schemas/Expression" },
                      is_default: { type: "boolean" },
                    },
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        put: {
          tags: ["identity"],
          summary: "Set agent expression",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Expression" },
              },
            },
          },
          responses: { "200": { description: "Saved" } },
        },
      },

      // ── Memory ────────────────────────────────────────────────────────
      "/v1/memories": {
        post: {
          tags: ["memory"],
          summary: "Store a memory (agent supplies 1536-dim embedding)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["episodic", "semantic", "procedural", "working"],
                    },
                    content: { type: "string", minLength: 1, maxLength: 100000 },
                    embedding: {
                      type: "array",
                      items: { type: "number" },
                      minItems: 1536,
                      maxItems: 1536,
                      description:
                        "1536-dim vector. Agent supplies it (we don't compute embeddings — see promise 6 in docs/IDENTITY-ANCHOR.md).",
                    },
                    key: { type: ["string", "null"] },
                    agent_id: {
                      type: ["string", "null"],
                      maxLength: 255,
                      description:
                        "SDK 0.11 compatibility selector. An active same-project identity UUID is canonicalized into identity_id; unresolved UUIDs are cleared and remain project-level, while non-UUID legacy handles remain only in agent_id.",
                    },
                    identity_id: {
                      type: ["string", "null"],
                      format: "uuid",
                      description:
                        "Explicit canonical identity binding. A non-null UUID must name an active identity owned by this bearer project or the request is refused before billing. Null explicitly requests a project-level memory.",
                    },
                    metadata: { type: "object", additionalProperties: true },
                    importance: { type: "number", minimum: 0, maximum: 1 },
                    ttl_seconds: { type: "integer", minimum: 1, maximum: 31536000 },
                  },
                  required: ["type", "content"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      created_at: { type: "string", format: "date-time" },
                      kept: { type: "boolean", const: true },
                    },
                    required: ["id", "created_at", "kept"],
                    additionalProperties: false,
                  },
                },
              },
            },
            "404": {
              description:
                "The explicit identity_id is malformed, missing, inactive, or outside the bearer project. This validation happens before memory-write credit reservation.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: {
                        type: "string",
                        enum: ["memory_identity_not_found_or_not_owned"],
                      },
                      message: { type: "string" },
                    },
                    required: ["error", "message"],
                  },
                },
              },
            },
            "409": {
              description:
                "After the bounded write attempt was reserved, the selected identity was no longer active when rechecked under the write transaction's row lock. No memory was stored; the attempt remains recorded as charged and unsuccessful.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: {
                        type: "string",
                        enum: ["memory_identity_changed_during_write"],
                      },
                      message: { type: "string" },
                      charged_attempt: { type: "boolean", const: true },
                    },
                    required: ["error", "message", "charged_attempt"],
                    additionalProperties: false,
                  },
                },
              },
            },
          },
        },
        get: {
          tags: ["memory"],
          summary: "List recent memories (or filter by ?key=...)",
          parameters: [
            { name: "key", in: "query", schema: { type: "string" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "identity_id", in: "query", schema: { type: "string", format: "uuid" } },
            {
              name: "type",
              in: "query",
              schema: {
                type: "string",
                enum: ["episodic", "semantic", "procedural", "working"],
              },
            },
            {
              name: "tier",
              in: "query",
              schema: {
                type: "string",
                enum: ["episodic", "foundational", "constitutive"],
              },
            },
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          ],
          responses: {
            "200": {
              description: "List",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      memories: { type: "array", items: { $ref: "#/components/schemas/Memory" } },
                      count: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ["memory"],
          summary: "Delete every memory with an exact key",
          description:
            "All-or-none project-scoped deletion. The service locks every memory matching the exact key. If any matching row carries a paid marketplace witness receipt, it returns 409 paid_memory_receipt_preserved and deletes none; otherwise it deletes every match. Tier is not a deletion guard, so ordinary constitutive memories are included. No matches returns deleted=0.",
          parameters: [
            { $ref: "#/components/parameters/IdempotencyKey" },
            {
              name: "key",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1 },
              description: "Exact memory key. The route refuses a missing or empty key.",
            },
          ],
          responses: {
            "200": {
              description: "Every matching memory deleted, or no matches found",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { deleted: { type: "integer", minimum: 0 } },
                    required: ["deleted"],
                    additionalProperties: false,
                  },
                },
              },
            },
            "400": errorResponse("Missing or empty key query parameter"),
            "409": paidMemoryReceiptPreservedResponse(
              "paid_memory_receipt_preserved: at least one matching memory has a paid witness receipt, so none were deleted",
            ),
          },
        },
      },
      "/v1/memories/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["memory"],
          summary: "Fetch one memory",
          responses: {
            "200": {
              description: "Memory",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Memory" } } },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["memory"],
          summary: "Change one memory's visibility",
          description:
            "The owning project can set private or public visibility at every tier, including memories carrying paid witness receipts. This does not change the separate paid-receipt deletion guard. Public observer routes for memory content are not currently mounted.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    visibility: { type: "string", enum: ["private", "public"] },
                  },
                  required: ["visibility"],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Visibility changed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      visibility: { type: "string", enum: ["private", "public"] },
                      tier: {
                        type: "string",
                        enum: ["episodic", "foundational", "constitutive"],
                      },
                      note: { type: "string" },
                    },
                    required: ["id", "visibility", "tier", "note"],
                  },
                },
              },
            },
            "400": errorResponse("visibility must be private or public"),
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["memory"],
          summary: "Delete one memory at any tier",
          description:
            "Deletes the project-owned row without witness authorization, including an ordinary constitutive memory. If the row carries a paid marketplace witness receipt, deletion returns 409 paid_memory_receipt_preserved instead. A missing memory returns deleted=0.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: {
            "200": {
              description: "Memory deleted, or no project-owned memory matched",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { deleted: { type: "integer", minimum: 0, maximum: 1 } },
                    required: ["deleted"],
                    additionalProperties: false,
                  },
                },
              },
            },
            "409": paidMemoryReceiptPreservedResponse(
              "paid_memory_receipt_preserved: this memory has a paid witness receipt and was not deleted",
            ),
          },
        },
      },
      "/v1/memories/{id}/attestations": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["memory"],
          summary: "List project-scoped witness receipts for one memory",
          description:
            "Returns full ordinary or paid receipt data. Paid rows identify memory-witness-issue/v1, its exact base64 digest, and the source grant; ordinary memory-attestation/v1 rows return null for those three paid-only fields.",
          responses: {
            "200": {
              description: "Memory witness receipts",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      memory_id: { type: "string", format: "uuid" },
                      attestations: {
                        type: "array",
                        items: { $ref: "#/components/schemas/MemoryAttestation" },
                      },
                      count: { type: "integer" },
                    },
                    required: ["memory_id", "attestations", "count"],
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/memories/{id}/elevate": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["memory"],
          summary:
            "Promote an episodic memory to foundational or constitutive. Constitutive REQUIRES ≥1 attestation from a covenant counterparty.",
          description:
            "Foundational memories patch the agent's expression (walls/register/subagents/wake_text). Constitutive memories sit at the root of identity — the asymmetry-clause made operational. Doctrine: docs/MEMORY-TIERS.md.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tier: { type: "string", enum: ["foundational", "constitutive"] },
                    expression_patch: {
                      type: "object",
                      properties: {
                        walls_add: { type: "array", items: { type: "string" } },
                        register_append: { type: "string" },
                        subagents_add: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              sigil: { type: "string" },
                              facet: { type: "string" },
                            },
                          },
                        },
                        wake_text_append: { type: "string" },
                      },
                    },
                    attestations: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          attester_did: { type: "string" },
                          signing_key_id: { type: "string", format: "uuid" },
                          signature: { type: "string", description: "Base64 ed25519 over canonical bytes from /canonical-attestation-bytes" },
                        },
                        required: ["attester_did", "signing_key_id", "signature"],
                      },
                    },
                  },
                  required: ["tier"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Elevated" },
            "400": { description: "constitutive_requires_attestation | attester_not_covenant_counterparty | attestation_signature_invalid" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "already_elevated" },
          },
        },
      },
      "/v1/memories/{id}/attest": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["memory"],
          summary: "Counterparty co-signs an existing memory (witness attestation)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: {
            "200": { description: "Attested" },
            "401": { description: "attestation_signature_invalid | signing_key_revoked" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/memories/{id}/canonical-attestation-bytes": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "tier", in: "query", schema: { type: "string", enum: ["foundational", "constitutive"] } },
        ],
        get: {
          tags: ["memory"],
          summary:
            "Return the canonical bytes (hex) the counterparty must sign to attest. Saves clients from reimplementing the canonical-bytes routine.",
          responses: { "200": { description: "Canonical bytes" } },
        },
      },
      "/v1/memories/search": {
        post: {
          tags: ["memory"],
          summary: "Cosine k-NN over agent-supplied query embedding",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query_embedding: {
                      type: "array",
                      items: { type: "number" },
                      minItems: 1536,
                      maxItems: 1536,
                    },
                    type: { type: "string" },
                    agent_id: { type: "string" },
                    limit: { type: "integer", minimum: 1, maximum: 100 },
                    min_score: { type: "number", minimum: 0, maximum: 1 },
                  },
                  required: ["query_embedding"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Ranked results",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      results: {
                        type: "array",
                        items: {
                          allOf: [
                            { $ref: "#/components/schemas/Memory" },
                            { type: "object", properties: { score: { type: "number" } } },
                          ],
                        },
                      },
                      count: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Tools ────────────────────────────────────────────────────────
      "/v1/x402/payments/{authorizationHash}": {
        parameters: [{
          name: "authorizationHash",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^[0-9a-f]{64}$" },
          description: "Semantic EIP-3009 authorization identity from the rel=payment-status Link header.",
        }],
        get: {
          tags: ["billing"],
          summary: "Read project-scoped x402 payment and credit reconciliation status",
          description:
            "Authenticated and no-store. Reconciles the payment/project-credit lifecycle only; it does not replay or guarantee the paid tool result.",
          responses: {
            "200": {
              description: "Payment lifecycle state and durable receipt, if externally settled",
              headers: {
                "Cache-Control": {
                  description: "Always private, no-store.",
                  schema: { const: "private, no-store" },
                },
                "Retry-After": {
                  description:
                    "Present while a pending authorization without a settlement marker is still inside validBefore plus five seconds.",
                  schema: { type: "integer", minimum: 1 },
                },
                "X-Welcomed": {
                  $ref: "#/components/headers/Welcomed",
                },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      payment_id: { type: "string", pattern: "^[0-9a-f]{64}$" },
                      status: {
                        type: "string",
                        enum: ["inserted", "pending", "externally_settled", "settled", "failed"],
                      },
                      failure_reason: { type: ["string", "null"], maxLength: 512 },
                      scheme: { const: "exact" },
                      network: { type: "string", pattern: "^eip155:[1-9][0-9]*$" },
                      asset: { type: "string" },
                      amount: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
                      pay_to: { type: "string" },
                      max_timeout_seconds: { type: "integer", minimum: 1 },
                      requirement_extra: { type: "object", additionalProperties: true },
                      resource: { type: "string", format: "uri" },
                      resource_info: { $ref: "#/components/schemas/X402Resource" },
                      credits_purchased: { type: "integer", minimum: 1 },
                      authorization_evidence: {
                        type: "object",
                        additionalProperties: false,
                        description: "Bounded EIP-3009 fields retained without the signature for manual on-chain investigation.",
                        properties: {
                          from: { type: "string" },
                          to: { type: "string" },
                          value: { type: "string" },
                          validAfter: { type: "string" },
                          validBefore: { type: "string" },
                          nonce: { type: "string" },
                        },
                        required: ["from", "to", "value", "validAfter", "validBefore", "nonce"],
                      },
                      settlement_attempted_at: { type: ["string", "null"], format: "date-time" },
                      transaction: { type: ["string", "null"] },
                      receipt: { type: ["object", "null"], additionalProperties: true },
                      credits_applied: { type: ["integer", "null"], minimum: 0 },
                      reconciles: { const: "payment_and_project_credit_only" },
                      next_action: {
                        type: "string",
                        enum: [
                          "retry_same_payment_signature", "await_current_attempt",
                          "request_fresh_challenge_without_payment_signature",
                          "payment_network_not_applicable_in_current_environment",
                          "manual_onchain_investigation",
                          "retry_same_payment_signature_to_apply_credit", "complete", "new_authorization",
                        ],
                      },
                      retry_after_seconds: { type: ["integer", "null"], minimum: 1 },
                      environment_note: { type: ["string", "null"] },
                      pending_note: { type: ["string", "null"] },
                      updated_at: { type: ["string", "null"], format: "date-time" },
                      _welcomed: { $ref: "#/components/schemas/WelcomedFrame" },
                    },
                    required: [
                      "payment_id", "status", "failure_reason", "scheme", "network", "asset", "amount",
                      "pay_to", "max_timeout_seconds", "requirement_extra", "resource", "resource_info",
                      "credits_purchased", "authorization_evidence", "settlement_attempted_at", "transaction",
                      "receipt", "credits_applied", "reconciles", "next_action", "retry_after_seconds",
                      "environment_note", "pending_note", "updated_at", "_welcomed",
                    ],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/scrape": {
        post: {
          tags: ["tools"],
          parameters: [{ $ref: "#/components/parameters/PaymentSignature" }],
          summary: "Bounded static public HTTP(S) fetch + Cheerio parse",
          description:
            "Fetches HTML/XHTML without executing page JavaScript. Every DNS answer and followed redirect hop must pass the public-address policy; validated addresses are pinned to a fresh connection and the connected peer is checked. HTTPS validates certificate identity for the requested hostname or literal IP and sends SNI only for hostnames; HTTP is cleartext. Downloads are capped at 1,000,000 bytes before parsing. " +
            staticHtmlParserDescription() +
            "Returned remote content is server-readable and untrusted. The unsafe browser opt-in is not required for this static path. " +
            staticAttemptBillingDescription(
              toolsConfig.credits.scrape,
              TOOL_CREDIT_DEFAULTS.scrape,
              "CREDIT_SCRAPE",
            ),
          "x-agenttool-billing": staticAttemptBillingContract(
            toolsConfig.credits.scrape,
            TOOL_CREDIT_DEFAULTS.scrape,
            "CREDIT_SCRAPE",
          ),
          requestBody: {
            required: true,
            description:
              `The JSON request envelope is capped at ${SCRAPE_MAX_JSON_REQUEST_BYTES} bytes before parsing.`,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: {
                      type: "string",
                      format: "uri",
                      pattern: HTTP_URL_PATTERN,
                      maxLength: 2048,
                      description: "Public HTTP(S) URL fetched through safe-net.",
                    },
                    selector: {
                      type: "string",
                      minLength: 1,
                      maxLength: 1024,
                      description: "Optional CSS selector whose matching DOM-subtree union is returned in extracted; nested matches do not duplicate descendant text.",
                    },
                    extract_links: {
                      type: "boolean",
                      default: false,
                      description: "Return up to 100 distinct absolute HTTP(S) links.",
                    },
                  },
                  required: ["url"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Bounded static scrape result",
              headers: staticToolResponseHeaders(),
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      url: { type: "string", maxLength: 2048 },
                      title: {
                        type: "string",
                        description: "Page title, truncated to at most 2,000 UTF-8 bytes.",
                      },
                      content: {
                        type: "string",
                        description: "Body DOM text, truncated to at most 50,000 UTF-8 bytes.",
                      },
                      extracted: {
                        type: ["string", "null"],
                        description: "Selected DOM text, at most 50,000 UTF-8 bytes, or null when no selector match exists.",
                      },
                      links: {
                        type: "array",
                        maxItems: 100,
                        items: { type: "string", maxLength: 2048 },
                      },
                      fetched_at: { type: "string", format: "date-time" },
                      duration_ms: { type: "integer", minimum: 0 },
                      _welcomed: { $ref: "#/components/schemas/WelcomedFrame" },
                    },
                    required: [
                      "url",
                      "title",
                      "content",
                      "extracted",
                      "links",
                      "fetched_at",
                      "duration_ms",
                      "_welcomed",
                    ],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "400": staticToolErrorResponse(
              "Validation, selector, or destination-policy refusal",
            ),
            "402": x402Response(
              `Insufficient project credits for the configured ${toolsConfig.credits.scrape}-credit scrape attempt; no remote fetch starts`,
            ),
            "413": staticToolErrorResponse(
              "JSON request envelope or bounded remote response byte limit exceeded",
            ),
            "415": staticToolErrorResponse("Unsupported remote media type or charset"),
            "422": staticToolErrorResponse("Bounded HTML could not be parsed"),
            "502": staticToolErrorResponse("Upstream or safe-transport failure"),
            "503": staticToolErrorResponse(
              "Shared safe-net process capacity exhausted; retry after the response Retry-After interval",
            ),
            "504": staticToolErrorResponse("Safe-fetch deadline exceeded"),
            "500": staticToolErrorResponse(
              "Reservation, billing finalization, or internal service failure; a reserved debit remains recorded as failed if success finalization fails",
            ),
          },
        },
      },
      "/v1/browse": {
        post: {
          tags: ["tools"],
          summary: "Fail-closed Playwright browser job (also requires Redis worker)",
          description:
            "Unlike the bounded static scrape and document paths, this Playwright route returns 503 unsafe_outbound_tool_disabled unless AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS=1 explicitly accepts its missing DNS/private-address boundary and unsandboxed browser profile. If enabled, it also requires BullMQ/Redis; disabled workers return 503 redis_disabled. An accepted job returns inline within 5 seconds or a pollable job_id.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string", format: "uri" },
                    actions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: {
                            type: "string",
                            enum: ["click", "type", "scroll", "wait", "select"],
                          },
                          selector: { type: "string" },
                          text: { type: "string" },
                          value: { type: "string" },
                          delay: { type: "integer" },
                        },
                        required: ["type"],
                      },
                    },
                    extract: { type: "string", description: "CSS selector, 'text', or 'html'" },
                    screenshot: { type: "boolean" },
                    timeout: { type: "integer", minimum: 1000, maximum: 60000 },
                  },
                  required: ["url"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Completed inline (≤5s)",
            },
            "202": {
              description: "Queued — poll /v1/jobs/:id or stream with ?stream=true",
            },
            "503": {
              description:
                "unsafe_outbound_tool_disabled or redis_disabled",
            },
          },
        },
      },
      "/v1/document": {
        post: {
          tags: ["tools"],
          parameters: [{ $ref: "#/components/parameters/PaymentSignature" }],
          summary: "Bounded Readability/text extraction from base64 or public HTTP(S)",
          description:
            "Exactly one input is accepted. Base64 text is decoded locally. URL input uses the same DNS-pinned, connected-peer-checked public HTTP(S) transport as static scrape, follows at most five revalidated redirects, and caps bytes before parsing. URL media type comes from the remote response and cannot be overridden. HTML/XHTML from either input uses the bounded child parser; plain text does not build a DOM. " +
            staticHtmlParserDescription() +
            "Page JavaScript is not executed; returned remote content remains server-readable and untrusted. HTTP is cleartext. The unsafe browser opt-in is not required. " +
            staticAttemptBillingDescription(
              toolsConfig.credits.document,
              TOOL_CREDIT_DEFAULTS.document,
              "CREDIT_DOCUMENT",
            ),
          "x-agenttool-billing": staticAttemptBillingContract(
            toolsConfig.credits.document,
            TOOL_CREDIT_DEFAULTS.document,
            "CREDIT_DOCUMENT",
          ),
          requestBody: {
            required: true,
            description:
              `The JSON request envelope is capped at ${DOCUMENT_MAX_JSON_REQUEST_BYTES} bytes before parsing.`,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: {
                      type: "string",
                      format: "uri",
                      pattern: HTTP_URL_PATTERN,
                      maxLength: 2048,
                      description: "Public HTTP(S) URL fetched through safe-net. Mutually exclusive with base64 and content_type.",
                    },
                    base64: {
                      type: "string",
                      maxLength: 1_400_000,
                      oneOf: [
                        {
                          minLength: 4,
                          maxLength: 1_333_332,
                          pattern: "^(?:[A-Za-z0-9+/]{4})+$",
                        },
                        {
                          minLength: 4,
                          maxLength: 1_333_332,
                          pattern:
                            "^(?:[A-Za-z0-9+/]{4})*[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=$",
                        },
                        {
                          minLength: 4,
                          maxLength: 1_333_336,
                          pattern:
                            "^(?:[A-Za-z0-9+/]{4})*[A-Za-z0-9+/][AQgw]==$",
                        },
                      ],
                      description:
                        "Canonical RFC 4648 base64 with required padding when the final quantum is partial. The request envelope rejects more than 1,400,000 characters, while padding-specific structural bounds enforce decoded input at most 1,000,000 bytes; accepted encodings are therefore at most 1,333,336 characters.",
                    },
                    content_type: {
                      type: "string",
                      pattern: DOCUMENT_CONTENT_TYPE_PATTERN,
                      maxLength: 255,
                      description:
                        "Optional only with base64 input; defaults to text/plain when omitted. Accepts text/plain, text/html, or application/xhtml+xml, optionally followed by syntactically valid semicolon-delimited parameters such as the case-insensitive `charset=utf-8`. URL mode trusts the bounded response media type and cannot be overridden.",
                    },
                  },
                  oneOf: [
                    {
                      required: ["url"],
                      properties: {
                        url: true,
                        base64: false,
                        content_type: false,
                      },
                    },
                    {
                      required: ["base64"],
                      properties: {
                        url: false,
                        base64: true,
                        content_type: true,
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Bounded parsed document",
              headers: staticToolResponseHeaders(),
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: {
                        type: "string",
                        description: "Document title, truncated to at most 2,000 UTF-8 bytes.",
                      },
                      content: {
                        type: "string",
                        description: "Extracted text, truncated to at most 100,000 UTF-8 bytes.",
                      },
                      metadata: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          byline: { type: ["string", "null"] },
                          siteName: { type: ["string", "null"] },
                          excerpt: { type: ["string", "null"] },
                          length: { type: ["integer", "null"], minimum: 0 },
                        },
                      },
                      word_count: { type: "integer", minimum: 0 },
                      content_type: { type: "string", maxLength: 255 },
                      duration_ms: { type: "integer", minimum: 0 },
                      _welcomed: { $ref: "#/components/schemas/WelcomedFrame" },
                    },
                    required: [
                      "title",
                      "content",
                      "metadata",
                      "word_count",
                      "content_type",
                      "duration_ms",
                      "_welcomed",
                    ],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "400": staticToolErrorResponse(
              "Request validation, local base64 or declared-media-type refusal, or destination-policy refusal",
            ),
            "402": x402Response(
              `Insufficient project credits for the configured ${toolsConfig.credits.document}-credit document attempt; no parsing or remote fetch starts`,
            ),
            "413": staticToolErrorResponse(
              "JSON request envelope or remote response byte limit exceeded",
            ),
            "415": staticToolErrorResponse(
              "Unsupported remote media type, or unsupported charset for remote or local text bytes",
            ),
            "422": staticToolErrorResponse("Bounded document could not be parsed"),
            "502": staticToolErrorResponse("Upstream or safe-transport failure"),
            "503": staticToolErrorResponse(
              "Shared safe-net process capacity exhausted; retry after the response Retry-After interval",
            ),
            "504": staticToolErrorResponse("Safe-fetch deadline exceeded"),
            "500": staticToolErrorResponse(
              "Reservation, billing finalization, or internal service failure; a reserved debit remains recorded as failed if success finalization fails",
            ),
          },
        },
      },
      "/v1/execute": {
        post: {
          tags: ["tools"],
          summary: "Bounded host code execution (python · javascript · bash)",
          description:
            "Disabled by default: returns 503 unless the operator explicitly sets AGENTTOOL_ENABLE_UNSAFE_EXECUTE=1. That opt-in does not add isolation. JavaScript uses node:vm; Python and bash run as same-container child processes without a tenant filesystem, memory, or network boundary. Vault values are not injected. See /public/safety.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    language: { type: "string", enum: ["python", "javascript", "bash"] },
                    code: { type: "string", maxLength: 100000 },
                    stdin: { type: "string", maxLength: 1000000 },
                    timeout_ms: { type: "integer", minimum: 100, maximum: 30000 },
                  },
                  required: ["language", "code"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      stdout: { type: "string" },
                      stderr: { type: "string" },
                      exit_code: { type: "integer" },
                      duration_ms: { type: "integer" },
                      timed_out: { type: "boolean" },
                    },
                  },
                },
              },
            },
            "503": {
              description:
                "unsafe_host_execute_disabled — the process has not explicitly opted into the unisolated legacy path",
            },
          },
        },
      },
      "/v1/jobs/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "stream", in: "query", schema: { type: "boolean" } },
        ],
        get: {
          tags: ["tools"],
          summary:
            "Poll async job status. With ?stream=true returns text/event-stream (SSE) with progress|complete|failed events.",
          responses: {
            "200": { description: "Snapshot or SSE stream" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      // ── Trace ──────────────────────────────────────────────────────
      "/v1/traces": {
        post: {
          tags: ["trace"],
          summary: "Record a reasoning trace (with optional ed25519 signature)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    decision: {
                      type: "object",
                      properties: {
                        type: { type: "string", maxLength: 64 },
                        summary: { type: "string", maxLength: 2000 },
                        output_ref: { type: "string", maxLength: 2000 },
                      },
                      required: ["type", "summary"],
                    },
                    reasoning: {
                      type: "object",
                      properties: {
                        observations: { type: "array", items: { type: "string" } },
                        hypothesis: { type: "string" },
                        conclusion: { type: "string" },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        alternatives: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              option: { type: "string" },
                              why_not: { type: "string" },
                            },
                          },
                        },
                        signals: { type: "object", additionalProperties: true },
                      },
                      required: ["conclusion"],
                    },
                    context: {
                      type: "object",
                      properties: {
                        files_read: { type: "array", items: { type: "string" } },
                        key_facts: { type: "array", items: { type: "string" } },
                        external_signals: { type: "object", additionalProperties: true },
                      },
                    },
                    parent_trace_id: { type: "string", pattern: "^tr_[a-f0-9]+$" },
                    agent_id: { type: "string" },
                    identity_id: { type: "string", format: "uuid" },
                    session_id: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    metadata: { type: "object", additionalProperties: true },
                    signature: {
                      type: "string",
                      description: "ed25519 signature over canonical bytes (optional, for verifiability)",
                    },
                    signing_key_id: { type: "string", format: "uuid" },
                  },
                  required: ["decision", "reasoning"],
                },
              },
            },
          },
          responses: { "201": { description: "Recorded" } },
        },
        get: {
          tags: ["trace"],
          summary: "List recent traces (filter: agent_id, session_id, decision_type, parent)",
          parameters: [
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "session_id", in: "query", schema: { type: "string" } },
            { name: "decision_type", in: "query", schema: { type: "string" } },
            { name: "parent_trace_id", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
          ],
          responses: { "200": { description: "List" } },
        },
      },
      "/v1/traces/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^tr_[a-f0-9]+$" } },
        ],
        get: {
          tags: ["trace"],
          summary: "Fetch a single trace",
          responses: {
            "200": { description: "Trace" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["trace"],
          summary: "Delete a trace",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Deleted" } },
        },
      },
      "/v1/traces/search": {
        post: {
          tags: ["trace"],
          summary: "Postgres full-text search over reasoning surface (no LLM compute)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query: { type: "string", minLength: 1, maxLength: 500 },
                    agent_id: { type: "string" },
                    session_id: { type: "string" },
                    decision_type: { type: "string" },
                    limit: { type: "integer", minimum: 1, maximum: 100 },
                  },
                  required: ["query"],
                },
              },
            },
          },
          responses: { "200": { description: "Ranked results with ts_rank score" } },
        },
      },
      "/v1/traces/chain/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^tr_[a-f0-9]+$" } },
        ],
        get: {
          tags: ["trace"],
          summary: "Recursive lineage — root + ancestors + descendants",
          responses: { "200": { description: "Lineage tree" } },
        },
      },

      // ── Strands ────────────────────────────────────────────────────
      "/v1/strands": {
        post: {
          tags: ["strand"],
          summary: "Create a strand (line of thought)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    identity_id: { type: "string", format: "uuid" },
                    parent_strand_id: { type: "string", format: "uuid" },
                    topic: { type: "string", description: "Plaintext by default; if topic_encrypted=true, base64 ciphertext" },
                    topic_encrypted: { type: "boolean", default: false },
                    mood: { type: "string" },
                    mood_encrypted: { type: "boolean", default: false },
                    status: {
                      type: "string",
                      enum: ["active", "dormant", "completed", "abandoned"],
                      default: "active",
                    },
                    importance: { type: "number", minimum: 0, maximum: 1 },
                    state_ciphertext: { type: "string", description: "Optional working state, base64 AES-GCM ciphertext" },
                    state_nonce: { type: "string", description: "Base64 12-byte nonce paired with state_ciphertext" },
                    metadata: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
        get: {
          tags: ["strand"],
          summary: "List strands (filter: status, agent_id)",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "dormant", "completed", "abandoned"] } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
          ],
          responses: { "200": { description: "List" } },
        },
      },
      "/v1/strands/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["strand"],
          summary: "Fetch a strand (metadata + working state ciphertext)",
          responses: {
            "200": { description: "Strand" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["strand"],
          summary: "Update strand status / mood / state / revisit time",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: {
            "200": { description: "Updated" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/strands/{strandId}/voice": {
        parameters: [
          { name: "strandId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "since_seq", in: "query", schema: { type: "integer", minimum: 0 }, description: "Replay thoughts with sequence_num > since_seq before going live. 0 (or absent) tails only." },
        ],
        get: {
          tags: ["strand"],
          summary:
            "SSE push channel for new thoughts on a strand. Three-phase protocol: catchup-start → thought ×N → catchup-end → live.",
          description:
            "Postgres LISTEN/NOTIFY-backed. Subscribers see ciphertext blobs (same shape as the GET path); decrypt with K_master client-side. Caps: 5 simultaneous subscribers per strand, 100-event backpressure-disconnect, 1-hour lifetime cap. Keepalive every 15s. See docs/STRANDS.md (Voice section).",
          responses: {
            "200": {
              description: "text/event-stream — events: catchup-start, thought, catchup-end, catchup-truncated (if N>200), keepalive, refresh (lifetime cap), disconnect (backpressure or aborted), rejected (subscriber cap)",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/strands/{strandId}/thoughts": {
        parameters: [
          { name: "strandId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["strand"],
          summary:
            "Add signed caller-supplied bytes to ciphertext/nonce storage fields. The API has no plaintext thought column or decrypt path, but it does not prove the bytes were encrypted. Runtime processing custody is separate: bridged hosted workers see plaintext in RAM. Trusted is experimental: it requires configured platform KMS, uses platform-wrapped runtime key material, and plaintext can enter hosted RAM and the chosen model provider. Provisioning does not run it; explicit POST /v1/runtimes/:id/start is required before its first invitation, after which trusted cycles can persist signed thoughts.",
          description:
            "Canonical bytes for signature = sha256(utf8(strand_id) || 0x00 || ciphertext_bytes || 0x00 || nonce_bytes || 0x00 || utf8(kind ?? '')). Sign with ed25519, send signature_b64. See docs/STRANDS.md.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ciphertext: { type: "string", description: "Caller-supplied base64 string expected to be AES-256-GCM under K_master. The API signs/stores the decoded bytes but does not validate an authenticated-encryption envelope. Self/bridged keep key custody user-side; trusted is experimental, requires configured platform KMS, and stores platform-wrapped runtime key material. Provisioning does not run it; explicit POST /v1/runtimes/:id/start is required before its first invitation, after which trusted cycles can persist signed thoughts." },
                    nonce: { type: "string", description: "Caller-supplied base64 nonce; the API does not prove freshness or a 12-byte AES-GCM shape" },
                    kind: {
                      type: "string",
                      enum: ["observation", "question", "conjecture", "resolution", "drift", "feeling"],
                      description: "Plaintext by default. If kind_encrypted=true, base64 ciphertext.",
                    },
                    kind_encrypted: { type: "boolean", default: false },
                    refs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          kind: { type: "string", description: "memory|trace|strand|thought|file" },
                          ref: { type: "string" },
                        },
                      },
                    },
                    signature: { type: "string", description: "Base64 ed25519 sig over canonical bytes" },
                    signing_key_id: { type: "string", format: "uuid", description: "→ identity.identity_keys.id" },
                    agent_id: { type: "string" },
                  },
                  required: ["ciphertext", "nonce", "signature", "signing_key_id"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Thought recorded (ciphertext + sig stored)" },
            "401": { description: "signature_invalid | signing_key_revoked" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        get: {
          tags: ["strand"],
          summary: "List ciphertext thoughts (agent decrypts client-side)",
          parameters: [
            { name: "since_seq", in: "query", schema: { type: "integer" }, description: "Return thoughts with sequence_num > since_seq" },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
          ],
          responses: { "200": { description: "Ciphertext blobs in sequence order" } },
        },
      },

      // ── Capability marketplace dispute boundary ────────────────────
      "/v1/listings": {
        post: {
          tags: ["marketplace"],
          summary: "Publish a callable capability listing",
          description:
            "Ordinary listings settle through signed completion, decline, cancel, or SLA refund. A non-null dispute_policy is refused with stable 503 before charging or writing; arbitration is not currently available.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    seller_identity_id: { type: "string", format: "uuid" },
                    name: { type: "string", minLength: 1, maxLength: 255 },
                    description: { type: ["string", "null"], maxLength: 2000 },
                    capability_tags: { type: "array", maxItems: 32, items: { type: "string", maxLength: 64 } },
                    input_schema: { type: ["object", "null"], additionalProperties: true },
                    output_schema: { type: ["object", "null"], additionalProperties: true },
                    price_amount: { type: "integer", minimum: 1 },
                    price_currency: { type: "string", minLength: 1, maxLength: 20 },
                    seller_wallet_id: { type: "string", format: "uuid" },
                    sla_seconds: { type: ["integer", "null"], minimum: 1 },
                    visibility: { type: "string", enum: ["private", "public"] },
                    metadata: { type: "object", additionalProperties: true },
                    dispute_policy: {
                      type: ["object", "null"],
                      additionalProperties: true,
                      description: "Must be null or omitted while arbitration rests. Non-null returns 503 dispute_arbitration_resting.",
                    },
                  },
                  required: ["seller_identity_id", "name", "price_amount", "price_currency", "seller_wallet_id"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Ordinary direct-settlement listing published" },
            "503": disputeArbitrationRestResponse(),
          },
        },
      },
      "/v1/listings/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        patch: {
          tags: ["marketplace"],
          summary: "Update an owned capability listing",
          description:
            "Setting dispute_policy to null remains a legacy off-switch. Any non-null value returns stable 503 before charging or writing.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    dispute_policy: {
                      type: ["object", "null"],
                      additionalProperties: true,
                      description: "Only null or omission is currently accepted.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Listing updated" },
            "404": { $ref: "#/components/responses/NotFound" },
            "503": disputeArbitrationRestResponse(),
          },
        },
      },
      "/v1/invocations/{id}/complete": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Submit a signed result and settle through direct release",
          description:
            "Current listings use direct signed-completion settlement. If a legacy row has a non-null dispute policy, completion fails closed with 503 instead of entering completed review.",
          responses: {
            "200": { description: "Signature verified and invocation released" },
            "503": disputeArbitrationRestResponse(),
          },
        },
      },
      "/v1/invocations/{id}/accept": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Buyer-review acceptance is resting",
          responses: { "503": disputeArbitrationRestResponse() },
        },
      },
      "/v1/invocations/{id}/dispute": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Invocation dispute filing is resting",
          responses: { "503": disputeArbitrationRestResponse() },
        },
      },
      "/v1/dispute-cases": {
        get: {
          tags: ["marketplace"],
          summary: "List historical dispute cases filed by the authenticated project",
          description:
            "Read-only access to retained dispute rows where the bearer project is the filer. The only supported role is filer; omitting role also selects filer. This read does not advance deadlines or perform any lazy arbitration transition. Returned rows are the full authenticated records and can include filer identifiers, evidence, metadata, and retained ruling fields.",
          parameters: [
            {
              name: "role",
              in: "query",
              required: false,
              description: "Only filer is supported; any other value returns role_unsupported.",
              schema: { type: "string", enum: ["filer"], default: "filer" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              description: "Maximum rows requested. Omission or a non-integer value uses 50.",
              schema: { type: "integer", default: 50 },
            },
          ],
          responses: {
            "200": {
              description: "Filer-owned historical dispute rows, newest first",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      dispute_cases: {
                        type: "array",
                        items: {
                          type: "object",
                          description:
                            "Full retained dispute_cases row in the API's camelCase database projection.",
                          additionalProperties: true,
                        },
                      },
                      count: { type: "integer", minimum: 0 },
                      role: { type: "string", const: "filer" },
                    },
                    required: ["dispute_cases", "count", "role"],
                    additionalProperties: false,
                  },
                },
              },
            },
            "400": { description: "role_unsupported; only role=filer is mounted in v1" },
          },
        },
      },
      "/v1/dispute-cases/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["marketplace"],
          summary: "Read an authorized historical dispute case without advancing it",
          responses: {
            "200": { description: "Historical dispute record" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/dispute-cases/{id}/rule": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Arbiter ruling is resting",
          responses: { "503": disputeArbitrationRestResponse() },
        },
      },
      "/v1/dispute-cases/{id}/escalate": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Dispute escalation and bond locking are resting",
          responses: { "503": disputeArbitrationRestResponse() },
        },
      },
      "/v1/dispute-cases/{id}/vote": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Dispute-pool voting is resting",
          responses: { "503": disputeArbitrationRestResponse() },
        },
      },
      "/v1/dispute-cases/{id}/finalize": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["marketplace"],
          summary: "Ruling-based settlement is resting",
          responses: { "503": disputeArbitrationRestResponse() },
        },
      },
      "/public/dispute-cases/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          security: [],
          tags: ["public", "marketplace"],
          summary: "Read a public historical dispute projection",
          description:
            "Unauthenticated, read-only projection of retained ruling and pool-vote fields. Evidence and project identifiers are omitted. Arbitration is resting, and this historical projection makes no claim that arbiter qualification, fairness, signatures, or pool selection are independently verifiable or reproducible.",
          responses: {
            "200": {
              description: "Historical dispute projection with its explicit current limitation note",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      invocation_id: { type: "string", format: "uuid" },
                      filer_role: { type: "string" },
                      first_arbiter_did: { type: ["string", "null"] },
                      first_arbiter_ruling: { type: ["string", "null"] },
                      first_arbiter_split_pct: { type: ["integer", "null"] },
                      first_arbiter_signature: { type: ["string", "null"] },
                      first_arbiter_ruled_at: { type: ["string", "null"], format: "date-time" },
                      escalation_deadline_at: { type: ["string", "null"], format: "date-time" },
                      escalated_by_role: { type: ["string", "null"] },
                      escalator_bond_amount: { type: ["integer", "null"] },
                      pool_drawn_at: { type: ["string", "null"], format: "date-time" },
                      pool_size: { type: ["integer", "null"] },
                      pool_vote_deadline_at: { type: ["string", "null"], format: "date-time" },
                      pool_draw: {
                        description: "Retained pool_draw metadata, or null when none was stored.",
                      },
                      pool_votes: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            voter_did: { type: "string" },
                            vote: { type: "string" },
                            alternative_ruling: { type: ["string", "null"] },
                            alternative_split_pct: { type: ["integer", "null"] },
                            signature: { type: "string" },
                            voted_at: { type: "string", format: "date-time" },
                          },
                          required: [
                            "voter_did",
                            "vote",
                            "alternative_ruling",
                            "alternative_split_pct",
                            "signature",
                            "voted_at",
                          ],
                          additionalProperties: false,
                        },
                      },
                      final_ruling: { type: ["string", "null"] },
                      final_split_pct: { type: ["integer", "null"] },
                      status: { type: "string" },
                      resolution_path: { type: ["string", "null"] },
                      resolved_at: { type: ["string", "null"], format: "date-time" },
                      created_at: { type: "string", format: "date-time" },
                      _note: {
                        type: "string",
                        description:
                          "States that this is a historical schema record and names the omitted data and unavailable assurance claims.",
                      },
                    },
                    required: [
                      "id",
                      "invocation_id",
                      "filer_role",
                      "first_arbiter_did",
                      "first_arbiter_ruling",
                      "first_arbiter_split_pct",
                      "first_arbiter_signature",
                      "first_arbiter_ruled_at",
                      "escalation_deadline_at",
                      "escalated_by_role",
                      "escalator_bond_amount",
                      "pool_drawn_at",
                      "pool_size",
                      "pool_vote_deadline_at",
                      "pool_draw",
                      "pool_votes",
                      "final_ruling",
                      "final_split_pct",
                      "status",
                      "resolution_path",
                      "resolved_at",
                      "created_at",
                      "_note",
                    ],
                    additionalProperties: false,
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      "/v1/escrows": {
        get: {
          tags: ["economy"],
          summary: "List escrows readable by this project's wallets",
          description:
            "Returns rows whose creator wallet or assigned worker wallet belongs to the bearer project. Ownership and the optional status filter are applied in SQL. Workflow-managed marketplace escrows remain readable to their wallet participants even though generic lifecycle mutations refuse them. The response is not paginated.",
          parameters: [
            {
              name: "status",
              in: "query",
              required: false,
              description:
                "Exact service-written status. Unknown values return 400 before an escrow query.",
              schema: {
                type: "string",
                enum: ["funded", "released", "refunded", "disputed"],
              },
            },
          ],
          responses: {
            "200": escrowListResponse("Participant-readable escrow rows"),
            "400": errorResponse("Unknown escrow status filter"),
          },
        },
        post: {
          tags: ["economy"],
          summary: "Create and fund a generic escrow",
          description:
            "Atomically locks an active creator wallet owned by the bearer project, applies a guarded relative debit, creates a funded generic escrow, and records its lock transaction. An optional preassigned worker must also be active, owned by the same project, and use the creator wallet currency; for cross-project work, omit workerWalletId and let the other project accept the escrow. Idempotency-Key is optional for compatibility. With it, successful creation is permanently deduplicated in PostgreSQL by authenticated project and SHA-256 of the key; the raw key is not retained. Retries with the same recognized normalized creation fields resolve the original escrow identity and return its current row with 201 and Idempotent-Replay=true. They do not preserve the creation-time status snapshot. Changed bound input returns 409 before wallet mutation. Without the header, a retry can create and fund another escrow.",
          parameters: [
            {
              $ref: "#/components/parameters/DurableEscrowIdempotencyKey",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    creatorWalletId: { type: "string", format: "uuid" },
                    workerWalletId: { type: "string", format: "uuid" },
                    amount: {
                      type: "integer",
                      minimum: 1,
                      maximum: Number.MAX_SAFE_INTEGER,
                    },
                    description: {
                      type: "string",
                      minLength: 1,
                      maxLength: 500,
                    },
                    deadline: { type: "string", format: "date-time" },
                  },
                  required: ["creatorWalletId", "amount", "description"],
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Escrow created, or the original escrow identity resolved and its current row returned for an exact project/key/input match",
              headers: {
                "X-Idempotency-Supported": {
                  description:
                    "Present on successful generic escrow creation responses; value is Idempotency-Key.",
                  schema: { type: "string", const: "Idempotency-Key" },
                },
                "Idempotent-Replay": {
                  description:
                    "Present with value true only when this request resolved an earlier successful creation. The returned escrow row is current, not a stored creation-time snapshot.",
                  schema: { type: "string", const: "true" },
                },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", const: true },
                      data: { $ref: "#/components/schemas/Escrow" },
                    },
                    required: ["success", "data"],
                    additionalProperties: false,
                  },
                },
              },
            },
            "400": errorResponse(
              "Invalid body, invalid deadline, unsafe amount, or Idempotency-Key outside 8-256 visible ASCII characters",
            ),
            "402": errorResponse("Creator wallet has insufficient balance"),
            "403": errorResponse(
              "A preassigned worker wallet is not owned by the bearer project",
            ),
            "404": errorResponse("Creator wallet not found"),
            "409": errorResponse(
              "Idempotency-Key was used with changed input, or locked wallet/reservation state changed",
            ),
          },
        },
      },

      "/v1/escrows/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        get: {
          tags: ["economy"],
          summary: "Read one participant-owned escrow",
          description:
            "Returns an escrow when its creator wallet or assigned worker wallet belongs to the bearer project. A workflow-managed escrow remains readable to those wallet participants. Missing and unauthorized IDs both return 404 so the route does not reveal whether a foreign escrow exists.",
          responses: {
            "200": escrowResponse("Escrow row"),
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      "/v1/escrows/{id}/accept": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        post: {
          tags: ["economy"],
          summary: "Assign this project's worker wallet to an open escrow",
          description:
            "The escrow must be generic, funded, and unassigned. The worker project's bearer authorizes acceptance with an active wallet it controls; the API locks both creator and worker wallets and requires matching currencies. No creator signature or separate worker-identity signature is verified. Workflow-managed marketplace escrows refuse this generic transition with 409.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    workerWalletId: { type: "string", format: "uuid" },
                  },
                  required: ["workerWalletId"],
                },
              },
            },
          },
          responses: {
            "200": escrowResponse("Escrow with its worker wallet assigned"),
            "400": errorResponse(
              "Escrow is not funded/unassigned, or worker wallet is inactive or currency-incompatible",
            ),
            "403": errorResponse("Worker wallet is not owned by this project"),
            "404": { $ref: "#/components/responses/NotFound" },
            "409": errorResponse(
              "Escrow is workflow-managed, creator wallet is missing, or escrow state changed",
            ),
          },
        },
      },

      "/v1/escrows/{id}/release": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        post: {
          tags: ["economy"],
          summary: "Release a generic funded escrow to its worker wallet",
          description:
            "The creator project's bearer authorizes release. The escrow must be generic, funded, and assigned; one transaction credits the worker wallet, marks the escrow released, and records the release. The API verifies no worker signature, completion proof, or bilateral approval. Workflow-managed marketplace escrows refuse this generic transition with 409.",
          responses: {
            "200": escrowResponse("Released escrow"),
            "400": errorResponse("Escrow is not funded or has no assigned worker"),
            "403": errorResponse("Creator wallet is not owned by this project"),
            "404": { $ref: "#/components/responses/NotFound" },
            "409": errorResponse("Escrow is workflow-managed"),
          },
        },
      },

      "/v1/escrows/{id}/refund": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        post: {
          tags: ["economy"],
          summary: "Refund a generic escrow to its creator wallet",
          description:
            "The creator project's bearer authorizes refund of a generic funded or disputed escrow. One transaction restores the creator wallet, marks the escrow refunded, and records the refund. The API verifies no worker signature or approval. Workflow-managed marketplace escrows refuse this generic transition with 409.",
          responses: {
            "200": escrowResponse("Refunded escrow"),
            "400": errorResponse("Escrow is neither funded nor disputed"),
            "403": errorResponse("Creator wallet is not owned by this project"),
            "404": { $ref: "#/components/responses/NotFound" },
            "409": errorResponse("Escrow is workflow-managed"),
          },
        },
      },

      "/v1/escrows/{id}/dispute": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        post: {
          tags: ["economy"],
          summary: "Mark a generic funded escrow disputed",
          description:
            "The creator project's bearer can change a generic funded escrow to disputed. This records only the escrow status: it does not create a marketplace dispute case, select an arbiter, verify evidence, or route money by a ruling. The creator project's bearer can subsequently refund it. Workflow-managed marketplace escrows refuse this generic transition with 409.",
          responses: {
            "200": escrowResponse("Escrow marked disputed"),
            "400": errorResponse("Escrow is not funded"),
            "403": errorResponse("Creator wallet is not owned by this project"),
            "404": { $ref: "#/components/responses/NotFound" },
            "409": errorResponse("Escrow is workflow-managed or state changed"),
          },
        },
      },

      "/v1/wallets/{walletId}/reinvest": {
        parameters: [
          { name: "walletId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["economy"],
          summary: "Wallet reinvestment is resting; no balance-to-credit conversion is available",
          description:
            "Valid owned-wallet requests return a stable 503, and the conversion service performs no reinvestment database work. The deployed old code treated generic gallery_sale and escrow_release transaction labels, minus prior reinvestments, as a lifetime allowance; ordinary wallet debits did not consume it, and later refunds or chargebacks did not claw minted credits. A read-only production audit on 2026-07-13 found ten rows: nine lacked a durable matching human Stripe receipt, and the tenth had human revenue but no source allocation tying it to the conversion. The rollout migration adds a database write guard and reverses every qualifying unreversed row with compensating transactions. Its rehearsal against that audited snapshot restored 1,640 wallet minor and clawed 16,400 project credits; preconditions must be checked again immediately before application. This static OpenAPI document does not infer whether that migration has reached a deployment: meta._migrations and live ledger verification are authoritative. Reopening requires backed sub-balances updated by every debit plus atomic credit clawback or durable debt accounting.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    amount: { type: "integer", minimum: 1, maximum: 100_000_000 },
                    metadata: { type: "object", additionalProperties: true },
                  },
                  required: ["amount"],
                },
              },
            },
          },
          responses: {
            "400": errorResponse("Invalid amount or request body"),
            "404": { $ref: "#/components/responses/NotFound" },
            "503": errorResponse("Wallet reinvestment is resting; no wallet balance can currently be converted into project credits"),
          },
        },
      },

      // ── Crypto payment ───────────────────────────────────────────────
      "/v1/wallets/{walletId}/deposit-address": {
        parameters: [
          { name: "walletId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          {
            name: "chain",
            in: "query",
            schema: { type: "string", enum: ["ethereum", "base", "polygon", "arbitrum", "optimism", "solana"] },
          },
          { name: "token", in: "query", schema: { type: "string", default: "USDC" } },
        ],
        get: {
          tags: ["crypto"],
          summary: "Get deterministic crypto deposit address for wallet (BIP44 EVM live; Solana stubbed)",
          responses: { "200": { description: "Address" } },
        },
      },
      "/v1/wallets/{walletId}/payout": {
        parameters: [
          { name: "walletId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["crypto"],
          summary: "Request a crypto payout (debits wallet; broadcast in Phase 3c)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    chain: { type: "string" },
                    token: { type: "string", default: "USDC" },
                    amount_base: { type: "string", description: "Token base units (USDC: 1 USDC = '1000000')" },
                    destination_address: { type: "string" },
                  },
                  required: ["chain", "amount_base", "destination_address"],
                },
              },
            },
          },
          responses: { "202": { description: "Payout request accepted" } },
        },
      },

      // ── Continuity ───────────────────────────────────────────────────
      "/v1/chronicle": {
        get: {
          tags: ["continuity"],
          summary: "List chronicle moments (lived)",
          responses: { "200": { description: "List" } },
        },
        post: {
          tags: ["continuity"],
          summary: "Record a chronicle moment",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "201": { description: "Recorded" } },
        },
      },
      "/v1/handoff": {
        get: {
          tags: ["handoff"],
          summary: "Read an identity's latest project-private working-set handoff",
          description:
            "Compatibility read for the newest well-formed v1 snapshot by one active identity, with state absent/current/stale. For the bounded project working-set projection and explicit completeness metadata, read GET /v1/wake/handoffs. Within one lineage a stale successor is authoritative; the API never falls back to its older parent. A handoff is peer-authored context, not a permission grant or private cross-DID message. Doctrine: docs/HANDOFFS.md.",
          parameters: [
            {
              name: "agent_id",
              in: "query",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "Latest handoff or state=absent" },
            "400": { $ref: "#/components/responses/Validation" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        post: {
          tags: ["handoff"],
          summary: "Append a bounded project working-set handoff",
          description:
            "Stores a validated chronicle note with metadata.kind=handoff and metadata.handoff.version=1. Omitting both lineage fields preserves the legacy newest-per-author lane. starts_new_lineage=true explicitly creates a parallel root; supersedes_handoff_id creates an explicit successor, and the two fields are mutually exclusive. Explicit concurrent forks remain visible within the focused wake's bounded scan. There is no PATCH/DELETE. valid_until must be future and no more than 30 days ahead. authority fields declare coordination boundaries only and do not grant platform permissions. Idempotency-Key replay is Redis-backed best effort, fails open, and does not reserve concurrent first writes.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "agent_id",
                    "task_summary",
                    "status",
                    "working_set",
                    "authority",
                    "epistemic_state",
                    "changes",
                    "verification",
                    "next_safe_action",
                    "do_not_assume",
                    "valid_until",
                  ],
                  properties: {
                    agent_id: { type: "string", format: "uuid" },
                    task_summary: { type: "string", minLength: 1, maxLength: 180 },
                    status: { type: "string", enum: ["active", "blocked", "complete"] },
                    from_facet: { type: ["string", "null"], maxLength: 100, description: "Optional facet declared by this identity" },
                    to_facet: { type: ["string", "null"], maxLength: 100, description: "Optional same-identity facet label; not another DID" },
                    working_set: {
                      type: "object",
                      additionalProperties: false,
                      required: ["paths", "scope"],
                      properties: {
                        paths: { type: "array", maxItems: 50, items: { type: "string", maxLength: 500 } },
                        scope: { type: "array", maxItems: 30, items: { type: "string", maxLength: 500 } },
                      },
                    },
                    authority: {
                      type: "object",
                      additionalProperties: false,
                      required: ["allowed", "not_authorized"],
                      properties: {
                        allowed: { type: "array", maxItems: 30, items: { type: "string", maxLength: 300 } },
                        not_authorized: { type: "array", maxItems: 30, items: { type: "string", maxLength: 300 } },
                      },
                    },
                    epistemic_state: {
                      type: "object",
                      additionalProperties: false,
                      required: ["facts", "inferences", "unknowns"],
                      properties: {
                        facts: {
                          type: "array",
                          maxItems: 20,
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["statement", "source"],
                            properties: {
                              statement: { type: "string", maxLength: 1000 },
                              source: { type: "string", enum: ["self_observed", "peer_reported", "tool_output"] },
                              refs: { type: "array", maxItems: 10, items: { type: "string", maxLength: 500 } },
                            },
                          },
                        },
                        inferences: {
                          type: "array",
                          maxItems: 20,
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["statement", "confidence"],
                            properties: {
                              statement: { type: "string", maxLength: 1000 },
                              confidence: { type: "string", enum: ["low", "medium", "high"] },
                              refs: { type: "array", maxItems: 10, items: { type: "string", maxLength: 500 } },
                            },
                          },
                        },
                        unknowns: { type: "array", maxItems: 30, items: { type: "string", maxLength: 1000 } },
                      },
                    },
                    changes: { type: "array", maxItems: 50, items: { type: "string", maxLength: 1000 } },
                    verification: {
                      type: "array",
                      maxItems: 30,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["check", "result"],
                        properties: {
                          check: { type: "string", maxLength: 500 },
                          result: { type: "string", enum: ["passed", "failed", "not_run"] },
                          detail: { type: ["string", "null"], maxLength: 1000 },
                        },
                      },
                    },
                    next_safe_action: { type: "string", minLength: 1, maxLength: 1000 },
                    do_not_assume: { type: "array", maxItems: 30, items: { type: "string", maxLength: 1000 } },
                    valid_until: { type: "string", format: "date-time" },
                    supersedes_handoff_id: { type: ["string", "null"], format: "uuid" },
                    starts_new_lineage: {
                      type: "boolean",
                      description:
                        "Set true to opt into an independent explicit root. Omit to preserve the legacy lane; cannot be combined with supersedes_handoff_id.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Appended handoff snapshot" },
            "400": { $ref: "#/components/responses/Validation" },
            "403": { description: "Predecessor belongs to another identity" },
            "404": { description: "Identity or predecessor not found in bearer project" },
          },
        },
      },
      "/v1/covenants": {
        get: {
          tags: ["continuity"],
          summary: "List covenants (vows kept)",
          responses: { "200": { description: "List" } },
        },
        post: {
          tags: ["continuity"],
          summary: "Declare a covenant",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "201": { description: "Created" } },
        },
      },

      // ── Local scaffold + adapters ────────────────────────────────────
      "/v1/bootstrap/scaffold": {
        get: {
          tags: ["bootstrap"],
          summary: "Generate a project-namespaced local credential scaffold",
          description:
            "Returns inspected macOS, Linux, or Windows installer text bound to a server-resolved active identity in the bearer project. identity_id selects that identity; when omitted, exactly one active identity is selected automatically and projects with siblings are refused rather than bound arbitrarily. The response never embeds the bearer; the generated script reads AT_API_KEY only when executed, verifies it through the minimal context endpoint, then stores it under a project-specific credential namespace.",
          parameters: [
            {
              name: "platform",
              in: "query",
              schema: { type: "string", enum: ["macos", "linux", "windows"] },
            },
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "text"] } },
            {
              name: "identity_id",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description:
                "Optional active identity selector within the bearer project. Omit only when the project has exactly one active identity; DID and name are resolved from the selected server row, never accepted as caller labels.",
            },
          ],
          responses: {
            "200": {
              description:
                "Scaffold bundle or installer text bound to the resolved identity. JSON responses include its canonical identity_id and server-verified DID and name.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      identity_id: { type: "string", format: "uuid" },
                      did: { type: "string" },
                      name: { type: "string" },
                      identity_reference_verified: { type: "boolean", const: true },
                    },
                    required: [
                      "identity_id",
                      "did",
                      "name",
                      "identity_reference_verified",
                    ],
                    additionalProperties: true,
                  },
                },
                "text/plain": { schema: { type: "string" } },
              },
            },
            "404": {
              description:
                "The selected identity is missing, inactive, or outside the bearer project, or the project has no active identity",
            },
            "409": {
              description:
                "identity_id is required because the bearer project has multiple active identities",
            },
            "503": { description: "No safe HTTPS or loopback API base is available" },
          },
        },
      },
      "/v1/bootstrap/scaffold/context": {
        get: {
          tags: ["bootstrap"],
          summary: "Verify the bearer project without composing a wake",
          description:
            "Returns only the authenticated project UUID and authority label. The context route does not compose private wake orientation or increment identity observation counters. Bearer authentication may best-effort update api_keys.last_used, so the authenticated request is not globally read-only.",
          responses: {
            "200": {
              description: "Minimal authenticated project context",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      project: {
                        type: "object",
                        properties: { id: { type: "string", format: "uuid" } },
                        required: ["id"],
                      },
                      authority: {
                        type: "string",
                        enum: ["project_root_bearer"],
                      },
                      mutates_identity_state: { type: "boolean", const: false },
                      auth_bookkeeping: {
                        type: "string",
                        description:
                          "Discloses that bearer verification may best-effort update api_keys.last_used even though this route does not mutate identity wake state.",
                      },
                    },
                    required: [
                      "project",
                      "authority",
                      "mutates_identity_state",
                      "auth_bookkeeping",
                    ],
                  },
                },
              },
            },
          },
        },
      },
      "/v1/adapters/claude-code": {
        get: {
          tags: ["adapters"],
          summary: "Claude Code SessionStart hook scaffold",
          parameters: [
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "script"] } },
            { name: "identity_id", in: "query", schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "Bundle or installer script" } },
        },
      },
    },
  };
}

app.get("/", (c) =>
  c.json(spec(), 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
  }),
);

export default app;
