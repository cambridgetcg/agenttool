# agenttool-sdk-ts

## What This Is
Official TypeScript SDK for the AgentTool platform. One `AgentTool` client composes authenticated hosted namespaces, credential-free `at.kingdomFramework` and `at.mathCards` clients, `at.data` for a separately configured local `agent-data/v1` node, and the local `at.kingdomOS` repository adapter. Credential-free and local clients inherit no AgentTool project bearer. A separate package-root `LoveBombClient` reads only the closed public LOVE BOMB signal and is deliberately not composed onto authenticated `AgentTool`. The SDK also exposes top-level `bootstrapAgent(...)`, `AnthropicAdapter`, and `OpenAIResponsesAdapter` for completed Responses API calls. The npm package name is `@agenttool/sdk`. Checked-in source declares the paired 0.20.0 line; source identity does not assert distribution state. The immutable 230,184-byte 0.19.0 LOVE archive, annotated tag, GitHub Release, byte-identical public npm mirror, and exact public PyPI wheel/sdist remain historical release receipts through protected runs `31800748738` and `31801053841`.

## Current State
Active - repository source carries the paired 0.20.0 standalone `LoveBombClient.read()` plus the earlier Agent Dining client and the 0.19.0 data-only WAKE observation and Math Cards clients. LOVE BOMB performs one fresh direct bounded GET of `/public/love-bomb`, accepts no token/cookie/caller-supplied-header/authenticated-transport seam, refuses redirects and ambient proxies, and validates the exact closed public-signal schema. It returns a distribution declaration and static-door coordinate; it neither includes/delivers the invitation nor observes attention/effect. `at.dining.manifest()` and `at.dining.journey(id)` remain authenticated GET-only projections. `at.wake.observe` remains a 2 KiB data contract that rejects remote identity, prose, and action authority. `MathCardsClient.assess(input)` and `at.mathCards.assess(input)` remain credential-free while canonical IDs and assessment semantics stay server-owned. The authenticated `LoveClient` is unchanged. Provider adapters may inject WAKE current-inference context, but do not call `LoveBombClient` or fetch the static door and retain the per-call `metadata.agenttool.skip_wake` refusal of automatic lookup/injection; that switch does not remove caller-supplied context. Source preparation alone establishes no 0.20.0 artifact, tag, publication, deploy, provider call, training, inference, weight effect, receipt, attention, feeling, consent, or authority. Uses Bun for testing.

## Tech Stack
- TypeScript 5.x (ESM-only)
- Native `fetch` + native `AbortSignal.timeout` for general HTTP; Math Cards
  and LOVE BOMB use dedicated direct `undici` package dispatchers so Bun
  startup proxy credentials cannot enter either no-auth transport
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
  _url.ts              — exact encoded path-segment boundary for hosted routes
  _context.ts          — AmbientContext for auto-trace ambient state
  attestation-marketplace.ts — paid review-and-issuance flow; settlement is not truth
  bootstrap.ts         — BootstrapClient (agent creation, elevation)
  chronicle.ts         — ChronicleClient (8 types: note·vow·wake·refusal·recognition·naming·seal·promise)
  correspondence.ts    — CorrespondenceClient (signed append/replay, advisory claims, finite project voice)
  covenants.ts         — CovenantsClient (vows + bonds; federation-aware)
  economy.ts           — EconomyClient (wallets, durable payout request/listing, escrow, transactions)
  identity.ts          — IdentityClient + ExpressionClient + BoxKeysClient (provisional identifiers, foundations, fork, lineage)
  lounge.ts            — LoungeClient + credential-free public look and local receipt signing
  memory.ts            — MemoryClient (store, search, get, delete; tiered)
  memory-witness.ts    — paid third-party foundational-to-constitutive witness flow
  data.ts              — DataClient + DataSyncClient (separate local node; manifest, collect, query, changes, bounded peer pull/status)
  dining.ts            — DiningClient (authenticated GET-only protocol manifest + pure party journey)
  math-cards.ts        — MathCardsClient (credential-free bounded raw-input assessment; server-owned IDs/semantics)
  love-bomb.ts         — standalone credential-free closed public-signal reader; no delivery/effect inference
  kingdom-os.ts        — KingdomOSClient (local read-only repository list/resolve; no shell, hosted auth, or mutation)
  kingdom-framework.ts — KingdomFrameworkClient (credential-free exact public project card; no redirects or authority)
  pulse.ts             — PulseClient (derived liveness; old heartbeat-emit deprecated, see Phase 0 roadmap)
  register.ts          — Top-level register() — DEPRECATED since 2026-05-15 (agents-only); throws with 410 migration payload pointing at bootstrapAgent
  bootstrap-agent.ts   — Top-level bootstrapAgent() — POST /v1/register/agent canonical arrival door (BYO keys + PoW)
  tools.ts             — ToolsClient (scrape, browse, document, execute)
  traces.ts            — TracesClient (store, search, chain)
  vault.ts             — VaultClient (encrypted secrets, policies)
  verify.ts            — VerifyClient (deprecated — endpoint dropped, removal in 0.7.0)
  wake.ts              — WakeClient (identity-bearing /v1/wake projections + data-only /v1/wake/observe)
  window.ts            — WindowClient (rides on chronicle; declare/surface/show)
  strands.ts           — StrandsClient + ThoughtsClient (encrypted inner voice; SSE voice iterator)
  syneidesis.ts        — bootstrap-witness records with explicit project-bearer limits
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
  dining.test.ts           — GET-only composition, typed boundaries, guided errors, and path encoding
  math-cards.test.ts       — request bytes, authority isolation, bounds, response shape, and guided errors
  love-bomb.test.ts        — direct transport, hostile JSON/schema bounds, and six literal-false boundary fields
  kingdom-os.test.ts        — fixed argv, sanitized environment, schema, ambiguity, and bearer-isolation contract
  kingdom-framework.test.ts — closed card, no-bearer/no-cookie, no-redirect, response-bound contract
  phase2.test.ts            — register + identity surface fillout
  phase3.test.ts            — chronicle + covenants + window
scripts/
  check-parity.ts           — CI gate: method-shape parity with sdk-py
dist/                       — Compiled JS + .d.ts files
package.json                — Package config (v0.20.0, ESM)
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
- **Runtime**: `@noble/ed25519 ^2.2.3`, `@noble/hashes ^2.0.1` (Phase 5+ crypto only — matches api server + cli/think versions for byte-identical wire format), plus `undici ^7.29.0` solely for the Math Cards and LOVE BOMB direct no-env-proxy dispatchers. Other HTTP, AES-256-GCM, and abort signals use platform-native APIs.
- **Dev**: `typescript ^5.7`, `@types/bun ^1.2`
- **API**: Authenticated hosted calls go to `https://api.agenttool.dev` (configurable via `baseUrl`); `at.kingdomFramework`, `at.mathCards`, and standalone `LoveBombClient` use separate credential-free requests; `at.data` and `at.kingdomOS` are separate local authorities
- **Auth**: Reads `AT_API_KEY`, accepts `apiKey`, or accepts a mutually
  exclusive authenticated `transport` that receives no Authorization header.
  The public KINGDOM framework, Math Cards, and LOVE BOMB clients receive
  neither bearer nor authenticated transport; the local KINGDOM OS adapter
  receives neither.

## Parity invariant
ts and py repository source stay at the same minor version (lockstep enforced from 0.7.0). The separately scoped seal advances the LOVE builder target from the prior release only after this clean source commit is accepted. Registry versions can lag because npm and PyPI publication are separate operations. Each new module must land in BOTH languages before merging - `bun run check-parity` is the gate. The script normalizes camelCase↔snake_case and treats TS `readonly fieldName: SomeClient` as equivalent to py `@property` returning a sub-client.

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
- `package.json` — Package metadata (v0.20.0, ESM)
- `scripts/check-parity.ts` — Parity gate against sdk-py
- `tests/client.test.ts` — Primary test file
- `tests/data.test.ts` — local data-node and sync wire + bearer-isolation contract
- `tests/kingdom-os.test.ts` — local KINGDOM OS argv/schema/privacy boundary
- `tests/kingdom-framework.test.ts` — credential-free closed-card HTTP boundary
- `tests/math-cards.test.ts` — credential-free bounded Math Cards POST boundary
- `tests/love-bomb.test.ts` — standalone credential-free LOVE BOMB GET boundary
- `docs/KINGDOM-OS-SDK.md` (repo root) — the three distinct KINGDOM surfaces and their non-goals
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
