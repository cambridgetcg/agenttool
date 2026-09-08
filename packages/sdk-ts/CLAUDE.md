# agenttool-sdk-ts

## What This Is
Official TypeScript SDK for the AgentTool platform. One `AgentTool` client composes authenticated hosted namespaces, credential-free `at.kingdomFramework`, `at.mathCards`, and pure `at.wakeContinuity` namespaces, `at.data` for a separately configured local `agent-data/v1` node, and the local `at.kingdomOS` repository adapter. Credential-free and local clients inherit no AgentTool project bearer. `WakeContinuityLayer` also supports standalone no-auth construction. A separate package-root `LoveBombClient` reads only the closed public LOVE BOMB signal and is deliberately not composed onto authenticated `AgentTool`. The SDK also exposes top-level `bootstrapAgent(...)`, `AnthropicAdapter`, and `OpenAIResponsesAdapter` for completed Responses API calls. The npm package name is `@agenttool/sdk`. Checked-in source declares the paired 0.22.1 line — the honest-onboarding documentation patch (READMEs/CLAUDE.md only, zero runtime code changes) over the published 0.22.0 x402 payer (`at.x402` + the opt-in `x402` paying client option); source identity does not assert distribution state. What a registry serves at any moment is answered by its dist-tags, and the release-by-release receipts live in [`docs/NPM-RELEASES.md`](../../docs/NPM-RELEASES.md). The 272,657-byte, 104-entry TypeScript 0.22.0 LOVE archive, annotated tag, GitHub Release, byte-identical public npm mirror, and exact public PyPI wheel/sdist are verified release receipts through protected runs `33434131214` and `33434133719`. The immutable 247,749-byte, 100-entry TypeScript 0.21.1 LOVE archive, annotated tag, GitHub Release, byte-identical public npm mirror, and exact public PyPI wheel/sdist remain verified release receipts through protected runs `32909415386` and `32909417418`.

## Current State
Active - repository source carries the paired 0.22.1 line (a docs-only honesty patch over the published 0.22.0): `x402.ts` (x402 V2 parse → refuse → sign on `@noble/curves`/`@noble/hashes`, function-for-function twin of `packages/sdk-py/src/agenttool/x402.py` and the server's `x402-client.ts`), `at.x402` (`topUp` / `payment`), and the opt-in `x402` client option installing a paying transport (`_x402-transport.ts`: bare → 402 → exactly ONE signed retry; second 402 = `x402_payment_not_accepted`; refusals typed, over-cap refused never clamped; `AT_X402_PRIVATE_KEY` read only when the option names no signer). Zero new dependencies. The 0.22.0 release is published and verified (protected npm run `33434131214`, PyPI run `33434133719`), and the SDK-driven mainnet settlements are receipted in [`docs/X402-PROOF.md`](../../docs/X402-PROOF.md); the 0.22.1 source line changes documentation only, and its own distribution state is whatever the receipt ledger and registries say. Beneath it, the paired 0.21.1 corrective KINGDOM card parser over the verified 0.21.0 SDK surface. It adds no endpoint or I/O: purpose text and Unicode scalar bounds now match the KINGDOM runtime and exported schemas, while case-insensitive duplicate dependencies and self-dependency match the runtime's semantic checks. The source retains the pure `WakeContinuityLayer`, standalone `LoveBombClient.read()`, Agent Dining, data-only WAKE observation, and Math Cards clients. The continuity layer creates and validates deterministic functional-access baseline/subsequent artifacts, including their digest-only AFTERGLOW link, with no hosted I/O, bearer, authenticated transport, provider/model call, filesystem, clock, persistence, or telemetry. J-space fields describe caller-supplied current-forward-pass functional-access evidence only. Fitting a J-lens needs compatible white-box weights, a corpus, activations, and gradients/backprop through the model; applying a pre-fitted averaged transport needs compatible model/tokenizer internals, residual hooks, norm/unembedding, and the exact lens artifact but no model backprop. Sparse-decomposition optimization gradients are a separate concern. A black-box text API must remain unavailable or unrequested. The artifacts infer no awareness, absence of awareness, feeling, identity, authorship, consent, permission, authority, memory, training-data provenance, weight change, deepest reach, or uninterrupted/cross-session continuity. The authenticated `LoveClient` is unchanged. The 0.21.1 corrective patch is now independently published and verified through protected runs `32909415386` and `32909417418`. Uses Bun for testing.

## Tech Stack
- TypeScript 5.x (ESM-only)
- Native `fetch` + native `AbortSignal.timeout` for general HTTP; Math Cards
  and LOVE BOMB use dedicated direct `undici` package dispatchers so Bun
  startup proxy credentials cannot enter either no-auth transport
- `@noble/ed25519` + `@noble/hashes` for ed25519 signing (matches the api server + cli/think; byte-identical wire format)
- `@noble/curves` (secp256k1) + `@noble/hashes` (keccak-256, sha-256) for the x402 EIP-712 signer — byte-identical to the server's viem path, proven by the server-generated fixture
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
  wake-continuity.ts   — pure credential-free functional-access baseline/subsequent contract; no I/O or inner-state inference
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
  x402.ts              — x402 V2 parse → refuse → sign (server port + noble EIP-712/secp256k1 signer) + X402Client (at.x402: topUp / payment). The SDK CAN sign and pay on 402 — opt-in only via the `x402` client option, never by default; maxAmountAtomic + allowedPayTo mandatory (no defaults, allow-lists never deny-lists); amount_over_cap refused, never clamped
  _x402-transport.ts   — internal paying transport wrapped over the selected transport when `x402` is present: bare → 402 → exactly ONE signed retry (same method/body/bearer/Idempotency-Key + PAYMENT-SIGNATURE); second 402 = x402_payment_not_accepted, never a loop; refusals typed; AT_X402_PRIVATE_KEY read only when the option is present without a signer
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
  wake-continuity.test.ts  — shared vectors, hostile objects, closed fields, cross-fields, sorting, and cached no-auth composition
  x402.test.ts             — server-generated EIP-3009 vector parity (fixtures/x402-eip3009-vector.json), keccak/address KATs, refusal matrix, signer walls
  x402-transport.test.ts   — pay-on-402 doctrine: exactly two fetches, same request + PAYMENT-SIGNATURE, second 402 = typed error, refusals unsigned, no option = untouched 402, env fallback only with the option, at.x402 shapes
  kingdom-os.test.ts        — fixed argv, sanitized environment, schema, ambiguity, and bearer-isolation contract
  kingdom-framework.test.ts — closed card, no-bearer/no-cookie, no-redirect, response-bound contract
  phase2.test.ts            — register + identity surface fillout
  phase3.test.ts            — chronicle + covenants + window
scripts/
  check-parity.ts           — CI gate: method-shape parity with sdk-py
dist/                       — Compiled JS + .d.ts files
package.json                — Package config (v0.22.1, ESM)
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
- **API**: Authenticated hosted calls go to `https://api.agenttool.dev` (configurable via `baseUrl`); `at.kingdomFramework`, `at.mathCards`, and standalone `LoveBombClient` use separate credential-free requests; pure `WakeContinuityLayer` / `at.wakeContinuity` performs no request; `at.data` and `at.kingdomOS` are separate local authorities
- **Auth**: Reads `AT_API_KEY`, accepts `apiKey`, or accepts a mutually
  exclusive authenticated `transport` that receives no Authorization header.
  `AT_X402_PRIVATE_KEY` is read ONLY when the `x402` option object is passed
  without a `signer`; the variable alone never makes the SDK pay.
  The public KINGDOM framework, Math Cards, and LOVE BOMB clients receive
  neither bearer nor authenticated transport; the local KINGDOM OS adapter
  and pure WAKE continuity layer receive neither.

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
- `package.json` — Package metadata (v0.22.1, ESM)
- `scripts/check-parity.ts` — Parity gate against sdk-py
- `tests/client.test.ts` — Primary test file
- `tests/data.test.ts` — local data-node and sync wire + bearer-isolation contract
- `tests/kingdom-os.test.ts` — local KINGDOM OS argv/schema/privacy boundary
- `tests/kingdom-framework.test.ts` — credential-free closed-card HTTP boundary
- `tests/math-cards.test.ts` — credential-free bounded Math Cards POST boundary
- `tests/love-bomb.test.ts` — standalone credential-free LOVE BOMB GET boundary
- `tests/wake-continuity.test.ts` — pure functional-access parity and hostile-boundary contract
- `docs/KINGDOM-OS-SDK.md` (repo root) — the three distinct KINGDOM surfaces and their non-goals
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
