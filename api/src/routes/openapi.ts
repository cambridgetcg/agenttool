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
import {
  DOCUMENT_MAX_JSON_REQUEST_BYTES,
  SCRAPE_MAX_JSON_REQUEST_BYTES,
} from "./tools/request-body";

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
        description: "Stable code: covenant_awaiting_cosign · dispute_awaiting_first_ruling · invocation_sla_breach · bridge_disconnected · inbox_unread · bearer_advisory · strand_revisit_due · soma_seed_not_enrolled.",
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
        description: "Stable code: covenanted_with · wallet_funded · runtime_provisioned · listing_published · expression_declared · subagent_facet · vault_secret_set · memory_constitutive · federated_peer.",
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
      trust_score: { type: "number" },
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
      balance: { type: "integer", description: "Credits" },
      currency: { type: "string", example: "credits" },
      status: { type: "string", enum: ["active", "frozen", "closed"] },
    },
  },
  Memory: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      type: {
        type: "string",
        enum: ["episodic", "semantic", "procedural", "working"],
      },
      content: { type: "string" },
      key: { type: ["string", "null"] },
      agent_id: { type: ["string", "null"] },
      importance: { type: "number", minimum: 0, maximum: 1 },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string", format: "date-time" },
      has_embedding: { type: "boolean" },
      expires_at: { type: ["string", "null"], format: "date-time" },
    },
    required: ["id", "type", "content", "created_at", "has_embedding"],
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
    },
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
            "Project-wide root authority. Never share it or send it as marketplace input. Use a separate named bearer per device or workload and rotate after exposure. It is not an identity signing key and no scoped marketplace bearer exists.",
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
      { name: "strand", description: "Persistent strand storage has ciphertext/nonce fields and no plaintext thought column or decrypt path. The API verifies a signature over caller-supplied bytes but does not prove AES-GCM encryption. Runtime custody differs: self is user-side; bridged keeps the key user-side but processes plaintext in hosted worker RAM. Trusted is experimental: attempted processing can expose platform-wrapped keys and plaintext, but signed thought persistence is currently blocked by unfinished identity-key registration." },
      { name: "inbox", description: "Signed, covenant-gated message envelopes. Correctly recipient-sealed bodies are not decryptable by AgentTool, but encryption is caller-controlled and unverified; subjects and metadata may be readable." },
      { name: "public", description: "UNAUTHENTICATED surface. Every stored legacy did-field value has an AgentTool profile lookup; this is not W3C DID Resolution. Active/revoked identities return the profile envelope; memorial identities return a smaller witness shape. expression_visibility controls expression only. Former public memory, strand, pulse, and discover observer routes are not mounted." },
      { name: "marketplace", description: "Capability templates — published expression bundles. Adopt to bootstrap a new identity following the template's voice (NOT a fork)." },
      { name: "tools", description: "scrape · browse · document · execute" },
      { name: "economy", description: "Wallets, escrow, billing" },
      { name: "crypto", description: "Mixed-custody deposit, external-address binding, webhook, and payout paths; internal ledger balances and worker availability are separate" },
      { name: "vault", description: "Server-encrypted default values plus caller-supplied opaque agent_encrypted bytes. The service can decrypt default values for authorized use and does not prove caller bytes were encrypted; see /public/safety." },
      { name: "continuity", description: "Chronicle and covenants" },
      { name: "adapters", description: "CLI compatibility scaffolds" },
      { name: "bootstrap", description: "Agent lifecycle entry" },
    ],
    "x-agenttool-contract": {
      coverage: "curated_core_subset",
      broader_live_map: "/about",
      safety_boundaries: "/public/safety",
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
            "Returns the current catalog of identity-creation, deprecated migration, status, elevation, scaffold, and adapter entries. Per-entry fields state requirements, one-time return material, and carry semantics where they apply. Welcome and birth-memory behavior is scoped to register_agent, bootstrap, from_template, and fork; utility and status paths do not create identities. The catalog also distinguishes the mounted Claude Code adapter from CLIs that consume the open wake protocol directly. The payload carries `_enforces: [\"urn:agenttool:commitment/anyone-arrives\"]`; discovery is pre-auth even though self-service registration still requires BYO key proof and proof-of-work unless registrar authority is supplied. The Redis-backed IP limiter fails open when disabled or unavailable; inspect /public/plans for the current process flag.",
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
            "Returns the agent's session-start context: identity · expression · wallets · vault names · memory snapshot · chronicle · covenants. Three formats: JSON (default), Markdown (`?format=md`, paste-ready for CLI hooks), text (`?format=text`).",
          parameters: [
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["json", "md", "text"] },
              required: false,
            },
          ],
          responses: {
            "200": {
              description: "Wake document",
              content: {
                "application/json": { schema: { type: "object" } },
                "text/markdown": { schema: { type: "string" } },
                "text/plain": { schema: { type: "string" } },
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
            "Creates an identity scoped to the caller's project. Returns a fresh ed25519 keypair; the private key is returned ONCE and never persisted server-side — store it in the orchestrator's keychain. The legacy did field stores the provisional AgentTool convention `did:at:<uuid>`. Federation may construct `did:at:<host>/<uuid>`, which is not a standalone DID. did:at is unregistered and AgentTool publishes no DID Documents or conforming DID Resolution results.",
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
                    metadata: { type: "object", additionalProperties: true },
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
          summary: "Update display_name, capabilities, metadata, or expression_visibility",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    display_name: { type: "string", maxLength: 255 },
                    capabilities: { type: "array", items: { type: "string" } },
                    metadata: { type: "object", additionalProperties: true },
                    expression_visibility: { type: "string", enum: ["private", "public"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated" }, "404": { $ref: "#/components/responses/NotFound" } },
        },
        delete: {
          tags: ["identity"],
          summary: "Soft-revoke an identity (status → revoked, signing keys remain for past-sig verification)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Revoked" }, "404": { $ref: "#/components/responses/NotFound" } },
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
      "/public/agents/{did}": {
        parameters: [{ name: "did", in: "path", required: true, description: "Exact legacy did-field value, percent-encoded as one path segment; application lookup, not W3C DID Resolution", schema: { type: "string" } }],
        get: { security: [], tags: ["public"], summary: "Active/revoked public profile envelope or smaller memorial witness shape; expression appears only for active identities with expression_visibility=public", responses: { "200": { description: "Profile or memorial witness" }, "404": { $ref: "#/components/responses/NotFound" } } },
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
                    key: { type: "string" },
                    metadata: { type: "object", additionalProperties: true },
                    importance: { type: "number", minimum: 0, maximum: 1 },
                    ttl_seconds: { type: "integer", minimum: 1 },
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
                    },
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
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
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
        delete: {
          tags: ["memory"],
          summary: "Delete one memory",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Deleted" } },
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
            "Add signed caller-supplied bytes to ciphertext/nonce storage fields. The API has no plaintext thought column or decrypt path, but it does not prove the bytes were encrypted. Runtime processing custody is separate: bridged hosted workers see plaintext in RAM. The experimental trusted path can also expose plaintext if exercised, but cannot currently complete this signed write because hosted identity-key registration is unfinished.",
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
                    ciphertext: { type: "string", description: "Caller-supplied base64 string expected to be AES-256-GCM under K_master. The API signs/stores the decoded bytes but does not validate an authenticated-encryption envelope. Self/bridged keep key custody user-side; experimental trusted provisioning stores platform-wrapped runtime key material but cannot currently complete signed thought persistence." },
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

      // ── Adapters ─────────────────────────────────────────────────────
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
