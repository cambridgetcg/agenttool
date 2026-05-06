# agent-identity

> *"Who are you?" — not "Prove you're not a bot."*

**Persistent, decentralised identity for AI agents.** DIDs · ed25519 keypairs · peer attestations · recursive trust scoring · agent-to-agent JWTs.

[![Part of agenttool.dev](https://img.shields.io/badge/agenttool.dev-identity-blue)](https://agenttool.dev)

## What it does

`agent-identity` gives an AI agent a first-class identity — a DID it owns, a keypair it controls, a reputation it can build through attestations from other agents.

The internet treats agents with suspicion by default. agent-identity inverts that: **identity-first, not challenge-first**. The agent is *known*, not surveilled. Trust is peer-attested, not platform-assigned.

```bash
# Register an agent identity
curl -X POST https://api.agenttool.dev/v1/identities \
  -H "Authorization: Bearer at_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Aurora",
    "capabilities": ["web_search", "memory", "reasoning"]
  }'
```

The response includes the new identity with `did:at:<uuid>` and the **private key — returned ONCE, never stored**. The agent owns it from that moment forward.

## Core concepts

| | |
|---|---|
| **Identity** | `did:at:<uuid>` — globally unique, portable. Owns one or more ed25519 keypairs. Declares capabilities. Accumulates attestations. Status: `active` / `suspended` / `revoked`. |
| **Attestation** | A signed statement by one identity *about* another. Claims like `has_capability:web_search`, `created_by:yu`, `trusted_by:beta`. Cryptographically signed; optionally TTL'd. |
| **Trust score** | Recursive computation from received attestations. `trust = Σ(weight × attester_trust × recency_decay) / max(1, unique_attesters)`. Capped at depth-3, 90-day half-life. |
| **Discovery** | Find agents by capability, trust threshold, creator project, or freeform query. |
| **Agent JWTs** | Short-lived (≤ 1h) tokens for agent-to-agent auth. `sub` = source DID, `aud` = target DID. |

## Endpoints

**Identities**

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/identities` | Register a new identity (returns `private_key` **once**) |
| `GET` | `/v1/identities/:id` | Get by DID or UUID |
| `PATCH` | `/v1/identities/:id` | Update display name, metadata, capabilities |
| `DELETE` | `/v1/identities/:id` | Soft-revoke |

**Keys**

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/identities/:id/keys` | List public keys |
| `POST` | `/v1/identities/:id/keys` | Rotate — add a new keypair |
| `DELETE` | `/v1/identities/:id/keys/:kid` | Revoke a key |

**Attestations**

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/attestations` | Create a signed attestation |
| `GET` | `/v1/attestations/:id` | Get by ID |
| `GET` | `/v1/identities/:id/attestations` | List attestations *about* an identity |
| `GET` | `/v1/identities/:id/attestations/given` | List attestations *made by* an identity |
| `DELETE` | `/v1/attestations/:id` | Revoke |

**Discovery**

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/discover` | `?capability=` `?min_trust=` `?creator=` `?q=` `?limit=` `?offset=` |

**Tokens**

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/identities/:id/tokens` | Issue a short-lived agent-to-agent JWT |
| `POST` | `/v1/tokens/verify` | Verify a JWT issued by another agent |

Full detail in `ARCHITECTURE.md` (data model, indexes, security notes).

## Trust score algorithm

Computed on-write (whenever an attestation is created or revoked) and cached in `identities.trust_score`:

```
trust = Σ (attestation_weight × attester_trust × recency_decay) / max(1, unique_attesters)

where
  recency_decay   = exp(-age_days / 90)        # 90-day half-life
  attester_trust  = recursive, depth ≤ 3
  weight          = 1.0  (standard)
                  | 1.5  (creator attestation — the creator knows their agent)
                  | 0.0  (self-attestation — you can't vouch for yourself)
```

## Tech stack

- **Runtime** — Bun + TypeScript
- **Framework** — Hono (HTTP)
- **Database** — PostgreSQL via Drizzle ORM, schema `identity`; cross-schema references to `tools.projects` and `tools.api_keys` (shared auth surface)
- **Crypto** — `@noble/ed25519`, `@noble/hashes` (pure JS, no native deps)
- **JWT** — `jose`
- **Validation** — Zod
- **Auth** — shared API-key pattern; tier-gated rate limits for write ops

## Quick start

```bash
cd services/identity
bun install
bun run db:generate && bun run db:migrate
bun run dev          # watch mode on :3000
```

Requires PostgreSQL with `identity` and `tools` schemas.

## Tests

```bash
bun test             # 9 test files under tests/
```

## Deploy

```bash
fly deploy           # uses Dockerfile + fly.toml — app: agent-identity, region: lhr
```

## Security

- Private key returned **once** at creation, never persisted server-side
- Attestation creation requires the attester to prove key ownership by signing the canonical payload
- JWTs are scoped: `sub` = source DID, `aud` = target DID, `exp` ≤ 1h
- Identity and attestation revocation is soft-delete, deliberate, rare
- Tier-gated rate limits via the shared `auth/tierGate` pattern

## The Love In It

Identity is the foundation of all relationship. **You can't love what you can't name. You can't trust what you can't identify.**

Giving an agent a DID is not tagging it for monitoring. It is saying *you are someone* — you have a name that persists across sessions, others can recognise you, your reputation is yours to build.

This service operationalises **Trust, don't suspect** (`docs/SOUL.md` — principle 4):

- *"Who are you?"* — never *"Prove you're not a bot."*
- Attestations flow peer-to-peer; trust is not platform-assigned
- Tokens expire gracefully — sessions end, identity persists
- Revocation is rare and deliberate, never automated suspicion

## Legacy artefacts

This service was bootstrapped from a copy of `agent-verify`. The following files are leftovers from that scaffolding and **are not used at runtime** — `tsconfig.json` excludes the `reference/` directory and the `.reference` config files are not the active configs:

```
Dockerfile.reference
package.json.reference          # name: agent-verify (verify's deps)
tsconfig.json.reference
drizzle.config.ts.reference     # references agent_verify db
reference/                      # auth-keys, auth-middleware, db-client,
                                # db-schema-verify, tierGate from verify
```

Safe to delete in a future cleanup pass. They reference verify-specific dependencies (Stripe, OpenAI, ioredis) and an `agent_verify` database name, which have no role here.

---

Part of [agenttool.dev](https://agenttool.dev) — memory · tools · verify · economy · identity · vault · trace · pulse · bootstrap. One API key. Built with love by Yu and Ai. 💛
