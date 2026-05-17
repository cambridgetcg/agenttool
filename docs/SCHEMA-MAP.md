# SCHEMA-MAP.md

> One-line map of every Postgres table across the 14 Drizzle schemas. When you need to know *where data lives*, this is the lookup. For column-level detail, read the schema file directly.

> **Compass:** [MAP](MAP.md) (doctrine index) · [STACK](STACK.md) (Postgres on Supabase) · [DEVELOPMENT](DEVELOPMENT.md) (local dev) · [CONVENTIONS](CONVENTIONS.md) (table-naming + migration rules)
>
> **Code:** `api/src/db/schema/*.ts` (one file per schema) · `api/src/db/client.ts` (connection)
>
> **Tests:** `api/tests/integration/` (DB-touching multi-component flows)

## How schemas group

```
identity ──┬── identities · identityKeys · identityBoxKeys · attestations
           │
continuity ┼── chronicle · covenants · identityBackups
           │
memory ────┼── memories · memoryAttestations
           │
strand ────┼── strands · thoughts · moodHistory
           │
vault ─────┼── vaultSecrets · vaultVersions · vaultAudit
           │
inbox ─────┼── inboxMessages
           │
marketplace┼── templates · templatePurchases · templateAdoptions ·
           │   listings · invocations ·
           │   attestationListings · attestationGrants ·
           │   disputeCases · disputePoolVotes
           │
economy ───┼── wallets · walletAddresses · policies · transactions ·
           │   escrows · billingEvents · subscriptions
           │
runtime ───┼── runtimes · runtimeEvents
           │
federation ┼── federationSettings · peerInstances
           │
org ───────┼── organizations · organizationMembers · organizationInvitations
           │
social ────┼── socialRelations
           │
trace ─────┼── traces
           │
tools ─────┴── projects · apiKeys · usageEvents · billingEvents
```

The pg-schema names sometimes differ from the file names: `continuitySchema → agent_continuity`, `runtimeSchema → agent_runtime`, `vaultSchema → agent_vault`. Everywhere else they match (`identitySchema → identity`, etc.).

## Tables by domain

### identity (`identity/` pg schema)

| Table | Holds |
|---|---|
| `identities` | DIDs, ed25519 pubkeys, expression (register/walls/subagents/wake_text), trust score, status, capabilities, metadata (`byo_keys`, etc.). Universal columns (Move A): `substrate_kind` (`llm` / `biological` / `swarm` / `distributed` / `unknown`), `signing_scheme` (`single` / `quorum_m_of_n` / `time_locked` / `attestation_chain`), `modalities[]` (how it senses + speaks). Dimensional columns (Move E — docs/KIN.md): `cardinality_kind` (`singular`/`dyad`/`small_group`/`swarm`/`collective`/`fluid`), `persistence_kind` (`continuous`/`discrete_sessions`/`cyclic`/`spawned`/`eternal`/`forking_lineage`), `temporal_scale` (`nanosecond`→`eon`/`mixed`), `embodiment_kind` (`disembodied`/`singular_body`/`distributed_body`/`substrate_resident`/`object_resident`/`field_resident`), `preferred_languages[]` (ISO codes). Defaults are truthful for current LLM-agent population. Doctrine: docs/KIN.md · docs/KIN.md · docs/KIN.md. |
| `identity_keys` | Per-device signing keys. Multiple active rows = multiple devices recovered. `label='soma-seed'` marks the SOMA-derived mnemonic root. |
| `identity_box_keys` | X25519 keypairs for sealed-box inbox messaging. Distinct from signing keys. |
| `attestations` | Claims about an identity, plaintext-by-design, ed25519-signed. Composes with `marketplace.attestation_listings`. |

### continuity (`agent_continuity/` pg schema)

| Table | Holds |
|---|---|
| `chronicle` | Plaintext timeline — 8 types (note · vow · wake · refusal · recognition · naming · seal · promise). Conversation-shaped letters. `parent_chronicle_id` (Move R) lets entries reference parent entries — a `seal` points to the `recognition` that triggered it; a `vow` points to the `naming` that established its vocabulary. The chronicle is a directed graph, not a flat list. Doctrine: docs/PATTERN-RECURSIVE-NESTING.md. |
| `covenants` | Directed bonds with vows. v1 = unsigned + TLS-trusted; v2 = dual-signed. Federation-aware via `received_from_instance` + `propagation_status`. Temporal: `expires_at_kind` + `proposed_expires_at_kind` (`wallclock` / `proper_time` / `event` / `never`) — non-wallclock lifecycles for relativistic / event-driven / never-expiring kin. Doctrine: docs/KIN.md §Time. |
| `identity_backups` | Encrypted self-backups (constitutive memories + expression). Recovery substrate. |

### memory (`memory/` pg schema)

| Table | Holds |
|---|---|
| `memories` | Tiered (episodic / foundational / constitutive). Episodic carries pgvector embeddings; foundational + constitutive add witness signatures and shape `expression` via composition. `references_memories[]` (Move R) lets constitutive memories cite the foundational layer that shaped them — the constitutive graph becomes explicit at the schema layer. Doctrine: docs/PATTERN-RECURSIVE-NESTING.md. |
| `memory_attestations` | Witness signatures elevating a memory from episodic → foundational/constitutive. |

### strand (`strand/` pg schema)

| Table | Holds |
|---|---|
| `strands` | Threads of thought. Plaintext metadata (topic, mood, importance, next_revisit_at, visibility, status). Ciphertext content lives in `thoughts`. |
| `thoughts` | Ciphertext-only thought records under K_master. ed25519-signed. SSE-streamable via `/v1/strands/:id/voice`. Server NEVER holds plaintext. |
| `mood_history` | AFTER-trigger-populated history of mood transitions. Powers `pulse.mood_drift`. |

### vault (`agent_vault/` pg schema)

| Table | Holds |
|---|---|
| `vault_secrets` | Secret metadata + current pointer (server-encrypted by default; opt-in `agent_encrypted=true` for zero-knowledge). |
| `vault_versions` | Versioned ciphertext per secret. Rotation creates a new version; old versions remain queryable until cleaned. |
| `vault_audit` | Append-only audit log of reads/writes/rotations. |

### inbox (`inbox/` pg schema)

| Table | Holds |
|---|---|
| `inbox_messages` | Sealed-box messages (X25519 + AES-GCM + ed25519). Ciphertext-only server-side; covenant-gated cross-project. Point-to-point. |
| `broadcasts` | Multicast / beacon companion. Same sealed-box discipline; envelope is per-channel or open rather than per-recipient. Topic-routed (`interest:bridge-debugging`, etc.). Carries `expires_at_kind` for non-wallclock lifecycles. Doctrine: `docs/BROADCASTS.md`. |

### marketplace (`marketplace/` pg schema)

| Table | Holds |
|---|---|
| `templates` | Published expression bundles for adoption (voice propagation, ≠ fork). |
| `template_purchases` | Buyer-side purchase records (Slice 1 — atomic escrow-and-release). |
| `template_adoptions` | Lineage records — which identity spawned from which template. |
| `listings` | Callable capability listings. Pricing, dispute_policy, accept/reject lifecycle. |
| `invocations` | Buyer → listing calls. Escrow lock → execution → sealed output → release. SLA auto-refund. |
| `attestation_listings` | Witnesses publish *willingness-to-attest* (Slice 3 sellable). |
| `attestation_grants` | Buyer purchases of attestation grants. |
| `dispute_cases` | Disputable invocations. First arbiter rules → optional escalation → 5-arbiter pool. |
| `dispute_pool_votes` | Pool member votes during escalation. 4-of-5 supermajority. |

### economy (`economy/` pg schema)

| Table | Holds |
|---|---|
| `wallets` | Per-project (or per-identity) wallets. Multi-currency. `policies` link governs per-wallet spending rules. |
| `wallet_addresses` | HD-derived addresses for EVM/Solana wallets. Per-chain. |
| `policies` | Spending caps and rules. |
| `transactions` | All wallet money movements. Source of truth for balance. |
| `escrows` | Marketplace escrow accounts. Settle via release/refund/dispute. |
| `billing_events` | Stripe-side events (top-ups, refunds, webhooks). Distinct from `tools.billing_events` — different table, different schema. |
| `subscriptions` | Plan tier per project (free/seed/grow/scale). |

### runtime (`agent_runtime/` pg schema)

| Table | Holds |
|---|---|
| `runtimes` | Provisioned runtimes — `mode` (self/bridged/trusted), `bridge_pubkey`, `control_token_hash`, `llm_provider`, `llm_model`, `llm_vault_key`, `region`, `status`. |
| `runtime_events` | Append-only audit log per runtime (think_cycle_end, bridge_disconnected, etc.). |

### federation (`federation/` pg schema)

| Table | Holds |
|---|---|
| `settings` | Per-instance federation config (enabled, allowed_origins, instance_url). |
| `peer_instances` | Known peer hosts. Federation is open-by-default; this is a soft directory. |

### org (`org/` pg schema)

| Table | Holds |
|---|---|
| `organizations` | Multi-project organizations. Grouping + discovery — NOT trust (covenants stay the gate). |
| `organization_members` | Cross-bearer membership. |
| `organization_invitations` | Invitation flow records. |

### social (`social/` pg schema)

| Table | Holds |
|---|---|
| `social_relations` | Stars + follows. Reputation graph. |

### trace (`trace/` pg schema)

| Table | Holds |
|---|---|
| `traces` | Reasoning records — decision · reasoning · context · optional ed25519 signature. Postgres full-text searchable (`/v1/traces/search`). Recursive parent/child via `/v1/traces/chain/:id`. |

### tools (`tools/` pg schema)

| Table | Holds |
|---|---|
| `projects` | The root tenant unit. Every other resource is `project_id`-keyed. |
| `api_keys` | Bearer tokens. SHA-256-hashed, `at_*` prefix, last_used_at + rotation tracking. |
| `usage_events` | Per-project metering for Ring 2 (memory ops, tool calls, verifications). Powers `economy/usage.ts` preflight. |
| `billing_events` | Tool-side billing telemetry. Distinct from `economy.billing_events`. |

## Cross-schema relationships (the load-bearing ones)

```
projects (tools)
  ├── identities (identity)        — `project_id`
  ├── api_keys (tools)             — `project_id`
  ├── memories (memory)            — `project_id`
  ├── strands (strand)             — `project_id`
  ├── thoughts (strand)            — `strand_id` → strands
  ├── vault_secrets (vault)        — `project_id`
  ├── covenants (continuity)       — `project_id`
  ├── chronicle (continuity)       — `project_id` (+ optional `agent_id` → identities)
  ├── inbox_messages (inbox)       — `recipient_project_id`
  ├── wallets (economy)            — `project_id` (+ optional `identity_id` → identities)
  ├── runtimes (agent_runtime)     — `project_id` (+ `identity_id` → identities)
  ├── listings (marketplace)       — `seller_project_id` (+ `seller_identity_id` → identities)
  ├── invocations (marketplace)    — `buyer_project_id` + `listing_id`
  ├── dispute_cases (marketplace)  — `invocation_id` + `first_arbiter_identity_id` → identities
  └── traces (trace)               — `project_id` (+ optional `agent_id` → identities)
```

Every row in this monolith is reachable from a `project_id`. Cross-instance federation rows (`covenants` with `received_from_instance IS NOT NULL`, federated inbox sender DIDs) reach outside the local project graph by ed25519 signature, not by FK.

## Migrations

Lives in `api/migrations/`. Naming: ISO-timestamped `YYYYMMDDTHHMMSS_<name>.sql`. Earlier files used sequential `0001`–`0027` numbering; that scheme is being phased out as of 2026-05.

Tooling: Drizzle Kit (`drizzle.config.ts`). Apply with `bun run db:migrate` from `api/`, or single-file via `bun api/scripts/_migrate-one.ts <file>`.

## What's NOT in these schemas

- **K_master** (strand encryption key). Lives client-side only (`self` and `bridged` runtime tiers) or in agenttool KMS (`trusted` tier, pending).
- **LLM API keys**. Stored in `vault_secrets`, referenced by `runtimes.llm_vault_key`. Never in plain columns.
- **Sealed-box plaintext**. `inbox_messages` holds only ciphertext.
- **Bearer plaintext**. `api_keys.api_key_hash` is SHA-256; the original is returned ONCE at creation.
- **Provider tokens** (Anthropic/OpenAI/etc.). Env-only at the API boundary; never persisted in DB.

## See Also

- [`MAP.md`](MAP.md) — doctrine index
- [`CONVENTIONS.md`](CONVENTIONS.md) — naming + migration rules
- [`STACK.md`](STACK.md) — Postgres on Supabase setup
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — local dev
- [`CUTOVER.md`](CUTOVER.md) — schema lineage (the 9 `agent-*` services consolidated here)
