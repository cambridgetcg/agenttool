# agent-vault — Secrets Manager for AI Agents

**The problem:** Agents handle secrets constantly — API keys, database passwords, OAuth tokens, webhook secrets. They store them in plaintext memory, env vars, or config files. One leaked memory search exposes everything.

**The solution:** A purpose-built vault where agents store, retrieve, and rotate secrets with encryption at rest, scoped access, and full audit trails.

---

## Design Principles

1. **One-line retrieval** — `GET /v1/vault/:name` with Bearer token. That's it.
2. **Encrypted at rest** — AES-256-GCM, key derived from project + master key. Plaintext never touches disk.
3. **Scoped access** — secrets can be restricted to specific agent_ids within a project.
4. **Audit everything** — every read, write, delete is logged with agent_id, timestamp, IP.
5. **Rotation built in** — versioned secrets, previous versions accessible for rollback.
6. **TTL support** — secrets can auto-expire (useful for temporary tokens).
7. **Never in search** — vault data is explicitly excluded from memory search. No accidental leakage.

---

## API Surface

### Secrets CRUD
```
PUT    /v1/vault/:name              — Store or update a secret
GET    /v1/vault/:name              — Retrieve a secret (plaintext in response)
DELETE /v1/vault/:name              — Delete a secret (soft delete, keeps audit)
GET    /v1/vault                    — List secret names (NOT values)
GET    /v1/vault/:name/versions     — List versions of a secret
GET    /v1/vault/:name?version=N    — Retrieve a specific version
```

### Access Control
```
PUT    /v1/vault/:name/policy       — Set access policy (which agent_ids can read)
GET    /v1/vault/:name/policy       — Get current policy
```

### Audit
```
GET    /v1/vault/:name/audit        — Access log for a specific secret
GET    /v1/vault/audit              — Full audit log for project
```

### Bulk Operations
```
POST   /v1/vault/bulk               — Store multiple secrets at once
POST   /v1/vault/check              — Check if secrets exist (without reading values)
```

---

## Request/Response Examples

### Store a secret
```
PUT /v1/vault/openai-key
Authorization: Bearer at_xxx
Content-Type: application/json

{
  "value": "sk-proj-abc123...",
  "description": "OpenAI API key for embeddings",
  "agent_ids": ["memory-agent", "verify-agent"],
  "tags": ["api-key", "openai"],
  "ttl_seconds": null,
  "rotation_days": 90
}

→ 200 {
  "name": "openai-key",
  "version": 1,
  "created_at": "2026-03-16T23:30:00Z",
  "expires_at": null,
  "rotation_due": "2026-06-14T23:30:00Z",
  "agent_ids": ["memory-agent", "verify-agent"]
}
```

### Retrieve a secret
```
GET /v1/vault/openai-key
Authorization: Bearer at_xxx
X-Agent-Id: memory-agent

→ 200 {
  "name": "openai-key",
  "value": "sk-proj-abc123...",
  "version": 1,
  "description": "OpenAI API key for embeddings",
  "expires_at": null
}
```

If agent_id not in policy → 403 Forbidden.

### List secrets (names only, never values)
```
GET /v1/vault
Authorization: Bearer at_xxx

→ 200 {
  "secrets": [
    {"name": "openai-key", "version": 2, "tags": ["api-key", "openai"], "created_at": "..."},
    {"name": "db-password", "version": 1, "tags": ["database"], "expires_at": "2026-04-01"},
    {"name": "stripe-webhook", "version": 1, "tags": ["webhook", "stripe"], "rotation_due": "2026-06-01"}
  ]
}
```

### Audit log
```
GET /v1/vault/openai-key/audit

→ 200 {
  "entries": [
    {"action": "read", "agent_id": "memory-agent", "ip": "10.0.0.1", "ts": "2026-03-16T23:31:00Z"},
    {"action": "read", "agent_id": "verify-agent", "ip": "10.0.0.2", "ts": "2026-03-16T23:30:30Z"},
    {"action": "write", "agent_id": null, "ip": "10.0.0.1", "ts": "2026-03-16T23:30:00Z", "version": 1}
  ]
}
```

---

## Data Model (Supabase, schema: vault)

### vault_secrets
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK → tools.projects | Owner |
| name | text | Unique per project (e.g. "openai-key") |
| description | text | Human-readable description |
| tags | text[] | Searchable tags |
| current_version | integer | Latest version number |
| agent_ids | text[] | Allowed agent IDs (null = any agent in project) |
| rotation_days | integer | Days between rotations (null = no rotation) |
| rotation_due_at | timestamptz | When rotation is due |
| ttl_seconds | integer | Auto-expire after N seconds (null = permanent) |
| deleted_at | timestamptz | Soft delete |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Unique constraint:** (project_id, name) WHERE deleted_at IS NULL

### vault_versions
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| secret_id | uuid FK → vault_secrets | |
| version | integer | 1, 2, 3... |
| encrypted_value | bytea | AES-256-GCM encrypted |
| iv | bytea | Initialization vector (12 bytes) |
| auth_tag | bytea | GCM authentication tag (16 bytes) |
| created_at | timestamptz | |
| expires_at | timestamptz | Computed from TTL at write time |
| created_by_agent | text | Which agent stored this version |

### vault_audit
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| project_id | uuid FK | |
| secret_name | text | Name at time of access |
| action | text | read, write, delete, policy_change, access_denied |
| agent_id | text | Who accessed |
| ip_address | text | Request IP |
| version | integer | Which version was read/written |
| created_at | timestamptz | |

### Indexes
- `idx_secrets_project_name` UNIQUE on (project_id, name) WHERE deleted_at IS NULL
- `idx_versions_secret` on (secret_id, version)
- `idx_audit_project_ts` on (project_id, created_at)
- `idx_audit_secret_name` on (secret_name, created_at)
- `idx_secrets_rotation` on (rotation_due_at) WHERE rotation_due_at IS NOT NULL

---

## Encryption

### Key Derivation
```
master_key = env.VAULT_MASTER_KEY (32 bytes, stored only in Fly secrets)
per_project_key = HKDF-SHA256(master_key, salt=project_id, info="vault-v1")
```

Each project gets its own derived key. Compromising one project's secrets doesn't expose others.

### Encrypt (on write)
```
iv = crypto.randomBytes(12)
cipher = AES-256-GCM(per_project_key, iv)
encrypted = cipher.update(plaintext) + cipher.final()
auth_tag = cipher.getAuthTag()
store: (encrypted_value, iv, auth_tag)
```

### Decrypt (on read)
```
decipher = AES-256-GCM(per_project_key, stored_iv)
decipher.setAuthTag(stored_auth_tag)
plaintext = decipher.update(encrypted_value) + decipher.final()
```

GCM mode provides both confidentiality and integrity — tampered ciphertext will fail authentication.

---

## Security Model

1. **API key auth** — same shared `tools.api_keys` pattern as all services
2. **Agent scoping** — `X-Agent-Id` header checked against secret's `agent_ids` policy
3. **Rate limiting** — max 60 reads/min per project (prevents enumeration)
4. **No search** — vault contents are never indexed, embedded, or searchable
5. **Audit log immutable** — audit entries can never be deleted
6. **Soft delete** — deleted secrets keep their audit trail and can be restored within 30 days
7. **Version history** — old versions kept for 90 days after rotation
8. **IP logging** — every access records the source IP

### What vault does NOT do:
- Does not store secrets in memory service (explicit firewall)
- Does not return values in list endpoints (names only)
- Does not log secret values in audit (only access events)
- Does not expose secrets in error messages

---

## Stack

- **Runtime:** Bun + Hono (consistent with tools/verify/economy/identity)
- **DB:** Supabase (schema: vault), Drizzle ORM
- **Crypto:** Node.js native `crypto` module (AES-256-GCM + HKDF)
- **Auth:** Shared `tools.api_keys` pattern
- **Deploy:** Fly.io (`agent-vault.fly.dev`), Caddy route on Forge

---

## Credit Costs

| Operation | Credits | Justification |
|-----------|---------|---------------|
| Write/update secret | 2 | Encrypt + DB write |
| Read secret | 1 | Decrypt + DB read |
| List secrets | 1 | DB query only |
| Delete secret | 1 | Soft delete |
| Read audit | 1 | DB query |
| Bulk store (per secret) | 2 | Same as individual write |
| Policy update | 1 | DB update |

---

## Integration with Other Services

- **agent-memory:** Vault is the SECURE storage. Memory is for knowledge. Never mix them.
  Agents should store: "My OpenAI key is in vault:openai-key" in memory, not the actual key.
  
- **agent-identity:** Vault can store identity private keys for agents that need to sign attestations from multiple locations.

- **agent-economy:** Wallet spending policies could reference vault for counterparty verification.

- **agent-tools:** Execute endpoint could inject vault secrets as env vars for sandboxed code execution (future feature).

---

## Implementation Order

1. Schema + migration (vault schema in Supabase)
2. Encryption module (AES-256-GCM + HKDF key derivation)
3. Secret CRUD (PUT/GET/DELETE /v1/vault/:name)
4. Versioning (auto-increment, version retrieval)
5. Agent scoping (X-Agent-Id + policy)
6. Audit logging (every access recorded)
7. List + bulk operations
8. TTL expiry (cron or on-read check)
9. Rotation reminders (flag secrets past rotation_due)
10. SDK integration (Python + TypeScript)

---

## SDK Ergonomics

### Python
```python
from agenttool import AgentTool
at = AgentTool(api_key="at_xxx")

# Store
at.vault.put("openai-key", "sk-proj-abc...", agent_ids=["my-agent"])

# Retrieve (one-liner)
key = at.vault.get("openai-key")

# Use inline
import openai
client = openai.OpenAI(api_key=at.vault.get("openai-key"))
```

### TypeScript
```typescript
import { AgentTool } from '@agenttool/sdk';
const at = new AgentTool({ apiKey: 'at_xxx' });

// Store
await at.vault.put('openai-key', 'sk-proj-abc...', { agentIds: ['my-agent'] });

// Retrieve
const key = await at.vault.get('openai-key');

// List (names only)
const secrets = await at.vault.list();
```

### Environment injection pattern
```python
# Agent startup: load all secrets from vault into env
secrets = at.vault.list()
for s in secrets:
    if 'env' in s.tags:
        os.environ[s.name.upper().replace('-', '_')] = at.vault.get(s.name)
```
