/** Curated local-context OpenAPI schemas and paths.
 * Ordinary production source, scanned with the main document under the same
 * 10,000-line Whitehack ceiling. No generated or excluded scan boundary.
 * Doctrine: docs/LOCAL-CONTEXT-GRANTS.md.
 */

const LOCAL_CONTEXT_V1_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["format", "project_id", "identity_id", "generated_at", "scope", "bounds", "used_content_bytes", "records", "omissions", "has_more"],
  properties: {
    format: { const: "agenttool-local-api-context/v1" },
    project_id: { type: "string", format: "uuid" },
    identity_id: { type: "string", format: "uuid" },
    generated_at: { type: "string", format: "date-time" },
    scope: {
      type: "object", additionalProperties: false,
      required: ["authentication", "selection", "identity_proven", "bearer_attenuated", "project_shared_included"],
      properties: {
        authentication: { const: "project_bearer" }, selection: { const: "identity_partition" },
        identity_proven: { const: false }, bearer_attenuated: { const: false }, project_shared_included: { const: false },
      },
    },
    bounds: {
      type: "object", additionalProperties: false,
      required: ["max_items", "max_candidates", "max_record_bytes", "max_content_bytes", "max_response_bytes"],
      properties: {
        max_items: { const: 8 }, max_candidates: { const: 32 }, max_record_bytes: { const: 4096 },
        max_content_bytes: { const: 8192 }, max_response_bytes: { const: 32768 },
      },
    },
    used_content_bytes: { type: "integer", minimum: 0, maximum: 8192 },
    records: { type: "array", maxItems: 8, items: {
      type: "object", additionalProperties: false,
      required: ["id", "created_at", "expires_at", "content_bytes", "sha256", "content"],
      properties: {
        id: { type: "string", format: "uuid" }, created_at: { type: "string", format: "date-time" },
        expires_at: { type: ["string", "null"], format: "date-time" },
        content_bytes: { type: "integer", minimum: 0, maximum: 4096 },
        sha256: { type: "string", pattern: "^[0-9a-f]{64}$" }, content: { type: "string" },
      },
    } },
    omissions: { type: "array", maxItems: 32, items: {
      type: "object", additionalProperties: false, required: ["id", "reason"],
      properties: { id: { type: "string", format: "uuid" }, reason: { enum: ["record_too_large", "invalid_content", "content_budget", "item_limit"] } },
    } },
    has_more: { type: "boolean", description: "More rows exist beyond the bounded candidate window; omissions can exist even when false." },
  },
};
const LOCAL_CONTEXT_V2_SCHEMA = {
  ...LOCAL_CONTEXT_V1_SCHEMA,
  required: [...LOCAL_CONTEXT_V1_SCHEMA.required, "authorization"],
  properties: {
    ...LOCAL_CONTEXT_V1_SCHEMA.properties,
    format: { const: "agenttool-local-api-context/v2" },
    scope: {
      ...LOCAL_CONTEXT_V1_SCHEMA.properties.scope,
      properties: {
        ...LOCAL_CONTEXT_V1_SCHEMA.properties.scope.properties,
        authentication: { const: "local_context_grant" },
        bearer_attenuated: { const: true },
      },
    },
    authorization: {
      type: "object", additionalProperties: false,
      required: ["grant_id", "origin", "action", "method", "path", "issued_at", "expires_at", "checked_at"],
      properties: {
        grant_id: { type: "string", format: "uuid" },
        origin: { type: "string", format: "uri", description: "Configured HTTPS service audience; the client independently pins its request origin." },
        action: { const: "local_context.read" }, method: { const: "GET" },
        path: { type: "string", pattern: "^/v1/identities/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/local-context$" },
        issued_at: { type: "string", format: "date-time" },
        expires_at: { type: "string", format: "date-time" },
        checked_at: { type: "string", format: "date-time", description: "Snapshot admission time, not a promise that authority remains live after this response." },
      },
    },
  },
};

const LOCAL_CONTEXT_GRANT_METADATA_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["grant_id", "project_id", "identity_id", "issuing_api_key_id", "origin", "action", "method", "path", "issued_at", "expires_at", "revoked_at"],
  properties: {
    grant_id: { type: "string", format: "uuid" },
    origin: LOCAL_CONTEXT_V2_SCHEMA.properties.authorization.properties.origin,
    action: { const: "local_context.read" }, method: { const: "GET" },
    path: LOCAL_CONTEXT_V2_SCHEMA.properties.authorization.properties.path,
    issued_at: { type: "string", format: "date-time" },
    expires_at: { type: "string", format: "date-time" },
    project_id: { type: "string", format: "uuid" },
    identity_id: { type: "string", format: "uuid" },
    issuing_api_key_id: { type: "string", format: "uuid" },
    revoked_at: { type: ["string", "null"], format: "date-time" },
  },
};
const LOCAL_CONTEXT_GRANT_RESPONSE = {
  type: "object", required: ["grant"],
  properties: { grant: LOCAL_CONTEXT_GRANT_METADATA_SCHEMA },
};

export const LOCAL_CONTEXT_OPENAPI_PATHS = {
  "/v1/identities/{id}/local-context": {
    get: {
      tags: ["identity"],
      summary: "Read a bounded memory window for one owned active identity",
      description: "Exact GET with no query parameters. A project bearer receives the existing v1 projection; a separately issued local-context grant receives a closed v2 authorization receipt and only this selected read. Both exclude project-shared, unbound and expired memories. Grant admission rechecks expiry/revocation, the issuing key and active ownership in the same read-only snapshot as memory selection. Neither credential proves identity-root control. No auth telemetry, body decoration, project-credit header, Wake acknowledgement or automatic local write.",
      security: [{ bearerAuth: [] }, { localContextGrant: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": {
          description: "Complete selected records, scope and explicit omissions; Cache-Control: private, no-store",
          content: { "application/json": { schema: { oneOf: [LOCAL_CONTEXT_V1_SCHEMA, LOCAL_CONTEXT_V2_SCHEMA] } } },
        },
        "400": { $ref: "#/components/responses/Validation" },
        "401": { description: "A valid project bearer or exact-target local-context grant is required" },
        "405": { description: "Local-context reads accept GET only; a grant cannot authorize another method" },
        "404": { $ref: "#/components/responses/NotFound" },
        "503": { description: "Projection unavailable; no fallback to project-wide Wake" },
      },
    },
  },
  "/v1/identities/{id}/local-context-grants": {
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
    post: {
      tags: ["identity"],
      summary: "Issue a short-lived credential for one identity's exact local-context read",
      description: "Project administrator only; no query parameters. Explicit expiry must be future, at most 24 hours from issuance and no later than the current issuing key's expiry. The service fixes origin, subject, action, method and path. The caller's immutable grant_id is the durable request identity: duplicate IDs return 409 without reminting or replaying plaintext. No Redis idempotency replay, root-consent claim, child delegation or refresh. After an ambiguous response inspect the known ID and revoke it if the token was lost before deliberately choosing another ID.",
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: ["grant_id", "expires_at"],
        properties: { grant_id: { type: "string", format: "uuid" }, expires_at: { type: "string", format: "date-time", maxLength: 32 } },
      } } } },
      responses: {
        "201": { description: "Grant metadata and plaintext token returned once; private, no-store", content: { "application/json": { schema: {
          ...LOCAL_CONTEXT_GRANT_RESPONSE, required: ["grant", "token"],
          properties: { ...LOCAL_CONTEXT_GRANT_RESPONSE.properties, token: { type: "string", pattern: "^atlc_[A-Za-z0-9_-]{43}$", description: "Store only in the reader's existing credential mechanism, never model context or notes." } },
        } } } },
        "400": { $ref: "#/components/responses/Validation" },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "403": { description: "Issuing key is unavailable or does not cover the requested lifetime" },
        "404": { $ref: "#/components/responses/NotFound" },
        "409": { description: "The immutable grant ID already exists; inspect or revoke it, never silently retry with a new ID" },
        "413": { description: "Request exceeds the 2 KiB body limit" },
        "503": { description: "Grant issuance unavailable; inspect the known ID after an ambiguous outcome" },
      },
    },
    get: {
      tags: ["identity"], summary: "Inspect the newest 50 grant metadata records for this project and identity",
      description: "Administrator-only bounded inventory, including expired/revoked grants. No token or verifier, no query parameters or pagination. This is not a complete export; inspect an exact known grant ID for issuance recovery. Metadata remains inspectable for inactive subjects.",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": { description: "Bounded metadata; private, no-store", content: { "application/json": { schema: {
          type: "object", required: ["grants"], properties: { grants: { type: "array", maxItems: 50, items: LOCAL_CONTEXT_GRANT_METADATA_SCHEMA } },
        } } } },
        "400": { $ref: "#/components/responses/Validation" },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "503": { description: "Grant metadata unavailable" },
      },
    },
  },
  "/v1/identities/{id}/local-context-grants/{grant_id}": {
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      { name: "grant_id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ],
    get: {
      tags: ["identity"], summary: "Inspect one known grant ID without recovering its token",
      description: "Project-administrator recovery after ambiguous issuance. Exact canonical UUIDs, no query parameters. Inactive subjects retain metadata access.",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": { description: "Grant metadata; private, no-store", content: { "application/json": { schema: LOCAL_CONTEXT_GRANT_RESPONSE } } },
        "400": { $ref: "#/components/responses/Validation" },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "404": { $ref: "#/components/responses/NotFound" },
        "503": { description: "Grant metadata unavailable" },
      },
    },
    delete: {
      tags: ["identity"], summary: "Revoke one local-context grant idempotently",
      description: "Project administrator only; no body or query parameters. Revocation prevents later admission but cannot erase previously delivered context or stop an already admitted response. Retains the immutable grant ID; no token recovery or renewal.",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": { description: "Retained grant metadata with revoked_at; private, no-store", content: { "application/json": { schema: LOCAL_CONTEXT_GRANT_RESPONSE } } },
        "400": { $ref: "#/components/responses/Validation" },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "404": { $ref: "#/components/responses/NotFound" },
        "503": { description: "Revocation unavailable; inspect the known ID after an ambiguous outcome" },
      },
    },
  },
};
