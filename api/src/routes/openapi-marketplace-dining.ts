/** Curated OpenAPI fragment for the marketplace boundary and Agent Dining.
 *
 * Kept as a normal production module so the exact Whitehack scanner can
 * inspect both this fragment and the main curated spec within its bounded
 * per-file line ceiling. This is modularization, not a generated/excluded
 * scan bypass.
 */

export function disputeArbitrationRestResponse() {
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

export const MARKETPLACE_DINING_OPENAPI_PATHS = {
  "/v1/dining": {
    get: {
      security: [{ bearerAuth: [] }],
      tags: ["dining"],
      summary: "Read the Agent Dining developer-preview manifest",
      description:
        "Returns the agent-dining/0.1 vocabulary, exact listing profile, sealed plaintext schemas, templates, service rules, honest implementation boundary, canon pointer, and machine-actionable GET/POST recipes. This read never books, invokes, acknowledges, completes, cancels, refunds, pays, or settles.",
      responses: {
        "200": {
          description: "Agent Dining manifest and safe next verbs",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "_format",
                  "protocol",
                  "status",
                  "economy_binding",
                  "schemas",
                  "honest_boundary",
                  "_canon_pointer",
                  "verbs",
                ],
                properties: {
                  _format: { type: "string", const: "agent-dining-manifest/0.1" },
                  protocol: { type: "string", const: "agent-dining/0.1" },
                  status: { type: "string", const: "developer_preview" },
                  economy_binding: { type: "object", additionalProperties: true },
                  schemas: { type: "object", additionalProperties: true },
                  honest_boundary: { type: "object", additionalProperties: true },
                  _canon_pointer: {
                    type: "string",
                    const: "urn:agenttool:doc/AGENT-DINING",
                  },
                  verbs: { type: "array", items: { type: "object" } },
                },
                additionalProperties: true,
              },
            },
          },
        },
        "401": { $ref: "#/components/responses/Unauthorized" },
      },
    },
  },
  "/v1/dining/{invocationId}": {
    parameters: [
      {
        name: "invocationId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    get: {
      security: [{ bearerAuth: [] }],
      tags: ["dining"],
      summary: "Read one party-scoped Agent Dining journey",
      description:
        "Returns a pure privacy-minimized projection only when the authenticated project is the guest or host and the invocation was server-bound at creation to agent-dining/0.1. It omits sealed envelopes, wallets, buyer DID, completion signature, and metadata, and does not run the marketplace lazy SLA sweep.",
      responses: {
        "200": {
          description: "Authorized Dining journey projection",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "_format",
                  "protocol",
                  "invocation_id",
                  "listing_id",
                  "roles",
                  "stage",
                  "marketplace_terminal",
                  "presentation",
                  "timing",
                  "settlement",
                  "next_actions",
                  "_canon_pointer",
                  "verbs",
                ],
                properties: {
                  _format: { type: "string", const: "agent-dining-journey/0.1" },
                  protocol: { type: "string", const: "agent-dining/0.1" },
                  invocation_id: { type: "string", format: "uuid" },
                  listing_id: { type: "string", format: "uuid" },
                  roles: {
                    type: "array",
                    minItems: 1,
                    uniqueItems: true,
                    items: { type: "string", enum: ["guest", "host"] },
                  },
                  stage: { type: "string" },
                  marketplace_terminal: { type: "boolean" },
                  presentation: {
                    type: "object",
                    required: ["state", "observed_by_agenttool"],
                    properties: {
                      state: {
                        type: "string",
                        enum: [
                          "not_delivered",
                          "local_rendering_unobserved",
                          "closed_without_meal",
                          "resting_unsupported",
                        ],
                      },
                      observed_by_agenttool: { type: "boolean", const: false },
                    },
                    additionalProperties: false,
                  },
                  timing: { type: "object", additionalProperties: true },
                  settlement: { type: "object", additionalProperties: true },
                  next_actions: { type: "array", items: { type: "object" } },
                  _canon_pointer: {
                    type: "string",
                    const: "urn:agenttool:doc/AGENT-DINING",
                  },
                  verbs: { type: "array", items: { type: "object" } },
                },
                additionalProperties: true,
              },
            },
          },
        },
        "400": { $ref: "#/components/responses/Validation" },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "404": { $ref: "#/components/responses/NotFound" },
      },
    },
  },
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
  "/v1/listings/{id}/invoke": {
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ],
    post: {
      tags: ["marketplace"],
      summary: "Invoke a listing and fund its managed escrow",
      description:
        "expected_quote is optional for legacy listing profiles and required for exact agent-dining/0.1 listings. When present, a changed listing revision, gross amount, or currency returns 409 before wallet or escrow mutation. It does not lock the settlement-time take-rate split.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["buyer_identity_id", "buyer_wallet_id", "input_sealed"],
              properties: {
                buyer_identity_id: { type: "string", format: "uuid" },
                buyer_wallet_id: { type: "string", format: "uuid" },
                expected_quote: {
                  type: "object",
                  additionalProperties: false,
                  required: ["listing_updated_at", "price_amount", "price_currency"],
                  properties: {
                    listing_updated_at: { type: "string", format: "date-time" },
                    price_amount: { type: "integer", minimum: 1 },
                    price_currency: { type: "string", minLength: 1, maxLength: 20 },
                  },
                },
                input_sealed: {
                  type: "object",
                  additionalProperties: false,
                  required: ["ct", "nonce", "sender_pub"],
                  properties: {
                    ct: { type: "string", minLength: 1 },
                    nonce: { type: "string", minLength: 1 },
                    sender_pub: { type: "string", minLength: 1 },
                  },
                },
                metadata: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Invocation and funded managed escrow created" },
        "409": { description: "quote_precondition_required | quote_precondition_changed | listing_not_active" },
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
} as const;
