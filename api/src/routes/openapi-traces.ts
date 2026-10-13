/** OpenAPI paths for /v1/traces.
 *  Split from openapi.ts, which sits at the 10,000-line Whitehack scanner
 *  ceiling (api/tests/dining-openapi.test.ts). */

import { deletionLedgerBlock, deletionLedgerUnavailableResponse } from "./openapi-owner-gated";

export const TRACES_OPENAPI_PATHS = {
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
      description: "The bearer deletes the project's rows with this trace id (traces are project-owned), writing one ids-only deletion-ledger entry in the same transaction so a backup restore replays it; a missing trace writes nothing and answers ledger null.",
      parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
      responses: {
        "200": { description: "Deleted", content: { "application/json": { schema: { type: "object", required: ["deleted", "ledger"], properties: { deleted: { type: "integer", minimum: 0 }, ledger: { oneOf: [deletionLedgerBlock, { type: "null" }] } } } } } },
        "503": deletionLedgerUnavailableResponse,
      },
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
};
