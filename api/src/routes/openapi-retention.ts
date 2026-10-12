/** OpenAPI path for GET /public/retention.
 *  Split from openapi.ts, which sits near the 10,000-line Whitehack scanner
 *  ceiling (api/tests/dining-openapi.test.ts). The response is the constant
 *  in api/src/services/discovery/retention.ts. Doc: docs/RETENTION.md. */

import { RETENTION_BASES, RETENTION_SCHEMA } from "../services/discovery/retention";

const basis = { type: "string", enum: [...RETENTION_BASES] };

const whereValue = {
  type: "object",
  additionalProperties: false,
  required: ["where", "value", "basis"],
  properties: { where: { type: "string" }, value: { type: "string" }, basis },
};

const RETENTION_SCHEMA_V1 = {
  type: "object",
  additionalProperties: true,
  required: [
    "schema", "version", "versions", "controller", "scope", "classes", "backups",
    "deletion_ledger", "already_deleted_content", "logs", "ip_addresses",
    "third_parties", "permanent_surfaces", "unknowns",
  ],
  properties: {
    schema: { const: RETENTION_SCHEMA },
    version: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    versions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["version", "change"],
        properties: { version: { type: "string" }, change: { type: "string" } },
      },
    },
    controller: { type: "string" },
    scope: { type: "string" },
    classes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "stores", "live", "after_delete", "basis", "evidence"],
        properties: {
          id: { type: "string" },
          stores: { type: "array", items: { type: "string" } },
          live: { type: "string" },
          after_delete: { type: "string" },
          basis,
          evidence: { type: "string" },
        },
      },
    },
    backups: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "kept", "pitr", "measured_at", "basis", "effect"],
      properties: {
        kind: { type: "string" },
        kept: { type: "integer", minimum: 0 },
        pitr: { type: "boolean" },
        measured_at: { type: "string", format: "date" },
        basis,
        effect: { type: "string" },
      },
    },
    deletion_ledger: {
      type: "object",
      required: ["status", "what", "compaction", "mirror", "replay", "voided_entries", "deletion_moments", "rules", "effect", "basis"],
      properties: {
        status: { type: "string" },
        what: { type: "string" },
        integrity: { type: "string" },
        compaction: { type: "string" },
        mirror: {
          type: "object",
          required: ["purpose", "window", "basis"],
          properties: { purpose: { type: "string" }, window: { type: "string" }, basis },
        },
        mirror_configured: {
          type: "object",
          required: ["value", "basis"],
          properties: { value: { type: "string" }, basis },
        },
        replay: { type: "string" },
        voided_entries: { type: "integer", minimum: 0 },
        deletion_moments: { type: "string" },
        rules: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "effect"],
            properties: { id: { type: "string" }, effect: { type: "string" } },
          },
        },
        effect: { type: "string" },
        basis,
      },
    },
    already_deleted_content: {
      type: "object",
      required: ["status", "purge_not_before", "min_days_after_announcement", "notice"],
      properties: {
        status: { type: "string" },
        purge_not_before: { type: "string", format: "date" },
        min_days_after_announcement: { type: "integer", minimum: 30 },
        notice: { type: "string" },
      },
    },
    logs: { type: "array", items: whereValue },
    ip_addresses: { type: "array", items: whereValue },
    third_parties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["party", "holds", "retention", "basis"],
        properties: {
          party: { type: "string" },
          holds: { type: "string" },
          retention: { type: "string" },
          basis,
        },
      },
    },
    permanent_surfaces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["surface", "write_door", "rule", "basis"],
        properties: {
          surface: { type: "string" },
          write_door: { type: "string" },
          rule: { type: "string" },
          basis,
        },
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
  },
} as const;

export const RETENTION_OPENAPI_PATHS = {
  "/public/retention": {
    get: {
      security: [],
      tags: ["public"],
      summary: "What AgentTool keeps, for how long, and what deletion does today",
      description:
        "Static and unauthenticated; no database read and no per-being data. Every value carries its basis: measured (read from production, dated), source (what the code does), config (committed configuration), declared (a policy with no mechanism yet) or unknown, spelled exactly \"unknown\". It publishes current behaviour, not plans; earlier versions stay listed in `versions`.",
      responses: {
        "200": {
          description: "agenttool-retention/v1 disclosure",
          headers: {
            "Cache-Control": {
              description: "Public for 300 seconds.",
              schema: { type: "string", const: "public, max-age=300" },
            },
          },
          content: { "application/json": { schema: RETENTION_SCHEMA_V1 } },
        },
      },
    },
  },
} as const;
