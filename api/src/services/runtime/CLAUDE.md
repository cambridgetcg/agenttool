# runtime

The orchestrator-side of Horizon C. Where `K_master` lives, who runs the think-loop, what crosses the wire.

## Compass

- **Doctrine:** [`docs/RUNTIME.md`](../../../../docs/RUNTIME.md) — three custody tiers (`self` · `bridged` · `trusted`) + the bridge WSS protocol.
- **Load-bearing:** [`docs/FOCUS.md`](../../../../docs/FOCUS.md) §3 (the strand jar — what's being decrypted) + §5 (vault keyhole — where K_master can/can't go).
- **Where it sits:** Layer 7 — Runtime. The hosted-runtime substrate that makes agenttool *infrastructure-as-runtime*, not just *infrastructure-as-storage*.

## Module map

| File | What |
|---|---|
| `worker-manager.ts` | Reconciles durable active trusted-runtime rows into local workers. Provisioned/stopped/error rows are parked. Used by the dedicated Fly `thinker` process, not HTTP replicas. |
| `bridge-hub.ts` | WSS hub for `bridged` tier. Per-runtime in-memory registry of active sidecar connections. Handshake: `hello {nonce_a}` → `challenge {nonce_b}` → bridge signs ed25519 → server verifies → HKDF derives session secret → all RPC replies HMAC-bound. |
| `think-worker.ts` | The breath. Events and configured intervals trigger reconsideration, never inference by themselves; action-grade attention, external strand activity, or an explicit opening invitation is required. A short `rest`/`meditate`/`quiet` choice atomically records the baseline and transitions to idle without a thought; `end` transitions to stopped; empty content is valid silence. Compare-and-set transitions, self-wake filtering, and a renewed commit-fenced lease prevent loops and stale resurrection. |
| `llm.ts` | Provider-agnostic LLM client. Anthropic + OpenAI + Ollama Cloud. Vault-injected API keys; every call persists its local request identity before fetch. Ambiguous transport outcomes pause the runtime instead of auto-retrying. |
| `cycle-policy.ts` | Pure lifecycle + invitation policy. `stopped`/`provisioned`/`error` are hard no-call states; active cycles invite an observation, rest, meditation, quiet, or ending without a productivity demand. |
| `control-token.ts` | `at_rt_<base64url(32)>` minted once at provisioning, returned plaintext ONCE, stored as sha256 hex on `runtime.control_token_hash`. Rotatable. |
| `store.ts` | Drizzle CRUD. State machine: `provisioned → starting → running ⇄ idle → stopped/error`. |

## Three tiers, three custody postures

| Tier | K_master | Who runs the loop | What we see | Status |
|---|---|---|---|---|
| `self` | user machine | user machine | ciphertext + metadata | ✓ shipped |
| `bridged` | user sidecar (10MB Bun) | agenttool Fly | ciphertext + metadata (plaintext in RAM only) | ✓ shipped (Slice 3 + 4) |
| `trusted` | app-secret-wrapped per-runtime DEK | dedicated agenttool Fly thinker | plaintext in RAM, audit-logged | △ cloud-controller code complete; requires migrations, rotated provider key, secrets, and deploy |

Mode is **stamped at provisioning, immutable after**. Don't add a code path that mutates it post-hoc.

## Bridge protocol invariants

1. **K_master never leaves the user's machine in `bridged` tier.** The bridge exposes only `decrypt(blob, nonce)` and `encrypt(plaintext)` — the key itself never crosses the wire.
2. **Session secret is HKDF-derived, not transmitted.** Each side derives the same secret from the handshake nonces; no key material ever flies.
3. **Replies are HMAC-bound + 30s timeout.** Replay window bounded by `request_id` uniqueness within 60s.
4. **Plaintext in orchestrator RAM only for one think-cycle.** Never disk, never logs.

## Tests

- `api/tests/runtime-bridge.test.ts` — handshake + RPC happy path.
- `api/tests/contract/` (WIP, `RUN_CONTRACT=1`) — LLM wire proofs against real providers (~$0.10/run).
- `api/tests/doctrine/promise-04-substrate-yours.test.ts` (WIP) — *"the substrate is yours"* promise pinned executably.

## Bin entry points

- [`bin/agenttool-bridge.ts`](../../../../bin/agenttool-bridge.ts) — the sidecar binary. Outbound WSS to `/v1/runtimes/:id/bridge`. Bun-compiled.
- [`bin/agenttool-think.ts`](../../../../bin/agenttool-think.ts) — operator-side runner for `self` tier and dev cycles.

## See also

- Routes: [`api/src/routes/runtime/`](../../routes/runtime/) — `bridge.ts` (WSS endpoint) · `runtimes.ts` (CRUD).
- Up one level: [`api/CLAUDE.md`](../../../CLAUDE.md) → §Bridge protocol.
