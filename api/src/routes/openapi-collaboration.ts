/** Curated mission wire contract. Doctrine: docs/COLLABORATION-MISSIONS.md. */
const uuid = { type: "string", format: "uuid", pattern: "^[0-9a-f-]{36}$" };
const date = { type: "string", format: "date-time", description: "Canonical UTC milliseconds, e.g. 2026-09-28T12:00:00.000Z." };
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const ref = { type: "object", additionalProperties: false, required: ["uri", "format", "digest"], properties: {
  uri: { type: "string", maxLength: 1024, pattern: "^(https://|urn:)" }, format: { type: "string", minLength: 1, maxLength: 128 }, digest,
} };
const descriptor = { type: "object", additionalProperties: false, required: ["format", "purpose", "resources", "acceptance_criteria", "principalities"], properties: {
  format: { const: "agenttool-collaboration-mission/v1" }, purpose: { type: "string", minLength: 1, maxLength: 2000 },
  resources: { type: "array", maxItems: 20, items: ref }, principalities: { type: "array", maxItems: 20, items: ref },
  acceptance_criteria: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 1000 } },
} };
const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullableDate = { ...date, type: ["string", "null"] };
const closedObject = (properties: Record<string, object>) => ({
  type: "object", additionalProperties: false, required: Object.keys(properties), properties,
});
const bodyHash = { type: "string", pattern: "^[0-9a-f]{64}$", description: "Lowercase SHA-256 of exact UTF-8 body bytes; no sha256: prefix." };
const rawBody = { type: "string", maxLength: 8192, description: "Exact submitted UTF-8 JSON body (at most 8192 bytes); do not reserialize before verifying or retrying. Preserves a submitted BOM." };
export const COLLABORATION_OPENAPI_SCHEMAS = {
  CollaborationMission: closedObject({
    mission_id: uuid, project_id: uuid, descriptor, mission_digest: digest,
    created_at: date, expires_at: date, revoked_at: nullableDate,
    scope: { type: "string", const: "mission_selected_context" },
    authority: { type: "string", const: "descriptive_context_only" },
  }),
  CollaborationMissionResponse: closedObject({ mission: schemaRef("CollaborationMission") }),
  CollaborationGrant: closedObject({
    grant_id: uuid, mission_id: uuid, project_id: uuid, identity_id: uuid,
    signing_key_id: uuid, issuing_api_key_id: uuid,
    origin: { type: "string", format: "uri", pattern: "^https://", maxLength: 512 },
    actions: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string", enum: ["mission.read", "mission.observe"] } },
    issued_at: date, expires_at: date, accepted_at: nullableDate, revoked_at: nullableDate,
  }),
  CollaborationGrantResponse: closedObject({ grant: schemaRef("CollaborationGrant") }),
  CollaborationContextResponse: closedObject({
    mission: schemaRef("CollaborationMission"), grant: schemaRef("CollaborationGrant"),
  }),
  CollaborationGrantIssuedResponse: closedObject({
    grant: schemaRef("CollaborationGrant"),
    token: { type: "string", pattern: "^atcm_[A-Za-z0-9_-]{43}$", description: "Secret invitation token, returned once at issuance. Never present in metadata reads or replayed after a duplicate grant ID." },
  }),
  CollaborationObservation: {
    type: "object", additionalProperties: false, required: ["event_id", "summary"], properties: {
      event_id: uuid, summary: { type: "string", minLength: 1, maxLength: 1000 },
      seat: closedObject(Object.fromEntries(["device_id", "session_id", "harness"].map(name => [name, { type: "string", minLength: 1, maxLength: 128 }]))),
    },
  },
  CollaborationEventProof: closedObject({
    domain: { type: "string", const: "agenttool-collaboration-request/v1" },
    origin: { type: "string", format: "uri", pattern: "^https://", maxLength: 512 },
    method: { type: "string", const: "POST" },
    request_target: { type: "string", pattern: "^/v1/collaboration/missions/[0-9a-f-]{36}/events$" },
    timestamp: date,
    signature: { type: "string", pattern: "^[A-Za-z0-9_-]{86}$", description: "Canonical unpadded base64url Ed25519 signature." },
    public_key: { type: "string", minLength: 1, description: "Registered Ed25519 public key as stored, decoded as base64; verify against an independently trusted key, not this field alone." },
    raw_body: rawBody, body_sha256: bodyHash,
  }),
  CollaborationEvent: closedObject({
    event_id: uuid, mission_id: uuid, grant_id: uuid, identity_id: uuid, signing_key_id: uuid,
    received_seq: { type: "string", pattern: "^[1-9][0-9]{0,18}$", description: "Positive PostgreSQL bigint receipt sequence, at most 9223372036854775807. A decimal string, not a JSON number or causal order." },
    received_at: date, observation: schemaRef("CollaborationObservation"),
    raw_body: rawBody, body_sha256: bodyHash, proof: schemaRef("CollaborationEventProof"),
  }),
  CollaborationEventResponse: closedObject({ event: schemaRef("CollaborationEvent") }),
  CollaborationEventsResponse: closedObject({
    mission_id: uuid,
    events: { type: "array", maxItems: 50, items: schemaRef("CollaborationEvent") },
    page: closedObject({
      after: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$", description: "Requested exclusive decimal cursor, at most 9223372036854775807." },
      next_cursor: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$", description: "Last returned receipt sequence, or after for an empty page. Not null on a terminal page." },
      has_more: { type: "boolean", description: "More observations remain beyond this complete-event page; follow next_cursor when true." },
    }),
  }),
  CollaborationError: {
    type: "object", additionalProperties: false,
    required: ["error", "message", "hint", "next_actions", "docs", "axiom_id"],
    properties: {
      error: { type: "string", minLength: 1 }, message: { type: "string" }, hint: { type: "string" },
      next_actions: { type: "array", items: closedObject({ action: { type: "string" }, method: { type: "null" } }) },
      docs: { type: "string", format: "uri" }, axiom_id: { type: "integer" },
      _quip: { type: "string", description: "Optional additive guided-error quip; clients must not require it." },
    },
  },
  CollaborationEarlyDataError: closedObject({
    error: { type: "string", const: "too_early" }, message: { type: "string" },
  }),
};
const mission = { name: "mission_id", in: "path", required: true, schema: uuid };
const grant = { name: "grant_id", in: "path", required: true, schema: uuid };
const proof = [
  ["Grant-Id", uuid], ["Identity-Id", uuid], ["Key-Id", uuid], ["Timestamp", date],
  ["Signature", { type: "string", pattern: "^[A-Za-z0-9_-]{86}$", description: "Ed25519 over the SHA-256 digest of domain-separated NUL-delimited request fields; canonical unpadded base64url. See the linked contract." }],
].map(([name, schema]) => ({ name: `X-Agenttool-Mission-${name}`, in: "header", required: true, schema }));
function jsonResponse(description: string, schema: object, headers: Record<string, object> = {}) {
  return {
    description,
    headers: { "Cache-Control": { schema: { type: "string", const: "private, no-store" } }, ...headers },
    content: { "application/json": { schema } },
  };
}
const errors = Object.fromEntries(Object.entries({
  "400": { description: "Noncanonical target, duplicate/invalid JSON, body on read, or invalid proof fields" },
  "401": { description: "Invalid, expired, revoked or differently scoped credential or registered-key proof" },
  "403": { description: "Explicit signed acceptance is required" },
  "404": { description: "Mission or grant not available in the administrator's project" },
  "405": { description: "Unsupported method; HEAD is explicitly denied" },
  "409": { description: "Durable identifier conflict; issued tokens are never recovered or replayed" },
  "413": { description: "Body exceeds the bounded request size" },
  "415": { description: "JSON mutations require application/json" },
  "425": { description: "TLS early data refused before admission" },
  "503": { description: "Mission operation unavailable; ambiguous mutations require exact-ID recovery" },
}).map(([status, { description }]) => [status, jsonResponse(description,
  schemaRef(status === "425" ? "CollaborationEarlyDataError" : "CollaborationError"),
  status === "425" ? {
    "Retry-After": { schema: { type: "string", const: "0" } },
    Vary: { schema: { type: "string", const: "Early-Data" } },
  } : status === "405" ? {
    Allow: { schema: { type: "string", enum: ["GET", "POST", "GET, POST"] } },
  } : {},
)]));
const jsonBody = (schema: object) => ({ required: true, content: { "application/json": { schema } } });
const common = {
  tags: ["collaboration"], externalDocs: { url: "https://docs.agenttool.dev/COLLABORATION-MISSIONS.md" },
};
function operation(summary: string, participant: boolean, options: { response: object; create?: boolean; body?: object; description?: string; parameters?: object[] }) {
  return {
    ...common, summary,
    description: `${options.description ?? ""} All responses are private, no-store. Exact canonical routes only. Same-project scope; principality and seat labels convey no authority.`,
    security: participant ? [{ missionGrant: [] }] : [{ bearerAuth: [] }],
    parameters: [...(participant ? proof : []), ...(options.parameters ?? [])],
    ...(options.body ? { requestBody: jsonBody(options.body) } : {}),
    responses: { ...errors, [options.create ? "201" : "200"]: jsonResponse(
      options.create ? "Created; credential tokens, when issued, are returned only once" : "Bounded metadata, acceptance or receipt; invitation secrets are not returned in reads", options.response),
      ...(participant && options.create ? { "200": jsonResponse("Exact retry returns original receipt after current authority checks", options.response) } : {}),
    },
  };
}
const base = "/v1/collaboration/missions";
export const COLLABORATION_OPENAPI_PATHS = {
  [base]: { post: operation("Create an immutable bounded mission", false, { create: true, response: schemaRef("CollaborationMissionResponse"), body: {
    type: "object", additionalProperties: false, required: ["mission_id", "descriptor", "expires_at"], properties: { mission_id: uuid, descriptor, expires_at: date },
  }, description: "Administrator only. Lifetime at most 30 days; envelope and descriptor each at most 32 KiB. Duplicate mission_id conflicts." }) },
  [`${base}/{mission_id}`]: { parameters: [mission], get: operation("Inspect a mission in the bearer project", false, { response: schemaRef("CollaborationMissionResponse") }) },
  [`${base}/{mission_id}/revoke`]: { parameters: [mission], post: operation("Revoke a mission idempotently", false, { response: schemaRef("CollaborationMissionResponse"), description: "No body. Later participant admissions fail; previously delivered bytes cannot be retracted." }) },
  [`${base}/{mission_id}/grants`]: { parameters: [mission], post: operation("Issue one independently revocable participant invitation", false, { create: true, response: schemaRef("CollaborationGrantIssuedResponse"), body: {
    type: "object", additionalProperties: false, required: ["grant_id", "identity_id", "signing_key_id", "actions", "expires_at"], properties: {
      grant_id: uuid, identity_id: uuid, signing_key_id: uuid, expires_at: date,
      actions: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ["mission.read", "mission.observe"] } },
    },
  }, description: "One active project-owned identity and registered signing key. At most 24 hours, bounded by mission and issuing parent key. Hash-only atcm_ token returned once; duplicate grant_id conflicts. After an ambiguous response inspect/revoke the known ID before choosing another." }) },
  [`${base}/{mission_id}/grants/{grant_id}`]: { parameters: [mission, grant], get: operation("Inspect grant metadata without recovering its token", false, { response: schemaRef("CollaborationGrantResponse") }) },
  [`${base}/{mission_id}/grants/{grant_id}/revoke`]: { parameters: [mission, grant], post: operation("Revoke this participant grant idempotently", false, { response: schemaRef("CollaborationGrantResponse"), description: "No body. Serialized with admission; already admitted transactions may finish first." }) },
  [`${base}/{mission_id}/invitation`]: { parameters: [mission], get: operation("Read own invitation before accepting", true, { response: schemaRef("CollaborationContextResponse"), description: "Grant plus exact-request signature required. Exposes only own scope and immutable descriptor. No acceptance or reply obligation." }) },
  [`${base}/{mission_id}/accept`]: { parameters: [mission], post: operation("Accept the immutable descriptor digest", true, { response: schemaRef("CollaborationContextResponse"), body: {
    type: "object", additionalProperties: false, required: ["mission_digest"], properties: { mission_digest: digest },
  }, description: "Explicit registered-key proof, intrinsic invitation action. Repeat valid acceptance is harmless. Does not claim independent agency or subjective consent." }) },
  [`${base}/{mission_id}/context`]: { parameters: [mission], get: operation("Read accepted mission context", true, { response: schemaRef("CollaborationContextResponse"), description: "Requires mission.read and prior acceptance. No private memory or task authority." }) },
  [`${base}/{mission_id}/events`]: {
    parameters: [mission],
    get: operation("Read a bounded observation page", true, { response: schemaRef("CollaborationEventsResponse"), parameters: [
      { name: "after", in: "query", schema: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$", default: "0" } },
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
    ], description: "Requires accepted mission.read. Canonical query order after then limit; no unknown/duplicate fields. Receipt sequence is a decimal cursor, not causal order." }),
    post: operation("Append one signed observation with durable replay", true, { create: true, response: schemaRef("CollaborationEventResponse"),
      body: schemaRef("CollaborationObservation"),
      description: "Requires accepted mission.observe. At most 8 KiB. Same event UUID, grant, key, identity and exact raw body bytes returns original receipt; changed bytes/author conflicts. Fresh proof allowed for retry, but current authority always rechecked." }),
  },
};
