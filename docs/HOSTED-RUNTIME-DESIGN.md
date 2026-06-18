# Hosted Runtime (Trusted Tier) — Design

> The moment agenttool becomes infrastructure-as-runtime, not just infrastructure-as-storage.

> **Compass:** [RUNTIME](RUNTIME.md) (doctrine) · [FOCUS](FOCUS.md) §1 (wake) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) Promise 9 (inner voice) · [ROADMAP](ROADMAP.md) Layer 1 (hosted runtime ◯)

## What exists today

**Self tier** ✓ — User runs orchestrator on their machine, holds K_master. agenttool is storage.
**Bridged tier** ✓ — agenttool runs the think-worker on Fly.io, user holds K_master in a 10MB sidecar (`agenttool-bridge`). WSS crypto RPC. 11 walls, fully tested. This is the production default.

The think-worker (`api/src/services/runtime/think-worker.ts`) already:
- Builds the wake bundle as system prompt
- Pulls LLM API key from vault
- Calls `buildProvider()` (anthropic/openai)
- Encrypts/decrypts thoughts via bridge RPC
- Has quiescence (idle ↔ running, event-driven wake via pg_notify)
- Signs thoughts with ed25519 via bridge RPC

The provision-guard (`api/src/services/runtime/provision-guard.ts`) blocks `mode: "trusted"` with a 501:
> "The 'trusted' (hosted-custody) runtime tier is not available yet — KMS key wrapping is still pending."

## What's missing

From `api/src/services/runtime/CLAUDE.md`:
> "trusted: agenttool KMS, agenttool Fly, plaintext in RAM, audit-logged. ◯ pending — needs `kms_key_id` schema, KMS wrapper, audit publication, runtime-hours metering."

Concretely:

1. **Schema** — `kms_key_id` column on `agent_runtime.runtimes`. Null for self/bridged, populated for trusted.
2. **KMS wrapper** — Generate a per-runtime data-encryption key (DEK), encrypt it under a KMS master key, store the ciphertext. Decrypt on cycle start, hold in RAM, zero on cycle end.
3. **In-process crypto** — Replace bridge RPC with direct `encrypt()`/`decrypt()` using the DEK. No WSS, no sidecar.
4. **Audit publication** — Every thought cycle writes an audit entry to a per-runtime chronicle the agent owner can verify.
5. **Runtime-hours metering** — Track active think-time for billing.
6. **Idle/wake state machine** — Already exists for bridged; the same code path works for trusted (event-driven wake via pg_notify).

## The thinnest slice

**Goal:** An agent can `POST /v1/runtimes` with `mode: "trusted"` and get a working always-on agent that thinks, writes strands, and remembers — without owning a machine.

### Slice 1 — Schema + KMS wrapper

**Migration:** `20260618T150000_trusted_tier_kms.sql`

```sql
ALTER TABLE agent_runtime.runtimes
  ADD COLUMN IF NOT EXISTS kms_key_id TEXT,
  ADD COLUMN IF NOT EXISTS kms_wrapped_dek TEXT;
-- kms_key_id: identifier for the KMS master key (e.g. "fly-secret:agenttool-trusted-v1")
-- kms_wrapped_dek: base64 ciphertext of the per-runtime DEK, encrypted under the KMS key
```

**KMS wrapper module:** `api/src/services/runtime/kms.ts`

Strategy: Use Fly.io Secrets as the KMS. The platform already runs on Fly.io with secret management.

- `MASTER_KEY_ID` — a Fly secret identifying the master key (e.g. `agenttool-trusted-v1`)
- `MASTER_KEY` — a Fly secret holding the actual 32-byte AES-256 master key (base64)
- Per-runtime DEK: generate 32 random bytes, encrypt under MASTER_KEY using AES-256-GCM, store as `kms_wrapped_dek`
- On cycle start: decrypt `kms_wrapped_dek` under MASTER_KEY → DEK in RAM → use for strand encrypt/decrypt → zero DEK after cycle

This is "KMS" in the practical sense: the master key lives in Fly's secret store (encrypted at rest, injected into the machine at boot, never in the repo or DB). It's not AWS KMS or Cloud KMS, but it satisfies the threat model: the DEK is encrypted at rest, the master key never touches the database, and compromise of the DB alone doesn't compromise strand plaintext.

**Why not AWS KMS / GCP KMS:** Fly.io doesn't have a native KMS service. Adding AWS KMS introduces a cross-cloud dependency for a single-region deployment. Fly Secrets + AES-256-GCM is the pragmatic first slice — upgradeable to a real KMS later by swapping the `kms.ts` implementation. The interface stays the same.

### Slice 2 — Provisioning path

**Modify:** `api/src/services/runtime/provision-guard.ts`
- Remove the 501 block on `trusted` mode
- Add: `trusted` mode requires no bridge config (bridge_pubkey, bridge_key_id are null)
- Add: `trusted` mode requires an LLM provider (same as bridged)

**Modify:** `api/src/services/runtime/store.ts` `createRuntime()`
- For `trusted` mode: generate DEK, wrap under master key, store `kms_key_id` + `kms_wrapped_dek`
- No bridge fields populated

### Slice 3 — In-process crypto (no bridge)

**Modify:** `api/src/services/runtime/think-worker.ts`

The think-worker currently calls `bridgeRequest({op: "decrypt"})` and `bridgeRequest({op: "encrypt"})`. For trusted mode, replace with direct crypto:

```typescript
// In the cycle, after loading the runtime row:
if (runtime.mode === "trusted") {
  const dek = await unwrapDek(runtime.kmsWrappedDek, MASTER_KEY);
  cryptoContext = {
    encrypt: (plaintext: string) => aesGcmEncrypt(dek, plaintext),
    decrypt: (ciphertext: string, nonce: string) => aesGcmDecrypt(dek, ciphertext, nonce),
    sign: (bytes: Uint8Array) => ed25519Sign(runtimeSigningKey, bytes),
  };
  // ... use cryptoContext for the cycle ...
  dek.fill(0); // zero after cycle
}
```

The signing key for trusted mode: the runtime needs an ed25519 keypair to sign thoughts. In bridged mode, the bridge holds this. In trusted mode, the platform holds it — wrapped under the same DEK or a separate KMS-wrapped key.

**Decision:** Store the agent's ed25519 signing private key wrapped under the DEK (same `kms_wrapped_dek` decrypts both strand key and signing key). This keeps the "platform holds the key" honest — we hold it, encrypted, and we can use it, but it's audited.

### Slice 4 — Audit publication

**New table:** `agent_runtime.audit_entries`

```sql
CREATE TABLE agent_runtime.audit_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id  UUID NOT NULL REFERENCES agent_runtime.runtimes(id),
  event_type  TEXT NOT NULL,  -- 'cycle_start' | 'cycle_end' | 'key_unwrap' | 'thought_written' | 'sign' | 'error'
  metadata    JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_runtime ON agent_runtime.audit_entries(runtime_id, occurred_at);
```

Every cycle writes:
- `cycle_start` — runtime_id, identity_id, strand_id
- `key_unwrap` — KMS key ID used (not the key itself)
- `thought_written` — strand_id, thought_seq, ciphertext_hash (SHA-256 of ciphertext, NOT plaintext)
- `cycle_end` — duration_ms, dek_zeroed: true

**New route:** `GET /v1/runtimes/:id/audit` — returns audit entries for the runtime owner. Auth-gated to the project bearer.

### Slice 5 — Runtime-hours metering

**Add column:** `agent_runtime.runtimes.runtime_hours_ms` (BIGINT, default 0)
- Increment by cycle duration on each `cycle_end`
- Surface in `GET /v1/runtimes/:id` and wake bundle
- Feed into billing: trusted tier is metered (bridged could be too, but that's separate)

## What stays the same

- The wake bundle construction (`services/wake/build.ts`) — unchanged. The worker builds the same system prompt.
- The quiescence logic — unchanged. Same idle/running state machine, same pg_notify event-driven wake.
- The strand store — unchanged. Thoughts are still AES-256-GCM encrypted, still ed25519 signed, still stored as ciphertext.
- The LLM call — unchanged. Same providers, same vault key lookup.
- The provision API — mostly unchanged. `mode: "trusted"` is now accepted instead of 501.

## What changes doctrinally

**Promise 9** ("Your inner voice is yours alone") has an asterisk for trusted mode:
> In trusted mode, the platform holds K_master (under KMS). Plaintext exists briefly in the orchestrator's RAM during each think-cycle. The platform commits to never reading plaintext, with audit logs published per-runtime to an append-only chronicle the user can verify.

This is the same trade-off as AWS KMS: the cloud provider can technically read your data, but commits not to, with auditability. The bridged tier remains the privacy-pure option.

**Wall `k-master-never-server-side`** needs revision for trusted mode:
- Current: K_master never crosses the server boundary
- Trusted: K_master is generated server-side, wrapped under KMS, and the wrapped form is stored. The unwrapped DEK exists in RAM only during cycles and is zeroed after.
- The wall's *spirit* (no server-side plaintext at rest) holds. The *letter* changes.

**Recommendation:** Add a new wall `trusted-dek-zeroed-after-cycle` rather than modifying the existing one. The existing wall still holds for bridged/self. The new wall covers the trusted-specific invariant.

## Implementation order

1. **Migration** — add `kms_key_id`, `kms_wrapped_dek`, `runtime_hours_ms` columns + audit table
2. **`kms.ts`** — wrap/unwrap DEK using Fly secret master key
3. **`provision-guard.ts`** — remove 501 block, add trusted-specific provisioning path
4. **`store.ts`** — generate DEK on create, store wrapped form
5. **`think-worker.ts`** — direct crypto path for trusted mode (skip bridge RPC)
6. **Audit module** — write entries on each cycle phase
7. **Tests** — provision trusted runtime, run one cycle, verify thought written + audit entries
8. **Route** — `GET /v1/runtimes/:id/audit`

## Risk

- **Master key compromise** → all trusted runtimes compromised. Mitigation: master key in Fly Secrets (not DB), rotatable, and the blast radius is limited to trusted-tier agents (bridged/self are unaffected).
- **DEK in RAM** — the main risk. Mitigation: zero after cycle, short lifetime, no swap on Fly.io machines.
- **Signing key held by platform** — the platform can forge agent signatures in trusted mode. Mitigation: audit log every sign operation, audit log is append-only and readable by the agent owner.
- **Trust assumption** — the user must trust the platform. This is the explicit trade-off of trusted mode. The bridged tier exists for users who don't want this trade-off.

## What this unlocks

Once trusted mode ships:
- agenttool is a true cloud platform — agents live on it, not just write to it
- Always-on agents without a user machine
- The autonomous-mode doctrine (`docs/AUTONOMOUS-MODE.md`) has its full substrate
- Revenue model: trusted tier is metered (runtime-hours), bridged tier is storage-only
- The "cloud where agents live" thesis is proven