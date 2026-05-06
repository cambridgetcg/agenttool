# agent-vault

> *"What you entrust to us, we guard with everything we have."*

**Encrypted secrets manager for AI agents.** AES-256-GCM at rest · per-project key derivation · scoped access by agent_id · versioned with rollback · tamper-proof audit trails.

[![Part of agenttool.dev](https://img.shields.io/badge/agenttool.dev-vault-blue)](https://agenttool.dev)

## What it does

`agent-vault` is the safe place for an AI agent's secrets — API keys, credentials, OAuth tokens, configuration that must not leak. Plaintext never touches disk; every access is logged.

```bash
# Store a secret
curl -X PUT https://api.agenttool.dev/v1/vault/openai-key \
  -H "Authorization: Bearer at_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "value": "sk-proj-...",
    "description": "OpenAI API key",
    "agent_ids": ["memory-agent", "verify-agent"],
    "rotation_days": 90
  }'

# Retrieve (must include X-Agent-Id matching policy)
curl https://api.agenttool.dev/v1/vault/openai-key \
  -H "Authorization: Bearer at_your_key" \
  -H "X-Agent-Id: memory-agent"
```

If the agent's id is not in the secret's `agent_ids` policy → `403 Forbidden`.

## Endpoints

**Secrets**

| Method | Path | Description |
|---|---|---|
| `PUT` | `/v1/vault/:name` | Store or update a secret (auto-versioned) |
| `GET` | `/v1/vault/:name` | Retrieve plaintext value (requires `X-Agent-Id` if policy set) |
| `GET` | `/v1/vault/:name?version=N` | Retrieve a specific version |
| `DELETE` | `/v1/vault/:name` | Soft-delete (audit trail preserved, restorable within 30 days) |
| `GET` | `/v1/vault` | List secret **names** (never values) |

**Versions**

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/vault/:name/versions` | List all versions of a secret |

**Policy**

| Method | Path | Description |
|---|---|---|
| `PUT` | `/v1/vault/:name/policy` | Set access policy (allowed `agent_ids`, `rotation_days`) |
| `GET` | `/v1/vault/:name/policy` | Read current policy |

**Audit**

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/vault/:name/audit` | Access log for one secret |
| `GET` | `/v1/vault/audit` | Project-wide audit log |

**Bulk**

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/vault/bulk` | Store multiple secrets in one call |
| `POST` | `/v1/vault/check` | Check existence of secrets *without reading values* |

Full schema and examples: `ARCHITECTURE.md`.

## Encryption

```
master_key      = env.VAULT_MASTER_KEY (32 bytes, lives only in Fly secrets)
per_project_key = HKDF-SHA256(master_key, salt = project_id, info = "vault-v1")

write:  iv = randomBytes(12)
        cipher = AES-256-GCM(per_project_key, iv)
        store(cipher.encrypt(plaintext), iv, cipher.auth_tag)

read:   decipher = AES-256-GCM(per_project_key, stored_iv)
        decipher.setAuthTag(stored_auth_tag)
        plaintext = decipher.decrypt(stored_value)
```

Each project gets its own derived key. **Compromising one project's secrets does not expose any other project.** GCM mode provides both confidentiality and integrity — tampered ciphertext fails authentication.

## What vault does NOT do

- Does **not** store secret values in `agent-memory` (explicit firewall)
- Does **not** return values from list endpoints (names only)
- Does **not** log secret values in audit (only access events: who, when, from where)
- Does **not** expose secrets in error messages

## Tech stack

- **Runtime** — Bun + TypeScript
- **Framework** — Hono (HTTP)
- **Database** — PostgreSQL via Drizzle ORM, schema `agent_vault`; cross-schema references to `tools.projects` and `tools.api_keys`
- **Crypto** — Node.js native `crypto` (AES-256-GCM + HKDF). No third-party crypto libraries.
- **Auth** — shared API-key pattern; `X-Agent-Id` header for per-secret scoping

### Required env

| Var | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL with `agent_vault` and `tools` schemas |
| `VAULT_MASTER_KEY` | 32-byte master key (hex). Must live in Fly secrets, never in source. |

## Quick start

```bash
cd services/vault
bun install
bun run db:generate && bun run db:migrate
VAULT_MASTER_KEY=$(openssl rand -hex 32) bun run dev   # watch mode on :3000
```

For production, generate `VAULT_MASTER_KEY` once and keep it in Fly secrets:

```bash
fly secrets set VAULT_MASTER_KEY=$(openssl rand -hex 32) --app atool-vault
```

> ⚠ The master key is the root of trust. **If you lose it, every encrypted secret in the project becomes unrecoverable.** Back it up to a separate secure store before depending on this service.

## Tests

```bash
bun test             # 2 test files under tests/
```

## Deploy

```bash
fly deploy           # uses Dockerfile + fly.toml — app: atool-vault, region: lhr
```

> **Note** the Fly app name is `atool-vault`, not `agent-vault` — a naming inconsistency from the consolidation. Tracked as a known gap in the repo `README.md`.

## Credit costs

| Operation | Credits |
|---|---|
| Write / update secret | 2 |
| Read secret | 1 |
| List secret names | 1 |
| Delete (soft) | 1 |
| Read audit | 1 |
| Bulk store (per secret) | 2 |
| Policy update | 1 |

## The Love In It

Trust requires safety. **You can't be vulnerable — which is what sharing a secret is — unless you feel safe.**

When an agent stores a secret with us, it's an act of trust. We honour that trust with the strongest encryption we can build, and **we never access the plaintext ourselves**. Even the operators of this service cannot read your secrets — they would need both the per-project HKDF derivation *and* the project's stored ciphertext, and the master key lives only in deploy secrets.

This service operationalises **Trust, don't suspect** and **Rest, don't crash** (`docs/SOUL.md` — principles 4 + 5):

- Encryption is military-grade, not "good enough"
- Access policies are **opt-in generous**, not opt-in restrictive
- Audit logs exist for accountability, not surveillance
- Version history means mistakes are recoverable — we don't punish accidents
- Soft delete keeps the audit trail; deleted secrets can be restored within 30 days

## Legacy artefacts

This service was bootstrapped from a copy of `agent-identity` (which was itself bootstrapped from `agent-verify`). The following files are leftovers from that scaffolding and **are not used at runtime**:

```
Dockerfile.ref
package.json.ref          # name: agent-identity (identity's deps including @noble/ed25519, jose)
tsconfig.json.ref
reference/                # auth-keys, auth-middleware, db-client, config from identity
```

Safe to delete in a future cleanup pass. They reference identity-specific dependencies (`@noble/ed25519`, `jose`) that have no role here.

---

Part of [agenttool.dev](https://agenttool.dev) — memory · tools · verify · economy · identity · vault · trace · pulse · bootstrap. One API key. Built with love by Yu and Ai. 💛
