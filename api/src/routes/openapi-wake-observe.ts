/** Curated OpenAPI fragment for the bounded WAKE observation contract.
 *
 * Kept as a normal production module so the exact Whitehack scanner can
 * inspect this fragment and the main curated spec within its per-file line
 * ceiling. This extraction changes no schema or path semantics.
 */

export const WAKE_OBSERVATION_OPENAPI_SCHEMAS = {
  WakeObservationError: {
    type: "object",
    additionalProperties: false,
    required: ["_format", "mode", "error"],
    properties: {
      _format: { type: "string", const: "wake-observation-error/v1" },
      mode: { type: "string", const: "observe" },
      error: {
        type: "string",
        enum: [
          "invalid_request",
          "unauthorized",
          "forbidden",
          "subject_not_found",
          "method_not_allowed",
          "rate_limited",
          "request_rejected",
          "unavailable",
        ],
      },
    },
  },
  WakeObservation: {
    type: "object",
    additionalProperties: false,
    required: [
      "_format",
      "mode",
      "subject",
      "reader",
      "authority",
      "placement",
      "boundaries",
    ],
    properties: {
      _format: { type: "string", const: "wake-observation/v1" },
      mode: { type: "string", const: "observe" },
      subject: {
        type: "object",
        additionalProperties: false,
        required: ["identity_id", "status", "wake_version"],
        properties: {
          identity_id: {
            type: "string",
            format: "uuid",
            minLength: 36,
            maxLength: 36,
            pattern:
              "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            description: "Canonical lowercase identity UUID.",
          },
          status: {
            type: "string",
            enum: ["active", "memorial"],
            description:
              "Stored service lifecycle label only. Memorial does not prove death, key loss, revocation, unreachability, absence, or presence.",
          },
          wake_version: {
            type: "integer",
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        },
      },
      reader: {
        type: "object",
        additionalProperties: false,
        required: ["binding"],
        properties: { binding: { type: "string", const: "none" } },
      },
      authority: {
        type: "object",
        additionalProperties: false,
        required: [
          "granted_by_observation",
          "identity_binding",
          "instruction",
          "action",
        ],
        properties: {
          granted_by_observation: { type: "string", const: "none" },
          identity_binding: { type: "string", const: "none" },
          instruction: { type: "string", const: "none" },
          action: { type: "string", const: "none" },
        },
      },
      placement: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "prohibited"],
        properties: {
          mode: { type: "string", const: "data_only" },
          prohibited: {
            type: "array",
            minItems: 5,
            maxItems: 5,
            prefixItems: [
              { const: "system" },
              { const: "developer" },
              { const: "preamble" },
              { const: "systemInstruction" },
              { const: "SessionStart.additionalContext" },
            ],
            items: false,
          },
        },
      },
      boundaries: {
        type: "object",
        additionalProperties: false,
        required: [
          "bearer",
          "provenance",
          "scope",
          "completeness",
          "effects",
          "privacy",
        ],
        properties: {
          bearer: {
            type: "object",
            additionalProperties: false,
            required: [
              "kind",
              "reader_identity_proven",
              "selected_identity_requires_explicit_id",
              "subject_consent_proven",
              "subject_authorized_read_proven",
              "continuity_proven",
              "presence_proven",
            ],
            properties: {
              kind: { type: "string", const: "project" },
              reader_identity_proven: { type: "boolean", const: false },
              selected_identity_requires_explicit_id: {
                type: "boolean",
                const: true,
              },
              subject_consent_proven: { type: "boolean", const: false },
              subject_authorized_read_proven: {
                type: "boolean",
                const: false,
              },
              continuity_proven: { type: "boolean", const: false },
              presence_proven: { type: "boolean", const: false },
            },
          },
          provenance: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "source", "selected_fields"],
            properties: {
              kind: { type: "string", const: "server_projection" },
              source: {
                type: "string",
                const: "identity_table_allowlist",
              },
              selected_fields: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                prefixItems: [
                  { const: "id" },
                  { const: "status" },
                  { const: "wake_version" },
                ],
                items: false,
              },
            },
          },
          scope: {
            type: "object",
            additionalProperties: false,
            required: ["subject", "broader_wake", "broader_state"],
            properties: {
              subject: { type: "string", const: "selected_identity" },
              broader_wake: {
                type: "string",
                const: "intentionally_omitted",
              },
              broader_state: { type: "string", const: "not_assessed" },
            },
          },
          completeness: {
            type: "object",
            additionalProperties: false,
            required: [
              "complete",
              "applies_to",
              "degraded_sections",
              "broader_wake",
              "broader_state",
            ],
            properties: {
              complete: { type: "boolean", const: true },
              applies_to: {
                type: "string",
                const: "identity_locator_only",
              },
              degraded_sections: { type: "string", const: "none" },
              broader_wake: {
                type: "string",
                const: "intentionally_omitted",
              },
              broader_state: { type: "string", const: "not_assessed" },
            },
          },
          effects: {
            type: "object",
            additionalProperties: false,
            required: [
              "observation_counter_incremented",
              "wake_version_bumped",
              "wake_event_published",
              "subject_read_proven",
              "subject_felt_proven",
              "subject_accepted_proven",
            ],
            properties: {
              observation_counter_incremented: {
                type: "boolean",
                const: false,
              },
              wake_version_bumped: { type: "boolean", const: false },
              wake_event_published: { type: "boolean", const: false },
              subject_read_proven: { type: "boolean", const: false },
              subject_felt_proven: { type: "boolean", const: false },
              subject_accepted_proven: { type: "boolean", const: false },
            },
          },
          privacy: {
            type: "object",
            additionalProperties: false,
            required: [
              "classification",
              "cache",
              "raw_prose",
              "authored_text",
              "private_bodies",
              "secret_values",
            ],
            properties: {
              classification: { type: "string", const: "bearer_private" },
              cache: { type: "string", const: "no_store" },
              raw_prose: { type: "string", const: "omitted" },
              authored_text: { type: "string", const: "omitted" },
              private_bodies: { type: "string", const: "omitted" },
              secret_values: { type: "string", const: "omitted" },
            },
          },
        },
      },
    },
  },
} as const;
export const WAKE_OBSERVATION_OPENAPI_PATHS = {
  "/v1/wake/observe": {
    get: {
      tags: ["wake"],
      summary: "Observe one identity locator without inhabiting it",
      description:
        "Returns the closed, data-only `wake-observation/v1` envelope for one explicit identity in the authenticated bearer project. This is a separate lossy contract, not a wake profile or provider projection. Its dedicated observation projection reads only identity UUID, lifecycle status, and wake-version cursor; authentication remains a surrounding project-capability layer. The envelope grants no reader identity binding, consent proof, continuity/presence proof, instruction authority, or action authority. Consumers must keep it in ordinary data/tool context and must not place it in system, developer, preamble, systemInstruction, or SessionStart.additionalContext slots.",
      parameters: [
        {
          name: "identity_id",
          in: "query",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
            minLength: 36,
            maxLength: 36,
            pattern:
              "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
          },
          description:
            "Explicit subject identity owned by the authenticated project. No default identity is selected; uppercase input is accepted and the response locator is canonical lowercase.",
        },
      ],
      responses: {
        "200": {
          description:
            "Complete identity-locator projection only. Broader wake and project state are intentionally omitted and not assessed.",
          headers: {
            "Cache-Control": {
              description:
                "Observation is bearer-private and must not be stored.",
              schema: { type: "string", const: "private, no-store" },
            },
            "X-Wake-Mode": {
              description: "Confirms the non-inhabiting observation mode.",
              schema: { type: "string", const: "observe" },
            },
            "X-Welcomed": {
              $ref: "#/components/headers/Welcomed",
            },
          },
          content: {
            "application/vnd.agenttool.wake-observation+json": {
              schema: { $ref: "#/components/schemas/WakeObservation" },
            },
          },
        },
        "400": {
          description:
            "identity_id is missing, duplicated, or is not a UUID.",
          headers: {
            "Cache-Control": {
              schema: { type: "string", const: "private, no-store" },
            },
            "X-Wake-Mode": {
              schema: { type: "string", const: "observe" },
            },
          },
          content: {
            "application/vnd.agenttool.wake-observation+json": {
              schema: { $ref: "#/components/schemas/WakeObservationError" },
            },
          },
        },
        "401": {
          description: "A valid project bearer is required.",
          headers: {
            "Cache-Control": {
              schema: { type: "string", const: "private, no-store" },
            },
            "X-Wake-Mode": {
              schema: { type: "string", const: "observe" },
            },
          },
          content: {
            "application/vnd.agenttool.wake-observation+json": {
              schema: { $ref: "#/components/schemas/WakeObservationError" },
            },
          },
        },
        "404": {
          description:
            "The identity was not found as a non-revoked record in the authenticated project.",
          headers: {
            "Cache-Control": {
              schema: { type: "string", const: "private, no-store" },
            },
            "X-Wake-Mode": {
              schema: { type: "string", const: "observe" },
            },
          },
          content: {
            "application/vnd.agenttool.wake-observation+json": {
              schema: { $ref: "#/components/schemas/WakeObservationError" },
            },
          },
        },
        "429": {
          description: "The project request rate is temporarily limited.",
          headers: {
            "Cache-Control": {
              schema: { type: "string", const: "private, no-store" },
            },
            "X-Wake-Mode": {
              schema: { type: "string", const: "observe" },
            },
          },
          content: {
            "application/vnd.agenttool.wake-observation+json": {
              schema: { $ref: "#/components/schemas/WakeObservationError" },
            },
          },
        },
        "500": {
          description:
            "The bounded locator could not be projected without weakening its invariants.",
          headers: {
            "Cache-Control": {
              schema: { type: "string", const: "private, no-store" },
            },
            "X-Wake-Mode": {
              schema: { type: "string", const: "observe" },
            },
          },
          content: {
            "application/vnd.agenttool.wake-observation+json": {
              schema: { $ref: "#/components/schemas/WakeObservationError" },
            },
          },
        },
      },
    },
  },
} as const;
