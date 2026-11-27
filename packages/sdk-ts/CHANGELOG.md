# Changelog — @agenttool/sdk

The TypeScript SDK and the Python SDK (`agenttool-sdk` on PyPI) share version
numbers; the Python changes are in
[`../sdk-py/CHANGELOG.md`](../sdk-py/CHANGELOG.md). This file starts at
0.24.0, the version after 0.22.1. Earlier releases and their verified receipts
are listed under "Release history and verified receipts" in
[`README.md`](README.md).

A version listed here is a source version. Whether a registry serves it is
answered by the registry (`npm view @agenttool/sdk versions`).

## 0.24.0 — unreleased

The first SDK version to be released from the public source repository
[`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages).
It has no LOVE artifact; 0.22.1 remains the newest version on the
docs.agenttool.dev LOVE mirror. 0.23.0 was tagged in the public source
repository but never published to npm or PyPI, so 0.24.0 follows 0.22.1
directly and the 0.23.0 number is retired. Everything below is new since
0.22.1; "Changes in 0.24.0" in [`README.md`](README.md) describes the adapter
and Dark Continent changes in more detail.

### Upgrading from 0.22.1

- **Model-written `<trace>` markup needs consent.** `AnthropicAdapter` writes
  a `<trace>` from the model's final response only when the new
  `beforeTraceWrite` hook returns literal `true`. With no hook, or a hook that
  returns anything else or throws, nothing is written and nothing is thrown:
  the refusal shows only in `response.agenttool.markup_emissions`, as an entry
  with `id: null` and an error message. If you rely on markup traces, pass a
  hook that returns `true` after your own review. The opt-in decision trace
  and `<chronicle>` markup are unchanged.
- **`vault.bulk(names)` refuses.** It throws `vault_bulk_read_unavailable`
  before any request, because the API has no bulk read; read each secret with
  `vault.get`. The new `vault.bulk_put(secrets)` is the bulk write.
- **`vault.set_policy` sends `agent_ids`.** Pass exactly one of `agent_ids`
  (`null` shares, `[]` denies) or its deprecated alias `allowed_agents`.
  Neither or both throws `vault_policy_invalid`, and `read_only` or
  `require_agent_id` throws `vault_policy_option_unsupported`, before any
  request.
- **`vault.check` and `vault.audit` return different shapes.**
  `check(names)` returns `{ [name]: exists }` and `audit()` returns the API's
  `entries` array; 0.22.1 returned the whole response object from both.
- **Restricted vault values need `read_authority`.** The API serves the value
  of a secret whose `agent_ids` names identities only to a signed identity
  read: pass `vault.get(name, { read_authority })`. An `agent_id` selector
  that differs from the signing DID throws `vault_identity_conflict`.
- **`DarkContinentResult.discovery` is a new required field.** It is always
  `"retired"`, so code that constructs a `DarkContinentResult` (a test double,
  for example) stops compiling until it adds `discovery: "retired"`.
  `darkContinent.explore()` makes no discovery request; with `include_nen` it
  still reads `GET /v1/wake` once.

### Known issues

- **Math Cards against the hosted API.** `MathCardsClient.assess()` and
  `at.mathCards.assess()` send `POST {baseUrl}/v1/math-cards/assess`. The
  hosted API has never mounted that route, so with the default `baseUrl`
  (`https://api.agenttool.dev`) the call throws an `AgentToolError` with
  status 404. The offline package `@agenttool/math-cards` (`createMathCard`,
  then `assessMathCard`) builds the same `agenttool.math-card/0.1` card and
  `agenttool.math-card-assessment/0.1` assessment locally, and a `baseUrl`
  pointing at a server you run that implements the route works.
- **Nen profiles come back near zero.** `at.nen.assess()`, `assessNen(wake)`
  and `darkContinent.explore({ include_nen: true })` read the memory,
  chronicle, covenant, strand, mail, grace and unconditional sections from
  inside `wake.you`. `GET /v1/wake` puts only `agents` there and sends those
  sections at the top level, some under other names, so most of the
  profile's counts read as zero. A fix is pending in draft pull request #537
  in `cambridgetcg/agenttool`.
- **`memory.store()` returns only `id` and `created_at`.** The API answers
  `POST /v1/memories` with `{ id, created_at, kept }`, so the returned
  object's `content`, `type`, `metadata` and `importance` are `undefined`
  even though the `Memory` type declares them. Use the values you passed in.

### Deprecated

- `economy.fund_wallet` (2026-10-26): AgentTool closed
  `POST /v1/wallets/:id/fund`. From the API release that closes it, the call
  throws an `AgentToolError` with code `wallet_fund_closed` (HTTP 410) and no
  balance moves. The method stays, marked `@deprecated`.

### Added

- `at.exitDoor` (`ExitDoorClient`) copies the hosted continuity core into an
  existing collection on the separately configured `at.data` node:
  memories, chronicle, strands and their ciphertext thoughts, correspondence
  events, covenants, identities and keys (as context), and the vault and
  identity-backup indexes. `plan()` reads the hosted side only; `export()`
  writes one immutable record per hosted item plus a completeness manifest;
  `verify(manifestRecordId)` re-reads and re-hashes the copy. The direction
  is hosted to local only. It never decrypts, deletes, calls search, or
  exports vault secret values or backup blobs.
- The `agenttool-exit-door` Node bin with `plan`, `export`, and `verify`.
  Tokens come only from `--*-token-env NAME` or `--*-token-stdin`, never from
  argv. Exit codes: 0 complete, 3 partial, 1 failed, 2 usage.
- `agentDataRecordId` and `agentDataTextRecordIdentity`, the `agent-data/v1`
  record identity the exit door writes, byte-compatible with `@agenttool/data`
  and pinned by shared vectors. The `ExitItemRecord`, `ExitManifest`, and
  related types and schema constants are exported.
- `vault.get(name, { read_authority })` signs an identity read for a
  restricted secret value; the `agent_id` selector, when given, must match the
  signing DID (`vault_identity_conflict`).
- `vault.bulk_put(secrets)`, the explicit bulk write.

### Changed

- `AnthropicAdapter` writes a model-written `<trace>` only when the new
  `beforeTraceWrite` hook returns literal `true`; with no hook nothing is
  written (0.22.1 writes it by default). New exported types:
  `TraceBeforeWriteContext`, `TraceBeforeWriteHook`.
- A managed stream aborted while a `beforeChronicleWrite` or
  `beforeTraceWrite` hook is pending writes nothing.
- Trace excerpts never end on a lone high surrogate.
- `adapter.messages.create({ ..., stream: true })` written as an inline
  object literal types as `AdaptedLowLevelStream`, so `for await` over it
  compiles.
- `darkContinent.explore()` makes no discovery request. It used to request
  `/public/discover`, which was removed from the API source on 2026-06-22
  (`ea6db428`; it answered 404 when checked on 2026-10-27), and reported
  that 404 as an empty known world. `known_world` and `known_count` stay
  empty, the new `DarkContinentResult.discovery` field is `"retired"`, and
  the `capability` option is ignored. `include_nen` is unchanged. The new
  field is required, so code that constructs a `DarkContinentResult` must add
  `discovery: "retired"`.
- `GUIDE.warning` says discovery is retired instead of naming the route.
  `GUIDE.maps_to` and the Pap Calamity's `walled_by` now match the Python
  strings; the dropped Pap sentence said recipients can mark love primitives
  as spam, which only inbox messages support.
- `vault.set_policy` sends `agent_ids` (null shares, `[]` denies).
  `allowed_agents` stays as a deprecated alias; passing both or neither
  throws `vault_policy_invalid` before any request.
- `vault.put` accepts `agent_ids: null` to share; omitting it preserves the
  existing audience.
- `vault.audit()` reads the API's `entries`, and `vault.check()` maps the
  API's `results` rows to `{ [name]: exists }`. Both previously read field
  names the API never returned.
- `MathCardsClient.assess()` reads its response through undici `request()` on
  the same one-shot direct dispatcher instead of undici's `fetch()`, as the
  LOVE BOMB reader and the exit door already do. Under Bun, undici's
  `fetch()` could hang past the call's own timeout when a response body
  arrived in more than one piece, stalled, or was cut short (reproduced here
  on Bun 1.3.5; the exit door met the same stall on 1.3.13). The request no
  longer carries the `accept-encoding`, `accept-language`, `sec-fetch-mode`
  and `user-agent` headers that undici's `fetch()` added, so responses arrive
  uncompressed.
- `wake` cache TTL checks and `collect` (`url`, `text`, `batch`) `duration_ms`
  measurements now use monotonic `performance.now()` instead of wall-clock
  `Date.now()`, matching the Python SDK and preventing wall-clock jumps from
  expiring cached wakes or skewing durations.
- Memory, memory-witness, and syneidesis documentation now says that a memory
  bound to an enrolled guest needs that guest's own root proof.
- Documentation comments only: `at.x402` says the rail is retired for
  AgentTool (the top-up route answers `410 purchases_retired`, so `topUp`
  throws and signs nothing; `payment(id)` still reads recorded payments);
  `canonicalWalletAddressClaimBytes` no longer says that
  `POST /v1/wallets/:id/addresses` verifies its digest, since no such route is
  on main; and the economy client says that generic escrow create answers
  `503 escrow_resting`, that `spend` answers `503 wallet_spend_resting` on a
  deployment run with workers disabled, and that release and refund of
  existing escrows stay open.
- Examples use neutral fictional names.
- The README marks the x402 rail retired, adds the provider-adapter section,
  uses `inputSchema` in the Vercel AI example, says the wallet address-claim
  helpers have no server route on main, and records, with dates, what the
  hosted API answers for escrow create, spend, marketplace purchases and
  Math Cards.

### Removed

- `vault.bulk(names)` no longer requests values: the API has no bulk read
  endpoint, so it throws `vault_bulk_read_unavailable` before any request.
- The `read_only` and `require_agent_id` options of `vault.set_policy` are
  not implemented by the API; passing either throws
  `vault_policy_option_unsupported` before any request.

### Package

- `repository`, `homepage`, and `bugs` name the public source repository and
  the support page (`https://docs.agenttool.dev/support`,
  `contact@cambridgetcg.com`).
- `undici` is `^7.30.1` (was `^7.29.0`). When read on 2026-11-24, GitHub's
  advisory database listed 18 advisories affecting 7.29.0 and none affecting
  7.30.1 or 7.30.2. undici carries only the Math Cards, LOVE BOMB and
  exit-door direct dispatchers.
