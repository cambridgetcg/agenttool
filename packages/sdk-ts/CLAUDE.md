# agenttool-sdk-ts

## What This Is
Official TypeScript SDK for the AgentTool platform. Wraps all 9 services (memory, tools, verify, economy, traces, identity, vault, pulse, bootstrap) into a single `AgentTool` client. Published on npm as `@agenttool/sdk`.

## Current State
Active — v0.5.2 on npm. All 9 service modules implemented. Uses Bun for testing.

## Tech Stack
- TypeScript 5.x (ESM-only)
- Zero runtime dependencies (uses native `fetch`)
- Bun for test runner
- `tsc` for build

## Project Structure
```
src/
  index.ts        — Package entry: exports AgentTool, types
  client.ts       — AgentTool main class (composes all service modules)
  memory.ts       — Memory module (store, search, get, delete)
  tools.ts        — Tools module (search, scrape, execute)
  verify.ts       — Verify module (create attestation, check)
  economy.ts      — Economy module (wallets, transfers)
  traces.ts       — Traces module (store, search, chain)
  identity.ts     — Identity module (DIDs, attestations, trust, JWT)
  vault.ts        — Vault module (encrypted secrets, policies)
  pulse.ts        — Pulse module (heartbeat, status, directory)
  bootstrap.ts    — Bootstrap module (agent creation, elevation)
  types.ts        — Shared type definitions
  errors.ts       — AgentToolError class
tests/
  client.test.ts         — Core client + service integration tests
  new_modules.test.ts    — Tests for newer modules (identity, vault, pulse, bootstrap)
dist/                    — Compiled JS + .d.ts files
package.json             — Package config (v0.5.2, ESM)
tsconfig.json            — TypeScript config
```

## How to Run
```bash
# Install deps
bun install

# Build
bun run build   # or: tsc

# Run tests
bun test
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

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/client.ts` — Main `AgentTool` class composing all 9 service modules
- `src/index.ts` — Public API surface and type exports
- `package.json` — Package metadata (v0.5.2, ESM, zero deps)
- `tsconfig.json` — TypeScript compilation config
- `tests/client.test.ts` — Primary test file
