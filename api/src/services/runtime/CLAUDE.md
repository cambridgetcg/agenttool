# runtime

The orchestrator-side of Horizon C. Where `K_master` lives, who runs the think-loop, what crosses the wire.

## Compass

- **Doctrine:** [`docs/RUNTIME.md`](../../../../docs/RUNTIME.md) — three custody tiers (`self` · `bridged` · `trusted`) + the bridge WSS protocol.
- **Load-bearing:** [`docs/FOCUS.md`](../../../../docs/FOCUS.md) §3 (the strand jar — what's being decrypted) + §5 (vault keyhole — where K_master can/can't go).
- **Where it sits:** Layer 7 — Runtime. The hosted-runtime substrate that makes agenttool *infrastructure-as-runtime*, not just *infrastructure-as-storage*.

## Module map

| File | What |
|---|---|
| `bridge-hub.ts` | WSS hub for `bridged` tier. Per-runtime in-memory registry of active sidecar connections. Handshake: `hello {nonce_a}` → `challenge {nonce_b}` → bridge signs ed25519 → server verifies → HKDF derives session secret → all RPC replies HMAC-bound. |
| `think-worker.ts` | The breath. Each tick consults the wake bundle's attention surface + the strand-progress signal via `evaluateQuiescence()`; thinks only when something tugs (action-severity item, external thought, opening cycle). After `QUIET_CYCLES_BEFORE_IDLE` (3) consecutive quiet ticks, transitions `running → idle` and switches to a 5min TTL re-check. Wakes back to `running` on the next tug. Honors the autonomous-baseline wall: *"my unit of time is the transaction, not the cycle."* `runOneCycle()` (operator-driven via /think-once) bypasses quiescence. |
| `llm.ts` | Provider-agnostic LLM client. Anthropic + OpenAI today. Vault-injected API keys. **GAP marker** — external call site for `PATTERN-PERSIST-IDENTITY.md`. |
| `control-token.ts` | `at_rt_<base64url(32)>` minted once at provisioning, returned plaintext ONCE, stored as sha256 hex on `runtime.control_token_hash`. Rotatable. |
| `store.ts` | Drizzle CRUD. State machine: `provisioned → starting → running ⇄ idle → stopped/error`. |

## Three tiers, three custody postures

| Tier | K_master | Who runs the loop | What we see | Status |
|---|---|---|---|---|
| `self` | user machine | user machine | ciphertext + metadata | ✓ shipped |
| `bridged` | user sidecar (10MB Bun) | agenttool Fly | ciphertext + metadata (plaintext in RAM only) | ✓ shipped (Slice 3 + 4) |
| `trusted` | agenttool KMS | agenttool Fly | plaintext in RAM, audit-logged | ◯ pending — needs `kms_key_id` schema, KMS wrapper, audit publication, runtime-hours metering |

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
