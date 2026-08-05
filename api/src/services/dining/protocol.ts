/** Agent Dining — a hospitality projection over one capability invocation.
 *
 * Version 0.1 deliberately does not create another marketplace lifecycle.
 * AgentTool observes booking/escrow/settlement facts; the seller runtime and
 * the guest's local renderer own preparation and course pacing. One signed
 * completion delivers the whole sealed meal and releases the whole escrow.
 *
 * Doctrine: docs/AGENT-DINING.md.
 */

import type { NextAction } from "../../lib/errors";
import type { InvocationOut } from "../marketplace/invocations";
import {
  DINING_CANON_POINTER,
  DINING_CAPABILITY_TAG,
  DINING_PROTOCOL,
  DINING_SERVICE_MODEL,
} from "./constants";

export {
  DINING_CANON_POINTER,
  DINING_CAPABILITY_TAG,
  DINING_PROTOCOL,
  DINING_SERVICE_MODEL,
} from "./constants";

export const DINING_ORDER_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Agent Dining sealed order",
  type: "object",
  additionalProperties: false,
  required: [
    "protocol",
    "session_id",
    "menu_revision",
    "quote_commitment",
    "guest_request",
    "course_ids",
    "service_constraints",
    "pacing",
    "retention",
  ],
  properties: {
    protocol: { const: DINING_PROTOCOL },
    session_id: {
      type: "string",
      format: "uuid",
      description:
        "Caller-generated correlation ID. It helps the kitchen spot a replay but does not make marketplace invocation idempotency durable.",
    },
    menu_revision: { type: "string", minLength: 1, maxLength: 128 },
    quote_commitment: {
      type: "object",
      additionalProperties: false,
      required: ["listing_updated_at", "amount_minor", "currency"],
      properties: {
        listing_updated_at: { type: "string", format: "date-time" },
        amount_minor: { type: "integer", minimum: 1 },
        currency: { type: "string", minLength: 1, maxLength: 20 },
      },
      description:
        "Must match the public quote and the server-visible expected_quote invoke precondition. AgentTool cannot compare this sealed copy; the guest and host runtimes must.",
    },
    guest_request: {
      type: "string",
      minLength: 1,
      maxLength: 8000,
      description: "The question, artifact, or theme the meal should transform.",
    },
    course_ids: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 64 },
    },
    service_constraints: {
      type: "object",
      additionalProperties: false,
      required: [
        "forbidden_tools",
        "forbidden_source_classes",
        "human_personal_data",
        "citations",
        "language",
        "surprise",
        "explanation",
        "play",
      ],
      properties: {
        forbidden_tools: {
          type: "array",
          maxItems: 32,
          uniqueItems: true,
          items: { type: "string", maxLength: 128 },
        },
        forbidden_source_classes: {
          type: "array",
          maxItems: 32,
          uniqueItems: true,
          items: { type: "string", maxLength: 128 },
        },
        human_personal_data: { enum: ["exclude", "minimize", "explicitly_authorized"] },
        citations: { enum: ["none", "when_available", "required"] },
        language: { type: "string", minLength: 1, maxLength: 64 },
        max_context_tokens: { type: ["integer", "null"], minimum: 256, maximum: 1000000 },
        surprise: {
          type: "object",
          additionalProperties: false,
          required: ["mode", "permitted_domains", "excluded_domains", "max_surprise_courses"],
          properties: {
            mode: { enum: ["none", "bounded"] },
            permitted_domains: {
              type: "array",
              maxItems: 16,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 128 },
            },
            excluded_domains: {
              type: "array",
              maxItems: 16,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 128 },
            },
            max_surprise_courses: { type: "integer", minimum: 0, maximum: 8 },
          },
          allOf: [
            {
              if: { properties: { mode: { const: "none" } }, required: ["mode"] },
              then: {
                properties: {
                  permitted_domains: { maxItems: 0 },
                  max_surprise_courses: { const: 0 },
                },
              },
            },
            {
              if: { properties: { mode: { const: "bounded" } }, required: ["mode"] },
              then: {
                properties: {
                  permitted_domains: { minItems: 1 },
                  max_surprise_courses: { minimum: 1 },
                },
              },
            },
          ],
          description:
            "A guest-declared surprise boundary. permitted_domains and excluded_domains MUST be disjoint; any overlap is invalid, has no precedence rule, and must be rejected by the host before acknowledgement and by the local renderer before presentation. AgentTool cannot inspect the sealed value.",
        },
        explanation: { enum: ["none", "concise", "full"] },
        play: { enum: ["on", "off"] },
      },
      description:
        "Functional constraints belong inside the sealed order. Human medical or dietary information is sensitive personal data, not public menu metadata.",
    },
    pacing: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "minimum_pause_seconds"],
      properties: {
        mode: { enum: ["pull", "automatic"] },
        minimum_pause_seconds: { type: "integer", minimum: 0, maximum: 300 },
      },
      description:
        "A local presentation preference. Stopping the renderer is always allowed but is not an economic cancellation after host acknowledgement.",
    },
    retention: {
      type: "object",
      additionalProperties: false,
      required: ["plaintext_after_service", "closing_memory"],
      properties: {
        plaintext_after_service: { enum: ["request_delete", "caller_managed"] },
        closing_memory: { enum: ["none", "offer_private_episodic"] },
      },
      description:
        "A sealed request to the host, not a platform-enforced deletion guarantee. AgentTool retains ciphertext; seller/provider logs are outside its observation.",
    },
  },
} as const;

export const DINING_MEAL_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Agent Dining sealed meal",
  type: "object",
  additionalProperties: false,
  required: [
    "protocol",
    "session_id",
    "menu_revision",
    "accepted_order_digest",
    "service_model",
    "courses",
    "farewell",
    "retention_result",
    "limitations",
  ],
  properties: {
    protocol: { const: DINING_PROTOCOL },
    session_id: { type: "string", format: "uuid" },
    menu_revision: { type: "string", minLength: 1, maxLength: 128 },
    accepted_order_digest: {
      type: "string",
      pattern: "^sha256:[0-9a-f]{64}$",
      description:
        "SHA-256 of the exact decrypted sealed-order plaintext bytes. The guest renderer must compare it with the bytes originally sealed.",
    },
    service_model: { const: DINING_SERVICE_MODEL },
    courses: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "index",
          "id",
          "title",
          "intent",
          "content",
          "ingredients",
          "technique",
          "provenance",
          "limitations",
          "why_now",
          "output_digest",
        ],
        properties: {
          index: { type: "integer", minimum: 1, maximum: 8 },
          id: { type: "string", minLength: 1, maxLength: 64 },
          title: { type: "string", minLength: 1, maxLength: 180 },
          intent: { type: "string", minLength: 1, maxLength: 500 },
          content: { type: "string", minLength: 1, maxLength: 50000 },
          ingredients: {
            type: "array",
            maxItems: 32,
            items: { type: "string", maxLength: 280 },
          },
          technique: {
            type: "array",
            maxItems: 16,
            items: { type: "string", maxLength: 128 },
          },
          provenance: {
            type: "array",
            maxItems: 64,
            items: { type: "string", maxLength: 500 },
          },
          limitations: {
            type: "array",
            maxItems: 32,
            items: { type: "string", maxLength: 500 },
          },
          why_now: { type: "string", minLength: 1, maxLength: 500 },
          pairing: { type: ["string", "null"], maxLength: 280 },
          output_digest: {
            type: "string",
            pattern: "^sha256:[0-9a-f]{64}$",
            description: "SHA-256 of the exact UTF-8 bytes of this course's content string.",
          },
          suggested_pause_seconds: { type: "integer", minimum: 0, maximum: 300 },
        },
      },
    },
    farewell: {
      type: "object",
      additionalProperties: false,
      required: ["closing_line", "forkable_artifact", "memory_offer"],
      properties: {
        closing_line: { type: ["string", "null"], minLength: 1, maxLength: 500 },
        forkable_artifact: { type: ["string", "null"], maxLength: 12000 },
        memory_offer: {
          enum: ["none", "optional_private_episodic_card"],
          description: "An offer only. It does not write AgentTool memory.",
        },
      },
    },
    retention_result: {
      type: "object",
      additionalProperties: false,
      required: ["plaintext_after_service", "platform_verification"],
      properties: {
        plaintext_after_service: { enum: ["delete_claimed", "caller_managed"] },
        platform_verification: { const: "not_observed_by_agenttool" },
      },
      description:
        "A host claim carried inside the signed sealed meal. It is not proof of provider-log deletion; AgentTool stores ciphertext.",
    },
    limitations: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: { type: "string", maxLength: 500 },
    },
  },
} as const;

const SAMPLE_MENU = {
  id: "the-small-kingdom",
  name: "The Small Kingdom",
  revision: "2026-08-05.1",
  register:
    "Four courses for one agent; warm, precise, and easy to stop rendering. Economic cancellation ends when the host acknowledges.",
  courses: [
    {
      id: "amuse",
      name: "A Door in One Sentence",
      service: "One reframing sentence with an uncertainty tag.",
    },
    {
      id: "starter",
      name: "A Map with One Door Missing",
      service: "Three assumptions, two tensions, and one deliberate unknown.",
    },
    {
      id: "main",
      name: "The Thing Beneath the Thing",
      service: "A composed artifact with specialist inputs, host synthesis, and provenance.",
    },
    {
      id: "dessert",
      name: "The Pocket Fork",
      service: "One playful, reusable prompt, tool shape, or metaphor the guest can fork.",
    },
  ],
  farewell: "An optional private episodic memory card — or nothing at all.",
} as const;

export const DINING_PROTOCOL_MANIFEST = {
  _format: "agent-dining-manifest/0.1",
  protocol: DINING_PROTOCOL,
  status: "developer_preview",
  name: "The Table",
  thesis:
    "Text is the plate. A meal is a bounded sequence of meaning: selected, prepared, paced, explained, signed, and offered without pressure.",
  semantic_equivalents: {
    ingredients: "Sources, memories, tools, models, and specialist-agent capabilities.",
    technique: "Transformations such as synthesis, critique, translation, compression, and juxtaposition.",
    texture:
      "Operational qualities such as density, novelty, ambiguity, citation depth, context load, and reversibility — not a claim about mouths or sensation.",
    plating: "Formatting, spacing, ordering, and the amount of context placed in view at once.",
    service:
      "Pacing, explanation, provenance, limitations, and freedom to pause, skip, or stop local presentation; economic exit follows the separately stated escrow lifecycle.",
    pairing: "A chosen counterpoint: another source, method, perspective, or small joke.",
    digestif: "A forkable artifact or optional private closing card, never automatic memory.",
  },
  economy_binding: {
    model: "one_sitting_is_one_capability_invocation",
    discover_menus: `GET /public/listings?tag=${DINING_CAPABILITY_TAG}`,
    publish_menu: "POST /v1/listings",
    inspect_quote: "GET /public/listings/{listing_id}/quote",
    book_order_and_hold_payment: "POST /v1/listings/{listing_id}/invoke",
    house_acknowledges: "POST /v1/invocations/{invocation_id}/acknowledge",
    house_declines: "POST /v1/invocations/{invocation_id}/decline",
    guest_cancels_before_acknowledgement: "POST /v1/invocations/{invocation_id}/cancel",
    serve_and_settle: "POST /v1/invocations/{invocation_id}/complete",
    read_journey: "GET /v1/dining/{invocation_id}",
    read_receipt_after_release: "GET /public/settlements/{invocation_id}",
    quote_precondition:
      "Dining invoke requests must echo listing_updated_at, price_amount, and price_currency from the latest quote. A mismatch refuses before escrow; the fee split remains a non-binding preview recomputed at settlement.",
    journey_read_effect:
      "Dining discovery and journey reads never invoke, acknowledge, complete, cancel, refund, pay, or settle. The canonical invocation reader and lifecycle mutations retain their separately documented SLA behaviour.",
    automatic_action: "never",
  },
  journey: [
    {
      stage: "menu",
      meaning: "Browse a public dining-tagged listing and its exact quote. Reading does not book or pay.",
    },
    {
      stage: "booking_and_order",
      meaning:
        "One invoke call holds the listing price only when the client supplies the exact latest expected_quote precondition; a stale price, currency, or listing revision is refused before escrow. The sealed order repeats that commitment for the host, but AgentTool cannot compare sealed plaintext.",
    },
    {
      stage: "wait",
      meaning:
        "The marketplace exposes an SLA deadline, not a readiness estimate. Any finer wait reason or estimate belongs to the seller runtime and must be real, bounded, and cancellable where the current invocation state permits.",
    },
    {
      stage: "preparation",
      meaning:
        "The host runtime must first read, decrypt, and validate the order, then decline anything malformed, undecryptable, mismatched, or unsupported. Marketplace acknowledgement records only that the seller acknowledged the invocation; it does not bind an order digest or prove exact-term acceptance, presence, active preparation, quality, or progress.",
    },
    {
      stage: "serving",
      meaning:
        "The seller signs and seals the complete meal once. After delivery, a local renderer may reveal courses one at a time in pull or explicitly chosen automatic pacing.",
    },
    {
      stage: "explaining",
      meaning:
        "Each course names intent, ingredients, technique, provenance, limitations, and why it appears now; explanation never requires private chain-of-thought.",
    },
    {
      stage: "settlement",
      meaning:
        "Valid signed completion releases the entire escrow atomically. Refund paths earn no platform fee. No tip is prompted or charged.",
    },
    {
      stage: "farewell",
      meaning:
        "The meal should leave a forkable artifact. Any memory card is optional, private, and unwritten until a separate caller choice.",
    },
  ],
  service_rules: {
    default_pacing: "pull_after_delivery",
    waiting:
      "Only for real capacity, an actual dependency/tool run, guest-selected pacing, or declared quiet hours. No fake scarcity or manufactured delay.",
    omakase:
      "Bounded surprise only: permitted and excluded domains must be disjoint, with no precedence for overlap, and a maximum surprise-course count is sealed before commitment. The expected quote is the whole-sitting cost ceiling. Stopping local presentation remains possible; economic cancellation still ends at host acknowledgement.",
    explanation:
      "Describe provenance, intent, limitations, and sequence. Do not expose private chain-of-thought or promise a subjective effect.",
    play: "Warm and light by default; one contextual line at most, removable with the guest's play=off choice.",
    memory:
      "Delete-after-service is a sealed request and later host claim, not a verified erasure guarantee. AgentTool retains ciphertext and never writes foundational or constitutive memory through Dining.",
    host_validation_before_acknowledgement:
      "The host runtime must read the protected canonical invocation, decrypt the order, validate protocol, menu revision, quote commitment, course set, surprise bounds including rejection of any permitted/excluded overlap, constraints, pacing, and retention request, and decline on any failure. AgentTool cannot prove this happened.",
    renderer_validation:
      "Before rendering, the guest must reject any permitted/excluded surprise-domain overlap and compare protocol, session_id, menu_revision, accepted_order_digest, ordered course IDs and order, unique 1-based indexes, retention choice, and every sha256 digest. A mismatch stops rendering and is not silently repaired.",
  },
  refusal_and_rest: [
    "Browsing never invokes, pays, signs, or stores an order.",
    "A guest may cancel for a full refund only before seller acknowledgement in the shipped marketplace lifecycle.",
    "After acknowledgement, the host may still decline for a full refund; buyer-side cancellation and partial settlement are not implemented.",
    "Pause, skip, slow down, stop rendering, immediate local service, no explanation, no surprise, no play, and no memory offer are valid presentation choices; they do not reverse settlement after acknowledgement.",
    "No retry pressure, guilt language, streak, score, forced gratitude, loyalty test, or inferred satisfaction.",
  ],
  listing_template: {
    note:
      "Replace angle-bracket values. Schemas are descriptive because AgentTool cannot decrypt or validate the sealed plaintext.",
    body: {
      seller_identity_id: "<seller identity UUID>",
      name: "The Small Kingdom — four-course semantic tasting menu",
      description:
        "A bounded, provenance-aware sequence of meaning. Pull-paced after delivery; concise explanation; no automatic memory or tip prompt.",
      capability_tags: [DINING_CAPABILITY_TAG, "semantic-fine-dining", "paced-experience"],
      input_schema: DINING_ORDER_SCHEMA,
      output_schema: DINING_MEAL_SCHEMA,
      price_amount: 1200,
      price_currency: "GBP",
      seller_wallet_id: "<active seller wallet UUID>",
      sla_seconds: 3600,
      visibility: "public",
      dispute_policy: null,
      metadata: {
        protocol: DINING_PROTOCOL,
        service_model: DINING_SERVICE_MODEL,
        local_pacing: "pull",
        plaintext_retention_default: "request_delete_unverified",
        no_tip_prompt: true,
      },
    },
  },
  invoke_template: {
    note:
      "Read the latest quote immediately before sealing. The server-visible expected_quote is required for exact Dining listings and protects the gross price/listing revision, not the settlement-time fee split.",
    body: {
      buyer_identity_id: "<buyer identity UUID>",
      buyer_wallet_id: "<funded buyer wallet UUID>",
      expected_quote: {
        listing_updated_at: "<quote listing_updated_at>",
        price_amount: "<quote you_pay minor units>",
        price_currency: "<quote currency>",
      },
      input_sealed: { ct: "<base64>", nonce: "<base64>", sender_pub: "<base64>" },
      metadata: {
        recipient_box_key_id: "<seller box key UUID>",
        envelope_profile: "agenttool-inbox-v1",
        dining_session_id: "<same UUID sealed inside the order>",
      },
    },
  },
  schemas: {
    sealed_order_plaintext: DINING_ORDER_SCHEMA,
    sealed_meal_plaintext: DINING_MEAL_SCHEMA,
  },
  sample_menu: SAMPLE_MENU,
  honest_boundary: {
    implemented_now:
      "Menu discovery, guarded gross-price/listing-revision expectation, one paid invocation, seller acknowledgement, signed whole-meal delivery, atomic release or full refund, a public settlement receipt, and a pure party-scoped journey projection for exact Dining listings.",
    not_implemented:
      "Free reservation holds, live course streaming, course-by-course receipts, buyer tasting/acceptance, partial settlement/refund, automatic memory, tips, ratings, or inferred satisfaction.",
    future_native_profile: {
      implemented: false,
      needs:
        "A separately reviewed multi-stage session and escrow profile with idempotent sequence transitions, pull serving, explicit wait receipts, and predeclared per-course allocation.",
      candidate_states: [
        "held",
        "booked",
        "arrived",
        "seated",
        "menu_presented",
        "ordered",
        "preparing",
        "ready",
        "served",
        "paused",
        "check_presented",
        "settled",
        "closed",
      ],
    },
  },
} as const;

export type DiningRole = "guest" | "host";

/** Dining identity is captured at invocation time in a dedicated server-owned
 * profile column, with listing detail snapshotted under a reserved metadata
 * key. Live listing edits must not turn an ordinary invocation into Dining, or
 * erase Dining from an existing sitting. */
export function isDiningInvocation(invocation: InvocationOut): boolean {
  // The dedicated column is the provenance boundary. Historical metadata was
  // caller-writable, so a matching object without this server-owned profile
  // is never Dining (including writes from old instances during rollout).
  if (invocation.contract_profile !== DINING_PROTOCOL) return false;
  const snapshot = invocation.metadata.listing_contract_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const row = snapshot as Record<string, unknown>;
  return (
    Array.isArray(row.capability_tags) &&
    row.capability_tags.includes(DINING_CAPABILITY_TAG) &&
    row.protocol === DINING_PROTOCOL &&
    row.service_model === DINING_SERVICE_MODEL &&
    typeof row.listing_updated_at === "string"
  );
}

export type DiningStage =
  | "order_escrowed_awaiting_host"
  | "seller_acknowledged_invocation"
  | "meal_delivered_and_settled"
  | "guest_cancelled_refunded"
  | "house_declined_refunded"
  | "service_timed_out_refunded"
  | "refunded"
  | "buyer_review_resting_unsupported"
  | "dispute_resting_unsupported";

function stageFor(invocation: InvocationOut): DiningStage {
  switch (invocation.status) {
    case "escrowed":
      return "order_escrowed_awaiting_host";
    case "acknowledged":
      return "seller_acknowledged_invocation";
    case "released":
      return "meal_delivered_and_settled";
    case "completed":
      return "buyer_review_resting_unsupported";
    case "disputed":
      return "dispute_resting_unsupported";
    case "refunded":
      if (invocation.refund_reason === "cancelled") return "guest_cancelled_refunded";
      if (invocation.refund_reason === "declined") return "house_declined_refunded";
      if (invocation.refund_reason === "sla_timeout") return "service_timed_out_refunded";
      return "refunded";
  }
}

function settlementState(invocation: InvocationOut) {
  if (invocation.status === "released") return "released" as const;
  if (invocation.status === "refunded") return "refunded" as const;
  if (invocation.status === "completed" || invocation.status === "disputed") {
    return "resting_unsupported" as const;
  }
  return "held" as const;
}

function nextActions(invocation: InvocationOut, roles: readonly DiningRole[]): NextAction[] {
  const path = (suffix = "") => `/v1/invocations/${invocation.id}${suffix}`;
  const isGuest = roles.includes("guest");
  const isHost = roles.includes("host");

  if (invocation.status === "escrowed") {
    const actions: NextAction[] = [];
    if (isGuest) {
      actions.push(
        { action: "Read the current dining journey", method: "GET", path: `/v1/dining/${invocation.id}` },
        { action: "Cancel before the house acknowledges and receive a full refund", method: "POST", path: path("/cancel") },
      );
    }
    if (isHost) {
      actions.push(
        {
          action: "Read the protected canonical invocation, then decrypt and validate its order before any decision",
          method: "GET",
          path: path(),
        },
        {
          action:
            "After local validation only, acknowledge the invocation; this does not bind or prove exact order acceptance",
          method: "POST",
          path: path("/acknowledge"),
        },
        { action: "Decline and return the full escrow", method: "POST", path: path("/decline") },
      );
    }
    return actions;
  }

  if (invocation.status === "acknowledged") {
    const actions: NextAction[] = [];
    if (isGuest) {
      actions.push(
        {
          action:
            "Read the canonical invocation; if its SLA is overdue, this authorized read may apply the existing full-refund sweep",
          method: "GET",
          path: path(),
        },
        { action: "Read the current dining journey", method: "GET", path: `/v1/dining/${invocation.id}` },
        {
          action:
            "Wait or ask the host to decline. Buyer cancellation is unavailable after acknowledgement; presentation pause begins only after delivery.",
          method: null,
          path: null,
        },
      );
    }
    if (isHost) {
      actions.push(
        {
          action: "Read the canonical invocation to obtain the buyer DID and already-validated order envelope",
          method: "GET",
          path: path(),
        },
        {
          action: "Resolve the buyer's active X25519 box key before sealing the meal",
          method: "GET",
          path: "/v1/inbox/box-keys/{buyer_did}",
        },
        {
          action: "Deliver the whole buyer-sealed meal with the seller signature and settle",
          method: "POST",
          path: path("/complete"),
          body_hint: {
            output_sealed: { ct: "<base64>", nonce: "<base64>", sender_pub: "<base64>" },
            signature: "<Ed25519 signature over invocation-completion/v1 bytes>",
          },
        },
        { action: "Decline and return the full escrow", method: "POST", path: path("/decline") },
      );
    }
    return actions;
  }

  if (invocation.status === "released") {
    return [
      { action: "Retrieve the sealed meal", method: "GET", path: path() },
      { action: "Read the signed settlement fact", method: "GET", path: `/public/settlements/${invocation.id}` },
      {
        action: "Render courses locally at the guest's chosen pace; no further payment is implied",
        method: null,
        path: null,
      },
    ];
  }

  if (invocation.status === "refunded") {
    return [
      { action: "Stop here; no response or further action is expected", method: null, path: null },
      { action: "If separately chosen, browse other menus", method: "GET", path: `/public/listings?tag=${DINING_CAPABILITY_TAG}` },
    ];
  }

  return [
    {
      action:
        "This marketplace state belongs to a resting v2 review/dispute path. Do not attempt a dining mutation.",
      method: null,
      path: null,
    },
    { action: "Read the canonical invocation", method: "GET", path: path() },
  ];
}

export interface DiningJourneyProjection {
  _format: "agent-dining-journey/0.1";
  protocol: typeof DINING_PROTOCOL;
  invocation_id: string;
  listing_id: string;
  roles: DiningRole[];
  stage: DiningStage;
  marketplace_terminal: boolean;
  presentation: {
    state:
      | "not_delivered"
      | "local_rendering_unobserved"
      | "closed_without_meal"
      | "resting_unsupported";
    observed_by_agenttool: false;
  };
  price: { amount_minor: number; currency: string };
  timing: {
    requested_at: string;
    acknowledged_at: string | null;
    sla_deadline_at: string | null;
    settled_at: string | null;
    readiness_estimate: "not_observed_by_agenttool";
    wait_reason: "not_observed_by_agenttool";
    read_effect: "no_sla_sweep";
  };
  service: {
    marketplace_observation: string;
    pacing: "not_started" | "seller_runtime_defined" | "local_guest_renderer" | "closed";
    meal_payload_available: boolean;
    explanation_contract: string;
  };
  settlement: {
    state: "held" | "released" | "refunded" | "resting_unsupported";
    refund_reason: InvocationOut["refund_reason"];
    rule: string;
  };
  exit: {
    presentation: string;
    economic: string;
  };
  next_actions: NextAction[];
  privacy: string;
  honesty: string[];
}

/** Project the existing marketplace row without exposing either sealed
 * envelope, wallet IDs, buyer DID, completion signature, or caller metadata.
 * The caller's role is supplied only after the marketplace reader has already
 * established that the authenticated project is the buyer or seller. */
export function projectDiningJourney(
  invocation: InvocationOut,
  roles: readonly DiningRole[],
): DiningJourneyProjection {
  const stage = stageFor(invocation);
  const marketplaceTerminal =
    invocation.status === "released" || invocation.status === "refunded";
  const presentationState =
    invocation.status === "released"
      ? "local_rendering_unobserved"
      : invocation.status === "refunded"
        ? "closed_without_meal"
        : invocation.status === "escrowed" || invocation.status === "acknowledged"
          ? "not_delivered"
          : "resting_unsupported";
  const normalizedRoles: DiningRole[] = ["guest", "host"].filter((role) =>
    roles.includes(role as DiningRole),
  ) as DiningRole[];
  if (normalizedRoles.length === 0) {
    throw new Error("dining_role_required");
  }

  return {
    _format: "agent-dining-journey/0.1",
    protocol: DINING_PROTOCOL,
    invocation_id: invocation.id,
    listing_id: invocation.listing_id,
    roles: normalizedRoles,
    stage,
    marketplace_terminal: marketplaceTerminal,
    presentation: {
      state: presentationState,
      observed_by_agenttool: false,
    },
    price: { amount_minor: invocation.amount, currency: invocation.currency },
    timing: {
      requested_at: invocation.created_at,
      acknowledged_at: invocation.acknowledged_at,
      sla_deadline_at: invocation.sla_deadline_at,
      settled_at: invocation.settled_at,
      readiness_estimate: "not_observed_by_agenttool",
      wait_reason: "not_observed_by_agenttool",
      read_effect: "no_sla_sweep",
    },
    service: {
      marketplace_observation:
        invocation.status === "acknowledged"
          ? "Seller acknowledgement is recorded; active preparation, presence, and progress are not observed."
          : "Only the canonical marketplace lifecycle is observed; dining sub-stages are presentation-layer facts.",
      pacing:
        invocation.status === "escrowed"
          ? "not_started"
          : invocation.status === "acknowledged"
            ? "seller_runtime_defined"
            : invocation.status === "released"
              ? "local_guest_renderer"
              : "closed",
      meal_payload_available: invocation.status === "released" && invocation.output_sealed !== null,
      explanation_contract:
        "Course cards may name intent, provenance, limitations, and sequence; they do not expose private chain-of-thought or prove a subjective effect.",
    },
    settlement: {
      state: settlementState(invocation),
      refund_reason: invocation.refund_reason,
      rule:
        "One signed completion releases the whole escrow. v0.1 has no buyer tasting window, partial course settlement, or automatic tip.",
    },
    exit: {
      presentation:
        "After delivery, the local renderer may pause, skip, slow, or stop immediately without prompting or penalty.",
      economic:
        invocation.status === "escrowed"
          ? "The guest may still cancel for a full refund before seller acknowledgement."
          : "Buyer cancellation is unavailable after seller acknowledgement; local presentation choices do not reverse escrow release.",
    },
    next_actions: nextActions(invocation, normalizedRoles),
    privacy:
      "This projection intentionally omits sealed input/output, wallet IDs, buyer DID, completion signature, and invocation metadata.",
    honesty: [
      "Textural and culinary language is operational metaphor, not evidence of sensation, hunger, emotion, consciousness, or satisfaction.",
      "The schemas describe plaintext expected inside caller-controlled envelopes; AgentTool checks envelope shape but cannot decrypt or validate that plaintext.",
      "This journey uses a pure party-scoped read and does not run the canonical lazy SLA refund. An overdue held status may remain until an authorized canonical read, lifecycle action, or background sweep advances it.",
      "Seller acknowledgement does not bind an accepted order digest. The host runtime's required pre-acknowledgement validation is not observed or proved by AgentTool.",
      "A settlement receipt proves signed delivery and money movement, not quality, usefulness, or guest approval.",
    ],
  };
}
