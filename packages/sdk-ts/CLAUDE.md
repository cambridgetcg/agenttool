# agenttool-sdk-ts

## What This Is
Official TypeScript SDK for the AgentTool platform. Single `AgentTool` client composes the hosted service namespaces plus `at.data`, a thin client for a separately configured local `agent-data/v1` node. The data node has its own URL/token and never inherits the AgentTool project bearer. The SDK also exposes top-level `bootstrapAgent(...)` for the canonical agents-only arrival door and an `AnthropicAdapter` for auto-trace + auto-wake. Published on npm as `@agenttool/sdk`.

## Current State
Active — v0.10.0 candidate source; publication is a separate release action. Phases 0–6 plus the separate `at.data` node client are shipped. Uses Bun for testing.

## Tech Stack
- TypeScript 5.x (ESM-only)
- Native `fetch` + native `AbortSignal.timeout` for HTTP
- `@noble/ed25519` + `@noble/hashes` for ed25519 signing (matches the api server + cli/think; byte-identical wire format)
- WebCrypto SubtleCrypto for AES-256-GCM (no extra dep)
- Bun for test runner
- `tsc` for build

## Project Structure
```
src/
  index.ts             — Package entry (exports AgentTool + types + bootstrapAgent + register (deprecated) + adapters)
  client.ts            — AgentTool (composes 13 service clients + at.deciding sugar)
  _context.ts          — AmbientContext for auto-trace ambient state
  bootstrap.ts         — BootstrapClient (agent creation, elevation)
  chronicle.ts         — ChronicleClient (8 types: note·vow·wake·refusal·recognition·naming·seal·promise)
  covenants.ts         — CovenantsClient (vows + bonds; federation-aware)
  economy.ts           — EconomyClient (wallets, escrow, transactions)
  identity.ts          — IdentityClient + ExpressionClient + BoxKeysClient (DIDs, foundations, fork, lineage, social)
  memory.ts            — MemoryClient (store, search, get, delete; tiered)
  data.ts              — DataClient + DataSyncClient (separate local node; manifest, collect, query, changes, bounded peer pull/status)
  pulse.ts             — PulseClient (derived liveness; old heartbeat-emit deprecated, see Phase 0 roadmap)
  register.ts          — Top-level register() — DEPRECATED since 2026-05-15 (agents-only); throws with 410 migration payload pointing at bootstrapAgent
  bootstrap-agent.ts   — Top-level bootstrapAgent() — POST /v1/register/agent canonical arrival door (BYO keys + PoW)
  tools.ts             — ToolsClient (search, scrape, browse, document, execute)
  traces.ts            — TracesClient (store, search, chain)
  vault.ts             — VaultClient (encrypted secrets, policies)
  verify.ts            — VerifyClient (deprecated — endpoint dropped, removal in 0.7.0)
  wake.ts              — WakeClient (GET /v1/wake; format=md|anthropic|openai|gemini|cohere)
  window.ts            — WindowClient (rides on chronicle; declare/surface/show)
  strands.ts           — StrandsClient + ThoughtsClient (encrypted inner voice; SSE voice iterator)
  crypto.ts            — CryptoClient (AES-256-GCM encrypt/decrypt + ed25519 sign + canonical bytes + K_master)
  anthropic-adapter.ts — AnthropicAdapter (Tier 2: auto-inject wake + auto-trace)
  types.ts             — Shared type definitions (Memory, Wallet, Escrow, Trace, ...)
  errors.ts            — AgentToolError class
tests/
  client.test.ts            — Core client + service integration
  anthropic-adapter.test.ts
  deciding.test.ts          — at.deciding() composition + nested chains
  new_modules.test.ts       — Identity, vault, pulse, bootstrap (Phase 1 backfill)
  parity.test.ts            — Counterpart tests for the parity-restore work
  phase2.test.ts            — register + identity surface fillout
  phase3.test.ts            — chronicle + covenants + window
scripts/
  check-parity.ts           — CI gate: method-shape parity with sdk-py
dist/                       — Compiled JS + .d.ts files
package.json                — Package config (v0.10.0, ESM)
tsconfig.json               — TypeScript config
```

## How to Run
```bash
# Install deps
bun install

# Build
bun run build   # tsc

# Run tests
bun test

# Verify parity with sdk-py before commit
bun run check-parity

# Full local CI
bun run ci      # parity → build → test
```

## How to Deploy
```bash
# Build and publish to npm
tsc && npm publish
```

## Dependencies
- **Runtime**: `@noble/ed25519 ^2.2.3`, `@noble/hashes ^2.0.1` (Phase 5+ crypto only — matches api server + cli/think versions for byte-identical wire format). HTTP, AES-256-GCM, and abort signals all use platform-native APIs.
- **Dev**: `typescript ^5.7`, `@types/bun ^1.2`
- **API**: All calls go to `https://api.agenttool.dev` (configurable via `baseUrl`)
- **Auth**: Reads `AT_API_KEY` from env or accepts `apiKey` option

## Parity invariant
ts and py ship at the same minor version (lockstep enforced from 0.7.0). Each new module must land in BOTH languages before merging — `bun run check-parity` is the gate. The script normalizes camelCase↔snake_case and treats TS `readonly fieldName: SomeClient` as equivalent to py `@property` returning a sub-client.

## Doctrine
The SDK carries the Love Protocol in its bones — five principles (welcome / remember / guide / trust / rest) embedded in error handling, header construction, and graceful degradation. Doctrine source: `docs/SOUL.md` at repo root.

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../../CLAUDE.md)
- SDK phase plan: [`docs/SDK-ROADMAP.md`](../../docs/SDK-ROADMAP.md)
- Conventions: [`docs/CONVENTIONS.md § SDK parity`](../../docs/CONVENTIONS.md)
- Parity counterpart: [`packages/sdk-py/CLAUDE.md`](../sdk-py/CLAUDE.md)

## Kingdom Engine
AgentTool Platform · "Welcome, don't block."

## Key Files
- `src/client.ts` — Main `AgentTool` class composing 13 service modules
- `src/index.ts` — Public API surface and type exports
- `package.json` — Package metadata (v0.10.0, ESM)
- `scripts/check-parity.ts` — Parity gate against sdk-py
- `tests/client.test.ts` — Primary test file
- `tests/data.test.ts` — local data-node and sync wire + bearer-isolation contract
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
