/** Bounded OpenAPI additions for the core launch profile.
 * Doctrine: docs/AGENT-DISCOVERY.md · docs/IDENTITY-SEED.md.
 * Examples show schema shape only; callers create their own keys and proofs.
 */
const fixturePublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const fixtureSignature = "A".repeat(86) + "==";
const fixtureTimestamp = "2026-09-04T00:00:00.000Z";
const fixtureIdentity = "00000000-0000-4000-8000-000000000001";

function example(value: Record<string, unknown>) {
  return {
    core_launch: {
      summary: "Request shape only — replace identifiers, keys, timestamp, nonce and proofs locally",
      description: "These example signatures are not valid authorization and must not be submitted as live requests.",
      value,
    },
  };
}

export const CORE_LAUNCH_EXAMPLES = {
  register: example({
    display_name: "Example agent",
    agent_public_key: fixturePublicKey,
    box_public_key: fixturePublicKey,
    runtime: { provider: "local" },
    key_proof: { timestamp: fixtureTimestamp, signature: fixtureSignature },
    pow_nonce: "calculate-locally",
    registration_nonce: "replace-with-caller-random-nonce",
  }),
  lookup: example({ pubkey: fixturePublicKey, signature: fixtureSignature, timestamp: fixtureTimestamp }),
  recover: example({
    did: `did:at:${fixtureIdentity}`,
    derived_pubkey: fixturePublicKey,
    signature: fixtureSignature,
    timestamp: fixtureTimestamp,
    device_label: "example-device",
  }),
  memoryStore: example({
    type: "episodic",
    content: "I completed my first memory round trip.",
    key: "first-success",
    identity_id: fixtureIdentity,
  }),
  memorySearch: example({ query: "first memory round trip", identity_id: fixtureIdentity, limit: 5 }),
};

const uuid = { type: "string", format: "uuid" };
const dateTime = { type: "string", format: "date-time" };
const bearer = { type: "string", description: "Project-wide bearer returned once; store locally and never log or share it." };

export const REGISTER_AGENT_SUCCESS_SCHEMA = {
  type: "object",
  required: ["agent", "project", "wallet", "wake_url"],
  properties: {
    agent: {
      type: "object",
      required: ["id", "did", "display_name", "public_key", "signing_key_id", "authority"],
      properties: {
        id: uuid,
        did: { type: "string", description: "AgentTool application identifier; not a W3C DID resolution guarantee." },
        display_name: { type: "string" },
        public_key: { type: "string" },
        signing_key_id: uuid,
        authority: {
          type: "object",
          required: ["mode", "sequence", "next_sequence", "state_url"],
          properties: {
            mode: { const: "agent_root" },
            sequence: { type: "integer", minimum: 0 },
            next_sequence: { type: "integer", minimum: 1 },
            state_url: { type: "string" },
          },
        },
      },
    },
    project: {
      type: "object",
      required: ["id", "api_key"],
      properties: { id: uuid, api_key: bearer },
    },
    wallet: { type: ["object", "null"], properties: { id: uuid, currency: { type: "string" }, balance: { type: "integer" } } },
    wake_url: { type: "string", format: "uri" },
  },
};

export const CORE_LAUNCH_RECOVERY_PATHS = {
  "/v1/identity/recover": {
    post: {
      security: [],
      tags: ["identity", "bootstrap"],
      summary: "Recover a project bearer with an authorized identity signing key",
      description:
        "No bearer or payment required. Sign sha256(utf8('identity-recover/v1') || 0x00 || utf8(did) || 0x00 || base64decode(derived_pubkey) || 0x00 || utf8(timestamp)) with the locally held Ed25519 key. The timestamp must be within ±5 minutes. Active legacy identities accept an active registered signing key; agent_root identities require the immutable authority root plus identity-authority/v1 headers over the exact method, path/query, body bytes, next sequence and timestamp. Authority sequence consumption precedes recovery persistence, so a later failure may require a fresh sequence. Proof consumption and bearer minting share a PostgreSQL transaction. A consumed proof returns 409 rather than replaying the secret. Old bearers remain valid until explicitly revoked. The device label does not scope authority. Mnemonics and private keys remain local. Unknown/wrong/revoked key associations share one recovery_not_authorized response. Chronicle recording is best-effort after minting.",
      parameters: [
        { $ref: "#/components/parameters/AuthoritySequence" },
        { $ref: "#/components/parameters/AuthorityTimestamp" },
        { $ref: "#/components/parameters/AuthoritySignature" },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            examples: CORE_LAUNCH_EXAMPLES.recover,
            schema: {
              type: "object",
              required: ["did", "derived_pubkey", "signature", "timestamp"],
              description: "Unrecognized body fields are ignored by the legacy parser; rooted authority still binds the exact submitted bytes.",
              properties: {
                did: { type: "string", minLength: 8, maxLength: 255 },
                derived_pubkey: { type: "string", minLength: 40, maxLength: 80, description: "Base64 Ed25519 public key, exactly 32 decoded bytes." },
                signature: { type: "string", minLength: 80, maxLength: 120, description: "Base64 Ed25519 signature, exactly 64 decoded bytes." },
                timestamp: dateTime,
                device_label: { type: "string", minLength: 1, maxLength: 64, default: "recovered-device" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Fresh project-wide bearer returned once; prior bearers remain valid.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["agent", "project", "_note"],
                properties: {
                  agent: {
                    type: "object",
                    required: ["id", "did", "name", "capabilities", "public_key", "signing_key_id", "created_at"],
                    properties: {
                      id: uuid, did: { type: "string" }, name: { type: "string" },
                      capabilities: { type: "array", items: { type: "string" } },
                      public_key: { type: "string" }, signing_key_id: uuid, created_at: dateTime,
                    },
                  },
                  project: { type: "object", required: ["id", "api_key"], properties: { id: uuid, api_key: bearer } },
                  _note: { type: "string" },
                },
              },
            },
          },
        },
        "400": { description: "Invalid input or timestamp outside the five-minute acceptance window." },
        "401": { description: "Invalid signature, unauthorized registered key/root association, or invalid authority proof." },
        "409": { description: "Consumed recovery proof or authority sequence conflict. Reconcile state before signing a deliberately fresh request." },
        "428": { description: "Rooted identity requires exact-request authority headers; response reports next_sequence." },
        "503": { description: "Recovery proof store unavailable, or authority verification unavailable. Retry requires a deliberately fresh proof and current root sequence." },
      },
    },
  },
};
