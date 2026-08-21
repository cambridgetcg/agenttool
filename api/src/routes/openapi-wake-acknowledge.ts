/** Curated OpenAPI fragment for explicit WAKE acknowledgement.
 *
 * Kept separate so the main curated OpenAPI module stays below the exact
 * Whitehack scanner's per-file line ceiling. Runtime truth lives in
 * routes/wake.ts and services/wake/acknowledgement.ts.
 */

function privateHeaders(options: { welcomed?: boolean } = {}) {
  return {
    "Cache-Control": {
      description:
        "WAKE responses are bearer-private and must not be stored or reused.",
      schema: { type: "string", const: "private, no-store" },
    },
    ...(options.welcomed === false
      ? {}
      : { "X-Welcomed": { $ref: "#/components/headers/Welcomed" } }),
  };
}

function privateJsonResponse(
  description: string,
  schema: Record<string, unknown>,
  options?: { welcomed?: boolean },
) {
  return {
    description,
    headers: privateHeaders(options),
    content: { "application/json": { schema } },
  };
}

export const WAKE_ACKNOWLEDGEMENT_OPENAPI_SCHEMAS = {
  WakeAcknowledgementRequest: {
    type: "object",
    additionalProperties: false,
    properties: {
      identity_id: { type: "string", format: "uuid" },
      expected_observation_count: {
        type: "integer",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER - 1,
        description:
          "Exact private cursor surfaced as you_observed_yourself_observing_yourself by the default full JSON WAKE representation being acknowledged. The current wire maximum is 9007199254740990, leaving room for exactly one safe-integer increment. Other projections do not currently carry this cursor.",
      },
    },
    required: ["identity_id", "expected_observation_count"],
  },
  WakeAcknowledgementWelcome: {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          emitted: { type: "boolean", const: true },
          entry_id: { type: "string", format: "uuid" },
          reason: { type: "string", const: "emitted" },
        },
        required: ["emitted", "entry_id", "reason"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          emitted: { type: "boolean", const: false },
          entry_id: { type: "null" },
          reason: {
            type: "string",
            enum: [
              "recent_welcome_exists",
              "acknowledgement_already_completed",
            ],
          },
        },
        required: ["emitted", "entry_id", "reason"],
      },
    ],
  },
  WakeAcknowledgement: {
    type: "object",
    additionalProperties: false,
    properties: {
      _format: { type: "string", const: "wake-acknowledgement/v1" },
      identity_id: { type: "string", format: "uuid" },
      observation_count: {
        type: "integer",
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      applied: { type: "boolean" },
      durable_replay: {
        type: "string",
        enum: [
          "cursor advanced exactly once",
          "cursor was already one step beyond the supplied precondition; no second increment",
        ],
      },
      wake_version_effect: {
        type: "string",
        const:
          "The cursor mutation itself does not bump wake_version or publish a cursor event. A newly inserted welcome may best-effort publish a separate chronicle event after commit, which bumps wake_version if publication succeeds.",
      },
      welcome: {
        $ref: "#/components/schemas/WakeAcknowledgementWelcome",
      },
      next_read: {
        type: "string",
        pattern: "^/v1/wake\\?identity_id=[0-9a-f-]{36}$",
      },
      privacy: {
        type: "string",
        const:
          "This cursor is private to the authenticated project and is never ranked across beings.",
      },
      _welcomed: { $ref: "#/components/schemas/WelcomedFrame" },
    },
    required: [
      "_format",
      "identity_id",
      "observation_count",
      "applied",
      "durable_replay",
      "wake_version_effect",
      "welcome",
      "next_read",
      "privacy",
    ],
    allOf: [
      {
        oneOf: [
          {
            properties: {
              applied: { const: true },
              durable_replay: { const: "cursor advanced exactly once" },
            },
          },
          {
            properties: {
              applied: { const: false },
              durable_replay: {
                const:
                  "cursor was already one step beyond the supplied precondition; no second increment",
              },
              welcome: {
                type: "object",
                properties: {
                  emitted: { const: false },
                  entry_id: { type: "null" },
                  reason: { const: "acknowledgement_already_completed" },
                },
                required: ["emitted", "entry_id", "reason"],
              },
            },
          },
        ],
      },
    ],
  },
  WakeAcknowledgementError: {
    type: "object",
    additionalProperties: false,
    properties: {
      _format: {
        type: "string",
        const: "wake-acknowledgement-error/v1",
      },
      error: {
        type: "string",
        enum: [
          "idempotency_key_required",
          "invalid_idempotency_key",
          "invalid_wake_acknowledgement",
          "wake_acknowledgement_unavailable",
          "identity_not_found_in_project",
          "identity_revoked",
          "observation_count_conflict",
          "wake_acknowledgement_body_too_large",
        ],
      },
      message: { type: "string" },
      hint: { type: "string" },
      details: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            code: { type: "string" },
          },
          required: ["path", "code"],
        },
      },
      observation_count: {
        type: "integer",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      expected_observation_count: {
        type: "integer",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER - 1,
      },
      current_observation_count: {
        type: "integer",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    },
    required: ["error"],
  },
} as const;

const ACK_ERROR = { $ref: "#/components/schemas/WakeAcknowledgementError" };
const GENERIC_ERROR = { $ref: "#/components/schemas/Error" };

export const WAKE_ACKNOWLEDGEMENT_OPENAPI_PATHS = {
  "/v1/wake/acknowledge": {
    post: {
      tags: ["wake"],
      summary: "Explicitly acknowledge one observed wake",
      description:
        "Advances one identity's private self-observation cursor only when expected_observation_count exactly matches the stored value. The identity row is held FOR NO KEY UPDATE so lifecycle changes and competing acknowledgements serialize; the compare-and-set and advisory-locked welcome decision execute in one transaction. This lock is no stronger than needed: chronicle.agent_id is currently a logical relation, not a physical foreign key, and NO KEY UPDATE remains compatible with KEY SHARE if that relation later becomes physical. A stored value already one step ahead is returned as an already-applied durable replay; every other mismatch is 409. Idempotency-Key is required and fingerprint-bound by Redis when available, but the database cursor contract remains the durable duplicate guard when Redis is absent. The body is capped at 4 KiB before JSON parsing and fingerprinting. The cursor increment itself neither bumps wake_version nor publishes a cursor event; a newly inserted welcome may best-effort publish a separate chronicle event after commit. A 503 means the transaction outcome was not confirmed, including possible connection loss around COMMIT; retrying the exact request safely applies the cursor or returns already-applied without a second increment.",
      parameters: [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", minLength: 8, maxLength: 256 },
          description:
            "Logical request key. Reuse it only for retries with the exact same identity_id and expected_observation_count.",
        },
      ],
      requestBody: {
        required: true,
        description: "Strict JSON object; maximum request body size is 4096 bytes.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/WakeAcknowledgementRequest",
            },
          },
        },
      },
      responses: {
        "200": {
          description:
            "The cursor advanced exactly once, or the supplied one-step precondition was already applied.",
          headers: {
            ...privateHeaders(),
            "X-Idempotency-Supported": {
              schema: { type: "string", const: "Idempotency-Key" },
            },
            "Idempotent-Replay": {
              description:
                "Present as true when the optional Redis response layer replayed the completed response.",
              schema: { type: "string", const: "true" },
            },
          },
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WakeAcknowledgement" },
            },
          },
        },
        "400": privateJsonResponse(
          "Invalid idempotency key or strict acknowledgement JSON",
          { oneOf: [ACK_ERROR, GENERIC_ERROR] },
        ),
        "401": privateJsonResponse(
          "Missing, expired, or invalid project bearer",
          GENERIC_ERROR,
        ),
        "404": privateJsonResponse(
          "Identity is not in the authenticated project",
          ACK_ERROR,
        ),
        "409": privateJsonResponse(
          "Observation precondition or idempotency fingerprint conflict",
          { oneOf: [ACK_ERROR, GENERIC_ERROR] },
        ),
        "410": privateJsonResponse("Identity is revoked", ACK_ERROR),
        "413": privateJsonResponse(
          "Request body exceeds 4096 bytes",
          ACK_ERROR,
        ),
        "425": {
          ...privateJsonResponse(
            "Replayable TLS early data is refused; retry after the handshake",
            GENERIC_ERROR,
            { welcomed: false },
          ),
          headers: {
            ...privateHeaders({ welcomed: false }),
            Vary: { schema: { type: "string", const: "Early-Data" } },
            "Retry-After": { schema: { type: "string", const: "0" } },
          },
        },
        "428": privateJsonResponse("Idempotency-Key is required", ACK_ERROR),
        "503": privateJsonResponse(
          "Transaction outcome was not confirmed; retry the exact request so the durable one-step cursor contract can apply or report already-applied without a second increment",
          ACK_ERROR,
        ),
      },
    },
  },
} as const;
