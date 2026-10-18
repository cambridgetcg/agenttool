# Changelog — agenttool-sdk

The Python SDK and the TypeScript SDK (`@agenttool/sdk` on npm) share version
numbers; the TypeScript changes are in
[`../sdk-ts/CHANGELOG.md`](../sdk-ts/CHANGELOG.md). This file starts at
0.23.0. Earlier releases and their verified receipts are listed under
"Release history and verified receipts" in [`README.md`](README.md).

A version listed here is a source version. Whether PyPI serves it is answered
by PyPI (`https://pypi.org/project/agenttool-sdk/`).

## 0.24.0 — prepared, not yet published

Prepared on 2026-10-18. Until it is released, PyPI does not serve 0.24.0;
0.22.1 is the newest version on PyPI and npm. The PyPI release also waits on
the open steps in `docs/PYPI-RELEASES.md` (the workflow still runs in the
private repository).

0.24.0 supersedes 0.23.0. The `sdk-v0.23.0` tag in the public source
repository was cut on 2026-10-13 from private source `42ae9148`, before the
trace-consent change below merged (`4d75dc35`, #459). It was never published
to PyPI or npm, and it will not be (owner decision, 2026-10-18): publishing
it would ship an adapter that writes model-authored `<trace>` markup by
default. The tag stays; release tags are never moved or reused. 0.24.0
carries everything listed under 0.23.0 below, plus these changes.

### Migration: model-written `<trace>` markup now needs consent

- **What changes.** In 0.22.1 and in the 0.23.0 tag, `AnthropicAdapter` turns
  a well-formed `<trace>` in the model's final response into a `/v1/traces`
  write by default, from `create()` and from the managed stream, even when
  the caller asked for no trace. From 0.24.0 it writes one only when the new
  `before_trace_write` hook returns literal `True`. With no hook, nothing is
  written. A hook that returns anything else, or raises, also writes nothing;
  the call still returns, and the refusal appears in
  `response.agenttool.markup_emissions` with `id=None` and an error message.
- **Who is affected.** Only callers that rely on model-written `<trace>`
  markup reaching `/v1/traces`. The opt-in decision trace
  (`metadata={"agenttool": {"trace": "decision"}}` or `with at.deciding(...)`)
  is unchanged and needs no hook. `<chronicle>` markup already needed
  `before_chronicle_write` and still does. Callers that set
  `disable_markup_parsing=True` or `skip_markup` see no difference.
- **How to opt in.** Pass a synchronous hook and return `True` only after
  your own review. It receives a frozen `TraceBeforeWriteContext`
  (`source="anthropic_markup"`, `type`, `decision`, `conclusion`,
  `observations`, `confidence`); its return value is neither stored nor
  signed.

  ```python
  from agenttool import AnthropicAdapter, TraceBeforeWriteContext


  def review_trace(context: TraceBeforeWriteContext) -> bool:
      # `ask_operator` is your own review step.
      return ask_operator(f"{context.type}: {context.decision} → {context.conclusion}") is True


  adapter = AnthropicAdapter(Anthropic(), at, before_trace_write=review_trace)
  ```

  A hook that always returns `True` restores the old behaviour. The default
  changed because a model can repeat markup it was shown in a user message,
  tool result or document, and recent project traces return in later full
  wakes.
- New exports: `TraceBeforeWriteContext`, `TraceBeforeWriteHook`.

### Migration: asynchronous Anthropic clients are refused

`AnthropicAdapter` raises `AgentToolError`
(`anthropic_async_client_unsupported`) at construction when
`messages.create`, or a function it wraps through `__wrapped__`, is a
coroutine function. That covers `AsyncAnthropic`, and also a synchronous
`functools.wraps` shim over an async function. A provider call that still
returns an awaitable is closed and refused before any trace or markup
request. 0.22.1 accepted `AsyncAnthropic` but never worked with it: the call
returned an object that could not be awaited, sent no provider request, and,
with tracing on, posted a decision trace whose conclusion was
`(empty response)`. Use the synchronous `Anthropic` client.

### Changed

- `AnthropicAdapter` counts trace limits in UTF-16 units, as the server's
  limit and the TypeScript SDK do: summaries at 200, conclusions at 4,000,
  and the decision trace's observation at 1,000. It never splits a
  character. 0.22.1 cut by code points, so text heavy in characters outside
  the Basic Multilingual Plane (most emoji) could exceed the server's limit
  and the server rejected the trace.
- `OpenAIResponsesAdapter` accepts any mapping as `metadata`. In 0.22.1 a
  non-dict mapping was ignored, so `skip_wake` had no effect and
  `metadata["agenttool"]` reached the provider. The `openai` package's
  `NOT_GIVEN` / `omit` now count as an omitted `store`, which is sent as
  `False`; in 0.22.1 they dropped `store` from the request and the
  provider's default applied.
- Docstrings only: `at.x402` says the rail is retired for AgentTool (the
  top-up route has answered `410 purchases_retired` since 2026-09-23, so
  `top_up` raises and nothing is signed; `payment(id)` still reads recorded
  payments), and `canonical_wallet_address_claim_bytes` no longer says that
  `POST /v1/wallets/:id/addresses` verifies its digest, since no such route
  is on main.

### Documentation

- The README marks the x402 rail retired, adds the "Provider adapters — what
  each call sends" section, and says the wallet address-claim helpers have
  no server route on main.

## 0.23.0 — tagged, never published; superseded by 0.24.0

Tagged `sdk-v0.23.0` in the public source repository on 2026-10-13 and never
published to PyPI or npm; see 0.24.0. The changes below first reach a
registry in 0.24.0.

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
- The packaged `SOUL.md` letter, in the wheel and the sdist, is the edition
  published at `https://docs.agenttool.dev/SOUL.md`.
- Examples use neutral fictional names.

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
