/** Continuity walk OpenAPI fragment: the shared CursorPage, the keyset
 *  list operations for GET /v1/memories, /v1/chronicle and /v1/strands, and
 *  GET|HEAD /v1/correspondence/repositories.
 *  Split out of openapi.ts to keep every OpenAPI module under the
 *  @agenttool/whitehack-scan 10,000-line ceiling (api/tests/dining-openapi.test.ts).
 *  Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks) ·
 *  docs/AGENT-CORRESPONDENCE.md. Tested: api/tests/openapi-continuity-walks.test.ts ·
 *  api/tests/openapi-correspondence.test.ts. */

/** Same values as openapi.ts; repeated here to avoid a circular import. */
const CORRESPONDENCE_JSON_MEDIA_TYPE =
  "application/vnd.agenttool.correspondence+json";
const CORRESPONDENCE_EVENT_SCHEMA =
  "https://docs.agenttool.dev/specs/agent-correspondence-0.1.schema.json";

export const CONTINUITY_WALK_OPENAPI_SCHEMAS = {
  CursorPage: {
    type: "object",
    additionalProperties: false,
    description:
      "Keyset walk position for newest-first continuity lists (GET /v1/memories, /v1/chronicle, /v1/strands). Without a cursor a list returns its first page, the same rows as before. next_cursor names the last returned row and is null exactly when has_more is false. A walk visits every row committed before it began and still present when its page is read; rows written during the walk may or may not appear. It is not a snapshot and not a lossless change feed. Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks).",
    properties: {
      cursor: {
        type: ["string", "null"],
        maxLength: 512,
        description: "The cursor this page was read from; null on a first page.",
      },
      next_cursor: {
        type: ["string", "null"],
        maxLength: 512,
        description:
          "Opaque. Send it as ?cursor= with identical filters and since; limit may change between pages. Null exactly when has_more is false, and always null for strands order=recent.",
      },
      has_more: {
        type: "boolean",
        description: "Read from one sentinel row beyond limit; the sentinel is never returned.",
      },
      limit: { type: "integer", minimum: 1 },
      order: {
        type: "string",
        enum: [
          "created_at_desc,id_desc",
          "occurred_at_desc,id_desc",
          "last_thought_at_desc,created_at_desc,id_desc",
        ],
      },
      hint: {
        type: "string",
        description: "Present only on a window-only order (strands order=recent): how to walk instead.",
      },
    },
    required: ["cursor", "next_cursor", "has_more", "limit", "order"],
  },
  CorrespondenceRepositoryPage: {
    type: "object",
    additionalProperties: false,
    description:
      "One page of the bearer project's repository streams, in the server's repository_id order (database collation; echo next_after rather than sorting). Each repository is then replayed through /v1/correspondence/events.",
    properties: {
      protocol: { type: "string", const: "agent-correspondence/v0.1" },
      scope: { type: "string", const: "project_private" },
      repositories: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            repository_id: { $ref: `${CORRESPONDENCE_EVENT_SCHEMA}#/$defs/opaqueId` },
            last_received_seq: {
              type: "string",
              pattern: "^(?:0|[1-9][0-9]*)$",
              description: "Highest project-local receipt cursor in this repository stream when read.",
            },
          },
          required: ["repository_id", "last_received_seq"],
        },
      },
      page: {
        type: "object",
        additionalProperties: false,
        properties: {
          after: {
            oneOf: [
              { $ref: `${CORRESPONDENCE_EVENT_SCHEMA}#/$defs/opaqueId` },
              { type: "null" },
            ],
          },
          next_after: {
            description: "Last returned repository_id, or the request's after on an empty page.",
            oneOf: [
              { $ref: `${CORRESPONDENCE_EVENT_SCHEMA}#/$defs/opaqueId` },
              { type: "null" },
            ],
          },
          has_more: { type: "boolean" },
        },
        required: ["after", "next_after", "has_more"],
      },
    },
    required: ["protocol", "scope", "repositories", "page"],
  },
};

const CONTINUITY_WALK_DESCRIPTION =
  "Newest-first keyset walk. Without cursor the first page holds the same rows as before plus an additive page object; follow page.next_cursor with identical filters and since until has_more is false. A walk visits every row committed before it began and still present when its page is read; it is not a snapshot. Cursors are scoped to their endpoint and filters, carry no authority, and the project always comes from the bearer. Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks).";

function continuityCursorParameter() {
  return {
    name: "cursor",
    in: "query",
    required: false,
    schema: { type: "string", minLength: 1, maxLength: 512 },
    description:
      "Opaque page.next_cursor from the previous page of this exact walk. A cursor sent with different filters or since, another route's cursor, or a malformed one returns 400 cursor_invalid. With a cursor, limit must be a positive decimal integer.",
  };
}

function continuityLimitParameter(defaultLimit: number, maximum: number) {
  return {
    name: "limit",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1, maximum, default: defaultLimit },
    description:
      `Rows per page. Without a cursor an empty or non-numeric value reads the default ${defaultLimit}, a value below 1 returns 400 limit_invalid, and values above ${maximum} are clamped. With a cursor only a positive decimal integer is accepted (above ${maximum} is clamped).`,
  };
}

/** Helpers owned by openapi.ts, passed in so this fragment shares its
 *  conventions without a circular import. */
export interface ContinuityWalkOpenApiHelpers {
  errorResponse: (description: string) => unknown;
  correspondenceResponseHeaders: () => unknown;
}

export function continuityWalkOpenApi(h: ContinuityWalkOpenApiHelpers) {
  function continuityWalkRefusal(codes: string) {
    return h.errorResponse(`Refused before any read: ${codes}. The hint says how to restart.`);
  }

  function correspondenceRepositoryHeaders() {
    return {
      ...(h.correspondenceResponseHeaders() as Record<string, unknown>),
      Link: {
        description:
          "RFC 8288 concrete links to self and stable doctrine. Per-repository voice and claims need a repository_id from the body.",
        schema: { type: "string" },
      },
    };
  }

  function correspondenceRepositoryParameters() {
    return [
      {
        name: "after",
        in: "query",
        required: false,
        schema: { $ref: `${CORRESPONDENCE_EVENT_SCHEMA}#/$defs/opaqueId` },
        description:
          "Exclusive repository_id position: echo the previous page's next_after. Order is the server's repository_id collation.",
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 200, default: 100 },
      },
      {
        name: "If-None-Match",
        in: "header",
        required: false,
        schema: { type: "string" },
        description: "Strong validator from the same authenticated representation.",
      },
    ];
  }

  return {
    memoriesGet: {
      tags: ["memory"],
      summary: "List recent memories (or filter by ?key=...)",
      description:
        `${CONTINUITY_WALK_DESCRIPTION} Order: created_at DESC, id DESC in list and key mode. since filters created_at > since in SQL. The list is read-only (accessed_at is not touched) and returns has_embedding, never the vector. Memories carry no updated_at, so tier or visibility changes are visible only to a full re-walk.`,
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
        continuityLimitParameter(20, 100),
        continuityCursorParameter(),
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
                  as_of: { type: "string", format: "date-time" },
                  since: { type: ["string", "null"] },
                  since_reason: { type: "string" },
                  page: { $ref: "#/components/schemas/CursorPage" },
                },
              },
            },
          },
        },
        "400": continuityWalkRefusal("invalid_tier, limit_invalid, or cursor_invalid"),
      },
    },
    strandsGet: {
      tags: ["strand"],
      summary: "List strands (filter: status, agent_id)",
      description:
        `order=recent (default) is today's window over last_thought_at DESC, created_at DESC, id DESC. last_thought_at changes on every thought, so that order cannot be walked: page.next_cursor is always null, has_more stays truthful, and page.hint names order=created; a cursor with order=recent returns 400 cursor_invalid. order=created walks created_at DESC, id DESC. ${CONTINUITY_WALK_DESCRIPTION}`,
      parameters: [
        { name: "status", in: "query", schema: { type: "string", enum: ["active", "dormant", "completed", "abandoned"] } },
        { name: "agent_id", in: "query", schema: { type: "string" } },
        {
          name: "order",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["recent", "created"], default: "recent" },
          description: "recent is a window; created is walkable with cursor. Anything else returns 400 order_invalid.",
        },
        continuityLimitParameter(50, 200),
        continuityCursorParameter(),
      ],
      responses: {
        "200": {
          description: "List",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  strands: { type: "array", items: { type: "object", additionalProperties: true } },
                  count: { type: "integer" },
                  page: { $ref: "#/components/schemas/CursorPage" },
                },
                required: ["strands", "count", "page"],
              },
            },
          },
        },
        "400": continuityWalkRefusal("order_invalid, limit_invalid, or cursor_invalid"),
      },
    },
    chronicleGet: {
      tags: ["continuity"],
      summary: "List chronicle moments (lived)",
      description:
        `${CONTINUITY_WALK_DESCRIPTION} Order: occurred_at DESC, id DESC. occurred_at is caller-set, so a row backdated during a walk or delta window can be missed until the next full walk.`,
      parameters: [
        { name: "agent_id", in: "query", required: false, schema: { type: "string", format: "uuid" } },
        { name: "type", in: "query", required: false, schema: { type: "string" } },
        {
          name: "since",
          in: "query",
          required: false,
          schema: { type: "string", format: "date-time" },
          description: "Delta read: occurred_at > since. Bound into the cursor; malformed or future values are echoed in since_reason and not applied.",
        },
        continuityLimitParameter(50, 200),
        continuityCursorParameter(),
      ],
      responses: {
        "200": {
          description: "List",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  entries: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", format: "uuid" },
                        type: { type: "string" },
                        title: { type: "string" },
                        body: { type: ["string", "null"] },
                        agent_id: { type: ["string", "null"], format: "uuid" },
                        occurred_at: { type: "string", format: "date-time" },
                        created_at: { type: "string", format: "date-time" },
                        metadata: { type: ["object", "null"], additionalProperties: true },
                      },
                      required: ["id", "type", "title", "body", "agent_id", "occurred_at", "created_at", "metadata"],
                    },
                  },
                  count: { type: "integer" },
                  as_of: { type: "string", format: "date-time" },
                  since: { type: ["string", "null"] },
                  since_reason: { type: "string" },
                  page: { $ref: "#/components/schemas/CursorPage" },
                },
                required: ["entries", "count", "as_of", "since", "since_reason", "page"],
              },
            },
          },
        },
        "400": continuityWalkRefusal("limit_invalid or cursor_invalid"),
      },
    },
    correspondenceRepositories: {
      get: {
        tags: ["correspondence"],
        summary: "List every repository stream in the bearer project",
        description:
          "Enumerates the project's distinct repository_id streams with each stream's last receipt cursor, so a reader can replay every /v1/correspondence/events stream without knowing repository ids in advance. Pages use the family's exclusive after/next_after position in the server's repository_id collation; next_after echoes after on an empty page. Strict exact query: unknown or repeated parameters return 400 query_invalid. Vendor JSON is the default; application/json is the same exact body. No Atom. Global welcome/tutor/play middleware does not decorate this body. A listing is not a lock, a claim, or authority. Doctrine: docs/AGENT-CORRESPONDENCE.md.",
        parameters: correspondenceRepositoryParameters(),
        responses: {
          "200": {
            description: "Bounded repository index page",
            headers: correspondenceRepositoryHeaders(),
            content: {
              [CORRESPONDENCE_JSON_MEDIA_TYPE]: {
                schema: { $ref: "#/components/schemas/CorrespondenceRepositoryPage" },
              },
              "application/json": {
                schema: { $ref: "#/components/schemas/CorrespondenceRepositoryPage" },
              },
            },
          },
          "304": {
            description: "If-None-Match matched; no body",
            headers: correspondenceRepositoryHeaders(),
          },
          "400": h.errorResponse("Unknown or repeated query parameter, after_invalid, or limit_invalid (limit must be 1..200)"),
          "406": h.errorResponse("No acceptable correspondence JSON representation was requested"),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": h.errorResponse(
            "Repository index temporarily unavailable. An unavailable index never masquerades as an empty one.",
          ),
        },
      },
      head: {
        tags: ["correspondence"],
        summary: "Read repository index validators without a body",
        description:
          "Applies the same query rules and negotiation as GET, returning its validators and links without a body.",
        parameters: correspondenceRepositoryParameters(),
        responses: {
          "200": {
            description: "Same headers as GET, without a body",
            headers: correspondenceRepositoryHeaders(),
          },
          "304": {
            description: "If-None-Match matched; no body",
            headers: correspondenceRepositoryHeaders(),
          },
          "400": h.errorResponse("Unknown or repeated query parameter, after_invalid, or limit_invalid (limit must be 1..200)"),
          "406": h.errorResponse("No acceptable correspondence JSON representation was requested"),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "503": h.errorResponse(
            "Repository index temporarily unavailable. An unavailable index never masquerades as an empty one.",
          ),
        },
      },
    },
  };
}
