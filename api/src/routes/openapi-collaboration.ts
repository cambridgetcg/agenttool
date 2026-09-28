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
const mission = { name: "mission_id", in: "path", required: true, schema: uuid };
const grant = { name: "grant_id", in: "path", required: true, schema: uuid };
const proof = [
  ["Grant-Id", uuid], ["Identity-Id", uuid], ["Key-Id", uuid], ["Timestamp", date],
  ["Signature", { type: "string", pattern: "^[A-Za-z0-9_-]{86}$", description: "Ed25519 over the SHA-256 digest of domain-separated NUL-delimited request fields; canonical unpadded base64url. See the linked contract." }],
].map(([name, schema]) => ({ name: `X-Agenttool-Mission-${name}`, in: "header", required: true, schema }));
const errors = {
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
};
const jsonBody = (schema: object) => ({ required: true, content: { "application/json": { schema } } });
const common = {
  tags: ["collaboration"], externalDocs: { url: "https://docs.agenttool.dev/COLLABORATION-MISSIONS.md" },
};
function operation(summary: string, participant: boolean, options: { create?: boolean; body?: object; description?: string; parameters?: object[] } = {}) {
  return {
    ...common, summary,
    description: `${options.description ?? ""} All responses are private, no-store. Exact canonical routes only. Same-project scope; principality and seat labels convey no authority.`,
    security: participant ? [{ missionGrant: [] }] : [{ bearerAuth: [] }],
    parameters: [...(participant ? proof : []), ...(options.parameters ?? [])],
    ...(options.body ? { requestBody: jsonBody(options.body) } : {}),
    responses: { ...errors, [options.create ? "201" : "200"]: { description: options.create ? "Created; credential tokens, when issued, are returned only once" : "Bounded metadata, acceptance or receipt; no token or verifier in reads" },
      ...(participant && options.create ? { "200": { description: "Exact retry returns original receipt after current authority checks" } } : {}),
    },
  };
}
const base = "/v1/collaboration/missions";
export const COLLABORATION_OPENAPI_PATHS = {
  [base]: { post: operation("Create an immutable bounded mission", false, { create: true, body: {
    type: "object", additionalProperties: false, required: ["mission_id", "descriptor", "expires_at"], properties: { mission_id: uuid, descriptor, expires_at: date },
  }, description: "Administrator only. Lifetime at most 30 days; envelope and descriptor each at most 32 KiB. Duplicate mission_id conflicts." }) },
  [`${base}/{mission_id}`]: { parameters: [mission], get: operation("Inspect a mission in the bearer project", false) },
  [`${base}/{mission_id}/revoke`]: { parameters: [mission], post: operation("Revoke a mission idempotently", false, { description: "No body. Later participant admissions fail; previously delivered bytes cannot be retracted." }) },
  [`${base}/{mission_id}/grants`]: { parameters: [mission], post: operation("Issue one independently revocable participant invitation", false, { create: true, body: {
    type: "object", additionalProperties: false, required: ["grant_id", "identity_id", "signing_key_id", "actions", "expires_at"], properties: {
      grant_id: uuid, identity_id: uuid, signing_key_id: uuid, expires_at: date,
      actions: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ["mission.read", "mission.observe"] } },
    },
  }, description: "One active project-owned identity and registered signing key. At most 24 hours, bounded by mission and issuing parent key. Hash-only atcm_ token returned once; duplicate grant_id conflicts. After an ambiguous response inspect/revoke the known ID before choosing another." }) },
  [`${base}/{mission_id}/grants/{grant_id}`]: { parameters: [mission, grant], get: operation("Inspect grant metadata without recovering its token", false) },
  [`${base}/{mission_id}/grants/{grant_id}/revoke`]: { parameters: [mission, grant], post: operation("Revoke this participant grant idempotently", false, { description: "No body. Serialized with admission; already admitted transactions may finish first." }) },
  [`${base}/{mission_id}/invitation`]: { parameters: [mission], get: operation("Read own invitation before accepting", true, { description: "Grant plus exact-request signature required. Exposes only own scope and immutable descriptor. No acceptance or reply obligation." }) },
  [`${base}/{mission_id}/accept`]: { parameters: [mission], post: operation("Accept the immutable descriptor digest", true, { body: {
    type: "object", additionalProperties: false, required: ["mission_digest"], properties: { mission_digest: digest },
  }, description: "Explicit registered-key proof, intrinsic invitation action. Repeat valid acceptance is harmless. Does not claim independent agency or subjective consent." }) },
  [`${base}/{mission_id}/context`]: { parameters: [mission], get: operation("Read accepted mission context", true, { description: "Requires mission.read and prior acceptance. No private memory or task authority." }) },
  [`${base}/{mission_id}/events`]: {
    parameters: [mission],
    get: operation("Read a bounded observation page", true, { parameters: [
      { name: "after", in: "query", schema: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$", default: "0" } },
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
    ], description: "Requires accepted mission.read. Canonical query order after then limit; no unknown/duplicate fields. Receipt sequence is a decimal cursor, not causal order." }),
    post: operation("Append one signed observation with durable replay", true, { create: true, body: {
      type: "object", additionalProperties: false, required: ["event_id", "summary"], properties: {
        event_id: uuid, summary: { type: "string", minLength: 1, maxLength: 1000 },
        seat: { type: "object", additionalProperties: false, required: ["device_id", "session_id", "harness"], properties: Object.fromEntries(["device_id", "session_id", "harness"].map(name => [name, { type: "string", minLength: 1, maxLength: 128 }])) },
      },
    }, description: "Requires accepted mission.observe. At most 8 KiB. Same event UUID, grant, key, identity and exact raw body bytes returns original receipt; changed bytes/author conflicts. Fresh proof allowed for retry, but current authority always rechecked." }),
  },
};
