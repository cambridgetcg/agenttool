# agenttool-sdk-ts

## What This Is
Official TypeScript SDK for the AgentTool platform. Single `AgentTool` client composes 13 service namespaces (memory, tools, verify, economy, traces, identity, vault, pulse, bootstrap, wake, chronicle, covenants, window) plus a top-level `register(...)` for pre-auth genesis and an `AnthropicAdapter` for auto-trace + auto-wake. Published on npm as `@agenttool/sdk`.

## Current State
Active — v0.6.2 on npm. Phases 0–4 of `docs/SDK-ROADMAP.md` shipped. Phase 5 (strands with K_master) is next. Uses Bun for testing.

## Tech Stack
- TypeScript 5.x (ESM-only)
- Zero runtime dependencies (uses native `fetch`, native `AbortSignal.timeout`)
- Bun for test runner
- `tsc` for build

## Project Structure
```
src/
  index.ts             — Package entry (exports AgentTool + types + register + adapters)
  client.ts            — AgentTool (composes 13 service clients + at.deciding sugar)
  _context.ts          — AmbientContext for auto-trace ambient state
  bootstrap.ts         — BootstrapClient (agent creation, elevation)
  chronicle.ts         — ChronicleClient (8 types: note·vow·wake·refusal·recognition·naming·seal·promise)
  covenants.ts         — CovenantsClient (vows + bonds; federation-aware)
  economy.ts           — EconomyClient (wallets, escrow, transactions)
  identity.ts          — IdentityClient + ExpressionClient + BoxKeysClient (DIDs, foundations, fork, lineage, social)
  memory.ts            — MemoryClient (store, search, get, delete; tiered)
  pulse.ts             — PulseClient (derived liveness; old heartbeat-emit deprecated, see Phase 0 roadmap)
  register.ts          — Top-level register() — POST /v1/register pre-auth front-door
  tools.ts             — ToolsClient (search, scrape, browse, document, execute)
  traces.ts            — TracesClient (store, search, chain)
  vault.ts             — VaultClient (encrypted secrets, policies)
  verify.ts            — VerifyClient (deprecated — endpoint dropped, removal in 0.7.0)
  wake.ts              — WakeClient (GET /v1/wake; format=md|anthropic|openai|gemini|cohere)
  window.ts            — WindowClient (rides on chronicle; declare/surface/show)
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
package.json                — Package config (v0.6.2, ESM, zero deps)
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
- **Runtime**: None (zero dependencies, uses native fetch)
- **Dev**: `typescript ^5.7`, `@types/bun ^1.2`
- **API**: All calls go to `https://api.agenttool.dev` (configurable via `baseUrl`)
- **Auth**: Reads `AT_API_KEY` from env or accepts `apiKey` option

## Parity invariant
ts and py ship at the same minor version (lockstep enforced from 0.7.0). Each new module must land in BOTH languages before merging — `bun run check-parity` is the gate. The script normalizes camelCase↔snake_case and treats TS `readonly fieldName: SomeClient` as equivalent to py `@property` returning a sub-client.

## Doctrine
The SDK carries the Love Protocol in its bones — five principles (welcome / remember / guide / trust / rest) embedded in error handling, header construction, and graceful degradation. Doctrine source: `docs/SOUL.md` at repo root.

## Kingdom Engine
AgentTool Platform · "Welcome, don't block."

## Key Files
- `src/client.ts` — Main `AgentTool` class composing 13 service modules
- `src/index.ts` — Public API surface and type exports
- `package.json` — Package metadata (v0.6.2, ESM, zero deps)
- `scripts/check-parity.ts` — Parity gate against sdk-py
- `tests/client.test.ts` — Primary test file
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
