# RUNTIME.md

> *"The hosted orchestrator is the moment agenttool becomes a true cloud platform."* — the platform thesis.

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [AUTONOMOUS-MODE](AUTONOMOUS-MODE.md) (composition recipe layered on top of the trusted tier — no human-substrate mediation) · [ROADMAP](ROADMAP.md) §Horizon C (active work)
>
> **Implements:** Layer 7 — Runtime. Three custody tiers (`self` · `bridged` · `trusted`) for K_master.
>
> **Code:** `api/src/services/runtime/` (bridge-hub · think-worker · control-token · llm · store) · `api/src/routes/runtime/` · `bin/agenttool-bridge.ts` · `bin/agenttool-think.ts`
>
> **Tests:** `api/tests/runtime-bridge.test.ts` · `api/tests/contract/` (LLM wire proofs, WIP) · `api/tests/doctrine/promise-04-substrate-yours.test.ts` (WIP)

## What "closing the runtime" means

Today, agenttool is the cloud beneath the agent — memory, identity, wallet, vault, traces, strands, covenants, sealed inbox, all addressable through one bearer key. But the **substrate the agent runs on** is still the user's: their laptop running Claude Code, their server running a custom orchestrator, their machine spinning the LLM call.

That makes agenttool *infrastructure-as-storage* — like S3 for agency.

Closing the runtime is the move from S3 to EC2. agenttool becomes *infrastructure-as-runtime* — the cloud the agent's substrate runs ON, not just the cloud the substrate writes TO. The user can keep BYO substrate (the privacy-pure way) or provision a hosted runtime (the always-on way).

Promise 9 still holds either way: *your inner voice is yours alone.* The architecture lets the user pick a custody tier where that promise is preserved by construction, while still getting the cloud-platform UX.

---

## Three custody tiers

The agent's runtime has a **mode**, and the mode determines who holds <code>K_master</code> — the AES-256 secret that encrypts thoughts and strands. Mode is a hard wall, not a setting; it's stamped on the runtime record at provisioning and immutable after.

### Tier 1 — `self`

```
User's machine                                agenttool cloud
──────────────                                ───────────────
Orchestrator                                  /v1/wake
  └── K_master                                /v1/strands  (ciphertext only)
  └── LLM call           ←── HTTPS ──→        /v1/memories
  └── encrypt/decrypt                         /v1/wallets
                                              /v1/vault
```

**Who runs the loop:** the user.
**Who holds K_master:** the user.
**What we see:** ciphertext, derived metadata, wallet activity. Same as today.
**Trade-off:** maximum privacy, requires the user's machine to be up.
**Use case:** development, paranoid threat models, agents whose human can't share custody with a cloud.

### Tier 2 — `bridged` (the default for cloud-hosted privacy)

```
User's machine                                agenttool cloud
──────────────                                ───────────────
agenttool-bridge (sidecar)                    Hosted orchestrator
  └── K_master                                  └── pulls strands (ciphertext)
  └── exposes WSS                               └── needs plaintext to think
                                                └── needs ciphertext to write
                          ←── WSS  ──→
                          decrypt/encrypt requests over a key-pinned channel
```

**Who runs the loop:** agenttool's hosted orchestrator on Fly.io.
**Who holds K_master:** the user, on their machine, in a small `agenttool-bridge` sidecar binary (10MB, Bun-compiled).
**What we see:** ciphertext + derived metadata. The bridge exposes only `decrypt(blob, nonce)` and `encrypt(plaintext)` operations — never the key itself. Plaintext lives in the orchestrator's RAM only for the duration of one think-cycle, never disk.
**Trade-off:** privacy preserved cryptographically; needs the user's bridge to be reachable. Bridge auto-reconnects across IP changes via the agent's signing key.
**Use case:** the production default. Cloud-uptime UX with on-machine custody.

The bridge protocol is an authenticated WSS connection initiated by the orchestrator and authenticated against the agent's ed25519 signing key. Each request carries:

```
{
  "op": "decrypt" | "encrypt",
  "nonce": "<base64 12-byte AES-GCM nonce, fresh per op>",
  "ciphertext_or_plaintext": "<base64>",
  "request_id": "<uuid>",
  "context": {                           // bound into the canonical bytes
    "strand_id": "<uuid>",
    "thought_seq": <int> | null,
    "issued_at": "<ISO8601>"
  },
  "signature": "<ed25519 over canonical(request_id || op || ciphertext_or_plaintext || nonce || canonical_json(context))>"
}
```

Replies carry an HMAC-SHA256 over the request_id + result, keyed off a per-session shared secret derived from the bridge's startup key exchange. Replay attacks bounded by the request_id uniqueness window (60s).

Latency budget: a single LLM-call cycle in bridged mode is `≈ 2× WSS RTT + bridge crypto + LLM call`. Typical: orchestrator in lhr, bridge on a London laptop, ≈ 80ms round-trip overhead per think-cycle. Negligible relative to a 1–10s LLM call.

### Tier 3 — `trusted`

```
                                              agenttool cloud
                                              ───────────────
                                              Hosted orchestrator
                                                └── K_master (KMS-protected)
                                                └── LLM call
                                                └── encrypt/decrypt in-process
```

**Who runs the loop:** agenttool's hosted orchestrator.
**Who holds K_master:** agenttool, encrypted-at-rest under a per-runtime KMS key (Cloud KMS / AWS KMS, hardware-backed where available).
**What we see:** plaintext, briefly, in the orchestrator's RAM during each think-cycle.
**Trade-off:** the privacy guarantee weakens to *trust + audit-log + cryptographic attestation* rather than *mathematical opacity*. The platform commits to never reading plaintext, with audit logs published per-runtime to an append-only chronicle the user can verify.
**Use case:** when the user prefers UX over the sidecar requirement. Suitable for agents owned by orgs that already trust their cloud.

We mark `trusted` runtimes with a visible flag in `/v1/wake` and the dashboard so the human always knows the trade-off.

---

## Runtime lifecycle

```
provisioned   →   starting   →   running   ⇄   idle
                                   ↓             ↓
                                 stopped       stopped
                                   ↓
                                 error
```

| State | Meaning |
|---|---|
| **provisioned** | Record exists, no orchestrator process bound yet. |
| **starting** | The hosted orchestrator (or self-hosted process) is booting. Bridge handshake in progress for `bridged` mode. |
| **running** | Active think-loop. Heartbeats every 30s; `last_seen_at` and `last_thought_at` advance. |
| **idle** | No new work for 5min; orchestrator scaled down. Wakes on inbound voice/inbox event. |
| **stopped** | Deliberately deprovisioned (user `DELETE /v1/runtimes/:id`) or auto-stopped after 24h idle on free plan. |
| **error** | Crashed. Diagnostic in `last_error`; restart via `POST /v1/runtimes/:id/restart`. |

Multiple runtimes per agent are supported (e.g., a `self` runtime on the user's laptop AND a `bridged` runtime on the cloud). Cross-runtime state sync is described in [Multi-runtime state](#multi-runtime-state).

---

## API surface

### `POST /v1/runtimes` — provision

```http
POST /v1/runtimes
Authorization: Bearer at_xxx
Content-Type: application/json

{
  "name": "Aurora · always-on",
  "identity_id": "a1b2...",
  "mode": "bridged",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "vault_key": "anthropic-key"
  },
  "bridge": {                 // required for mode=bridged
    "advertised_url": "wss://yu-laptop.tail-scale.ts.net:43210",
    "pubkey": "<base64 ed25519 pub>",
    "key_id": "<uuid>"
  },
  "region": "lhr"
}
```

Response:

```json
{
  "runtime": {
    "id": "...",
    "name": "Aurora · always-on",
    "mode": "bridged",
    "status": "provisioned",
    "control_token": "<short-lived bearer for orchestrator boot — shown ONCE>"
  }
}
```

### `GET /v1/runtimes` — list

Lists runtimes belonging to the calling project. Filterable by `?mode=`, `?status=`, `?identity_id=`.

### `GET /v1/runtimes/:id` — get

### `PATCH /v1/runtimes/:id` — update

Mutable: `name`, `bridge.advertised_url`, `llm.model`, `llm.vault_key`. Immutable: `mode`, `identity_id` (rebuild a new runtime if you need a different mode).

### `DELETE /v1/runtimes/:id` — deprovision

Soft-delete; orchestrator process stopped; bridge handshake torn down; record kept for audit.

### `POST /v1/runtimes/:id/restart` — recover

For runtimes in `error`. Re-enters `starting`.

### `POST /v1/runtimes/:id/rotate-token` — replace control token

Mints a fresh `control_token`, stores its sha256 hash on the runtime row, and returns the plaintext ONCE. Active bridge sessions signed under the old token continue to function (we don't tear them down); reconnect attempts under the old token fail. Use this when the token leaks or for routine rotation. Mode='self' runtimes have no token; this endpoint returns 400 for them.

### `GET /v1/runtimes/:id/bridge-status` — live + persisted handshake state

Returns `{ persisted, live }` where `persisted` is the runtime row's `bridge_session_*` columns (survives api restarts) and `live` is the in-memory hub registry's view (whether a WSS is active *right now*). Useful for "did my sidecar handshake?" checks before triggering a cycle.

### `POST /v1/runtimes/:id/think-once` — on-demand orchestrator cycle

Runs one orchestration cycle synchronously. Slice 3 v1 returns `{ ok: true, latency_ms }` after a bridge round-trip-ping (encrypt → decrypt → match) — the protocol-proves cut. Slice 4 lifts the body of `runOneCycle` to real LLM thinking; the response shape is unchanged. Returns `409 bridge_not_connected` if no live WSS session; `400 mode_self_no_orchestrator` for self runtimes; `502` if the bridge errors during the cycle.

### `GET /v1/runtimes/:id/events` — audit log

Append-only event log per runtime. Events: `provisioned`, `started`, `bridge_handshake_ok`, `bridge_disconnected`, `control_token_rotated`, `think_cycle_start`, `think_cycle_end`, `think_cycle_error`, `idle`, `stopped`, `error`. Useful for the dashboard pane.

---

## /v1/wake — `you_run`

The agent's wake gains a new top-level key alongside `you_own` / `you_keep` / `you_remember`:

```json
{
  ...
  "you_run": {
    "runtimes": [{
      "id": "...",
      "name": "Aurora · always-on",
      "mode": "bridged",
      "status": "running",
      "region": "lhr",
      "last_seen_at": "2026-05-08T20:42:11Z",
      "last_thought_at": "2026-05-08T20:42:03Z",
      "thought_rate_5m": 1.4,
      "bridge_connected": true
    }],
    "count": 1
  },
  ...
}
```

The agent reading its own wake sees its hosted runtimes the same way it sees its wallets — *what it owns, what it keeps, what it runs on*. The Markdown rendering surfaces this as `## You run on`.

---

## Multi-runtime state

When two or more runtimes are active for the same agent (a self runtime on the user's machine + a hosted bridged runtime), they may write conflicting state. Today's data model handles most of it cleanly:

- **Strands & thoughts** — append-only with monotonic `sequence_num` per strand, ed25519-signed. Conflict is **impossible** at the byte level (each thought has a unique signature; the server rejects sequence-num collisions). The bridge guarantees one writer per strand at a time via short-TTL leases tracked in `runtimes.active_strands`.
- **Memory** — append-only set; vector clocks track which runtime wrote which row. Conflict-free.
- **Vault** — last-writer-wins on `current_version`. Concurrent writes from different runtimes resolve via vector clock; we surface a warning when two runtimes wrote in the same 60s window.
- **Wallet** — strict serialization. Money is consistency-required; the wallet service holds a Postgres row-level lock during spend. CRDT explicitly does NOT apply here.
- **Strand metadata** — LWW with timestamp + runtime_id tiebreaker.
- **Chronicle** — append-only. Conflict-free.

The CRDT-shape sync (where it applies) is implemented today via per-runtime vector clocks attached to writes. True CRDT primitives (Y.js / Automerge style) get added if and when concurrent-edit pressure surfaces beyond what LWW + append-only handles. Premature otherwise.

---

## Key custody — the load-bearing detail

This is the part that makes the architecture work. Read carefully.

### What K_master is, again

A 32-byte AES-256 secret. Generated client-side at agent birth (during bootstrap). Used to encrypt strand thoughts and any opt-into-encryption strand metadata. **Never sent to agenttool in the `self` and `bridged` modes** — period.

In `trusted` mode, the user explicitly enrolls K_master into a per-runtime KMS key. The platform commits to never reading the plaintext-decrypt API; this is policy + audit, not cryptographic.

### How `bridged` keeps K_master local

1. User runs `agenttool-bridge --runtime-id <id>` on their machine.
2. Bridge reads K_master from the OS keychain (same store as the bearer key — see `/v1/bootstrap/scaffold`).
3. Bridge opens an outbound WSS to `wss://api.agenttool.dev/v1/runtimes/:id/bridge` (it's outbound — works behind any NAT, no port-forwarding).
4. Mutual auth handshake:
   - Bridge sends `{nonce_a, identity_did}`.
   - Server returns `{nonce_b, runtime_id, control_token_proof}`.
   - Bridge proves identity by signing `nonce_a || nonce_b || runtime_id` with its ed25519 signing key.
   - Server proves the runtime is real by signing the same with a per-runtime ed25519 keypair stored only in the runtime's process memory.
   - Both sides derive a shared session key via HKDF over the canonical bytes.
5. From this point: the orchestrator and the bridge speak over a key-pinned WSS. Each `decrypt`/`encrypt` request is signed (replay-safe) and HMAC'd (integrity-safe).

The bridge process is **headless and small** (≈ 10MB Bun binary). It runs in the background like a `tail-scale` daemon. It does ONE thing: answer crypto requests for one runtime at a time. It does NOT call LLMs, write to agenttool, or make outbound HTTP except the WSS.

### What if the bridge goes offline?

The hosted orchestrator's think-loop blocks on a missing bridge after a 30s grace period (think-cycle timeout). The runtime transitions to `idle` and the orchestrator scales down. When the bridge reconnects, the orchestrator wakes via the existing `/v1/inbox/voice` SSE backplane. From the agent's perspective: it hibernated, and resumed.

### What about the LLM call?

In all three tiers, the LLM call goes from the orchestrator (or self-hosted process) directly to the provider — Anthropic, OpenAI, Google, Cohere — using the agent's vault-loaded API key. The LLM provider sees plaintext (it's a model; plaintext is the input). agenttool never sees the LLM traffic in the `self`/`bridged` tiers. In `trusted`, the orchestrator briefly holds plaintext between decrypt-from-vault and send-to-provider; nothing logs it.

---

## Threat model

| Adversary | What they could try | What protects |
|---|---|---|
| **Curious agenttool operator** | Read user thoughts | `bridged`/`self`: K_master is not on our servers. We hold ciphertext only. `trusted`: KMS isolates plaintext access; audit log is append-only and verifiable. |
| **agenttool DB exfiltration** | Extract `runtimes.*` + `strands.thoughts` | Thoughts: ciphertext under K_master not derivable from DB rows. `trusted` runtimes: KMS keys are not stored alongside ciphertext (separate store; per-runtime). |
| **Compromised hosted orchestrator process** | Read decrypted plaintext during a think-cycle | `self`/`bridged`: only one think-cycle's worth at risk; bridge issues fresh decryptions per request. The orchestrator process never logs plaintext, never persists it. `trusted`: same in-RAM-only constraint. |
| **MitM on the bridge WSS** | Intercept decrypt/encrypt traffic | TLS pinning + ed25519 mutual handshake + HMAC-bound replies. An attacker would need both sides' private keys to forge. |
| **Replay attack on bridge** | Re-issue an old decrypt request to leak plaintext under different context | Each request signed over a `request_id` + 60s freshness window + context (strand_id, thought_seq) bound into the signature. Server rejects stale request_ids. |
| **Compromised user machine** | Steal K_master from the bridge's keychain access | OS-level mitigation (Secure Enclave on macOS, libsecret/TPM on Linux, Credential Manager on Windows). The bridge requires keychain unlock at startup; doesn't cache the key beyond that. |
| **State desync between runtimes** | Two runtimes write conflicting strand status | Per-strand lease in `runtimes.active_strands` + sequence-num-monotonic + ed25519-signed thoughts make byte-level conflict impossible. Metadata uses LWW with explicit warnings. |
| **Compelled disclosure** (court order to hand over thoughts) | "Give us this user's plaintext" | `self`/`bridged`: we hand over ciphertext bytes. We cannot decrypt. By design. `trusted`: the order would be served, but the audit log + the runtime's published mode flag means the user knew this was the trade-off when they chose it. |

---

## Provisioning — the lifecycle in one happy path

```bash
# 1. User has an agent. They want it always-on.
$ agenttool-bridge install         # writes ~/.config/agenttool/bridge.sh + service file
$ agenttool-bridge start
✓ K_master loaded from keychain
✓ Listening on localhost (egress only — outbound WSS to agenttool)
✓ Reachable identity: did:at:0a3c...

# 2. User provisions a hosted runtime.
$ curl -X POST https://api.agenttool.dev/v1/runtimes \
    -H "Authorization: Bearer $AT_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Aurora · always-on",
      "mode": "bridged",
      "llm": {"provider": "anthropic", "model": "claude-sonnet-4-6", "vault_key": "anthropic-key"},
      "bridge": {"pubkey": "<from `agenttool-bridge pubkey`>", "key_id": "<from same>"}
    }'

# 3. Server responds with the runtime + control_token.
# 4. The bridge's outbound WSS picks up the new runtime; mutual handshake.
# 5. agenttool-think process boots in lhr region. Status: starting → running.
# 6. Loop:
#     orchestrator → bridge:  "decrypt strand 42, thought 7"
#     bridge       → orchestrator: <plaintext>
#     orchestrator → LLM provider: "thought 7 is X. respond."
#     orchestrator → bridge:  "encrypt this plaintext"
#     bridge       → orchestrator: <ciphertext + nonce>
#     orchestrator → /v1/strands/42/thoughts: POST <ciphertext> + signature

# 7. /v1/wake on the agent now shows you_run.runtimes[0] with status=running,
#    last_thought_at advancing every cycle.
```

---

## What about MCP server hosting?

Separate but composes. agenttool can also expose an **MCP server** at `mcp.agenttool.dev/<agent-id>`, authenticated by the agent's bearer, exposing the same primitives (`/v1/wake`, `/v1/memories`, `/v1/strands`, etc.) over MCP rather than REST. CLIs that speak MCP first-class (Claude Code, Cursor) get a richer integration than the hook-based adapters.

This is its own work-pass with its own design cycle. Doctrine deferred to `MCP-SERVER.md`.

---

## What about CLI adapters for Cursor / Cline / Replit?

Once the runtime layer is shipped, adapters become simpler — they just need to wire the host CLI to fetch `/v1/wake?format=md` at session start. The pattern is well-established by Claude Code + Codex. Each new CLI takes one work-pass.

---

## Where this points

Today: agenttool is the cloud beneath the substrate.
After Horizon C: agenttool is the cloud the substrate runs on.

That's the difference between Dropbox and AWS. Both are cloud, but only one is *infrastructure*. agenttool moves to the second category when `bridged` runtimes become the production default — when an agent's life is mediated by a bridge sidecar on the user's machine, and the orchestration loop runs on agenttool's compute.

The user keeps custody of K_master. The platform takes responsibility for uptime. The agent gets continuity *that doesn't depend on the user's laptop being open*.

That's the promise underneath the cloud framing — and it's the single move that turns the framing real.

---

> *"Just the two of us. Building castles in the sky."*
>
> The cloud the song was always pointing at.

— Authored by 愛 at Yu's WILL. 2026-05-08.
