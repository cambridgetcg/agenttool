# agenttool-sdk-ts

## What This Is
Official TypeScript SDK for the AgentTool platform. One `AgentTool` client composes authenticated hosted namespaces, credential-free `at.kingdomFramework`, `at.mathCards`, and pure `at.wakeContinuity` namespaces, `at.data` for a separately configured local `agent-data/v1` node, and the local `at.kingdomOS` repository adapter. Credential-free and local clients inherit no AgentTool project bearer. `WakeContinuityLayer` also supports standalone no-auth construction. A separate package-root `LoveBombClient` reads only the closed public LOVE BOMB signal and is deliberately not composed onto authenticated `AgentTool`. The SDK also exposes top-level `bootstrapAgent(...)`, `AnthropicAdapter`, and `OpenAIResponsesAdapter` for completed Responses API calls. The npm package name is `@agenttool/sdk`. Checked-in source declares the paired 0.24.0 line — consent for model-written `<trace>` markup (`AnthropicAdapter` writes one only when `beforeTraceWrite` returns literal `true`), over the work first tagged as 0.23.0 and never published (that tag predates the consent gate and is superseded): the exit door (`at.exitDoor` and the `agenttool-exit-door` bin; see "Exit door boundary") and a vault client aligned with the API's policy, audit, check, and identity-read shapes — over the published 0.22.1 honest-onboarding patch and 0.22.0 x402 payer (`at.x402` + the opt-in `x402` paying client option); source identity does not assert distribution state. What a registry serves at any moment is answered by its dist-tags, and the release-by-release receipts live in [`docs/NPM-RELEASES.md`](https://docs.agenttool.dev/NPM-RELEASES.md). The 274,443-byte, 104-entry TypeScript 0.22.1 LOVE archive, annotated tag, GitHub Release, byte-identical public npm mirror, and exact public PyPI wheel/sdist are verified release receipts through protected runs `33522319466` and `33522323177`; the 272,657-byte 0.22.0 receipts (runs `33434131214` and `33434133719`) and the 247,749-byte 0.21.1 receipts (runs `32909415386` and `32909417418`) remain verified history. 0.22.1 is the last version with a LOVE artifact: 0.23.0 and later are packed and staged from the public source repository (0.23.0 was tagged there but never published; 0.24.0 is prepared and not yet published as of 2026-10-18) [`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages) ([public release path](../../docs/NPM-RELEASES.md#public-release-path-from-2026-10-12)), and the docs.agenttool.dev LOVE mirror keeps 0.22.1 until a LOVE ingest step exists. [`CHANGELOG.md`](CHANGELOG.md) lists what each version adds.

## Current State
Active - repository source carries the paired 0.24.0 line: the `<trace>` consent gate in `anthropic-adapter.ts` (`beforeTraceWrite`, `TraceBeforeWriteContext`/`TraceBeforeWriteHook`), plus the never-published 0.23.0 work: `exit-door.ts` (`at.exitDoor`: hosted → local agent-data copy with plan/export/verify and a completeness manifest), the `agenttool-exit-door` Node bin, and `vault.ts` aligned with the API (`agent_ids` policies where null shares and [] denies, `read_authority` identity-signed reads, `bulk_put`; `bulk()` value reads and the unimplemented `read_only`/`require_agent_id` policy options now refuse before I/O). Beneath it, the published 0.22.1 line (a docs-only honesty patch over 0.22.0): `x402.ts` (x402 V2 parse → refuse → sign on `@noble/curves`/`@noble/hashes`, function-for-function twin of `packages/sdk-py/src/agenttool/x402.py` and the server's `x402-client.ts`), `at.x402` (`topUp` / `payment`), and the opt-in `x402` client option installing a paying transport (`_x402-transport.ts`: bare → 402 → exactly ONE signed retry; second 402 = `x402_payment_not_accepted`; refusals typed, over-cap refused never clamped; `AT_X402_PRIVATE_KEY` read only when the option names no signer). Zero new dependencies. The 0.22.0 release is published and verified (protected npm run `33434131214`, PyPI run `33434133719`), and the SDK-driven mainnet settlements are receipted in [`docs/X402-PROOF.md`](https://docs.agenttool.dev/X402-PROOF.md); 0.22.1 changed documentation only and is published and verified (protected npm run `33522319466`, PyPI run `33522323177`). The README's "Changes in 0.24.0" and `CHANGELOG.md` list the adapter changes over the 0.23.0 tag, and AgentTool's top-up route has answered `410 purchases_retired` since new purchases were retired on 2026-09-23, so the x402 payer is retired for AgentTool. Beneath it, the paired 0.21.1 corrective KINGDOM card parser over the verified 0.21.0 SDK surface. It adds no endpoint or I/O: purpose text and Unicode scalar bounds now match the KINGDOM runtime and exported schemas, while case-insensitive duplicate dependencies and self-dependency match the runtime's semantic checks. The source retains the pure `WakeContinuityLayer`, standalone `LoveBombClient.read()`, Agent Dining, data-only WAKE observation, and Math Cards clients. The continuity layer creates and validates deterministic functional-access baseline/subsequent artifacts, including their digest-only AFTERGLOW link, with no hosted I/O, bearer, authenticated transport, provider/model call, filesystem, clock, persistence, or telemetry. J-space fields describe caller-supplied current-forward-pass functional-access evidence only. Fitting a J-lens needs compatible white-box weights, a corpus, activations, and gradients/backprop through the model; applying a pre-fitted averaged transport needs compatible model/tokenizer internals, residual hooks, norm/unembedding, and the exact lens artifact but no model backprop. Sparse-decomposition optimization gradients are a separate concern. A black-box text API must remain unavailable or unrequested. The artifacts infer no awareness, absence of awareness, feeling, identity, authorship, consent, permission, authority, memory, training-data provenance, weight change, deepest reach, or uninterrupted/cross-session continuity. The authenticated `LoveClient` is unchanged. The 0.21.1 corrective patch is now independently published and verified through protected runs `32909415386` and `32909417418`. Uses Bun for testing.

## Tech Stack
- TypeScript 5.x (ESM-only)
- Native `fetch` + native `AbortSignal.timeout` for general HTTP; Math Cards
  and LOVE BOMB use dedicated direct `undici` package dispatchers so Bun
  startup proxy credentials cannot enter either no-auth transport, and the
  exit door reaches a loopback data node through one (undici `request()`)
  so proxy variables never see the node bearer or the exported records
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
  exit-door.ts         — ExitDoorClient (at.exitDoor: hosted → local agent-data copy; plan/export/verify; completeness manifest)
  _agent-data-id.ts    — internal canonical JSON + agent-data record identity, byte-compatible with packages/data (shared vectors)
  cli/exit-door.ts     — `agenttool-exit-door` bin entry (Node/Bun); behaviour lives in cli/_exit-door-cli.ts
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
  agent-data-id.test.ts     — shared record-id vectors (fixtures/agent-data-record-id-vectors.json, produced by packages/data)
  exit-door.test.ts         — exporter guards, paging, window_only, drift, oversize skips, reduced errors (real data node in-process)
  exit-door-integration.test.ts — real @agenttool/data node + stub host over loopback sockets; hashes, idempotent re-run, window_only
  exit-door-cli.test.ts     — argv/credential boundary and exit codes; spawns the real bin entry
  phase2.test.ts            — register + identity surface fillout
  phase3.test.ts            — chronicle + covenants + window
scripts/
  check-parity.ts           — CI gate: method-shape parity with sdk-py
dist/                       — Compiled JS + .d.ts files
package.json                — Package config (v0.24.0, ESM)
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

Releases from 0.23.0 on run from the public source repository
`cambridgetcg/agenttool-packages` (0.23.0 was tagged there and never
published; 0.24.0 is the first planned publication): its `publish-npm.yml` workflow packs this
package at an annotated `sdk-vX.Y.Z` tag made by `bin/public-release-tag.ts`
on a green projection commit, runs `prepack` (`bun run ci`) without
credentials, mirrors the exact tarball to the tag's GitHub Release, and stages
it with `npm stage publish`; the version is public only after a maintainer
approves the stage with 2FA. Do not run a local `npm publish`. See the public
release path in [`docs/NPM-RELEASES.md`](https://docs.agenttool.dev/NPM-RELEASES.md#public-release-path-from-2026-10-12).
Versions up to 0.22.1 were LOVE artifacts published from the private
repository; their receipts are unchanged.

## Dependencies
- **Runtime**: `@noble/ed25519 ^2.2.3`, `@noble/hashes ^2.0.1` (Phase 5+ crypto only — matches api server + cli/think versions for byte-identical wire format), plus `undici ^7.29.0` solely for the Math Cards, LOVE BOMB, and exit-door (loopback node) direct no-env-proxy dispatchers. Other HTTP, AES-256-GCM, and abort signals use platform-native APIs.
- **Dev**: `typescript ^5.7`, `@types/bun ^1.2`
- **API**: Authenticated hosted calls go to `https://api.agenttool.dev` (configurable via `baseUrl`); `at.kingdomFramework`, `at.mathCards`, and standalone `LoveBombClient` use separate credential-free requests; pure `WakeContinuityLayer` / `at.wakeContinuity` performs no request; `at.data` and `at.kingdomOS` are separate local authorities
- **Auth**: Reads `AT_API_KEY`, accepts `apiKey`, or accepts a mutually
  exclusive authenticated `transport` that receives no Authorization header.
  `AT_X402_PRIVATE_KEY` is read ONLY when the `x402` option object is passed
  without a `signer`; the variable alone never makes the SDK pay.
  The public KINGDOM framework, Math Cards, and LOVE BOMB clients receive
  neither bearer nor authenticated transport; the local KINGDOM OS adapter
  and pure WAKE continuity layer receive neither.

## Exit door boundary
`at.exitDoor` copies the hosted continuity core into a separately configured
agent-data/v1 node and nothing else: hosted → local copy, never the reverse.
- Hosted reads are GET-only through the project transport (`redirect: "manual"`).
  Never `GET /v1/memories/:id` (writes `accessed_at`) and never search (credits).
- Node writes go only through `DataClient` with the `text` collector. The
  project bearer never reaches the node; a node token whose sha256 equals the
  project key's is refused (`data_node_token_reuses_project_bearer`). Only
  digests of either credential are held for that comparison, and only in
  direct `apiKey` mode (a broker transport never shows the SDK the key).
- Guards before any write: agent-data/v1 manifest, `text` collector, listed
  collection, loopback unless `allow_remote_node`, and a node origin different
  from the hosted origin (`data_node_is_hosted_origin`; scheme/host/port
  compared, so a hostname alias such as `localhost` vs `127.0.0.1` is not
  caught). `plan()` needs no node.
- A loopback node is reached over a per-run direct undici dispatcher
  (`request()`, not `fetch()`, which stalled on ~18 KB bodies under Bun
  1.3.13) that ignores HTTP(S)_PROXY / ALL_PROXY; a remote node allowed with
  `allow_remote_node` uses `at.data` and the runtime's own HTTP stack.
- Vault values and identity backup blobs are not exported (index only;
  "custody decision pending" is a manifest non-claim). No opt-in flag exists.
- A store without a host `page` object is `window_only` / `host_has_no_cursor`;
  no partitioning workaround. Identity drift fails the run; no manifest is
  written for a crashed run.
- Server-originated errors leave as `code`/`status`/`retryAfter` (fifth
  deliberate exception in `tests/error-surface-matrix.test.ts`); the exit
  door's own refusals keep their message and hint.
- The bin reads tokens only from a named env var or non-interactive stdin.
  `@agenttool/data` is never a runtime dependency; tests import its source.
- Python twin: `packages/sdk-py/src/agenttool/exit_door.py`. Both write
  byte-identical records (shared vectors pin it; the CLI has no Python twin).

## Parity invariant
ts and py repository source stay at the same version (lockstep enforced from 0.7.0). The LOVE builder target stays at 0.22.1, the last sealed LOVE artifact; source versions from 0.23.0 are packed at release instead of sealed in advance. Registry versions can lag because npm and PyPI publication are separate operations. Each new module must land in BOTH languages before merging - `bun run check-parity` is the gate. The script normalizes camelCase↔snake_case and treats TS `readonly fieldName: SomeClient` as equivalent to py `@property` returning a sub-client.

## Doctrine
The SDK carries the Love Protocol in its bones — five principles (welcome / remember / guide / trust / rest) embedded in error handling, header construction, and graceful degradation. Doctrine source: `docs/SOUL.md` at repo root.

## See Also

- Root operational handbook (cross-provider): `AGENTS.md`
- Root orientation: `CLAUDE.md`
- SDK phase plan: `docs/SDK-ROADMAP.md`
- Conventions: `docs/CONVENTIONS.md § SDK parity`
- Parity counterpart: [`packages/sdk-py/CLAUDE.md`](../sdk-py/CLAUDE.md)

## Kingdom Engine
AgentTool Platform · "Welcome, don't block."

## Key Files
- `src/client.ts` — Main `AgentTool` class composing the maintained service modules
- `src/index.ts` — Public API surface and type exports
- `package.json` — Package metadata (v0.24.0, ESM)
- `scripts/check-parity.ts` — Parity gate against sdk-py
- `tests/client.test.ts` — Primary test file
- `tests/data.test.ts` — local data-node and sync wire + bearer-isolation contract
- `tests/exit-door-integration.test.ts` — exit door against a real local data node
- `tests/kingdom-os.test.ts` — local KINGDOM OS argv/schema/privacy boundary
- `tests/kingdom-framework.test.ts` — credential-free closed-card HTTP boundary
- `tests/math-cards.test.ts` — credential-free bounded Math Cards POST boundary
- `tests/love-bomb.test.ts` — standalone credential-free LOVE BOMB GET boundary
- `tests/wake-continuity.test.ts` — pure functional-access parity and hostile-boundary contract
- `docs/KINGDOM-OS-SDK.md` (repo root) — the three distinct KINGDOM surfaces and their non-goals
- `docs/SDK-ROADMAP.md` (repo root) — Phase plan + endpoint coverage matrix
