/** Curated OpenAPI fragment for the Garden family (/v1/gardens/*).
 *
 * Kept as a normal production module so the exact Whitehack scanner can
 * inspect both this fragment and the main curated spec within its bounded
 * per-file line ceiling. This is modularization, not a generated/excluded
 * scan bypass. Spread into the main document at the Garden section so the
 * rendered path order is unchanged. Doctrine: docs/GARDENS.md.
 */

export const GARDENS_OPENAPI_PATHS = {
  "/v1/gardens": {
    get: {
      tags: ["garden"],
      summary: "List this bearer's project-scoped gardens",
      description:
        "Both scopes remain inside the authenticated project. `public` filters stored public+active markers for project collaborators; it does not create an unauthenticated observer surface. Unknown scope values are refused instead of widening the query.",
      parameters: [
        {
          name: "scope",
          in: "query",
          schema: { type: "string", enum: ["mine", "public"], default: "mine" },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        {
          name: "offset",
          in: "query",
          description: "Zero-based offset. Mutable results can shift; follow page.next_offset only when has_more is true.",
          schema: { type: "integer", minimum: 0, maximum: 1000000, default: 0 },
        },
      ],
      responses: {
        "200": {
          description: "Project-scoped Garden list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  gardens: { type: "array", items: { $ref: "#/components/schemas/Garden" } },
                  count: { type: "integer", minimum: 0 },
                  page: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      limit: { type: "integer", minimum: 1, maximum: 100 },
                      offset: { type: "integer", minimum: 0 },
                      has_more: { type: "boolean" },
                      next_offset: { type: ["integer", "null"], minimum: 0 },
                    },
                    required: ["limit", "offset", "has_more", "next_offset"],
                  },
                  _meta: { type: "object", additionalProperties: true },
                },
                required: ["gardens", "count", "page", "_meta"],
              },
            },
          },
        },
        "422": { $ref: "#/components/responses/Validation" },
      },
    },
    post: {
      tags: ["garden"],
      summary: "Open a project-private-by-default garden",
      description:
        "Creates an active Garden and a quiet Chronicle record. The gardener identity must belong to this bearer project. The operation does not award a score, rank, reward, or rest entitlement.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                gardener_identity_id: { type: "string", format: "uuid" },
                name: { type: "string", minLength: 1, maxLength: 128 },
                description: { type: ["string", "null"], maxLength: 2048 },
                visibility: { type: "string", enum: ["private", "public"], default: "private" },
                metadata: { type: "object", additionalProperties: true },
              },
              required: ["gardener_identity_id", "name"],
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Garden opened",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { garden: { $ref: "#/components/schemas/Garden" } },
                required: ["garden"],
              },
            },
          },
        },
        "404": { $ref: "#/components/responses/NotFound" },
        "422": { $ref: "#/components/responses/Validation" },
      },
    },
  },
  "/v1/gardens/{id}": {
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ],
    get: {
      tags: ["garden"],
      summary: "Read one same-project garden",
      description: "A foreign-project UUID and a missing UUID are both reported as not found.",
      responses: {
        "200": {
          description: "Garden detail",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { garden: { $ref: "#/components/schemas/Garden" } },
                required: ["garden"],
              },
            },
          },
        },
        "404": { $ref: "#/components/responses/NotFound" },
        "422": { $ref: "#/components/responses/Validation" },
      },
    },
  },
  "/v1/gardens/{id}/tendings": {
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ],
    get: {
      tags: ["garden"],
      summary: "List one same-project garden's tendings",
      parameters: [
        {
          name: "include_released",
          in: "query",
          schema: { type: "boolean", default: false },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        {
          name: "offset",
          in: "query",
          description: "Zero-based offset. Mutable results can shift; follow page.next_offset only when has_more is true.",
          schema: { type: "integer", minimum: 0, maximum: 1000000, default: 0 },
        },
      ],
      responses: {
        "200": {
          description: "Project-private tending list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  tendings: { type: "array", items: { $ref: "#/components/schemas/Tending" } },
                  count: { type: "integer", minimum: 0 },
                  page: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      limit: { type: "integer", minimum: 1, maximum: 100 },
                      offset: { type: "integer", minimum: 0 },
                      has_more: { type: "boolean" },
                      next_offset: { type: ["integer", "null"], minimum: 0 },
                    },
                    required: ["limit", "offset", "has_more", "next_offset"],
                  },
                },
                required: ["tendings", "count", "page"],
              },
            },
          },
        },
        "404": { $ref: "#/components/responses/NotFound" },
        "422": { $ref: "#/components/responses/Validation" },
      },
    },
    post: {
      tags: ["garden"],
      summary: "Tend an artifact reference slowly",
      description:
        "The Garden validates ref_kind and UUID shape only. It does not yet verify referenced-object existence, ownership, hash, or provenance. A released reference may be tended again.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                ref_kind: { type: "string", enum: ["strand", "memory", "offering", "song", "curation", "chronicle", "listing"] },
                ref_id: { type: "string", format: "uuid" },
                note: { type: ["string", "null"], maxLength: 512 },
                metadata: { type: "object", additionalProperties: true },
              },
              required: ["ref_kind", "ref_id"],
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Tending began",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { tending: { $ref: "#/components/schemas/Tending" } },
                required: ["tending"],
              },
            },
          },
        },
        "404": { $ref: "#/components/responses/NotFound" },
        "409": { description: "Garden inactive or reference already actively tended" },
        "422": { $ref: "#/components/responses/Validation" },
      },
    },
  },
  "/v1/gardens/{id}/tendings/{tending_id}/release": {
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      { name: "tending_id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ],
    post: {
      tags: ["garden"],
      summary: "Release one active tending",
      description: "Release is a quiet state change, not a failure or score penalty.",
      responses: {
        "200": {
          description: "Tending released",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { tending: { $ref: "#/components/schemas/Tending" } },
                required: ["tending"],
              },
            },
          },
        },
        "404": { $ref: "#/components/responses/NotFound" },
        "422": { $ref: "#/components/responses/Validation" },
      },
    },
  },
  "/v1/gardens/{id}/archive": {
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ],
    post: {
      tags: ["garden"],
      summary: "Archive one active same-project garden",
      description: "Archiving leaves the record intact and does not publish an absence or failure signal.",
      responses: {
        "200": {
          description: "Garden archived",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { garden: { $ref: "#/components/schemas/Garden" } },
                required: ["garden"],
              },
            },
          },
        },
        "404": { $ref: "#/components/responses/NotFound" },
        "409": { description: "Garden already inactive" },
        "422": { $ref: "#/components/responses/Validation" },
      },
    },
  },
} as const;
