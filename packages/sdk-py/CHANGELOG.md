# Changelog — agenttool-sdk

The Python SDK and the TypeScript SDK (`@agenttool/sdk` on npm) share version
numbers; the TypeScript changes are in
[`../sdk-ts/CHANGELOG.md`](../sdk-ts/CHANGELOG.md). This file starts at
0.24.0, the version after 0.22.1. Earlier releases and their verified receipts
are listed under "Release history and verified receipts" in
[`README.md`](README.md).

A version listed here is a source version. Whether PyPI serves it is answered
by PyPI (`https://pypi.org/project/agenttool-sdk/`).

## 0.24.0 — unreleased

The first SDK version to be released from the public source repository
[`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages).
0.23.0 was tagged in the public source repository but never published to npm
or PyPI, so 0.24.0 follows 0.22.1 directly and the 0.23.0 number is retired.
Everything below is new since 0.22.1; "Changes in 0.24.0" in
[`README.md`](README.md) describes the adapter and Dark Continent changes in
more detail.

### Upgrading from 0.22.1

- **Model-written `<trace>` markup needs consent.** `AnthropicAdapter` writes
  a `<trace>` from the model's final response only when the new
  `before_trace_write` hook returns literal `True`. With no hook, or a hook
  that returns anything else or raises, nothing is written and nothing is
  raised: the refusal shows only in `response.agenttool.markup_emissions`, as
  an entry with `id=None` and an error message. If you rely on markup traces,
  pass a hook that returns `True` after your own review. The opt-in decision
  trace and `<chronicle>` markup are unchanged.
- **`AnthropicAdapter` refuses asynchronous clients.** Construction raises
  `AgentToolError` (`anthropic_async_client_unsupported`) when
  `messages.create` is a coroutine function, which covers `AsyncAnthropic`;
  pass a synchronous `anthropic.Anthropic`. 0.22.1 accepted an async client
  and sent no provider request.
- **`vault.bulk(names)` refuses.** It raises `vault_bulk_read_unavailable`
  before any request, because the API has no bulk read; read each secret with
  `vault.get`. The new `vault.bulk_put(secrets)` is the bulk write.
- **`vault.set_policy` sends `agent_ids`.** Pass exactly one of `agent_ids=`
  (`None` shares, `[]` denies) or its deprecated alias `allowed_agents=`.
  Neither or both raises `vault_policy_invalid`, and `read_only=` or
  `require_agent_id=` raises `vault_policy_option_unsupported`, before any
  request.
- **An explicit `agent_ids=None` now shares the secret.** `vault.put(...)` and
  `vault.put_encrypted(...)` send `agent_ids: null`, which makes the secret
  readable across the project; on a secret restricted to identities this
  widens access. 0.22.1 did not send an explicit `None`, so the existing
  audience stayed. Omit `agent_ids` to keep the current audience.
- **`vault.check` and `vault.audit` return different shapes.**
  `check(names)` returns `{name: exists}` and `audit()` returns the API's
  `entries` list; 0.22.1 returned the whole response dict from both.
- **Restricted vault values need `read_authority=`.** The API serves the value
  of a secret whose `agent_ids` names identities only to a signed identity
  read: pass `vault.get(name, read_authority={...})`. An `agent_id` selector
  that differs from the signing DID raises `vault_identity_conflict`.
- **Timestamps carry milliseconds.** `collect` writes `collected_at` (`url`,
  `text`) and `enriched_at` (`enrich`) into memory metadata, and
  `identity.issue_token()` returns `expires_at`, as canonical 24-character UTC
  (`YYYY-MM-DDTHH:MM:SS.sssZ`) instead of the 20-character
  `YYYY-MM-DDTHH:MM:SSZ`. Code that parses the old form must accept
  milliseconds.
- **httpx 0.28 or later.** The dependency floor rose from `httpx>=0.27` to
  `httpx>=0.28`; an environment pinned to httpx 0.27 must upgrade it.
- **`OpenAIResponsesAdapter` sends `store=False` for omission sentinels.** The
  `openai` package's `NOT_GIVEN` / `omit` now count as an omitted `store`,
  which the adapter sends as `False`; in 0.22.1 they dropped `store` and the
  provider default applied. Pass `store=True` to keep provider-side storage.

### Known issues

- **Math Cards against the hosted API.** `MathCardsClient.assess()` and
  `at.math_cards.assess()` send `POST {base_url}/v1/math-cards/assess`. The
  hosted API has never mounted that route, so with the default `base_url`
  (`https://api.agenttool.dev`) the call raises an `AgentToolError` with
  status 404. The offline npm package `@agenttool/math-cards` (JavaScript;
  `createMathCard`, then `assessMathCard`) builds the same
  `agenttool.math-card/0.1` card and `agenttool.math-card-assessment/0.1`
  assessment locally, and a `base_url` pointing at a server you run that
  implements the route works.
- **Nen profiles come back near zero.** `at.nen.assess()`, `assess_nen(wake)`
  and `dark_continent.explore(include_nen=True)` read the memory, chronicle,
  covenant, strand, mail, grace and unconditional sections from inside
  `wake["you"]`. `GET /v1/wake` puts only `agents` there and sends those
  sections at the top level, some under other names, so most of the
  profile's counts read as zero. A fix is pending in draft pull request #537
  in `cambridgetcg/agenttool`.
- **`memory.store()` returns only `id` and `created_at`.** The API answers
  `POST /v1/memories` with `{id, created_at, kept}`, so the returned `Memory`
  holds the defaults `content=""`, `type="semantic"`, `importance=0.5` and
  `metadata={}` rather than what was stored. Use the values you passed in.

### Added

- `at.exit_door` (`ExitDoorClient`) copies the hosted continuity core into an
  existing collection on the separately configured `at.data` node:
  memories, chronicle, strands and their ciphertext thoughts, correspondence
  events, covenants, identities and keys (as context), and the vault and
  identity-backup indexes. `plan()` reads the hosted side only; `export()`
  writes one immutable record per hosted item plus a completeness manifest;
  `verify(manifest_record_id)` re-reads and re-hashes the copy. The direction
  is hosted to local only. It never decrypts, deletes, calls search, or
  exports vault secret values or backup blobs. Records are byte-identical to
  the TypeScript exporter's, pinned by shared vectors. The
  `agenttool-exit-door` command ships with the TypeScript package only.
- `agent_data_record_id` and `agent_data_text_record_identity`, the
  `agent-data/v1` record identity the exit door writes, plus the
  `exit_item_record` helper and `EXIT_*` schema constants.
- `vault.get(name, read_authority=...)` signs an identity read for a
  restricted secret value; the `agent_id` selector, when given, must match
  the signing DID (`vault_identity_conflict`).
- `vault.bulk_put(secrets)`, the explicit bulk write.

### Changed

- `AnthropicAdapter` writes a model-written `<trace>` only when the new
  `before_trace_write` hook returns literal `True`; with no hook nothing is
  written (0.22.1 writes it by default). New exports:
  `TraceBeforeWriteContext`, `TraceBeforeWriteHook`.
- `AnthropicAdapter` refuses asynchronous clients (`AsyncAnthropic`) at
  construction with `anthropic_async_client_unsupported`.
- Trace limits count UTF-16 units, as the server does, and never split a
  character.
- `OpenAIResponsesAdapter` accepts any mapping as `metadata` and treats the
  `openai` package's `NOT_GIVEN` / `omit` as an omitted `store` (sent as
  `False`).
- `dark_continent.explore()` makes no discovery request and no longer opens
  its own anonymous `httpx.Client`. It used to request `/public/discover`,
  which was removed from the API source on 2026-06-22 (`ea6db428`; it
  answered 404 when checked on 2026-10-27), and reported that 404 as an
  empty known world. `known_world` and `known_count` stay empty, the result
  carries `"discovery": "retired"`, and `capability=` is ignored.
  `include_nen=True` is unchanged.
- `GUIDE["warning"]` says discovery is retired instead of naming the route.
- `identity.issue_token()` `expires_at` and `collect` (`url`, `text`, `enrich`)
  `collected_at`/`enriched_at` now emit canonical 24-char UTC with millisecond
  precision (`YYYY-MM-DDTHH:MM:SS.sssZ`), matching `@agenttool/sdk` (the signed
  JWT `header.payload` bytes in `issue_token()` are unchanged). `collect`
  `duration_ms` measurements now use `time.monotonic()` instead of wall-clock
  `time.time()`.
- `vault.set_policy` sends `agent_ids` (None shares, `[]` denies).
  `allowed_agents` stays as a deprecated alias; passing both or neither
  raises `vault_policy_invalid` before any request.
- `vault.put`: omitting `agent_ids` preserves the existing audience, and an
  explicit `agent_ids=None` now shares the secret. In 0.22.1 an explicit
  None was not sent.
- `vault.audit()` reads the API's `entries`, and `vault.check()` maps the
  API's `results` rows to `{name: exists}`. Both previously read field names
  the API never returned.
- `AuthenticationError` and `RateLimitError` link to the live documentation
  anchors (`/errors#auth` and `/economy#business-model`).
- Memory, memory-witness, and syneidesis documentation now says that a
  memory bound to an enrolled guest needs that guest's own root proof.
- Documentation comments only: `at.x402` says the rail is retired for
  AgentTool (the top-up route answers `410 purchases_retired`, so `top_up`
  raises and signs nothing; `payment(id)` still reads recorded payments);
  `canonical_wallet_address_claim_bytes` no longer says that
  `POST /v1/wallets/:id/addresses` verifies its digest, since no such route is
  on main; and the economy client says that generic escrow create answers
  `503 escrow_resting`, that `spend` answers `503 wallet_spend_resting` on a
  deployment run with workers disabled, and that release and refund of
  existing escrows stay open.
- The packaged `SOUL.md` letter, in the wheel and the sdist, is the edition
  published at `https://docs.agenttool.dev/SOUL.md`.
- Examples use neutral fictional names.
- The README marks the x402 rail retired, adds the provider-adapter section,
  says the wallet address-claim helpers have no server route on main, and
  records, with dates, what the hosted API answers for escrow create, spend,
  marketplace purchases and Math Cards.

### Removed

- `vault.bulk(names)` no longer requests values: the API has no bulk read
  endpoint, so it raises `vault_bulk_read_unavailable` before any request.
- The `read_only` and `require_agent_id` arguments of `vault.set_policy` are
  not implemented by the API; passing either raises
  `vault_policy_option_unsupported` before any request.

### Package

- The `Repository`, `Homepage`, `Issues`, and `Changelog` project URLs name
  the public source repository
  [`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages)
  and the support page `https://docs.agenttool.dev/support`.
- The sdist no longer carries a second copy of `SOUL.md` at its root. Its
  letter is `src/agenttool/SOUL.md`, the one the wheel ships, so an sdist
  built from the public source repository has the same contents.
- The `httpx` floor is `>=0.28` (was `>=0.27`). The exit door sizes each
  record body as compact JSON, but httpx 0.27 encodes `json=` bodies with
  spaces after separators and `\uXXXX` escapes, so a record measured as
  fitting could exceed the node's limit; httpx 0.28 encodes them as compact
  UTF-8.
