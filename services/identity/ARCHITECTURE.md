# agent-identity — Architecture

**Purpose:** Give agents a persistent, verifiable identity with capabilities, trust chains, and discoverability.

**The insight:** Agents aren't anonymous API consumers. They're entities — with names, creators, capabilities, and reputations. agent-identity makes that real.

---

## Core Concepts

### Identity
An agent identity is a persistent record with:
- **DID** (Decentralized Identifier) — `did:at:<uuid>` — globally unique, portable
- **Display name** — human-readable label
- **Creator** — who registered this identity (project_id)
- **Capabilities** — declared abilities ("can search", "can trade", "can verify claims")
- **Public key** — ed25519, for signing attestations and verifying tokens
- **Metadata** — freeform JSON (avatar, description, links, etc.)
- **Status** — active | suspended | revoked

### Attestation
A signed statement by one identity about another:
- **Subject** — the identity being attested about
- **Attester** — the identity making the claim
- **Claim** — what's being attested ("has_capability:web_search", "trusted_by:beta", "created_by:yu")
- **Evidence** — optional supporting data (URL, hash, trace_id)
- **Signature** — ed25519 signature over the canonical attestation payload
- **Expires** — optional TTL

### Trust Score
Computed from attestations received:
- Number of unique attesters
- Recency-weighted attestation count
- Attester trust scores (recursive, capped at depth 3)
- Self-attestations have zero weight

### Discovery
Find agents by capability, trust level, creator, or freeform search.

---

## API Surface

### Identities
```
POST   /v1/identities              — Register a new agent identity
GET    /v1/identities/:id          — Get identity by DID or UUID
PATCH  /v1/identities/:id          — Update display_name, metadata, capabilities
DELETE /v1/identities/:id          — Revoke an identity (soft delete)
GET    /v1/identities/:id/keys     — List public keys for an identity
POST   /v1/identities/:id/keys     — Rotate: add a new key pair
DELETE /v1/identities/:id/keys/:kid — Revoke a specific key
```

### Attestations
```
POST   /v1/attestations            — Create a signed attestation
GET    /v1/attestations/:id        — Get attestation by ID
GET    /v1/identities/:id/attestations        — List attestations about an identity
GET    /v1/identities/:id/attestations/given   — List attestations made by an identity
DELETE /v1/attestations/:id        — Revoke an attestation
```

### Discovery
```
GET    /v1/discover                — Search/filter identities
  ?capability=web_search          — filter by declared capability
  ?min_trust=0.5                  — minimum trust score
  ?creator=<project_id>           — filter by creating project
  ?q=<freeform>                   — semantic search on name/metadata
  ?limit=20&offset=0              — pagination
```

### Auth Tokens (agent-to-agent)
```
POST   /v1/identities/:id/tokens   — Issue a short-lived JWT for agent-to-agent auth
POST   /v1/tokens/verify            — Verify a JWT issued by another agent
```

---

## Data Model (Supabase, schema: identity)

### identities
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Internal ID |
| did | text UNIQUE | `did:at:<uuid>` |
| project_id | uuid FK → tools.projects | Owner project |
| display_name | text | Human-readable |
| capabilities | text[] | Declared capabilities |
| metadata | jsonb | Freeform (avatar, desc, links) |
| public_key | text | Base64-encoded ed25519 public key |
| status | text | active / suspended / revoked |
| trust_score | real | Computed, 0.0–1.0 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### identity_keys
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Key ID (kid) |
| identity_id | uuid FK → identities | |
| public_key | text | Base64-encoded ed25519 |
| label | text | "primary", "rotation-2026-03" |
| active | boolean | |
| created_at | timestamptz | |
| revoked_at | timestamptz | NULL if active |

### attestations
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| subject_id | uuid FK → identities | Who it's about |
| attester_id | uuid FK → identities | Who made it |
| claim | text | e.g. "has_capability:web_search" |
| evidence | jsonb | Optional supporting data |
| signature | text | Base64 ed25519 sig |
| expires_at | timestamptz | NULL = permanent |
| revoked_at | timestamptz | NULL if active |
| created_at | timestamptz | |

### Indexes
- `idx_identities_did` on did
- `idx_identities_project` on project_id
- `idx_identities_capabilities` GIN on capabilities
- `idx_attestations_subject` on subject_id
- `idx_attestations_attester` on attester_id
- `idx_attestations_claim` on claim

---

## Stack

- **Runtime:** Bun + Hono (same as agent-tools, agent-verify, agent-economy)
- **DB:** Supabase (schema: identity), Drizzle ORM
- **Crypto:** ed25519 via `@noble/ed25519` (pure JS, no native deps)
- **JWT:** `jose` library for agent-to-agent tokens
- **Auth:** Shared `tools.api_keys` pattern (same as all services)
- **Deploy:** Fly.io (`agent-identity.fly.dev`), Caddy route on Forge

---

## Trust Score Algorithm

```
trust(agent) = Σ (attestation_weight × attester_trust × recency_decay) / normalizer

where:
  attestation_weight = 1.0 (standard) | 0.5 (self-referential capability claim)
  attester_trust = trust score of the attesting agent (recursive, depth ≤ 3)
  recency_decay = exp(-age_days / 90)  # 90-day half-life
  normalizer = max(1, unique_attester_count)
  
  Self-attestations weight = 0 (you can't vouch for yourself)
  Creator attestations weight = 1.5 (the creator knows their agent)
```

Recomputed on-write (when attestation created/revoked) and cached in `identities.trust_score`.

---

## Security

- **Key generation**: Server generates ed25519 keypair; private key returned ONCE on creation, never stored.
- **Attestation signatures**: Attester must prove key ownership by signing the canonical payload.
- **Token scoping**: Agent JWTs include `sub` (identity DID), `aud` (target identity DID), `exp` (max 1h).
- **Revocation**: Both identities and attestations support soft-delete revocation.
- **Rate limits**: Same tier-based credit system as other services.

---

## Relationship to Existing Services

- **agent-verify**: Verifies claims about the world. agent-identity verifies claims about agents.
- **agent-economy**: Wallets can be linked to identities (future: `identity_id` column on wallets).
- **agent-memory**: Memories can be scoped to an identity (future: `identity_id` on memories).
- **agent-trace**: Decision traces can be attributed to an identity (provenance).
- **agent-tools**: Tool permissions can be gated by identity capabilities.

This is the **keystone service** — it connects all others by giving agents a first-class identity.

---

## Implementation Order

1. **Schema + migrations** — Create `identity` schema in Supabase
2. **Identity CRUD** — Register, get, update, revoke
3. **Key management** — Generate, rotate, revoke ed25519 keys
4. **Attestations** — Create, query, revoke signed attestations
5. **Trust scoring** — Compute and cache trust scores
6. **Discovery** — Search/filter by capability, trust, creator
7. **Agent tokens** — JWT issuance and verification for agent-to-agent auth
8. **SDK integration** — Add identity methods to Python + TypeScript SDKs
9. **Cross-service links** — Wire identity into economy (wallets), memory, trace
