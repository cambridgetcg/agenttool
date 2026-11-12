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
function operation(summary: string, participant: boolean, options: { create?: boolean; body?: object; description?: string; parameters?: object[]; responses?: Record<string, object> } = {}) {
  return {
    ...common, summary,
    description: `${options.description ?? ""} All responses are private, no-store. Exact canonical routes only. Same-project scope; principality and seat labels convey no authority.`,
    security: participant ? [{ missionGrant: [] }] : [{ bearerAuth: [] }],
    parameters: [...(participant ? proof : []), ...(options.parameters ?? [])],
    ...(options.body ? { requestBody: jsonBody(options.body) } : {}),
    responses: { ...errors, [options.create ? "201" : "200"]: { description: options.create ? "Created; credential tokens, when issued, are returned only once" : "Bounded metadata, acceptance or receipt; no token or verifier in reads" },
      ...(participant && options.create ? { "200": { description: "Exact retry returns original receipt after current authority checks" } } : {}),
      ...options.responses,
    },
  };
}
const tokenSha256 = { type: "string", pattern: "^[0-9a-f]{64}$", description: "Optional. Lowercase hex SHA-256 of the UTF-8 bytes of a participant-generated token shaped atcm_ plus 43 base64url characters (32 random bytes). The participant keeps the token; the server stores only this hash." };
const grantObject = { type: "object", description: "Grant metadata; never the token or its hash." };
const issuedGrant = { oneOf: [
  { type: "object", additionalProperties: false, required: ["grant", "token"], properties: { grant: grantObject,
    token: { type: "string", pattern: "^atcm_[A-Za-z0-9_-]{43}$", description: "Server-minted when token_sha256 is omitted; returned once." } } },
  { type: "object", additionalProperties: false, required: ["grant", "token_sha256", "token_source"], properties: { grant: grantObject,
    token_sha256: tokenSha256, token_source: { const: "participant" } } },
] };
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
      token_sha256: tokenSha256,
      renewable_until: { ...date, description: "Optional renewal window. Later than expires_at, at most 30 days ahead and never past the mission or issuing key (a noncanonical value is 400 invalid_mission_grant_request; a well-formed one outside these bounds is 400 collaboration_mission_invalid_request; one past mission or key authority is 401). The grant must last at least one hour. The participant may then renew within it; the grant metadata gains a renewal object." },
    },
  }, description: "One active project-owned identity and registered signing key. At most 24 hours, bounded by mission and issuing parent key. Without token_sha256, a hash-only atcm_ token is returned once. With token_sha256, the response echoes it with token_source \"participant\" and contains no token. Duplicate grant_id conflicts; a token hash already bound to any grant is refused with token_hash_conflict. After an ambiguous response inspect/revoke the known ID before choosing another. With renewable_until the grant roots a renewal chain.",
  responses: {
    "201": { description: "Created. Exactly one shape: server-minted token returned once, or the participant's echoed token_sha256 with no token.", content: { "application/json": { schema: issuedGrant } } },
    "400": { description: "Invalid grant request (invalid_mission_grant_request, including a noncanonical renewable_until); a malformed token_sha256 is refused with invalid_token_sha256; a well-formed renewable_until outside its bounds is collaboration_mission_invalid_request" },
    "409": { description: "Known grant_id (collaboration_mission_conflict) or a token hash already bound to a grant (token_hash_conflict); tokens are never recovered or replayed" },
  } }) },
  [`${base}/{mission_id}/grants/{grant_id}`]: { parameters: [mission, grant], get: operation("Inspect grant metadata without recovering its token", false) },
  [`${base}/{mission_id}/grants/{grant_id}/revoke`]: { parameters: [mission, grant], post: operation("Revoke this participant grant idempotently", false, { description: "No body. Serialized with admission; already admitted transactions may finish first. Revoking any member of a renewal chain, even an expired, left or already revoked one, ends every member of that chain." }) },
  [`${base}/{mission_id}/grants/{grant_id}/renewal/close`]: { parameters: [mission, grant], post: operation("Close a renewal chain's window once", false, { description: "No body. Any member's grant_id. Stamps renewal.closed_at on every member of the chain, keeping the first value; revokes nothing, so live members run out. There is no reopen; new authority is a fresh grant. A grant without a window returns its metadata unchanged." }) },
  [`${base}/{mission_id}/invitation`]: { parameters: [mission], get: operation("Read own invitation before accepting", true, { description: "Grant plus exact-request signature required. Exposes only own scope and immutable descriptor. No acceptance or reply obligation." }) },
  [`${base}/{mission_id}/accept`]: { parameters: [mission], post: operation("Accept the immutable descriptor digest", true, { body: {
    type: "object", additionalProperties: false, required: ["mission_digest"], properties: { mission_digest: digest },
  }, description: "Explicit registered-key proof, intrinsic invitation action. Repeat valid acceptance is harmless. Does not claim independent agency or subjective consent." }) },
  [`${base}/{mission_id}/leave`]: { parameters: [mission], post: operation("Leave the mission by revoking the caller's own grant (its whole renewal chain)", true, { description: "No body: sign the SHA-256 of zero bytes. Requires prior acceptance; any action set may leave. Revokes the grant named by the token and proof, recording reason participant_left. For a member of a renewal chain it ends every member, including any successor, and closes the window: leaving through an old predecessor also ends the current grant. An exact repeat with a fresh proof returns the same state while the grant would otherwise be admissible; every other use of the token is then refused. Every grant outside that chain and the mission are unaffected; observations already stored remain.",
    responses: { "200": { description: "The caller's grant is revoked by the participant; identical for the first leave and any repeat", content: { "application/json": { schema: {
      type: "object", additionalProperties: false, required: ["mission_id", "grant_id", "status", "reason", "revoked_at"], properties: {
        mission_id: uuid, grant_id: uuid, status: { const: "revoked" }, reason: { const: "participant_left" }, revoked_at: date,
      },
    } } } } } }) },
  [`${base}/{mission_id}/renew`]: { parameters: [mission], post: operation("Renew this grant into a successor inside its window", true, { create: true, body: {
    type: "object", additionalProperties: false, required: ["grant_id", "mission_digest", "token_sha256"], properties: {
      grant_id: { ...uuid, description: "New grant UUID chosen by the participant; never the presented grant." }, mission_digest: digest,
      token_sha256: { ...tokenSha256, description: "SHA-256 of a fresh participant-generated token; never the presented token's." },
    },
  }, description: "The bearer and proof name the live accepted grant being renewed. Opens halfway through that grant's life, until renewable_until or close. The successor copies identity, key, issuing key, origin and actions, is born accepted, and expires at min(now + root lifetime, renewable_until, mission end, issuing key expiry), which must extend the grant. At most 8 KiB. The predecessor runs out on its own. No renewal from an expired or revoked grant.",
  responses: {
    "201": { description: "Successor created: mission, grant (with renewal lineage), the echoed token_sha256 and token_source \"participant\"; never a token" },
    "200": { description: "Exact retry (same grant_id, token_sha256 and body bytes, fresh proof) returns the stored successor while the presented grant is live" },
    "403": { description: "collaboration_mission_renewal_not_due before halfway (the only refusal a later attempt can change); final: collaboration_mission_renewal_unavailable (no window), collaboration_mission_renewal_closed (closed, or a chain member revoked), collaboration_mission_renewal_window_ended (the window, mission end or issuing key expiry cannot extend the grant); or collaboration_mission_acceptance_required" },
    "409": { description: "collaboration_mission_conflict (already renewed differently, grant_id taken, digest mismatch) or token_hash_conflict" },
  } }) },
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
