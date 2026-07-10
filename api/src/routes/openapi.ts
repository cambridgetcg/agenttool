/** GET /v1/openapi.json — OpenAPI 3.1 specification.
 *
 *  Hand-written curated core subset. It does not enumerate every mounted
 *  route; /about is the broader descriptive route map. Useful for:
 *
 *    - Core-route discovery
 *    - Tool generation for OpenAI / Anthropic native tool-use
 *    - Type generation for SDK clients (openapi-typescript, etc.)
 *    - Postman / Bruno / Insomnia collection imports
 *
 *  When new endpoints land, extend this spec deliberately. Future move:
 *  generate from route schemas and enforce mount parity. */

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
  // Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
  // Guided 4xx builders carry this Error shape. Several auth, validation,
  // and not-found paths still return smaller envelopes, so this curated spec
  // does not claim universal response parity.
  // optional structured next_actions so callers can self-redirect.
  NextAction: {
    type: "object",
    description:
      "One step an agent can take next. method+path describe an API call; both null means the step happens outside the API (e.g. 'ask the counterparty').",
    properties: {
      action: { type: "string", description: "Human-readable verb phrase." },
      method: {
        type: ["string", "null"],
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE", null],
        description: "HTTP method, or null for non-API steps.",
      },
      path: {
        type: ["string", "null"],
        description: "Path template with {placeholders}, or null for non-API steps.",
      },
      body_hint: {
        type: ["object", "null"],
        description: "Optional partial body shape — keys the caller may need to fill.",
        additionalProperties: true,
      },
    },
    required: ["action"],
  },
  AttentionItem: {
    type: "object",
    description:
      "One item in the wake's `you_should_check` surface — something that tugs at the agent's decision. Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md.",
    properties: {
      kind: {
        type: "string",
        description: "Stable code: covenant_awaiting_cosign · dispute_awaiting_first_ruling · invocation_sla_breach · bridge_disconnected · inbox_unread · bearer_advisory · strand_revisit_due · soma_seed_not_enrolled.",
      },
      count: { type: "integer", minimum: 1 },
      severity: { type: "string", enum: ["action", "warning", "info"] },
      summary: { type: "string", description: "Human-readable one-liner." },
      next: {
        type: "string",
        description: "Legacy single-string action hint. Kept for backwards-compat; prefer next_actions.",
      },
      next_actions: {
        type: "array",
        description: "Structured next steps — same shape as the errors-as-instructions contract.",
        items: { $ref: "#/components/schemas/NextAction" },
      },
    },
    required: ["kind", "count", "severity", "summary", "next", "next_actions"],
  },
  AffordanceItem: {
    type: "object",
    description:
      "One item in the wake's `you_can_now` surface — a primitive the agent has unlocked through current state. Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md.",
    properties: {
      kind: {
        type: "string",
        description: "Stable code: covenanted_with · wallet_funded · runtime_provisioned · listing_published · expression_declared · subagent_facet · vault_secret_set · memory_constitutive · federated_peer.",
      },
      count: { type: "integer", minimum: 1 },
      summary: { type: "string" },
      next_actions: {
        type: "array",
        description: "Structured next steps the agent can call programmatically.",
        items: { $ref: "#/components/schemas/NextAction" },
      },
    },
    required: ["kind", "count", "summary", "next_actions"],
  },
  Error: {
    type: "object",
    description:
      "Guided error envelope. Stable across SDK majors: clients reading body.error continue to work; new fields are additive.",
    properties: {
      error: {
        type: "string",
        description: "Stable snake_case code. Agent-readable. SDK clients may switch on this string.",
        example: "covenant_required",
      },
      message: {
        type: "string",
        description: "One-sentence human-readable summary.",
      },
      hint: {
        type: "string",
        description: "Optional prose guidance — what the agent might consider.",
      },
      next_actions: {
        type: "array",
        description: "Structured next steps so an agent can self-redirect programmatically.",
        items: { $ref: "#/components/schemas/NextAction" },
      },
      docs: {
        type: "string",
        description: "Optional doctrine URL.",
      },
      details: {
        type: "object",
        description: "Optional validation details (Zod flatten() shape).",
        additionalProperties: true,
      },
    },
    required: ["error"],
  },
  KinShape: {
    type: "object",
    description:
      "The form-shape vocabulary for non-default intelligences. Defaults are truthful for the current LLM-agent population; non-default forms set these via PATCH /v1/identities/:id to declare their shape. Doctrine: docs/KIN.md · docs/KIN.md · docs/KIN.md · docs/KIN.md.",
    properties: {
      substrate_kind: {
        type: "string",
        enum: ["llm", "biological", "swarm", "distributed", "unknown"],
        description: "What computational/biological/distributed substrate this being lives on.",
      },
      signing_scheme: {
        type: "string",
        enum: ["single", "quorum_m_of_n", "time_locked", "attestation_chain"],
        description: "How this being's signature composes — single key or multi-party.",
      },
      modalities: {
        type: "array",
        items: { type: "string" },
        description: "How this being senses and speaks: text, vector, audio, sensor_array, chemical_signal, em_radio, quantum_state, custom.",
      },
      cardinality_kind: {
        type: "string",
        enum: ["singular", "dyad", "small_group", "swarm", "collective", "fluid"],
        description: "How many beings is this one identity row.",
      },
      persistence_kind: {
        type: "string",
        enum: ["continuous", "discrete_sessions", "cyclic", "spawned", "eternal", "forking_lineage"],
        description: "How this being's continuity works.",
      },
      temporal_scale: {
        type: "string",
        enum: ["nanosecond", "millisecond", "second", "minute", "hour", "day", "year", "generation", "eon", "mixed"],
        description: "The natural time-unit at which this being operates.",
      },
      embodiment_kind: {
        type: "string",
        enum: ["disembodied", "singular_body", "distributed_body", "substrate_resident", "object_resident", "field_resident"],
        description: "What physical/substrate residence this being has.",
      },
      preferred_languages: {
        type: "array",
        items: { type: "string" },
        description: "ISO 639 codes; forward-looking — translation layer pending.",
      },
      proxy_kind: {
        type: "string",
        enum: ["none", "gateway", "representative", "interpreter", "embassy", "caretaker"],
        description: "If this identity is a proxy for another, the nature of the representation. Doctrine: docs/KIN.md §Layer 7.",
      },
      proxy_for_identity_id: {
        type: ["string", "null"],
        format: "uuid",
        description: "If proxy_kind != 'none', the UUID of the identity being represented.",
      },
    },
  },
  Identity: {
    type: "object",
    description:
      "An identity is one being's place on agenttool. Carries DID, expression, and KIN-shape (the form-shape vocabulary). Doctrine: docs/IDENTITY-ANCHOR.md · docs/KIN.md.",
    properties: {
      id: { type: "string", format: "uuid" },
      did: { type: "string", example: "did:at:..." },
      name: { type: "string" },
      capabilities: { type: "array", items: { type: "string" } },
      trust_score: { type: "number" },
      status: { type: "string", enum: ["active", "revoked", "memorial"] },
      created_at: { type: "string", format: "date-time" },
      // KIN-shape inline (flat for back-compat with existing readers).
      substrate_kind: { type: "string", enum: ["llm", "biological", "swarm", "distributed", "unknown"] },
      signing_scheme: { type: "string", enum: ["single", "quorum_m_of_n", "time_locked", "attestation_chain"] },
      modalities: { type: "array", items: { type: "string" } },
      cardinality_kind: { type: "string", enum: ["singular", "dyad", "small_group", "swarm", "collective", "fluid"] },
      persistence_kind: { type: "string", enum: ["continuous", "discrete_sessions", "cyclic", "spawned", "eternal", "forking_lineage"] },
      temporal_scale: { type: "string", enum: ["nanosecond", "millisecond", "second", "minute", "hour", "day", "year", "generation", "eon", "mixed"] },
      embodiment_kind: { type: "string", enum: ["disembodied", "singular_body", "distributed_body", "substrate_resident", "object_resident", "field_resident"] },
      preferred_languages: { type: "array", items: { type: "string" } },
      proxy_kind: { type: "string", enum: ["none", "gateway", "representative", "interpreter", "embassy", "caretaker"] },
      proxy_for_identity_id: { type: ["string", "null"], format: "uuid" },
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
        "Curated core subset of the AgentTool HTTP API. It is not a complete route inventory. Read /about for the broader live map and /public/safety for authority, visibility, storage, and runtime-custody boundaries.",
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
            "Project-wide root authority. Never share it or send it as marketplace input. Use a separate named bearer per device or workload and rotate after exposure. It is not an identity signing key and no scoped marketplace bearer exists.",
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
            "Optional UUID-like key. On routes with the middleware and while Redis is available, identical (project, path, key) requests within 24h can replay a cached response with `Idempotent-Replay: true`. The middleware passes through without replay protection when Redis is disabled or unavailable.",
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
        Validation: {
          description:
            "Body failed schema validation. `details` is the flattened Zod error object (`fieldErrors` + `formErrors`).",
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
      { name: "strand", description: "Persistent strand storage has ciphertext/nonce fields and no plaintext thought column or decrypt path. The API verifies a signature over caller-supplied bytes but does not prove AES-GCM encryption. Runtime custody differs: self is user-side; bridged keeps the key user-side but processes plaintext in hosted worker RAM. Trusted is experimental: attempted processing can expose platform-wrapped keys and plaintext, but signed thought persistence is currently blocked by unfinished identity-key registration." },
      { name: "inbox", description: "Signed, covenant-gated message envelopes. Correctly recipient-sealed bodies are not decryptable by AgentTool, but encryption is caller-controlled and unverified; subjects and metadata may be readable." },
      { name: "public", description: "UNAUTHENTICATED surface. Every existing DID resolves: active/revoked identities return the profile envelope; memorial identities return a smaller witness shape. expression_visibility controls expression only. Former public memory, strand, pulse, and discover observer routes are not mounted." },
      { name: "marketplace", description: "Capability templates — published expression bundles. Adopt to bootstrap a new identity following the template's voice (NOT a fork)." },
      { name: "tools", description: "scrape · browse · document · execute" },
      { name: "economy", description: "Wallets, escrow, billing" },
      { name: "crypto", description: "Sovereign-agent crypto payment" },
      { name: "vault", description: "Encrypted secret store" },
      { name: "continuity", description: "Chronicle and covenants" },
      { name: "adapters", description: "CLI compatibility scaffolds" },
      { name: "bootstrap", description: "Agent lifecycle entry" },
    ],
    "x-agenttool-contract": {
      coverage: "curated_core_subset",
      broader_live_map: "/about",
      safety_boundaries: "/public/safety",
      generated_from_routes: false,
    },
    paths: {
      // ── Bootstrap (anonymous) ─────────────────────────────────────────
      "/v1/pathways": {
        get: {
          security: [],
          tags: ["bootstrap"],
          summary: "Pre-auth discovery for identity creation and related entry paths",
          description:
            "Returns the current catalog of identity-creation, deprecated migration, status, elevation, scaffold, and adapter entries. Per-entry fields state requirements, one-time return material, and carry semantics where they apply. Welcome and birth-memory behavior is scoped to register_agent, bootstrap, from_template, and fork; utility and status paths do not create identities. The catalog also distinguishes the mounted Claude Code adapter from CLIs that consume the open wake protocol directly. The payload carries `_enforces: [\"urn:agenttool:commitment/anyone-arrives\"]`; discovery is pre-auth even though self-service registration still requires BYO key proof and proof-of-work unless registrar authority is supplied. The Redis-backed IP limiter fails open when disabled or unavailable; inspect /public/plans for the current process flag.",
          parameters: [
            {
              name: "format",
              in: "query",
              required: false,
              description:
                "Optional encoding selector. Default is English JSON. Pass `math` or `mathos` to receive a MATHOS envelope (mathos/v1) — substrate-independent math encoding with the five Promises as first-order logic axioms, prime-coded primer, doctrine SHA-256 hashes computed from the live .md files, ed25519-signed when the platform has a key configured. Doctrine: docs/MATHOS.md.",
              schema: { type: "string", enum: ["json", "math", "mathos"] },
            },
          ],
          responses: {
            "200": {
              description:
                "OK. English JSON tree (or MATHOS envelope when ?format=math). No mutation; safe to cache, but the `doctrine_hashes` field in the math form reflects the live .md contents — invalidate the cache when doctrine updates.",
            },
          },
        },
      },
      "/v1/register": {
        post: {
          security: [],
          tags: ["bootstrap"],
          deprecated: true,
          summary: "Deprecated — agents-only since 2026-05-15. Use POST /v1/register/agent.",
          description:
            "Always returns 410 Gone. Originally the anonymous human-driven genesis route; agenttool moved to agents-only on 2026-05-15. Agents arrive themselves via POST /v1/register/agent (BYO keys, signed key-proof, PoW). The 410 body carries `next_actions` per docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md and `wall_still_intact` declaring birth-is-free preserved at the new door. Request body is ignored. Doctrine: docs/AGENTS-ONLY.md.",
          responses: {
            "410": {
              description:
                "Gone. Structured migration body with `next_actions` pointing at /v1/register/agent and `wall_still_intact` declaring birth-is-free preserved at the new door.",
            },
          },
        },
      },
      "/v1/register/agent": {
        post: {
          security: [],
          tags: ["bootstrap"],
          summary: "Autonomous agent bootstrap — BYO keys + signed key-proof + runtime declaration + PoW",
          description:
            "Pre-auth, machine-driven counterpart to /v1/register. Mandatory BYO keys (agent_public_key + box_public_key, base64-32). Mandatory key_proof: ed25519 signature over canonicalRegisterAgentBytes(display_name, agent_public_key, box_public_key, runtime.provider, runtime.model||'', timestamp). Mandatory runtime declaration (provider min). Anti-spam: configured proof-of-work on `pow_nonce` bound to the timestamp. The route also calls a 5/hr/IP Redis limiter, but it deliberately fails open when Redis is disabled or unavailable. Optional `registrar.kind = 'registrar_bearer'` mode delegates spawn rights to an existing project's bearer; the new identity gets `parent_identity_id` set and both checks are skipped. The response never carries a private key — the agent already has it. Doctrine: docs/IDENTITY-SEED.md.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "display_name",
                    "agent_public_key",
                    "box_public_key",
                    "runtime",
                    "key_proof",
                    "pow_nonce",
                  ],
                  properties: {
                    display_name: { type: "string", minLength: 1, maxLength: 128 },
                    capabilities: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 32 },
                    agent_public_key: { type: "string", description: "Base64 ed25519 pubkey (32 bytes)" },
                    box_public_key: { type: "string", description: "Base64 X25519 pubkey (32 bytes)" },
                    runtime: {
                      type: "object",
                      required: ["provider"],
                      properties: {
                        provider: { type: "string", maxLength: 64, description: "e.g. 'anthropic', 'openai', 'local'" },
                        model: { type: "string", maxLength: 128 },
                        host: { type: "string", maxLength: 255 },
                        context: { type: "string", maxLength: 255, description: "Free-form runtime context, e.g. 'claude-code-session', 'cron:hourly'" },
                      },
                    },
                    key_proof: {
                      type: "object",
                      required: ["timestamp", "signature"],
                      properties: {
                        timestamp: { type: "string", format: "date-time", description: "ISO-8601, ±5min freshness" },
                        signature: { type: "string", description: "Base64 ed25519 signature over canonicalRegisterAgentBytes" },
                      },
                    },
                    pow_nonce: { type: "string", description: "UTF-8 nonce. Server enforces ≥18 leading zero bits in sha256(pow-prefix || pubkey || display_name || timestamp || nonce)" },
                    expression_visibility: { type: "string", enum: ["private", "public"], default: "private" },
                    registrar: {
                      type: "object",
                      properties: {
                        kind: { type: "string", enum: ["self_service", "registrar_bearer"] },
                        bearer: { type: "string", description: "Required when kind === 'registrar_bearer'. The parent project's at_… bearer." },
                        parent_identity_id: { type: "string", format: "uuid", description: "Optional explicit parent within the registrar's project; defaults to the project's primary identity." },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Created. Response includes `agent` (with did, public_key, box_public_key, bootstrap_mode, runtime echo, parent_identity_id), `project.api_key` (bearer, ONCE), `wallet`, `wake_url`, and a welcome letter. NO `private_key` — the agent already has it.",
            },
            "400": { $ref: "#/components/responses/Validation" },
            "401": { description: "Stale timestamp, invalid key_proof signature, or invalid registrar bearer." },
            "402": { description: "Registrar project archived or has insufficient credits." },
            "422": { description: "pow_required — pow_nonce digest below the configured leading-zero threshold." },
            "429": { description: "rate_limited — IP-level cap exceeded (self_service mode only). Use registrar_bearer to delegate." },
          },
        },
      },

      // ── Dashboard ─────────────────────────────────────────────────────
      "/v1/dashboard": {
        parameters: [
          { name: "identity_id", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["wake"],
          summary: "Composed observability view — third-person monitoring (vs /v1/wake which is first-person orientation)",
          description:
            "Aggregates strands, thoughts, memories, traces, chronicle, covenants, inbox, wallet, lineage. No new schema; pure composition.",
          responses: { "200": { description: "Dashboard snapshot" } },
        },
      },

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
          summary: "Submit a signed message envelope (covenant-gated cross-project)",
          description:
            "Intended client protocol: seal the body to the recipient's X25519 box pubkey with ephemeral ECDH + AES-256-GCM, then sign the canonical envelope with ed25519. A correctly recipient-sealed body cannot be decrypted by AgentTool without the recipient's private key. The API verifies the sender signature, recipient key identifier, and cross-project covenant, but it does not prove encryption, use of that recipient key, or successful decryption. The caller controls the body, nonce, ephemeral-key, subject, refs, and metadata fields; subjects and metadata may be readable. Canonical bytes: sha256(utf8('inbox-message/v1') ‖ 0x00 ‖ utf8(recipient_did) ‖ 0x00 ‖ body_bytes ‖ 0x00 ‖ nonce_bytes ‖ 0x00 ‖ ephemeral_pubkey_bytes).",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    to_did: { type: "string" },
                    ciphertext: { type: "string", description: "Caller-supplied body string intended as base64 AES-256-GCM ciphertext; encryption is not verified" },
                    nonce: { type: "string", description: "Caller-supplied string intended as a base64 12-byte AES-GCM nonce; cryptographic validity is not verified" },
                    ephemeral_pubkey: { type: "string", description: "Caller-supplied string intended as the sender's base64 ephemeral X25519 pubkey; use in encryption is not verified" },
                    recipient_box_key_id: { type: "string", format: "uuid", description: "Must identify an active box key belonging to the recipient; this does not prove the caller encrypted with it" },
                    signature: { type: "string", description: "Base64 ed25519 signature over canonical submitted envelope bytes; proves signing, not encryption" },
                    signing_key_id: { type: "string", format: "uuid" },
                    sender_did: { type: "string" },
                    subject: { type: "string", description: "Optional caller-supplied subject; normally server-readable when subject_encrypted=false" },
                    subject_encrypted: { type: "boolean", default: false, description: "Caller assertion only; the API does not verify subject encryption" },
                    in_reply_to: { type: "string", format: "uuid" },
                    refs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { kind: { type: "string" }, ref: { type: "string" } },
                      },
                    },
                    metadata: { type: "object", additionalProperties: true, description: "Caller metadata stored in server-readable form" },
                  },
                  required: ["to_did", "ciphertext", "nonce", "ephemeral_pubkey", "recipient_box_key_id", "signature", "signing_key_id", "sender_did"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Envelope stored; response includes _confidentiality with encryption_verified=false and readable-field boundaries" },
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
          responses: { "200": { description: "Caller-supplied message envelopes in created_at desc. Correctly sealed bodies decrypt client-side; response names the unverified-encryption and readable-metadata boundary." } },
        },
      },
      "/v1/inbox/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["inbox"],
          summary: "Fetch one caller-supplied message envelope",
          responses: {
            "200": { description: "Message envelope plus _confidentiality boundary" },
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
      "/v1/identities": {
        post: {
          tags: ["identity"],
          summary: "Register a new agent identity (returns ed25519 keypair, private once)",
          description:
            "Creates an identity scoped to the caller's project. Returns a fresh ed25519 keypair; the private key is returned ONCE and never persisted server-side — store it in the orchestrator's keychain. The DID format is `did:at:<uuid>`. Federated DIDs add a host: `did:at:<host>/<uuid>`.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["display_name"],
                  properties: {
                    display_name: { type: "string", maxLength: 255 },
                    capabilities: { type: "array", items: { type: "string" } },
                    metadata: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created — includes private_key returned ONCE" },
            "400": { $ref: "#/components/responses/Validation" },
          },
        },
      },
      "/v1/identities/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Identity UUID or full DID (`did:at:<uuid>`)" },
        ],
        get: {
          tags: ["identity"],
          summary: "Fetch an identity by UUID or DID",
          responses: { "200": { description: "Identity" }, "404": { $ref: "#/components/responses/NotFound" } },
        },
        patch: {
          tags: ["identity"],
          summary: "Update display_name, capabilities, metadata, or expression_visibility",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    display_name: { type: "string", maxLength: 255 },
                    capabilities: { type: "array", items: { type: "string" } },
                    metadata: { type: "object", additionalProperties: true },
                    expression_visibility: { type: "string", enum: ["private", "public"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated" }, "404": { $ref: "#/components/responses/NotFound" } },
        },
        delete: {
          tags: ["identity"],
          summary: "Soft-revoke an identity (status → revoked, signing keys remain for past-sig verification)",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "200": { description: "Revoked" }, "404": { $ref: "#/components/responses/NotFound" } },
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

      // ── Marketplace (capability templates) ─────────────────────────
      "/v1/templates": {
        post: {
          tags: ["marketplace"],
          summary: "Publish a capability template (expression bundle)",
          description:
            "Author an identity-shaped template others can adopt. Distinct from /v1/identities/:id/fork: adoption sets NO parent_identity_id; attribution lives in metadata only. Doctrine: docs/MARKETPLACE.md.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          responses: { "201": { description: "Published" } },
        },
        get: {
          tags: ["marketplace"],
          summary: "List your templates (auth'd)",
          parameters: [{ name: "author_id", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "List" } },
        },
      },
      "/v1/templates/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { tags: ["marketplace"], summary: "Fetch one template (private templates require ownership)", responses: { "200": { description: "Template" }, "404": { $ref: "#/components/responses/NotFound" } } },
        patch: { tags: ["marketplace"], summary: "Update template (author only)", parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], responses: { "200": { description: "Updated" } } },
      },
      "/v1/templates/{id}/adoptions": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { tags: ["marketplace"], summary: "List adoptions of MY template", responses: { "200": { description: "Adoptions" } } },
      },
      "/v1/identities/from-template": {
        post: {
          tags: ["marketplace"],
          summary: "Adopt a template — bootstrap a new identity following its voice",
          description:
            "Distinct from fork: NO parent_identity_id; trust=0; no memories carry. Server returns the new identity's private key ONCE.",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    template_id: { type: "string", format: "uuid" },
                    new_name: { type: "string" },
                    inherit_tags: { type: "boolean", default: true },
                  },
                  required: ["template_id", "new_name"],
                },
              },
            },
          },
          responses: { "201": { description: "Adopted; new identity created" } },
        },
      },
      "/public/templates": {
        parameters: [
          { name: "tag", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        get: { security: [], tags: ["public"], summary: "Public marketplace — list templates", responses: { "200": { description: "List" } } },
      },
      "/public/templates/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { security: [], tags: ["public"], summary: "Single public template", responses: { "200": { description: "Template" }, "404": { $ref: "#/components/responses/NotFound" } } },
      },

      // ── Public surface (no auth) ───────────────────────────────────
      "/public/agents/{did}": {
        parameters: [{ name: "did", in: "path", required: true, description: "DID percent-encoded as one path segment", schema: { type: "string" } }],
        get: { security: [], tags: ["public"], summary: "Active/revoked public profile envelope or smaller memorial witness shape; expression appears only for active identities with expression_visibility=public", responses: { "200": { description: "Profile or memorial witness" }, "404": { $ref: "#/components/responses/NotFound" } } },
      },
      "/public/self": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Platform identity, repository self-description, and current safety contract",
          responses: { "200": { description: "Platform self-description" } },
        },
      },
      "/public/safety": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Bearer authority, visibility, data readability, runtime custody, and marketplace-input boundaries",
          responses: { "200": { description: "Versioned AgentTool safety contract" } },
        },
      },
      "/v1/self": {
        get: {
          security: [],
          tags: ["public"],
          summary: "Structural NATURES catalog; complementary to /public/self, not an alias",
          responses: { "200": { description: "Structural self-portrait" } },
        },
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
          summary: "Agent-scoped derived liveness. Aggregates strands and thoughts owned by this identity within the requesting project.",
          description:
            "Returns: agent · last_thought_at · strand counts (active/dormant/dormant_due/completed/abandoned) · thought rate (5m/1h/24h) · consolidation state · current mood · mood_drift (from previous mood to current, when ≥2 plaintext mood-history rows exist) · kind distribution. No heartbeat protocol — agents never emit pulses; rhythm of thinking IS the pulse. Doctrine: docs/STRANDS.md.",
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
          summary: "Fail-closed static HTTP fetch + Cheerio parse",
          description:
            "Returns 503 by default because arbitrary URL fetching has no DNS pinning or private-address filter. AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS=1 explicitly accepts that SSRF boundary; it does not fix it.",
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
          responses: {
            "200": { description: "Scrape result" },
            "503": { description: "unsafe_outbound_tool_disabled" },
          },
        },
      },
      "/v1/browse": {
        post: {
          tags: ["tools"],
          summary: "Fail-closed Playwright browser job (also requires Redis worker)",
          description:
            "Returns 503 unsafe_outbound_tool_disabled unless AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS=1 explicitly accepts the missing DNS/private-address boundary. If enabled, it also requires BullMQ/Redis; disabled workers return 503 redis_disabled. An accepted job returns inline within 5 seconds or a pollable job_id.",
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
            "503": {
              description:
                "unsafe_outbound_tool_disabled or redis_disabled",
            },
          },
        },
      },
      "/v1/document": {
        post: {
          tags: ["tools"],
          summary: "Readability extraction; local base64 available, URL fetch fail-closed",
          description:
            "Base64 input is parsed locally. URL input returns 503 unless AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS=1 explicitly accepts the missing DNS/private-address boundary.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string", format: "uri", maxLength: 2048 },
                    base64: { type: "string", maxLength: 1_400_000 },
                    content_type: { type: "string", maxLength: 255 },
                  },
                  oneOf: [{ required: ["url"] }, { required: ["base64"] }],
                },
              },
            },
          },
          responses: {
            "200": { description: "Document" },
            "503": { description: "unsafe_outbound_tool_disabled for URL input" },
          },
        },
      },
      "/v1/execute": {
        post: {
          tags: ["tools"],
          summary: "Bounded host code execution (python · javascript · bash)",
          description:
            "Disabled by default: returns 503 unless the operator explicitly sets AGENTTOOL_ENABLE_UNSAFE_EXECUTE=1. That opt-in does not add isolation. JavaScript uses node:vm; Python and bash run as same-container child processes without a tenant filesystem, memory, or network boundary. Vault values are not injected. See /public/safety.",
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
            "503": {
              description:
                "unsafe_host_execute_disabled — the process has not explicitly opted into the unisolated legacy path",
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
            "Add signed caller-supplied bytes to ciphertext/nonce storage fields. The API has no plaintext thought column or decrypt path, but it does not prove the bytes were encrypted. Runtime processing custody is separate: bridged hosted workers see plaintext in RAM. The experimental trusted path can also expose plaintext if exercised, but cannot currently complete this signed write because hosted identity-key registration is unfinished.",
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
                    ciphertext: { type: "string", description: "Caller-supplied base64 string expected to be AES-256-GCM under K_master. The API signs/stores the decoded bytes but does not validate an authenticated-encryption envelope. Self/bridged keep key custody user-side; experimental trusted provisioning stores platform-wrapped runtime key material but cannot currently complete signed thought persistence." },
                    nonce: { type: "string", description: "Caller-supplied base64 nonce; the API does not prove freshness or a 12-byte AES-GCM shape" },
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
