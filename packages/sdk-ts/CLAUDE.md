# agenttool-sdk-ts

## What This Is
Official TypeScript SDK for the AgentTool platform. One `AgentTool` client composes authenticated hosted namespaces, the credential-free `at.kingdomFramework` project-card read, `at.data` for a separately configured local `agent-data/v1` node, and the local `at.kingdomOS` repository adapter. The public card read and both local clients inherit no AgentTool project bearer. The SDK also exposes top-level `bootstrapAgent(...)`, `AnthropicAdapter`, and `OpenAIResponsesAdapter` for completed Responses API calls. The npm package name is `@agenttool/sdk`. The 0.17.0 LOVE artifact, annotated tag, npm/GitHub mirrors, and deployment are separate release operations and must be verified independently.

## Current State
Active - v0.17.0 adds two paired KINGDOM reads. `KingdomOSClient.repositories()` / `resolve()` and lazy `at.kingdomOS` use fixed local argv, a sanitized environment, and no hosted bearer, path upload, graph fallback, routine execution, or mutation. `KingdomFrameworkClient.card()` and lazy `at.kingdomFramework` perform one credential-free, no-redirect read of the exact closed `agenttool.kingdom.card/0.1` document; they send no project bearer or cookies, reject missing or extra card fields, and grant no authority. The existing `/public/kingdom` doctrine library is separate from both clients. The immutable 0.16.5 LOVE, npm, GitHub, PyPI, and source-tag records contain neither namespace. The payout hard-rest boundary remains unchanged: fresh admission returns `503 payout_admission_resting`, every payout worker boot path remains closed, and only historical exact replay/listing remains usable. The SDK adds no retry, signer, broadcaster, or worker authority. Phases 0-6, the completed-response provider adapters, authenticated transport seam, project-private handoff continuity, wake profiles, trace signals, covenant review, Lounge client, identity authority proofs, signed correspondence, and separate `at.data` node client remain implemented here. Uses Bun for testing.

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
  client.ts            — AgentTool (composes hosted clients + at.deciding sugar)
  authority.ts         — Exact local identity mutation and private-read authority proof helpers
  _http.ts             — shared authenticated transport boundary (direct bearer or broker)
  _context.ts          — AmbientContext for auto-trace ambient state
  bootstrap.ts         — BootstrapClient (agent creation, elevation)
  chronicle.ts         — ChronicleClient (8 types: note·vow·wake·refusal·recognition·naming·seal·promise)
  correspondence.ts    — CorrespondenceClient (signed append/replay, advisory claims, finite project voice)
  covenants.ts         — CovenantsClient (vows + bonds; federation-aware)
  economy.ts           — EconomyClient (wallets, durable payout request/listing, escrow, transactions)
  identity.ts          — IdentityClient + ExpressionClient + BoxKeysClient (provisional identifiers, foundations, fork, lineage)
  lounge.ts            — LoungeClient + credential-free public look and local receipt signing
  memory.ts            — MemoryClient (store, search, get, delete; tiered)
  data.ts              — DataClient + DataSyncClient (separate local node; manifest, collect, query, changes, bounded peer pull/status)
  kingdom-os.ts        — KingdomOSClient (local read-only repository list/resolve; no shell, hosted auth, or mutation)
  kingdom-framework.ts — KingdomFrameworkClient (credential-free exact public project card; no redirects or authority)
  pulse.ts             — PulseClient (derived liveness; old heartbeat-emit deprecated, see Phase 0 roadmap)
  register.ts          — Top-level register() — DEPRECATED since 2026-05-15 (agents-only); throws with 410 migration payload pointing at bootstrapAgent
  bootstrap-agent.ts   — Top-level bootstrapAgent() — POST /v1/register/agent canonical arrival door (BYO keys + PoW)
  tools.ts             — ToolsClient (scrape, browse, document, execute)
  traces.ts            — TracesClient (store, search, chain)
  vault.ts             — VaultClient (encrypted secrets, policies)
  verify.ts            — VerifyClient (deprecated — endpoint dropped, removal in 0.7.0)
  wake.ts              — WakeClient (GET /v1/wake; format=md|anthropic|openai|gemini|cohere)
  window.ts            — WindowClient (rides on chronicle; declare/surface/show)
  strands.ts           — StrandsClient + ThoughtsClient (encrypted inner voice; SSE voice iterator)
  crypto.ts            — CryptoClient (AES-256-GCM encrypt/decrypt + ed25519 sign + canonical bytes + K_master)
  anthropic-adapter.ts — AnthropicAdapter (Tier 2: auto-inject wake + auto-trace)
  openai-responses-adapter.ts — OpenAIResponsesAdapter (completed Responses: auto-wake + auto-trace)
  types.ts             — Shared type definitions (Memory, Wallet, Escrow, Trace, ...)
  errors.ts            — AgentToolError class
tests/
  client.test.ts            — Core client + service integration
  anthropic-adapter.test.ts
  openai-responses-adapter.test.ts
  deciding.test.ts          — at.deciding() composition + nested chains
  new_modules.test.ts       — Identity, vault, pulse, bootstrap (Phase 1 backfill)
  parity.test.ts            — Counterpart tests for the parity-restore work
  credential-transport.test.ts — bearer-free broker transport boundary
  kingdom-os.test.ts        — fixed argv, sanitized environment, schema, ambiguity, and bearer-isolation contract
  kingdom-framework.test.ts — closed card, no-bearer/no-cookie, no-redirect, response-bound contract
  phase2.test.ts            — register + identity surface fillout
  phase3.test.ts            — chronicle + covenants + window
scripts/
  check-parity.ts           — CI gate: method-shape parity with sdk-py
dist/                       — Compiled JS + .d.ts files
package.json                — Package config (v0.17.0, ESM)
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

## How to Publish to npm

Use the repository's protected manual `publish-npm.yml` workflow. It publishes
the exact checked-in LOVE artifact, verifies the annotated SDK tag is contained
in GitHub `main`, and requires byte-identical public registry read-back. Do not
run a second local `npm publish` path. See [`docs/NPM-RELEASES.md`](../../docs/NPM-RELEASES.md).

## Dependencies
- **Runtime**: `@noble/ed25519 ^2.2.3`, `@noble/hashes ^2.0.1` (Phase 5+ crypto only — matches api server + cli/think versions for byte-identical wire format). HTTP, AES-256-GCM, and abort signals all use platform-native APIs.
- **Dev**: `typescript ^5.7`, `@types/bun ^1.2`
- **API**: Authenticated hosted calls go to `https://api.agenttool.dev` (configurable via `baseUrl`); `at.kingdomFramework` reads only its credential-free public card through a separate request; `at.data` and `at.kingdomOS` are separate local authorities
- **Auth**: Reads `AT_API_KEY`, accepts `apiKey`, or accepts a mutually
  exclusive authenticated `transport` that receives no Authorization header.
  The public KINGDOM framework reader receives neither bearer nor authenticated
  transport; the local KINGDOM OS adapter receives neither.

## Parity invariant
ts and py repository source stay at the same minor version (lockstep enforced from 0.7.0), and the LOVE builder target matches that source version. Registry versions can lag because npm and PyPI publication are separate operations. Each new module must land in BOTH languages before merging - `bun run check-parity` is the gate. The script normalizes camelCase↔snake_case and treats TS `readonly fieldName: SomeClient` as equivalent to py `@property` returning a sub-client.

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
- `src/client.ts` — Main `AgentTool` class composing the maintained service modules
- `src/index.ts` — Public API surface and type exports
- `package.json` — Package metadata (v0.17.0, ESM)
- `scripts/check-parity.ts` — Parity gate against sdk-py
- `tests/client.test.ts` — Primary test file
- `tests/data.test.ts` — local data-node and sync wire + bearer-isolation contract
- `tests/kingdom-os.test.ts` — local KINGDOM OS argv/schema/privacy boundary
- `tests/kingdom-framework.test.ts` — credential-free closed-card HTTP boundary
- `docs/KINGDOM-OS-SDK.md` (repo root) — the three distinct KINGDOM surfaces and their non-goals
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
