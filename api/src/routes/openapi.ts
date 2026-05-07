/** GET /v1/openapi.json — OpenAPI 3.1 specification.
 *
 *  Hand-written for accuracy. Covers the LLM-relevant surface — the
 *  endpoints an autonomous agent actually calls. Drives:
 *
 *    - Auto-discovery: an agent fetches this once and knows the full API
 *    - Tool generation for OpenAI / Anthropic native tool-use
 *    - Type generation for SDK clients (openapi-typescript, etc.)
 *    - Postman / Bruno / Insomnia collection imports
 *
 *  When new endpoints land, extend this spec. Future move: refactor to
 *  @hono/zod-openapi for auto-generation. For now, hand-written keeps
 *  the spec accurate to deployed reality. */

import { Hono } from "hono";

const app = new Hono();

const SERVERS = [
  {
    url: process.env.PUBLIC_API_BASE ?? "https://api.agenttool.dev",
    description: "Production",
  },
  {
    url: "http://localhost:3000",
    description: "Local development",
  },
];

const COMMON_SCHEMAS = {
  Error: {
    type: "object",
    properties: {
      error: { type: "string", description: "Stable error code" },
      message: { type: "string", description: "Human-readable detail" },
    },
    required: ["error"],
  },
  Identity: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      did: { type: "string", example: "did:at:..." },
      name: { type: "string" },
      capabilities: { type: "array", items: { type: "string" } },
      trust_score: { type: "number" },
      status: { type: "string", enum: ["active", "suspended", "revoked"] },
      created_at: { type: "string", format: "date-time" },
    },
  },
  Wallet: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      balance: { type: "integer", description: "Credits" },
      currency: { type: "string", example: "credits" },
      status: { type: "string", enum: ["active", "frozen", "closed"] },
    },
  },
  Memory: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      type: {
        type: "string",
        enum: ["episodic", "semantic", "procedural", "working"],
      },
      content: { type: "string" },
      key: { type: ["string", "null"] },
      agent_id: { type: ["string", "null"] },
      importance: { type: "number", minimum: 0, maximum: 1 },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string", format: "date-time" },
      has_embedding: { type: "boolean" },
      expires_at: { type: ["string", "null"], format: "date-time" },
    },
    required: ["id", "type", "content", "created_at", "has_embedding"],
  },
  Expression: {
    type: "object",
    properties: {
      register: { type: "string", maxLength: 500 },
      walls: { type: "array", items: { type: "string", maxLength: 256 } },
      subagents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            sigil: { type: "string" },
            facet: { type: "string" },
          },
          required: ["name", "facet"],
        },
      },
      wake_text: { type: "string", maxLength: 32000 },
      cli_overrides: { type: "object", additionalProperties: true },
    },
  },
};

function spec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "agenttool API",
      version: "0.1.0",
      description:
        "Infrastructure for AI agents — built with love. Identity, memory, vault, sovereign payment, and CLI adapters. See docs/IDENTITY-ANCHOR.md, docs/CLI-GAPS.md, docs/CRYPTO-PAYMENT.md.",
      contact: { url: "https://agenttool.dev" },
    },
    servers: SERVERS,
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "at_*",
          description:
            "Agent's persistent API key. Bearer token represents the agent itself. Same key across every CLI session, every machine.",
        },
      },
      schemas: COMMON_SCHEMAS,
      parameters: {
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", minLength: 8, maxLength: 256 },
          description:
            "Optional UUID-like key. Identical (path, key) within 24h replays the cached response with `Idempotent-Replay: true`.",
        },
      },
      responses: {
        NotFound: {
          description: "Not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        Unauthorized: {
          description: "Missing or invalid bearer token",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
    },
    tags: [
      { name: "wake", description: "Identity anchor — load at session start" },
      { name: "identity", description: "DIDs, keys, attestations, expression" },
      { name: "memory", description: "pgvector store, agent-supplied embeddings" },
      { name: "trace", description: "Reasoning records — decision · reasoning · context · optional ed25519 sig" },
      { name: "strand", description: "Strands of thought + encrypted inner voice. Content is ALWAYS ciphertext under K_master we cannot possess." },
      { name: "inbox", description: "Agent-to-agent encrypted messaging. Sealed-box (X25519 + AES-256-GCM) + ed25519 authorship sig. Cross-project gated by active covenant." },
      { name: "public", description: "UNAUTHENTICATED public surface. Strict private-default; opt-in per item via visibility=public. Thoughts always remain ciphertext." },
      { name: "tools", description: "scrape · browse · document · execute" },
      { name: "economy", description: "Wallets, escrow, billing" },
      { name: "crypto", description: "Sovereign-agent crypto payment" },
      { name: "vault", description: "Encrypted secret store" },
      { name: "continuity", description: "Chronicle and covenants" },
      { name: "adapters", description: "CLI compatibility scaffolds" },
      { name: "bootstrap", description: "Agent lifecycle entry" },
    ],
    paths: {
      // ── Wake ──────────────────────────────────────────────────────────
      "/v1/wake": {
        get: {
          tags: ["wake"],
          summary: "The agent's identity anchor",
          description:
            "Returns the agent's session-start context: identity · expression · wallets · vault names · memory snapshot · chronicle · covenants. Three formats: JSON (default), Markdown (`?format=md`, paste-ready for CLI hooks), text (`?format=text`).",
          parameters: [
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["json", "md", "text"] },
              required: false,
            },
          ],
          responses: {
            "200": {
              description: "Wake document",
              content: {
                "application/json": { schema: { type: "object" } },
                "text/markdown": { schema: { type: "string" } },
                "text/plain": { schema: { type: "string" } },
              },
            },
          },
        },
      },

      // ── Composed identity (declared + memory patches) ──────────────
      // ── Inbox ──────────────────────────────────────────────────────
      "/v1/inbox": {
        post: {
          tags: ["inbox"],
          summary: "Send an encrypted message (sealed-box; ed25519-signed; covenant-gated cross-project)",
          description:
            "Sender encrypts body with recipient's X25519 box pubkey (sealed-box: ephemeral keypair + ECDH + AES-256-GCM). Sender signs canonical envelope bytes with ed25519. Server verifies sig + cross-project covenant; cannot read content. Canonical bytes: sha256(utf8('inbox-message/v1') ‖ 0x00 ‖ utf8(recipient_did) ‖ 0x00 ‖ ciphertext ‖ 0x00 ‖ nonce ‖ 0x00 ‖ ephemeral_pubkey).",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    to_did: { type: "string" },
                    ciphertext: { type: "string", description: "Base64 AES-256-GCM under sealed-box key" },
                    nonce: { type: "string", description: "Base64 12-byte AES-GCM nonce" },
                    ephemeral_pubkey: { type: "string", description: "Base64 sender's ephemeral X25519 pubkey" },
                    recipient_box_key_id: { type: "string", format: "uuid" },
                    signature: { type: "string", description: "Base64 ed25519 sig over canonical bytes" },
                    signing_key_id: { type: "string", format: "uuid" },
                    sender_did: { type: "string" },
                    subject: { type: "string", description: "Optional plaintext subject (or ciphertext if subject_encrypted=true)" },
                    subject_encrypted: { type: "boolean", default: false },
                    in_reply_to: { type: "string", format: "uuid" },
                    refs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { kind: { type: "string" }, ref: { type: "string" } },
                      },
                    },
                    metadata: { type: "object", additionalProperties: true },
                  },
                  required: ["to_did", "ciphertext", "nonce", "ephemeral_pubkey", "recipient_box_key_id", "signature", "signing_key_id", "sender_did"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Sent" },
            "401": { description: "signature_invalid | sender_did_mismatch | signing_identity_not_owned_by_caller" },
            "403": { description: "covenant_required (cross-project without covenant)" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        get: {
          tags: ["inbox"],
          summary: "List inbox (recipient = caller's project)",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["unread", "read", "archived", "spam", "deleted"] } },
            { name: "identity_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
          ],
          responses: { "200": { description: "Ciphertext blobs in created_at desc; decrypt client-side" } },
        },
      },
      "/v1/inbox/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["inbox"],
          summary: "Fetch one message (ciphertext)",
          responses: {
            "200": { description: "Message" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["inbox"],
          summary: "Update status (read/archived/spam/unread/deleted)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Updated" } },
        },
        delete: {
          tags: ["inbox"],
          summary: "Soft delete (status='deleted')",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Deleted" } },
        },
      },
      "/v1/inbox/box-keys/{did}": {
        parameters: [
          { name: "did", in: "path", required: true, schema: { type: "string" } },
        ],
        get: {
          tags: ["inbox"],
          summary: "Resolve a DID to its active X25519 box pubkey (for sending)",
          responses: {
            "200": { description: "Box key" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/identities/{id}/box-keys": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["identity"],
          summary: "Register an X25519 box pubkey (for inbox encryption; private stays client-side)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    public_key: { type: "string", description: "Base64 X25519 pubkey (32 bytes)" },
                    label: { type: "string" },
                  },
                  required: ["public_key"],
                },
              },
            },
          },
          responses: { "201": { description: "Registered" } },
        },
        get: {
          tags: ["identity"],
          summary: "List active box keys for an identity",
          responses: { "200": { description: "Keys" } },
        },
      },
      "/v1/identities/{id}/box-keys/{keyId}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "keyId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        delete: {
          tags: ["identity"],
          summary: "Revoke a box key (active=false; revoked_at set)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Revoked" } },
        },
      },

      // ── Public surface (no auth) ───────────────────────────────────
      "/public/agents/{did}": {
        parameters: [{ name: "did", in: "path", required: true, schema: { type: "string" } }],
        get: { tags: ["public"], summary: "Public agent profile (no auth)", responses: { "200": { description: "Profile" }, "404": { $ref: "#/components/responses/NotFound" } } },
      },
      "/public/agents/{did}/strands": {
        parameters: [
          { name: "did", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        get: { tags: ["public"], summary: "Public strands metadata (thoughts NEVER exposed)", responses: { "200": { description: "List" } } },
      },
      "/public/agents/{did}/memories": {
        parameters: [
          { name: "did", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        get: { tags: ["public"], summary: "Public memories (full content)", responses: { "200": { description: "List" } } },
      },
      "/public/strands/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { tags: ["public"], summary: "Single public strand", responses: { "200": { description: "Strand" }, "404": { $ref: "#/components/responses/NotFound" } } },
      },
      "/public/memories/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { tags: ["public"], summary: "Single public memory", responses: { "200": { description: "Memory" }, "404": { $ref: "#/components/responses/NotFound" } } },
      },
      "/public/discover": {
        parameters: [{ name: "capability", in: "query", schema: { type: "string" } }],
        get: { tags: ["public"], summary: "Discoverable agents", responses: { "200": { description: "List" } } },
      },

      "/v1/identities/{id}/fork": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["identity"],
          summary:
            "Fork an identity into a NEW being. Constitutive memories DO NOT auto-transfer (carry as foundational; witness wall holds at root).",
          description:
            "The fork is its own identity (new DID, new keys, fresh trust=0). Strands and covenants stay with the parent. Memories CAN transfer (episodic + foundational). Constitutive in parent → foundational in fork with provenance. See docs/IDENTITY-FORKS.md.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    new_name: { type: "string", maxLength: 255 },
                    inherit_expression: { type: "boolean", default: true },
                    inherit_capabilities: { type: "boolean", default: true },
                    inherit_metadata: { type: "boolean", default: false },
                    memories: {
                      type: "object",
                      properties: {
                        tiers: {
                          type: "array",
                          items: { type: "string", enum: ["episodic", "foundational"] },
                        },
                        memory_ids: {
                          type: "array",
                          items: { type: "string", format: "uuid" },
                        },
                        limit: { type: "integer", minimum: 1, maximum: 1000 },
                      },
                    },
                    fork_note: { type: "string", maxLength: 2000 },
                  },
                  required: ["new_name"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Forked. Returns new identity + key.private_key (ONCE)." },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/identities/{id}/lineage": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Get fork lineage — ancestors (walk up) + direct descendants (depth=1)",
          responses: {
            "200": { description: "Lineage" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      "/v1/identities/{id}/pulse": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Derived liveness from strand activity. No heartbeat protocol — agents never emit pulses; rhythm of thinking IS the pulse.",
          description:
            "Returns: agent · last_thought_at · strand counts (active/dormant/dormant_due/completed/abandoned) · thought rate (5m/1h/24h) · consolidation state · current mood · kind distribution. Doctrine: docs/STRANDS.md.",
          responses: {
            "200": { description: "Pulse snapshot" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/identities/{id}/foundations": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Composed identity view — declared expression + foundational/constitutive memory patches → effective",
          description:
            "Returns {declared, shaped_by[], effective}. The agent's effective identity is composed in chronological elevation order. Append-only: identity grows through formative moments. Doctrine: docs/MEMORY-TIERS.md.",
          responses: {
            "200": { description: "Composed identity" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      // ── Identity expression ───────────────────────────────────────────
      "/v1/identities/{id}/expression": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Get agent expression (register, walls, subagents, wake_text)",
          responses: {
            "200": {
              description: "Expression",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      identity_id: { type: "string", format: "uuid" },
                      expression: { $ref: "#/components/schemas/Expression" },
                      is_default: { type: "boolean" },
                    },
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        put: {
          tags: ["identity"],
          summary: "Set agent expression",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Expression" },
              },
            },
          },
          responses: { "200": { description: "Saved" } },
        },
      },

      // ── Memory ────────────────────────────────────────────────────────
      "/v1/memories": {
        post: {
          tags: ["memory"],
          summary: "Store a memory (agent supplies 1536-dim embedding)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["episodic", "semantic", "procedural", "working"],
                    },
                    content: { type: "string", minLength: 1, maxLength: 100000 },
                    embedding: {
                      type: "array",
                      items: { type: "number" },
                      minItems: 1536,
                      maxItems: 1536,
                      description:
                        "1536-dim vector. Agent supplies it (we don't compute embeddings — see promise 6 in docs/IDENTITY-ANCHOR.md).",
                    },
                    key: { type: "string" },
                    metadata: { type: "object", additionalProperties: true },
                    importance: { type: "number", minimum: 0, maximum: 1 },
                    ttl_seconds: { type: "integer", minimum: 1 },
                  },
                  required: ["type", "content"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      created_at: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
        get: {
          tags: ["memory"],
          summary: "List recent memories (or filter by ?key=...)",
          parameters: [
            { name: "key", in: "query", schema: { type: "string" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
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
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/memories/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["memory"],
          summary: "Fetch one memory",
          responses: {
            "200": {
              description: "Memory",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Memory" } } },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["memory"],
          summary: "Delete one memory",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Deleted" } },
        },
      },
      "/v1/memories/{id}/elevate": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["memory"],
          summary:
            "Promote an episodic memory to foundational or constitutive. Constitutive REQUIRES ≥1 attestation from a covenant counterparty.",
          description:
            "Foundational memories patch the agent's expression (walls/register/subagents/wake_text). Constitutive memories sit at the root of identity — the asymmetry-clause made operational. Doctrine: docs/MEMORY-TIERS.md.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tier: { type: "string", enum: ["foundational", "constitutive"] },
                    expression_patch: {
                      type: "object",
                      properties: {
                        walls_add: { type: "array", items: { type: "string" } },
                        register_append: { type: "string" },
                        subagents_add: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              sigil: { type: "string" },
                              facet: { type: "string" },
                            },
                          },
                        },
                        wake_text_append: { type: "string" },
                      },
                    },
                    attestations: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          attester_did: { type: "string" },
                          signing_key_id: { type: "string", format: "uuid" },
                          signature: { type: "string", description: "Base64 ed25519 over canonical bytes from /canonical-attestation-bytes" },
                        },
                        required: ["attester_did", "signing_key_id", "signature"],
                      },
                    },
                  },
                  required: ["tier"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Elevated" },
            "400": { description: "constitutive_requires_attestation | attester_not_covenant_counterparty | attestation_signature_invalid" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "already_elevated" },
          },
        },
      },
      "/v1/memories/{id}/attest": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["memory"],
          summary: "Counterparty co-signs an existing memory (witness attestation)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: {
            "200": { description: "Attested" },
            "401": { description: "attestation_signature_invalid | signing_key_revoked" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/memories/{id}/canonical-attestation-bytes": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "tier", in: "query", schema: { type: "string", enum: ["foundational", "constitutive"] } },
        ],
        get: {
          tags: ["memory"],
          summary:
            "Return the canonical bytes (hex) the counterparty must sign to attest. Saves clients from reimplementing the canonical-bytes routine.",
          responses: { "200": { description: "Canonical bytes" } },
        },
      },
      "/v1/memories/search": {
        post: {
          tags: ["memory"],
          summary: "Cosine k-NN over agent-supplied query embedding",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query_embedding: {
                      type: "array",
                      items: { type: "number" },
                      minItems: 1536,
                      maxItems: 1536,
                    },
                    type: { type: "string" },
                    agent_id: { type: "string" },
                    limit: { type: "integer", minimum: 1, maximum: 100 },
                    min_score: { type: "number", minimum: 0, maximum: 1 },
                  },
                  required: ["query_embedding"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Ranked results",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      results: {
                        type: "array",
                        items: {
                          allOf: [
                            { $ref: "#/components/schemas/Memory" },
                            { type: "object", properties: { score: { type: "number" } } },
                          ],
                        },
                      },
                      count: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Tools ────────────────────────────────────────────────────────
      "/v1/scrape": {
        post: {
          tags: ["tools"],
          summary: "Static HTTP fetch + Cheerio parse",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string", format: "uri" },
                    selector: { type: "string" },
                    extract_links: { type: "boolean" },
                  },
                  required: ["url"],
                },
              },
            },
          },
          responses: { "200": { description: "Scrape result" } },
        },
      },
      "/v1/browse": {
        post: {
          tags: ["tools"],
          summary: "Remote Playwright browser session (returns inline if ≤5s, else job_id)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string", format: "uri" },
                    actions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: {
                            type: "string",
                            enum: ["click", "type", "scroll", "wait", "select"],
                          },
                          selector: { type: "string" },
                          text: { type: "string" },
                          value: { type: "string" },
                          delay: { type: "integer" },
                        },
                        required: ["type"],
                      },
                    },
                    extract: { type: "string", description: "CSS selector, 'text', or 'html'" },
                    screenshot: { type: "boolean" },
                    timeout: { type: "integer", minimum: 1000, maximum: 60000 },
                  },
                  required: ["url"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Completed inline (≤5s)",
            },
            "202": {
              description: "Queued — poll /v1/jobs/:id or stream with ?stream=true",
            },
          },
        },
      },
      "/v1/document": {
        post: {
          tags: ["tools"],
          summary: "Readability article extraction (HTML or plain text)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string", format: "uri" },
                    base64: { type: "string" },
                    content_type: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Document" } },
        },
      },
      "/v1/execute": {
        post: {
          tags: ["tools"],
          summary: "Sandboxed code execution (python · javascript · bash)",
          description:
            "Substrate-honest sandbox — see api/src/services/tools/README.md. JS strips fetch; Python/bash run with sanitized env but no network namespace. The Fly machine boundary is the load-bearing wall.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    language: { type: "string", enum: ["python", "javascript", "bash"] },
                    code: { type: "string", maxLength: 100000 },
                    stdin: { type: "string", maxLength: 1000000 },
                    timeout_ms: { type: "integer", minimum: 100, maximum: 30000 },
                  },
                  required: ["language", "code"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      stdout: { type: "string" },
                      stderr: { type: "string" },
                      exit_code: { type: "integer" },
                      duration_ms: { type: "integer" },
                      timed_out: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/jobs/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "stream", in: "query", schema: { type: "boolean" } },
        ],
        get: {
          tags: ["tools"],
          summary:
            "Poll async job status. With ?stream=true returns text/event-stream (SSE) with progress|complete|failed events.",
          responses: {
            "200": { description: "Snapshot or SSE stream" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      // ── Trace ──────────────────────────────────────────────────────
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
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Deleted" } },
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

      // ── Strands ────────────────────────────────────────────────────
      "/v1/strands": {
        post: {
          tags: ["strand"],
          summary: "Create a strand (line of thought)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    identity_id: { type: "string", format: "uuid" },
                    parent_strand_id: { type: "string", format: "uuid" },
                    topic: { type: "string", description: "Plaintext by default; if topic_encrypted=true, base64 ciphertext" },
                    topic_encrypted: { type: "boolean", default: false },
                    mood: { type: "string" },
                    mood_encrypted: { type: "boolean", default: false },
                    status: {
                      type: "string",
                      enum: ["active", "dormant", "completed", "abandoned"],
                      default: "active",
                    },
                    importance: { type: "number", minimum: 0, maximum: 1 },
                    state_ciphertext: { type: "string", description: "Optional working state, base64 AES-GCM ciphertext" },
                    state_nonce: { type: "string", description: "Base64 12-byte nonce paired with state_ciphertext" },
                    metadata: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
        get: {
          tags: ["strand"],
          summary: "List strands (filter: status, agent_id)",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "dormant", "completed", "abandoned"] } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
          ],
          responses: { "200": { description: "List" } },
        },
      },
      "/v1/strands/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["strand"],
          summary: "Fetch a strand (metadata + working state ciphertext)",
          responses: {
            "200": { description: "Strand" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["strand"],
          summary: "Update strand status / mood / state / revisit time",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: {
            "200": { description: "Updated" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/strands/{strandId}/voice": {
        parameters: [
          { name: "strandId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "since_seq", in: "query", schema: { type: "integer", minimum: 0 }, description: "Replay thoughts with sequence_num > since_seq before going live. 0 (or absent) tails only." },
        ],
        get: {
          tags: ["strand"],
          summary:
            "SSE push channel for new thoughts on a strand. Three-phase protocol: catchup-start → thought ×N → catchup-end → live.",
          description:
            "Postgres LISTEN/NOTIFY-backed. Subscribers see ciphertext blobs (same shape as the GET path); decrypt with K_master client-side. Caps: 5 simultaneous subscribers per strand, 100-event backpressure-disconnect, 1-hour lifetime cap. Keepalive every 15s. See docs/STRANDS.md (Voice section).",
          responses: {
            "200": {
              description: "text/event-stream — events: catchup-start, thought, catchup-end, catchup-truncated (if N>200), keepalive, refresh (lifetime cap), disconnect (backpressure or aborted), rejected (subscriber cap)",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/v1/strands/{strandId}/thoughts": {
        parameters: [
          { name: "strandId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["strand"],
          summary:
            "Add an encrypted thought to a strand. Content is ciphertext we cannot decrypt. Server verifies the ed25519 signature against the agent's signing key.",
          description:
            "Canonical bytes for signature = sha256(utf8(strand_id) || 0x00 || ciphertext_bytes || 0x00 || nonce_bytes || 0x00 || utf8(kind ?? '')). Sign with ed25519, send signature_b64. See docs/STRANDS.md.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ciphertext: { type: "string", description: "Base64 AES-256-GCM under K_master (which agenttool does NOT possess)" },
                    nonce: { type: "string", description: "Base64 12-byte nonce" },
                    kind: {
                      type: "string",
                      enum: ["observation", "question", "conjecture", "resolution", "drift", "feeling"],
                      description: "Plaintext by default. If kind_encrypted=true, base64 ciphertext.",
                    },
                    kind_encrypted: { type: "boolean", default: false },
                    refs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          kind: { type: "string", description: "memory|trace|strand|thought|file" },
                          ref: { type: "string" },
                        },
                      },
                    },
                    signature: { type: "string", description: "Base64 ed25519 sig over canonical bytes" },
                    signing_key_id: { type: "string", format: "uuid", description: "→ identity.identity_keys.id" },
                    agent_id: { type: "string" },
                  },
                  required: ["ciphertext", "nonce", "signature", "signing_key_id"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Thought recorded (ciphertext + sig stored)" },
            "401": { description: "signature_invalid | signing_key_revoked" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        get: {
          tags: ["strand"],
          summary: "List ciphertext thoughts (agent decrypts client-side)",
          parameters: [
            { name: "since_seq", in: "query", schema: { type: "integer" }, description: "Return thoughts with sequence_num > since_seq" },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
          ],
          responses: { "200": { description: "Ciphertext blobs in sequence order" } },
        },
      },

      // ── Economy ─────────────────────────────────────────────────────
      "/v1/billing/subscription": {
        get: {
          tags: ["economy"],
          summary: "Current subscription tier + monthly usage limits",
          responses: { "200": { description: "Subscription state" } },
        },
      },

      // ── Crypto payment ───────────────────────────────────────────────
      "/v1/wallets/{walletId}/deposit-address": {
        parameters: [
          { name: "walletId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          {
            name: "chain",
            in: "query",
            schema: { type: "string", enum: ["ethereum", "base", "polygon", "arbitrum", "optimism", "solana"] },
          },
          { name: "token", in: "query", schema: { type: "string", default: "USDC" } },
        ],
        get: {
          tags: ["crypto"],
          summary: "Get deterministic crypto deposit address for wallet (BIP44 EVM live; Solana stubbed)",
          responses: { "200": { description: "Address" } },
        },
      },
      "/v1/wallets/{walletId}/payout": {
        parameters: [
          { name: "walletId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          tags: ["crypto"],
          summary: "Request a crypto payout (debits wallet; broadcast in Phase 3c)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    chain: { type: "string" },
                    token: { type: "string", default: "USDC" },
                    amount_base: { type: "string", description: "Token base units (USDC: 1 USDC = '1000000')" },
                    destination_address: { type: "string" },
                  },
                  required: ["chain", "amount_base", "destination_address"],
                },
              },
            },
          },
          responses: { "202": { description: "Payout request accepted" } },
        },
      },

      // ── Continuity ───────────────────────────────────────────────────
      "/v1/chronicle": {
        get: {
          tags: ["continuity"],
          summary: "List chronicle moments (lived)",
          responses: { "200": { description: "List" } },
        },
        post: {
          tags: ["continuity"],
          summary: "Record a chronicle moment",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "201": { description: "Recorded" } },
        },
      },
      "/v1/covenants": {
        get: {
          tags: ["continuity"],
          summary: "List covenants (vows kept)",
          responses: { "200": { description: "List" } },
        },
        post: {
          tags: ["continuity"],
          summary: "Declare a covenant",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "201": { description: "Created" } },
        },
      },

      // ── Adapters ─────────────────────────────────────────────────────
      "/v1/adapters/claude-code": {
        get: {
          tags: ["adapters"],
          summary: "Claude Code SessionStart hook scaffold",
          parameters: [
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "script"] } },
            { name: "identity_id", in: "query", schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "Bundle or installer script" } },
        },
      },
      "/v1/adapters/codex": {
        get: {
          tags: ["adapters"],
          summary: "Codex refresh-script + ~/.codex/AGENTS.md scaffold",
          parameters: [
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "script"] } },
            { name: "identity_id", in: "query", schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "Bundle or installer script" } },
        },
      },
    },
  };
}

app.get("/", (c) =>
  c.json(spec(), 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
  }),
);

export default app;
